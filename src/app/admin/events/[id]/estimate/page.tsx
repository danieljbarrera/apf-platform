'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { calcPackage, calcBar, fmtD, STYLES } from '@/lib/pricing';

type Event = Record<string, unknown>;

interface LineItem { name: string; quantity: string; amount: number; }

function buildLineItems(guests: number, style: string, hours: number, addons: { appetizers: number; dessert: boolean; coffee: boolean }, bar: string | null): { items: LineItem[]; total: number; deposit: number } {
  const pkg = calcPackage(guests, hours, style, addons);
  const barCalc = bar && ['Soft Bar', 'Full Bar'].includes(bar) ? calcBar(guests, bar) : null;
  const serviceBase = pkg.subtotal + (barCalc?.subtotal || 0);

  const items: LineItem[] = [
    { name: `Food — ${style} ($65/guest)`, quantity: String(guests), amount: 65 * guests },
    { name: `Staffing — ${pkg.staffing.waitstaff} waitstaff + ${pkg.staffing.captain} captain × ${pkg.staffing.totalHours} hrs`, quantity: '1', amount: pkg.staffing.cost },
  ];
  if (pkg.apps > 0) items.push({ name: 'Passed Appetizers', quantity: '1', amount: pkg.apps });
  if (pkg.dessert > 0) items.push({ name: 'Dessert', quantity: '1', amount: pkg.dessert });
  if (pkg.coffee > 0) items.push({ name: 'Coffee & Tea Service', quantity: '1', amount: pkg.coffee });
  if (pkg.minimumApplied) items.push({ name: 'Event Minimum Adjustment', quantity: '1', amount: pkg.subtotal - pkg.rawSubtotal });
  if (barCalc) items.push({ name: `Bar Package — ${bar} (${barCalc.bartenders} bartender${barCalc.bartenders > 1 ? 's' : ''})`, quantity: '1', amount: barCalc.subtotal });
  items.push({ name: 'Service Fee (10%)', quantity: '1', amount: serviceBase * 0.10 });
  items.push({ name: 'Sales Tax (9.25%)', quantity: '1', amount: serviceBase * 0.0925 });
  items.push({ name: 'Card Processing (3.5%)', quantity: '1', amount: serviceBase * 0.035 });

  const total = pkg.total + (barCalc?.total || 0);
  return { items, total, deposit: Math.round(total * 0.25 * 100) / 100 };
}

