# Organiser Feis Setup

**Date:** 2026-03-19
**Goal:** Let an organiser create a feis listing with syllabus, fees, and deadlines — ready for parents to register against. This is sub-project 1 of 3 for pre-registration.

---

## Why This Matters

FeisTab's Phase 1 chain (check-in → scoring → tabulation → results) works, but competition rosters are currently CSV-imported. Pre-registration replaces that manual step. This spec builds the **upstream foundation**: the organiser creates a feis listing that the parent portal (sub-project 2) will register against, and the bridge (sub-project 3) will convert into competition-day rosters.

Without this, there's nothing for parents to register *for*.

---

## Sub-Project Boundaries

| Sub-project | Scope | Depends on |
|---|---|---|
| **1. Organiser Feis Setup (this spec)** | Wizard, syllabus templates, fees, deadlines, clone, Stripe Connect | Nothing |
| **2. Parent Registration Portal** | Family accounts, dancer profiles, eligibility filtering, Stripe Checkout, entries | #1 |
| **3. The Bridge** | "Launch Feis Day" — entries → event + rosters + number cards, `launched` state | #1 and #2 |

Each sub-project gets its own spec → plan → build cycle in a separate Claude session.

**Boundary rule:** This spec owns `feis_listings`, `feis_competitions`, `fee_schedules`, and `syllabus_templates`. It does NOT touch the existing `competitions`, `events`, `dancers`, or `registrations` tables. Those belong to Phase 1 (day-of operations). The bridge (sub-project 3) is the only thing that crosses that boundary.

---

## Data Model

### New Tables

#### `feis_listings`

The core feis record. One per feis per year. This is a pre-registration object — it is NOT an event-day object.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `name` | `text` | NOT NULL | e.g., "Midwest Open Feis 2026" |
| `feis_date` | `date` | NOT NULL | Primary event date |
| `end_date` | `date` | NULL | For multi-day events |
| `venue_name` | `text` | NOT NULL | Venue name |
| `venue_address` | `text` | NULL | Full address |
| `contact_email` | `text` | NOT NULL | Organiser contact |
| `contact_phone` | `text` | NULL | Optional phone |
| `description` | `text` | NULL | What parents see when browsing |
| `timezone` | `text` | NOT NULL | IANA timezone, e.g., "America/New_York" — deadlines evaluated in this zone |
| `age_cutoff_date` | `date` | NULL | Eligibility reference date. CLRG standard is Jan 1 of feis year. Defaults to Jan 1 of feis_date's year if NULL. |
| `sanctioning_body` | `text` | `'CLRG'` | Governing body. Only CLRG supported in v1. |
| `season_year` | `integer` | NOT NULL | Competition season year, e.g., 2026. Derived from feis_date year by default. |
| `status` | `text` | `'draft'` | State machine (see below) |
| `reg_opens_at` | `timestamptz` | NULL | When registration opens |
| `reg_closes_at` | `timestamptz` | NULL | Standard registration deadline |
| `late_reg_closes_at` | `timestamptz` | NULL | Late registration deadline (late fees apply) |
| `dancer_cap` | `integer` | NULL | Global cap on total dancers (NULL = unlimited) |
| `syllabus_template_id` | `uuid` | NULL | Template that seeded the syllabus (lineage only — not a live reference) |
| `syllabus_snapshot` | `jsonb` | NULL | Frozen copy of template_data at time of expansion (see Freezing Rules) |
| `cloned_from` | `uuid` | NULL | Self-reference for clone lineage (metadata only — no live link) |
| `stripe_account_id` | `text` | NULL | Stripe Connect account ID |
| `stripe_onboarding_complete` | `boolean` | `false` | Whether Stripe onboarding is finished |
| `stripe_charges_enabled` | `boolean` | `false` | Whether the account can actually accept charges |
| `stripe_payouts_enabled` | `boolean` | `false` | Whether the account can receive payouts |
| `privacy_policy_url` | `text` | NULL | Link to privacy policy (publish prerequisite) |
| `terms_url` | `text` | NULL | Link to terms of service |
| `accepted_dpa_at` | `timestamptz` | NULL | When organiser accepted Data Processing Agreement |
| `show_contact_publicly` | `boolean` | `true` | Whether contact info appears on public listing |
| `created_by` | `uuid` | NULL | References auth.users (nullable during prototype, NOT NULL when auth is real) |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | Auto-updated via trigger |

**Status state machine:**

```
draft → open → closed
         ↑       |
         +-------+
        (reopen)
```

