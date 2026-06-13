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

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authFetch = useCallback(async (url: string, options?: RequestInit) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...options?.headers } });
  }, []);

  useEffect(() => {
    authFetch(`/api/admin/events/${id}`)
      .then(r => r.json())
      .then(data => { setEvent(data); setLoading(false); });
  }, [id, authFetch]);

  useEffect(() => {
    if (event?.client_names) document.title = `${String(event.client_names)} | APF Admin`;
  }, [event?.client_names]);

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

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button onClick={() => router.push('/admin')} style={{ background: 'none', border: 'none', color: 'var(--ink-4)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', padding: 0, letterSpacing: '0.04em' }}>
          ← Dashboard
        </button>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.9rem', fontWeight: 500, marginBottom: 6 }}>{String(event.client_names)}</h1>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {event.planner_name ? <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Planner: <strong>{String(event.planner_name)}</strong></span> : null}
            {event.planner_email ? <span style={{ fontSize: 13, color: 'var(--brass)' }}>{String(event.planner_email)}</span> : null}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: saveState === 'saved' ? 'var(--green)' : 'var(--ink-4)', transition: 'color 0.3s' }}>
            {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? '✓ Saved' : ''}
          </span>
          <select
            value={String(event.status)}
            onChange={e => patch({ status: e.target.value })}
            style={{ background: sc.bg, color: sc.color, border: `1.5px solid ${sc.color}`, borderRadius: 99, padding: '6px 28px 6px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: 'var(--sans)', cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Event days */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(days.length, 3)}, 1fr)`, gap: 12, marginBottom: '1.75rem' }}>
        {days.map((day, i) => (
          <div key={String(day.id)} className="card" style={{ padding: '1.1rem 1.3rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 6 }}>
              {days.length > 1 ? `Day ${i + 1}` : 'Event Day'}
            </div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', marginBottom: 4 }}>{fmt(String(day.event_date))}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 2 }}>{String(day.venue)}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{day.guests ? `${day.guests} guests` : ''} {day.service_style ? `· ${day.service_style}` : ''}</div>
          </div>
        ))}
      </div>

      {/* Checklist phases */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: '1.5rem' }}>
        {PHASES.map(phase => {
          const { done, total } = phaseProgress(phase);
          return (
            <div key={phase.title} className="card">
              <div style={{ padding: '1rem 1.3rem 0.75rem', borderBottom: '1px solid var(--paper-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600 }}>{phase.title}</div>
                <div style={{ fontSize: 11, color: done === total ? 'var(--green)' : 'var(--ink-4)', fontWeight: done === total ? 600 : 400 }}>
                  {done}/{total}
                </div>
              </div>
              <div style={{ padding: '0.75rem 1.3rem' }}>
                {phase.fields.map(field => (
                  <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--paper-2)' }}>
                    {field.type === 'bool' && (
                      <>
                        <input
                          type="checkbox"
                          checked={event[field.key] === true}
                          onChange={e => patch({ [field.key]: e.target.checked })}
                          style={{ width: 15, height: 15, accentColor: 'var(--brass)', cursor: 'pointer', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 12.5, color: event[field.key] === true ? 'var(--ink)' : 'var(--ink-3)', flex: 1, textDecoration: event[field.key] === true ? 'line-through' : 'none', textDecorationColor: 'var(--ink-4)' }}>
                          {field.label}
                        </span>
                      </>
                    )}
                    {field.type === 'date' && (
                      <>
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1 }}>{field.label}</span>
                        <input
                          type="date"
                          value={event[field.key] ? String(event[field.key]).split('T')[0] : ''}
                          onChange={e => patch({ [field.key]: e.target.value || null })}
                          style={{ width: 'auto', fontSize: 12, padding: '3px 6px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}
                        />
                      </>
                    )}
                    {field.type === 'select' && (
                      <>
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1 }}>{field.label}</span>
                        <select
                          value={event[field.key] ? String(event[field.key]) : ''}
                          onChange={e => patch({ [field.key]: e.target.value || null })}
                          style={{ width: 'auto', fontSize: 12, padding: '3px 22px 3px 6px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}
                        >
                          {(field.options || []).map(o => <option key={o} value={o}>{o || '—'}</option>)}
                        </select>
                      </>
                    )}
                    {field.type === 'text' && (
                      <>
                        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1 }}>{field.label}</span>
                        <input
                          type="text"
                          value={event[field.key] ? String(event[field.key]) : ''}
                          onChange={e => patch({ [field.key]: e.target.value || null })}
                          placeholder="—"
                          style={{ width: 120, fontSize: 12, padding: '3px 6px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}
                        />
                      </>
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
