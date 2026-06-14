'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { calcPackage, calcBar, fmtD, STYLES } from '@/lib/pricing';

type Event = Record<string, unknown>;
interface LineItem { name: string; quantity: string; amount: number; }

// Auto-generate itemized lines from the configuration. This only SEEDS the
// editable table — once generated, every line can be edited or removed.
function autoLineItems(
  guests: number, style: string, hours: number,
  addons: { appetizers: number; dessert: boolean; coffee: boolean },
  bar: string | null, paymentMethod: string,
): LineItem[] {
  const pkg = calcPackage(guests, hours, style, addons);
  const barCalc = bar && ['Soft Bar', 'Full Bar'].includes(bar) ? calcBar(guests, bar) : null;
  const serviceBase = pkg.subtotal + (barCalc?.subtotal || 0);

  const items: LineItem[] = [
    { name: `Food — ${style} ($65/guest)`, quantity: String(guests), amount: 65 * guests },
    { name: `Staffing — ${pkg.staffing.waitstaff} waitstaff + ${pkg.staffing.captain} captain × ${pkg.staffing.totalHours} hrs`, quantity: '1', amount: round(pkg.staffing.cost) },
  ];
  if (pkg.apps > 0) items.push({ name: 'Passed Appetizers', quantity: '1', amount: round(pkg.apps) });
  if (pkg.dessert > 0) items.push({ name: 'Dessert', quantity: '1', amount: round(pkg.dessert) });
  if (pkg.coffee > 0) items.push({ name: 'Coffee & Tea Service', quantity: '1', amount: round(pkg.coffee) });
  if (pkg.minimumApplied) items.push({ name: 'Event Minimum Adjustment', quantity: '1', amount: round(pkg.subtotal - pkg.rawSubtotal) });
  if (barCalc) items.push({ name: `Bar Package — ${bar} (${barCalc.bartenders} bartender${barCalc.bartenders > 1 ? 's' : ''})`, quantity: '1', amount: round(barCalc.subtotal) });
  items.push({ name: 'Service Fee (10%)', quantity: '1', amount: round(serviceBase * 0.10) });
  items.push({ name: 'Sales Tax (9.25%)', quantity: '1', amount: round(serviceBase * 0.0925) });
  if (paymentMethod !== 'cash') items.push({ name: 'Card Processing (3.5%)', quantity: '1', amount: round(serviceBase * 0.035) });
  return items;
}

const round = (n: number) => Math.round(n * 100) / 100;
const sum = (items: LineItem[]) => round(items.reduce((s, i) => s + (Number(i.amount) || 0), 0));

