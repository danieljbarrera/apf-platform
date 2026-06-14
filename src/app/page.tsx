'use client';
import { useState, useCallback } from 'react';
import { PRICING, STYLES, calcStaffing, calcPackage, calcBar, fmtD, fmt, type PackageCalc, type BarCalc } from '@/lib/pricing';

interface State {
  style: string | null;
  appetizers: number;
  dessert: boolean;
  coffee: boolean;
  bar: string | null;
  quoteId: string | null;
}

function prettyDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function QuotePage() {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<State>({ style: null, appetizers: 0, dessert: false, coffee: false, bar: null, quoteId: null });
  const [fb1, setFb1] = useState('');
  const [fb2, setFb2] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [edate, setEdate] = useState('');
  const [etype, setEtype] = useState('');
  const [venue, setVenue] = useState('');
  const [guests, setGuests] = useState('');
  const [hours, setHours] = useState('6');
  const [notes, setNotes] = useState('');

  const [fname, setFname] = useState('');
  const [lname, setLname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [packages, setPackages] = useState<Record<string, PackageCalc>>({});
  const [barQuote, setBarQuote] = useState<BarCalc | null>(null);

  const g = parseInt(guests) || 0;
  const h = parseFloat(hours) || 6;

  const summaryRows = useCallback(() => {
    const rows: [string, string][] = [];
    if (etype) rows.push(['✦', `<strong>${etype}</strong>${edate ? ` on <strong>${prettyDate(edate)}</strong>` : ''}`]);
    else if (edate) rows.push(['✦', `Event on <strong>${prettyDate(edate)}</strong>`]);
    if (venue) rows.push(['⚐', `At <strong>${venue}</strong>`]);
    if (g) rows.push(['☰', `<strong>${g} guests</strong> celebrating with you`]);
    if (g && h && state.style) {
      const st = calcStaffing(g, h, state.style);
      rows.push(['✦', `<strong>${state.style}</strong> service — ${PRICING.menuComposition[state.style]}`]);
      rows.push(['✧', `A team of <strong>${st.waitstaff} waitstaff</strong> and <strong>${st.captain} captain</strong> caring for your guests`]);
      rows.push(['◷', `<strong>${st.totalHours} hours</strong> on site — your ${h}-hour event plus full setup and breakdown`]);
    } else if (g && h) {
      rows.push(['◷', `<strong>${h}-hour</strong> celebration (+4 hrs setup & breakdown by our team)`]);
    }
    if (state.appetizers > 0 && g) rows.push(['✧', `<strong>${state.appetizers} passed appetizer${state.appetizers > 1 ? 's' : ''}</strong> during cocktail hour`]);
    const courses = [state.dessert && 'dessert', state.coffee && 'coffee & tea service'].filter(Boolean) as string[];
    if (courses.length) rows.push(['✧', `Finishing with <strong>${courses.join('</strong> and <strong>')}</strong>`]);
    if (state.bar && g) {
      const b = calcBar(g, state.bar);
      rows.push(['✦', `<strong>${state.bar}</strong> with ${b.bartenders} certified bartender${b.bartenders > 1 ? 's' : ''}`]);
    }
    return rows;
  }, [edate, etype, venue, g, h, state]);

  function goToStep(n: number) {
    if (n === 2) {
      if (!g || g < 10) { setFb1('Please enter your guest count (minimum 10).'); return; }
      if (!h) { setFb1('Please select your event duration.'); return; }
      if (!state.style) { setFb1('Please select a service style preference.'); return; }
      setFb1('');
    }
    setStep(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { window.parent.postMessage({ apfHeight: document.body.scrollHeight }, '*'); }, 600);
  }

  async function submitAndReveal() {
    if (!fname.trim()) { setFb2('Please enter your first name.'); return; }
    if (!lname.trim()) { setFb2('Please enter your last name.'); return; }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) { setFb2('Please enter a valid email.'); return; }
    setFb2('');
    setSubmitting(true);

    const quoteId = 'APF-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
    const pkgs: Record<string, PackageCalc> = {};
    STYLES.forEach(s => { pkgs[s] = calcPackage(g, h, s, { appetizers: state.appetizers, dessert: state.dessert, coffee: state.coffee }); });
    const bq = state.bar ? calcBar(g, state.bar) : null;

    setState(prev => ({ ...prev, quoteId }));
    setPackages(pkgs);
    setBarQuote(bq);

    const payload = {
      quote_id: quoteId,
      quote_number: quoteId,
      first_name: fname, last_name: lname, email, phone: phone || null,
      event_date: edate || null, event_type: etype || null, venue: venue || null,
      guests: g, hours: h, preferred_style: state.style,
      appetizers: state.appetizers, dessert: state.dessert, coffee_tea: state.coffee,
      bar_package: state.bar, notes: notes || null,
      total_buffet: pkgs['Buffet'].total, total_family: pkgs['Family Style'].total,
      total_plated: pkgs['Plated'].total, total_bar: bq ? bq.total : null, status: 'New',
    };

    await fetch('/api/submit-quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(console.warn);
    fetch('/api/send-quote-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fname, lname, email, phone, quoteId, eventType: etype, eventDate: edate, venue, guests: g, hours: h, preferredStyle: state.style, appetizers: state.appetizers, dessert: state.dessert, coffeeTea: state.coffee, barType: state.bar, notes, packages: pkgs, barQuote: bq }) }).catch(console.warn);

    setSubmitting(false);
    goToStep(3);
    setTimeout(() => {
      document.getElementById('grand-total')?.classList.add('in');
      document.querySelectorAll('.pkg').forEach((p, i) => { setTimeout(() => p.classList.add('in'), 200 + i * 160); });
    }, 120);
  }

  const rows = summaryRows();
  const styleOrder = state.style ? [state.style, ...STYLES.filter(s => s !== state.style)] : [...STYLES];

  return (
    <div className="wrap">
      <div className="masthead">
        <div className="masthead-orn"><span>✦</span></div>
        <div className="masthead-brand">All Purpose Flower · Fine Catering &amp; Events</div>
        <h1>Let&apos;s Plan Your Event</h1>
        <p className="masthead-sub">Tell us about your celebration and receive a detailed custom estimate.</p>
      </div>

      <div className="progress">
        {([['Your event', 1], ['Your details', 2], ['Your estimate', 3]] as [string, number][]).map(([label, n]) => (
          <div key={n} className={`prog-step${step === n ? ' active' : step > n ? ' done' : ''}`}>
            <div className="prog-dot">{n}</div>
            <div className="prog-label">{label}</div>
            {n < 3 && <div className="prog-line" />}
          </div>
        ))}
      </div>

      <div className={`step${step === 1 ? ' active' : ''}`}>
        <div className="step-grid">
          <div className="card">
            <div className="card-section">
              <div className="sec-head">The basics</div>
              <div className="field-row">
                <div className="field"><label>Event date</label><input type="date" value={edate} onChange={e => setEdate(e.target.value)} /></div>
                <div className="field">
                  <label>Event type</label>
                  <select value={etype} onChange={e => setEtype(e.target.value)}>
                    <option value="">Select...</option>
                    {['Wedding','Corporate event','Birthday celebration','Anniversary','Cocktail reception','Holiday party','Private dinner','Other'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Venue / location <span className="opt">(if known)</span></label><input type="text" value={venue} onChange={e => setVenue(e.target.value)} placeholder="e.g. Carousel House, Golden Gate Park" /></div>
            </div>
            <div className="card-section">
              <div className="sec-head">Guests &amp; timing</div>
              <div className="field-row">
                <div className="field"><label>Number of guests</label><input type="number" value={guests} onChange={e => setGuests(e.target.value)} placeholder="150" min="10" max="2000" /></div>
                <div className="field">
                  <label>Event duration (hours)</label>
                  <select value={hours} onChange={e => setHours(e.target.value)}>
                    {['3','4','5','6','7','8'].map(v => <option key={v} value={v}>{v} hours</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="card-section">
              <div className="sec-head">Service style preference</div>
              <p style={{ fontSize: '12.5px', color: 'var(--ink-3)', marginBottom: '1rem' }}>Your estimate will show all three styles — select the one you&apos;re leaning toward.</p>
              <div className="stylecards">
                {[{ s: 'Buffet', desc: 'Beautifully styled self-serve stations', note: 'Most relaxed' },
                  { s: 'Family Style', desc: 'Generous shared platters at each table', note: 'Most convivial' },
                  { s: 'Plated', desc: 'Elegant individually plated courses', note: 'Most refined' }].map(({ s, desc, note }) => (
                  <div key={s} className={`stylecard${state.style === s ? ' on' : ''}`} onClick={() => setState(prev => ({ ...prev, style: s }))}>
                    <div className="stylecard-check"><svg width="9" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg></div>
                    <span className="stylecard-name">{s}</span>
                    <span className="stylecard-desc">{desc}</span>
                    <div className="stylecard-note">{note}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-section">
              <div className="sec-head">Enhancements</div>
              <div className="field" style={{ marginBottom: '18px' }}>
                <label>Passed appetizers <span className="opt">($3 per person, per selection)</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '4px' }}>
                  <div className="stepper">
                    <button type="button" onClick={() => setState(prev => ({ ...prev, appetizers: Math.max(0, prev.appetizers - 1) }))}>−</button>
                    <input className="stepper-val" value={state.appetizers} readOnly />
                    <button type="button" onClick={() => setState(prev => ({ ...prev, appetizers: Math.min(6, prev.appetizers + 1) }))}>+</button>
                  </div>
                  <span style={{ fontSize: '12.5px', color: 'var(--ink-3)' }}>
                    {state.appetizers === 0 ? 'No appetizers selected' : `${state.appetizers} passed appetizer${state.appetizers > 1 ? 's' : ''} during cocktail hour`}
                  </span>
                </div>
              </div>
              <div className="field" style={{ marginBottom: '18px' }}>
                <label>Additional courses</label>
                <div className="chips" style={{ marginTop: '4px' }}>
                  <div className={`chip${state.dessert ? ' on' : ''}`} onClick={() => setState(prev => ({ ...prev, dessert: !prev.dessert }))}>Dessert <span className="chip-sub">$4.75/guest</span></div>
                  <div className={`chip${state.coffee ? ' on' : ''}`} onClick={() => setState(prev => ({ ...prev, coffee: !prev.coffee }))}>Coffee &amp; Tea <span className="chip-sub">$2.85/guest</span></div>
                </div>
              </div>
              <div className="field">
                <label>Bar service <span className="opt">(optional — quoted separately)</span></label>
                <div className="chips" style={{ marginTop: '4px' }}>
                  {['Soft Bar', 'Full Bar'].map(b => (
                    <div key={b} className={`chip${state.bar === b ? ' on' : ''}`} onClick={() => setState(prev => ({ ...prev, bar: prev.bar === b ? null : b }))}>
                      {b} <span className="chip-sub">${PRICING.bar[b].perGuest}/guest</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="card-section">
              <div className="sec-head">Anything else?</div>
              <div className="field"><label>Tell us about your vision <span className="opt">(optional)</span></label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Dietary needs, themes, special requests, questions..." /></div>
            </div>
            <div className="card-section">
              <button className="btn btn-brass btn-full" onClick={() => goToStep(2)}>Continue → See My Estimate</button>
              {fb1 && <div className="feedback error">{fb1}</div>}
            </div>
          </div>

          <div className="summary">
            <div className="summary-brand">Your event</div>
            <div className="summary-title">{rows.length >= 5 ? 'Looking wonderful' : 'Taking shape...'}</div>
            <div>
              {rows.length === 0
                ? <p className="summary-empty">Start filling in your event details and watch your celebration come together here.</p>
                : rows.map(([icon, html], i) => (
                  <div key={i} className="sumrow">
                    <span className="sumrow-icon">{icon}</span>
                    <span className="sumrow-text" dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                ))}
            </div>
            <div className="summary-note">Our team handles setup and breakdown — typically arriving 4 hours around your event time so everything is seamless.</div>
          </div>
        </div>
      </div>

      <div className={`step${step === 2 ? ' active' : ''}`}>
        <div className="card contact-card">
          <div className="contact-tease">
            <div className="contact-tease-icon">✓</div>
            <h2>Your estimate is ready</h2>
            <p>We&apos;ve prepared a detailed estimate with all three service styles for your <strong>{g}-guest {(etype || 'celebration').toLowerCase()}</strong>. Where should we send it?</p>
          </div>
          <div className="card-section">
            <div className="field-row">
              <div className="field"><label>First name</label><input type="text" value={fname} onChange={e => setFname(e.target.value)} placeholder="Jane" autoComplete="given-name" /></div>
              <div className="field"><label>Last name</label><input type="text" value={lname} onChange={e => setLname(e.target.value)} placeholder="Smith" autoComplete="family-name" /></div>
            </div>
            <div className="field"><label>Email address</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" autoComplete="email" /></div>
            <div className="field"><label>Phone <span className="opt">(so we can follow up personally)</span></label><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 555-5555" autoComplete="tel" /></div>
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => goToStep(1)}>← Back</button>
              <button className="btn btn-brass" disabled={submitting} onClick={submitAndReveal}>
                {submitting ? <><span className="spinner" /> Preparing...</> : 'View My Estimate'}
              </button>
            </div>
            {fb2 && <div className="feedback error">{fb2}</div>}
          </div>
        </div>
      </div>

      {step === 3 && Object.keys(packages).length > 0 && (() => {
        const pref = packages[state.style!];
        const grandTotal = pref.total + (barQuote ? barQuote.total : 0);
        const grandDeposit = grandTotal * PRICING.depositRate;
        return (
          <div className="step active">
            <div className="reveal-head">
              <div className="reveal-head-eyebrow">Prepared exclusively for</div>
              <h2>{fname} {lname}</h2>
              <p>{[etype, `${g} guests`, `${h}-hour event`, edate ? prettyDate(edate) : ''].filter(Boolean).join(' · ')}</p>
              <div className="reveal-id">Estimate {state.quoteId}</div>
            </div>
            <div className="grand show" id="grand-total">
              <div className="grand-eyebrow">Your selection — all in</div>
              <div className="grand-rows">
                <div className="grand-row">
                  <span className="lbl">{state.style} catering<span className="sub">{g} guests · full service, staff, tax & fees included</span></span>
                  <span className="amt">{fmtD(pref.total)}</span>
                </div>
                {barQuote && (
                  <div className="grand-row">
                    <span className="lbl">{state.bar}<span className="sub">{barQuote.bartenders} certified bartender{barQuote.bartenders > 1 ? 's' : ''} · tax & fees included</span></span>
                    <span className="amt">{fmtD(barQuote.total)}</span>
                  </div>
                )}
              </div>
              <div className="grand-total-row">
                <span className="grand-total-label">Estimated grand total</span>
                <span className="grand-total-amt">{fmtD(grandTotal)}</span>
              </div>
              <div className="grand-deposit">A <strong>{fmtD(grandDeposit)}</strong> deposit (25%) secures your date</div>
            </div>
            <p style={{ textAlign: 'center', fontSize: '12.5px', color: 'var(--ink-3)', marginBottom: '1.1rem' }}>Your preferred style is shown first — we&apos;ve included all three so you can compare.</p>
            <div className="pkg-grid">
              {styleOrder.map(style => {
                const p = packages[style];
                const st = p.staffing;
                const isPreferred = style === state.style;
                const pkgRows: [string, string, string][] = [
                  ['Food', `${g} × ${fmt(PRICING.foodPerGuest)}`, fmtD(p.food)],
                  ['Event staff', `${st.waitstaff} waitstaff + ${st.captain} captain × ${st.totalHours} hrs`, fmtD(p.staffing.cost)],
                ];
                if (p.apps) pkgRows.push([`Appetizers (${state.appetizers})`, `${g} × ${fmt(state.appetizers * PRICING.addons.appetizerPerPersonEach)}`, fmtD(p.apps)]);
                if (p.dessert) pkgRows.push(['Dessert', `${g} × ${fmtD(PRICING.addons.dessertPerGuest)}`, fmtD(p.dessert)]);
                if (p.coffee) pkgRows.push(['Coffee & Tea', `${g} × ${fmtD(PRICING.addons.coffeeTeaPerGuest)}`, fmtD(p.coffee)]);
                if (p.minimumApplied) pkgRows.push(['Event minimum', `Our ${fmt(PRICING.eventMinimum)} event minimum applies`, fmtD(PRICING.eventMinimum - p.rawSubtotal)]);
                pkgRows.push(['Subtotal', '', fmtD(p.subtotal)], ['Sales tax', `${(PRICING.salesTaxRate*100).toFixed(2)}%`, fmtD(p.tax)], ['Service fee', `${PRICING.serviceFeeRate*100}%`, fmtD(p.service)], ['Card processing', `${PRICING.chargeFeeRate*100}% — waived for check/cash`, fmtD(p.charge)]);
                return (
                  <div key={style} className={`pkg${isPreferred ? ' chosen' : ''}`}>
                    {isPreferred && <div className="pkg-flag">Your pick</div>}
                    <div className="pkg-head">
                      <div className="pkg-style">{style}</div>
                      <div className="pkg-comp">{PRICING.menuComposition[style]}</div>
                      <div className="pkg-total-label">Estimated total</div>
                      <div className="pkg-total counting">{fmtD(p.total)}</div>
                      <div className="pkg-deposit">25% deposit: {fmtD(p.deposit)} secures your date</div>
                    </div>
                    <div className="pkg-body">
                      {pkgRows.map(([label, sub, amt], i) => (
                        <div key={i} className="pkg-row">
                          <span className="lbl">{label}{sub && <span className="sub">{sub}</span>}</span>
                          <span className="amt">{amt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {barQuote && state.bar && (
              <div className="bar-reveal">
                <div className="bar-reveal-title">{state.bar} Service</div>
                <div className="bar-reveal-sub">{PRICING.bar[state.bar].description}</div>
                <div className="bar-line"><span>{g} guests × {fmt(PRICING.bar[state.bar].perGuest)} · {barQuote.bartenders} bartender{barQuote.bartenders > 1 ? 's' : ''}</span><span>{fmtD(barQuote.subtotal)}</span></div>
                <div className="bar-line"><span>Sales tax + service fee + card processing</span><span>{fmtD(barQuote.tax + barQuote.service + barQuote.charge)}</span></div>
                <div className="bar-line"><span style={{ fontWeight: 600 }}>Bar total</span><span className="amt">{fmtD(barQuote.total)}</span></div>
              </div>
            )}
            <div className="next-steps">
              <h3>Love what you see?</h3>
              <p>A copy of this estimate is on its way to your inbox. We&apos;ll reach out within 24 hours to talk through your vision, customize your menu, and answer every question.</p>
              <button className="btn btn-brass" onClick={() => window.location.href = 'https://allpurposeflowerco.com'}>Visit Our Website</button>
            </div>
            <p className="fine-print">This estimate is based on the details provided and current pricing. Final pricing is confirmed in your formal proposal after menu planning. Sales tax (9.25%), service fee (10%), and card processing fee (3.5%, waived for check or cash payment) are included in totals shown. A 25% deposit secures your date.</p>
          </div>
        );
      })()}
    </div>
  );
}
