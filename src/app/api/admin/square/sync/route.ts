import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { squareFor, dashHostFor, type SquareEnv } from '@/lib/square';
import { getSquareMode } from '@/lib/settings';

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

  const { data: event } = await supabaseAdmin.from('events').select('square_customer_id, square_invoice_id, deposit_paid_at, balance_paid_at, status, square_env').eq('id', event_id).single();
  if (!event?.square_customer_id) {
    return NextResponse.json({ invoices: [], message: 'No Square customer linked yet' });
  }

  const env = (event.square_env as SquareEnv) || await getSquareMode();
  const { client: squareClient, locationId: squareLocationId } = squareFor(env);
  const dashHost = dashHostFor(env);

  try {
    const resp = await squareClient.invoices.search({
      query: {
        filter: { locationIds: [squareLocationId], customerIds: [event.square_customer_id] },
        sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' },
      },
      limit: 100,
    });

    const cents = (m: { amount?: bigint | null } | undefined) => m?.amount ? Number(m.amount) / 100 : 0;

    const all = (resp.invoices ?? []).map(inv => {
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
        is_this_event: inv.id === event.square_invoice_id,
      };
    });

    // CRITICAL for repeat clients: only reconcile THIS event's own invoice.
    // A repeat client shares one Square customer across many events/invoices —
    // we must never stamp this event paid from a different event's invoice.
    const primary = all.find(i => i.is_this_event);
    if (primary) {
      const todayDate = new Date().toISOString().split('T')[0];
      const updates: Record<string, unknown> = {
        square_invoice_url: primary.public_url,
        square_invoice_status: primary.status,
      };
      if (primary.deposit_paid > 0 && !event.deposit_paid_at) {
        updates.deposit_paid_at = new Date().toISOString();
        updates.retainer_paid = 'yes';
        updates.retainer_paid_date = todayDate;
        if (event.status === 'New') updates.status = 'Booked';
      }
      if (primary.balance_paid > 0 && !event.balance_paid_at) {
        updates.balance_paid_at = new Date().toISOString();
        updates.final_payment_received = true;
        updates.final_payment_received_date = todayDate;
      }
      await supabaseAdmin.from('events').update(updates).eq('id', event_id);
    }

    // Return only this event's invoice (plus a count of the client's others for context)
    const thisEvent = all.filter(i => i.is_this_event);
    return NextResponse.json({
      invoices: thisEvent,
      client_other_invoice_count: all.length - thisEvent.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Square sync error:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
