'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { calcPackage, fmtD, STYLES, BAR_TYPES, ADDON_PRESETS } from '@/lib/pricing';

type Event = Record<string, unknown>;
interface LineItem { name: string; quantity: string; amount: number; }

interface Cfg {
  guests: number; style: string; hours: number;
  appetizers: number; dessert: boolean; coffee: boolean; coffeeGuests: number;
  bar: string; barPrice: number; paymentMethod: string;
  foodPrice: number; serviceFeeRate: number; includeCaptain: boolean;
  setupBreakdown: number; ratio: number | null; applyMinimum: boolean;
}

// Auto-generate itemized lines from config. Only SEEDS the editable table.
function autoLineItems(c: Cfg): LineItem[] {
  const pkg = calcPackage(c.guests, c.hours, c.style, {
    appetizers: c.appetizers, dessert: false, coffee: false,
    foodPerGuest: c.foodPrice, serviceFeeRate: c.serviceFeeRate / 100,
    includeCaptain: c.includeCaptain, setupBreakdownHours: c.setupBreakdown,
    staffRatio: c.ratio ?? undefined, applyMinimum: c.applyMinimum,
  });
  const barType = BAR_TYPES[c.bar];
  const barBase = c.bar !== 'None' && barType ? round(c.barPrice * c.guests) : 0;
  const bartenders = c.bar !== 'None' && barType?.guestsPerBartender ? Math.ceil(c.guests / barType.guestsPerBartender) : 0;
  const serviceBase = pkg.subtotal + barBase;

  const staffParts = [`${pkg.staffing.waitstaff} waitstaff`, c.includeCaptain ? '1 captain' : null].filter(Boolean).join(' + ');
  const items: LineItem[] = [
    { name: `Food — ${c.style} ($${c.foodPrice}/guest)`, quantity: String(c.guests), amount: round(c.foodPrice * c.guests) },
    { name: `Staffing — ${staffParts} × ${pkg.staffing.totalHours} hrs`, quantity: '1', amount: round(pkg.staffing.cost) },
  ];
  if (pkg.apps > 0) items.push({ name: `Appetizers (${c.appetizers} passed)`, quantity: '1', amount: round(pkg.apps) });
  if (c.dessert) items.push({ name: 'Dessert', quantity: '1', amount: round(4.75 * c.guests) });
  if (c.coffee) items.push({ name: 'Coffee & Tea', quantity: '1', amount: round(2.85 * (c.coffeeGuests || c.guests)) });
  if (pkg.minimumApplied) items.push({ name: 'Event Minimum Adjustment', quantity: '1', amount: round(pkg.subtotal - pkg.rawSubtotal) });
  if (barBase > 0) items.push({ name: `${c.bar} ($${c.barPrice}/guest${bartenders ? `, ${bartenders} bartender${bartenders > 1 ? 's' : ''}` : ''})`, quantity: '1', amount: barBase });
  items.push({ name: `Service Fee (${c.serviceFeeRate}%)`, quantity: '1', amount: round(serviceBase * c.serviceFeeRate / 100) });
  items.push({ name: 'Sales Tax (9.25%)', quantity: '1', amount: round(serviceBase * 0.0925) });
  if (c.paymentMethod !== 'cash') items.push({ name: 'Card Processing (3.5%)', quantity: '1', amount: round(serviceBase * 0.035) });
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

  // Debounced autosave of the working draft. `nextTotal` is the final (post-discount) total.
  const save = useCallback((nextItems: LineItem[], nextDeposit: number, nextTotal: number, extra?: Record<string, unknown>) => {
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await authFetch(`/api/admin/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estimate_line_items: nextItems, estimate_total: nextTotal, estimate_deposit: nextDeposit, ...extra }),
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
  const mainDays = days.filter(d => (d.day_type || 'Main') === 'Main');
  const dayGuests = mainDays.reduce((s, d) => s + (Number(d.guests) || 0), 0);
  const firstStyle = mainDays[0]?.service_style ? String(mainDays[0].service_style) : 'Buffet';

  const guests = Number(event.estimate_guests) || dayGuests || 0;
  const cfg: Cfg = {
    guests,
    style: event.estimate_style ? String(event.estimate_style) : firstStyle,
    hours: Number(event.event_hours) || 5,
    appetizers: Number(event.appetizer_count) || 0,
    dessert: event.include_dessert === true,
    coffee: event.include_coffee === true,
    coffeeGuests: Number(event.coffee_guests) || guests,
    bar: event.bar_package ? String(event.bar_package) : 'None',
    barPrice: event.bar_price_per_guest != null ? Number(event.bar_price_per_guest) : (BAR_TYPES[event.bar_package ? String(event.bar_package) : 'None']?.perGuest ?? 0),
    paymentMethod: event.payment_method ? String(event.payment_method) : 'card',
    foodPrice: event.food_price_per_guest != null ? Number(event.food_price_per_guest) : 65,
    serviceFeeRate: event.service_fee_rate != null ? Number(event.service_fee_rate) : 10,
    includeCaptain: event.include_captain !== false,
    setupBreakdown: event.setup_breakdown_hours != null ? Number(event.setup_breakdown_hours) : 4,
    ratio: event.staff_ratio_override != null ? Number(event.staff_ratio_override) : null,
    applyMinimum: event.apply_event_minimum === true,
  };
  const locked = !!event.estimate_approved_at;
  const discount = Number(event.estimate_discount) || 0;
  const discountLabel = event.estimate_discount_label ? String(event.estimate_discount_label) : 'Discount';

  const total = round(sum(items) - discount);
  const defaultDeposit = round(total * 0.25);

  const finalTotal = (its: LineItem[]) => round(sum(its) - discount);

  function recalc() {
    if (items.length && !confirm('Replace the current line items with freshly calculated ones from the configuration? Any manual edits will be lost.')) return;
    const next = autoLineItems(cfg);
    const dep = round(finalTotal(next) * 0.25);
    setItems(next); setDeposit(dep);
    save(next, dep, finalTotal(next));
  }

  function editItem(idx: number, field: 'name' | 'amount', value: string) {
    const next = items.map((it, i) => i === idx ? { ...it, [field]: field === 'amount' ? (parseFloat(value) || 0) : value } : it);
    setItems(next);
    save(next, deposit, finalTotal(next));
  }
  function deleteItem(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    setItems(next);
    save(next, deposit, finalTotal(next));
  }
  function addItem() {
    const next = [...items, { name: '', quantity: '1', amount: 0 }];
    setItems(next);
    save(next, deposit, finalTotal(next));
  }
  function changeDeposit(v: string) {
    const d = parseFloat(v) || 0;
    setDeposit(d);
    save(items, d, finalTotal(items));
  }
  function setDiscount(amount: number, label: string) {
    patchConfig({ estimate_discount: amount || null, estimate_discount_label: label || null });
  }

  async function approve() {
    await authFetch(`/api/admin/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estimate_line_items: items, estimate_total: total, estimate_deposit: deposit, estimate_guests: guests, estimate_style: cfg.style, estimate_approved_at: new Date().toISOString() }),
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
    setInvoiceMsg('Draft invoice created in Square — review it, then Send to Client');
    loadEvent();
  }
  async function sendInvoice() {
    if (!confirm(`Send this invoice to ${event?.client_email ? String(event.client_email) : 'the client'}? Square will email it to them.`)) return;
    setInvoiceLoading(true); setInvoiceMsg('');
    const res = await authFetch('/api/admin/square/invoice/send', { method: 'POST', body: JSON.stringify({ event_id: id }) });
    const data = await res.json();
    setInvoiceLoading(false);
    if (!res.ok) { setInvoiceMsg(data.error || 'Failed to send'); return; }
    setInvoiceMsg('Invoice sent to client ✓');
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14 }}>
          <div><div style={labelStyle}>Guests</div><input type="number" min="1" value={cfg.guests || ''} onChange={e => patchConfig({ estimate_guests: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} /></div>
          <div><div style={labelStyle}>Service Style</div><select value={cfg.style} onChange={e => patchConfig({ estimate_style: e.target.value })} style={{ width: '100%', ...selectStyle }}>{STYLES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><div style={labelStyle}>Food $/guest</div><input type="number" min="0" step="1" value={cfg.foodPrice} onChange={e => patchConfig({ food_price_per_guest: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} /></div>
          <div><div style={labelStyle}>Event Hours</div><input type="number" min="1" max="16" value={cfg.hours} onChange={e => patchConfig({ event_hours: e.target.value ? Number(e.target.value) : 5 })} style={{ width: '100%', ...selectStyle }} /></div>
          <div><div style={labelStyle}>Setup+Break hrs</div><input type="number" min="0" max="8" value={cfg.setupBreakdown} onChange={e => patchConfig({ setup_breakdown_hours: e.target.value !== '' ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} /></div>
          <div><div style={labelStyle}>Staff ratio 1:</div><input type="number" min="1" placeholder={`${cfg.style === 'Plated' ? 10 : cfg.style === 'Family Style' ? 13 : 25}`} value={cfg.ratio ?? ''} onChange={e => patchConfig({ staff_ratio_override: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} /></div>
          <div><div style={labelStyle}>Service Fee</div><select value={cfg.serviceFeeRate} onChange={e => patchConfig({ service_fee_rate: Number(e.target.value) })} style={{ width: '100%', ...selectStyle }}>{[0,5,10,15].map(n => <option key={n} value={n}>{n}%</option>)}</select></div>
          <div><div style={labelStyle}>Bar</div><select value={cfg.bar} onChange={e => { const b = e.target.value; patchConfig({ bar_package: b === 'None' ? null : b, bar_price_per_guest: BAR_TYPES[b]?.perGuest ?? null }); }} style={{ width: '100%', ...selectStyle }}>{Object.keys(BAR_TYPES).map(s => <option key={s}>{s}</option>)}</select></div>
          {cfg.bar !== 'None' && <div><div style={labelStyle}>Bar $/guest</div><input type="number" min="0" value={cfg.barPrice} onChange={e => patchConfig({ bar_price_per_guest: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} /></div>}
          <div><div style={labelStyle}>Appetizers</div><select value={cfg.appetizers} onChange={e => patchConfig({ appetizer_count: Number(e.target.value) })} style={{ width: '100%', ...selectStyle }}>{[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          {cfg.coffee && <div><div style={labelStyle}>Coffee guests</div><input type="number" min="0" placeholder={String(cfg.guests)} value={event.coffee_guests != null ? Number(event.coffee_guests) : ''} onChange={e => patchConfig({ coffee_guests: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%', ...selectStyle }} /></div>}
          <div><div style={labelStyle}>Payment</div><select value={cfg.paymentMethod} onChange={e => patchConfig({ payment_method: e.target.value })} style={{ width: '100%', ...selectStyle }}><option value="card">Card</option><option value="cash">Cash / Check</option></select></div>
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}><input type="checkbox" checked={cfg.includeCaptain} onChange={e => patchConfig({ include_captain: e.target.checked })} /> Captain</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}><input type="checkbox" checked={cfg.dessert} onChange={e => patchConfig({ include_dessert: e.target.checked })} /> Dessert</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}><input type="checkbox" checked={cfg.coffee} onChange={e => patchConfig({ include_coffee: e.target.checked })} /> Coffee & Tea</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }} title="Floor the subtotal to the $5,000 event minimum"><input type="checkbox" checked={cfg.applyMinimum} onChange={e => patchConfig({ apply_event_minimum: e.target.checked })} /> $5k min</label>
          <div style={{ flex: 1 }} />
          <button onClick={recalc} className="btn btn-brass" style={{ fontSize: 12, padding: '7px 16px' }}>{items.length ? 'Recalculate from Config' : 'Calculate'}</button>
        </div>
        {cfg.paymentMethod === 'cash' && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10 }}>Cash/check selected — card processing (3.5%) is excluded when you recalculate.</div>}
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
              {discount > 0 && (
                <>
                  <tr style={{ borderTop: '2px solid var(--rule)' }}>
                    <td style={{ padding: '8px 0 2px', color: 'var(--ink-3)' }}>Subtotal</td>
                    <td style={{ padding: '8px 0 2px', textAlign: 'right', color: 'var(--ink-3)' }} colSpan={locked ? 1 : 2}>{fmtD(sum(items))}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '2px 0', color: 'var(--green)' }}>{discountLabel}</td>
                    <td style={{ padding: '2px 0', textAlign: 'right', color: 'var(--green)' }} colSpan={locked ? 1 : 2}>−{fmtD(discount)}</td>
                  </tr>
                </>
              )}
              <tr style={discount > 0 ? {} : { borderTop: '2px solid var(--rule)' }}>
                <td style={{ padding: '8px 0 4px', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: 15 }}>Total</td>
                <td style={{ padding: '8px 0 4px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: 15 }} colSpan={locked ? 1 : 2}>{fmtD(total)}</td>
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
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
                <button onClick={addItem} style={{ background: 'none', border: '1px dashed var(--rule)', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>+ Add line</button>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>25% would be {fmtD(defaultDeposit)}</span>
              </div>

              {/* Add-on preset library */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--paper-3)' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>Add Common Items</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ADDON_PRESETS.map(p => (
                    <button key={p.name} onClick={() => {
                      const amt = p.unit === 'guest' ? round(p.rate * cfg.guests) : p.rate;
                      const label = p.unit === 'guest' ? `${p.name} ($${p.rate}/guest)` : p.unit === 'each' ? `${p.name} ($${p.rate} ea)` : p.name;
                      const next = [...items, { name: label, quantity: '1', amount: amt }];
                      setItems(next); save(next, deposit, finalTotal(next));
                    }}
                      style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 99, padding: '4px 11px', fontSize: 11.5, cursor: 'pointer', color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brass)'; e.currentTarget.style.color = 'var(--brass)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rule)'; e.currentTarget.style.color = 'var(--ink-2)'; }}>
                      + {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Discount */}
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600 }}>Discount</span>
                <input value={discountLabel} onChange={e => setDiscount(discount, e.target.value)} placeholder="Label (e.g. Early Bird)" style={{ flex: '1 1 160px', fontSize: 12, padding: '5px 8px', border: '1px solid var(--rule)', borderRadius: 4 }} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>$<input type="number" min="0" step="0.01" value={discount || ''} onChange={e => setDiscount(parseFloat(e.target.value) || 0, discountLabel)} placeholder="0" style={{ width: 90, textAlign: 'right', fontSize: 12, padding: '5px 8px', border: '1px solid var(--rule)', borderRadius: 4 }} /></span>
                {[5, 10].map(pct => <button key={pct} onClick={() => setDiscount(round(sum(items) * pct / 100), discountLabel === 'Discount' ? `Discount (${pct}%)` : discountLabel)} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '4px 9px', fontSize: 11, cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>{pct}%</button>)}
              </div>
            </>
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
          {!event.square_invoice_id ? (
            (!event.client_email && !event.client_phone) ? (
              <div style={{ background: '#fff8ed', border: '1px solid #d97706', borderRadius: 'var(--r-sm)', padding: '10px 14px', fontSize: 12, color: '#92400e' }}>
                Add a <strong>client email or phone</strong> on the <button onClick={() => router.push(`/admin/events/${id}`)} style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 12, padding: 0 }}>event page</button> before creating the invoice.
              </div>
            ) : (
              <div>
                <button onClick={createInvoice} disabled={invoiceLoading} style={{ background: '#006aff', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '9px 22px', fontSize: 13, fontWeight: 600, cursor: invoiceLoading ? 'wait' : 'pointer', fontFamily: 'var(--sans)', opacity: invoiceLoading ? 0.7 : 1 }}>{invoiceLoading ? 'Creating…' : 'Create Draft Invoice'}</button>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>Creates a <strong>draft</strong> in Square from the approved line items. Nothing is sent yet — you review it, then Send to Client.</div>
              </div>
            )
          ) : String(event.square_invoice_status) === 'DRAFT' && !event.invoice_sent_at ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#79715f', background: '#f4f4f4', border: '1px solid var(--rule)', borderRadius: 99, padding: '3px 11px' }}>DRAFT · NOT SENT</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={sendInvoice} disabled={invoiceLoading} className="btn btn-brass" style={{ fontSize: 13, padding: '9px 20px', opacity: invoiceLoading ? 0.7 : 1 }}>{invoiceLoading ? 'Sending…' : 'Send to Client →'}</button>
                <a href={String(event.square_invoice_url)} target="_blank" rel="noreferrer" style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 12, fontWeight: 500, textDecoration: 'none', color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>Review in Square ↗</a>
                <button onClick={unlinkInvoice} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-4)', fontFamily: 'var(--sans)' }}>Discard</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>Send emails the invoice to {event.client_email ? <strong>{String(event.client_email)}</strong> : 'the client'} via Square.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {!!event.invoice_sent_at && <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fff7ed', border: '1px solid #f0d8b8', borderRadius: 99, padding: '3px 11px' }}>SENT {new Date(String(event.invoice_sent_at)).toLocaleDateString()}</span>}
              {!!event.square_invoice_url && <a href={String(event.square_invoice_url)} target="_blank" rel="noreferrer" style={{ background: '#006aff', color: '#fff', borderRadius: 'var(--r-sm)', padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'var(--sans)' }}>Open in Square ↗</a>}
              <button onClick={unlinkInvoice} style={{ background: 'none', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-4)', fontFamily: 'var(--sans)' }}>Unlink</button>
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
