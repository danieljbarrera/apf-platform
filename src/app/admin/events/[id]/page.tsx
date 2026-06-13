'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

const STATUSES = ['New', 'Booked', 'Menu Development', 'EO', 'Completed', 'Lost'];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  New:                { bg: '#e8f0ff', color: '#2d5a9e' },
  Booked:             { bg: '#f5efe4', color: '#785e36' },
  'Menu Development': { bg: '#fff7ed', color: '#b45309' },
  EO:                 { bg: '#f3f0ff', color: '#6d28d9' },
  Completed:          { bg: 'var(--green-lt)', color: 'var(--green)' },
  Lost:               { bg: '#f4f4f4', color: '#79715f' },
};

type Event = Record<string, unknown>;

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

const PHASES = [
  {
    title: 'Booking',
    fields: [
      { key: 'proposal_sent', label: 'Proposal sent', type: 'bool' },
      { key: 'proposal_sent_date', label: 'Proposal sent date', type: 'date' },
      { key: 'follow_up_needed', label: 'Follow-up needed', type: 'bool' },
      { key: 'retainer_invoice_sent', label: 'Retainer invoice sent', type: 'bool' },
      { key: 'retainer_paid', label: 'Retainer paid', type: 'select', options: ['', 'yes', 'partial', 'no'] },
      { key: 'retainer_paid_date', label: 'Retainer paid date', type: 'date' },
      { key: 'contract_signed', label: 'Contract signed', type: 'bool' },
    ],
  },
  {
    title: 'Planning',
    fields: [
      { key: 'questionnaire_sent', label: 'Questionnaire sent', type: 'bool' },
      { key: 'questionnaire_received', label: 'Questionnaire received', type: 'bool' },
      { key: 'tasting_required', label: 'Tasting required', type: 'select', options: ['', 'yes', 'no', 'N/A'] },
      { key: 'tasting_scheduled_date', label: 'Tasting date', type: 'date' },
      { key: 'draft_menu_sent_date', label: 'Draft menu sent', type: 'date' },
      { key: 'revisions_needed', label: 'Revisions needed', type: 'bool' },
      { key: 'final_menu_approved', label: 'Final menu approved', type: 'bool' },
    ],
  },
  {
    title: 'Rentals',
    fields: [
      { key: 'rental_pull_list_created', label: 'Pull list created', type: 'bool' },
      { key: 'rental_quote_sent', label: 'Quote sent', type: 'bool' },
      { key: 'rental_approved', label: 'Approved', type: 'bool' },
      { key: 'rental_delivery_confirmed', label: 'Delivery/will-call confirmed', type: 'bool' },
    ],
  },
  {
    title: 'Event Order',
    fields: [
      { key: 'eo_draft_complete', label: 'EO draft complete', type: 'bool' },
      { key: 'staffing_added', label: 'Staffing added', type: 'bool' },
      { key: 'logistics_added', label: 'Logistics added', type: 'bool' },
      { key: 'final_eo_sent_date', label: 'Final EO sent', type: 'date' },
      { key: 'eo_approved', label: 'EO approved', type: 'bool' },
    ],
  },
  {
    title: 'Pre-Event',
    fields: [
      { key: 'final_invoice_sent_date', label: 'Final invoice sent', type: 'date' },
      { key: 'final_payment_received', label: 'Final payment received', type: 'bool' },
      { key: 'final_payment_received_date', label: 'Final payment date', type: 'date' },
      { key: 'final_guest_count_confirmed', label: 'Final guest count confirmed', type: 'bool' },
      { key: 'vendor_meals_confirmed', label: 'Vendor meals confirmed', type: 'bool' },
      { key: 'allergy_list_received', label: 'Allergy list received', type: 'bool' },
      { key: 'load_list_complete', label: 'Load list complete', type: 'bool' },
      { key: 'staffing_roster_final', label: 'Staffing roster final', type: 'bool' },
      { key: 'timeline_finalized', label: 'Timeline finalized', type: 'bool' },
      { key: 'bar_list_final', label: 'Bar list final', type: 'bool' },
      { key: 'internal_meeting_scheduled', label: 'Internal event meeting scheduled', type: 'bool' },
      { key: 'captain_assigned', label: 'Captain assigned', type: 'text' },
    ],
  },
  {
    title: 'Post-Event',
    fields: [
      { key: 'thank_you_email_sent', label: 'Thank you email sent', type: 'bool' },
      { key: 'photos_received', label: 'Photos received', type: 'bool' },
      { key: 'rentals_reconciled', label: 'Rentals reconciled', type: 'bool' },
      { key: 'staff_hours_reviewed', label: 'Staff hours reviewed', type: 'bool' },
      { key: 'testimonial_received', label: 'Testimonial received', type: 'bool' },
      { key: 'added_to_portfolio', label: 'Added to portfolio', type: 'bool' },
    ],
  },
];

