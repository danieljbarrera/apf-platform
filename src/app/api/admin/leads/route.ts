import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { calcPackage, calcBar, fmtD } from '@/lib/pricing';

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
    .from('quotes')
    .select('*')
    .eq('converted', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    first_name, last_name, email, phone, event_date,
    guests, hours = 5, preferred_style, bar_package,
    appetizer_count = 0, include_dessert = false, include_coffee = false,
    notes, send_email,
  } = body;

  const { data: quote, error } = await supabaseAdmin.from('quotes').insert({
    first_name, last_name, email: email || null, phone: phone || null,
    event_date, guests: Number(guests),
    preferred_style, bar_package: bar_package && bar_package !== 'None' ? bar_package : null,
    appetizer_count: Number(appetizer_count),
    include_dessert: !!include_dessert,
    include_coffee: !!include_coffee,
    converted: false,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (send_email && email) {
    try {
      const g = Number(guests);
      const h = Number(hours) || 5;
      const opts = { appetizers: Number(appetizer_count) || 0, dessert: !!include_dessert, coffee: !!include_coffee };
      const packages = {
        Buffet: calcPackage(g, h, 'Buffet', opts),
        'Family Style': calcPackage(g, h, 'Family Style', opts),
        Plated: calcPackage(g, h, 'Plated', opts),
      };
      const hasBar = bar_package && bar_package !== 'None';
      const barQuote = hasBar ? calcBar(g, bar_package) : null;
      const quoteId = `APF-${Date.now().toString(36).toUpperCase()}`;
      const eventDateFmt = event_date
        ? new Date(event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : null;

      const BRAND = '#97784c';
      const DARK  = '#161410';
      const styleOrder = [preferred_style, ...['Buffet', 'Family Style', 'Plated'].filter(s => s !== preferred_style)];
      const pkgRows = styleOrder.map(style => {
        const p = packages[style as keyof typeof packages];
        const isPref = style === preferred_style;
        return `<tr>
          <td style="padding:10px 16px;border-bottom:1px solid #ede8df;">${isPref ? `<strong style="color:${BRAND};">✦ ${style}</strong> <span style="font-size:11px;color:${BRAND};background:#f5efe4;padding:2px 8px;border-radius:99px;margin-left:6px;">Your pick</span>` : `<span style="color:#3b382f;">${style}</span>`}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #ede8df;text-align:right;font-weight:600;">${fmtD(p.total)}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #ede8df;text-align:right;color:#79715f;font-size:13px;">25% deposit: ${fmtD(p.deposit)}</td>
        </tr>`;
      }).join('');
      const barRow = barQuote ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #ede8df;color:#3b382f;">${bar_package}</td><td style="padding:10px 16px;border-bottom:1px solid #ede8df;text-align:right;font-weight:600;">${fmtD(barQuote.total)}</td><td></td></tr>` : '';

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#faf8f3;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:${DARK};border-radius:10px 10px 0 0;padding:32px 36px;text-align:center;">
    <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${BRAND};margin-bottom:8px;">All Purpose Flower · Fine Catering &amp; Events</div>
    <div style="font-size:26px;color:#fff;font-weight:400;margin-bottom:6px;">Your Estimate Is Ready</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.55);">${quoteId}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:28px 36px;border-left:1px solid #e7dfcf;border-right:1px solid #e7dfcf;">
    <p style="margin:0 0 12px;font-size:16px;color:${DARK};">Dear ${first_name},</p>
    <p style="margin:0;font-size:14px;color:#3b382f;line-height:1.7;">Thank you for your interest in All Purpose Flower. We're pleased to share your custom estimate.</p>
    <div style="margin:20px 0;padding:14px 18px;background:#faf8f3;border-radius:6px;border:1px solid #e7dfcf;font-size:13px;color:#79715f;text-align:center;">${[preferred_style, g + ' guests', h + '-hour event', eventDateFmt].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:0 36px 8px;border-left:1px solid #e7dfcf;border-right:1px solid #e7dfcf;">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND};margin-bottom:12px;">Your Estimate</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7dfcf;border-radius:8px;overflow:hidden;border-collapse:separate;">
      <tr style="background:#faf8f3;"><th style="padding:9px 16px;text-align:left;font-size:11px;color:#79715f;">Service Style</th><th style="padding:9px 16px;text-align:right;font-size:11px;color:#79715f;">Total</th><th style="padding:9px 16px;text-align:right;font-size:11px;color:#79715f;">To Reserve</th></tr>
      ${pkgRows}${barRow}
    </table>
    <p style="font-size:11.5px;color:#aaa292;margin:10px 0 20px;line-height:1.6;">All totals include food, staffing, sales tax (9.25%), service fee (10%), and card processing (3.5% — waived for check or cash). Deposit is 25% of grand total.</p>
  </td></tr>
  <tr><td style="background:#fff;padding:0 36px 28px;border-left:1px solid #e7dfcf;border-right:1px solid #e7dfcf;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ecf4ef;border:1px solid #c4dccd;border-radius:8px;padding:20px 24px;"><tr><td>
      <div style="font-size:16px;color:#38614a;margin-bottom:8px;">What Happens Next</div>
      <p style="font-size:13.5px;color:#3b382f;margin:0;line-height:1.7;">We'll reach out to talk through your vision, customize your menu, and answer every question.</p>
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#f1ece1;border:1px solid #e7dfcf;border-radius:0 0 10px 10px;padding:20px 36px;text-align:center;">
    <div style="font-size:12px;color:#79715f;">All Purpose Flower &nbsp;·&nbsp; Fine Catering &amp; Events &nbsp;·&nbsp; San Francisco Bay Area</div>
  </td></tr>
</table></td></tr></table></body></html>`;

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      });

      await transporter.sendMail({
        from: 'All Purpose Flower <info@allpurposeflowerco.com>',
        to: email,
        bcc: 'danieljbarrera@gmail.com',
        subject: `Your All Purpose Flower Estimate — ${quoteId}`,
        html,
      });
    } catch (e) {
      console.error('Email send failed:', e);
      // don't fail the whole request — lead was saved
    }
  }

  return NextResponse.json(quote);
}

export async function PATCH(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, ...fields } = await req.json();
  const { error } = await supabaseAdmin.from('quotes').update(fields).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
