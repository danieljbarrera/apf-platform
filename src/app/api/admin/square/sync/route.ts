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

  const { data: event } = await supabaseAdmin.from('events').select('square_customer_id, square_invoice_id').eq('id', event_id).single();
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

    const invoices = (resp.invoices ?? []).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoiceNumber,
      status: inv.status,
      public_url: inv.publicUrl || `${dashHost}/dashboard/invoices/${inv.id}`,
      title: inv.title,
      total: inv.paymentRequests?.reduce((s, r) => s + (r.computedAmountMoney?.amount ? Number(r.computedAmountMoney.amount) / 100 : 0), 0) ?? null,
    }));

    // Refresh the event's primary invoice link/status from the matching record
    const primary = invoices.find(i => i.id === event.square_invoice_id) || invoices[0];
    if (primary) {
      await supabaseAdmin.from('events').update({
        square_invoice_id: primary.id,
        square_invoice_url: primary.public_url,
        square_invoice_status: primary.status,
      }).eq('id', event_id);
    }

    return NextResponse.json({ invoices });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Square sync error:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