- `draft` — organiser is still configuring. Not visible to parents.
- `open` — published. Parents can register and pay.
- `closed` — registration closed. Organiser reviewing entries before feis day.

There is no `launched` state in this spec. The bridge (sub-project 3) owns the transition from `closed` into event-day operations. It may add a `launched` state or link to an `events` row — that's the bridge's decision.

Transition rules enforced by `canTransitionListing()`:
- `draft → open`: requires all publish prerequisites (see below).
- `open → closed`: always allowed.
- `closed → open`: allowed (reopen registration).

**Check constraint:**
```sql
status in ('draft', 'open', 'closed')
```

#### `fee_schedules`

One-to-one with `feis_listings`. All amounts stored as **integer cents** (same integer-math principle as scoring).

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `feis_listing_id` | `uuid` | NOT NULL, UNIQUE | References feis_listings |
| `event_fee_cents` | `integer` | `0` | Per-family flat fee |
| `solo_fee_cents` | `integer` | `0` | Per-dancer per-solo-dance |
| `prelim_champ_fee_cents` | `integer` | `0` | Per-dancer for prelim championship |
| `open_champ_fee_cents` | `integer` | `0` | Per-dancer for open championship |
| `family_cap_cents` | `integer` | NULL | Max total per family (NULL = no cap) |
| `late_fee_cents` | `integer` | `0` | Per-dancer late registration surcharge |
| `day_of_surcharge_cents` | `integer` | `0` | Per-dancer day-of registration surcharge |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | Auto-updated via trigger |

**Fee model scope (v1):** This covers the standard CLRG fee structure. Explicitly NOT supported in v1: per-dancer admin fees (vs per-family), custom per-competition pricing, conditional late fee rules, refund policies, unpaid/manual entry cases. These are acknowledged as real-world needs but deferred.

#### `syllabus_templates`

System-shipped and organiser-created templates. A template is an **editable abstraction** — a starting point, not a live dependency.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `name` | `text` | NOT NULL | e.g., "Standard Grade Feis" |
| `description` | `text` | NULL | What this template includes |
| `template_data` | `jsonb` | NOT NULL | Structured competition grid (see below) |
| `is_system` | `boolean` | `false` | True for built-in templates |
| `created_by` | `uuid` | NULL | NULL for system templates |
| `created_at` | `timestamptz` | `now()` | |

**`template_data` JSON structure:**

```jsonc
{
  "age_groups": [
    { "key": "U6", "label": "Under 6", "max_age_jan1": 5 },
    { "key": "U7", "label": "Under 7", "max_age_jan1": 6 },
    { "key": "U8", "label": "Under 8", "max_age_jan1": 7 },
    { "key": "U9", "label": "Under 9", "max_age_jan1": 8 },
    { "key": "U10", "label": "Under 10", "max_age_jan1": 9 },
    { "key": "U11", "label": "Under 11", "max_age_jan1": 10 },
    { "key": "U12", "label": "Under 12", "max_age_jan1": 11 },
    { "key": "U13", "label": "Under 13", "max_age_jan1": 12 },
    { "key": "U14", "label": "Under 14", "max_age_jan1": 13 },
    { "key": "U15", "label": "Under 15", "max_age_jan1": 14 },
    { "key": "U16", "label": "Under 16", "max_age_jan1": 15 },
    { "key": "U17", "label": "Under 17", "max_age_jan1": 16 },
    { "key": "U18", "label": "Under 18", "max_age_jan1": 17 },
    { "key": "U19", "label": "Under 19", "max_age_jan1": 18 },
    { "key": "O18", "label": "18 & Over", "min_age_jan1": 18 },
    { "key": "O21", "label": "21 & Over", "min_age_jan1": 21 }
  ],
  "levels": [
    { "key": "BG", "label": "Beginner", "rank": 1 },
    { "key": "AB", "label": "Advanced Beginner", "rank": 2 },
    { "key": "NOV", "label": "Novice", "rank": 3 },
    { "key": "PW", "label": "Prizewinner", "rank": 4 }
  ],
  "dances": [
    { "key": "reel", "label": "Reel", "type": "light" },
    { "key": "light_jig", "label": "Light Jig", "type": "light" },
    { "key": "slip_jig", "label": "Slip Jig", "type": "light" },
    { "key": "single_jig", "label": "Single Jig", "type": "light" },
    { "key": "treble_jig", "label": "Treble Jig", "type": "heavy" },
    { "key": "hornpipe", "label": "Hornpipe", "type": "heavy" },
    { "key": "st_patricks_day", "label": "St. Patrick's Day", "type": "set" },
    { "key": "treble_reel", "label": "Treble Reel", "type": "heavy" }
  ],
  "championship_types": [
    {
      "key": "prelim",
      "label": "Preliminary Championship",
      "eligible_levels": ["PW"],
      "fee_category": "prelim_champ"
    },
    {
      "key": "open",
      "label": "Open Championship",
      "eligible_levels": ["PW"],
      "requires_championship_status": true,
      "fee_category": "open_champ"
    }
  ],
  "specials": [
    { "key": "ceili", "label": "Ceili (Team)", "type": "team" },
    { "key": "figure", "label": "Figure Choreography", "type": "team" }
  ]
}
```

