'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type Event = Record<string, unknown>;

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(String(d) + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtShort(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(String(d) + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function eoNumber(event: Event) {
  const year = event.created_at ? new Date(String(event.created_at)).getFullYear() : new Date().getFullYear();
  const suffix = String(event.id || '').slice(-4).toUpperCase();
  return `EO-${year}-${suffix}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 0 }}>
      <div style={{ background: '#161410', color: '#97784c', fontSize: 9, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '5px 14px' }}>
        {title}
      </div>
      <div style={{ border: '1px solid #d4cfc5', borderTop: 'none', padding: '12px 14px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: '#79715f', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: '#161410' }}>{value || '—'}</span>
    </div>
  );
}

function EOTextarea({
  label, value, onChange, rows = 4, placeholder,
}: {
  label?: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <div>
      {label && <div style={{ fontSize: 10, color: '#79715f', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="no-print-border"
        style={{ width: '100%', fontFamily: 'Georgia, serif', fontSize: 12, color: '#161410', border: '1px dashed #c9c2b0', borderRadius: 4, padding: '8px 10px', resize: 'vertical', background: '#faf8f3', lineHeight: 1.6 }}
      />
    </div>
  );
}

export default function EventOrderPage() {
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
    if (event?.client_names) document.title = `EO — ${String(event.client_names)} | APF`;
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

  if (loading || !event) return <div style={{ color: '#79715f', fontSize: 14, padding: '2rem' }}>Loading…</div>;

  const days = ((event.event_days as Event[]) || []).sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  const firstDay = days[0];
  const totalGuests = days.filter(d => (d.day_type || 'Main') === 'Main').reduce((s, d) => s + (Number(d.guests) || 0), 0);
  const eoNum = eoNumber(event);
  const generatedDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .no-print-border textarea { border: none !important; background: transparent !important; padding: 0 !important; }
          body { background: white !important; }
          .eo-doc { box-shadow: none !important; max-width: 100% !important; }
        }
        @media (max-width: 640px) {
          .eo-overview-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => router.push(`/admin/events/${id}`)}
          style={{ background: 'none', border: 'none', color: 'var(--ink-4)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', padding: 0 }}>
          ← Event
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: saveState === 'saved' ? 'var(--green)' : 'var(--ink-4)', transition: 'color 0.3s' }}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : ''}
        </span>
        <button onClick={() => window.print()}
          style={{ background: '#161410', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
          Print / Save PDF
        </button>
      </div>

      {/* Document */}
      <div className="eo-doc" style={{ maxWidth: 760, margin: '0 auto', background: 'white', boxShadow: '0 2px 20px rgba(0,0,0,0.08)', fontFamily: 'Georgia, serif' }}>

        {/* Header */}
        <div style={{ background: '#161410', padding: '24px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#97784c', marginBottom: 6 }}>All Purpose Flower · Fine Catering &amp; Events</div>
            <div style={{ fontSize: 26, color: '#fff', fontWeight: 400, letterSpacing: '0.02em' }}>Event Order</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: '#97784c', fontWeight: 600, marginBottom: 4 }}>{eoNum}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Generated {generatedDate}</div>
          </div>
        </div>

        {/* Overview grid */}
        <div style={{ borderBottom: '3px solid #97784c' }}>
          <div className="eo-overview-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}>
            {[
              { label: 'Client', value: String(event.client_names || '—') },
              { label: 'Date', value: days.length === 1 ? fmt(String(firstDay?.event_date || '')) : `${days.length} days` },
              { label: 'Venue', value: days.length === 1 ? String(firstDay?.venue || '—') : 'See days below' },
              { label: 'Guests', value: totalGuests ? String(totalGuests) : '—' },
              { label: 'Service Style', value: days.length === 1 ? String(firstDay?.service_style || '—') : 'See days below' },
              { label: 'Status', value: String(event.status || '—') },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: '10px 14px', borderRight: '1px solid #ede8df', borderBottom: '1px solid #ede8df' }}>
                <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#97784c', fontWeight: 700, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, color: '#161410', fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Multi-day breakdown */}
        {days.length > 1 && (
          <Section title="Event Days">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#faf8f3' }}>
                  {['Day', 'Date', 'Venue', 'Guests', 'Style'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#79715f', fontWeight: 600, borderBottom: '1px solid #ede8df' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day, i) => (
                  <tr key={String(day.id)} style={{ borderBottom: '1px solid #f0ebe0' }}>
                    <td style={{ padding: '7px 10px', color: '#97784c', fontWeight: 600 }}>{i + 1}</td>
                    <td style={{ padding: '7px 10px' }}>{fmtShort(String(day.event_date))}</td>
                    <td style={{ padding: '7px 10px' }}>{String(day.venue || '—')}</td>
                    <td style={{ padding: '7px 10px' }}>{day.guests ? String(day.guests) : '—'}</td>
                    <td style={{ padding: '7px 10px' }}>{String(day.service_style || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Contacts */}
        <Section title="Contacts">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: '#97784c', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Client</div>
              <Field label="Name" value={String(event.client_names || '—')} />
              <Field label="Email" value={event.client_email ? <a href={`mailto:${String(event.client_email)}`} style={{ color: '#97784c' }}>{String(event.client_email)}</a> : null} />
              <Field label="Phone" value={event.client_phone ? String(event.client_phone) : null} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#97784c', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Planner</div>
              <Field label="Name" value={event.planner_name ? String(event.planner_name) : null} />
              <Field label="Email" value={event.planner_email ? <a href={`mailto:${String(event.planner_email)}`} style={{ color: '#97784c' }}>{String(event.planner_email)}</a> : null} />
            </div>
          </div>
        </Section>

        {/* Staffing */}
        <Section title="Staffing">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: '#79715f', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Captain</div>
              <input
                type="text"
                value={event.captain_assigned ? String(event.captain_assigned) : ''}
                onChange={e => patch({ captain_assigned: e.target.value || null })}
                placeholder="Assign captain…"
                className="no-print"
                style={{ width: '100%', fontFamily: 'Georgia, serif', fontSize: 12, border: '1px dashed #c9c2b0', borderRadius: 4, padding: '6px 8px', background: '#faf8f3' }}
              />
              <div className="print-only" style={{ display: 'none', fontSize: 12 }}>{String(event.captain_assigned || '—')}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#79715f', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Load-in Time</div>
              <input
                type="text"
                value={event.load_in_time ? String(event.load_in_time) : ''}
                onChange={e => patch({ load_in_time: e.target.value || null })}
                placeholder="e.g. 2:00 PM"
                className="no-print"
                style={{ width: '100%', fontFamily: 'Georgia, serif', fontSize: 12, border: '1px dashed #c9c2b0', borderRadius: 4, padding: '6px 8px', background: '#faf8f3' }}
              />
              <div className="print-only" style={{ display: 'none', fontSize: 12 }}>{String(event.load_in_time || '—')}</div>
            </div>
          </div>
          <EOTextarea
            label="Staffing Notes"
            value={event.staffing_notes ? String(event.staffing_notes) : ''}
            onChange={v => patch({ staffing_notes: v || null })}
            rows={3}
            placeholder="Staff count, roles, special assignments…"
          />
        </Section>

        {/* Bar */}
        <Section title="Bar">
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#79715f', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Package</div>
            <input
              type="text"
              value={event.bar_package ? String(event.bar_package) : ''}
              onChange={e => patch({ bar_package: e.target.value || null })}
              placeholder="e.g. Full Bar, Soft Bar, Beer &amp; Wine only…"
              className="no-print"
              style={{ width: '100%', fontFamily: 'Georgia, serif', fontSize: 12, border: '1px dashed #c9c2b0', borderRadius: 4, padding: '6px 8px', background: '#faf8f3' }}
            />
          </div>
        </Section>

        {/* Menu */}
        <Section title="Menu">
          <EOTextarea
            value={event.menu_notes ? String(event.menu_notes) : ''}
            onChange={v => patch({ menu_notes: v || null })}
            rows={6}
            placeholder="Passed appetizers, stations, entrees, sides, desserts…"
          />
        </Section>

        {/* Timeline */}
        <Section title="Timeline">
          <EOTextarea
            value={event.timeline_notes ? String(event.timeline_notes) : ''}
            onChange={v => patch({ timeline_notes: v || null })}
            rows={5}
            placeholder="2:00 PM — Load in&#10;4:00 PM — Setup complete&#10;5:00 PM — Doors open…"
          />
        </Section>

        {/* Allergies */}
        <Section title="Allergies &amp; Dietary">
          <EOTextarea
            value={event.allergy_notes ? String(event.allergy_notes) : ''}
            onChange={v => patch({ allergy_notes: v || null })}
            rows={3}
            placeholder="Guest dietary restrictions, allergies, vendor meals…"
          />
        </Section>

        {/* Internal Notes */}
        <Section title="Notes">
          <EOTextarea
            value={event.internal_notes ? String(event.internal_notes) : ''}
            onChange={v => patch({ internal_notes: v || null })}
            rows={4}
            placeholder="Internal notes…"
          />
        </Section>

        {/* Footer */}
        <div style={{ background: '#faf8f3', borderTop: '1px solid #ede8df', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#aaa292' }}>
          <span>All Purpose Flower · Fine Catering &amp; Events · San Francisco Bay Area</span>
          <span>{eoNum}</span>
        </div>
      </div>
    </div>
  );
}
