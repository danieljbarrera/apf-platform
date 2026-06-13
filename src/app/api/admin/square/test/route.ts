import { NextRequest, NextResponse } from 'next/server';
import { squareClient } from '@/lib/square';

export async function GET(_req: NextRequest) {
  const squareVars = Object.keys(process.env).filter(k => k.startsWith('SQUARE'));
  try {
    const resp = await squareClient.locations.list();
    return NextResponse.json({
      ok: true,
      square_vars_present: squareVars,
      environment: process.env.SQUARE_ENVIRONMENT,
      location_id: process.env.SQUARE_LOCATION_ID,
      token_prefix: process.env.SQUARE_TOKEN?.slice(0, 8),
      locations: resp.locations?.map(l => ({ id: l.id, name: l.name })),
    });
  } catch (e: unknown) {
    return NextResponse.json({
      ok: false,
      square_vars_present: squareVars,
      environment: process.env.SQUARE_ENVIRONMENT,
      location_id: process.env.SQUARE_LOCATION_ID,
      token_prefix: process.env.SQUARE_TOKEN?.slice(0, 8),
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