This structure encodes eligibility rules (age thresholds, level requirements for championships) that the parent portal will use to auto-filter competitions per dancer.

### Freezing Rules

**Templates are mutable. Live listings are frozen.**

When an organiser expands a template into `feis_competitions` rows:
1. The `template_data` JSON is deep-copied into `feis_listings.syllabus_snapshot`.
2. Each `feis_competitions` row stores its own frozen eligibility data (age thresholds, level requirements) — it does not reference the template at runtime.
3. `syllabus_template_id` is lineage metadata only ("this listing was seeded from template X"). It is NOT a live FK that drives behavior.

**Why:** If a template is later edited, existing listings must not change. Historical listings must be reproducible. Parents who registered against a specific syllabus must see the same competitions.

**Clone is a deep copy:**
- Clone produces an independent `feis_listings` row with its own `fee_schedules` and `feis_competitions` rows.
- `cloned_from` is lineage metadata only — no live link.
- Cloned data is immediately editable and independent of the source listing.

#### `feis_competitions`

The pre-registration syllabus. Generated when organiser expands a template or clones a previous feis. Each row is one competition offering that parents can register against.

**This is NOT the day-of `competitions` table.** `feis_competitions` = pre-registration offerings. `competitions` = day-of operational records. The bridge (sub-project 3) converts one into the other.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `feis_listing_id` | `uuid` | NOT NULL | References feis_listings |
| `age_group_key` | `text` | NULL | e.g., "U10" (NULL for cross-age specials — see below) |
| `age_group_label` | `text` | NOT NULL | Frozen: "Under 10" |
| `age_max_jan1` | `integer` | NULL | Frozen eligibility: max age on Jan 1 (NULL for adult groups) |
| `age_min_jan1` | `integer` | NULL | Frozen eligibility: min age on Jan 1 (NULL for youth groups) |
| `level_key` | `text` | NULL | e.g., "BG" (NULL for specials that are cross-level) |
| `level_label` | `text` | NULL | Frozen: "Beginner" (NULL when level_key is NULL) |
| `dance_key` | `text` | NULL | e.g., "reel" (NULL for championships that cover multiple dances) |
| `dance_label` | `text` | NULL | Frozen: "Reel" |
| `competition_type` | `text` | `'solo'` | 'solo', 'championship', 'special', 'custom' |
| `championship_key` | `text` | NULL | 'prelim' or 'open' — only set when competition_type = 'championship' |
| `fee_category` | `text` | NOT NULL | Which fee_schedule field applies: 'solo', 'prelim_champ', 'open_champ' |
| `display_name` | `text` | NOT NULL | Auto-generated: "U10 Beginner Reel" |
| `display_code` | `text` | NULL | Optional short code: "101" |
| `capacity_cap` | `integer` | NULL | Max entries for this competition (NULL = unlimited) |
| `enabled` | `boolean` | `true` | Organiser can disable without deleting |
| `sort_order` | `integer` | `0` | Display ordering |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | Auto-updated via trigger (same pattern as feis_listings and fee_schedules) |

**Unique constraint:** Expression-based unique index using `(feis_listing_id, COALESCE(age_group_key, ''), COALESCE(level_key, ''), COALESCE(dance_key, ''), competition_type, COALESCE(championship_key, ''))` — uses COALESCE because Postgres treats NULL != NULL in unique indexes.

**Upsert strategy:** PostgREST cannot target expression-based indexes via `onConflict`. Bulk syllabus operations use delete-and-reinsert (delete all `feis_competitions` for the listing, insert fresh). Individual competition edits (toggle enabled, set capacity) use `.update()` by primary key `id`.

**Championship rows:** For championships, `dance_key` is NULL (championships cover multiple dances), `level_key` is the minimum eligible level. For example, "Prelim Championship U14" has `age_group_key = 'U14'`, `level_key = 'PW'`, `dance_key = NULL`, `competition_type = 'championship'`, `championship_key = 'prelim'`.

