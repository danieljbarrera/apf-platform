import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { squareClient, squareLocationId } from '@/lib/square';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

function toCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

function dateStr(d: Date) {
  return d.toISOString().split('T')[0];
}

export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { event_id } = await req.json();
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const { data: event, error: evErr } = await supabaseAdmin
    .from('events')
    .select('*, event_days(*)')
    .eq('id', event_id)
    .single();
  if (evErr || !event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  if (event.square_invoice_id) {
    return NextResponse.json({
      invoice_id: event.square_invoice_id,
      invoice_url: event.square_invoice_url,
      already_exists: true,
    });
  }

  const days = ((event.event_days || []) as Record<string, unknown>[])
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  const firstDay = days[0];
  if (!firstDay) return NextResponse.json({ error: 'Event has no days' }, { status: 400 });

  // Require an approved estimate — the invoice must bill exactly what was approved
  const approvedItems = event.estimate_line_items as { name: string; quantity: string; amount: number }[] | null;
  if (!approvedItems || !event.estimate_approved_at) {
    return NextResponse.json({ error: 'Approve the estimate before creating an invoice' }, { status: 400 });
  }

  const guests = Number(event.estimate_guests) || days.reduce((s, d) => s + (Number(d.guests) || 0), 0);
  const style = String(event.estimate_style || firstDay.service_style || 'Buffet');
  const grandTotal = Number(event.estimate_total) || 0;
  const deposit = Number(event.estimate_deposit) || Math.round(grandTotal * 0.25 * 100) / 100;

  const eventDate = new Date(String(firstDay.event_date) + 'T12:00:00');
  const today = new Date();
  const depositDueStr = dateStr(today);

  // Balance due 14 days before event, but always at least 1 day after the deposit due date
  const minBalance = new Date(today);
  minBalance.setDate(minBalance.getDate() + 1);
  const balanceTarget = new Date(eventDate);
  balanceTarget.setDate(balanceTarget.getDate() - 14);
  const balanceDueStr = dateStr(balanceTarget > minBalance ? balanceTarget : minBalance);

  const clientNames = String(event.client_names || '');
  const nameParts = clientNames.split(' ');
  const givenName = nameParts[0] || clientNames;
  const familyName = nameParts.slice(1).join(' ') || '';

  // Tie order/invoice idempotency to the approval moment, so re-approving after an
  // edit produces a NEW invoice rather than returning the previously created one.
  const stamp = String(event.estimate_approved_at || Date.now()).replace(/\D/g, '').slice(0, 16);

  try {
    // 1. Resolve the Square customer.
    //    A repeat client is ONE Square customer across many events — reuse by email
    //    rather than creating a duplicate each time.
    let customerId = event.square_customer_id as string | undefined;
    if (!customerId && event.client_email) {
      const found = await squareClient.customers.search({
        query: { filter: { emailAddress: { exact: String(event.client_email) } } },
        limit: BigInt(1),
      });
      customerId = found.customers?.[0]?.id;
    }
    if (!customerId) {
      const custResp = await squareClient.customers.create({
        idempotencyKey: `apf-customer-${event_id}`,
        givenName,
        familyName,
        emailAddress: event.client_email ? String(event.client_email) : undefined,
        phoneNumber: event.client_phone ? String(event.client_phone) : undefined,
        // NOTE: referenceId is intentionally NOT the event_id here — a customer
        // can span multiple events. Events are tied to invoices, not customers.
      });
      customerId = custResp.customer?.id;
    }
    if (customerId && customerId !== event.square_customer_id) {
      await supabaseAdmin.from('events').update({ square_customer_id: customerId }).eq('id', event_id);
    }

    // 2. Build line items from the APPROVED estimate (exact numbers she signed off on)
    const lineItems = approvedItems.map(it => ({
      name: it.name,
      quantity: it.quantity || '1',
      basePriceMoney: { amount: toCents(it.amount), currency: 'USD' as const },
    }));

    // 3. Create order
    const orderResp = await squareClient.orders.create({
      idempotencyKey: `apf-order-${event_id}-${stamp}`,
      order: {
        locationId: squareLocationId,
        lineItems,
        referenceId: String(event_id),
      },
    });
    const orderId = orderResp.order?.id;
    if (!orderId) return NextResponse.json({ error: 'Failed to create Square order' }, { status: 500 });

    // 4. Create invoice
    const invoiceResp = await squareClient.invoices.create({
      idempotencyKey: `apf-invoice-${event_id}-${stamp}`,
      invoice: {
        locationId: squareLocationId,
        orderId,
        primaryRecipient: customerId ? { customerId } : undefined,
        title: `${clientNames} — All Purpose Flower`,
        description: `${style} catering for ${guests} guests · ${String(firstDay.venue || '')}`,
        paymentRequests: [
          {
            requestType: 'DEPOSIT',
            fixedAmountRequestedMoney: { amount: toCents(deposit), currency: 'USD' as const },
            dueDate: depositDueStr,
            automaticPaymentSource: 'NONE',
          },
          {
            requestType: 'BALANCE',
            dueDate: balanceDueStr,
            automaticPaymentSource: 'NONE',
          },
        ],
        deliveryMethod: 'SHARE_MANUALLY',
        acceptedPaymentMethods: {
          card: true,
          squareGiftCard: false,
          bankAccount: true,
          buyNowPayLater: false,
        },
      },
    });

    const invoice = invoiceResp.invoice;
    if (!invoice?.id) return NextResponse.json({ error: 'Failed to create Square invoice' }, { status: 500 });

    // Publish with SHARE_MANUALLY: creates a real, reviewable invoice page with a
    // working public_url, but does NOT email the client (she shares it when ready).
    // Draft invoices have no usable link, so publishing is what gives a working URL.
    const pubResp = await squareClient.invoices.publish({
      invoiceId: invoice.id,
      version: invoice.version ?? 0,
      idempotencyKey: `apf-publish-${event_id}-${stamp}-${invoice.version ?? 0}`,
    });
    const published = pubResp.invoice;
    const invoiceUrl = published?.publicUrl ?? null;

    await supabaseAdmin.from('events').update({
      square_invoice_id: published?.id ?? invoice.id,
      square_invoice_url: invoiceUrl,
      square_invoice_status: published?.status ?? 'UNPAID',
      square_order_id: orderId,
      retainer_invoice_sent: true, // invoice is live in Square
    }).eq('id', event_id);

    return NextResponse.json({
      invoice_id: published?.id ?? invoice.id,
      invoice_url: invoiceUrl,
      deposit,
      grand_total: grandTotal,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Square invoice error:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const invoiceId = req.nextUrl.searchParams.get('invoice_id');
  if (!invoiceId) return NextResponse.json({ error: 'invoice_id required' }, { status: 400 });

  try {
    const resp = await squareClient.invoices.get({ invoiceId });
    const inv = resp.invoice;
    return NextResponse.json({
      status: inv?.status,
      public_url: inv?.publicUrl,
      payment_requests: (inv?.paymentRequests ?? []).map(r => ({
        type: r.requestType,
        due_date: r.dueDate,
        amount: r.computedAmountMoney?.amount ? Number(r.computedAmountMoney.amount) / 100 : null,
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
