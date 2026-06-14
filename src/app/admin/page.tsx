'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useToast } from '@/lib/toast';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  New:                { bg: '#e8f0ff', color: '#2d5a9e' },
  Booked:             { bg: '#f5efe4', color: '#785e36' },
  'Menu Development': { bg: '#fff7ed', color: '#b45309' },
  EO:                 { bg: '#f3f0ff', color: '#6d28d9' },
  Completed:          { bg: 'var(--green-lt)', color: 'var(--green)' },
  Lost:               { bg: '#f4f4f4', color: '#79715f' },
};

const PIPELINE_COLORS: Record<string, string> = {
  New: '#2d5a9e', Booked: '#785e36', 'Menu Development': '#b45309',
  EO: '#6d28d9', Completed: '#38614a', Lost: '#aaa292',
};

const BOOL_FIELDS = [
  'proposal_sent', 'follow_up_needed', 'retainer_invoice_sent', 'contract_signed',
  'questionnaire_sent', 'questionnaire_received', 'revisions_needed', 'final_menu_approved',
  'rental_pull_list_created', 'rental_quote_sent', 'rental_approved', 'rental_delivery_confirmed',
  'eo_draft_complete', 'staffing_added', 'logistics_added', 'eo_approved',
  'final_payment_received', 'final_guest_count_confirmed', 'vendor_meals_confirmed',
  'allergy_list_received', 'load_list_complete', 'staffing_roster_final', 'timeline_finalized',
  'bar_list_final', 'internal_meeting_scheduled',
  'thank_you_email_sent', 'photos_received', 'rentals_reconciled', 'staff_hours_reviewed',
  'testimonial_received', 'added_to_portfolio',
];

const STATUSES = ['New', 'Booked', 'Menu Development', 'EO', 'Completed', 'Lost'];

type Lead = Record<string, unknown>;
type Event = Record<string, unknown>;
type Stats = {
  conversionRate: number;
  activeCount: number;
  upcoming: { days: number; count: number }[];
  postEventHealth: number | null;
  pipeline: { status: string; count: number }[];
};

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  const dateStr = String(d).includes('T') ? String(d) : String(d) + 'T12:00:00';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function relDate(d: string | null | undefined): string {
  if (!d) return '';
  const dateStr = String(d).includes('T') ? String(d) : String(d) + 'T12:00:00';
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return '';
  const days = Math.round((dt.getTime() - Date.now()) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days <= 14) return `in ${days}d`;
  if (days > 14 && days <= 60) return `in ${Math.round(days / 7)}w`;
  return '';
}

function firstDay(event: Event) {
  const days = (event.event_days as Event[]) || [];
  if (!days.length) return null;
  return days.slice().sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0];
}

function moneyShort(n: number) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function totalGuests(event: Event) {
  // Only count main catering days — tastings/rehearsals shouldn't inflate headcount
  return ((event.event_days as Event[]) || []).filter(d => (d.day_type || 'Main') === 'Main').reduce((s, d) => s + (Number(d.guests) || 0), 0);
}

function rowAccent(event: Event): React.CSSProperties {
  const status = String(event.status);
  const isActive = ['New', 'Booked', 'Menu Development', 'EO'].includes(status);
  if (!isActive) return {};

  const day = firstDay(event);
  if (!day || !day.event_date) return { borderLeft: '2px solid var(--brass-lt)' };
  const dt = new Date(String(day.event_date) + 'T12:00:00');
  const daysUntil = Math.ceil((dt.getTime() - Date.now()) / 864e5);
  if (daysUntil < 0 || daysUntil > 30) return { borderLeft: '2px solid var(--brass-lt)' };
  const done = BOOL_FIELDS.filter(f => event[f] === true).length;
  if (done / BOOL_FIELDS.length >= 0.8) return { borderLeft: '2px solid var(--brass-lt)' };
  if (daysUntil <= 7) return { borderLeft: '3px solid var(--red)' };
  return { borderLeft: '3px solid #d97706' };
}

function exportCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const skip = new Set(['event_days', 'deleted_at']);
  const keys = Object.keys(data[0]).filter(k => !skip.has(k));
  const rows = [keys.join(','), ...data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
  a.download = filename; a.click();
}

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

// ── small components ─────────────────────────────────────────────────────────

function StatusBadge({ status, onClick }: { status: string; onClick?: (e: React.MouseEvent) => void }) {
  const s = STATUS_COLORS[status] || { bg: '#f4f4f4', color: '#555' };
  return (
    <span
      onClick={onClick}
      title={onClick ? 'Click to change status' : undefined}
      style={{ background: s.bg, color: s.color, borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default' }}
    >
      {status}
    </span>
  );
}

function ProgressBar({ event }: { event: Event }) {
  const done = BOOL_FIELDS.filter(f => event[f] === true).length;
  const pct = Math.round((done / BOOL_FIELDS.length) * 100);
  const color = pct === 100 ? '#38614a' : pct >= 60 ? '#97784c' : pct >= 30 ? '#b45309' : '#2d5a9e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--paper-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{done}/{BOOL_FIELDS.length}</span>
    </div>
  );
}

function DepositPaid({ event }: { event: Event }) {
  // Base paid state on actual dollars, not just whether a payment landed —
  // a partial balance payment is still "partially paid", not "PAID".
  const total = Number(event.estimate_total) || 0;
  const paid = Number(event.amount_paid) || 0;
  if (total > 0 && paid >= total - 0.01) return <PayPill label="PAID" title="Paid in full" tone="green" />;
  if (paid > 0 && total > 0) {
    const pct = Math.round((paid / total) * 100);
    return <PayPill label={`${pct}%`} title={`${pct}% paid · $${Math.round(paid).toLocaleString()} of $${Math.round(total).toLocaleString()}`} tone="brass" />;
  }
  if (paid > 0 || event.deposit_paid_at) return <PayPill label="$ ✓" title="Partially paid" tone="brass" />;
  const st = event.square_invoice_status ? String(event.square_invoice_status) : null;
  if (st === 'UNPAID' || st === 'SCHEDULED') return <PayPill label="SENT" title="Invoice sent · awaiting payment" tone="amber" />;
  if (st === 'DRAFT') return <PayPill label="DRAFT" title="Invoice draft · not sent" tone="gray" />;
  if (st === 'CANCELED') return <PayPill label="CANCELED" title="Invoice canceled" tone="gray" />;
  return null;
}

function PayPill({ label, title, tone }: { label: string; title: string; tone: 'green' | 'brass' | 'amber' | 'gray' }) {
  const c = tone === 'green' ? { color: 'var(--green)', bg: 'var(--green-lt)', bd: '#c4dccd' }
    : tone === 'brass' ? { color: 'var(--brass)', bg: 'var(--paper-2)', bd: 'var(--brass-lt)' }
    : tone === 'amber' ? { color: '#b45309', bg: '#fff7ed', bd: '#f0d8b8' }
    : { color: '#79715f', bg: '#f4f4f4', bd: 'var(--rule)' };
  return (
    <span title={title} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: c.color, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 99, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function TrashBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} title="Move to trash" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: 'var(--ink-4)', borderRadius: 'var(--r-sm)', lineHeight: 1 }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-4)')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
    </button>
  );
}

