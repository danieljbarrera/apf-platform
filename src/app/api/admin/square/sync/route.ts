import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { squareFor, currentSquareMode, type SquareEnv } from '@/lib/square';
import { rollupEvent } from '@/lib/rollup';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

const cents = (m: { amount?: bigint | null } | undefined) => m?.amount ? Number(m.amount) / 100 : 0;

// Refreshes each day's Square invoice (live status + payments), then rolls up the event.
export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { event_id } = await req.json();
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const { data: days } = await supabaseAdmin
    .from('event_days')
    .select('id, day_type, square_invoice_id, square_env, deposit_paid_at, balance_paid_at')
    .eq('event_id', event_id);

  const invoices: { id: string; status?: string; total: number; deposit_paid: number; balance_paid: number; public_url?: string }[] = [];

  for (const day of (days || [])) {
    if (!day.square_invoice_id) continue;
    const env = (day.square_env as SquareEnv) || currentSquareMode();
    const { client } = squareFor(env);
    try {
      const resp = await client.invoices.get({ invoiceId: String(day.square_invoice_id) });
      const inv = resp.invoice;
      if (!inv) continue;
      const dep = inv.paymentRequests?.find(r => r.requestType === 'DEPOSIT');
      const bal = inv.paymentRequests?.find(r => r.requestType === 'BALANCE');
      const depositPaid = dep ? cents(dep.totalCompletedAmountMoney) : 0;
      const balancePaid = bal ? cents(bal.totalCompletedAmountMoney) : 0;
      const total = inv.paymentRequests?.reduce((s, r) => s + cents(r.computedAmountMoney), 0) ?? 0;

      const upd: Record<string, unknown> = {
        square_invoice_status: inv.status,
        square_invoice_url: inv.publicUrl || undefined,
        amount_paid: Math.round((depositPaid + balancePaid) * 100) / 100,
      };
      const todayDate = new Date().toISOString().split('T')[0];
      if (depositPaid > 0 && !day.deposit_paid_at) {
        upd.deposit_paid_at = new Date().toISOString();
        upd.retainer_paid = 'yes'; upd.retainer_paid_date = todayDate;
      }
      if (balancePaid > 0 && !day.balance_paid_at) upd.balance_paid_at = new Date().toISOString();
      await supabaseAdmin.from('event_days').update(upd).eq('id', day.id);
      invoices.push({ id: String(day.square_invoice_id), status: inv.status, total, deposit_paid: depositPaid, balance_paid: balancePaid, public_url: inv.publicUrl || undefined });
    } catch (e) {
      console.error('Sync invoice failed:', day.square_invoice_id, e);
    }
  }

  // Deposit landing on any day promotes a New event to Booked
  const { data: ev } = await supabaseAdmin.from('events').select('status').eq('id', event_id).single();
  if (ev?.status === 'New' && invoices.some(i => i.deposit_paid > 0)) {
    await supabaseAdmin.from('events').update({ status: 'Booked' }).eq('id', event_id);
  }
  await rollupEvent(event_id);

  return NextResponse.json({ invoices });
}
