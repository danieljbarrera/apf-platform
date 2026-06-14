import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { WebhooksHelper } from 'square';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { rollupEvent } from '@/lib/rollup';

const NOTIFICATION_URL = 'https://apf-platform.vercel.app/api/square/webhook';

function money(m: { amount?: bigint | number | null } | undefined | null): number {
  if (!m?.amount) return 0;
  return Number(m.amount) / 100;
}

async function notifyOwner(subject: string, lines: string[]) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    const html = `<div style="font-family:Georgia,serif;color:#161410;font-size:14px;line-height:1.7;">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#97784c;margin-bottom:8px;">All Purpose Flower · Payment Update</div>
      ${lines.map(l => `<div>${l}</div>`).join('')}
    </div>`;
    await transporter.sendMail({
      from: 'All Purpose Flower <info@allpurposeflowerco.com>',
      to: 'info@allpurposeflowerco.com',
      bcc: 'danieljbarrera@gmail.com',
      subject,
      html,
    });
  } catch (e) {
    console.error('Webhook notify email failed:', e);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-square-hmacsha256-signature') || '';

  // Try each configured signature key (production + sandbox) so either
  // environment's webhook can hit this single endpoint.
  const keys = [
    process.env.SQUARE_PROD_WEBHOOK_KEY,
    process.env.SQUARE_SANDBOX_WEBHOOK_KEY,
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
  ].filter(Boolean) as string[];

  let valid = false;
  for (const signatureKey of keys) {
    if (await WebhooksHelper.verifySignature({ requestBody: body, signatureHeader: signature, signatureKey, notificationUrl: NOTIFICATION_URL }).catch(() => false)) {
      valid = true;
      break;
    }
  }

  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try { event = JSON.parse(body); } catch { return NextResponse.json({ ok: true }); }

  const type = String(event.type || '');

  // We care about invoice payment / status changes
  if (type.startsWith('invoice.')) {
    const invoice = (event.data as Record<string, unknown>)?.object as Record<string, unknown> | undefined;
    const inv = (invoice?.invoice as Record<string, unknown>) || invoice;
    const invoiceId = inv?.id ? String(inv.id) : null;
    const status = inv?.status ? String(inv.status) : null;

    if (invoiceId) {
      // Invoices live on days now — find the day, update it, roll up the event.
      const { data: day } = await supabaseAdmin
        .from('event_days')
        .select('id, event_id, deposit_paid_at, balance_paid_at')
        .eq('square_invoice_id', invoiceId)
        .maybeSingle();

      if (day) {
        const { data: ev } = await supabaseAdmin.from('events').select('id, client_names, status').eq('id', day.event_id).single();
        const updates: Record<string, unknown> = { square_invoice_status: status };

        const requests = (inv?.payment_requests as Record<string, unknown>[]) || [];
        const deposit = requests.find(r => r.request_type === 'DEPOSIT');
        const balance = requests.find(r => r.request_type === 'BALANCE');
        const depComplete = deposit ? money(deposit.total_completed_amount_money as { amount?: number }) : 0;
        const balComplete = balance ? money(balance.total_completed_amount_money as { amount?: number }) : 0;
        updates.amount_paid = Math.round((depComplete + balComplete) * 100) / 100;

        const todayDate = new Date().toISOString().split('T')[0];
        let depositJustLanded = false;
        if (depComplete > 0 && !day.deposit_paid_at) {
          updates.deposit_paid_at = new Date().toISOString();
          depositJustLanded = true;
        }
        if (balComplete > 0 && !day.balance_paid_at) updates.balance_paid_at = new Date().toISOString();

        await supabaseAdmin.from('event_days').update(updates).eq('id', day.id);

        // Event-level effects
        const evUpd: Record<string, unknown> = {};
        if (depositJustLanded) { evUpd.retainer_paid = 'yes'; evUpd.retainer_paid_date = todayDate; if (ev?.status === 'New') evUpd.status = 'Booked'; }
        if (balComplete > 0) { evUpd.final_payment_received = true; evUpd.final_payment_received_date = todayDate; }
        if (Object.keys(evUpd).length) await supabaseAdmin.from('events').update(evUpd).eq('id', day.event_id);
        await rollupEvent(day.event_id);

        if (depositJustLanded && ev) {
          await notifyOwner(
            `Deposit received — ${ev.client_names}`,
            [
              `<strong>${ev.client_names}</strong> just paid a deposit.`,
              `Deposit: <strong>$${money(deposit!.total_completed_amount_money as { amount?: number }).toLocaleString()}</strong>`,
              ev.status === 'New' ? `Status auto-advanced to <strong>Booked</strong>.` : '',
              `<a href="https://apf-platform.vercel.app/admin/events/${day.event_id}">Open event →</a>`,
            ].filter(Boolean)
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
