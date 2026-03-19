# FeisTab Pre-Registration — Project Rules

## What This Is

FeisTab is a system that replaces the paper-envelope-box chaos at Irish dance competitions (feiseanna). It's being built by Daniel for his friend's dad, who runs feiseanna.

**Phase 1 (FeisTab — separate repo, DONE):** The competition-day chain — check-in → side-stage → judge scores → tabulation → anomaly checks → verification → sign-off → official results. This works. Rosters are currently CSV-imported.

**Phase 2 (THIS REPO — Pre-Registration):** The upstream system that feeds Phase 1. Organisers create feis listings with syllabuses, fees, and deadlines. Parents register dancers and pay online. When registration closes, the organiser clicks one button and competition-day rosters flow into FeisTab. No more CSV imports. No more FeisWeb dependency.

### Why This Exists as a Separate System

Pre-registration handles parent accounts, child data (COPPA), and payments (Stripe/PCI) — a completely different risk class from day-of scoring operations. Separate Supabase project isolates auth, migrations, and data sensitivity. The bridge between systems (sub-project 3) is an explicit contract, not blurred shared tables.

### The Three Sub-Projects

| Sub-project | Scope | Status |
|---|---|---|
| **1. Organiser Feis Setup** | Wizard, syllabus templates, fees, deadlines, clone, Stripe Connect | Building now |
| **2. Parent Registration Portal** | Family accounts, dancer profiles, eligibility filtering, Stripe Checkout | Next |
| **3. The Bridge** | "Launch Feis Day" — export entries → import into FeisTab as event + rosters | After #2 |

### The Market Opportunity

Nobody does the complete chain from registration to results. FeisWeb (dominant in Northeast US) is ASP.NET from 1985 with no mobile app. The market is fragmented across 8+ regional platforms. Parents juggle 3-4 accounts. FeisTab + Pre-Reg replaces the entire workflow end-to-end.

---

## Tech Stack
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui v4
- **Backend:** Supabase (Postgres + Auth) — project `vwfrmhbczwpvqonlpfzs`
- **Payments:** Stripe Connect (organisers connect their own accounts, FeisTab never holds funds)
- **Testing:** Vitest (unit)
- **Hosting:** Vercel

## Quick Commands
```bash
npm run dev              # localhost:3000
npm run build            # production build
npm test                 # vitest unit tests
npm run lint             # eslint
npx vitest run tests/engine/  # engine tests only
```

---

## 1. Non-Negotiables (Hard Rules)

### 1.1 Fee Integrity
- **Integer math (cents) for all money.** Never use floats for currency. All `fee_*_cents` columns are integers.
- **Family cap logic is authoritative.** `calculateFees()` in `src/lib/engine/fee-calculator.ts` is the single source of truth for fee totals.

### 1.2 Listing State Machine
- **All status changes go through `canTransitionListing()`** in `src/lib/feis-listing-states.ts`.
- **Publish gate:** A listing cannot go `draft → open` without passing ALL publish prerequisites (name, date, venue, fees, competitions, Stripe, date ordering).

### 1.3 Frozen Snapshots
- **Templates are mutable. Live listings are frozen.** When a template is expanded into `feis_competitions`, the template data is deep-copied into `syllabus_snapshot`. Each competition row stores its own frozen eligibility data. Template edits NEVER mutate existing listings.
- **Clone is a deep copy.** `cloned_from` is lineage metadata only — no live link. Cloned data is immediately independent.

### 1.4 Supabase Client Usage
- **Server components / route handlers:** `createClient()` from `src/lib/supabase/server.ts`
- **Client components:** `useSupabase()` hook from `src/hooks/use-supabase.ts`
- **NEVER** call `createBrowserClient` directly inside a component body.

### 1.5 Code Purity
- **Engine logic (`src/lib/engine/`)** — pure functions only. No Supabase, no React, no side effects.
- **Database queries happen in pages/route handlers only**, not in `src/lib/` or `src/components/`.

### 1.6 Error Handling
- **Always check `.error` on Supabase responses.**
- **Form submissions use try/catch.**
- **Every page must have a loading state.**

### 1.7 TypeScript Strictness
- **No `any` types in new code.**

### 1.8 System Boundary
- **This repo does NOT touch FeisTab Phase 1 tables.** No `events`, `competitions`, `dancers`, `registrations`. Those belong to the day-of system. The bridge (sub-project 3) is the ONLY thing that crosses this boundary.

---

## 2. Scope

