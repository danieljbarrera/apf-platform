'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  New:              { bg: '#e8f0ff', color: '#2d5a9e' },
  Booked:           { bg: '#f5efe4', color: '#785e36' },
  'Menu Development': { bg: '#fff7ed', color: '#b45309' },
  EO:               { bg: '#f3f0ff', color: '#6d28d9' },
  Completed:        { bg: 'var(--green-lt)', color: 'var(--green)' },
  Lost:             { bg: '#f4f4f4', color: '#79715f' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || { bg: '#f4f4f4', color: '#555' };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<'events' | 'leads'>('events');
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [leads, setLeads] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');

  const authFetch = useCallback(async (url: string) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  }, []);

  useEffect(() => {
    async function load() {
      const [evRes, leRes] = await Promise.all([
        authFetch('/api/admin/events'),
        authFetch('/api/admin/leads'),
      ]);
      const [evData, leData] = await Promise.all([evRes.json(), leRes.json()]);
      setEvents(Array.isArray(evData) ? evData : []);
      setLeads(Array.isArray(leData) ? leData : []);
      setLoading(false);
    }
    load();
  }, [authFetch]);

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
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.75rem', fontWeight: 500 }}>Dashboard</h1>
        <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{events.length} events · {leads.length} leads</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--rule)', marginBottom: '1.5rem' }}>
        {(['events', 'leads'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--brass)' : '2px solid transparent', padding: '10px 20px', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? 'var(--brass)' : 'var(--ink-3)', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'var(--sans)', marginBottom: -1, letterSpacing: '0.04em' }}>
            {t === 'events' ? `Events (${events.length})` : `Leads (${leads.length})`}
          </button>
        ))}
      </div>

      {tab === 'events' && (
        <>
          {/* Status filter */}
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
                  {['Client', 'First Event Date', 'Venue', 'Guests', 'Style', 'Planner', 'Status'].map(h => (
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
                      <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{event.planner_name ? String(event.planner_name) : '—'}</td>
                      <td style={{ padding: '12px 16px' }}><StatusBadge status={String(event.status)} /></td>
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
                {['Name', 'Email', 'Event Date', 'Guests', 'Style', 'Bar', 'Submitted'].map(h => (
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
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>No leads yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