**Special rows:** For ceili/figure, `level_key` may be NULL (open to all levels in that age group), `dance_key` is the special key. `age_group_key` may be NULL for cross-age specials (e.g., open Ceili that spans all age groups).

**Cross-age specials:** For specials like Ceili that span all age groups, `age_group_key` is NULL. This parallels how `dance_key` is NULL for championships and `level_key` is NULL for cross-level specials. The unique index COALESCE handles this correctly.

**Custom rows:** For competitions that don't fit the template (charity dances, exhibition, non-standard categories). `display_name` is freetext. `age_group_key`, `level_key`, `dance_key` may all be NULL. `fee_category` is required. Added via 'Add Custom Competition' in the syllabus editor — advanced escape hatch, not the primary workflow.

### Tables NOT touched by this spec

The following Phase 1 tables are **not modified** in this spec:

- `events` — day-of event container
- `competitions` — day-of competition records
- `dancers` — day-of dancer records
- `registrations` — day-of check-in roster

The bridge (sub-project 3) is the only thing that creates `events`/`competitions` from `feis_listings`/`feis_competitions`. This boundary is strict.

---

## Organiser Setup Wizard

### Entry Point

`/organiser/feiseanna/new` — two paths:

1. **Start Fresh** — blank wizard, pick a syllabus template
2. **Clone Previous** — select a past feis listing, deep-copy all fields

**Clone semantics:**
- Deep copies: name (year bumped), venue, contact, description, fee schedule (new `fee_schedules` row), full syllabus (new `feis_competitions` rows), Stripe account (same organiser), timezone, sanctioning body.
- Cleared (must set new): feis_date, end_date, reg_opens_at, reg_closes_at, late_reg_closes_at, season_year.
- Set: `cloned_from` = source listing ID (lineage only), `status` = `draft`.
- The clone is immediately independent. Edits to the source do not affect the clone. Edits to the clone do not affect the source.

### Wizard Steps

#### Step 1: Feis Details

Fields: name, feis_date, end_date (optional toggle for multi-day), venue_name, venue_address, contact_email, contact_phone, description, timezone (auto-detected from browser, editable).

Smart defaults for clone path: previous values pre-filled, year incremented in name, `season_year` derived from new `feis_date`.

**Persistence:** The `feis_listings` row is created (status `draft`) when the organiser completes Step 1 (or clones). Subsequent steps update the existing record. Each step saves to the database — no client-side persistence needed. Organiser can leave at any step and return later.

#### Step 2: Syllabus

1. Pick a template (or keep cloned syllabus). Template's `template_data` is frozen into `syllabus_snapshot`.
2. **Matrix/grid view (desktop >=768px):** Rows = dances, columns = age groups. Each cell shows level sub-toggles (BG, AB, NOV, PW). Row header actions for bulk enable/disable all age groups for that dance. Column header actions for bulk enable/disable all dances for that age group. Click a cell to toggle individual levels within it.
3. **Grouped list (mobile <768px):** Expand/collapse per dance type. Within each dance, toggles grouped by age group with level sub-toggles.
4. **Per-competition overrides:** expand any cell or group to set per-competition capacity caps or toggle specific level/age combinations on/off.
5. **Championship section:** separate toggle area below the matrix for Prelim and Open Championship, with their own age group selections.
6. **Specials:** separate toggle area below championships for ceili, figure choreography, etc.

**Custom competitions:** An 'Add Custom Competition' button at the bottom of the syllabus editor allows organizers to manually add a competition that doesn't come from the template. This is an advanced escape hatch for edge cases (charity dances, exhibition competitions, non-standard categories). It inserts a `feis_competitions` row with `competition_type = 'custom'` and freetext `display_name`.

The UI calls `expandSyllabus()` to generate `feis_competitions` rows from the frozen snapshot + organiser selections. Everything is `enabled: true` by default; organiser unchecks what they're not running.

#### Step 3: Fees

Standard fill-in-the-blank form with the fee categories:

| Field | Label | Hint |
|---|---|---|
| `event_fee_cents` | Event Fee (per family) | "Typical: $25–30" |
| `solo_fee_cents` | Solo Dance Fee (per dancer per dance) | "Typical: $13–15" |
| `prelim_champ_fee_cents` | Prelim Championship Fee (per dancer) | "Typical: $55" |
| `open_champ_fee_cents` | Open Championship Fee (per dancer) | "Typical: $60–65" |
| `family_cap_cents` | Family Cap (max total) | "Typical: $150–175. Leave blank for no cap." |
| `late_fee_cents` | Late Fee (per dancer) | "Typical: $25" |
| `day_of_surcharge_cents` | Day-of Surcharge (per dancer) | "Typical: $50" |

