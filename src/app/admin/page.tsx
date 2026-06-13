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

type Lead = Record<string, unknown>;
type Event = Record<string, unknown>;
type Stats = {
  conversionRate: number;
  activeCount: number;
  upcoming: { days: number; count: number }[];
  postEventHealth: number | null;
  pipeline: { status: string; count: number }[];
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || { bg: '#f4f4f4', color: '#555' };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

function ProgressBar({ event }: { event: Event }) {
  const done = BOOL_FIELDS.filter(f => event[f] === true).length;
  const total = BOOL_FIELDS.length;
  const pct = Math.round((done / total) * 100);
  const color = pct === 100 ? '#38614a' : pct >= 60 ? '#97784c' : pct >= 30 ? '#b45309' : '#2d5a9e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--paper-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{done}/{total}</span>
    </div>
  );
}

function TrashBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title="Move to trash"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: 'var(--ink-4)', borderRadius: 'var(--r-sm)', lineHeight: 1 }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-4)')}
    >
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
            <input type="text" value={venue} onChange={e => setVenue(e.target.value)} placeholder="e.g. The Ritz-Carlton, Half Moon Bay" autoFocus />
          </div>
          {error && <div style={{ background: 'var(--red-lt)', color: 'var(--red)', border: '1px solid #e2bcbc', borderRadius: 'var(--r-sm)', padding: '9px 13px', fontSize: 13, marginBottom: '1rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-brass">{saving ? 'Creating...' : 'Create Event'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddLeadModal({ onClose, onSaved, authFetch }: {
  onClose: () => void;
  onSaved: () => void;
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    event_date: '', guests: '', hours: '5',
    preferred_style: 'Buffet', bar_package: 'None',
    appetizer_count: '0', include_dessert: false, include_coffee: false,
    notes: '', send_email: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k: string, v: unknown) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.event_date || !form.guests || !form.preferred_style) {
      setError('First name, last name, event date, guests, and style are required.'); return;
    }
    if (form.send_email && !form.email) {
      setError('Email address is required to send an estimate.'); return;
    }
    setSaving(true); setError('');
    const res = await authFetch('/api/admin/leads', { method: 'POST', body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Failed to save lead'); setSaving(false); return; }
    onSaved();
  }

  const fieldStyle = { marginBottom: 14 };
  const row = { display: 'flex', gap: 12 } as React.CSSProperties;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,20,16,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem', overflowY: 'auto' }}>
      <div className="card" style={{ width: '100%', maxWidth: 560, padding: '2rem', margin: 'auto' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 8 }}>Add Lead Manually</div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.35rem', fontWeight: 500, marginBottom: '1.25rem' }}>New Lead</h2>
        <form onSubmit={handleSubmit}>
          <div style={row}>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}><label>First name *</label><input value={form.first_name} onChange={e => set('first_name', e.target.value)} autoFocus /></div>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}><label>Last name *</label><input value={form.last_name} onChange={e => set('last_name', e.target.value)} /></div>
          </div>
          <div style={row}>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}><label>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="for estimate email" /></div>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}><label>Phone</label><input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          </div>
          <div style={row}>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}><label>Event date *</label><input type="date" value={form.event_date} onChange={e => set('event_date', e.target.value)} /></div>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}><label>Guests *</label><input type="number" min="1" value={form.guests} onChange={e => set('guests', e.target.value)} /></div>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}><label>Hours</label><input type="number" min="1" max="16" value={form.hours} onChange={e => set('hours', e.target.value)} /></div>
          </div>
          <div style={row}>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}>
              <label>Service style *</label>
              <select value={form.preferred_style} onChange={e => set('preferred_style', e.target.value)}>
                {['Buffet', 'Family Style', 'Plated'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field" style={{ ...fieldStyle, flex: 1 }}>
              <label>Bar</label>
              <select value={form.bar_package} onChange={e => set('bar_package', e.target.value)}>
                {['None', 'Soft Bar', 'Full Bar'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 8, letterSpacing: '0.04em' }}>Add-ons</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <select value={form.appetizer_count} onChange={e => set('appetizer_count', e.target.value)} style={{ fontSize: 12, padding: '6px 28px 6px 10px' }}>
                  {['0','1','2','3','4','5','6'].map(n => <option key={n} value={n}>{n === '0' ? 'No appetizers' : `${n} appetizer${n === '1' ? '' : 's'}`}</option>)}
                </select>
              </div>
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
          <div className="field" style={fieldStyle}>
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Source, special requests, anything relevant…" />
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

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<'events' | 'leads' | 'trash'>('events');
  const [events, setEvents] = useState<Event[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [trash, setTrash] = useState<{ leads: Lead[]; events: Event[] }>({ leads: [], events: [] });
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [converting, setConverting] = useState<Lead | null>(null);
  const [addingLead, setAddingLead] = useState(false);

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...opts?.headers } });
  }, []);

  async function reload() {
    const [evRes, leRes, stRes, trRes] = await Promise.all([
      authFetch('/api/admin/events'),
      authFetch('/api/admin/leads'),
      authFetch('/api/admin/stats'),
      authFetch('/api/admin/trash'),
    ]);
    const [evData, leData, stData, trData] = await Promise.all([evRes.json(), leRes.json(), stRes.json(), trRes.json()]);
    setEvents(Array.isArray(evData) ? evData : []);
    setLeads(Array.isArray(leData) ? leData : []);
    setStats(stData);
    setTrash({ leads: trData.leads || [], events: trData.events || [] });
  }

  useEffect(() => { reload().then(() => setLoading(false)); }, []); // eslint-disable-line

  async function softDelete(type: 'lead' | 'event', id: string) {
    await authFetch('/api/admin/trash', { method: 'PATCH', body: JSON.stringify({ type, id, action: 'trash' }) });
    reload();
  }

  async function restore(type: 'lead' | 'event', id: string) {
    await authFetch('/api/admin/trash', { method: 'PATCH', body: JSON.stringify({ type, id, action: 'restore' }) });
    reload();
  }

  async function purge(type: 'lead' | 'event', id: string) {
    if (!confirm('Permanently delete? This cannot be undone.')) return;
    await authFetch('/api/admin/trash', { method: 'DELETE', body: JSON.stringify({ type, id }) });
    reload();
  }

  const [eventSort, setEventSort] = useState<{ field: 'event_date' | 'created_at'; dir: 'asc' | 'desc' }>({ field: 'created_at', dir: 'desc' });
  const [leadSort, setLeadSort] = useState<{ field: 'event_date' | 'created_at'; dir: 'asc' | 'desc' }>({ field: 'created_at', dir: 'desc' });

  function toggleEventSort(field: 'event_date' | 'created_at') {
    setEventSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }
  function toggleLeadSort(field: 'event_date' | 'created_at') {
    setLeadSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }

  const statuses = ['All', 'New', 'Booked', 'Menu Development', 'EO', 'Completed', 'Lost'];

  const filteredEvents = (statusFilter === 'All' ? events : events.filter(e => e.status === statusFilter))
    .slice()
    .sort((a, b) => {
      let av: string, bv: string;
      if (eventSort.field === 'event_date') {
        const ad = ((a.event_days as Event[]) || []).sort((x, y) => String(x.event_date).localeCompare(String(y.event_date)))[0];
        const bd = ((b.event_days as Event[]) || []).sort((x, y) => String(x.event_date).localeCompare(String(y.event_date)))[0];
        av = ad ? String(ad.event_date) : '9999';
        bv = bd ? String(bd.event_date) : '9999';
      } else {
        av = String(a.created_at || '');
        bv = String(b.created_at || '');
      }
      return eventSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const sortedLeads = leads.slice().sort((a, b) => {
    const av = String(leadSort.field === 'event_date' ? (a.event_date || '9999') : (a.created_at || ''));
    const bv = String(leadSort.field === 'event_date' ? (b.event_date || '9999') : (b.created_at || ''));
    return leadSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const trashCount = trash.leads.length + trash.events.length;

  function firstDay(event: Event) {
    const days = (event.event_days as Event[]) || [];
    if (!days.length) return null;
    return days.sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0];
  }

  function totalGuests(event: Event) {
    const days = (event.event_days as Event[]) || [];
    return days.reduce((sum, d) => sum + (Number(d.guests) || 0), 0);
  }

  if (loading) return <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '2rem 0' }}>Loading...</div>;

  return (
    <div>
      {addingLead && (
        <AddLeadModal
          authFetch={authFetch}
          onClose={() => setAddingLead(false)}
          onSaved={() => { setAddingLead(false); reload(); }}
        />
      )}

      {converting && (
        <ConvertModal
          lead={converting}
          onClose={() => setConverting(null)}
          onConverted={(eventId) => { setConverting(null); reload().then(() => { setTab('events'); router.push(`/admin/events/${eventId}`); }); }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.75rem', fontWeight: 500 }}>Dashboard</h1>
        <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{events.length} events · {leads.length} leads</div>
      </div>

      {/* KPI tiles */}
      {stats && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <StatTile label="Lead Conversion" value={`${stats.conversionRate}%`} sub="quotes → events"
              color={stats.conversionRate >= 50 ? 'var(--green)' : stats.conversionRate >= 25 ? 'var(--brass)' : '#b45309'} />
            <StatTile label="Active Events" value={String(stats.activeCount)} sub="not completed or lost" />
            <StatTile label="Next 30 Days" value={String(stats.upcoming[0]?.count ?? 0)}
              sub={`${stats.upcoming[1]?.count ?? 0} in 60d · ${stats.upcoming[2]?.count ?? 0} in 90d`}
              color={stats.upcoming[0]?.count > 0 ? 'var(--brass)' : 'var(--ink)'} />
            {stats.postEventHealth !== null && (
              <StatTile label="Post-Event Complete" value={`${stats.postEventHealth}%`} sub="of completed events"
                color={stats.postEventHealth >= 80 ? 'var(--green)' : '#b45309'} />
            )}
          </div>
          <div className="card" style={{ padding: '1rem 1.4rem', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 10 }}>Pipeline</div>
            <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
              {stats.pipeline.filter(p => p.count > 0).map(p => {
                const total = stats.pipeline.reduce((s, x) => s + x.count, 0);
                return <div key={p.status} style={{ flex: p.count / total, background: PIPELINE_COLORS[p.status], minWidth: 4 }} title={`${p.status}: ${p.count}`} />;
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--rule)', marginBottom: '1.5rem' }}>
        {(['events', 'leads', 'trash'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--brass)' : '2px solid transparent', padding: '10px 20px', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? 'var(--brass)' : 'var(--ink-3)', cursor: 'pointer', fontFamily: 'var(--sans)', marginBottom: -1, letterSpacing: '0.04em' }}>
            {t === 'events' ? `Events (${events.length})` : t === 'leads' ? `Leads (${leads.length})` : `Trash${trashCount > 0 ? ` (${trashCount})` : ''}`}
          </button>
        ))}
      </div>

      {/* Events tab */}
      {tab === 'events' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            {statuses.map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{ border: '1.5px solid', borderColor: statusFilter === s ? 'var(--brass)' : 'var(--rule)', background: statusFilter === s ? 'var(--brass)' : 'transparent', color: statusFilter === s ? '#fff' : 'var(--ink-3)', borderRadius: 99, padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 500 }}>
                {s}
              </button>
            ))}
          </div>
          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--paper)' }}>
                  <PlainTh label="Client" />
                  <SortTh label="Event Date" field="event_date" sort={eventSort} onToggle={() => toggleEventSort('event_date')} />
                  <PlainTh label="Venue" />
                  <PlainTh label="Guests" />
                  <PlainTh label="Style" />
                  <PlainTh label="Status" />
                  <PlainTh label="Checklist" />
                  <SortTh label="Submitted" field="created_at" sort={eventSort} onToggle={() => toggleEventSort('created_at')} />
                  <PlainTh label="" />
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => {
                  const day = firstDay(event);
                  return (
                    <tr key={String(event.id)} onClick={() => router.push(`/admin/events/${event.id}`)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--paper-3)', transition: 'background 0.12s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--ink)' }}>{String(event.client_names)}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{fmt(day ? String(day.event_date) : null)}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{day ? String(day.venue) : '—'}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-2)', textAlign: 'right' }}>{totalGuests(event) || '—'}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{day ? String(day.service_style) : '—'}</td>
                      <td style={{ padding: '12px 16px' }}><StatusBadge status={String(event.status)} /></td>
                      <td style={{ padding: '12px 16px' }}><ProgressBar event={event} /></td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-4)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmt(event.created_at ? String(event.created_at) : null)}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <TrashBtn onClick={e => { e.stopPropagation(); softDelete('event', String(event.id)); }} />
                      </td>
                    </tr>
                  );
                })}
                {filteredEvents.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>No events found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Leads tab */}
      {tab === 'leads' && (
        <>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button onClick={() => setAddingLead(true)} className="btn btn-brass" style={{ fontSize: 12, padding: '7px 16px' }}>
            + Add Lead
          </button>
        </div>
        <div className="card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--paper)' }}>
                <PlainTh label="Name" />
                <PlainTh label="Email" />
                <SortTh label="Event Date" field="event_date" sort={leadSort} onToggle={() => toggleLeadSort('event_date')} />
                <PlainTh label="Guests" />
                <PlainTh label="Style" />
                <PlainTh label="Bar" />
                <SortTh label="Submitted" field="created_at" sort={leadSort} onToggle={() => toggleLeadSort('created_at')} />
                <PlainTh label="" />
                <PlainTh label="" />
              </tr>
            </thead>
            <tbody>
              {sortedLeads.map((lead) => (
                <tr key={String(lead.id)} style={{ borderBottom: '1px solid var(--paper-3)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500 }}>{`${lead.first_name} ${lead.last_name}`}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{String(lead.email)}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{fmt(lead.event_date ? String(lead.event_date) : null)}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-2)', textAlign: 'right' }}>{lead.guests ? String(lead.guests) : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{lead.preferred_style ? String(lead.preferred_style) : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-3)' }}>{lead.bar_package ? String(lead.bar_package) : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-4)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmt(lead.created_at ? String(lead.created_at) : null)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button onClick={() => setConverting(lead)} style={{ background: 'var(--brass)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--sans)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      Convert →
                    </button>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <TrashBtn onClick={() => softDelete('lead', String(lead.id))} />
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>No unconverted leads</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Trash tab */}
      {tab === 'trash' && (
        <div>
          {trashCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--ink-4)', fontSize: 13 }}>Trash is empty</div>
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
                              <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--ink-3)' }}>{String(event.client_names)}</td>
                              <td style={{ padding: '12px 16px', color: 'var(--ink-4)', fontSize: 13 }}>{fmt(day ? String(day.event_date) : null)}</td>
                              <td style={{ padding: '12px 16px', color: 'var(--ink-4)', fontSize: 12 }}>Deleted {fmt(String(event.deleted_at))}</td>
                              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
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
                            <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--ink-3)' }}>{`${lead.first_name} ${lead.last_name}`}</td>
                            <td style={{ padding: '12px 16px', color: 'var(--ink-4)', fontSize: 13 }}>{String(lead.email)}</td>
                            <td style={{ padding: '12px 16px', color: 'var(--ink-4)', fontSize: 12 }}>Deleted {fmt(String(lead.deleted_at))}</td>
                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>
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
