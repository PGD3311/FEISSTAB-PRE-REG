# Parent Registration Portal

**Date:** 2026-03-20
**Goal:** Let parents create family accounts, manage dancer profiles, browse open feiseanna, register dancers for competitions with eligibility filtering, and pay via Stripe Checkout. Let organisers view entries and export rosters. This is sub-project 2 of 3 for pre-registration.

---

## Why This Matters

Sub-project 1 gave organisers the tools to create feis listings with syllabuses, fees, and deadlines. Without a parent portal, those listings have no audience. This spec builds the **demand side**: parents discover feiseanna, register their dancers, and pay — all through a modern, mobile-first experience that replaces the fragmented 2000s-era platforms (FeisWeb, FeisWorx, QuickFeis) that currently dominate.

The registration portal is the revenue engine. Every paid registration generates platform revenue via Stripe application fees. Every successful registration feeds the bridge (sub-project 3) with the data needed to create competition-day rosters.

---

## Sub-Project Boundaries

| Sub-project | Scope | Depends on |
|---|---|---|
| **1. Organiser Feis Setup** | Wizard, syllabus templates, fees, deadlines, clone, Stripe Connect | Nothing |
| **2. Parent Registration Portal (this spec)** | Family accounts, dancer profiles, eligibility filtering, Stripe Checkout, entries, organiser entries view | #1 |
| **3. The Bridge** | "Launch Feis Day" — entries -> event + rosters + number cards, `launched` state | #1 and #2 |

**Boundary rule:** This spec owns `households`, `dancers`, `dancer_dance_levels`, `registrations`, `registration_entries`, and `registration_snapshots`. It adds an "Entries" tab to the organiser feis dashboard. It reads from `feis_listings`, `feis_competitions`, and `fee_schedules` (owned by sub-project 1). It does NOT touch any FeisTab Phase 1 tables (`events`, `competitions`, `dancers`, `registrations` in the day-of system). The bridge (sub-project 3) is the only thing that crosses that boundary.

---

## Account Model

### Capability-Based, Not Role-Based

There is no `role` column anywhere in the system. A user's capabilities are derived from what data exists:

- **Has dancers in a household** -> parent capabilities (dashboard, registration, dancer management)
- **Has feis listings they created** -> organiser capabilities (feis setup, entries view, management)
- **Has both** -> both capabilities, with explicit toggle in the UI

### Frontend Routing

On login, the system checks:
1. Does this user have a household with dancers? -> parent
2. Does this user have feis listings? -> organiser
3. Both? -> show a toggle: "Parent Dashboard" / "Organiser Dashboard"
4. Neither? -> redirect to onboarding

### Signup Onboarding

After email verification, the user sees a lightweight intent picker:

> **What do you want to do first?**
> - Register a dancer for a feis
> - Set up a feis as an organiser

This is intent, not identity. Choosing "Register a dancer" creates a household and routes to `/dashboard/dancers/new`. Choosing "Set up a feis" routes to `/organiser/feiseanna/new`. Either path is reversible — the user can always access the other side later.

---

## Data Model — New Tables

All tables in the `pre_registration` schema (same schema as sub-project 1 tables).

### `households`

One household per user account. The household is the billing and family management unit.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | uuid | PK, default `uuid_generate_v4()` | |
| `user_id` | uuid | NOT NULL, UNIQUE, references `auth.users(id)` | One household per user for MVP |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Why "household" and not "family"?** A household is a billing entity. One login, one payment method, one invoice. Future: guardian invitations can link additional users to the same household, but MVP is one user = one household.

### `dancers`

Child profiles within a household. Children never have login credentials (COPPA compliance — the parent is the user, the child is a profile).

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | uuid | PK, default `uuid_generate_v4()` | |
| `household_id` | uuid | NOT NULL, FK `households` ON DELETE CASCADE | |
| `first_name` | text | NOT NULL | |
| `last_name` | text | NOT NULL | |
| `date_of_birth` | date | NOT NULL | Used for age group calculation (Jan 1 rule) |
| `gender` | text | NOT NULL, CHECK IN (`'female'`, `'male'`) | Some competitions are gendered (e.g., Slip Jig at lower levels) |
| `school_name` | text | NULL | Dance school name (freetext for MVP, dropdown later) |
| `tcrg_name` | text | NULL | Teacher name |
| `championship_status` | text | NOT NULL DEFAULT `'none'`, CHECK IN (`'none'`, `'prelim'`, `'open'`) | For championship eligibility filtering |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | Auto-trigger |

**Data minimization (COPPA):** We collect only what is necessary for registration — name, DOB, gender, school, level. No address, photos, government IDs, social media, or biometric data.

### `dancer_dance_levels`

Per-dance level tracking. A dancer can be at different levels for different dances simultaneously (e.g., Novice for Reel but Advanced Beginner for Slip Jig). This is the #1 source of registration errors on legacy platforms — FeisTab makes it explicit.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | uuid | PK, default `uuid_generate_v4()` | |
| `dancer_id` | uuid | NOT NULL, FK `dancers` ON DELETE CASCADE | |
| `dance_key` | text | NOT NULL | e.g., `'reel'`, `'slip_jig'`, `'treble_jig'` |
| `level_key` | text | NOT NULL | e.g., `'BG'`, `'AB'`, `'NOV'`, `'PW'` |
| `source` | text | NOT NULL DEFAULT `'parent'` | `'parent'` or later `'teacher'` — for future teacher authority |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |
| UNIQUE | | `(dancer_id, dance_key)` | One level per dancer per dance |

**Dancer creation flow:** When a parent adds a dancer, they set a **default level** (e.g., "Novice"). This populates `dancer_dance_levels` for all standard dances at that level. The parent can then adjust individual dances in the dancer profile (e.g., change Slip Jig to Advanced Beginner). This matches how teachers communicate levels: "She's Novice for everything except Slip Jig."

### `registrations`

