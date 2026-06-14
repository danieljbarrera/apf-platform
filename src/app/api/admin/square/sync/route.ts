import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { squareClient, squareLocationId } from '@/lib/square';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

// Pulls every Square invoice tied to this event's customer and returns their
// live status + links. Also refreshes the primary invoice stored on the event.
export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { event_id } = await req.json();
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const { data: event } = await supabaseAdmin.from('events').select('square_customer_id, square_invoice_id, deposit_paid_at, balance_paid_at').eq('id', event_id).single();
  if (!event?.square_customer_id) {
    return NextResponse.json({ invoices: [], message: 'No Square customer linked yet' });
  }

  const dashHost = process.env.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://app.squareupsandbox.com'
    : 'https://app.squareup.com';

  try {
    const resp = await squareClient.invoices.search({
      query: {
        filter: { locationIds: [squareLocationId], customerIds: [event.square_customer_id] },
        sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' },
      },
      limit: 100,
    });

    const cents = (m: { amount?: bigint | null } | undefined) => m?.amount ? Number(m.amount) / 100 : 0;

    const invoices = (resp.invoices ?? []).map(inv => {
      const dep = inv.paymentRequests?.find(r => r.requestType === 'DEPOSIT');
      const bal = inv.paymentRequests?.find(r => r.requestType === 'BALANCE');
      return {
        id: inv.id,
        invoice_number: inv.invoiceNumber,
        status: inv.status,
        public_url: inv.publicUrl || `${dashHost}/dashboard/invoices/${inv.id}`,
        title: inv.title,
        total: inv.paymentRequests?.reduce((s, r) => s + cents(r.computedAmountMoney), 0) ?? null,
        deposit_paid: dep ? cents(dep.totalCompletedAmountMoney) : 0,
        balance_paid: bal ? cents(bal.totalCompletedAmountMoney) : 0,
      };
    });

    // Refresh the event's primary invoice from the matching record
    const primary = invoices.find(i => i.id === event.square_invoice_id) || invoices[0];
    if (primary) {
      const updates: Record<string, unknown> = {
        square_invoice_id: primary.id,
        square_invoice_url: primary.public_url,
        square_invoice_status: primary.status,
      };
      if (primary.deposit_paid > 0 && !event.deposit_paid_at) updates.deposit_paid_at = new Date().toISOString();
      if (primary.balance_paid > 0 && !event.balance_paid_at) updates.balance_paid_at = new Date().toISOString();
      await supabaseAdmin.from('events').update(updates).eq('id', event_id);
    }

    return NextResponse.json({ invoices });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Square sync error:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
