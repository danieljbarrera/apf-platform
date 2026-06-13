import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { squareClient, squareLocationId } from '@/lib/square';
import { calcPackage, calcBar } from '@/lib/pricing';

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

  const guests = days.reduce((s, d) => s + (Number(d.guests) || 0), 0);
  const style = String(firstDay.service_style || 'Buffet');
  const hours = Number(event.event_hours) || 5;
  const barPackage = event.bar_package ? String(event.bar_package) : null;

  const pkg = calcPackage(guests, hours, style, { appetizers: 0, dessert: false, coffee: false });
  const bar = barPackage && ['Soft Bar', 'Full Bar'].includes(barPackage) ? calcBar(guests, barPackage) : null;
  const grandTotal = pkg.total + (bar?.total || 0);
  const deposit = Math.round(grandTotal * 0.25 * 100) / 100;

  const eventDate = new Date(String(firstDay.event_date) + 'T12:00:00');
  const balanceDue = new Date(eventDate);
  balanceDue.setDate(balanceDue.getDate() - 14);
  const today = new Date();
  const depositDueStr = dateStr(today);
  const balanceDueStr = dateStr(balanceDue > today ? balanceDue : today);

  const clientNames = String(event.client_names || '');
  const nameParts = clientNames.split(' ');
  const givenName = nameParts[0] || clientNames;
  const familyName = nameParts.slice(1).join(' ') || '';

  try {
    // 1. Create or reuse customer
    let customerId = event.square_customer_id as string | undefined;
    if (!customerId) {
      const custResp = await squareClient.customers.create({
        idempotencyKey: `apf-customer-${event_id}`,
        givenName,
        familyName,
        emailAddress: event.client_email ? String(event.client_email) : undefined,
        phoneNumber: event.client_phone ? String(event.client_phone) : undefined,
        referenceId: String(event_id),
      });
      customerId = custResp.customer?.id;
      if (customerId) {
        await supabaseAdmin.from('events').update({ square_customer_id: customerId }).eq('id', event_id);
      }
    }

    // 2. Build line items
    const serviceBase = pkg.subtotal + (bar?.subtotal || 0);
    const lineItems = [
      {
        name: `Catering Services — ${style} for ${guests} guests`,
        quantity: '1',
        basePriceMoney: { amount: toCents(pkg.subtotal), currency: 'USD' as const },
      },
      ...(bar ? [{
        name: `Bar Package — ${barPackage}`,
        quantity: '1',
        basePriceMoney: { amount: toCents(bar.subtotal), currency: 'USD' as const },
      }] : []),
      {
        name: 'Service Fee (10%)',
        quantity: '1',
        basePriceMoney: { amount: toCents(serviceBase * 0.10), currency: 'USD' as const },
      },
      {
        name: 'Sales Tax (9.25%)',
        quantity: '1',
        basePriceMoney: { amount: toCents(serviceBase * 0.0925), currency: 'USD' as const },
      },
      {
        name: 'Card Processing (3.5%)',
        quantity: '1',
        basePriceMoney: { amount: toCents(serviceBase * 0.035), currency: 'USD' as const },
      },
    ];

    // 3. Create order
    const orderResp = await squareClient.orders.create({
      idempotencyKey: `apf-order-${event_id}`,
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
      idempotencyKey: `apf-invoice-${event_id}`,
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
      },
    });

    const invoice = invoiceResp.invoice;
    if (!invoice?.id) return NextResponse.json({ error: 'Failed to create Square invoice' }, { status: 500 });

    // 5. Publish invoice
    const pubResp = await squareClient.invoices.publish({
      invoiceId: invoice.id,
      version: invoice.version ?? 0,
      idempotencyKey: `apf-publish-${event_id}`,
    });

    const published = pubResp.invoice;
    const invoiceUrl = published?.publicUrl ?? null;

    // 6. Save to event
    await supabaseAdmin.from('events').update({
      square_invoice_id: published?.id,
      square_invoice_url: invoiceUrl,
      square_order_id: orderId,
    }).eq('id', event_id);

    return NextResponse.json({
      invoice_id: published?.id,
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
