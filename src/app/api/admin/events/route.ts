import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

export async function GET(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('events')
    .select(`*, event_days(*)`)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { event, days } = body;

  const { data: newEvent, error: eventError } = await supabaseAdmin
    .from('events')
    .insert(event)
    .select()
    .single();

  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });

  if (days?.length) {
    const { error: daysError } = await supabaseAdmin
      .from('event_days')
      .insert(days.map((d: Record<string, unknown>) => ({ ...d, event_id: newEvent.id })));
    if (daysError) return NextResponse.json({ error: daysError.message }, { status: 500 });
  }

  return NextResponse.json(newEvent);
}