export default function EstimatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [items, setItems] = useState<LineItem[]>([]);
  const [deposit, setDeposit] = useState<number>(0);
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
    const data = await r.json();
    setEvent(data);
    return data;
  }

  useEffect(() => {
    authFetch(`/api/admin/events/${id}`).then(r => r.json()).then(data => {
      setEvent(data);
      const stored = (data.estimate_line_items as LineItem[]) || null;
      if (stored && stored.length) {
        setItems(stored);
        setDeposit(Number(data.estimate_deposit) || round(sum(stored) * 0.25));
      }
      setLoading(false);
    });
  }, [id, authFetch]);

  // Debounced autosave of the working draft (skipped once locked)
  const save = useCallback((nextItems: LineItem[], nextDeposit: number, extra?: Record<string, unknown>) => {
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await authFetch(`/api/admin/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estimate_line_items: nextItems, estimate_total: sum(nextItems), estimate_deposit: nextDeposit, ...extra }),
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    }, 600);
  }, [id, authFetch]);

  const patchConfig = useCallback((updates: Record<string, unknown>) => {
    setEvent(prev => prev ? { ...prev, ...updates } : prev);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await authFetch(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    }, 600);
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
  const paymentMethod = event.payment_method ? String(event.payment_method) : 'card';
  const locked = !!event.estimate_approved_at;

  const total = sum(items);
  const defaultDeposit = round(total * 0.25);

  function recalc() {
    if (items.length && !confirm('Replace the current line items with freshly calculated ones from the configuration? Any manual edits will be lost.')) return;
    const next = autoLineItems(guests, style, hours, { appetizers, dessert, coffee }, bar, paymentMethod);
    const dep = round(sum(next) * 0.25);
    setItems(next); setDeposit(dep);
    save(next, dep);
  }

  function editItem(idx: number, field: 'name' | 'amount', value: string) {
    const next = items.map((it, i) => i === idx ? { ...it, [field]: field === 'amount' ? (parseFloat(value) || 0) : value } : it);
    setItems(next);
    save(next, deposit);
  }
  function deleteItem(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    setItems(next);
    save(next, deposit);
  }
  function addItem() {
    const next = [...items, { name: '', quantity: '1', amount: 0 }];
    setItems(next);
    save(next, deposit);
  }
  function changeDeposit(v: string) {
    const d = parseFloat(v) || 0;
    setDeposit(d);
    save(items, d);
  }

  async function approve() {
    await authFetch(`/api/admin/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estimate_line_items: items, estimate_total: total, estimate_deposit: deposit, estimate_guests: guests, estimate_style: style, estimate_approved_at: new Date().toISOString() }),
    });
    loadEvent();
  }
  async function unlock() {
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
  async function unlinkInvoice() {
    if (!confirm('Cancel this invoice in Square and unlink it from the event? (Paid invoices cannot be canceled here.)')) return;
    const res = await authFetch('/api/admin/square/invoice', { method: 'DELETE', body: JSON.stringify({ event_id: id }) });
    const data = await res.json();
    if (!res.ok) { setInvoiceMsg(data.error || 'Failed to unlink'); return; }
    setInvoiceMsg('Invoice canceled in Square and unlinked'); loadEvent();
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
      <div style={{ marginBottom: '1.25rem' }}>
        <button onClick={() => router.push(`/admin/events/${id}`)} style={{ background: 'none', border: 'none', color: 'var(--ink-4)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', padding: 0 }}>← Event</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.7rem', fontWeight: 500 }}>Estimate</h1>
        <span style={{ fontSize: 12, color: saveState === 'saved' ? 'var(--green)' : 'var(--ink-4)' }}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : ''}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: '1.5rem' }}>{String(event.client_names)}{event.quote_number ? ` · ${String(event.quote_number)}` : ''}</div>

      {/* Configuration */}
      <div className="card" style={{ padding: '1.2rem 1.4rem', marginBottom: '1.25rem', opacity: locked ? 0.55 : 1, pointerEvents: locked ? 'none' : 'auto' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 14 }}>Configuration</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
          <div><div style={labelStyle}>Guests</div><input type="number" min="1" value={guests || ''} onChange={e => patchConfig({ estimate_guests: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} /></div>
          <div><div style={labelStyle}>Service Style</div><select value={style} onChange={e => patchConfig({ estimate_style: e.target.value })} style={{ width: '100%', ...selectStyle }}>{STYLES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><div style={labelStyle}>Event Hours</div><input type="number" min="1" max="16" value={hours} onChange={e => patchConfig({ event_hours: e.target.value ? Number(e.target.value) : 5 })} style={{ width: '100%', ...selectStyle }} /></div>
          <div><div style={labelStyle}>Bar</div><select value={bar || 'None'} onChange={e => patchConfig({ bar_package: e.target.value === 'None' ? null : e.target.value })} style={{ width: '100%', ...selectStyle }}>{['None', 'Soft Bar', 'Full Bar'].map(s => <option key={s}>{s}</option>)}</select></div>
          <div><div style={labelStyle}>Appetizers</div><select value={appetizers} onChange={e => patchConfig({ appetizer_count: Number(e.target.value) })} style={{ width: '100%', ...selectStyle }}>{[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          <div><div style={labelStyle}>Payment</div><select value={paymentMethod} onChange={e => patchConfig({ payment_method: e.target.value })} style={{ width: '100%', ...selectStyle }}><option value="card">Card</option><option value="cash">Cash / Check</option></select></div>
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}><input type="checkbox" checked={dessert} onChange={e => patchConfig({ include_dessert: e.target.checked })} /> Dessert</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}><input type="checkbox" checked={coffee} onChange={e => patchConfig({ include_coffee: e.target.checked })} /> Coffee & Tea</label>
          <div style={{ flex: 1 }} />
          <button onClick={recalc} className="btn btn-brass" style={{ fontSize: 12, padding: '7px 16px' }}>{items.length ? 'Recalculate from Config' : 'Calculate'}</button>
        </div>
        {paymentMethod === 'cash' && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10 }}>Cash/check selected — card processing (3.5%) is excluded when you recalculate.</div>}
      </div>

      {/* Line items */}
      {items.length > 0 && (
        <div className="card" style={{ padding: '1.2rem 1.4rem', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
            <span>{locked ? 'Approved Estimate' : 'Line Items'}</span>
            {locked && <span style={{ color: 'var(--green)' }}>✓ Approved {new Date(String(event.estimate_approved_at)).toLocaleDateString()}</span>}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--paper-2)' }}>
                  <td style={{ padding: '5px 0', width: '100%' }}>
                    {locked
                      ? <span style={{ color: 'var(--ink-2)' }}>{it.name}</span>
                      : <input value={it.name} onChange={e => editItem(i, 'name', e.target.value)} placeholder="Line description" style={{ width: '100%', border: '1px solid transparent', borderRadius: 4, padding: '4px 6px', fontSize: 13, fontFamily: 'var(--sans)', background: 'transparent' }} onFocus={e => e.currentTarget.style.borderColor = 'var(--rule)'} onBlur={e => e.currentTarget.style.borderColor = 'transparent'} />}
                  </td>
                  <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {locked
                      ? <span style={{ fontWeight: 500 }}>{fmtD(it.amount)}</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>$<input type="number" step="0.01" value={it.amount} onChange={e => editItem(i, 'amount', e.target.value)} style={{ width: 90, textAlign: 'right', border: '1px solid var(--rule)', borderRadius: 4, padding: '4px 6px', fontSize: 13, fontFamily: 'var(--sans)' }} /></span>}
                  </td>
                  {!locked && <td style={{ padding: '5px 0 5px 8px' }}><button onClick={() => deleteItem(i)} title="Remove line" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 15, lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--ink-4)'}>×</button></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--rule)' }}>
                <td style={{ padding: '10px 0 4px', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: 15 }}>Total</td>
                <td style={{ padding: '10px 0 4px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: 15 }} colSpan={locked ? 1 : 2}>{fmtD(total)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: 'var(--brass)', fontWeight: 600 }}>Deposit</td>
                <td style={{ padding: '4px 0', textAlign: 'right' }} colSpan={locked ? 1 : 2}>
                  {locked
                    ? <span style={{ color: 'var(--brass)', fontWeight: 600 }}>{fmtD(deposit)}</span>
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--brass)', fontWeight: 600 }}>$<input type="number" step="0.01" value={deposit} onChange={e => changeDeposit(e.target.value)} style={{ width: 100, textAlign: 'right', border: '1px solid var(--rule)', borderRadius: 4, padding: '4px 6px', fontSize: 13, fontFamily: 'var(--sans)', color: 'var(--brass)', fontWeight: 600 }} /></span>}
                </td>
              </tr>
            </tfoot>
          </table>

          {!locked && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
              <button onClick={addItem} style={{ background: 'none', border: '1px dashed var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>+ Add line</button>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>25% would be {fmtD(defaultDeposit)}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            {locked
              ? <button onClick={unlock} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '9px 18px', fontSize: 13, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Unlock to Edit</button>
              : <button onClick={approve} className="btn btn-brass" style={{ fontSize: 13, padding: '9px 22px' }}>Approve Estimate</button>}
          </div>
        </div>
      )}

      {/* Square */}
      {locked && (
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
              <button onClick={unlinkInvoice} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-4)', fontFamily: 'var(--sans)' }}>Unlink</button>
            </div>
          ) : !event.client_email && !event.client_phone ? (
            <div style={{ background: '#fff8ed', border: '1px solid #d97706', borderRadius: 'var(--r-sm)', padding: '10px 14px', fontSize: 12, color: '#92400e' }}>
              Add a <strong>client email or phone</strong> on the <button onClick={() => router.push(`/admin/events/${id}`)} style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 12, padding: 0 }}>event page</button> before creating the invoice — Square needs it to send.
            </div>
          ) : (
            <div>
              <button onClick={createInvoice} disabled={invoiceLoading} style={{ background: '#006aff', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '9px 22px', fontSize: 13, fontWeight: 600, cursor: invoiceLoading ? 'wait' : 'pointer', fontFamily: 'var(--sans)', opacity: invoiceLoading ? 0.7 : 1 }}>{invoiceLoading ? 'Creating…' : 'Create Invoice in Square'}</button>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>Builds the invoice from the approved line items in Square. It is <strong>not</strong> emailed to the client automatically — open it, review, and send it from Square when ready.</div>
            </div>
          )}
          {invoiceMsg && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>{invoiceMsg}</div>}

          {!!event.square_customer_id && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--paper-3)' }}>
              <button onClick={syncSquare} disabled={syncing} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12, cursor: syncing ? 'wait' : 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>{syncing ? 'Syncing…' : '↻ Sync from Square'}</button>
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
              {otherInvoiceCount > 0 && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>This client has {otherInvoiceCount} other invoice{otherInvoiceCount > 1 ? 's' : ''} in Square from other events (not shown).</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
