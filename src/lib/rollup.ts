import { supabaseAdmin } from './supabase-admin';

// Recomputes the event-level summary fields from its days. Each day owns its own
// estimate + Square invoice; the event rolls them up so the dashboard, badges,
// and Payments panel can keep reading event-level fields.
export async function rollupEvent(eventId: string) {
  const { data: days } = await supabaseAdmin
    .from('event_days')
    .select('estimate_total, amount_paid, deposit_paid_at, balance_paid_at, square_invoice_id, square_invoice_url, square_invoice_status, invoice_sent_at, day_type, estimate_approved_at')
    .eq('event_id', eventId);
  const ds = days || [];

  const total = ds.reduce((s, d) => s + (Number(d.estimate_total) || 0), 0);
  const paid = ds.reduce((s, d) => s + (Number(d.amount_paid) || 0), 0);
  const withInv = ds.filter(d => d.square_invoice_id);
  const allPaid = total > 0 && paid >= total - 0.01;

  let status: string | null = null;
  if (withInv.length) {
    if (allPaid) status = 'PAID';
    else if (withInv.some(d => d.square_invoice_status === 'DRAFT')) status = 'DRAFT';
    else status = 'UNPAID';
  }

  // Primary invoice (largest day) backs the dashboard badge + single "Open in Square"
  const primary = [...withInv].sort((a, b) => (Number(b.estimate_total) || 0) - (Number(a.estimate_total) || 0))[0];

  await supabaseAdmin.from('events').update({
    estimate_total: total || null,
    amount_paid: paid || null,
    deposit_paid_at: ds.find(d => d.deposit_paid_at)?.deposit_paid_at || null,
    balance_paid_at: allPaid ? (ds.find(d => d.balance_paid_at)?.balance_paid_at || new Date().toISOString()) : null,
    square_invoice_id: primary?.square_invoice_id || null,
    square_invoice_url: primary?.square_invoice_url || null,
    square_invoice_status: status,
    invoice_sent_at: ds.find(d => d.invoice_sent_at)?.invoice_sent_at || null,
    estimate_approved_at: ds.find(d => d.estimate_approved_at)?.estimate_approved_at || null,
  }).eq('id', eventId);
}
