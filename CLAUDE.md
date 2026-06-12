# All Purpose Flower — Business Platform

## What this is
A custom business operations platform for All Purpose Flower (APF Culinary Group), a fine catering & events company in the SF Bay Area, run by the owner (the developer's wife). Website: allpurposeflowerco.com. Public site is on Wix; this platform is separate and linked from it.

Built by her husband (Dan) as a cost-saving alternative to HoneyBook + Caterease (~$2k/yr). Dan is a hobbyist builder, comfortable with React/Supabase/APIs, working iteratively with Claude.

## Roadmap (in order)
1. **Quote app** — `apf-quote.html` (current, working) — deploy to Vercel
2. **Client portal** — quote approval, contract signing, Square deposit payment, event details view. Connected to quote data.
3. **Wix website refresh** — point "Get a Quote" / "Client Portal" buttons at this platform
4. **Event execution app** — menus, ordering, staff scheduling, run-of-show, BEOs, reminders (replaces her spreadsheet)

## Stack decisions (agreed)
- **React** for the app (migrate from single-file HTML as platform grows)
- **Supabase** — database, auth, RLS (account exists, project created)
- **Vercel** — hosting + serverless functions for secrets (Supabase keys, email, Square)
- **Resend** — transactional email (replacing EmailJS placeholder in current file)
- **Square API** — estimates, invoices, payments (she also uses Square Payroll — out of scope)
- **GitHub** — needs account setup, then connect to Vercel

## Security notes
- NO secrets in client-side code. Current HTML has placeholder config; real keys go in Vercel env vars behind serverless endpoints.
- Supabase `quotes` table: RLS enabled, INSERT-only public policy. No public SELECT — reads go through authenticated admin or the dashboard.
- Admin access: use Supabase Auth, never a hardcoded password.

## Pricing model (verified to the penny against Square estimate #2687)
Config lives in `PRICING` object at top of apf-quote.html.

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

## Open questions to confirm with the owner
- Waitstaff floor-rounding: intentional policy or one-off? (floor matches invoice; ceil is safer margin)
- Deposit on bar: currently 25% of combined total — does she deposit bar separately?
- Coffee & tea quantity: her invoice billed at 125 of 150 guests — her judgment call per event? (app currently bills at full guest count)

## Workflow context
Dan has a workflow map from the owner (end-to-end event process). Ask for it before designing portal/ops features.