Input as dollar amounts, stored as cents. UI handles conversion.

#### Step 4: Deadlines & Caps

- **Registration opens:** date picker (defaults to 8 weeks before feis date)
- **Registration closes:** date picker (defaults to 2 weeks before feis date)
- **Late registration closes:** date picker (defaults to 1 week before feis date, optional)
- **Overall dancer cap:** optional global cap on total dancers

Smart defaults based on feis date so the organiser doesn't have to think about typical timelines.

**Date ordering invariants enforced:** `reg_opens_at < reg_closes_at < late_reg_closes_at (if set) < feis_date`. UI prevents invalid combinations. Multi-day events: deadlines must be before `feis_date` (start date), not `end_date`.

#### Step 5: Review & Publish

Summary screen showing:
- Feis details (name, dates, venue, timezone)
- Syllabus summary (X competitions across Y age groups and Z levels)
- Fee schedule formatted as a clear table
- Deadlines
- Stripe connection status with detail

**Stripe Connect:** "Connect your Stripe account" button. Uses Stripe Connect Account Links (not deprecated OAuth). Server creates an Express account via `stripe.accounts.create({ type: 'express' })`, generates an Account Link via `stripe.accountLinks.create()`, and redirects the organiser. After return, we verify account status via `stripe.accounts.retrieve()` and update `stripe_onboarding_complete`, `stripe_charges_enabled`, `stripe_payouts_enabled`.

**Account type: Express. Charge type: Direct Charges. Platform revenue: application_fee_amount.**

**Critical:** `return_url` does NOT mean onboarding is complete. Always verify account status via `stripe.accounts.retrieve()` — check `charges_enabled` and `payouts_enabled`.

**Publish button:** transitions status to `open`. Disabled until ALL publish prerequisites pass. Feis becomes visible to parents (in parent portal, sub-project 2).

---

## Pages

### `/organiser/feiseanna`

List of all feis listings for this organiser. Shows:
- Name, date, status badge (Draft / Open / Closed)
- Actions: Edit, Clone

### `/organiser/feiseanna/new`

The setup wizard described above. Also the clone picker.

### `/organiser/feiseanna/[id]`

Feis detail / management page. Tabs:
- **Overview** — details summary, status, quick actions (open/close registration)
- **Syllabus** — view/edit competitions (same UI as wizard step 2, but standalone)
- **Fees** — view/edit fee schedule
- **Settings** — deadlines, Stripe status, danger zone (delete draft)

Note: There is no "Entries" tab in this spec. Entry management requires the parent portal (sub-project 2) to exist. The entries tab will be added in that spec.

### `/organiser/feiseanna/[id]/edit`

Edit mode for feis details (wizard step 1 fields). Available while status is `draft` or `open`. When status is `open`, edits to critical fields (date, venue) show a warning that parents have already registered.

---

## Server Actions

Complex multi-table operations must be Server Actions, not client-side Supabase call chains. This prevents partial writes and ensures server-side validation.

| Operation | Server Action | Why |
|---|---|---|
| Clone feis | `cloneFeis(sourceId)` | Atomic deep copy across 3 tables (listing + fee_schedule + competitions) |
| Expand syllabus | `expandAndSaveSyllabus(listingId, templateData, selection)` | Delete existing + batch insert 80-160 rows |
| Transition status | `transitionListingStatus(listingId, to)` | Server-side prerequisite validation before state change |

Located in `src/app/organiser/feiseanna/actions.ts`.

---

## State Machine

### `canTransitionListing(from, to)` function