One registration per household per feis. Contains the state machine, payment references, and capacity hold timing.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | uuid | PK, default `uuid_generate_v4()` | |
| `feis_listing_id` | uuid | NOT NULL, FK `feis_listings` | |
| `household_id` | uuid | NOT NULL, FK `households` | |
| `status` | text | NOT NULL DEFAULT `'draft'`, CHECK IN (`'draft'`, `'pending_payment'`, `'paid'`, `'expired'`, `'cancelled'`) | State machine |
| `confirmation_number` | text | UNIQUE, NULL until paid | Human-readable, e.g., `"FT-2026-A3B7"` |
| `stripe_checkout_session_id` | text | NULL | Stripe Checkout session reference |
| `stripe_payment_intent_id` | text | NULL | For refund/lookup |
| `stripe_charge_id` | text | NULL | For reconciliation |
| `total_cents` | integer | NOT NULL DEFAULT 0, CHECK >= 0 | Total charged to parent |
| `application_fee_cents` | integer | NOT NULL DEFAULT 0, CHECK >= 0 | Platform fee (FeisTab revenue) |
| `event_fee_cents` | integer | NOT NULL DEFAULT 0, CHECK >= 0 | Family event fee component |
| `is_late` | boolean | NOT NULL DEFAULT false | Was this a late registration? Late-ness is determined at registration time based on whether `now()` is after `reg_closes_at`. All entries in a registration share the same late status. The `late_fee_cents` on individual `registration_entries` is per-dancer (charged once per dancer, not per entry), computed by the fee calculator. |
| `consent_accepted_at` | timestamptz | NULL | When terms were accepted |
| `consent_version` | text | NULL | Which version of terms |
| `consent_ip` | text | NULL | IP address at consent time |
| `hold_expires_at` | timestamptz | NULL | When capacity hold expires |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | Auto-trigger |

**Unique constraint:** `(feis_listing_id, household_id)` with a partial index `WHERE status NOT IN ('expired', 'cancelled')` — one active registration per household per feis. Expired and cancelled registrations don't block re-registration.

### `registration_entries`

Individual competition entries within a registration. One row per dancer per competition.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | uuid | PK, default `uuid_generate_v4()` | |
| `registration_id` | uuid | NOT NULL, FK `registrations` ON DELETE CASCADE | |
| `dancer_id` | uuid | NOT NULL, FK `dancers` | |
| `feis_competition_id` | uuid | NOT NULL, FK `feis_competitions` | |
| `fee_category` | text | NOT NULL, CHECK IN (`'solo'`, `'prelim_champ'`, `'open_champ'`) | Which fee applies |
| `base_fee_cents` | integer | NOT NULL, CHECK >= 0 | Frozen fee at time of registration |
| `late_fee_cents` | integer | NOT NULL DEFAULT 0, CHECK >= 0 | Per-dancer, first entry only |
| `day_of_surcharge_cents` | integer | NOT NULL DEFAULT 0, CHECK >= 0 | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| UNIQUE | | `(registration_id, dancer_id, feis_competition_id)` | No duplicate entries |

### `registration_snapshots`

Stores a full snapshot of the registration for the "Register Again" feature. Architecture only for v1 — we store snapshots on every successful payment but do not ship the prefill feature.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | uuid | PK, default `uuid_generate_v4()` | |
| `registration_id` | uuid | NOT NULL, FK `registrations` | |
| `snapshot_data` | jsonb | NOT NULL | Full registration details: dancers, competitions selected, fee breakdown |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Snapshot structure (jsonb):**

```jsonc
{
  "feis_listing_id": "uuid",
  "feis_name": "Midwest Open Feis 2026",
  "feis_date": "2026-06-15",
  "dancers": [
    {
      "dancer_id": "uuid",
      "first_name": "Siobhan",
      "last_name": "OBrien",
      "age_group_key": "U12",
      "championship_status": "none",
      "competitions": [
        {
          "feis_competition_id": "uuid",
          "age_group_key": "U12",
          "level_key": "NOV",
          "dance_key": "reel",
          "competition_type": "solo",
          "display_name": "U12 Novice Reel"
        }
      ]
    }
  ],
  "fee_breakdown": { /* FeeBreakdown object */ },
  "total_cents": 7460
}
```

---

## Registration State Machine

### States

```
draft ──────────────> pending_payment ──────────────> paid
  |                        |
  |                        ├──────────────> expired (hold timeout)
  |                        |
  └────────────────> cancelled (user abandoned)
```

| State | Meaning | Entry Condition |
|---|---|---|
| `draft` | Parent has entered Step 3 (Review). Capacity holds placed. Cart is being finalized. | Created when parent clicks "Review & Pay" |
| `pending_payment` | Stripe Checkout session created. Waiting for webhook confirmation. | Stripe Checkout session created server-side |
| `paid` | Webhook `checkout.session.completed` received. Confirmation email sent. Registration complete. | Webhook handler processes successful payment |
| `expired` | Hold timer ran out before payment completed. Holds released. Can be retried. | Background job or on-demand check |
| `cancelled` | User explicitly abandoned the registration. | User clicks "Cancel" during review |

### State Transitions

```typescript
const VALID_REGISTRATION_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  draft: ['pending_payment', 'cancelled', 'expired'],
  pending_payment: ['paid', 'expired', 'cancelled'],
  paid: [],       // Terminal state for MVP (no refunds/edits)
  expired: [],    // Terminal — parent must start a new registration
  cancelled: [],  // Terminal — parent must start a new registration
}
```

Enforced by `canTransitionRegistration(from, to)` in `src/lib/registration-states.ts`. Same pattern as `canTransitionListing()`.

### Hold Lifecycle

1. **Hold created** when `registration` row transitions to `draft` (parent enters Step 3).
   - `hold_expires_at` set to `now() + 30 minutes`.
   - For each competition entry, increment a hold counter on `feis_competitions` (or use the registration count query).
   - Race condition safety: `SELECT FOR UPDATE` on `feis_competitions` rows, check `capacity_cap` minus current active registrations/holds > 0 before placing.
2. **Timer visible** on the Review page. Countdown shows "You have X:XX to complete payment."
3. **On payment success** (webhook): `hold_expires_at` cleared. Registration status -> `paid`. Hold converts to confirmed entry.
4. **On expiry**: Background job (pg_cron or on-demand check) transitions registration to `expired`. Holds are implicitly released because the registration is no longer `draft` or `pending_payment`.
5. **On page refresh during Step 3**: Server checks if a `draft` or `pending_payment` registration exists for this household + feis and is not expired. If yes, reuse it. If expired, allow new registration.
6. **Edge case — late webhook**: If the Stripe webhook arrives after `hold_expires_at` but payment actually succeeded, **honor the payment**. The hold is a UX tool (prevents overselling during checkout), not a hard lock. If the feis is truly at capacity, the organiser handles the overage manually — this is an extremely rare edge case and the payment has already been collected.

### Capacity Counting

Available spots for a competition = `capacity_cap` - (count of `registration_entries` where `registration.status IN ('draft', 'pending_payment', 'paid')` and `feis_competition_id` matches and `(hold_expires_at IS NULL OR hold_expires_at > now())`). The `hold_expires_at` filter ensures expired holds are not counted against capacity. This query is the source of truth. No separate counter column needed — the count is derived from the registrations table.

---

## Eligibility Engine

Pure function. Located at `src/lib/engine/eligibility.ts`. No Supabase, no React, no side effects.

### Function Signature