const SEGMENT_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  yes:     { bg: 'var(--green)',    color: '#fff',            border: 'var(--green)' },
  partial: { bg: '#d97706',         color: '#fff',            border: '#d97706' },
  no:      { bg: '#7c3030',         color: '#fff',            border: '#7c3030' },
  'N/A':   { bg: 'var(--ink-3)',    color: '#fff',            border: 'var(--ink-3)' },
};

function SegmentedSelect({ value, options, label, onChange }: {
  value: string; options: string[]; label: string;
  onChange: (v: string) => void;
}) {
  const displayOptions = options.filter(o => o !== '');
  const active = SEGMENT_COLORS[value] || null;
  return (
    <div className="field-row-side" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px' }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', borderRadius: 99, overflow: 'hidden', border: '1px solid var(--rule)', flexShrink: 0 }}>
        {displayOptions.map(opt => {
          const isActive = value === opt;
          const c = SEGMENT_COLORS[opt];
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(isActive ? '' : opt)}
              style={{
                padding: '4px 12px', fontSize: 11, fontWeight: isActive ? 600 : 400,
                border: 'none', borderRight: '1px solid var(--rule)', cursor: 'pointer',
                fontFamily: 'var(--sans)', letterSpacing: '0.04em',
                background: isActive && c ? c.bg : 'var(--paper)',
                color: isActive && c ? c.color : 'var(--ink-4)',
                transition: 'all 0.15s',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {active && (
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: active.bg, flexShrink: 0 }} />
      )}
    </div>
  );
}

function CheckItem({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        background: checked ? 'var(--green-lt)' : 'transparent',
        border: 'none', borderRadius: 'var(--r-sm)',
        padding: '7px 8px', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.15s',
      }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: checked ? 'var(--green)' : 'transparent',
        border: checked ? '2px solid var(--green)' : '2px solid var(--ink-4)',
        transition: 'all 0.15s',
      }}>
        {checked && (
          <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
            <path d="M1 4.5L4 7.5L10 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span style={{
        fontSize: 12.5, flex: 1, fontFamily: 'var(--sans)',
        color: checked ? 'var(--green)' : 'var(--ink-2)',
        fontWeight: checked ? 500 : 400,
        transition: 'color 0.15s',
      }}>
        {label}
      </span>
      {/* doc slot — placeholder for future attachment */}
      <span style={{ width: 16, flexShrink: 0 }} />
    </button>
  );
}

function PhaseRing({ done, total }: { done: number; total: number }) {
  const r = 10;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  const dash = pct * circ;
  const color = pct === 1 ? 'var(--green)' : pct >= 0.6 ? 'var(--brass)' : pct >= 0.3 ? '#b45309' : 'var(--ink-4)';
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" style={{ flexShrink: 0 }}>
      <circle cx="13" cy="13" r={r} fill="none" stroke="var(--paper-3)" strokeWidth="3" />
      <circle cx="13" cy="13" r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4}
        strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.4s' }} />
      <text x="13" y="16.5" textAnchor="middle" fontSize="7" fill={color} fontFamily="var(--sans)" fontWeight="700">
        {done}/{total}
      </text>
    </svg>
  );
}