Located in `src/lib/feis-listing-states.ts`. Same pattern as `canTransition()` for competitions.

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: ['open'],
};
```

Note: The bridge (sub-project 3) may extend this with a `launched` state or its own transition. That is the bridge's decision.

### Publish Prerequisites (draft → open)

#### Hard blocks (must pass to publish)

- [ ] Name is set
- [ ] feis_date is set
- [ ] feis_date must be in the future (or today)
- [ ] venue_name is set
- [ ] contact_email is set
- [ ] timezone is set
- [ ] At least 1 enabled competition in syllabus
- [ ] Fee schedule exists and is usable for the enabled competition types (e.g., if championships are enabled, championship fees must be non-zero; if solo dances are enabled, solo fee must be non-zero)
- [ ] reg_opens_at and reg_closes_at are set
- [ ] Date ordering valid: `reg_opens_at < reg_closes_at`
- [ ] If `late_reg_closes_at` is set: `reg_closes_at < late_reg_closes_at < feis_date`
- [ ] `reg_closes_at < feis_date` (registration closes before event starts)
- [ ] If multi-day: `feis_date <= end_date`
- [ ] Stripe: `stripe_charges_enabled = true` (account connected AND can accept charges)
- [ ] Privacy policy URL is set

#### Soft warnings (displayed on review, dismissible)

- "Event fee is $0 — no family fee will be charged. Intentional?"
- "No competitions for ages [gap] — gap in age groups."
- "No description set — parents will see a blank event listing."
- "No venue address — parents won't have directions."
- "Registration opens in the past — registration will be immediately open."

#### Validation interface

```typescript
interface PublishValidation {
  blocks: string[];    // Hard blocks — must be empty to publish
  warnings: string[];  // Soft warnings — displayed but dismissible
}

function validateListingForPublish(context: ListingTransitionContext): PublishValidation;
```

Return human-readable reasons for any failures, so the organiser sees a checklist of what to fix. The publish button is disabled until `blocks` is empty. Warnings are shown but the organiser can dismiss them and proceed.

### `FeisListing` and `ListingTransitionContext` interfaces

```typescript
interface FeisListing {
  id: string;
  name: string | null;
  feis_date: string | null;       // ISO date
  end_date: string | null;
  venue_name: string | null;
  contact_email: string | null;
  timezone: string | null;
  status: ListingStatus;
  reg_opens_at: string | null;    // ISO timestamp
  reg_closes_at: string | null;
  late_reg_closes_at: string | null;
  stripe_charges_enabled: boolean;
}

interface ListingTransitionContext {
  listing: FeisListing;
  feeSchedule: FeeSchedule | null;
  enabledCompetitions: { competition_type: string; championship_key: string | null; fee_category: FeeCategoryType }[];
}
```

`getListingTransitionBlockReasons(from, to, context)` returns `string[]` — empty array means transition is allowed. Same pattern as `getTransitionBlockReason()` for competitions.

---

## System Templates

Ship 3 built-in templates:

### Standard Grade Feis
- Age groups: U6 through O18
- Levels: BG, AB, NOV, PW
- Dances: Reel, Light Jig, Slip Jig, Single Jig, Treble Jig, Hornpipe
- No championship
- ~80–100 competitions

### Championship Feis
- All of Standard Grade plus:
- Prelim Championship (U12–O18)
- Open Championship (U14–O18)
- ~120–140 competitions

### Full CLRG
- Everything: all age groups, all levels, all dances, both championship types, ceili, figure
- ~160+ competitions
- For large regional events

---

## Seed Data Migration

Migration `016_feis_setup.sql`:

1. Create `feis_listings` table with status check constraint, `updated_at` trigger, indexes on `created_by` and `status`
2. Create `fee_schedules` table with `updated_at` trigger and unique index on `feis_listing_id`
3. Create `syllabus_templates` table
4. Create `feis_competitions` table with unique constraint and index on `feis_listing_id`
5. Insert 3 system syllabus templates

**RLS Policies:**

```sql
-- RLS Policies
ALTER TABLE feis_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE syllabus_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE feis_competitions ENABLE ROW LEVEL SECURITY;

-- Organisers can CRUD their own listings
CREATE POLICY "Organisers manage own listings" ON feis_listings
  FOR ALL USING (auth.uid() = created_by);

-- Public can view open listings
CREATE POLICY "Public can view open listings" ON feis_listings
  FOR SELECT USING (status = 'open');

-- Fee schedules follow listing access
CREATE POLICY "Fee schedules follow listing" ON fee_schedules
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));

CREATE POLICY "Public fee schedules for open listings" ON fee_schedules
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));

-- System templates visible to all; user templates to creator
CREATE POLICY "System templates visible to all" ON syllabus_templates
  FOR SELECT USING (is_system = true);
CREATE POLICY "Users manage own templates" ON syllabus_templates
  FOR ALL USING (created_by = auth.uid());