```typescript
interface DanceLevelMap {
  [danceKey: string]: string  // e.g., { reel: 'NOV', slip_jig: 'AB' }
}

interface DancerProfile {
  dob: Date
  gender: string
  championshipStatus: 'none' | 'prelim' | 'open'
  danceLevels: DanceLevelMap
}

// Represents a feis_competitions database row — the canonical shape for
// eligibility filtering, cart building, and capacity checks.
interface FeisCompetition {
  id: string
  feis_listing_id: string
  age_group_key: string | null
  age_group_label: string | null
  age_max_jan1: number | null
  age_min_jan1: number | null
  level_key: string | null
  level_label: string | null
  dance_key: string | null
  dance_label: string | null
  competition_type: CompetitionType
  championship_key: ChampionshipKey | null
  fee_category: FeeCategoryType
  display_name: string
  capacity_cap: number | null
  enabled: boolean
}

interface EligibleCompetition {
  competition: FeisCompetition
  eligible: boolean
  reason: string  // e.g., "Age and level match", "Championship status insufficient"
}

function getEligibleCompetitions(
  dancer: DancerProfile,
  competitions: FeisCompetition[],
  ageCutoffDate: Date
): EligibleCompetition[]
```

### Eligibility Logic

1. **Calculate dancer's age on the cutoff date.** The cutoff date is `feis_listings.age_cutoff_date`, defaulting to January 1 of the feis year. Age = years between DOB and cutoff date (whole years, floor).

2. **Determine age group.** For each competition's age constraints:
   - If `age_max_jan1` is set: dancer's age must be <= `age_max_jan1`
   - If `age_min_jan1` is set: dancer's age must be >= `age_min_jan1`
   - If both are NULL (cross-age special): age always matches

3. **For each competition, check eligibility by type:**

   **Solo:** Age group matches AND dancer's level for the competition's `dance_key` matches the competition's `level_key`. Level matching uses the rank system from the template: dancer's level rank must be >= competition's level rank. A Prizewinner can enter a Novice competition (dancing down is allowed in some contexts), but the eligibility engine filters to exact level match by default. "Show all levels" toggle in the UI allows dancing down.

   **Championship:** Age group matches AND dancer's `championship_status` meets the requirement:
   - Prelim Championship: `championship_status` must be `'prelim'` or `'open'`
   - Open Championship: `championship_status` must be `'open'`

   **Special (ceili, figure):** Always eligible if age group matches (or if cross-age, always eligible). Specials are open to all levels.

   **Custom:** Always eligible. Custom competitions have no automated eligibility rules — they are organiser-defined edge cases.

4. **Filter disabled competitions.** Only `enabled = true` competitions are returned.

5. **Return the full list** with `eligible: true/false` and a human-readable `reason` for each. The UI shows eligible competitions by default and hides ineligible ones (with a "Show all" toggle).

### Level Rank System

Level ranks from the template data determine comparison order:

| Level | Key | Rank |
|---|---|---|
| Beginner | BG | 1 |
| Advanced Beginner | AB | 2 |
| Novice | NOV | 3 |
| Prizewinner | PW | 4 |

The eligibility engine receives the level rank mapping from the template (via `syllabus_snapshot.levels`). It does NOT hardcode levels — future templates (WIDA, An Comhdhail) may have different level structures.

### Age Calculation

```typescript
function calculateAgeOnDate(dob: Date, referenceDate: Date): number {
  let age = referenceDate.getFullYear() - dob.getFullYear()
  const monthDiff = referenceDate.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--
  }
  return age
}
```

**Example:** A child born on March 15, 2014. On January 1, 2026, they are 11 years old. They compete in the "Under 12" (U12, max_age_jan1 = 11) age group for the entire 2026 season — even if the feis is in July when they are 12.

---

## Registration Flow

### Three Entry Points, One Engine

Every registration goes through the same three-step engine regardless of entry point:

| Entry Point | How it starts | What's pre-filled |
|---|---|---|
| **Browse-first** | Parent clicks "Register" on a feis listing page | Feis is pre-selected. Dancer selection starts fresh. |
| **Dashboard-first** | Parent clicks "Register for a feis" from their dashboard | Nothing pre-selected. Parent picks feis first. |
| **Register Again** | Parent clicks "Register Again" from a past registration card | Feis pre-selected. Dancers and competitions pre-filled from snapshot. (Architecture only — prefill not shipped in v1.) |

### Step 1: Who's Dancing?

**Route:** `/feiseanna/[id]/register` (step 1)

The parent selects which dancers from their household will attend this feis.

- List all dancers in the household with name, age group (calculated for this feis), and current level summary
- Checkboxes to select/deselect each dancer
- "Add a new dancer" link (opens `/dashboard/dancers/new` in a modal or navigates there)
- For each selected dancer, show the calculated age group: "Siobhan is Under 12 for this feis"
- If no dancers exist in the household, redirect to `/dashboard/dancers/new` with a return URL

**Validation:** At least one dancer must be selected to proceed.

### Step 2: Build Cart

**Route:** `/feiseanna/[id]/register` (step 2)

The core competition selection experience. One tab per selected dancer.

**Per-dancer tab:**
- Header: dancer name, age group, level summary
- Eligible competitions listed, grouped by type:
  - **Solo dances** (Reel, Light Jig, Slip Jig, Treble Jig, Hornpipe, etc.) — filtered to dancer's age group and per-dance level
  - **Championships** (Prelim, Open) — shown only if dancer's `championship_status` qualifies
  - **Specials** (Ceili, Figure) — shown if age group matches
  - **Custom** — always shown
- Each competition is a checkbox with the fee displayed: `[ ] Novice Reel — $15`
- "Show all competitions" toggle to reveal ineligible ones (greyed out, with reason tooltip: "Level too low for Prizewinner Reel")
- Capacity indicator: if a competition has `capacity_cap`, show remaining spots. If sold out, disable the checkbox.

**Running total (sticky footer on mobile, sidebar on desktop):**

```
YOUR CART                                $74.60
3 dances, 2 dancers  ·  View details
```

Expandable to show itemized breakdown by dancer:
- Per-dancer subtotal with line items
- Event fee (per family, applied once)
- Family cap applied / savings shown in green
- Late fee per dancer (if applicable, clearly labeled)

The running total updates in real time as competitions are added/removed. It calls `calculateFees()` (the existing pure function from sub-project 1) on every change.

**Validation:** At least one competition must be selected across all dancers to proceed.

### Step 3: Review & Pay

**Route:** `/feiseanna/[id]/register` (step 3)

Summary screen with all selections, full fee breakdown, and payment initiation.

**Displays:**
- Feis name, date, venue
- Per-dancer: name, age group, competitions selected with fees
- Itemized fee breakdown (same as running total, fully expanded)
- If late registration: "Late fee: $25/dancer" clearly shown per dancer
- If family cap applied: "Family cap applied — you saved $X" in green
- Grand total prominently displayed
- Capacity hold timer: "Your spots are held for X:XX" (countdown from 30 minutes)