function SortTh({ label, field, sort, onToggle }: { label: string; field: string; sort: { field: string; dir: 'asc' | 'desc' }; onToggle: () => void }) {
  const active = sort.field === field;
  return (
    <th onClick={onToggle} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: active ? 'var(--brass)' : 'var(--ink-4)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--rule)', cursor: 'pointer', userSelect: 'none' }}>
      {label} {active ? (sort.dir === 'asc' ? '↑' : '↓') : <span style={{ opacity: 0.35 }}>↕</span>}
    </th>
  );
}

function PlainTh({ label }: { label: string }) {
  return <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--rule)' }}>{label}</th>;
}

function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '1.1rem 1.4rem', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, color: color || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SkeletonRows({ cols, count = 5 }: { cols: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} style={{ padding: '14px 16px' }}>
              <div className="skeleton" style={{ height: 10, width: j === 0 ? '60%' : j === 1 ? '45%' : '35%', borderRadius: 3 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <tr>
      <td colSpan={99} style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 10, opacity: 0.3 }}>{icon}</div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-3)', marginBottom: 4 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{sub}</div>}
      </td>
    </tr>
  );
}

// ── modals ───────────────────────────────────────────────────────────────────

function ConvertModal({ lead, onClose, onConverted, authFetch }: {
  lead: Lead; onClose: () => void;
  onConverted: (eventId: string) => void;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [venue, setVenue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!venue.trim()) { setError('Venue is required'); return; }
    setSaving(true); setError('');
    const clientNames = `${lead.first_name} ${lead.last_name}`.trim();
    // Carry the quote's pricing inputs into the estimate config so the consult
    // starts pre-filled from the client's submission instead of blank.
    const barPkg = lead.bar_package && lead.bar_package !== 'None' ? String(lead.bar_package) : null;
    const res = await authFetch('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        event: {
          client_names: clientNames, status: 'New',
          client_email: lead.email || null, client_phone: lead.phone || null,
          quote_id: lead.id, quote_number: lead.quote_number || null,
          estimate_guests: lead.guests ? Number(lead.guests) : null,
          estimate_style: lead.preferred_style || null,
          event_hours: lead.hours ? Number(lead.hours) : null,
          bar_package: barPkg,
          appetizer_count: Number(lead.appetizers ?? lead.appetizer_count ?? 0),
          include_dessert: !!(lead.dessert ?? lead.include_dessert),
          include_coffee: !!(lead.coffee_tea ?? lead.include_coffee),
        },
        days: [{ event_date: lead.event_date, venue: venue.trim(), guests: lead.guests, service_style: lead.preferred_style, sort_order: 0 }],
      }),
    });
    const newEvent = await res.json();
    if (!res.ok) { setError(newEvent.error || 'Failed to create event'); setSaving(false); return; }
    await authFetch('/api/admin/leads', { method: 'PATCH', body: JSON.stringify({ id: lead.id, converted: true, converted_at: new Date().toISOString() }) });
    onConverted(newEvent.id);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,20,16,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 480, padding: '2rem' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 8 }}>Convert to Event</div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, marginBottom: 4 }}>
          {String(lead.first_name)} {String(lead.last_name)}
        </h2>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: '1.5rem' }}>
          {fmt(lead.event_date ? String(lead.event_date) : null)} · {lead.guests ? `${lead.guests} guests` : ''} · {lead.preferred_style ? String(lead.preferred_style) : ''}
          {lead.bar_package ? ` · ${lead.bar_package}` : ''}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: '1.25rem' }}>
            <label>Venue <span style={{ color: 'var(--brass)' }}>*</span></label>
            <input type="text" value={venue} onChange={e => setVenue(e.target.value)} placeholder="e.g. The Ritz-Carlton, Half Moon Bay" autoFocus />
          </div>
          {error && <div style={{ background: 'var(--red-lt)', color: 'var(--red)', border: '1px solid #e2bcbc', borderRadius: 'var(--r-sm)', padding: '9px 13px', fontSize: 13, marginBottom: '1rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-brass">{saving ? 'Creating…' : 'Create Event'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddLeadModal({ onClose, onSaved, authFetch }: {
  onClose: () => void; onSaved: () => void;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    event_date: '', guests: '', hours: '5',
    preferred_style: 'Buffet', bar_package: 'None',
    appetizer_count: '0', include_dessert: false, include_coffee: false,
    notes: '', send_email: false, source: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function set(k: string, v: unknown) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.event_date || !form.guests || !form.preferred_style) {
      setError('First name, last name, event date, guests, and style are required.'); return;
    }
    if (form.send_email && !form.email) {
      setError('Email is required to send an estimate.'); return;
    }
    setSaving(true); setError('');
    const res = await authFetch('/api/admin/leads', { method: 'POST', body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Failed to save lead'); setSaving(false); return; }
    onSaved();
  }

  const row: React.CSSProperties = { display: 'flex', gap: 12 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,20,16,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 560, padding: '2rem', margin: 'auto' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 8 }}>Add Lead Manually</div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.35rem', fontWeight: 500, marginBottom: '1.25rem' }}>New Lead</h2>
        <form onSubmit={handleSubmit}>
          <div style={row}>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>First name *</label><input value={form.first_name} onChange={e => set('first_name', e.target.value)} autoFocus /></div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Last name *</label><input value={form.last_name} onChange={e => set('last_name', e.target.value)} /></div>
          </div>
          <div style={row}>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="for estimate email" /></div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Phone</label><input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          </div>
          <div style={row}>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Event date *</label><input type="date" value={form.event_date} onChange={e => set('event_date', e.target.value)} /></div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Guests *</label><input type="number" min="1" value={form.guests} onChange={e => set('guests', e.target.value)} /></div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Hours</label><input type="number" min="1" max="16" value={form.hours} onChange={e => set('hours', e.target.value)} /></div>
          </div>
          <div style={row}>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}>
              <label>Service style *</label>
              <select value={form.preferred_style} onChange={e => set('preferred_style', e.target.value)}>
                {['Buffet', 'Family Style', 'Plated'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}>
              <label>Bar</label>
              <select value={form.bar_package} onChange={e => set('bar_package', e.target.value)}>
                {['None', 'Soft Bar', 'Full Bar'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 8 }}>Add-ons</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={form.appetizer_count} onChange={e => set('appetizer_count', e.target.value)} style={{ fontSize: 12, padding: '6px 28px 6px 10px', width: 'auto' }}>
                {['0','1','2','3','4','5','6'].map(n => <option key={n} value={n}>{n === '0' ? 'No appetizers' : `${n} appetizer${n === '1' ? '' : 's'}`}</option>)}
              </select>
              {(['include_dessert', 'include_coffee'] as const).map(key => {
                const label = key === 'include_dessert' ? 'Dessert' : 'Coffee & Tea';
                const active = form[key];
                return (
                  <button key={key} type="button" onClick={() => set(key, !active)}
                    style={{ border: `1.5px solid ${active ? '#c4dccd' : 'var(--rule)'}`, background: active ? 'var(--green-lt)' : 'transparent', color: active ? 'var(--green)' : 'var(--ink-3)', borderRadius: 99, padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: active ? 600 : 400, transition: 'all 0.15s' }}>
                    {active ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={row}>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}>
              <label>Source</label>
              <select value={form.source} onChange={e => set('source', e.target.value)}>
                <option value="">— Unknown —</option>
                {['Referral', 'Instagram', 'Google', 'Venue / Planner', 'Walk-in', 'Other'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Special requests, anything relevant…" />
          </div>
          <div style={{ background: form.send_email ? 'var(--green-lt)' : 'var(--paper-2)', border: `1px solid ${form.send_email ? '#c4dccd' : 'var(--rule)'}`, borderRadius: 'var(--r-md)', padding: '12px 14px', marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.send_email} onChange={e => set('send_email', e.target.checked)} style={{ width: 15, height: 15 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Send estimate email to client</div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>Requires email address. Sends the same branded estimate email as the quote form.</div>
              </div>
            </label>
          </div>
          {error && <div style={{ background: 'var(--red-lt)', color: 'var(--red)', border: '1px solid #e2bcbc', borderRadius: 'var(--r-sm)', padding: '9px 13px', fontSize: 13, marginBottom: '1rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-brass">{saving ? 'Saving…' : 'Save Lead'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddEventModal({ onClose, onSaved, authFetch }: {
  onClose: () => void; onSaved: (eventId: string) => void;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [form, setForm] = useState({ client_names: '', status: 'New', event_date: '', venue: '', guests: '', service_style: 'Buffet', planner_name: '', planner_email: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_names || !form.event_date || !form.venue) { setError('Client name, event date, and venue are required.'); return; }
    setSaving(true); setError('');
    const res = await authFetch('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        event: { client_names: form.client_names, status: form.status, planner_name: form.planner_name || null, planner_email: form.planner_email || null },
        days: [{ event_date: form.event_date, venue: form.venue, guests: form.guests ? Number(form.guests) : null, service_style: form.service_style, sort_order: 0 }],
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Failed to create event'); setSaving(false); return; }
    onSaved(data.id);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,20,16,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: 480, padding: '2rem' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 8 }}>New Event</div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.35rem', fontWeight: 500, marginBottom: '1.25rem' }}>Add Event Directly</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 2, marginBottom: 14 }}><label>Client name *</label><input value={form.client_names} onChange={e => set('client_names', e.target.value)} autoFocus placeholder="e.g. The Johnson Family" /></div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}>
              <label>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Event date *</label><input type="date" value={form.event_date} onChange={e => set('event_date', e.target.value)} /></div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Guests</label><input type="number" min="1" value={form.guests} onChange={e => set('guests', e.target.value)} /></div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}><label>Venue *</label><input value={form.venue} onChange={e => set('venue', e.target.value)} placeholder="Venue name" /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Planner name</label><input value={form.planner_name} onChange={e => set('planner_name', e.target.value)} placeholder="Optional" /></div>
            <div className="field" style={{ flex: 1, marginBottom: 14 }}><label>Planner email</label><input type="email" value={form.planner_email} onChange={e => set('planner_email', e.target.value)} placeholder="Optional" /></div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Service style</label>
            <select value={form.service_style} onChange={e => set('service_style', e.target.value)}>
              {['Buffet', 'Family Style', 'Plated'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          {error && <div style={{ background: 'var(--red-lt)', color: 'var(--red)', border: '1px solid #e2bcbc', borderRadius: 'var(--r-sm)', padding: '9px 13px', fontSize: 13, marginBottom: '1rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-brass">{saving ? 'Creating…' : 'Create Event'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── main dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<'events' | 'leads' | 'trash'>(() => lsGet('apf-tab', 'events' as 'events'));
  const [statusFilter, setStatusFilter] = useState<string>(() => lsGet('apf-status-filter-v2', 'Active'));
  const [eventSort, setEventSort] = useState<{ field: 'event_date' | 'created_at'; dir: 'asc' | 'desc' }>(() => lsGet('apf-event-sort', { field: 'created_at', dir: 'desc' }));
  const [leadSort, setLeadSort] = useState<{ field: 'event_date' | 'created_at'; dir: 'asc' | 'desc' }>(() => lsGet('apf-lead-sort', { field: 'created_at', dir: 'desc' }));

  const [events, setEvents] = useState<Event[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [lostLeads, setLostLeads] = useState<Lead[]>([]);
  const [trash, setTrash] = useState<{ leads: Lead[]; events: Event[] }>({ leads: [], events: [] });
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [leadFilter, setLeadFilter] = useState<'active' | 'lost'>('active');
  const [alertDismissed, setAlertDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('apf-alert-dismissed') === '1';
  });

  const [search, setSearch] = useState('');
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [addingLead, setAddingLead] = useState(false);
  const [addingEvent, setAddingEvent] = useState(false);
  const [compact, setCompact] = useState<boolean>(() => lsGet('apf-compact', false));
  const [resending, setResending] = useState<string | null>(null);

  // Persist UI state to localStorage
  useEffect(() => { localStorage.setItem('apf-compact', JSON.stringify(compact)); }, [compact]);
  useEffect(() => { localStorage.setItem('apf-tab', JSON.stringify(tab)); }, [tab]);
  useEffect(() => { localStorage.setItem('apf-status-filter-v2', JSON.stringify(statusFilter)); }, [statusFilter]);
  useEffect(() => { localStorage.setItem('apf-event-sort', JSON.stringify(eventSort)); }, [eventSort]);
  useEffect(() => { localStorage.setItem('apf-lead-sort', JSON.stringify(leadSort)); }, [leadSort]);
  useEffect(() => { document.title = 'Dashboard | APF Admin'; }, []);

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...opts?.headers } });
  }, []);

  async function reload() {
    const [evRes, leRes, stRes, trRes, lostRes] = await Promise.all([
      authFetch('/api/admin/events'),
      authFetch('/api/admin/leads'),
      authFetch('/api/admin/stats'),
      authFetch('/api/admin/trash'),
      authFetch('/api/admin/leads?lost=true'),
    ]);
    const [evData, leData, stData, trData, lostData] = await Promise.all([evRes.json(), leRes.json(), stRes.json(), trRes.json(), lostRes.json()]);
    setEvents(Array.isArray(evData) ? evData : []);
    setLeads(Array.isArray(leData) ? leData : []);
    setLostLeads(Array.isArray(lostData) ? lostData : []);
    setStats(stData);
    setTrash({ leads: trData.leads || [], events: trData.events || [] });
  }

  useEffect(() => { reload().then(() => setLoading(false)); }, []); // eslint-disable-line

  async function softDelete(type: 'lead' | 'event', id: string) {
    await authFetch('/api/admin/trash', { method: 'PATCH', body: JSON.stringify({ type, id, action: 'trash' }) });
    toast(`Moved to trash`);
    reload();
  }

  async function restore(type: 'lead' | 'event', id: string) {
    await authFetch('/api/admin/trash', { method: 'PATCH', body: JSON.stringify({ type, id, action: 'restore' }) });
    toast('Restored');
    reload();
  }

  async function purge(type: 'lead' | 'event', id: string) {
    if (!confirm('Permanently delete? This cannot be undone.')) return;
    await authFetch('/api/admin/trash', { method: 'DELETE', body: JSON.stringify({ type, id }) });
    toast('Deleted permanently', 'info');
    reload();
  }

  async function saveStatus(eventId: string, status: string) {
    await authFetch(`/api/admin/events/${eventId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast('Status updated');
    reload();
  }

  async function markLeadLost(id: string) {
    if (!confirm('Mark this lead as lost? It will be removed from the active leads list but kept in analytics.')) return;
    await authFetch('/api/admin/leads', { method: 'PATCH', body: JSON.stringify({ id, lead_status: 'lost' }) });
    toast('Lead marked as lost', 'info');
    reload();
  }

  async function resendEstimate(lead: Lead) {
    if (!lead.email) { toast('No email address on this lead', 'error'); return; }
    if (!confirm(`Resend estimate to ${String(lead.email)}?`)) return;
    setResending(String(lead.id));
    const res = await authFetch('/api/admin/leads/resend', { method: 'POST', body: JSON.stringify({ id: lead.id }) });
    setResending(null);
    if (res.ok) { toast('Estimate resent'); } else { toast('Failed to resend estimate', 'error'); }
  }

  async function restoreLeadActive(id: string) {
    await authFetch('/api/admin/leads', { method: 'PATCH', body: JSON.stringify({ id, lead_status: 'active' }) });
    toast('Lead restored to active');
    reload();
  }

  function toggleEventSort(field: 'event_date' | 'created_at') {
    setEventSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }
  function toggleLeadSort(field: 'event_date' | 'created_at') {
    setLeadSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }

  const alertEvents = events.filter(e => {
    const day = firstDay(e);
    if (!day || !day.event_date) return false;
    const dt = new Date(String(day.event_date) + 'T12:00:00');
    const daysUntil = Math.ceil((dt.getTime() - Date.now()) / 864e5);
    if (daysUntil < 0 || daysUntil > 14) return false;
    const done = BOOL_FIELDS.filter(f => e[f] === true).length;
    return done / BOOL_FIELDS.length < 0.8;
  });

  const q = search.toLowerCase();

  const filteredEvents = (
    statusFilter === 'All' ? events
    : statusFilter === 'Active' ? events.filter(e => !['Completed', 'Lost'].includes(String(e.status)))
    : events.filter(e => e.status === statusFilter)
  )
    .filter(e => !q || String(e.client_names).toLowerCase().includes(q) || String(e.quote_number || '').toLowerCase().includes(q) || ((e.event_days as Event[]) || []).some(d => String(d.venue).toLowerCase().includes(q)))
    .slice().sort((a, b) => {
      let av: string, bv: string;
      if (eventSort.field === 'event_date') {
        const ad = ((a.event_days as Event[]) || []).sort((x, y) => String(x.event_date).localeCompare(String(y.event_date)))[0];
        const bd = ((b.event_days as Event[]) || []).sort((x, y) => String(x.event_date).localeCompare(String(y.event_date)))[0];
        av = ad ? String(ad.event_date) : '9999'; bv = bd ? String(bd.event_date) : '9999';
      } else {
        av = String(a.created_at || ''); bv = String(b.created_at || '');
      }
      return eventSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const sortedLeads = leads
    .filter(l => !q || `${l.first_name} ${l.last_name}`.toLowerCase().includes(q) || String(l.email).toLowerCase().includes(q) || String(l.quote_number || '').toLowerCase().includes(q))
    .slice().sort((a, b) => {
      const av = String(leadSort.field === 'event_date' ? (a.event_date || '9999') : (a.created_at || ''));
      const bv = String(leadSort.field === 'event_date' ? (b.event_date || '9999') : (b.created_at || ''));
      return leadSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const trashCount = trash.leads.length + trash.events.length;
  const statuses = ['Active', 'All', ...STATUSES];

  return (
    <div>
      {/* Modals */}
      {addingLead && <AddLeadModal authFetch={authFetch} onClose={() => setAddingLead(false)} onSaved={() => { setAddingLead(false); toast('Lead added'); reload(); }} />}
      {addingEvent && <AddEventModal authFetch={authFetch} onClose={() => setAddingEvent(false)} onSaved={id => { setAddingEvent(false); toast('Event created'); reload().then(() => router.push(`/admin/events/${id}`)); }} />}
      {converting && (
        <ConvertModal
          lead={converting} authFetch={authFetch}
          onClose={() => setConverting(null)}
          onConverted={id => { setConverting(null); toast('Lead converted to event!'); reload().then(() => { setTab('events'); router.push(`/admin/events/${id}`); }); }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.75rem', fontWeight: 500 }}>Dashboard</h1>
        <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{events.length} events · {leads.length} leads</div>
      </div>

      {/* Pipeline bar */}
      {stats && (
        <>
          <div className="card" style={{ padding: '1rem 1.4rem', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 10 }}>Pipeline</div>
            <div style={{ display: 'flex', gap: 2, height: 22, borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
              {stats.pipeline.filter(p => p.count > 0).map(p => {
                const total = stats.pipeline.reduce((s, x) => s + x.count, 0);
                const pct = p.count / total;
                return (
                  <div key={p.status} style={{ flex: p.count, background: PIPELINE_COLORS[p.status], minWidth: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={`${p.status}: ${p.count}`}>
                    {pct > 0.1 && <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: 700 }}>{p.count}</span>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {stats.pipeline.map(p => (
                <div key={p.status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: PIPELINE_COLORS[p.status], flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: p.count > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>{p.status} <strong>{p.count}</strong></span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Upcoming alert strip */}
      {alertEvents.length > 0 && !alertDismissed && (
        <div className="no-print" style={{ background: '#fff8ed', border: '1px solid #d97706', borderRadius: 'var(--r-md)', padding: '10px 16px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
          <div style={{ flex: 1, fontSize: 13, color: '#92400e' }}>
            <strong>{alertEvents.length} event{alertEvents.length > 1 ? 's' : ''}</strong> within 14 days with incomplete checklists:{' '}
            {alertEvents.map((e, i) => (
              <span key={String(e.id)}>
                <a href={`/admin/events/${e.id}`} style={{ color: '#92400e', fontWeight: 600 }}>{String(e.client_names)}</a>
                {i < alertEvents.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
          <button onClick={() => { setAlertDismissed(true); sessionStorage.setItem('apf-alert-dismissed', '1'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: 18, lineHeight: 1, flexShrink: 0, fontFamily: 'var(--sans)' }}>×</button>
        </div>
      )}

      {/* Search + tabs */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340 }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-4)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="search"
            placeholder="Search clients, venues, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32, fontSize: 13, height: 36, width: '100%' }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setCompact(c => !c)} className="compact-btn-desktop" title="Tighten table rows and hide secondary columns" style={{ background: compact ? 'var(--paper-2)' : 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: compact ? 'var(--ink-2)' : 'var(--ink-4)', fontFamily: 'var(--sans)', whiteSpace: 'nowrap' }}>
          {compact ? 'Compact ✓' : 'Compact'}
        </button>
        <style>{`.compact-btn-desktop { display: inline-flex; } @media (max-width: 640px) { .compact-btn-desktop { display: none !important; } }`}</style>
      </div>

      {/* Responsive table↔cards toggle — global so it applies on every tab */}
      <style>{`.event-table-wrap { display: block; } .event-cards-wrap { display: none; } @media (max-width: 640px) { .event-table-wrap { display: none; } .event-cards-wrap { display: block; } }`}</style>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, borderBottom: '1px solid var(--rule)', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {(['events', 'leads', 'trash'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: tab === t ? 'var(--paper-2)' : 'transparent',
              border: '1px solid', borderColor: tab === t ? 'var(--rule)' : 'transparent', borderBottom: 'none',
              borderRadius: '8px 8px 0 0',
              padding: '9px 20px', fontSize: 13, fontWeight: tab === t ? 700 : 500,
              color: tab === t ? 'var(--brass)' : 'var(--ink-2)', cursor: 'pointer', fontFamily: 'var(--sans)',
              marginBottom: -1, letterSpacing: '0.04em',
              boxShadow: tab === t ? 'inset 0 -2px 0 var(--brass)' : 'none',
              transition: 'color 0.12s, background 0.12s',
            }}
            onMouseEnter={e => { if (tab !== t) e.currentTarget.style.color = 'var(--brass)'; }}
            onMouseLeave={e => { if (tab !== t) e.currentTarget.style.color = 'var(--ink-2)'; }}>
            {t === 'events' ? `Events (${events.length})` : t === 'leads' ? `Leads (${leads.length})` : `Trash${trashCount > 0 ? ` (${trashCount})` : ''}`}
          </button>
        ))}
        <div className="tab-spacer" style={{ flex: 1, minWidth: 12 }} />
        <div className="tab-add-group" style={{ display: 'flex', gap: 8, paddingBottom: 7 }}>
          <button onClick={() => setAddingLead(true)} style={{ fontSize: 12, padding: '7px 16px', whiteSpace: 'nowrap', background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'var(--sans)', fontWeight: 500 }}>
            + Add Lead
          </button>
          <button onClick={() => setAddingEvent(true)} className="btn btn-brass" style={{ fontSize: 12, padding: '7px 16px', whiteSpace: 'nowrap' }}>
            + Add Event
          </button>
        </div>
        <style>{`@media (max-width: 640px) {
          .tab-spacer { display: none !important; }
          .tab-add-group { width: 100%; padding-bottom: 0 !important; margin-top: 10px; }
          .tab-add-group button { flex: 1; padding: 9px 16px !important; }
        }`}</style>
      </div>

      {/* Events tab */}
      {tab === 'events' && (
        <>
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {statuses.map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} style={{ border: '1.5px solid', borderColor: statusFilter === s ? 'var(--brass)' : 'var(--rule)', background: statusFilter === s ? 'var(--brass)' : 'transparent', color: statusFilter === s ? '#fff' : 'var(--ink-3)', borderRadius: 99, padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          {/* Mobile cards */}
          <div className="event-cards-wrap">
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3].map(i => <div key={i} className="card skeleton" style={{ height: 110 }} />)}
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="card" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 10, opacity: 0.3 }}>✦</div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-3)' }}>{search ? 'No events match your search' : statusFilter !== 'All' ? `No ${statusFilter} events` : 'No events yet'}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredEvents.map(event => {
                  const day = firstDay(event);
                  const dayDate = day ? String(day.event_date) : null;
                  const rel = relDate(dayDate);
                  const accent = rowAccent(event);
                  const done = BOOL_FIELDS.filter(f => event[f] === true).length;
                  const pct = Math.round((done / BOOL_FIELDS.length) * 100);
                  const barColor = pct === 100 ? '#38614a' : pct >= 60 ? '#97784c' : pct >= 30 ? '#b45309' : '#2d5a9e';
                  return (
                    <div key={String(event.id)}
                      onClick={() => router.push(`/admin/events/${event.id}`)}
                      className="card"
                      style={{ padding: '12px 14px', cursor: 'pointer', animation: 'rowIn 0.15s ease', ...accent }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--ink)' }}>{String(event.client_names)}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <DepositPaid event={event} />
                          <StatusBadge status={String(event.status)} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{fmt(dayDate)}</span>
                        {rel && <span style={{ fontSize: 10, color: 'var(--brass)', background: 'var(--paper-2)', borderRadius: 99, padding: '1px 8px', fontWeight: 600 }}>{rel}</span>}
                      </div>
                      {day && <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 8 }}>{String(day.venue || '—')} · {totalGuests(event) || '—'} guests · {String(day.service_style || '—')}</div>}
                      {!!event.square_invoice_id && !!event.estimate_total && (() => {
                        const bal = Math.round(((Number(event.estimate_total)||0) - (Number(event.amount_paid)||0)) * 100) / 100;
                        return <div style={{ fontSize: 12, marginBottom: 8 }}><span style={{ color: 'var(--green)' }}>{moneyShort(Number(event.amount_paid)||0)} paid</span><span style={{ color: 'var(--ink-4)' }}> · </span><span style={{ color: bal > 0 ? 'var(--brass)' : 'var(--green)', fontWeight: 600 }}>{moneyShort(bal)} balance</span></div>;
                      })()}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--paper-3)' }}>
                        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{done}/{BOOL_FIELDS.length} checklist</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, height: 4, background: 'var(--paper-3)', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 99 }} />
                          </div>
                          <TrashBtn onClick={e => { e.stopPropagation(); softDelete('event', String(event.id)); }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="event-table-wrap card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--paper)' }}>
                  <PlainTh label="Client" />
                  <SortTh label="Event Date" field="event_date" sort={eventSort} onToggle={() => toggleEventSort('event_date')} />
                  {!compact && <PlainTh label="Venue" />}
                  <PlainTh label="Guests" />
                  <PlainTh label="Style" />
                  <PlainTh label="Status" />
                  <PlainTh label="Balance" />
                  <PlainTh label="Checklist" />
                  {!compact && <SortTh label="Submitted" field="created_at" sort={eventSort} onToggle={() => toggleEventSort('created_at')} />}
                  <PlainTh label="" />
                </tr>
              </thead>
              <tbody key={`events-${statusFilter}-${q}`}>
                {loading ? <SkeletonRows cols={10} /> : filteredEvents.length === 0 ? (
                  <EmptyState icon="✦" title={search ? 'No events match your search' : statusFilter !== 'All' ? `No ${statusFilter} events` : 'No events yet'} sub={search ? 'Try a different search term' : statusFilter !== 'All' ? 'Try a different status filter' : 'Events appear here once a lead is converted'} />
                ) : filteredEvents.map((event) => {
                  const day = firstDay(event);
                  const dayDate = day ? String(day.event_date) : null;
                  const rel = relDate(dayDate);
                  const accent = rowAccent(event);
                  return (
                    <tr key={String(event.id)} onClick={() => router.push(`/admin/events/${event.id}`)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--paper-3)', transition: 'background 0.12s', animation: 'rowIn 0.15s ease', ...accent }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: compact ? '5px 10px' : '12px 16px', fontWeight: 500, color: 'var(--ink)', fontSize: compact ? 12 : 'inherit' }}>{String(event.client_names)}</td>
                      <td style={{ padding: compact ? '5px 10px' : '12px 16px', color: 'var(--ink-2)', whiteSpace: 'nowrap', fontSize: compact ? 12 : 'inherit' }}>
                        {fmt(dayDate)}
                        {rel && <span style={{ fontSize: 10, color: 'var(--brass)', marginLeft: 6, fontWeight: 500 }}>{rel}</span>}
                      </td>
                      {!compact && <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{day?.venue ? String(day.venue) : '—'}</td>}
                      <td style={{ padding: compact ? '5px 10px' : '12px 16px', color: 'var(--ink-2)', textAlign: 'right', fontSize: compact ? 12 : 'inherit' }}>{totalGuests(event) || '—'}</td>
                      <td style={{ padding: compact ? '5px 10px' : '12px 16px', color: 'var(--ink-3)', fontSize: compact ? 12 : 'inherit' }}>{day?.service_style ? String(day.service_style) : '—'}</td>
                      <td style={{ padding: compact ? '5px 10px' : '12px 16px' }} onClick={e => e.stopPropagation()}>
                        {editingStatusId === String(event.id) ? (
                          <select autoFocus defaultValue={String(event.status)}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => { const s = e.target.value; setEditingStatusId(null); await saveStatus(String(event.id), s); }}
                            onBlur={() => setEditingStatusId(null)}
                            style={{ fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600, padding: '3px 24px 3px 8px', borderRadius: 99, border: '1px solid var(--rule)', background: 'var(--paper)', cursor: 'pointer', letterSpacing: '0.05em' }}>
                            {STATUSES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <StatusBadge status={String(event.status)} onClick={e => { e.stopPropagation(); setEditingStatusId(String(event.id)); }} />
                            <DepositPaid event={event} />
                          </div>
                        )}
                      </td>
                      <td style={{ padding: compact ? '5px 10px' : '12px 16px', whiteSpace: 'nowrap', fontSize: compact ? 12 : 13 }}>
                        {(() => {
                          if (!event.square_invoice_id || !event.estimate_total) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
                          const bal = Math.round(((Number(event.estimate_total)||0) - (Number(event.amount_paid)||0)) * 100) / 100;
                          return <span style={{ color: bal > 0 ? 'var(--brass)' : 'var(--green)', fontWeight: 600 }} title={`${moneyShort(Number(event.amount_paid)||0)} paid of ${moneyShort(Number(event.estimate_total)||0)}`}>{bal > 0 ? moneyShort(bal) : 'Paid'}</span>;
                        })()}
                      </td>
                      <td style={{ padding: compact ? '5px 10px' : '12px 16px' }}><ProgressBar event={event} /></td>
                      {!compact && <td style={{ padding: '12px 16px', color: 'var(--ink-4)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmt(event.created_at ? String(event.created_at) : null)}</td>}
                      <td style={{ padding: compact ? '5px 6px' : '12px 8px' }}>
                        <TrashBtn onClick={e => { e.stopPropagation(); softDelete('event', String(event.id)); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!loading && filteredEvents.length > 0 && (
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button onClick={() => exportCSV(filteredEvents.map(e => { const d = firstDay(e); return { client_names: e.client_names, event_date: d?.event_date, venue: d?.venue, guests: totalGuests(e), status: e.status, submitted: e.created_at }; }), 'apf-events.csv')}
                style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-4)', fontFamily: 'var(--sans)' }}>
                Export CSV
              </button>
            </div>
          )}
        </>
      )}

      {/* Leads tab */}
      {tab === 'leads' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem', flexWrap: 'wrap' }}>
            {/* Active / Lost toggle */}
            <div style={{ display: 'flex', border: '1px solid var(--rule)', borderRadius: 99, padding: 3, gap: 2 }}>
              {(['active', 'lost'] as const).map(f => (
                <button key={f} onClick={() => setLeadFilter(f)} style={{ borderRadius: 99, padding: '4px 14px', fontSize: 12, border: 'none', background: leadFilter === f ? (f === 'lost' ? 'var(--ink-3)' : 'var(--brass)') : 'transparent', color: leadFilter === f ? '#fff' : 'var(--ink-3)', cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: leadFilter === f ? 600 : 400 }}>
                  {f === 'active' ? `Active (${leads.length})` : `Lost (${lostLeads.length})`}
                </button>
              ))}
            </div>
          </div>
          {/* Mobile lead cards */}
          <div className="event-cards-wrap">
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3].map(i => <div key={i} className="card skeleton" style={{ height: 110 }} />)}
              </div>
            ) : (() => {
              const displayLeads = leadFilter === 'lost' ? lostLeads : sortedLeads;
              if (displayLeads.length === 0) return (
                <div className="card" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: 24, marginBottom: 10, opacity: 0.3 }}>✦</div>
                  <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-3)' }}>
                    {search ? 'No leads match your search' : leadFilter === 'lost' ? 'No lost leads' : 'No unconverted leads'}
                  </div>
                </div>
              );
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {displayLeads.map(lead => {
                    const rel = relDate(lead.event_date ? String(lead.event_date) : null);
                    return (
                      <div key={String(lead.id)} className="card" style={{ padding: '12px 14px', animation: 'rowIn 0.15s ease' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                          <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', fontWeight: 500 }}>{`${lead.first_name} ${lead.last_name}`}</div>
                          <TrashBtn onClick={() => softDelete('lead', String(lead.id))} />
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                          {!!lead.email && <a href={`mailto:${String(lead.email)}`} style={{ fontSize: 12, color: 'var(--brass)', textDecoration: 'none' }}>{String(lead.email)}</a>}
                          {!!lead.phone && <a href={`tel:${String(lead.phone)}`} style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none' }}>{String(lead.phone)}</a>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{fmt(lead.event_date ? String(lead.event_date) : null)}</span>
                          {rel && <span style={{ fontSize: 10, color: 'var(--brass)', background: 'var(--paper-2)', borderRadius: 99, padding: '1px 8px', fontWeight: 600 }}>{rel}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 10 }}>
                          {[lead.guests && `${lead.guests} guests`, lead.preferred_style, lead.bar_package && lead.bar_package !== 'None' && String(lead.bar_package)].filter(Boolean).join(' · ')}
                        </div>
                        <div style={{ borderTop: '1px solid var(--paper-3)', paddingTop: 10, display: 'flex', gap: 8 }}>
                          {leadFilter === 'active' ? (
                            <>
                              <button onClick={() => setConverting(lead)} style={{ flex: 1, background: 'var(--brass)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
                                Convert →
                              </button>
                              {!!lead.email && (
                                <button onClick={() => resendEstimate(lead)} disabled={resending === String(lead.id)} style={{ flex: 1, background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
                                  {resending === String(lead.id) ? '…' : 'Resend'}
                                </button>
                              )}
                              <button onClick={() => markLeadLost(String(lead.id))} style={{ flex: 1, background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-4)', fontFamily: 'var(--sans)' }}>
                                Lost
                              </button>
                            </>
                          ) : (
                            <button onClick={() => restoreLeadActive(String(lead.id))} style={{ flex: 1, background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px', fontSize: 12, fontWeight: 500, cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}>
                              Restore
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Desktop lead table */}
          <div className="event-table-wrap card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--paper)' }}>
                  <PlainTh label="Name" />
                  <PlainTh label="Email" />
                  {!compact && <PlainTh label="Phone" />}
                  <SortTh label="Event Date" field="event_date" sort={leadSort} onToggle={() => toggleLeadSort('event_date')} />
                  <PlainTh label="Guests" />
                  <PlainTh label="Style" />
                  {!compact && <PlainTh label="Bar" />}
                  {!compact && <SortTh label="Submitted" field="created_at" sort={leadSort} onToggle={() => toggleLeadSort('created_at')} />}
                  <PlainTh label="" />
                  <PlainTh label="" />
                </tr>
              </thead>
              <tbody key={`leads-${leadFilter}-${q}`}>
                {loading ? <SkeletonRows cols={10} /> : (() => {
                  const displayLeads = leadFilter === 'lost' ? lostLeads : sortedLeads;
                  if (displayLeads.length === 0) return (
                    <EmptyState icon="✦"
                      title={search ? 'No leads match your search' : leadFilter === 'lost' ? 'No lost leads' : 'No unconverted leads'}
                      sub={search ? 'Try a different search term' : leadFilter === 'lost' ? 'Leads you mark as lost will appear here' : 'New quote form submissions appear here'}
                    />
                  );
                  return displayLeads.map((lead) => {
                    const rel = relDate(lead.event_date ? String(lead.event_date) : null);
                    return (
                      <tr key={String(lead.id)} style={{ borderBottom: '1px solid var(--paper-3)', animation: 'rowIn 0.15s ease' }}>
                        <td style={{ padding: compact ? '5px 10px' : '12px 16px', fontWeight: 500, fontSize: compact ? 12 : 'inherit' }}>{`${lead.first_name} ${lead.last_name}`}</td>
                        <td style={{ padding: compact ? '5px 10px' : '12px 16px', color: 'var(--ink-3)', fontSize: compact ? 12 : 'inherit' }}>{String(lead.email || '—')}</td>
                        {!compact && <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{String(lead.phone || '—')}</td>}
                        <td style={{ padding: compact ? '5px 10px' : '12px 16px', color: 'var(--ink-2)', whiteSpace: 'nowrap', fontSize: compact ? 12 : 'inherit' }}>
                          {fmt(lead.event_date ? String(lead.event_date) : null)}
                          {rel && <span style={{ fontSize: 10, color: 'var(--brass)', marginLeft: 6, fontWeight: 500 }}>{rel}</span>}
                        </td>
                        <td style={{ padding: compact ? '5px 10px' : '12px 16px', color: 'var(--ink-2)', textAlign: 'right', fontSize: compact ? 12 : 'inherit' }}>{lead.guests ? String(lead.guests) : '—'}</td>
                        <td style={{ padding: compact ? '5px 10px' : '12px 16px', color: 'var(--ink-3)', fontSize: compact ? 12 : 'inherit' }}>{lead.preferred_style ? String(lead.preferred_style) : '—'}</td>
                        {!compact && <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{lead.bar_package ? String(lead.bar_package) : '—'}</td>}
                        {!compact && <td style={{ padding: '12px 16px', color: 'var(--ink-4)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmt(lead.created_at ? String(lead.created_at) : null)}</td>}
                        <td style={{ padding: compact ? '5px 8px' : '12px 16px' }}>
                          {leadFilter === 'active' ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
                              <button onClick={() => setConverting(lead)} style={{ background: 'var(--brass)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--sans)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                Convert →
                              </button>
                              {!!lead.email && (
                                <button onClick={() => resendEstimate(lead)} disabled={resending === String(lead.id)} title="Resend estimate email" style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '5px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', whiteSpace: 'nowrap' }}>
                                  {resending === String(lead.id) ? '…' : 'Resend'}
                                </button>
                              )}
                              <button onClick={() => markLeadLost(String(lead.id))} title="Mark as lost" style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '5px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-4)', fontFamily: 'var(--sans)' }}>
                                Lost
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => restoreLeadActive(String(lead.id))} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 11, fontWeight: 500, cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}>
                              Restore
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '12px 8px' }}>
                          <TrashBtn onClick={() => softDelete('lead', String(lead.id))} />
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
          {!loading && (leadFilter === 'active' ? sortedLeads : lostLeads).length > 0 && (
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button onClick={() => exportCSV((leadFilter === 'active' ? sortedLeads : lostLeads) as Record<string, unknown>[], `apf-leads-${leadFilter}.csv`)}
                style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-4)', fontFamily: 'var(--sans)' }}>
                Export CSV
              </button>
            </div>
          )}
        </>
      )}

      {/* Trash tab */}
      {tab === 'trash' && (
        <div>
          {trashCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <div style={{ fontSize: 24, marginBottom: 10, opacity: 0.3 }}>🗑</div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-3)', marginBottom: 4 }}>Trash is empty</div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>Items you delete will appear here for 30 days before being purged</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: '1rem' }}>
                Items are permanently deleted after 30 days. Restore anything moved here by mistake.
              </div>
              {trash.events.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>Events</div>
                  <div className="card" style={{ overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {trash.events.map(event => {
                          const day = firstDay(event);
                          return (
                            <tr key={String(event.id)} style={{ borderBottom: '1px solid var(--paper-3)' }}>
                              <td style={{ padding: compact ? '5px 12px' : '12px 16px', fontWeight: 500, color: 'var(--ink-3)', fontSize: compact ? 12 : 'inherit' }}>{String(event.client_names)}</td>
                              <td style={{ padding: compact ? '5px 12px' : '12px 16px', color: 'var(--ink-4)', fontSize: compact ? 12 : 13 }}>{fmt(day ? String(day.event_date) : null)}</td>
                              {!compact && <td style={{ padding: '12px 16px', color: 'var(--ink-4)', fontSize: 12 }}>Deleted {fmt(String(event.deleted_at))}</td>}
                              <td style={{ padding: compact ? '5px 12px' : '12px 16px', textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                  <button onClick={() => restore('event', String(event.id))} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}>Restore</button>
                                  <button onClick={() => purge('event', String(event.id))} style={{ background: 'none', border: '1px solid #e2bcbc', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--red)', fontFamily: 'var(--sans)' }}>Delete forever</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {trash.leads.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>Leads</div>
                  <div className="card" style={{ overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {trash.leads.map(lead => (
                          <tr key={String(lead.id)} style={{ borderBottom: '1px solid var(--paper-3)' }}>
                            <td style={{ padding: compact ? '5px 12px' : '12px 16px', fontWeight: 500, color: 'var(--ink-3)', fontSize: compact ? 12 : 'inherit' }}>{`${lead.first_name} ${lead.last_name}`}</td>
                            <td style={{ padding: compact ? '5px 12px' : '12px 16px', color: 'var(--ink-4)', fontSize: compact ? 12 : 13 }}>{String(lead.email || '—')}</td>
                            {!compact && <td style={{ padding: '12px 16px', color: 'var(--ink-4)', fontSize: 12 }}>Deleted {fmt(String(lead.deleted_at))}</td>}
                            <td style={{ padding: compact ? '5px 12px' : '12px 16px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                <button onClick={() => restore('lead', String(lead.id))} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}>Restore</button>
                                <button onClick={() => purge('lead', String(lead.id))} style={{ background: 'none', border: '1px solid #e2bcbc', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--red)', fontFamily: 'var(--sans)' }}>Delete forever</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
