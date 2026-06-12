# All Purpose Flower — Business Platform

## What this is
A custom business operations platform for All Purpose Flower (APF Culinary Group), a fine catering & events company in the SF Bay Area, run by the owner (the developer's wife). Website: allpurposeflowerco.com. Public site is on Wix; this platform is separate, live at https://apf-platform.vercel.app, and linked from the Wix "Get a Quote" button.

Built by her husband (Dan) as a cost-saving alternative to HoneyBook + Caterease (~$2k/yr). Dan is a hobbyist builder, comfortable with React/Supabase/APIs, working iteratively with Claude.

## Roadmap (in order)
1. **Quote app** — `index.html` ✅ live at https://apf-platform.vercel.app
2. **Client portal** — quote approval, contract signing, Square deposit payment, event details view. Connected to quote data.
3. **Wix website refresh** — "Get a Quote" button already points to platform. "Client Portal" button to add later.
4. **Event execution app** — menus, ordering, staff scheduling, run-of-show, BEOs, reminders (replaces her spreadsheet)

## Stack (all live)
- **Single-file HTML** — `index.html` for the quote app; migrate to React as platform grows
- **Supabase** — project `mgiehdjwpsqjfblxgxrv`, `quotes` table live with RLS
- **Vercel** — https://apf-platform.vercel.app, auto-deploys from GitHub on push to `main`
- **GitHub** — `github.com/danieljbarrera/apf-platform`
- **Gmail SMTP via nodemailer** — emails sent from `info@allpurposeflowerco.com` (Google Workspace). Resend was attempted but abandoned due to Wix DNS blocking subdomain MX records needed for domain verification.
- **Square API** — planned for client portal (estimates, invoices, deposits). She uses Square Payroll too — out of scope.

## Vercel env vars (never put in code)
- `SUPABASE_URL` — https://mgiehdjwpsqjfblxgxrv.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY` — in Vercel dashboard
- `GMAIL_USER` — info@allpurposeflowerco.com
- `GMAIL_APP_PASSWORD` — in Vercel dashboard (rotate at myaccount.google.com → Security → App passwords)

## Serverless functions
- `api/submit-quote.js` — inserts quote row into Supabase
- `api/send-quote-email.js` — sends customer estimate + owner lead notification via Gmail SMTP. BCCs danieljbarrera@gmail.com on both. Reply-to header not yet added (TODO).

## Email behavior
- Customer gets: branded estimate email with all three style package totals
- Owner (`info@allpurposeflowerco.com`) gets: lead notification with full event + contact details
- Both BCC `danieljbarrera@gmail.com`
- TODO: add `reply-to: info@allpurposeflowerco.com` header so client replies route correctly

## Deployment workflow
```bash
cd ~/apf-platform
git add -A && git commit -m "description" && git push
# Vercel auto-deploys in ~30 seconds
```
To rollback: Vercel dashboard → find last good deployment → Promote to Production.

## Database changes
Always add new columns in Supabase SQL editor BEFORE pushing code that references them:
```sql
ALTER TABLE quotes ADD COLUMN new_field text;
```
Columns are nullable by default — old rows unaffected.

## Supabase free tier warning
Free projects pause after 1 week of inactivity. Upgrade to Pro ($25/mo) once real leads start coming in, or visit the dashboard periodically to keep it active.

## Security notes
- NO secrets in client-side code. All keys in Vercel env vars behind serverless endpoints.
- Supabase `quotes` table: RLS enabled, INSERT-only public policy. No public SELECT.
- Admin access: use Supabase Auth, never a hardcoded password.

## Pricing model (verified to the penny against Square estimate #2687)
Config lives in `PRICING` object at top of `index.html`.

- **Food:** $65/guest flat, all styles. Composition differs:
  - Buffet & Family Style: 1 salad, 2 mains, 3 sides
  - Plated: 2-course, 1 starter, 1 main (2 proteins + 1 vegetarian option)
- **Staffing** (the style-dependent cost):
  - Waitstaff ratio — Buffet 1:25, Family Style 1:13, Plated 1:10
  - **Round DOWN** (floor) on waitstaff count — matches her invoices (150/13 → 11, not 12)
  - Waitstaff $40/hr, 1 captain $50/hr
  - Staffing hours = event hours + 4 (setup/breakdown, always +4)
- **Add-ons (per guest):** appetizers $3/person/each (0-6 selectable), dessert $4.75, coffee & tea $2.85
- **Bar (quoted separately):** Soft Bar $26/guest (bartenders 1:75), Full Bar $29/guest (1:50). Client provides alcohol. Bartender cost baked into per-guest price.
- **$5,000 event minimum** on subtotal — shown as "Event minimum" line item when applied
- **Fees on subtotal:** sales tax 9.25%, service fee 10%, card processing 3.5% (waived for check/cash — say so on quotes)
- **Deposit: 25%** of total

## Quote app UX (intentional decisions — don't undo)
- 3-step flow: event builder → contact capture → estimate view
- NO live dollar amounts in step 1 (lead capture strategy — they must submit contact info to see pricing). Live summary panel shows sophistication (staff counts, timeline) WITHOUT prices.
- Step 3 shows: grand total banner first (preferred style + bar combined, all-in number), then all 3 style packages side-by-side with preferred style FIRST and flagged "Your pick", then bar detail, then next steps
- Wording: "View My Estimate" (not "Reveal" — sounded scammy)
- Design language: paper/cream + brass/ink, Playfair Display + Instrument Sans
- Embedded in Wix was tried but abandoned (iframe scroll/mobile issues). Now linked directly from "Get a Quote" button.

## Open questions to confirm with the owner
- Waitstaff floor-rounding: intentional policy or one-off? (floor matches invoice; ceil is safer margin)
- Deposit on bar: currently 25% of combined total — does she deposit bar separately?
- Coffee & tea quantity: her invoice billed at 125 of 150 guests — her judgment call per event? (app currently bills at full guest count)

## Workflow context
Dan has a workflow map from the owner (end-to-end event process). Ask for it before designing portal/ops features.
