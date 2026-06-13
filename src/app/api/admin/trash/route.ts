import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

// GET — fetch all soft-deleted leads and events
export async function GET(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [leadsRes, eventsRes] = await Promise.all([
    supabaseAdmin.from('quotes').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
    supabaseAdmin.from('events').select('*, event_days(*)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
  ]);

  return NextResponse.json({
    leads: leadsRes.data || [],
    events: eventsRes.data || [],
  });
}

// PATCH — restore (set deleted_at = null) or soft-delete (set deleted_at = now)
export async function PATCH(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type, id, action } = await req.json();
  const table = type === 'lead' ? 'quotes' : 'events';
  const value = action === 'restore' ? null : new Date().toISOString();

  const { error } = await supabaseAdmin.from(table).update({ deleted_at: value }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — permanently delete a single record
export async function DELETE(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type, id } = await req.json();
  const table = type === 'lead' ? 'quotes' : 'events';

  const { error } = await supabaseAdmin.from(table).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