function EditableDayCard({
  day, index, total, authFetch, onSaved,
}: {
  day: Event; index: number; total: number;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    event_date: String(day.event_date || ''),
    venue: String(day.venue || ''),
    guests: String(day.guests || ''),
    service_style: String(day.service_style || ''),
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await authFetch(`/api/admin/event-days/${day.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        event_date: form.event_date || null,
        venue: form.venue || null,
        guests: form.guests ? Number(form.guests) : null,
        service_style: form.service_style || null,
      }),
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  if (editing) {
    return (
      <div className="card" style={{ padding: '1.1rem 1.3rem', border: '1.5px solid var(--brass-lt)' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 10 }}>
          {total > 1 ? `Day ${index + 1}` : 'Event Day'}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 10 }}>Date</label>
            <input type="date" value={form.event_date} onChange={e => set('event_date', e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 10 }}>Venue</label>
            <input type="text" value={form.venue} onChange={e => set('venue', e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="field" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: 10 }}>Guests</label>
              <input type="number" min="1" value={form.guests} onChange={e => set('guests', e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }} />
            </div>
            <div className="field" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: 10 }}>Style</label>
              <select value={form.service_style} onChange={e => set('service_style', e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
                <option value="">—</option>
                {['Buffet', 'Family Style', 'Plated'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => setEditing(false)} style={{ flex: 1, background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Cancel</button>
            <button onClick={save} disabled={saving} className="btn btn-brass" style={{ flex: 1, fontSize: 12, padding: '6px' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '1.1rem 1.3rem', cursor: 'pointer', position: 'relative' }} onClick={() => setEditing(true)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 6 }}>
          {total > 1 ? `Day ${index + 1}` : 'Event Day'}
        </div>
        <span style={{ fontSize: 10, color: 'var(--ink-4)', opacity: 0.7 }}>Edit</span>
      </div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', marginBottom: 4 }}>{fmt(String(day.event_date))}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 2 }}>{String(day.venue || '—')}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
        {day.guests ? `${day.guests} guests` : ''} {day.service_style ? `· ${day.service_style}` : ''}
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [compact, setCompact] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return JSON.parse(localStorage.getItem('apf-event-compact') || 'false'); } catch { return false; }
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authFetch = useCallback(async (url: string, options?: RequestInit) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...options?.headers } });
  }, []);

  async function loadEvent() {
    const r = await authFetch(`/api/admin/events/${id}`);
    const data = await r.json();
    setEvent(data);
  }

  useEffect(() => {
    authFetch(`/api/admin/events/${id}`)
      .then(r => r.json())
      .then(data => { setEvent(data); setLoading(false); });
  }, [id, authFetch]);

  useEffect(() => {
    if (event?.client_names) document.title = `${String(event.client_names)} | APF Admin`;
  }, [event?.client_names]);

  useEffect(() => { localStorage.setItem('apf-event-compact', JSON.stringify(compact)); }, [compact]);

  const patch = useCallback((updates: Record<string, unknown>) => {
    setEvent(prev => prev ? { ...prev, ...updates } : prev);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await authFetch(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    }, 600);
  }, [id, authFetch]);

  if (loading || !event) return <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '2rem 0' }}>Loading...</div>;


  const days = ((event.event_days as Event[]) || []).sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  const sc = STATUS_COLORS[String(event.status)] || STATUS_COLORS['New'];

  function phaseProgress(phase: typeof PHASES[0]) {
    const bools = phase.fields.filter(f => f.type === 'bool');
    const done = bools.filter(f => event![f.key] === true).length;
    return { done, total: bools.length };
  }

  const rowPad = compact ? '3px 0' : '5px 0';

  return (
    <div>
      <style>{`
        @media (max-width: 640px) {
          .phase-grid { grid-template-columns: 1fr !important; }
          .field-row-side { flex-direction: column !important; align-items: stretch !important; gap: 4px !important; }
          .field-row-side > div { width: 100% !important; }
          .field-row-side input, .field-row-side select { width: 100% !important; font-size: 14px !important; padding: 9px 10px !important; }
          .day-grid { grid-template-columns: 1fr !important; }
          .event-header { flex-direction: column !important; align-items: flex-start !important; }
          .event-header-actions { flex-wrap: wrap !important; }
        }
      `}</style>
      {/* Breadcrumb */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button onClick={() => router.push('/admin')} style={{ background: 'none', border: 'none', color: 'var(--ink-4)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', padding: 0, letterSpacing: '0.04em' }}>
          ← Dashboard
        </button>
      </div>

      {/* Header */}
      <div className="event-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.9rem', fontWeight: 500, marginBottom: 6 }}>{String(event.client_names)}</h1>
        </div>
        <div className="event-header-actions no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: saveState === 'saved' ? 'var(--green)' : 'var(--ink-4)', transition: 'color 0.3s' }}>
            {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? '✓ Saved' : ''}
          </span>
          <button
            onClick={() => setCompact((c: boolean) => !c)}
            title="Toggle compact checklist view"
            style={{ background: compact ? 'var(--paper-2)' : 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: compact ? 'var(--ink-2)' : 'var(--ink-3)', fontFamily: 'var(--sans)' }}
          >
            {compact ? 'Compact ✓' : 'Compact'}
          </button>
          <button onClick={() => window.print()} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
            Print
          </button>
          <select
            value={String(event.status)}
            onChange={e => patch({ status: e.target.value })}
            style={{ background: sc.bg, color: sc.color, border: `1.5px solid ${sc.color}`, borderRadius: 99, padding: '6px 28px 6px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: 'var(--sans)', cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Client contact */}
      <div className="card" style={{ padding: '1rem 1.4rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 10 }}>Contacts</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>Client Email</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="email" value={event.client_email ? String(event.client_email) : ''} onChange={e => patch({ client_email: e.target.value || null })} placeholder="client@example.com" style={{ flex: 1, minWidth: 0 }} />
              {!!event.client_email && <a href={`mailto:${String(event.client_email)}`} title="Email client" style={{ color: 'var(--brass)', fontSize: 16, textDecoration: 'none', flexShrink: 0 }}>✉</a>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>Client Phone</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="tel" value={event.client_phone ? String(event.client_phone) : ''} onChange={e => patch({ client_phone: e.target.value || null })} placeholder="(415) 000-0000" style={{ flex: 1, minWidth: 0 }} />
              {!!event.client_phone && <a href={`tel:${String(event.client_phone)}`} title="Call client" style={{ color: 'var(--brass)', fontSize: 16, textDecoration: 'none', flexShrink: 0 }}>✆</a>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>Planner Name</div>
            <input type="text" value={event.planner_name ? String(event.planner_name) : ''} onChange={e => patch({ planner_name: e.target.value || null })} placeholder="Optional" style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>Planner Email</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="email" value={event.planner_email ? String(event.planner_email) : ''} onChange={e => patch({ planner_email: e.target.value || null })} placeholder="planner@example.com" style={{ flex: 1, minWidth: 0 }} />
              {!!event.planner_email && <a href={`mailto:${String(event.planner_email)}`} title="Email planner" style={{ color: 'var(--brass)', fontSize: 16, textDecoration: 'none', flexShrink: 0 }}>✉</a>}
            </div>
          </div>
        </div>
      </div>

      {/* Event days — editable */}
      <div className="day-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(days.length, 3)}, 1fr)`, gap: 12, marginBottom: '1.75rem' }}>
        {days.map((day, i) => (
          <EditableDayCard
            key={String(day.id)}
            day={day}
            index={i}
            total={days.length}
            authFetch={authFetch}
            onSaved={loadEvent}
          />
        ))}
      </div>

      {/* Checklist phases */}
      <div className="phase-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: '1.5rem' }}>
        {PHASES.map(phase => {
          const { done, total } = phaseProgress(phase);
          const visibleFields = compact
            ? phase.fields.filter(f => f.type !== 'bool' || event[f.key] !== true)
            : phase.fields;
          return (
            <div key={phase.title} className="card">
              <div style={{ padding: compact ? '0.75rem 1.3rem 0.5rem' : '1rem 1.3rem 0.75rem', borderBottom: '1px solid var(--paper-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600 }}>{phase.title}</div>
                <PhaseRing done={done} total={total} />
              </div>
              <div style={{ padding: compact ? '0.5rem 1.3rem' : '0.75rem 1.3rem' }}>
                {visibleFields.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>All complete</span>
                  </div>
                ) : visibleFields.map(field => (
                  <div key={field.key} style={{ borderBottom: '1px solid var(--paper-2)' }}>
                    {field.type === 'bool' && (
                      <CheckItem
                        checked={event[field.key] === true}
                        label={field.label}
                        onChange={v => patch({ [field.key]: v })}
                      />
                    )}
                    {field.type === 'date' && (
                      <div className="field-row-side" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '4px 8px' : '6px 8px' }}>
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1 }}>{field.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
                          <input
                            type="date"
                            value={event[field.key] ? String(event[field.key]).split('T')[0] : ''}
                            onChange={e => patch({ [field.key]: e.target.value || null })}
                            style={{ flex: 1, minWidth: 0, fontSize: 13, padding: '7px 10px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', color: event[field.key] ? 'var(--ink-2)' : 'var(--ink-4)', fontFamily: 'var(--sans)' }}
                          />
                          {!!event[field.key] && (
                            <button
                              type="button"
                              onClick={() => patch({ [field.key]: null })}
                              title="Clear date"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 14, lineHeight: 1, padding: '2px 4px', borderRadius: 'var(--r-sm)', fontFamily: 'var(--sans)' }}
                              onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                              onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-4)')}
                            >×</button>
                          )}
                        </div>
                      </div>
                    )}
                    {field.type === 'select' && (
                      <SegmentedSelect
                        label={field.label}
                        value={event[field.key] ? String(event[field.key]) : ''}
                        options={field.options || []}
                        onChange={v => patch({ [field.key]: v || null })}
                      />
                    )}
                    {field.type === 'text' && (
                      <div className="field-row-side" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '4px 8px' : '6px 8px' }}>
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1 }}>{field.label}</span>
                        <input
                          type="text"
                          value={event[field.key] ? String(event[field.key]) : ''}
                          onChange={e => patch({ [field.key]: e.target.value || null })}
                          placeholder="—"
                          style={{ width: 120, fontSize: 12, padding: '3px 6px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Internal notes */}
      <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 10 }}>Internal Notes</div>
        <textarea
          value={event.internal_notes ? String(event.internal_notes) : ''}
          onChange={e => patch({ internal_notes: e.target.value || null })}
          rows={4}
          placeholder="Private notes about this event..."
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>
    </div>
  );
}