-- Competitions follow listing access
CREATE POLICY "Competitions follow listing" ON feis_competitions
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));
CREATE POLICY "Public competitions for open listings" ON feis_competitions
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));
```

**This migration does NOT touch any existing tables.** No columns added to `events`, `competitions`, `dancers`, or `registrations`. The bridge (sub-project 3) owns that boundary crossing.

---

## Engine Code

### `src/lib/engine/fee-calculator.ts`

Pure function. All integer math (cents). No floats.

```typescript
interface FeeSchedule {
  event_fee_cents: number;
  solo_fee_cents: number;
  prelim_champ_fee_cents: number;
  open_champ_fee_cents: number;
  family_cap_cents: number | null;
  late_fee_cents: number;
  day_of_surcharge_cents: number;
}

type FeeCategoryType = 'solo' | 'prelim_champ' | 'open_champ';

interface FeeEntry {
  dancer_id: string;
  fee_category: FeeCategoryType;
  is_late: boolean;
  is_day_of: boolean;
}

interface FeeLineItem {
  dancer_id: string;
  base_fee_cents: number;
  late_fee_cents: number;
  day_of_surcharge_cents: number;
  line_total_cents: number;
}

interface FeeBreakdown {
  line_items: FeeLineItem[];
  event_fee_cents: number;
  subtotal_per_dancer: Record<string, number>;
  subtotal_before_cap_cents: number;
  family_cap_applied: boolean;
  grand_total_cents: number;
}

function calculateFees(schedule: FeeSchedule, entries: FeeEntry[]): FeeBreakdown;
```

**Family-level logic:** The event fee is a per-family flat fee applied once regardless of how many dancers or entries. The `entries` array represents all entries across all dancers in one family. The family cap applies to the grand total (event fee + all entry fees + late/day-of surcharges). If the total exceeds the cap, `grand_total_cents` is clamped to `family_cap_cents`.

**Fee category mapping:** Each `FeeEntry.fee_category` maps to a `FeeSchedule` field: `'solo'` → `solo_fee_cents`, `'prelim_champ'` → `prelim_champ_fee_cents`, `'open_champ'` → `open_champ_fee_cents`. The `fee_category` on each `feis_competitions` row tells the parent portal which fee applies.

### `src/lib/engine/syllabus-expander.ts`

Pure function. Expands a template snapshot + organiser selections into `feis_competitions` rows with frozen eligibility data.

```typescript
interface TemplateData {
  age_groups: AgeGroup[];
  levels: Level[];
  dances: Dance[];
  championship_types: ChampionshipType[];
  specials: Special[];
}

interface AgeGroup {
  key: string;
  label: string;
  max_age_jan1?: number;
  min_age_jan1?: number;
}

interface Level {
  key: string;
  label: string;
  rank: number;
}

interface Dance {
  key: string;
  label: string;
  type: 'light' | 'heavy' | 'set';
}

interface ChampionshipType {
  key: string;
  label: string;
  eligible_levels: string[];
  requires_championship_status?: boolean;
  fee_category: string;
}

interface Special {
  key: string;
  label: string;
  type: string;
}

interface SyllabusSelection {
  enabled_age_groups: string[];
  enabled_levels: string[];
  enabled_dances: string[];
  enable_prelim: boolean;
  prelim_age_groups: string[];
  enable_open: boolean;
  open_age_groups: string[];
  enable_specials: string[];
}

interface ExpandedCompetition {
  age_group_key: string;
  age_group_label: string;
  age_max_jan1: number | null;
  age_min_jan1: number | null;
  level_key: string | null;
  level_label: string | null;
  dance_key: string | null;
  dance_label: string | null;
  competition_type: 'solo' | 'championship' | 'special' | 'custom';
  championship_key: string | null;
  fee_category: FeeCategoryType;
  display_name: string;
  sort_order: number;
}

function expandSyllabus(
  templateData: TemplateData,
  selection: SyllabusSelection
): ExpandedCompetition[];
```

**Key behavior:** Each `ExpandedCompetition` contains ALL the frozen eligibility data inline (age thresholds, level labels). It does not reference the template at runtime. This is what gets inserted into `feis_competitions`.

### `src/lib/feis-listing-states.ts`

State machine + prerequisite checker. Located outside `engine/` because it references listing/fee schedule shapes, but the core transition logic is pure.

```typescript
type ListingStatus = 'draft' | 'open' | 'closed';

function canTransitionListing(from: ListingStatus, to: ListingStatus): boolean;

