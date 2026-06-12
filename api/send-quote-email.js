const OWNER_EMAIL  = 'info@allpurposeflowerco.com';
const FROM_ADDRESS = 'All Purpose Flower <info@allpurposeflowerco.com>';
const BRAND_COLOR   = '#97784c';
const DARK_COLOR    = '#161410';

function fmt(n)  { return '$' + Math.round(n).toLocaleString('en-US'); }
function fmtD(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function customerHtml({ fname, lname, quoteId, eventType, eventDate, guests, hours, preferredStyle, packages, barQuote, barType, deposit }) {
  const styleOrder = [preferredStyle, ...['Buffet', 'Family Style', 'Plated'].filter(s => s !== preferredStyle)];
  const pkgRows = styleOrder.map(style => {
    const p = packages[style];
    const isPreferred = style === preferredStyle;
    return `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #ede8df;">
          ${isPreferred ? `<strong style="color:${BRAND_COLOR};">✦ ${style}</strong> <span style="font-size:11px; color:${BRAND_COLOR}; background:#f5efe4; padding:2px 8px; border-radius:99px; margin-left:6px;">Your pick</span>` : `<span style="color:#3b382f;">${style}</span>`}
        </td>
        <td style="padding:10px 16px; border-bottom:1px solid #ede8df; text-align:right; font-weight:600; color:${DARK_COLOR};">${fmtD(p.total)}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #ede8df; text-align:right; color:#79715f; font-size:13px;">25% deposit: ${fmtD(p.deposit)}</td>
      </tr>`;
  }).join('');

  const barRow = barQuote ? `
    <tr>
      <td style="padding:10px 16px; border-bottom:1px solid #ede8df; color:#3b382f;">${barType}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #ede8df; text-align:right; font-weight:600; color:${DARK_COLOR};">${fmtD(barQuote.total)}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #ede8df; text-align:right; color:#79715f; font-size:13px;">&nbsp;</td>
    </tr>` : '';

  const eventMeta = [eventType, guests + ' guests', hours + '-hour event', eventDate].filter(Boolean).join(' &nbsp;·&nbsp; ');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0; padding:0; background:#faf8f3; font-family: Georgia, serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3; padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

  <!-- Header -->
  <tr><td style="background:${DARK_COLOR}; border-radius:10px 10px 0 0; padding:32px 36px; text-align:center;">
    <div style="font-size:11px; letter-spacing:0.2em; text-transform:uppercase; color:${BRAND_COLOR}; margin-bottom:8px;">All Purpose Flower · Fine Catering &amp; Events</div>
    <div style="font-size:26px; color:#fff; font-weight:400; margin-bottom:6px;">Your Estimate Is Ready</div>
    <div style="font-size:13px; color:rgba(255,255,255,0.55);">Estimate ${quoteId}</div>
  </td></tr>

  <!-- Intro -->
  <tr><td style="background:#fff; padding:28px 36px; border-left:1px solid #e7dfcf; border-right:1px solid #e7dfcf;">
    <p style="margin:0 0 12px; font-size:16px; color:${DARK_COLOR};">Dear ${fname},</p>
    <p style="margin:0; font-size:14px; color:#3b382f; line-height:1.7;">Thank you for reaching out to All Purpose Flower. We're delighted to share your custom estimate — prepared based on the details you provided.</p>
    <div style="margin:20px 0; padding:14px 18px; background:#faf8f3; border-radius:6px; border:1px solid #e7dfcf; font-size:13px; color:#79715f; text-align:center;">${eventMeta}</div>
  </td></tr>

  <!-- Packages table -->
  <tr><td style="background:#fff; padding:0 36px 8px; border-left:1px solid #e7dfcf; border-right:1px solid #e7dfcf;">
    <div style="font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:${BRAND_COLOR}; margin-bottom:12px;">Your Estimate</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7dfcf; border-radius:8px; overflow:hidden; border-collapse:separate;">
      <tr style="background:#faf8f3;">
        <th style="padding:9px 16px; text-align:left; font-size:11px; color:#79715f; font-weight:500;">Service Style</th>
        <th style="padding:9px 16px; text-align:right; font-size:11px; color:#79715f; font-weight:500;">Total</th>
        <th style="padding:9px 16px; text-align:right; font-size:11px; color:#79715f; font-weight:500;">To Reserve</th>
      </tr>
      ${pkgRows}
      ${barRow}
    </table>
    <p style="font-size:11.5px; color:#aaa292; margin:10px 0 20px; line-height:1.6;">All totals include food, staffing, sales tax (9.25%), service fee (10%), and card processing (3.5% — waived for check or cash). Deposit is 25% of grand total.</p>
  </td></tr>

  <!-- Next steps -->
  <tr><td style="background:#fff; padding:0 36px 28px; border-left:1px solid #e7dfcf; border-right:1px solid #e7dfcf;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ecf4ef; border:1px solid #c4dccd; border-radius:8px; padding:20px 24px;">
      <tr><td>
        <div style="font-size:16px; color:#38614a; margin-bottom:8px;">What Happens Next</div>
        <p style="font-size:13.5px; color:#3b382f; margin:0; line-height:1.7;">We'll reach out within 24 hours to talk through your vision, customize your menu, and answer every question. We'd love to make your event unforgettable.</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f1ece1; border:1px solid #e7dfcf; border-radius:0 0 10px 10px; padding:20px 36px; text-align:center;">
    <div style="font-size:12px; color:#79715f;">All Purpose Flower &nbsp;·&nbsp; Fine Catering &amp; Events &nbsp;·&nbsp; San Francisco Bay Area</div>
    <div style="font-size:11px; color:#aaa292; margin-top:4px;"><a href="https://allpurposeflowerco.com" style="color:${BRAND_COLOR};">allpurposeflowerco.com</a></div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function ownerHtml({ fname, lname, email, phone, quoteId, eventType, eventDate, venue, guests, hours, preferredStyle, appetizers, dessert, coffeeTea, barType, notes, packages, barQuote }) {
  const pref = packages[preferredStyle];
  const extras = [
    appetizers > 0 && `${appetizers} passed appetizer${appetizers > 1 ? 's' : ''}`,
    dessert && 'Dessert',
    coffeeTea && 'Coffee & Tea',
    barType && barType,
  ].filter(Boolean).join(', ') || 'None';

  const styleRows = ['Buffet', 'Family Style', 'Plated'].map(s => {
    const p = packages[s];
    const mark = s === preferredStyle ? ` ← preferred` : '';
    return `<tr>
      <td style="padding:7px 14px; border-bottom:1px solid #ede8df; color:#3b382f;">${s}${mark ? `<span style="color:${BRAND_COLOR}; font-size:11px;"> ${mark}</span>` : ''}</td>
      <td style="padding:7px 14px; border-bottom:1px solid #ede8df; text-align:right; font-weight:600;">${fmtD(p.total)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#faf8f3; font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

  <tr><td style="background:${DARK_COLOR}; border-radius:10px 10px 0 0; padding:24px 32px;">
    <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${BRAND_COLOR}; margin-bottom:6px;">New Lead</div>
    <div style="font-size:22px; color:#fff;">${fname} ${lname}</div>
    <div style="font-size:13px; color:rgba(255,255,255,0.5); margin-top:4px;">${quoteId}</div>
  </td></tr>

  <tr><td style="background:#fff; padding:24px 32px; border:1px solid #e7dfcf; border-top:none;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f; width:130px;">Email</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};"><a href="mailto:${email}" style="color:${BRAND_COLOR};">${email}</a></td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Phone</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${phone || '—'}</td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Event type</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${eventType || '—'}</td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Event date</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${eventDate || '—'}</td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Venue</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${venue || '—'}</td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Guests</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${guests}</td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Duration</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${hours} hours</td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Style</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR}; font-weight:600;">${preferredStyle}</td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#79715f;">Extras</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${extras}</td></tr>
      ${notes ? `<tr><td style="padding:6px 0; font-size:13px; color:#79715f; vertical-align:top;">Notes</td><td style="padding:6px 0; font-size:13px; color:${DARK_COLOR};">${notes}</td></tr>` : ''}
    </table>
  </td></tr>

  <tr><td style="background:#fff; padding:0 32px 24px; border:1px solid #e7dfcf; border-top:none;">
    <div style="font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:${BRAND_COLOR}; margin-bottom:10px;">Quote Totals</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7dfcf; border-radius:8px; overflow:hidden; border-collapse:separate;">
      ${styleRows}
      ${barQuote ? `<tr><td style="padding:7px 14px; color:#3b382f;">${barType}</td><td style="padding:7px 14px; text-align:right; font-weight:600;">${fmtD(barQuote.total)}</td></tr>` : ''}
    </table>
  </td></tr>

  <tr><td style="background:#f1ece1; border:1px solid #e7dfcf; border-radius:0 0 10px 10px; padding:16px 32px; text-align:center; font-size:11px; color:#aaa292;">
    All Purpose Flower Platform · ${quoteId}
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return res.status(500).json({ error: 'Server misconfigured' });

  const {
    fname, lname, email, phone, quoteId,
    eventType, eventDate, venue, guests, hours,
    preferredStyle, appetizers, dessert, coffeeTea, barType, notes,
    packages, barQuote,
  } = req.body;

  const deposit = packages[preferredStyle]?.deposit;

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    await Promise.all([
      transporter.sendMail({
        from: FROM_ADDRESS,
        to: email,
        subject: `Your All Purpose Flower Estimate — ${quoteId}`,
        html: customerHtml({ fname, lname, quoteId, eventType, eventDate, guests, hours, preferredStyle, packages, barQuote, barType, deposit }),
      }),
      transporter.sendMail({
        from: FROM_ADDRESS,
        to: OWNER_EMAIL,
        subject: `New Quote Request: ${fname} ${lname} — ${guests} guests${eventDate ? ` · ${eventDate}` : ''}`,
        html: ownerHtml({ fname, lname, email, phone, quoteId, eventType, eventDate, venue, guests, hours, preferredStyle, appetizers, dessert, coffeeTea, barType, notes, packages, barQuote }),
      }),
    ]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-quote-email error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
