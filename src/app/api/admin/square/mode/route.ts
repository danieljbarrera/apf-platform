import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSquareMode, setSquareMode } from '@/lib/settings';
import { squareFor } from '@/lib/square';

async function verifyAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

export async function GET(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const mode = await getSquareMode();
  // Report whether the target env actually has credentials configured
  const prodReady = !!(process.env.SQUARE_PROD_TOKEN && process.env.SQUARE_PROD_LOCATION_ID);
  return NextResponse.json({ mode, prodReady });
}

export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { mode } = await req.json();
  if (mode !== 'sandbox' && mode !== 'production') {
    return NextResponse.json({ error: 'mode must be sandbox or production' }, { status: 400 });
  }
  if (mode === 'production') {
    const { locationId } = squareFor('production');
    if (!process.env.SQUARE_PROD_TOKEN || !locationId) {
      return NextResponse.json({ error: 'Production credentials not configured (SQUARE_PROD_TOKEN / SQUARE_PROD_LOCATION_ID).' }, { status: 400 });
    }
  }
  await setSquareMode(mode);
  return NextResponse.json({ ok: true, mode });
}