**Legal consent checkbox (required before payment):**

> I agree to the [Terms of Service] and [Privacy Policy] and confirm I am the parent/legal guardian of the dancers listed above.

On check: record `consent_accepted_at`, `consent_version`, `consent_ip`, and `user_id`.

**"Pay $XX.XX" button:**
- Disabled until consent checkbox is checked
- On click: creates Stripe Checkout session server-side, redirects to Stripe-hosted checkout page
- Registration transitions from `draft` -> `pending_payment`

**Cancel button:**
- Transitions registration to `cancelled`
- Releases holds
- Returns to feis listing page

**On page refresh:**
- Server checks for existing `draft` registration for this household + feis
- If found and not expired: restore the review page with existing selections
- If found but expired: show "Your session expired" message with "Start over" button
- If not found: redirect to Step 1

---

## Feis Listing Page (Public)

### Route: `/feiseanna`

Browse all open feiseanna. No login required.

**Displays per feis card:**
- Feis name
- Date (with day of week)
- Venue name + city/state
- Registration deadline + urgency indicator (countdown if within 7 days, "Closes in X days" badge)
- Late registration indicator if applicable ("Late reg until [date]")
- Fee summary: "Solo: $15 | Event fee: $30 | Family cap: $150"
- Competition count: "42 competitions across 14 age groups"
- Capacity status: if `dancer_cap` is set, show "X spots remaining" or "Open"

**Sorting:** By date (soonest first) by default. Filter by: upcoming only, has capacity, registration open.

**No login required to browse.** Public `SELECT` policy on `feis_listings WHERE status = 'open'` already exists from sub-project 1.

### Route: `/feiseanna/[id]`

Individual feis listing detail page.

**Always visible (public):**
- Full feis details: name, date, venue with map link, description, contact info (if `show_contact_publicly`)
- Registration timeline: opens, closes, late closes
- Fee schedule: all fee categories, family cap
- Competition count by type (e.g., "36 solo dances, 4 championships, 2 specials")
- Full competition list (expandable/collapsible by age group)
- Capacity status

**Logged-in parent (with dancers):**
- "Quick eligibility preview" — select a saved dancer from a dropdown, see which competitions they qualify for. This calls the eligibility engine client-side with the dancer's profile and the feis's competition list.
- "Register" button (prominent CTA)

**Logged-out visitor:**
- "Sign in for exact eligibility" CTA
- Anonymous approximate preview: "Enter age and default level for an estimate" — a lightweight form (age + level dropdown) that runs the eligibility engine with synthetic data. Results labeled "Approximate — sign in with your dancer profile for exact eligibility."
- "Sign in to register" button

---

## Checkout & Payment

### Stripe Checkout (Hosted)

We use Stripe Checkout in hosted mode. The parent is redirected to a Stripe-hosted page for payment. This gives us:
- Zero PCI surface area
- Apple Pay, Google Pay, Link out of the box
- Mobile-optimized payment form
- 3D Secure handling

### Direct Charges on Connected Account

The charge is created on the organiser's Express account using Direct Charges. The parent's bank statement shows the feis name, not "FeisTab." Platform revenue is collected via `application_fee_amount`.

### Checkout Session Creation (Server-Side)

When the parent clicks "Pay" on the review page:

```typescript
// Server action or API route
async function createCheckoutSession(registrationId: string): Promise<string> {
  // 1. Load registration with entries, dancer names, feis details
  // 2. Verify registration status is 'draft'
  // 3. Verify holds are not expired
  // 4. Build Stripe line items from registration_entries

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,  // One line item per entry, human-readable descriptions
    payment_intent_data: {
      // Application fee = Math.round(total_cents * STRIPE_APPLICATION_FEE_PERCENT / 100)
      // Where STRIPE_APPLICATION_FEE_PERCENT is an environment variable (e.g., 5 = 5%).
      application_fee_amount: applicationFeeCents,
    },
    success_url: `${baseUrl}/feiseanna/${feisId}/register/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/feiseanna/${feisId}/register?step=3`,
    metadata: {
      registration_id: registrationId,
    },
    expires_after: 1800,  // 30 minutes — generous, covers hold window
  }, {
    stripeAccount: connectedAccountId,  // Direct Charge on organiser's account
    idempotencyKey: `checkout_${registrationId}`,
  })

  // 5. Update registration: stripe_checkout_session_id = session.id, status = 'pending_payment'
  // 6. Return session.url for redirect
  return session.url
}
```

### Webhook-Driven Truth

**The Stripe `checkout.session.completed` webhook is the authoritative payment confirmation.** The success redirect page is cosmetic — it checks status but does not create the registration.

**Webhook handler:** `src/app/api/webhooks/stripe/route.ts`

```typescript
export async function POST(request: Request) {
  const body = await request.text()  // RAW body — not .json()
  const sig = request.headers.get('stripe-signature')

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig!, connectWebhookSecret)
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const registrationId = session.metadata?.registration_id

    // Idempotency: check if already processed
    const registration = await getRegistration(registrationId)
    if (registration.status === 'paid') {
      return new Response('Already processed', { status: 200 })
    }

    // Extract charge ID from the payment intent for reconciliation
    const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string)
    const chargeId = paymentIntent.latest_charge as string | null

    // Update registration
    await updateRegistration(registrationId, {
      status: 'paid',
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_charge_id: chargeId,
      total_cents: session.amount_total!,
      confirmation_number: generateConfirmationNumber(),
      hold_expires_at: null,  // Clear hold — permanently confirmed
    })

    // Create snapshot for Register Again
    await createRegistrationSnapshot(registrationId)

    // Send confirmation email
    await sendConfirmationEmail(registrationId)
  }

  return new Response('OK', { status: 200 })
}
```

### Confirmation Number Format

Human-readable, unique, 10 characters: `FT-YYYY-XXXX` where YYYY is the year and XXXX is 4 alphanumeric characters (uppercase, no ambiguous chars like 0/O, 1/I/L).

Example: `FT-2026-A3B7`

Generated server-side on payment confirmation. Stored on `registrations.confirmation_number`. Shown in confirmation email and on dashboard. Generation uses a retry loop: generate a candidate, attempt insert, if uniqueness violation retry with a new candidate (max 5 retries).

### Success Redirect Page

**Route:** `/feiseanna/[id]/register/success`

This page is **cosmetic**. It:
1. Reads `session_id` from query params
2. Checks registration status in the database
3. If `paid`: shows confirmation with details
4. If `pending_payment`: shows "Processing your payment..." with auto-refresh (webhook may not have arrived yet)
5. If `expired` or `cancelled`: shows appropriate message