**Sub-project 1 is the current scope:** Organiser feis setup wizard.

**Do not build yet:** parent registration portal, family accounts, Stripe Checkout, bridge to FeisTab, number cards, PDFs. These are sub-projects 2 and 3.

**Spec:** `docs/2026-03-19-organiser-feis-setup-design.md`
**Plan:** `docs/2026-03-19-organiser-feis-setup.md`

---

## 3. Forbidden Actions

- Don't bypass the state machine — every status change goes through `canTransitionListing()`
- Don't put Supabase calls in engine code
- Don't put database queries in components — queries go in pages/route handlers
- Don't add features not in the current sub-project spec
- Don't skip `npm run build` before saying "done"
- Don't commit `any` types in new code or dead code
- Don't modify FeisTab Phase 1 tables or schema
- Don't let template edits mutate existing listings — frozen snapshots are immutable

---

## 4. Conventions

### Naming
| Type | Convention | Example |
|---|---|---|
| Files | kebab-case | `fee-calculator.ts` |
| Components | PascalCase named exports | `export function SyllabusToggle()` |
| Hooks | `use` prefix, camelCase | `useSupabase` |
| Types | PascalCase | `FeisListing`, `FeeSchedule` |
| Functions | camelCase | `calculateFees`, `canTransitionListing` |
| Constants | UPPER_SNAKE_CASE | `VALID_TRANSITIONS` |
| DB fields | snake_case | `feis_listing_id`, `fee_category` |
| CSS classes | `feis-` prefix | `feis-card`, `feis-accent-left` |

### Server vs Client
- **Server** (default): pages that only fetch/render. Use `createClient()` from `server.ts`. Add `export const dynamic = 'force-dynamic'` for Supabase queries.
- **Client** (`'use client'`): pages with interactivity. Use `useSupabase()` hook. Fetch in `useEffect`.

### Design Tokens
Same visual identity as FeisTab Phase 1 — "Precision Utility." Outfit font, cool neutral palette, flat panels with 1px borders, monospace for data.

| Token | Value | Usage |
|---|---|---|
| `--color-feis-green` | `#0B4D2C` | Primary, brand, buttons |
| `--color-feis-green-light` | `#EBF4EF` | Secondary backgrounds |
| `--color-feis-orange` | `#D4652A` | Warnings, attention states |
| `--color-feis-gold` | `#C59D5F` | Highlights, 1st place |
| `--color-feis-cream` | `#F7F8FA` | Page background |
| `--color-feis-charcoal` | `#1A1D23` | Text |

### Import Order
1. React / Next.js → 2. Third-party → 3. `@/lib/` → 4. `@/hooks/` → 5. `@/components/`

All project imports use the `@/` alias.

---

## 5. Testing

### Must be tested
- **Engine code** (`src/lib/engine/`) — every public function
- **State machine** (`src/lib/feis-listing-states.ts`) — valid transitions, invalid transitions, publish prerequisites
- **Freezing/isolation** — template edits don't mutate listings, clones are independent

### Doesn't need tests yet
- React components, page-level integration (manual testing during prototype)

---

## 6. Tooling
- **Prettier:** single quotes, no trailing commas, 2-space indent, 100 char width
- **Commits:** conventional commits (`feat:`, `fix:`, `test:`, `refactor:`), one logical change per commit

---

## 7. The Full Picture — How FeisTab Works

### The Complete Vision

FeisTab replaces the entire Irish dance competition workflow end-to-end:

```
PHASE 2 (THIS REPO)                              PHASE 1 (feistab repo)
─────────────────────                             ─────────────────────
Organiser creates feis    →  Parents register   →  BRIDGE  →  Check-in → Side-stage
(syllabus, fees,              (dancers, pay        (one       → Judge scores → Tabulate
 deadlines)                    via Stripe)          click)     → Approve → Publish Results
```

