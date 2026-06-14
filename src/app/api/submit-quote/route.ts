import { NextRequest, NextResponse } from 'next/server';
import { generateQuoteNumber } from '@/lib/quote-number';

export async function POST(req: NextRequest) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const body = await req.json();
  const quoteNumber = body.quote_number || generateQuoteNumber();

  const response = await fetch(`${SUPABASE_URL}/rest/v1/quotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ ...body, quote_number: quoteNumber }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Supabase error:', text);
    return NextResponse.json({ error: 'Failed to save quote' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