This page does NOT change registration status. The webhook does.

---

## Capacity Holds

### How Holds Work

Capacity holds prevent overselling during the checkout window. They are a UX tool — not a hard database lock.

1. **When:** Hold is created when the registration row is created at `draft` status (parent enters Step 3).
2. **Duration:** 30 minutes from creation. `hold_expires_at = now() + interval '30 minutes'`. This matches the Stripe Checkout session expiry (`expires_after: 1800`) and prevents the edge case where a hold expires while the parent is still paying.
3. **Scope:** The hold applies to all `registration_entries` in the registration. Each entry "holds" one spot in its competition.
4. **Counting:** Available spots = `capacity_cap` - count of entries where registration status is `draft`, `pending_payment`, or `paid`.
5. **Race condition safety:** When creating the draft registration and entries:

```sql
BEGIN;
  -- Lock the competition rows being registered for
  SELECT id, capacity_cap
  FROM feis_competitions
  WHERE id = ANY($competition_ids)
  FOR UPDATE;

  -- Count existing active entries per competition
  SELECT feis_competition_id, COUNT(*) as entry_count
  FROM registration_entries re
  JOIN registrations r ON re.registration_id = r.id
  WHERE r.status IN ('draft', 'pending_payment', 'paid')
    AND r.feis_listing_id = $feis_listing_id
    AND (r.hold_expires_at IS NULL OR r.hold_expires_at > now())
  GROUP BY feis_competition_id;

  -- Verify each competition has capacity
  -- If any is full: ROLLBACK and return error

  -- Insert registration and entries
  INSERT INTO registrations (...) VALUES (...);
  INSERT INTO registration_entries (...) VALUES (...);
COMMIT;
```

6. **Expiry handling:** A pg_cron job runs every minute:

```sql
UPDATE registrations
SET status = 'expired', updated_at = now()
WHERE status IN ('draft', 'pending_payment')
  AND hold_expires_at IS NOT NULL
  AND hold_expires_at < now();
```

Alternatively, on-demand: every time a capacity check runs, it ignores registrations where `hold_expires_at < now()`.

7. **Late webhook edge case:** If a Stripe webhook arrives after hold expiry but payment succeeded, the webhook handler still transitions to `paid`. The hold is a soft reservation, not a hard constraint. The organiser can manage overage manually (this is extremely rare and mirrors real-world over-enrollment that already happens with paper registration).

---

## Parent Dashboard

### Route: `/dashboard`

The parent's home base. Shows a chronological feed of registrations across all feiseanna.

**Default view:** Per-family chronological feed, newest first.

**Filter chips:** `[All Dancers]` `[Siobhan]` `[Liam]` — filter to show only registrations involving a specific dancer.

**Each registration card:**
- Feis name and date
- Venue
- Dancers registered (names + age groups)
- Competition count per dancer (e.g., "Siobhan: 3 dances | Liam: 1 dance")
- Payment status badge: Draft (grey) | Pending (yellow) | Paid (green) | Expired (red) | Cancelled (grey)
- Confirmation number (if paid)
- Quick actions:
  - Paid: "View Details" | "View Receipt"
  - Draft: "Continue Registration" (with hold timer)
  - Expired: "Register Again"

**Empty state:** "No registrations yet. Browse open feiseanna to get started." with CTA button.

### Route: `/dashboard/dancers`

Manage dancer profiles.

**List view:** All dancers in the household with name, age, current default level, school. Edit and delete actions.

### Route: `/dashboard/dancers/new`

Add a new dancer. Form fields:

1. **Basic info:** First name, last name, date of birth, gender
2. **Dance info:** School name (optional), teacher name (optional), championship status (none / prelim / open)
3. **Default level:** Select one level (BG / AB / NOV / PW). This populates `dancer_dance_levels` for all standard dances.
4. **Per-dance adjustments (optional):** Expand to show each dance with its level. Parent can adjust individual dances.

**On save:** Create `dancers` row + `dancer_dance_levels` rows for all standard dances.

### Route: `/dashboard/dancers/[id]`

Edit dancer profile. Same form as creation, plus:
- Level adjustment UI: each dance shown with current level, editable
- "Update all to [level]" bulk action
- Delete dancer (with confirmation: "This will remove [name] and all their registration history. Are you sure?")

---

## Organiser Entries View

### Route: `/organiser/feiseanna/[id]` — New "Entries" Tab

Added to the existing organiser feis management page. Read-only for MVP.

**Summary header:**
- Total dancers registered
- Total entries (sum of all competition entries across all dancers)
- Revenue collected (sum of `total_cents` for `paid` registrations)
- Pending registrations count

**Entries table:**

| Dancer Name | School | Competitions | Payment Status | Registration Date |
|---|---|---|---|---|
| Siobhan O'Brien | Celtic Academy | Reel, Slip Jig, Treble Jig | Paid ($45.00) | 2026-03-15 |
| Liam O'Brien | Celtic Academy | Reel | Paid ($15.00) | 2026-03-15 |

**Filtering:** By payment status (All / Paid / Pending / Expired). By competition. Search by dancer name.

**CSV export:** Download button generates a CSV with columns: `dancer_first_name`, `dancer_last_name`, `date_of_birth`, `gender`, `age_group`, `school_name`, `competition_display_name`, `competition_code`, `fee_category`, `payment_status`, `registration_date`, `confirmation_number`.

**No admin mutation for MVP.** Organisers cannot edit, cancel, or refund registrations from this view. That is explicitly deferred. If a parent needs a change, they contact the organiser who handles it manually outside the system.

---

## Transactional Emails

### Provider: Resend (or equivalent)

Not Supabase Auth emails. We need branded, customizable transactional emails.

### Registration Confirmation Email

**Triggered by:** Webhook handler after `checkout.session.completed` processes successfully.

**Subject:** "You're registered for [Feis Name]"

**Contents:**
- Feis name, date, venue with map link
- Confirmation number (prominent)
- Per-dancer section:
  - Dancer name, age group
  - Competitions entered (display names)
- Itemized fee receipt:
  - Per-dancer line items (competition fees, late fees)
  - Event fee
  - Family cap discount (if applied)
  - Total paid
- "What's next" section: "We'll email your schedule closer to the feis date."
- Organiser contact info
- "View your registration" link to dashboard

### What's NOT Included (MVP)

- Reminder emails (1 week before, 1 day before)
- Schedule notification emails
- SMS notifications
- Registration deadline warning emails
- "Register Again" outreach emails

These are all valuable but deferred to post-MVP.

---

## Legal Consent

### Consent Checkpoint

At Step 3 (Review & Pay), before the payment button is enabled:

> [ ] I agree to the [Terms of Service] and [Privacy Policy] and confirm I am the parent/legal guardian of the dancers listed above.

Links open in new tabs to the organiser's `terms_url` and `privacy_policy_url` (set on the feis listing in sub-project 1). If `terms_url` is null on the feis listing, the consent checkbox shows only the privacy policy link. `terms_url` is not a publish prerequisite -- organisers may use their own terms outside the platform.

### Consent Record

On checkbox check, we record:
- `consent_accepted_at`: timestamp
- `consent_version`: string (e.g., `"tos-v1-2026-03-01"`)
- `consent_ip`: IP address from request headers
- `user_id`: from auth session (implicit via `household_id`)

### COPPA Compliance

Credit card payment at registration serves as verifiable parental consent (VPC). This is an accepted COPPA method. The parent creating a child profile and paying with a credit card satisfies the consent requirement.

Children never have login credentials. They are profiles within a parent's household. The parent is the data controller for their children's information.

---

## RLS Policies

```sql
-- ─── households ───
ALTER TABLE households ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own household" ON households
  FOR ALL USING (auth.uid() = user_id);

-- ─── dancers ───
ALTER TABLE dancers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own dancers" ON dancers
  FOR ALL USING (
    household_id IN (
      SELECT id FROM households WHERE user_id = auth.uid()
    )
  );

-- Organisers can read dancer names for dancers registered at their feiseanna
CREATE POLICY "Organisers read dancers at their feiseanna" ON dancers FOR SELECT
  USING (id IN (
    SELECT re.dancer_id FROM registration_entries re
    JOIN registrations r ON re.registration_id = r.id
    WHERE r.feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid())
  ));

-- ─── dancer_dance_levels ───
ALTER TABLE dancer_dance_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Levels follow dancer access" ON dancer_dance_levels
  FOR ALL USING (
    dancer_id IN (
      SELECT d.id FROM dancers d
      JOIN households h ON d.household_id = h.id
      WHERE h.user_id = auth.uid()
    )
  );

-- ─── registrations ───
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

-- Parents see and manage their own registrations
CREATE POLICY "Parents manage own registrations" ON registrations
  FOR ALL USING (
    household_id IN (
      SELECT id FROM households WHERE user_id = auth.uid()
    )
  );

-- Organisers can read registrations for their feiseanna
CREATE POLICY "Organisers see registrations for their feiseanna" ON registrations
  FOR SELECT USING (
    feis_listing_id IN (
      SELECT id FROM feis_listings WHERE created_by = auth.uid()
    )
  );

-- ─── registration_entries ───
ALTER TABLE registration_entries ENABLE ROW LEVEL SECURITY;

-- Parents see entries for their registrations
CREATE POLICY "Entries follow registration (parent)" ON registration_entries
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE household_id IN (
        SELECT id FROM households WHERE user_id = auth.uid()
      )
    )
  );

-- Organisers see entries for their feiseanna
CREATE POLICY "Organisers see entries for their feiseanna" ON registration_entries
  FOR SELECT USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE feis_listing_id IN (
        SELECT id FROM feis_listings WHERE created_by = auth.uid()
      )
    )
  );

-- ─── registration_snapshots ───
ALTER TABLE registration_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Snapshots follow registration" ON registration_snapshots
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE household_id IN (
        SELECT id FROM households WHERE user_id = auth.uid()
      )
    )
  );
```

**Existing policies (from sub-project 1, unchanged):**
- `feis_listings`: public read for `status = 'open'`, organiser CRUD for `created_by = auth.uid()`
- `feis_competitions`: public read for open listings, organiser CRUD
- `fee_schedules`: public read for open listings, organiser CRUD

---

## Pages / Routes

### Parent-Facing

| Route | Purpose | Auth Required |
|---|---|---|
| `/feiseanna` | Browse open feiseanna (public listing) | No |
| `/feiseanna/[id]` | Feis detail page with eligibility preview | No (enhanced if logged in) |
| `/feiseanna/[id]/register` | Registration engine (Steps 1-3) | Yes |
| `/feiseanna/[id]/register/success` | Post-payment confirmation (cosmetic) | Yes |
| `/dashboard` | Parent dashboard — registration feed | Yes |
| `/dashboard/dancers` | Manage dancer profiles | Yes |
| `/dashboard/dancers/new` | Add a dancer | Yes |
| `/dashboard/dancers/[id]` | Edit dancer profile + levels | Yes |

### Organiser (Updated)

| Route | Purpose | Change |
|---|---|---|
| `/organiser/feiseanna/[id]` | Feis management page | **Add "Entries" tab** |

### Auth (Updated)

| Route | Purpose | Change |
|---|---|---|
| `/auth/signup` | Create account | **Add intent picker** ("Register a dancer" / "Set up a feis") |

### API Routes

| Route | Purpose |
|---|---|
| `/api/webhooks/stripe` | Stripe Connect webhook handler — payment confirmation, account updates |

---

## Server Actions

| Operation | Server Action | Location | Why |
|---|---|---|---|
| Create household | `createHousehold()` | `src/app/dashboard/actions.ts` | Atomic creation on signup intent |
| Create dancer | `createDancer(data)` | `src/app/dashboard/dancers/actions.ts` | Creates dancer + dance levels in one transaction |
| Update dancer | `updateDancer(id, data)` | `src/app/dashboard/dancers/actions.ts` | Updates dancer + syncs dance levels |
| Create draft registration | `createDraftRegistration(feisId, dancerIds, competitionIds)` | `src/app/feiseanna/[id]/register/actions.ts` | Atomic: creates registration + entries + places holds with `SELECT FOR UPDATE` |
| Create checkout session | `createCheckoutSession(registrationId)` | `src/app/feiseanna/[id]/register/actions.ts` | Creates Stripe session, transitions to `pending_payment` |
| Cancel registration | `cancelRegistration(registrationId)` | `src/app/feiseanna/[id]/register/actions.ts` | Transitions to `cancelled`, releases holds |

---

## New Engine Code

### `src/lib/engine/eligibility.ts`

Pure function. Eligibility filtering engine. Described in detail in the "Eligibility Engine" section above.

**Public API:**
- `getEligibleCompetitions(dancer, competitions, ageCutoffDate)` -> `EligibleCompetition[]`
- `calculateAgeOnDate(dob, referenceDate)` -> `number`

### `src/lib/registration-states.ts`

State machine for registration lifecycle. Same pattern as `feis-listing-states.ts`.

**Public API:**
- `canTransitionRegistration(from, to)` -> `boolean`
- `getNextRegistrationStates(current)` -> `RegistrationStatus[]`

### Updated: `src/lib/types/feis-listing.ts`

Add new types for sub-project 2:

```typescript
// ─── Registration status ───
export type RegistrationStatus = 'draft' | 'pending_payment' | 'paid' | 'expired' | 'cancelled'

// ─── Championship status ───
export type ChampionshipStatus = 'none' | 'prelim' | 'open'

// ─── Dancer types ───
export interface Dancer {
  id: string
  household_id: string
  first_name: string
  last_name: string
  date_of_birth: string  // ISO date
  gender: 'female' | 'male'
  school_name: string | null
  tcrg_name: string | null
  championship_status: ChampionshipStatus
  created_at: string
  updated_at: string
}

export interface DancerDanceLevel {
  id: string
  dancer_id: string
  dance_key: string
  level_key: string
  source: 'parent' | 'teacher'
  updated_at: string
}

// ─── Registration types ───
export interface Registration {
  id: string
  feis_listing_id: string
  household_id: string
  status: RegistrationStatus
  confirmation_number: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  total_cents: number
  application_fee_cents: number
  event_fee_cents: number
  is_late: boolean
  consent_accepted_at: string | null
  consent_version: string | null
  consent_ip: string | null
  hold_expires_at: string | null
  created_at: string
  updated_at: string
}

export interface RegistrationEntry {
  id: string
  registration_id: string
  dancer_id: string
  feis_competition_id: string
  fee_category: FeeCategoryType
  base_fee_cents: number
  late_fee_cents: number
  day_of_surcharge_cents: number
  created_at: string
}

// ─── Eligibility types ───
export interface DanceLevelMap {
  [danceKey: string]: string
}

export interface DancerProfile {
  dob: Date
  gender: string
  championshipStatus: ChampionshipStatus
  danceLevels: DanceLevelMap
}

export interface EligibleCompetition {
  competition: FeisCompetition  // Full feis_competitions row — see eligibility engine section
  eligible: boolean
  reason: string
}
```

---

## Migration

### Migration file: `002_parent_registration.sql`