function getListingTransitionBlockReasons(
  from: ListingStatus,
  to: ListingStatus,
  context: ListingTransitionContext
): string[];
```

---

## What This Spec Does NOT Cover

Deferred to sub-project 2 (Parent Registration Portal):
- Family accounts and dancer profiles
- Eligibility filtering (using frozen age/level data from feis_competitions)
- Stripe Checkout integration (payment sessions)
- Payment webhooks
- COPPA consent flow
- Post-payment edits/refunds
- Cap-during-checkout race conditions
- Entries tab on organiser dashboard

Deferred to sub-project 3 (The Bridge):
- `launched` state or equivalent
- `event_id` FK on `feis_listings` (linking to events table)
- Creating `events`/`competitions`/`registrations` from pre-reg data
- Number card generation and privacy model
- Printable artifacts (PDFs)
- Per-dancer summaries

Explicitly out of scope (acknowledged, not planned):
- Multi-organiser team/role access (beyond `created_by`)
- Custom per-competition fee overrides
- Conditional late fee rules
- Refund policy configuration
- Non-CLRG sanctioning bodies

---

## Design Notes for Sub-Projects 2 and 3

These architectural decisions are documented now to prevent schema rework later.

**"Register Again" pattern:** The parent portal will match last year's entries to this year's competitions using the composite key `(age_group_key, level_key, dance_key, competition_type)`, not `feis_competitions.id`. The `cloned_from` lineage identifies the predecessor feis; the composite key identifies equivalent competition offerings.

**Capacity race conditions:** Sub-project 2 will implement the hold/timer pattern — 15-minute temporary hold on spots via PostgreSQL `SELECT FOR UPDATE`. The `capacity_cap` column provides the ceiling; the parent portal owns hold and confirmation logic.

**Waitlist support:** Not in v1. If added, entries will need a status field (`confirmed`, `waitlisted`, `expired`) and automatic promotion logic when spots open.

**Deadline semantics:** Date pickers in the wizard produce dates, stored as timestamptz at end-of-day (23:59:59) in the listing's timezone. "Registration closes March 15" means 2026-03-15T23:59:59 in the feis timezone.

**Grace period:** Sub-project 2 will allow a 15-minute grace period for registrations started before a deadline but not completed.

**Teacher visibility:** Sub-project 2 may add optional teacher accounts with read-only visibility into entries from their school. No schema changes needed in sub-project 1, but the parent registration flow will capture school/teacher association per dancer.

**Data portability:** Organisers can export their feis listing, syllabus, fee schedule, and (in sub-project 2) registration data as CSV/JSON at any time. FeisTab does not lock in organiser data. The clean table structure makes this trivially implementable.

**Template-defined levels:** The `template_data.levels` array is template-provided, not system-assumed. The UI and `expandSyllabus()` logic must treat levels as template data, not as system constants. This enables future WIDA or An Coimisiun templates with different level structures.

---

## Testing

### Must be tested (engine code)

**`fee-calculator.ts`:**
- All fee categories (solo, prelim champ, open champ)
- Family cap logic (under cap, at cap, over cap, no cap)
- Late fees and day-of surcharges
- Event fee applied once per family
- Edge cases: zero fees, single dancer single entry, large family many entries
- Mixed fee categories (solos + championships in same family)

**`syllabus-expander.ts`:**
- Full template expansion (all age groups × all levels × all dances)
- Partial selection (subset of age groups, subset of levels)
- Championship generation with correct age groups
- Empty selection → empty result
- Specials (ceili, figure)
- Frozen eligibility data present on every row
- Sort order is deterministic

**`feis-listing-states.ts`:**
- Valid transitions: draft→open, open→closed, closed→open
- Invalid transitions: draft→closed, open→open, closed→draft, etc.
- Publish prerequisites — each prerequisite fails independently
- Date ordering validation (all invalid orderings rejected)
- Fee schedule validation: championships enabled but champ fee is zero → block
- Stripe readiness: connected but charges not enabled → block

### Must be tested (freezing/isolation)

- **Template edit isolation:** Edit a template after a listing was created from it → listing's syllabus_snapshot and feis_competitions are unchanged.
- **Clone isolation:** Edit the source listing after cloning → clone is unchanged. Edit the clone → source is unchanged.
- **Clone deep copy:** Clone produces independent fee_schedules and feis_competitions rows with new IDs.

### Manual testing (UI)
- Wizard flow end-to-end (fresh + clone paths)
- Syllabus toggle UX (broad toggles + drill-down)
- Fee input (dollar → cents conversion, family cap optional)
- Stripe Connect Account Links flow
- Stripe account status display (onboarding complete, charges enabled)
- Draft save at each wizard step, leave and resume
- Publish prerequisite checklist display
- Edit feis details while status is `open` (warning shown)
