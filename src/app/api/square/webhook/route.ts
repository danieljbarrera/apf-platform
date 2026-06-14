import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { WebhooksHelper } from 'square';
import { supabaseAdmin } from '@/lib/supabase-admin';

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
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';

  // Verify the request genuinely came from Square
  const valid = await WebhooksHelper.verifySignature({
    requestBody: body,
    signatureHeader: signature,
    signatureKey,
    notificationUrl: NOTIFICATION_URL,
  }).catch(() => false);

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
      const { data: ev } = await supabaseAdmin
        .from('events')
        .select('id, client_names, status, deposit_paid_at, balance_paid_at')
        .eq('square_invoice_id', invoiceId)
        .maybeSingle();

      if (ev) {
        const updates: Record<string, unknown> = { square_invoice_status: status };

        // Inspect payment requests to detect deposit / balance completion
        const requests = (inv?.payment_requests as Record<string, unknown>[]) || [];
        const deposit = requests.find(r => r.request_type === 'DEPOSIT');
        const balance = requests.find(r => r.request_type === 'BALANCE');

        const depositPaid = deposit && money(deposit.total_completed_amount_money as { amount?: number }) > 0;
        const balancePaid = balance && money(balance.total_completed_amount_money as { amount?: number }) > 0;

        let depositJustLanded = false;
        if (depositPaid && !ev.deposit_paid_at) {
          updates.deposit_paid_at = new Date().toISOString();
          depositJustLanded = true;
          // Auto-advance New → Booked
          if (ev.status === 'New') updates.status = 'Booked';
        }
        if (balancePaid && !ev.balance_paid_at) {
          updates.balance_paid_at = new Date().toISOString();
        }

        await supabaseAdmin.from('events').update(updates).eq('id', ev.id);

        if (depositJustLanded) {
          await notifyOwner(
            `Deposit received — ${ev.client_names}`,
            [
              `<strong>${ev.client_names}</strong> just paid their deposit.`,
              `Deposit: <strong>$${money(deposit!.total_completed_amount_money as { amount?: number }).toLocaleString()}</strong>`,
              ev.status === 'New' ? `Status auto-advanced to <strong>Booked</strong>.` : '',
              `<a href="https://apf-platform.vercel.app/admin/events/${ev.id}">Open event →</a>`,
            ].filter(Boolean)
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
