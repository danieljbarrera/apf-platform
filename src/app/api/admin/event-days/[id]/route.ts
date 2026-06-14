import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { rollupEvent } from '@/lib/rollup';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { error } = await supabaseAdmin.from('event_days').update(body).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Keep the event-level rollup in sync when estimate fields change
  const { data: day } = await supabaseAdmin.from('event_days').select('event_id').eq('id', id).single();
  if (day?.event_id) await rollupEvent(day.event_id);
  return NextResponse.json({ ok: true });
}
