# All Purpose Flower — Business Platform

## What this is
A custom business operations platform for All Purpose Flower (APF Culinary Group), a fine catering & events company in the SF Bay Area, run by the owner (the developer's wife). Website: allpurposeflowerco.com. Public site is on Wix; this platform is separate, live at https://apf-platform.vercel.app, linked from the Wix "Get a Quote" button.

Built by her husband (Dan) as a cost-saving alternative to HoneyBook + Caterease (~$2k/yr). Dan is comfortable with React/Supabase/APIs, working iteratively with Claude.

## Roadmap (in order)
1. **Quote app** ✅ — live at https://apf-platform.vercel.app (`src/app/page.tsx` renders `index.html` content; quote logic is in `public/index.html`)
2. **Admin portal** ✅ — `/admin` — dashboard (events + leads tabs), event detail with 6-phase checklist, auto-save
3. **Document generation** — Event Order PDF from app data; Square API integration to auto-create estimates/invoices from event fields
4. **Client portal** — magic-link page at `/client/[token]` — view proposal, approve, pay Square deposit
5. **Wix website refresh** — "Client Portal" button to add alongside "Get a Quote"

## Stack
- **Next.js 16.2.9** — App Router, TypeScript, Tailwind CSS 4, React 19
- **Supabase** — project `mgiehdjwpsqjfblxgxrv`. Tables: `quotes`, `events`, `event_days`
- **Vercel** — https://apf-platform.vercel.app, auto-deploys from GitHub `main` (sometimes flaky — use `vercel --prod` if push doesn't trigger)
- **GitHub** — `github.com/danieljbarrera/apf-platform`
- **Gmail SMTP via nodemailer** — emails from `info@allpurposeflowerco.com` (Google Workspace app password). Resend was tried but abandoned — Wix blocks subdomain MX records needed for domain verification.
- **Square** — currently used manually for estimates/invoices. Future: API integration to auto-create from event data.

## Deployment workflow
```bash
cd ~/apf-platform
git add -A && git commit -m "description" && git push
# If Vercel doesn't auto-deploy within 60s:
vercel --prod
```
Rollback: Vercel dashboard → last good deployment → Promote to Production.

## Vercel env vars (never put in code)
- `SUPABASE_URL` — https://mgiehdjwpsqjfblxgxrv.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only, never exposed to browser)
- `NEXT_PUBLIC_SUPABASE_URL` — same URL, safe for browser
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key (browser-safe, RLS enforced)
- `GMAIL_USER` — info@allpurposeflowerco.com
- `GMAIL_APP_PASSWORD` — rotate at myaccount.google.com → Security → App passwords

## Supabase client split (critical — do not collapse back into one file)
- `src/lib/supabase-admin.ts` — uses `SUPABASE_SERVICE_ROLE_KEY`, **server-only** (API routes only)
- `src/lib/supabase-browser.ts` — uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **client components only**
- Mixing these caused "This page couldn't load" — the service role key is undefined in the browser

## Auth pattern
- Admin logs in via Supabase Auth email/password at `/admin/login`
- Browser holds the session via anon key; API routes verify the Bearer token server-side using `supabaseAdmin.auth.getUser(token)`
- Admin user: `info@allpurposeflowerco.com` — managed at supabase.com/dashboard/.../auth/users

## Database schema

### `quotes`
Submitted from the public quote form. RLS: INSERT-only public, no public SELECT.
Key fields: `first_name`, `last_name`, `email`, `event_date`, `guests`, `preferred_style`, `bar_package`, `created_at`, `converted` (bool — true once promoted to an event)

### `events`
Admin-managed event records. One row per client engagement.
Key fields: `client_names`, `status` (New/Booked/Menu Development/EO/Completed/Lost), `planner_name`, `planner_email`, `internal_notes`, plus ~31 boolean checklist fields across 6 phases (see event detail page for full list), plus date/select/text fields for each phase.

### `event_days`
Child table of `events` for multi-day events. `event_id` FK, `event_date`, `venue`, `guests`, `service_style`, `sort_order`.

## Database changes
Always add columns in Supabase SQL editor BEFORE pushing code that references them:
```sql
ALTER TABLE events ADD COLUMN new_field text;
```
Columns are nullable by default — existing rows unaffected.

## Email behavior
- Customer gets: branded estimate with all three style package totals
- Owner (`info@allpurposeflowerco.com`) gets: lead notification with full event + contact details
- Both BCC `danieljbarrera@gmail.com`
- TODO: add `Reply-To: info@allpurposeflowerco.com` so client replies route correctly

## Admin portal structure
- `src/app/admin/layout.tsx` — auth guard, top nav, sign-out. `'use client'`.
- `src/app/admin/page.tsx` — dashboard: Events tab (status filter chips, checklist progress bar) + Leads tab (with Convert to Event button)
- `src/app/admin/events/[id]/page.tsx` — event detail: status dropdown, event day cards, 6-phase checklist (auto-saves on 600ms debounce), internal notes
- `src/app/api/admin/events/route.ts` — GET all events (with event_days), POST new event
- `src/app/api/admin/events/[id]/route.ts` — GET single event, PATCH event fields
- `src/app/api/admin/leads/route.ts` — GET all quotes (excludes converted)

## Checklist phases (event detail)
1. **Booking** — proposal sent, follow-up, retainer invoice, retainer paid, contract signed
2. **Planning** — questionnaire, tasting, draft menu, revisions, final menu approved
3. **Rentals** — pull list, quote, approval, delivery confirmed
4. **Event Order** — EO draft, staffing, logistics, final EO sent, approved
5. **Pre-Event** — final invoice, final payment, guest count, vendor meals, allergies, load list, staffing roster, timeline, bar list, internal meeting, captain assigned
6. **Post-Event** — thank you email, photos, rentals reconciled, staff hours, testimonial, added to portfolio

## Documents (current state + plan)
- **Proposals/Estimates** — currently created manually in Square. Plan: Square API button on event detail to auto-generate from event fields.
- **Invoices** — same as above; Square handles payment collection.
- **Event Order** — currently a Google Doc. Best candidate to generate as PDF natively from app data (all fields already exist in the events table).

## Pricing model (quote app — verified against Square estimate #2687)
- **Food:** $65/guest, all styles
- **Staffing:** waitstaff ratio Buffet 1:25 / Family Style 1:13 / Plated 1:10; **floor** the count (matches her invoices); $40/hr waitstaff, $50/hr captain; hours = event hours + 4
- **Add-ons per guest:** appetizers $3/each (0–6), dessert $4.75, coffee & tea $2.85
- **Bar:** Soft Bar $26/guest (1:75 bartender), Full Bar $29/guest (1:50)
- **$5,000 event minimum** applied to subtotal
- **Fees:** sales tax 9.25%, service fee 10%, card processing 3.5% (waived for check/cash)
- **Deposit:** 25% of total

## Quote app UX (intentional — don't undo)
- 3-step: event builder → contact capture → estimate reveal
- No prices shown in step 1 (lead capture strategy)
- "View My Estimate" wording (not "Reveal" — tested as too salesy)
- Direct link from Wix (iframe embed abandoned — scroll/mobile issues)

## Supabase free tier
Projects pause after 1 week of inactivity. Visit the dashboard periodically or upgrade to Pro ($25/mo) once real leads come in.

## Open questions (confirm with owner)
- Waitstaff floor-rounding: policy or one-off?
- Bar deposit: 25% of combined total, or deposited separately?
- Coffee & tea: full guest count or her judgment per event?
- Square API: does she want estimates/invoices auto-generated, or prefer manual control?