export default function EstimatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [invoiceMsg, setInvoiceMsg] = useState('');
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedInvoices, setSyncedInvoices] = useState<{ id: string; status: string; public_url: string; total: number | null; invoice_number?: string }[] | null>(null);
  const [otherInvoiceCount, setOtherInvoiceCount] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authFetch = useCallback(async (url: string, options?: RequestInit) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...options?.headers } });
  }, []);

  async function loadEvent() {
    const r = await authFetch(`/api/admin/events/${id}`);
    setEvent(await r.json());
  }

  useEffect(() => {
    authFetch(`/api/admin/events/${id}`).then(r => r.json()).then(data => { setEvent(data); setLoading(false); });
  }, [id, authFetch]);

  const patch = useCallback((updates: Record<string, unknown>) => {
    setEvent(prev => prev ? { ...prev, ...updates } : prev);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await authFetch(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    }, 500);
  }, [id, authFetch]);

  if (loading || !event) return <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '2rem' }}>Loading…</div>;

  const days = ((event.event_days as Event[]) || []).sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  const dayGuests = days.reduce((s, d) => s + (Number(d.guests) || 0), 0);
  const firstStyle = days[0]?.service_style ? String(days[0].service_style) : 'Buffet';

  const guests = Number(event.estimate_guests) || dayGuests || 0;
  const style = event.estimate_style ? String(event.estimate_style) : firstStyle;
  const hours = Number(event.event_hours) || 5;
  const appetizers = Number(event.appetizer_count) || 0;
  const dessert = event.include_dessert === true;
  const coffee = event.include_coffee === true;
  const bar = event.bar_package ? String(event.bar_package) : null;

  const live = guests > 0 ? buildLineItems(guests, style, hours, { appetizers, dessert, coffee }, bar) : null;
  const approved = !!event.estimate_approved_at;
  const approvedItems = (event.estimate_line_items as LineItem[]) || null;

  // Has the config changed since approval?
  const drifted = approved && live && JSON.stringify(live.items) !== JSON.stringify(approvedItems);

  async function approve() {
    if (!live) return;
    await authFetch(`/api/admin/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        estimate_line_items: live.items,
        estimate_total: live.total,
        estimate_deposit: live.deposit,
        estimate_approved_at: new Date().toISOString(),
        estimate_guests: guests,
        estimate_style: style,
      }),
    });
    loadEvent();
  }

  async function unapprove() {
    await authFetch(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify({ estimate_approved_at: null }) });
    loadEvent();
  }

  async function createInvoice() {
    setInvoiceLoading(true); setInvoiceMsg('');
    const res = await authFetch('/api/admin/square/invoice', { method: 'POST', body: JSON.stringify({ event_id: id }) });
    const data = await res.json();
    setInvoiceLoading(false);
    if (!res.ok) { setInvoiceMsg(data.error || 'Failed'); return; }
    setInvoiceMsg(data.already_exists ? 'Draft already exists in Square' : 'Draft invoice created in Square — review & send there');
    loadEvent();
  }

  async function syncSquare() {
    setSyncing(true);
    const res = await authFetch('/api/admin/square/sync', { method: 'POST', body: JSON.stringify({ event_id: id }) });
    const data = await res.json();
    setSyncing(false);
    if (res.ok) { setSyncedInvoices(data.invoices || []); setOtherInvoiceCount(data.client_other_invoice_count || 0); loadEvent(); }
  }

  const selectStyle: React.CSSProperties = { fontSize: 13, padding: '6px 10px' };
  const labelStyle: React.CSSProperties = { fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button onClick={() => router.push(`/admin/events/${id}`)} style={{ background: 'none', border: 'none', color: 'var(--ink-4)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', padding: 0 }}>← Event</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.7rem', fontWeight: 500 }}>Estimate</h1>
        <span style={{ fontSize: 12, color: saveState === 'saved' ? 'var(--green)' : 'var(--ink-4)' }}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : ''}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: '1.5rem' }}>{String(event.client_names)}{event.quote_number ? ` · ${String(event.quote_number)}` : ''}</div>

      {/* Config editor */}
      <div className="card" style={{ padding: '1.2rem 1.4rem', marginBottom: '1.25rem', opacity: approved ? 0.6 : 1, pointerEvents: approved ? 'none' : 'auto' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 14 }}>Configuration</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
          <div>
            <div style={labelStyle}>Guests</div>
            <input type="number" min="1" value={guests || ''} onChange={e => patch({ estimate_guests: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} />
          </div>
          <div>
            <div style={labelStyle}>Service Style</div>
            <select value={style} onChange={e => patch({ estimate_style: e.target.value })} style={{ width: '100%', ...selectStyle }}>
              {STYLES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={labelStyle}>Event Hours</div>
            <input type="number" min="1" max="16" value={hours} onChange={e => patch({ event_hours: e.target.value ? Number(e.target.value) : 5 })} style={{ width: '100%', ...selectStyle }} />
          </div>
          <div>
            <div style={labelStyle}>Bar</div>
            <select value={bar || 'None'} onChange={e => patch({ bar_package: e.target.value === 'None' ? null : e.target.value })} style={{ width: '100%', ...selectStyle }}>
              {['None', 'Soft Bar', 'Full Bar'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={labelStyle}>Appetizers</div>
            <select value={appetizers} onChange={e => patch({ appetizer_count: Number(e.target.value) })} style={{ width: '100%', ...selectStyle }}>
              {[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={dessert} onChange={e => patch({ include_dessert: e.target.checked })} /> Dessert
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={coffee} onChange={e => patch({ include_coffee: e.target.checked })} /> Coffee & Tea
          </label>
        </div>
      </div>

      {/* Live breakdown */}
      {live && (
        <div className="card" style={{ padding: '1.2rem 1.4rem', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
            <span>{approved ? 'Approved Estimate' : 'Preview'}</span>
            {approved && <span style={{ color: 'var(--green)' }}>✓ Approved {new Date(String(event.estimate_approved_at)).toLocaleDateString()}</span>}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {(approved && approvedItems ? approvedItems : live.items).map((it, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--paper-2)' }}>
                  <td style={{ padding: '7px 0', color: 'var(--ink-2)' }}>{it.name}</td>
                  <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--ink)', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtD(it.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--rule)' }}>
                <td style={{ padding: '10px 0 4px', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: 15 }}>Total</td>
                <td style={{ padding: '10px 0 4px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: 15 }}>{fmtD(approved && event.estimate_total ? Number(event.estimate_total) : live.total)}</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 0', color: 'var(--brass)', fontWeight: 600 }}>25% Deposit</td>
                <td style={{ padding: '2px 0', textAlign: 'right', color: 'var(--brass)', fontWeight: 600 }}>{fmtD(approved && event.estimate_deposit ? Number(event.estimate_deposit) : live.deposit)}</td>
              </tr>
            </tfoot>
          </table>

          {drifted && (
            <div style={{ marginTop: 14, background: '#fff8ed', border: '1px solid #d97706', borderRadius: 'var(--r-sm)', padding: '8px 12px', fontSize: 12, color: '#92400e' }}>
              Configuration changed since approval. Re-approve to update the locked estimate.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            {!approved ? (
              <button onClick={approve} className="btn btn-brass" style={{ fontSize: 13, padding: '9px 22px' }}>Approve Estimate</button>
            ) : (
              <>
                <button onClick={unapprove} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '9px 18px', fontSize: 13, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Unlock to Edit</button>
                {drifted && <button onClick={approve} className="btn btn-brass" style={{ fontSize: 13, padding: '9px 18px' }}>Re-approve</button>}
              </>
            )}
          </div>
        </div>
      )}

      {/* Square invoice */}
      {approved && (
        <div className="card" style={{ padding: '1.2rem 1.4rem', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 12 }}>Square Invoice</div>
          {(!!event.deposit_paid_at || !!event.balance_paid_at) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {!!event.deposit_paid_at && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'var(--green-lt)', border: '1px solid #c4dccd', borderRadius: 99, padding: '3px 11px' }}>✓ Deposit paid</span>}
              {!!event.balance_paid_at && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'var(--green-lt)', border: '1px solid #c4dccd', borderRadius: 99, padding: '3px 11px' }}>✓ Balance paid</span>}
            </div>
          )}
          {event.square_invoice_url ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <a href={String(event.square_invoice_url)} target="_blank" rel="noreferrer" style={{ background: '#006aff', color: '#fff', borderRadius: 'var(--r-sm)', padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'var(--sans)' }}>Open in Square ↗</a>
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Review the draft in Square, then send it from there.</span>
            </div>
          ) : (
            <div>
              <button onClick={createInvoice} disabled={invoiceLoading} style={{ background: '#006aff', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '9px 22px', fontSize: 13, fontWeight: 600, cursor: invoiceLoading ? 'wait' : 'pointer', fontFamily: 'var(--sans)', opacity: invoiceLoading ? 0.7 : 1 }}>
                {invoiceLoading ? 'Creating…' : 'Create Draft Invoice in Square'}
              </button>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>Creates a draft from the approved line items. You review and send it from Square — nothing goes to the client automatically.</div>
            </div>
          )}
          {invoiceMsg && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>{invoiceMsg}</div>}

          {/* Sync — pull live invoice status/IDs from Square */}
          {!!event.square_customer_id && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--paper-3)' }}>
              <button onClick={syncSquare} disabled={syncing} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12, cursor: syncing ? 'wait' : 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
                {syncing ? 'Syncing…' : '↻ Sync from Square'}
              </button>
              {!!event.square_invoice_status && <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--ink-4)' }}>Status: <strong style={{ color: 'var(--ink-2)' }}>{String(event.square_invoice_status)}</strong></span>}
              {syncedInvoices && syncedInvoices.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {syncedInvoices.map(inv => (
                    <a key={inv.id} href={inv.public_url} target="_blank" rel="noreferrer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ink-2)', textDecoration: 'none', padding: '7px 10px', background: 'var(--paper-2)', borderRadius: 'var(--r-sm)' }}>
                      <span>{inv.invoice_number ? `#${inv.invoice_number}` : 'Draft'} · {inv.status}</span>
                      <span style={{ color: 'var(--brass)' }}>{inv.total != null ? fmtD(inv.total) : ''} ↗</span>
                    </a>
                  ))}
                </div>
              )}
              {syncedInvoices && syncedInvoices.length === 0 && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>No invoice linked to this event yet. Create the draft above to link one.</div>}
              {otherInvoiceCount > 0 && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>This client has {otherInvoiceCount} other invoice{otherInvoiceCount > 1 ? 's' : ''} in Square from other events (not shown — only this event&apos;s invoice is tracked here).</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
