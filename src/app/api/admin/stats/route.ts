import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

export async function GET(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [quotesRes, eventsRes] = await Promise.all([
    supabaseAdmin.from('quotes').select('converted, created_at'),
    supabaseAdmin.from('events').select(`
      status, created_at,
      thank_you_email_sent, photos_received, rentals_reconciled,
      staff_hours_reviewed, testimonial_received, added_to_portfolio,
      event_days(event_date, guests)
    `),
  ]);

  const quotes = quotesRes.data || [];
  const events = eventsRes.data || [];

  // Lead funnel
  const totalLeads = quotes.length;
  const convertedLeads = quotes.filter(q => q.converted).length;
  const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  // Leads by month (last 6 months)
  const now = new Date();
  const leadsByMonth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const label = d.toLocaleDateString('en-US', { month: 'short' });
    const count = quotes.filter(q => {
      const qd = new Date(q.created_at);
      return qd.getFullYear() === d.getFullYear() && qd.getMonth() === d.getMonth();
    }).length;
    return { label, count };
  });

  // Pipeline by status
  const statusOrder = ['New', 'Booked', 'Menu Development', 'EO', 'Completed', 'Lost'];
  const pipeline = statusOrder.map(s => ({
    status: s,
    count: events.filter(e => e.status === s).length,
  }));

  // Upcoming events (next 30/60/90 days)
  const upcoming = [30, 60, 90].map(days => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const count = events.filter(e => {
      const active = ['New', 'Booked', 'Menu Development', 'EO'];
      if (!active.includes(e.status)) return false;
      const eventDays = (e.event_days as { event_date: string }[]) || [];
      return eventDays.some(d => {
        const dt = new Date(d.event_date + 'T12:00:00');
        return dt >= now && dt <= cutoff;
      });
    });
    return { days, count };
  });

  // Post-event follow-through (Completed events)
  const completed = events.filter(e => e.status === 'Completed');
  const postEventFields = ['thank_you_email_sent', 'photos_received', 'rentals_reconciled', 'staff_hours_reviewed', 'testimonial_received', 'added_to_portfolio'] as const;
  const postEventHealth = completed.length > 0
    ? Math.round(
        completed.reduce((sum, e) => {
          const done = postEventFields.filter(f => (e as Record<string, unknown>)[f] === true).length;
          return sum + done / postEventFields.length;
        }, 0) / completed.length * 100
      )
    : null;

  // Average guests
  const allDays = events.flatMap(e => (e.event_days as { guests: number }[]) || []);
  const avgGuests = allDays.length > 0
    ? Math.round(allDays.reduce((s, d) => s + (d.guests || 0), 0) / allDays.length)
    : null;

  // Most popular style
  const styleCounts: Record<string, number> = {};
  allDays.forEach((d: { guests: number } & Record<string, unknown>) => {
    const style = String((d as Record<string, unknown>).service_style || '');
    if (style) styleCounts[style] = (styleCounts[style] || 0) + 1;
  });
  const topStyle = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return NextResponse.json({
    totalLeads,
    convertedLeads,
    conversionRate,
    leadsByMonth,
    pipeline,
    upcoming,
    postEventHealth,
    avgGuests,
    topStyle,
    completedCount: completed.length,
    activeCount: events.filter(e => !['Completed', 'Lost'].includes(e.status)).length,
  });
}
