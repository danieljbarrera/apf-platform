import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { squareFor, dashHostFor } from '@/lib/square';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

const cents = (m: { amount?: bigint | null } | undefined) => m?.amount ? Number(m.amount) / 100 : 0;

// Links imported events to their real PRODUCTION Square invoices and pulls exact
// line items into the estimate. Pass { dry: true } to preview without writing.
export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dry = body.dry !== false; // default to dry-run for safety

  const { client, locationId } = squareFor('production');
  if (!locationId) return NextResponse.json({ error: 'Production credentials not configured in Vercel.' }, { status: 400 });
  const dashHost = dashHostFor('production');

  // Target: imported events not yet linked, with a client email to match on
  const { data: events } = await supabaseAdmin
    .from('events')
    .select('id, client_names, client_email, estimate_total')
    .is('deleted_at', null)
    .is('square_invoice_id', null)
    .ilike('internal_notes', 'Imported from Square invoice%');

  const results: Record<string, unknown>[] = [];

  for (const ev of events || []) {
    const email = (ev.client_email || '').toLowerCase().trim();
    if (!email) { results.push({ event: ev.client_names, status: 'skipped — no email' }); continue; }

    try {
      const custResp = await client.customers.search({ query: { filter: { emailAddress: { exact: email } } }, limit: BigInt(5) });
      const customerIds = (custResp.customers || []).map(c => c.id!).filter(Boolean);
      if (!customerIds.length) { results.push({ event: ev.client_names, status: 'no Square customer found' }); continue; }

      const invResp = await client.invoices.search({
        query: { filter: { locationIds: [locationId], customerIds }, sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' } },
        limit: 50,
      });
      const invoices = invResp.invoices || [];
      if (!invoices.length) { results.push({ event: ev.client_names, status: 'no invoices for customer' }); continue; }

      // Pick the invoice whose total is closest to the imported estimate_total
      const target = Number(ev.estimate_total) || 0;
      const scored = invoices.map(inv => {
        const tot = (inv.paymentRequests || []).reduce((s, r) => s + cents(r.computedAmountMoney), 0);
        return { inv, tot, diff: Math.abs(tot - target) };
      }).sort((a, b) => a.diff - b.diff);
      const best = scored[0];
      const inv = best.inv;

      // Pull exact line items from the order behind the invoice
      let lineItems: { name: string; quantity: string; amount: number }[] = [];
      if (inv.orderId) {
        const ordResp = await client.orders.get({ orderId: inv.orderId });
        const order = ordResp.order;
        lineItems = (order?.lineItems || []).map(li => ({
          name: li.name || 'Item',
          quantity: '1',
          amount: cents(li.totalMoney) || cents(li.basePriceMoney),
        }));
        // Order-level discounts → a single discount line for display
        const disc = (order?.discounts || []).reduce((s, d) => s + cents(d.amountMoney), 0);
        if (disc > 0) lineItems.push({ name: 'Discount', quantity: '1', amount: -disc });
      }

      const dep = (inv.paymentRequests || []).find(r => r.requestType === 'DEPOSIT');
      const bal = (inv.paymentRequests || []).find(r => r.requestType === 'BALANCE');
      const depositPaid = dep ? cents(dep.totalCompletedAmountMoney) : 0;
      const balancePaid = bal ? cents(bal.totalCompletedAmountMoney) : 0;

      const plan = {
        event: ev.client_names,
        matched_invoice: inv.invoiceNumber || inv.id,
        invoice_total: best.tot,
        estimate_total: target,
        diff: best.diff,
        line_items: lineItems.length,
        status: inv.status,
        deposit_paid: depositPaid,
        balance_paid: balancePaid,
      };

      if (!dry) {
        const update: Record<string, unknown> = {
          square_invoice_id: inv.id,
          square_customer_id: inv.primaryRecipient?.customerId || customerIds[0],
          square_invoice_url: inv.publicUrl || `${dashHost}/dashboard/invoices/${inv.id}`,
          square_invoice_status: inv.status,
          square_env: 'production',
          invoice_sent_at: inv.status !== 'DRAFT' ? new Date().toISOString() : null,
          retainer_invoice_sent: inv.status !== 'DRAFT',
        };
        if (lineItems.length) {
          const lineTotal = lineItems.reduce((s, li) => s + li.amount, 0);
          update.estimate_line_items = lineItems.filter(li => li.amount > 0);
          update.estimate_total = lineTotal;
          update.estimate_deposit = Math.round(lineTotal * 0.25 * 100) / 100;
          update.estimate_approved_at = new Date().toISOString();
        }
        await supabaseAdmin.from('events').update(update).eq('id', ev.id);
      }
      results.push(plan);
    } catch (e: unknown) {
      results.push({ event: ev.client_names, status: 'error: ' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  return NextResponse.json({ dry, count: results.length, results });
}
