'use client';
import { useEffect, useState, useCallback } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type Stats = {
  totalLeads: number;
  convertedLeads: number;
  conversionRate: number;
  leadsByMonth: { label: string; count: number }[];
  winRateBySource: { source: string; total: number; converted: number; rate: number | null }[];
  avgDaysToBook: number | null;
  pipeline: { status: string; count: number }[];
  upcoming: { days: number; count: number }[];
  postEventHealth: number | null;
  avgGuests: number | null;
  topStyle: string | null;
  completedCount: number;
  activeCount: number;
  dayOfWeekBreakdown: { label: string; count: number }[];
  revenueForecast: { activeEvents: number; pipelineGuests: number; estimatedFoodRevenue: number };
};

const PIPELINE_COLORS: Record<string, string> = {
  New: '#2d5a9e', Booked: '#785e36', 'Menu Development': '#b45309',
  EO: '#6d28d9', Completed: '#38614a', Lost: '#aaa292',
};

const DOW_COLORS: Record<string, string> = {
  Fri: '#97784c', Sat: '#785e36', Sun: '#6d28d9',
};

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 600, marginBottom: '1rem' }}>{title}</div>
      {children}
    </div>
  );
}

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>{children}</div>;
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: '2.1rem', fontWeight: 500, color: color || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function BarChart({ data, colorKey }: { data: { label: string; count: number }[]; colorKey?: Record<string, string> }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
        {data.map(d => (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 500 }}>{d.count || ''}</div>
            <div style={{
              width: '100%', borderRadius: '3px 3px 0 0',
              background: colorKey ? (colorKey[d.label] || 'var(--brass-lt)') : 'var(--brass-lt)',
              height: `${Math.max((d.count / max) * 72, d.count > 0 ? 6 : 0)}px`,
              transition: 'height 0.3s',
            }} />
            <div style={{ fontSize: 10, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>{value}</span>
      </div>
      <div style={{ height: 6, background: 'var(--paper-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

function SourceRow({ source, total, converted, rate }: { source: string; total: number; converted: number; rate: number | null }) {
  const pct = rate ?? 0;
  const color = pct >= 50 ? 'var(--green)' : pct >= 25 ? 'var(--brass)' : '#b45309';
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--paper-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{source}</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{converted}/{total} converted</span>
          <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500, color: rate !== null ? color : 'var(--ink-4)' }}>
            {rate !== null ? `${rate}%` : '—'}
          </span>
        </div>
      </div>
      <div style={{ height: 5, background: 'var(--paper-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const authFetch = useCallback(async (url: string) => {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  }, []);

  useEffect(() => { document.title = 'Analytics | APF Admin'; }, []);

  useEffect(() => {
    authFetch('/api/admin/stats')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); });
  }, [authFetch]);

  if (loading || !stats) return <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '2rem 0' }}>Loading...</div>;

  const pipelineTotal = stats.pipeline.reduce((s, p) => s + p.count, 0);
  const activeStatuses = ['New', 'Booked', 'Menu Development', 'EO'];
  const activePipeline = stats.pipeline.filter(p => activeStatuses.includes(p.status));

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.75rem', fontWeight: 500 }}>Analytics</h1>
      </div>

      {/* ── Lead Funnel ─────────────────────────────────────────────────── */}
      <Section title="Lead Funnel">
        <KpiGrid>
          <Kpi label="Total Leads" value={String(stats.totalLeads)} sub="all time" />
          <Kpi label="Converted" value={String(stats.convertedLeads)} sub="became events" color="var(--green)" />
          <Kpi
            label="Conversion Rate"
            value={`${stats.conversionRate}%`}
            sub="leads → events"
            color={stats.conversionRate >= 50 ? 'var(--green)' : stats.conversionRate >= 25 ? 'var(--brass)' : '#b45309'}
          />
          <Kpi
            label="Avg Days to Book"
            value={stats.avgDaysToBook !== null ? String(stats.avgDaysToBook) : '—'}
            sub={stats.avgDaysToBook !== null ? 'lead to conversion' : 'needs converted_at column'}
            color={stats.avgDaysToBook !== null ? (stats.avgDaysToBook <= 7 ? 'var(--green)' : stats.avgDaysToBook <= 21 ? 'var(--brass)' : '#b45309') : 'var(--ink-4)'}
          />
        </KpiGrid>
      </Section>

      {/* ── Win Rate by Source ──────────────────────────────────────────── */}
      <Section title="Win Rate by Source">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
            {stats.winRateBySource.map(s => (
              <SourceRow key={s.source} {...s} />
            ))}
            {stats.winRateBySource.every(s => s.total === 0) && (
              <div style={{ fontSize: 13, color: 'var(--ink-4)', textAlign: 'center', padding: '1rem 0' }}>
                No leads yet — run SQL migration to tag sources
              </div>
            )}
          </div>
          <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>What this tells you</div>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.65, margin: 0 }}>
              Compare how well the public quote form converts vs. leads you enter manually from phone calls or referrals. A higher manual rate often means those clients are warmer — they sought you out directly.
            </p>
            <div style={{ marginTop: '1rem', padding: '10px 14px', background: 'var(--paper-2)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--ink-3)' }}>
              New manual leads are tagged automatically. Run <code style={{ background: 'var(--paper-3)', padding: '1px 5px', borderRadius: 3 }}>ALTER TABLE quotes ADD COLUMN source text DEFAULT 'form'</code> to enable tracking.
            </div>
          </div>
        </div>
      </Section>

      {/* ── Leads by Month ──────────────────────────────────────────────── */}
      <Section title="Leads by Month (Last 6 Months)">
        <BarChart data={stats.leadsByMonth} />
      </Section>

      {/* ── Pipeline ────────────────────────────────────────────────────── */}
      <Section title="Pipeline">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: '1rem' }}>All Events ({pipelineTotal})</div>
            {stats.pipeline.map(p => (
              <HorizontalBar key={p.status} label={p.status} value={p.count} total={pipelineTotal} color={PIPELINE_COLORS[p.status]} />
            ))}
          </div>
          <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: '1rem' }}>Active Only</div>
            <BarChart data={activePipeline.map(p => ({ label: p.status === 'Menu Development' ? 'Menu Dev' : p.status, count: p.count }))} colorKey={{ New: '#2d5a9e', Booked: '#785e36', 'Menu Dev': '#b45309', EO: '#6d28d9' }} />
          </div>
        </div>
      </Section>

      {/* ── Revenue Forecast ─────────────────────────────────────────────── */}
      <Section title="Revenue Forecast">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <div className="card" style={{ padding: '1.4rem 1.6rem' }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 6 }}>Active Pipeline</div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, color: 'var(--brass)' }}>{stats.revenueForecast.activeEvents}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>events in progress</div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 6 }}>Expected Guests</div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, color: 'var(--ink)' }}>{stats.revenueForecast.pipelineGuests.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>across all active events</div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 6 }}>Est. Food Revenue</div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, color: 'var(--green)' }}>
                  {stats.revenueForecast.pipelineGuests > 0 ? fmtMoney(stats.revenueForecast.estimatedFoodRevenue) : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>$65/guest · food only</div>
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--paper-2)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--ink-3)', borderLeft: '3px solid var(--brass-lt)' }}>
              Excludes staffing, bar, add-ons, service fee, and tax. Connect Square to see actual invoice totals here.
            </div>
          </div>
          <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>Coming with Square</div>
            {['Confirmed invoice totals', 'Deposit vs. balance due', 'Monthly revenue trend', 'Year-over-year growth'].map(item => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--paper-2)', fontSize: 12, color: 'var(--ink-3)' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--brass-lt)', flexShrink: 0 }} />
                {item}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Day of Week ──────────────────────────────────────────────────── */}
      <Section title="Events by Day of Week">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <BarChart
            data={stats.dayOfWeekBreakdown}
            colorKey={DOW_COLORS}
          />
          <div className="card" style={{ padding: '1.2rem 1.4rem' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 12 }}>Top Days</div>
            {stats.dayOfWeekBreakdown
              .filter(d => d.count > 0)
              .sort((a, b) => b.count - a.count)
              .slice(0, 4)
              .map((d, i) => (
                <div key={d.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--paper-2)' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--ink-4)', width: 16, textAlign: 'right' }}>#{i + 1}</span>
                    {d.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{d.count}</span>
                </div>
              ))}
            {stats.dayOfWeekBreakdown.every(d => d.count === 0) && (
              <div style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', padding: '1rem 0' }}>No event data yet</div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Upcoming Events ──────────────────────────────────────────────── */}
      <Section title="Upcoming Events">
        <KpiGrid>
          {stats.upcoming.map(u => (
            <Kpi key={u.days} label={`Next ${u.days} Days`} value={String(u.count)} sub="active events" color={u.count > 0 ? 'var(--brass)' : 'var(--ink)'} />
          ))}
        </KpiGrid>
      </Section>

      {/* ── Event Profile ────────────────────────────────────────────────── */}
      <Section title="Event Profile">
        <KpiGrid>
          {stats.avgGuests !== null && <Kpi label="Avg Guest Count" value={String(stats.avgGuests)} sub="across all event days" />}
          {stats.topStyle && <Kpi label="Top Service Style" value={stats.topStyle} sub="most requested" color="var(--brass)" />}
          <Kpi label="Completed Events" value={String(stats.completedCount)} sub="all time" color="var(--green)" />
        </KpiGrid>
      </Section>

      {/* ── Post-Event Follow-Through ─────────────────────────────────────── */}
      {stats.postEventHealth !== null && (
        <Section title="Post-Event Follow-Through">
          <div className="card" style={{ padding: '1.2rem 1.4rem', maxWidth: 480 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, color: stats.postEventHealth >= 80 ? 'var(--green)' : '#b45309' }}>
                {stats.postEventHealth}%
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>of completed events have all 6 post-event tasks done</div>
            </div>
            <div style={{ height: 8, background: 'var(--paper-3)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${stats.postEventHealth}%`, height: '100%', background: stats.postEventHealth >= 80 ? 'var(--green)' : '#b45309', borderRadius: 99, transition: 'width 0.4s' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
              Thank-you email · Photos · Rentals · Staff hours · Testimonial · Portfolio
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
