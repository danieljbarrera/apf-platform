import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { squareFor, type SquareEnv } from '@/lib/square';
import { getSquareMode } from '@/lib/settings';
import { rollupEvent } from '@/lib/rollup';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

// Publishes the draft invoice. With EMAIL delivery, Square emails it to the
// client — this is the explicit "send" step, distinct from creating the draft.
export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { event_id, day_id } = await req.json();
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const { data: days } = await supabaseAdmin.from('event_days').select('id, day_type, square_invoice_id, square_invoice_status, square_env').eq('event_id', event_id);
  const day = day_id ? (days || []).find(d => String(d.id) === String(day_id)) : (days || []).find(d => d.square_invoice_id && d.square_invoice_status === 'DRAFT') || (days || []).find(d => d.square_invoice_id);
  if (!day?.square_invoice_id) return NextResponse.json({ error: 'No invoice to send — create it first.' }, { status: 400 });
  if (day.square_invoice_status && day.square_invoice_status !== 'DRAFT') {
    return NextResponse.json({ error: 'This invoice has already been sent.' }, { status: 400 });
  }

  const { client: squareClient } = squareFor((day.square_env as SquareEnv) || await getSquareMode());

  try {
    const cur = await squareClient.invoices.get({ invoiceId: String(day.square_invoice_id) });
    const inv = cur.invoice;
    if (!inv?.id) return NextResponse.json({ error: 'Invoice not found in Square' }, { status: 404 });

    const pub = await squareClient.invoices.publish({
      invoiceId: inv.id,
      version: inv.version ?? 0,
      idempotencyKey: `apf-send-${day.id}-${inv.version ?? 0}`,
    });
    const published = pub.invoice;

    await supabaseAdmin.from('event_days').update({
      square_invoice_url: published?.publicUrl ?? null,
      square_invoice_status: published?.status ?? 'UNPAID',
      invoice_sent_at: new Date().toISOString(),
    }).eq('id', day.id);
    await supabaseAdmin.from('events').update({ retainer_invoice_sent: true }).eq('id', event_id);
    await rollupEvent(event_id);

    return NextResponse.json({ ok: true, invoice_url: published?.publicUrl ?? null, status: published?.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Square send error:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