**Phase 1 repo:** `github.com/PGD3311/feistab` (or similar — Daniel's main FeisTab repo)
**Phase 2 repo:** `github.com/PGD3311/FEISSTAB-PRE-REG` (this repo)

### Connection Between Systems

- **Pre-reg owns:** feis listings, syllabus/competitions, fee schedules, family accounts, dancer profiles, entries, payments
- **FeisTab Phase 1 owns:** events, day-of competitions, judges, scoring, tabulation, results, approval
- **The bridge (sub-project 3)** is the ONLY thing that crosses: it exports a frozen registration snapshot from pre-reg and imports it into FeisTab as an event with competitions and rosters
- **Shared visual identity:** both apps look like FeisTab (same colors, fonts, components)

### Who Uses What

| User | Phase 2 (Pre-Reg) | Phase 1 (Day-Of) |
|---|---|---|
| **Organiser** | Creates feis, sets syllabus/fees, monitors registrations | Manages check-in, assigns judges, publishes results |
| **Parent** | Registers dancers, pays, views entries | Views results, feedback |
| **Judge** | — | Scores dancers on tablet |
| **Tabulator** | — | Runs tabulation engine |

---

## 8. Market Research & Domain Knowledge

### The Competitive Landscape

| Platform | Region | Model | Strengths | Weaknesses |
|---|---|---|---|---|
| **FeisWeb** | Northeast US (dominant) | Bundled reg + tab, ~$2/competitor | Largest parent account base, full pipeline | ASP.NET from 1985, no mobile, session bugs, results expire in 10min |
| **FeisWorx** | Broad North America | Reg + optional tab (MyFeis self-service) | Teacher approval flow, changes up to 5 days before | Aging interface, VeriSign-era payments |
| **QuickFeis** | Mid-America | Bundled reg + tab | Best mobile app, live updates, staff does tabulation | Regional, provides staff not just software |
| **FeisFWD** | Expanding (newest) | A la carte, uses Stripe | Customization ("won't dictate how your event works"), video adjudication | $700+ for pro tabulation, small team |
| **GoFeis** | International (WIDA) | Per-dancer charge, free setup | Transparent pricing, real-time updates | Limited to WIDA, "not user friendly" feedback |
| **Feis.link** | East Coast | % per registration (registrant pays) | Zero cost to organizer, direct deposit | Limited adoption |
| **FeisMark** | Global | One-time license (Windows) | Championship scoring, used in 6+ countries | Scoring only, no registration, no web |
| **Instep** | UK/Europe | Unknown | GB Championships, British Nationals | Regional UK/Europe only |

### How FeisWeb Locks In Organizers
1. **Data captivity** — parent accounts, dancer profiles, history all trapped inside
2. **Bundled services** — registration and tabulation are inseparable. Use their reg = their tab person shows up.
3. **Parent network effects** — Northeast parents already have accounts. Switching = asking hundreds of families to re-register.
4. **Relationship lock-in** — 40+ years of personal relationships with Northeast organizers
5. **Proprietary tabulation** — no API, no standard data interchange format

### FeisTab's Strategic Position
- **The chaotic middle is uncontested.** Every competitor handles registration and results. Nobody has modern, real-time, tablet-based scoring and tabulation that eliminates the envelope chain.
- **CSV import is the adoption bridge.** Organizers keep FeisWeb for registration, add FeisTab for the middle. Avoids parent-account switching cost entirely.
- **Pre-reg closes the loop.** FeisTab + Pre-Reg = the only end-to-end solution from registration to published results.
- **Trust/transparency** — audit trails and explainable tabulation are unique differentiators.
- **Geographic opportunity** — Southern US, Western US, Canada, and paper-only regions are underserved.
- **Watch FeisFWD** — only modern competitor with Stripe integration and customization pitch. Closest threat if they improve the day-of experience.

### Standard CLRG Fee Structure

| Fee Type | Typical Range |
|---|---|
| Event fee (per family) | $25–30 |
| Solo dance (per dancer per dance) | $13–15 |
| Prelim Championship (per dancer) | $55 |
| Open Championship (per dancer) | $60–65 |
| Family cap | $150–175 |
| Late fee (per dancer) | $25 |
| Day-of surcharge (per dancer) | $50 + dance fees |

### CLRG Level Advancement

| From | To | Requirement |
|---|---|---|
| Beginner | Advanced Beginner | After 1 year |
| AB | Novice | Place 1st/2nd/3rd with 5+ competitors |
| Novice | Prizewinner | Place 1st (or 1st/2nd with 20+) |
| Prizewinner | Prelim Championship | Teacher discretion |
| Prelim | Open Championship | Achievement thresholds |

---

## 9. Stripe Connect Architecture

> Full reference: `docs/research/stripe-connect.md`

### Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Account Type | **Express** | Bridget needs "connect bank, get paid" — not a full Stripe dashboard. Stripe-hosted onboarding. Organizer cannot bypass platform. |
| Charge Type | **Direct Charges** | Organizer is merchant of record. Parent's bank statement shows the feis name, not "FeisTab." Refunds from organizer's balance. |
| Payment UI | **Stripe Checkout (Hosted)** | Zero PCI surface area. Apple Pay, Google Pay, Link out of the box. Mobile-optimized. |
| Platform Revenue | **Application fee** (flat % per charge) | `application_fee_amount` on each payment. |
| Currency | **Organizer's local currency** | Feis in Ireland = charge EUR. Parent's bank handles conversion. |
| Webhooks | **Two separate endpoints** | Platform events + Connect events require separate Stripe webhook configurations. |

### Onboarding Pattern
- Use **Account Links** (not deprecated OAuth). Generate on-demand — they expire in ~5 minutes.
- **return_url does NOT mean onboarding is complete.** Always check `charges_enabled` + `payouts_enabled` on the account object.
- Listen for `account.updated` webhook — Stripe may require additional verification later.

### Payment Flow
```
Parent clicks "Pay" → Server creates Stripe Checkout Session (Direct Charge on connected account)
→ Parent completes payment on Stripe-hosted page → Webhook confirms → Registration marked paid
```

### Critical Pitfalls to Avoid
1. Always use `request.text()` for webhook body (not `.json()`) — signature verification needs raw body
2. Every API call for a connected account needs `stripeAccount` parameter — forgetting creates charge on YOUR account
3. Store `payment_intent_id`, `charge_id`, `connected_account_id` on every registration record
4. Use idempotency keys on all charge creation: `idempotencyKey: 'reg_${registrationId}'`
5. Set up Connect webhook endpoint separately from platform webhook endpoint

### For Sub-Project 1 (Current)
Stripe Connect in the organiser wizard is a **placeholder** — "Simulate Stripe Connect" button that sets `stripe_charges_enabled = true`. Real OAuth flow wired in sub-project 2 when we have Stripe API keys and the parent payment flow.

---

## 10. Compliance & Data Privacy

> Full reference: `docs/research/compliance-and-privacy.md`

### COPPA (US) — Applies Now, New Rules by April 2026

FeisTab knowingly collects data about children under 13. COPPA applies.

**2025 amendments (effective June 23, 2025; compliance deadline April 22, 2026):**
- **Written security program** — mandatory. Designated coordinator, risk assessments, incident response plan, encryption.
- **Written data retention policy** — purposes, business need, deletion timeframe.
- Penalties up to **$53,088 per violation**.

**FeisTab's structural advantage:** Parents are users; children are profiles. The parent creating a child profile IS the consent moment. Credit card payment at registration serves as verifiable parental consent (accepted VPC method).

### International Requirements

| Jurisdiction | Age Threshold | Key Rule |
|---|---|---|
| **Ireland** | **16** (strictest in EU) | "Zero interference" with child's best interests. DPIA required at scale. |
| **UK** | 13 | Children's Code (AADC) — 15 additional standards for child-accessible services. |
| **US (COPPA)** | 13 | Verifiable parental consent before collecting child data. |
| **Canada (PIPEDA)** | 13 (OPC position) | Meaningful consent in understandable language. |
| **Australia** | ~15 (capacity-based) | Children's Online Privacy Code expected 2026. |

**Decision:** Apply Ireland's 16-year threshold globally. Since parents register children in our model, this is already architecturally satisfied.

### Data Rules for Sub-Project 2

| Rule | Implementation |
|---|---|
| Parents are users, children are profiles | Children never have login credentials |
| Collect only what's necessary | Name, DOB, gender, studio, level. No address, photos, government IDs. |
| Credit card payment = VPC | Registration payment satisfies COPPA consent |
| Results publication consent | Separate opt-in: name public vs anonymous ("Competitor #247") |
| Right to erasure | Hard delete PII, anonymize historical results |
| Data retention | 3 years active, 7 years payment records, delete medical notes after competition day |
| Never sell children's data | Competitive differentiator — FeisTab explicitly commits to never monetizing child data |

### Edge Cases to Design For (Sub-Project 2)

- Cap reached while checkout is in progress → **hold/timer pattern** (15-min hold on spots, `SELECT FOR UPDATE` in Postgres)
- Edits after payment → strictly limited in v1, refund-and-re-register for significant changes
- Withdrawals/absences → propagate into rosters via the bridge
- Multi-day events and late-fee policies
- Shared custody → invitation model, multiple parents per child, do NOT adjudicate custody disputes

---

## 11. Registration UX Patterns (Informs Current Architecture)

> Full reference: `docs/research/registration-best-practices.md`

These patterns inform sub-project 1 architecture decisions even though the parent portal is sub-project 2.

### Organiser Setup Wizard (Sub-Project 1 — Current)
- **Template-first, not blank slate.** Organiser picks a syllabus template, then enables/disables. Dramatically faster than building from scratch.
- **Bulk operations for 100+ categories.** Select all/none for age groups, bulk set fees, bulk enable/disable.
- **Matrix/grid view for syllabus.** Rows = dances, columns = age groups. Bird's-eye view on one screen.
- **Clone = deep copy with year bump.** Competition structure, fees, and config carry forward. Dates, registrations, and financial records reset.
- **Save-on-each-step.** Draft created on step 1, enriched through subsequent steps. Organiser can leave and return.

### Fee Display (Informs Sub-Project 2)
- **All-in pricing with itemized breakdown.** Show total prominently, line items on demand. Never surprise at checkout.
- **Running total that updates as competitions are added.** This is the #1 UX pattern for multi-event registration.
- **Explain discounts proactively.** "Family discount applied — you saved $10."
- **FTC Junk Fees Rule (May 12, 2025)** — currently applies to audience events, not participation events. But build for all-in pricing from day one.

### Deadline Management
- **Automated tier transitions.** No manual intervention when deadlines pass.
- **Store in UTC, display in event timezone.** Always show timezone label.
- **Countdown timers within 7 days** — increases conversion 8-25%.
- **Grace period (15 min)** for registrations started before deadline but not completed.

### "Register Again" Pattern (Killer Feature for Sub-Project 2)
Email last year's registrants with personalized link that pre-fills dancer profiles and last year's competition selections. Parent reviews, makes changes, checks out in minutes. Dramatically increases return rates.

---

## 12. Architecture Decisions

> Full reference: `docs/research/architecture-patterns.md`

### Separate Supabase Projects (Current Decision)
Pre-reg (`vwfrmhbczwpvqonlpfzs`) is a separate Supabase project from FeisTab Phase 1 (`acxyvouzwgvobtbmvoej`). This isolates auth, migrations, and data sensitivity classes. The trade-off: "Launch Feis Day" (bridge) becomes a cross-project data transfer, not a SQL transaction.

**Bridge implications:** Sub-project 3 will likely use a Supabase Edge Function or API route with service_role keys for both projects. Must handle partial failure gracefully. Cannot use database transactions across the boundary.

### Wizard Routing
Single page at `/organiser/feiseanna/[id]/setup` with client-side step state. Draft row created on step 1, enriched through steps 2-5. Each step saves to DB — no client-only persistence needed.

### Batch Operations
Syllabus expansion (100-160 rows) uses single `.upsert()` call. Supabase generates one `INSERT...VALUES ON CONFLICT` statement. Under 100ms for 160 rows.

### Design System Sharing
Copy-paste with convention for now (globals.css, font setup, shadcn components from FeisTab). Migrate to Turborepo monorepo when maintaining two apps becomes the bottleneck.

### Server Actions vs API Routes

| Operation | Choice | Why |
|---|---|---|
| Clone feis | Server Action | User-initiated, needs auth, redirects after |
| Expand syllabus | Server Action | CPU-bound expansion + batch insert |
| Transition status | Server Action | Same `canTransition()` pattern |
| Stripe webhook | API Route | External caller, needs raw request body |
| Close reg (time-based) | Edge Function + pg_cron | No user interaction, scheduled |

---

## 13. Key Reference Files

| File | Purpose |
|---|---|
| `docs/2026-03-19-organiser-feis-setup-design.md` | Full spec for sub-project 1 |
| `docs/2026-03-19-organiser-feis-setup.md` | Implementation plan (17 tasks) |
| `docs/research/competitive-landscape.md` | Deep competitive intelligence (10+ platforms analyzed) |
| `docs/research/stripe-connect.md` | Stripe Connect implementation guide |
| `docs/research/compliance-and-privacy.md` | COPPA, GDPR, international compliance |
| `docs/research/registration-best-practices.md` | Wizard UX, fee display, deadline management |
| `docs/research/architecture-patterns.md` | Supabase patterns, batch operations, design system |
| `src/lib/types/feis-listing.ts` | All shared TypeScript types |
| `src/lib/feis-listing-states.ts` | Listing state machine |
| `src/lib/engine/fee-calculator.ts` | Fee calculation (pure, integer math) |
| `src/lib/engine/syllabus-expander.ts` | Template → competitions expansion |