(Numbering continues from sub-project 1's `001_feis_setup.sql`.)

```sql
SET search_path TO pre_registration, public;

-- ─── households ───
CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_households_user_id ON households(user_id);

-- ─── dancers ───
-- Note: 'dancers' also exists in the public schema (Phase 1 day-of).
-- These are separate tables in separate schemas. The bridge (Sub-project 3)
-- maps between them.
CREATE TABLE dancers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text NOT NULL CHECK (gender IN ('female', 'male')),
  school_name text,
  tcrg_name text,
  championship_status text NOT NULL DEFAULT 'none'
    CHECK (championship_status IN ('none', 'prelim', 'open')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dancers_household_id ON dancers(household_id);
CREATE TRIGGER set_dancers_updated_at BEFORE UPDATE ON dancers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── dancer_dance_levels ───
CREATE TABLE dancer_dance_levels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  dancer_id uuid NOT NULL REFERENCES dancers(id) ON DELETE CASCADE,
  dance_key text NOT NULL,
  level_key text NOT NULL,
  source text NOT NULL DEFAULT 'parent',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dancer_id, dance_key)
);

CREATE INDEX idx_dancer_dance_levels_dancer_id ON dancer_dance_levels(dancer_id);
CREATE TRIGGER set_dancer_dance_levels_updated_at BEFORE UPDATE ON dancer_dance_levels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── registrations ───
-- Note: 'registrations' also exists in the public schema (Phase 1 day-of).
-- These are separate tables in separate schemas. The bridge (Sub-project 3)
-- maps between them.
CREATE TABLE registrations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  feis_listing_id uuid NOT NULL REFERENCES feis_listings(id),
  household_id uuid NOT NULL REFERENCES households(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_payment', 'paid', 'expired', 'cancelled')),
  confirmation_number text UNIQUE,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  application_fee_cents integer NOT NULL DEFAULT 0 CHECK (application_fee_cents >= 0),
  event_fee_cents integer NOT NULL DEFAULT 0 CHECK (event_fee_cents >= 0),
  is_late boolean NOT NULL DEFAULT false,
  consent_accepted_at timestamptz,
  consent_version text,
  consent_ip text,
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active registration per household per feis
CREATE UNIQUE INDEX idx_registrations_active_unique
  ON registrations (feis_listing_id, household_id)
  WHERE status NOT IN ('expired', 'cancelled');

CREATE INDEX idx_registrations_feis_listing_id ON registrations(feis_listing_id);
CREATE INDEX idx_registrations_household_id ON registrations(household_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_registrations_hold_expires ON registrations(hold_expires_at)
  WHERE status IN ('draft', 'pending_payment') AND hold_expires_at IS NOT NULL;

CREATE TRIGGER set_registrations_updated_at BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── registration_entries ───
CREATE TABLE registration_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  dancer_id uuid NOT NULL REFERENCES dancers(id),
  feis_competition_id uuid NOT NULL REFERENCES feis_competitions(id),
  fee_category text NOT NULL CHECK (fee_category IN ('solo', 'prelim_champ', 'open_champ')),
  base_fee_cents integer NOT NULL CHECK (base_fee_cents >= 0),
  late_fee_cents integer NOT NULL DEFAULT 0 CHECK (late_fee_cents >= 0),
  day_of_surcharge_cents integer NOT NULL DEFAULT 0 CHECK (day_of_surcharge_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, dancer_id, feis_competition_id)
);

CREATE INDEX idx_registration_entries_registration_id ON registration_entries(registration_id);
CREATE INDEX idx_registration_entries_feis_competition_id ON registration_entries(feis_competition_id);

-- ─── registration_snapshots ───
CREATE TABLE registration_snapshots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id uuid NOT NULL REFERENCES registrations(id),
  snapshot_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_registration_snapshots_registration_id ON registration_snapshots(registration_id);

-- ─── RLS policies ───
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE dancers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dancer_dance_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_snapshots ENABLE ROW LEVEL SECURITY;

-- households
CREATE POLICY "Users manage own household" ON households
  FOR ALL USING (auth.uid() = user_id);

-- dancers
CREATE POLICY "Users manage own dancers" ON dancers
  FOR ALL USING (
    household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
  );

-- Organisers can read dancer names for dancers registered at their feiseanna
CREATE POLICY "Organisers read dancers at their feiseanna" ON dancers FOR SELECT
  USING (id IN (
    SELECT re.dancer_id FROM registration_entries re
    JOIN registrations r ON re.registration_id = r.id
    WHERE r.feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid())
  ));

-- dancer_dance_levels
CREATE POLICY "Levels follow dancer access" ON dancer_dance_levels
  FOR ALL USING (
    dancer_id IN (
      SELECT d.id FROM dancers d
      JOIN households h ON d.household_id = h.id
      WHERE h.user_id = auth.uid()
    )
  );

-- registrations (parent)
CREATE POLICY "Parents manage own registrations" ON registrations
  FOR ALL USING (
    household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
  );

-- registrations (organiser read-only)
CREATE POLICY "Organisers see registrations for their feiseanna" ON registrations
  FOR SELECT USING (
    feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid())
  );

-- registration_entries (parent)
CREATE POLICY "Entries follow registration (parent)" ON registration_entries
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
    )
  );

-- registration_entries (organiser read-only)
CREATE POLICY "Organisers see entries for their feiseanna" ON registration_entries
  FOR SELECT USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid())
    )
  );

-- registration_snapshots
CREATE POLICY "Snapshots follow registration" ON registration_snapshots
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
    )
  );

-- ─── pg_cron: expire stale holds ───
-- (Requires pg_cron extension — Supabase supports this)
-- Run every minute: expire draft/pending_payment registrations past their hold window
SELECT cron.schedule(
  'expire-registration-holds',
  '* * * * *',
  $$
    UPDATE registrations
    SET status = 'expired', updated_at = now()
    WHERE status IN ('draft', 'pending_payment')
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at < now();
  $$
);
```

---

## Environment Variables (New)

```
# Stripe (real keys — replaces sub-project 1 placeholder)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx

# Email (Resend)
RESEND_API_KEY=re_xxx
EMAIL_FROM=noreply@feistab.com

# Application
NEXT_PUBLIC_BASE_URL=http://localhost:3000
STRIPE_APPLICATION_FEE_PERCENT=5  # Platform fee percentage
```

---

## What This Spec Does NOT Cover

Deferred to sub-project 3 (The Bridge):
- `launched` state or equivalent
- `event_id` FK on `feis_listings` (linking to FeisTab Phase 1 events)
- Creating `events`/`competitions`/`registrations` from pre-reg data
- Number card generation and privacy model
- Printable artifacts (PDFs)
- Schedule/live day-of states
- Results integration

Deferred to post-MVP iterations:
- "Register Again" competition prefill (architecture stored via snapshots, UI not shipped)
- SMS notifications
- Reminder emails (1 week, 1 day before)
- Schedule notification emails
- Teacher accounts / level verification
- Guardian invitation (shared custody)
- Waitlist management
- Post-payment edits / refunds
- Custom registration questions (medical notes, spectator wristbands)
- Multi-organiser team/role access
- Push notifications
- Calendar sync (.ics)
- Saved payment methods / stored cards

Explicitly out of scope (no current plan):
- Non-CLRG sanctioning bodies (template system supports them architecturally)
- Custody dispute adjudication
- Custom per-competition fee overrides
- Conditional late fee rules (e.g., different rates by date range)

---

## Design Notes for Sub-Project 3

These architectural decisions are documented now to prevent schema rework later.

**Bridge data flow:** The bridge will query `registrations` (status = `paid`) + `registration_entries` + `dancers` for a given `feis_listing_id`. It will create FeisTab Phase 1 `events`, `competitions`, and `registrations` (day-of) records. The `registration_entries.feis_competition_id` links to `feis_competitions`, which contains the frozen syllabus data needed to create day-of competitions.

**"Register Again" matching:** When comparing last year's registration to this year's feis, match on the composite key `(age_group_key, level_key, dance_key, competition_type)`, not `feis_competitions.id`. The `cloned_from` lineage on `feis_listings` identifies the predecessor feis; the composite key identifies equivalent competition offerings.

**Competitor numbers:** Assigned at bridge time or check-in, not during pre-registration. The pre-reg system does not deal with competitor numbers.

---

## Testing

### Must Test (Engine Code — Vitest)

**`eligibility.ts`:**
- Age calculation: exact boundaries (born on Jan 1, born on Dec 31), leap years
- Age group matching: under-X (max_age_jan1), over-X (min_age_jan1), cross-age (both null)
- Solo eligibility: exact level match for the specific dance_key
- Per-dance level mismatches: dancer is Novice for Reel but AB for Slip Jig — verify each filters independently
- Championship eligibility: `none` cannot enter any championship, `prelim` can enter prelim but not open, `open` can enter both
- Specials: always eligible when age matches (or cross-age)
- Custom: always eligible regardless of age/level
- Disabled competitions: filtered out
- Empty inputs: no competitions, no dance levels
- Gender filtering: if competitions are gendered (future — not in MVP schema but engine should not break)

**`registration-states.ts`:**
- Valid transitions: draft->pending_payment, draft->cancelled, draft->expired, pending_payment->paid, pending_payment->expired, pending_payment->cancelled
- Invalid transitions: paid->anything, expired->anything, cancelled->anything, draft->paid (must go through pending_payment)
- Terminal states: paid, expired, cancelled have no valid next states

**`fee-calculator.ts` (existing — extend tests):**
- Integration with real registration data: multiple dancers, mixed fee categories, late fees
- Family cap with multi-dancer registration
- Event fee applied once regardless of dancer count

### Must Test (Integration)

**Capacity hold lifecycle:**
- Create draft with holds -> verify capacity decremented
- Expire hold -> verify capacity restored
- Pay -> verify hold converts to permanent entry
- Concurrent registrations: two families racing for last spot -> one gets it, one gets "full" error

**Webhook handler:**
- Idempotent: processing same event twice does not duplicate registration
- Handles duplicate events gracefully (returns 200, no side effects)
- Updates registration status from `pending_payment` to `paid`
- Generates confirmation number
- Creates snapshot

**Stripe Checkout session creation:**
- Correct line items generated from registration entries
- `application_fee_amount` calculated correctly
- `stripeAccount` set to organiser's connected account (not platform account)
- `idempotencyKey` uses registration ID

### Manual Testing Checklist

- [ ] Full registration flow: browse -> select dancer -> pick competitions -> checkout -> Stripe -> confirmation email
- [ ] Multi-dancer family: 2+ dancers in one registration, verify correct fees and family cap
- [ ] Eligibility filtering: verify correct competitions shown for dancer's age + level
- [ ] Per-dance level override: dancer at different levels for different dances
- [ ] Championship filtering: only shown to qualifying dancers
- [ ] Capacity hold: wait 30 minutes, verify expiry and ability to re-register
- [ ] Page refresh during Step 3: verify draft is reused, not duplicated
- [ ] Stripe Checkout cancellation: return to review page with cart intact
- [ ] Organiser entries view: verify entries table, summary stats, CSV export
- [ ] Mobile registration flow: complete registration on a phone-sized viewport
- [ ] Anonymous feis browsing: view listing details without login
- [ ] Eligibility preview: logged-in with dancer selected vs logged-out approximate preview
- [ ] Signup onboarding: both intent paths (register dancer / set up feis) route correctly
- [ ] Account with both dancers and feiseanna: verify Parent/Organiser toggle works
