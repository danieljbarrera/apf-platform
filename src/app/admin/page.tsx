'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  New:              { bg: '#e8f0ff', color: '#2d5a9e' },
  Booked:           { bg: '#f5efe4', color: '#785e36' },
  'Menu Development': { bg: '#fff7ed', color: '#b45309' },
  EO:               { bg: '#f3f0ff', color: '#6d28d9' },
  Completed:        { bg: 'var(--green-lt)', color: 'var(--green)' },
  Lost:             { bg: '#f4f4f4', color: '#79715f' },
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

type Lead = Record<string, unknown>;

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || { bg: '#f4f4f4', color: '#555' };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

function ProgressBar({ event }: { event: Record<string, unknown> }) {
  const done = BOOL_FIELDS.filter(f => event[f] === true).length;
  const total = BOOL_FIELDS.length;
  const pct = Math.round((done / total) * 100);
  const color = pct === 100 ? '#38614a' : pct >= 60 ? '#97784c' : pct >= 30 ? '#b45309' : '#2d5a9e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--paper-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{done}/{total}</span>
    </div>
  );
}

function fmt(d: string | null) {
  if (!d) return '—';
  const dateStr = d.includes('T') ? d : d + 'T12:00:00';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ConvertModal({ lead, onClose, onConverted }: {
  lead: Lead;
  onClose: () => void;
  onConverted: (eventId: string) => void;
}) {
  const [venue, setVenue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const authFetch = useCallback(async (url: string, options?: RequestInit) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...options?.headers },
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!venue.trim()) { setError('Venue is required'); return; }
    setSaving(true);
    setError('');

    const clientNames = `${lead.first_name} ${lead.last_name}`.trim();
    const res = await authFetch('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        event: { client_names: clientNames, status: 'New' },
        days: [{ event_date: lead.event_date, venue: venue.trim(), guests: lead.guests, service_style: lead.preferred_style, sort_order: 0 }],
      }),
    });
    const newEvent = await res.json();
    if (!res.ok) { setError(newEvent.error || 'Failed to create event'); setSaving(false); return; }

    await authFetch('/api/admin/leads', {
      method: 'PATCH',
      body: JSON.stringify({ id: lead.id, converted: true }),
    });

    onConverted(newEvent.id);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,20,16,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 480, padding: '2rem' }}>
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
            <input
              type="text"
              value={venue}
              onChange={e => setVenue(e.target.value)}
              placeholder="e.g. The Ritz-Carlton, Half Moon Bay"
              autoFocus
            />
          </div>
          {error && (
            <div style={{ background: 'var(--red-lt)', color: 'var(--red)', border: '1px solid #e2bcbc', borderRadius: 'var(--r-sm)', padding: '9px 13px', fontSize: 13, marginBottom: '1rem' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn btn-brass">
              {saving ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<'events' | 'leads'>('events');
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [converting, setConverting] = useState<Lead | null>(null);

  const authFetch = useCallback(async (url: string) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  }, []);

  async function reload() {
    const [evRes, leRes] = await Promise.all([
      authFetch('/api/admin/events'),
      authFetch('/api/admin/leads'),
    ]);
    const [evData, leData] = await Promise.all([evRes.json(), leRes.json()]);
    setEvents(Array.isArray(evData) ? evData : []);
    setLeads(Array.isArray(leData) ? leData : []);
  }

  useEffect(() => {
    reload().then(() => setLoading(false));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const statuses = ['All', 'New', 'Booked', 'Menu Development', 'EO', 'Completed', 'Lost'];
  const filteredEvents = statusFilter === 'All' ? events : events.filter(e => e.status === statusFilter);

  function firstDay(event: Record<string, unknown>) {
    const days = (event.event_days as Record<string, unknown>[]) || [];
    if (!days.length) return null;
    return days.sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0];
  }

  function totalGuests(event: Record<string, unknown>) {
    const days = (event.event_days as Record<string, unknown>[]) || [];
    return days.reduce((sum, d) => sum + (Number(d.guests) || 0), 0);
  }

  if (loading) return <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '2rem 0' }}>Loading...</div>;

  return (
    <div>
      {converting && (
        <ConvertModal
          lead={converting}
          onClose={() => setConverting(null)}
          onConverted={(eventId) => {
            setConverting(null);
            reload().then(() => {
              setTab('events');
              router.push(`/admin/events/${eventId}`);
            });
          }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.75rem', fontWeight: 500 }}>Dashboard</h1>
        <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{events.length} events · {leads.length} leads</div>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--rule)', marginBottom: '1.5rem' }}>
        {(['events', 'leads'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--brass)' : '2px solid transparent', padding: '10px 20px', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? 'var(--brass)' : 'var(--ink-3)', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'var(--sans)', marginBottom: -1, letterSpacing: '0.04em' }}>
            {t === 'events' ? `Events (${events.length})` : `Leads (${leads.length})`}
          </button>
        ))}
      </div>

      {tab === 'events' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            {statuses.map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{ border: '1.5px solid', borderColor: statusFilter === s ? 'var(--brass)' : 'var(--rule)', background: statusFilter === s ? 'var(--brass)' : 'transparent', color: statusFilter === s ? '#fff' : 'var(--ink-3)', borderRadius: 99, padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 500, transition: 'all 0.15s' }}>
                {s}
              </button>
            ))}
          </div>

          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--paper)' }}>
                  {['Client', 'First Event Date', 'Venue', 'Guests', 'Style', 'Status', 'Checklist'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--rule)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => {
                  const day = firstDay(event);
                  return (
                    <tr
                      key={String(event.id)}
                      onClick={() => router.push(`/admin/events/${event.id}`)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--paper-3)', transition: 'background 0.12s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--ink)' }}>{String(event.client_names)}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{fmt(day ? String(day.event_date) : null)}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{day ? String(day.venue) : '—'}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-2)', textAlign: 'right' }}>{totalGuests(event) || '—'}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{day ? String(day.service_style) : '—'}</td>
                      <td style={{ padding: '12px 16px' }}><StatusBadge status={String(event.status)} /></td>
                      <td style={{ padding: '12px 16px' }}><ProgressBar event={event} /></td>
                    </tr>
                  );
                })}
                {filteredEvents.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>No events found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'leads' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--paper)' }}>
                {['Name', 'Email', 'Event Date', 'Guests', 'Style', 'Bar', 'Submitted', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--rule)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={String(lead.id)} style={{ borderBottom: '1px solid var(--paper-3)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500 }}>{`${lead.first_name} ${lead.last_name}`}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{String(lead.email)}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{fmt(lead.event_date ? String(lead.event_date) : null)}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-2)', textAlign: 'right' }}>{lead.guests ? String(lead.guests) : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{lead.preferred_style ? String(lead.preferred_style) : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{lead.bar_package ? String(lead.bar_package) : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-4)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmt(lead.created_at ? String(lead.created_at) : null)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => setConverting(lead)}
                      style={{ background: 'var(--brass)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--sans)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
                    >
                      Convert →
                    </button>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>No unconverted leads</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
