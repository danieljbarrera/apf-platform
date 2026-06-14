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
  const refresh = body.refresh === true; // re-pull already-linked production events

  const { client, locationId } = squareFor('production');
  if (!locationId) return NextResponse.json({ error: 'Production credentials not configured in Vercel.' }, { status: 400 });
  const dashHost = dashHostFor('production');

  // Default: imported events not yet linked. Refresh: re-pull linked production events.
  let q = supabaseAdmin.from('events').select('id, client_names, client_email, estimate_total').is('deleted_at', null);
  q = refresh ? q.eq('square_env', 'production') : q.is('square_invoice_id', null).ilike('internal_notes', 'Imported from Square invoice%');
  const { data: events } = await q;

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

      // Reconstruct a clean breakdown: products (PRE-tax grossSales) + service
      // charges + one combined Sales Tax line. (Line totalMoney already bakes in
      // tax, so we use grossSalesMoney to avoid double-counting.) A guard line
      // forces the displayed total to match the real invoice exactly.
      let lineItems: { name: string; quantity: string; amount: number }[] = [];
      let orderTotal = 0, orderDiscount = 0;
      let guests: number | null = null, style: string | null = null;
      if (inv.orderId) {
        const ordResp = await client.orders.get({ orderId: inv.orderId });
        const order = ordResp.order;
        orderTotal = cents(order?.totalMoney);
        orderDiscount = cents(order?.totalDiscountMoney);
        // Derive guests + style from the FOOD line (its quantity = guest count)
        const foodLine = (order?.lineItems || []).find(li => /food|family style|plated|buffet/i.test(li.name || ''));
        if (foodLine) {
          const q = parseInt(foodLine.quantity || '', 10);
          if (q > 0) guests = q;
          const nm = (foodLine.name || '').toLowerCase();
          style = nm.includes('family style') ? 'Family Style' : nm.includes('plated') ? 'Plated' : nm.includes('buffet') ? 'Buffet' : null;
        }
        const products = (order?.lineItems || []).map(li => ({ name: li.name || 'Item', quantity: '1', amount: cents(li.grossSalesMoney) || (cents(li.totalMoney) - cents(li.totalTaxMoney)) }));
        const charges = (order?.serviceCharges || []).map(sc => ({ name: sc.name || 'Service Charge', quantity: '1', amount: cents(sc.totalMoney) || cents(sc.appliedMoney) }));
        const tax = cents(order?.totalTaxMoney);
        lineItems = [...products, ...charges];
        if (tax > 0) lineItems.push({ name: 'Sales Tax', quantity: '1', amount: tax });
        lineItems = lineItems.filter(li => li.amount > 0);
        // Force exactness: displayed total = sum(lines) - discount must equal orderTotal
        const lineSumRaw = Math.round(lineItems.reduce((s, li) => s + li.amount, 0) * 100) / 100;
        const adj = Math.round((orderTotal - (lineSumRaw - orderDiscount)) * 100) / 100;
        if (Math.abs(adj) >= 0.01) lineItems.push({ name: 'Adjustment', quantity: '1', amount: adj });
      }

      const dep = (inv.paymentRequests || []).find(r => r.requestType === 'DEPOSIT');
      const bal = (inv.paymentRequests || []).find(r => r.requestType === 'BALANCE');
      const depositPaid = dep ? cents(dep.totalCompletedAmountMoney) : 0;
      const balancePaid = bal ? cents(bal.totalCompletedAmountMoney) : 0;
      const depositAmt = dep ? cents(dep.computedAmountMoney) : 0;
      const lineSum = Math.round(lineItems.reduce((s, li) => s + li.amount, 0) * 100) / 100;
      const finalTotal = orderTotal || best.tot;

      const displayedTotal = Math.round((lineSum - orderDiscount) * 100) / 100;
      const plan = {
        event: ev.client_names,
        matched_invoice: inv.invoiceNumber || inv.id,
        order_total: orderTotal,
        displayed_total: displayedTotal,  // must equal order_total
        match_ok: Math.abs(displayedTotal - orderTotal) < 0.01,
        discount: orderDiscount,
        line_items: lineItems.length,
        status: inv.status,
        deposit: depositAmt,
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
          deposit_paid_at: depositPaid > 0 ? new Date().toISOString() : null,
          balance_paid_at: balancePaid > 0 ? new Date().toISOString() : null,
          amount_paid: Math.round((depositPaid + balancePaid) * 100) / 100,
        };
        if (lineItems.length) {
          update.estimate_line_items = lineItems;
          update.estimate_total = finalTotal;
          update.estimate_deposit = depositAmt || Math.round(finalTotal * 0.25 * 100) / 100;
          update.estimate_discount = orderDiscount || null;
          update.estimate_approved_at = new Date().toISOString();
        }
        if (guests) update.estimate_guests = guests;
        if (style) update.estimate_style = style;
        await supabaseAdmin.from('events').update(update).eq('id', ev.id);

        // Backfill the main event day's guests/style so the dashboard shows them
        if (guests || style) {
          const { data: dys } = await supabaseAdmin.from('event_days').select('id, day_type').eq('event_id', ev.id);
          const mainDay = (dys || []).find(d => (d.day_type || 'Main') === 'Main') || (dys || [])[0];
          if (mainDay) {
            const dayUpd: Record<string, unknown> = {};
            if (guests) dayUpd.guests = guests;
            if (style) dayUpd.service_style = style;
            await supabaseAdmin.from('event_days').update(dayUpd).eq('id', mainDay.id);
          }
        }
      }
      results.push(plan);
    } catch (e: unknown) {
      results.push({ event: ev.client_names, status: 'error: ' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  return NextResponse.json({ dry, count: results.length, results });
}
