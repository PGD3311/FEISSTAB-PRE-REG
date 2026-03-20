# Parent Registration Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the parent registration portal — family accounts, dancer profiles with per-dance levels, eligibility-filtered competition selection, Stripe Checkout with capacity holds, parent dashboard, and organiser entries view.

**Architecture:** This builds on sub-project 1's existing Next.js 15 app, Supabase project, and pre_registration schema. New tables for households, dancers, dance levels, registrations, and entries. Pure engine functions for eligibility and registration state machine. Server Actions for all mutations. Stripe Checkout (hosted) for payments with webhook-driven confirmation. Frontend uses the same FeisTab design system (Precision Utility).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (pre_registration schema), Vitest, Tailwind + shadcn/ui, Stripe Connect (Direct Charges), Resend (transactional email)

**Spec:** `docs/2026-03-20-parent-registration-design.md`

**Implementation notes:**
1. **Stripe is placeholder for now.** We don't have Stripe API keys yet. The checkout session creation should work with test mode keys. Add `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET` to `.env.local`.
2. **Resend is placeholder.** Add `RESEND_API_KEY` and `EMAIL_FROM` to `.env.local`. Use test mode or log to console if no key.
3. **Migration applied via SQL Editor.** Same pattern as sub-project 1 — write the SQL file, user copies it to Supabase SQL Editor.
4. **Server Actions for all mutations.** No client-side Supabase writes.
5. **Design system:** Same FeisTab "Precision Utility" aesthetic. Green nav, flat panels, monospace data.
6. **The spec's migration SQL is the authoritative source** for table definitions. Copy it into the plan's migration task.
7. **Environment variables (new for sub-project 2):**
   ```
   STRIPE_SECRET_KEY=sk_test_xxx
   STRIPE_PUBLISHABLE_KEY=pk_test_xxx
   STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx
   RESEND_API_KEY=re_xxx
   EMAIL_FROM=noreply@feistab.com
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   STRIPE_APPLICATION_FEE_PERCENT=5
   ```

---

## File Structure

All paths relative to the repo root (`FEISSTAB-PRE-REG/`).

### New Files

```
supabase/migrations/002_parent_registration.sql     # Schema: 6 new tables + RLS + pg_cron

src/lib/types/feis-listing.ts                        # MODIFY — add registration, dancer, eligibility types
src/lib/registration-states.ts                       # Registration state machine
src/lib/engine/eligibility.ts                        # Pure: eligibility filtering engine

tests/registration-states.test.ts                    # Registration state machine tests
tests/engine/eligibility.test.ts                     # Eligibility engine tests

src/middleware.ts                                     # MODIFY — add /dashboard routes, capability routing

src/app/auth/signup/page.tsx                         # MODIFY — add intent picker after signup
src/app/dashboard/layout.tsx                         # Parent dashboard layout
src/app/dashboard/page.tsx                           # Parent dashboard — registration feed
src/app/dashboard/actions.ts                         # Server Actions: createHousehold
src/app/dashboard/dancers/page.tsx                   # Dancer list
src/app/dashboard/dancers/new/page.tsx               # Add dancer form
src/app/dashboard/dancers/[id]/page.tsx              # Edit dancer + levels
src/app/dashboard/dancers/actions.ts                 # Server Actions: createDancer, updateDancer, archiveDancer

src/app/feiseanna/page.tsx                           # Browse open feiseanna (public)
src/app/feiseanna/[id]/page.tsx                      # Feis detail + eligibility preview
src/app/feiseanna/[id]/register/page.tsx             # Registration engine (Steps 1-3)
src/app/feiseanna/[id]/register/actions.ts           # Server Actions: createDraftRegistration, createCheckoutSession, cancelRegistration
src/app/feiseanna/[id]/register/success/page.tsx     # Post-payment success page

src/components/registration/step1-dancers.tsx        # Step 1: dancer selection
src/components/registration/step2-cart.tsx            # Step 2: competition selection + running total
src/components/registration/step3-review.tsx          # Step 3: review, consent, pay
src/components/navigation/view-toggle.tsx             # Parent/Organiser capability toggle

src/app/api/webhooks/stripe/route.ts                 # Stripe Connect webhook handler
src/lib/email/send-confirmation.ts                   # Resend confirmation email
src/lib/stripe.ts                                     # Stripe client singleton

src/app/organiser/feiseanna/[id]/page.tsx            # MODIFY — add "Entries" tab
```

### Existing Files (Read-Only Reference)

```
src/lib/feis-listing-states.ts                       # Pattern reference for registration state machine
src/lib/engine/fee-calculator.ts                     # Used by registration cart (calculateFees)
src/lib/engine/syllabus-expander.ts                  # Pattern reference for engine code
src/lib/supabase/server.ts                           # Server client (createClient)
src/lib/supabase/client.ts                           # Browser client
src/hooks/use-supabase.ts                            # Client hook
src/app/organiser/feiseanna/actions.ts               # Pattern reference for Server Actions
```

---

## Task 0: Database Migration

**Files:**
- Create: `supabase/migrations/002_parent_registration.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 002_parent_registration.sql
-- Pre-registration: parent registration portal tables
-- Builds on 001_feis_setup.sql — requires feis_listings, feis_competitions tables

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
  is_active boolean NOT NULL DEFAULT true,
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
  platform_terms_version text,
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

- [ ] **Step 2: Apply migration via Supabase SQL Editor**

Open the Supabase dashboard for project `vwfrmhbczwpvqonlpfzs`. Navigate to SQL Editor. Paste the contents of `supabase/migrations/002_parent_registration.sql` and run.

**Note:** If pg_cron is not enabled, enable it first via Extensions in the Supabase dashboard, or remove the `cron.schedule()` call and handle expiry on-demand in the application layer.

Expected: All tables created. RLS enabled. Policies applied.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_parent_registration.sql
git commit -m "feat: add parent registration migration — 6 new tables, RLS, hold expiry cron"
```

---

## Task 1: Types

**Files:**
- Modify: `src/lib/types/feis-listing.ts`

- [ ] **Step 1: Add new types to the shared types file**

Append these types after the existing types in `src/lib/types/feis-listing.ts`:

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
  is_active: boolean
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
  platform_terms_version: string | null
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
  [danceKey: string]: string  // e.g., { reel: 'NOV', slip_jig: 'AB' }
}

export interface DancerProfile {
  dob: Date
  gender: string
  championshipStatus: ChampionshipStatus
  danceLevels: DanceLevelMap
}

// Represents a feis_competitions database row — the canonical shape for
// eligibility filtering, cart building, and capacity checks.
export interface FeisCompetition {
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

export interface EligibleCompetition {
  competition: FeisCompetition
  eligible: boolean
  reason: string  // e.g., "Age and level match", "Championship status insufficient"
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/feis-listing.ts
git commit -m "feat: add registration, dancer, and eligibility types for sub-project 2"
```

---

## Task 2: Registration State Machine (TDD)

**Files:**
- Create: `src/lib/registration-states.ts`
- Create: `tests/registration-states.test.ts`

Follow the pattern in `src/lib/feis-listing-states.ts`.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import {
  canTransitionRegistration,
  getNextRegistrationStates
} from '@/lib/registration-states'

describe('canTransitionRegistration', () => {
  // ─── Valid transitions ───

  it('allows draft → pending_payment', () => {
    expect(canTransitionRegistration('draft', 'pending_payment')).toBe(true)
  })

  it('allows draft → cancelled', () => {
    expect(canTransitionRegistration('draft', 'cancelled')).toBe(true)
  })

  it('allows draft → expired', () => {
    expect(canTransitionRegistration('draft', 'expired')).toBe(true)
  })

  it('allows pending_payment → paid', () => {
    expect(canTransitionRegistration('pending_payment', 'paid')).toBe(true)
  })

  it('allows pending_payment → expired', () => {
    expect(canTransitionRegistration('pending_payment', 'expired')).toBe(true)
  })

  it('allows pending_payment → cancelled', () => {
    expect(canTransitionRegistration('pending_payment', 'cancelled')).toBe(true)
  })

  // ─── Invalid transitions ───

  it('rejects draft → paid (must go through pending_payment)', () => {
    expect(canTransitionRegistration('draft', 'paid')).toBe(false)
  })

  it('rejects paid → anything (terminal state)', () => {
    expect(canTransitionRegistration('paid', 'draft')).toBe(false)
    expect(canTransitionRegistration('paid', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('paid', 'expired')).toBe(false)
    expect(canTransitionRegistration('paid', 'cancelled')).toBe(false)
  })

  it('rejects expired → anything (terminal state)', () => {
    expect(canTransitionRegistration('expired', 'draft')).toBe(false)
    expect(canTransitionRegistration('expired', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('expired', 'paid')).toBe(false)
    expect(canTransitionRegistration('expired', 'cancelled')).toBe(false)
  })

  it('rejects cancelled → anything (terminal state)', () => {
    expect(canTransitionRegistration('cancelled', 'draft')).toBe(false)
    expect(canTransitionRegistration('cancelled', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('cancelled', 'paid')).toBe(false)
    expect(canTransitionRegistration('cancelled', 'expired')).toBe(false)
  })

  it('rejects same-state transitions', () => {
    expect(canTransitionRegistration('draft', 'draft')).toBe(false)
    expect(canTransitionRegistration('pending_payment', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('paid', 'paid')).toBe(false)
  })

  it('rejects pending_payment → draft (no back-transitions)', () => {
    expect(canTransitionRegistration('pending_payment', 'draft')).toBe(false)
  })
})

describe('getNextRegistrationStates', () => {
  it('returns [pending_payment, cancelled, expired] for draft', () => {
    const result = getNextRegistrationStates('draft')
    expect(result).toContain('pending_payment')
    expect(result).toContain('cancelled')
    expect(result).toContain('expired')
    expect(result).toHaveLength(3)
  })

  it('returns [paid, expired, cancelled] for pending_payment', () => {
    const result = getNextRegistrationStates('pending_payment')
    expect(result).toContain('paid')
    expect(result).toContain('expired')
    expect(result).toContain('cancelled')
    expect(result).toHaveLength(3)
  })

  it('returns [] for paid (terminal)', () => {
    expect(getNextRegistrationStates('paid')).toEqual([])
  })

  it('returns [] for expired (terminal)', () => {
    expect(getNextRegistrationStates('expired')).toEqual([])
  })

  it('returns [] for cancelled (terminal)', () => {
    expect(getNextRegistrationStates('cancelled')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/registration-states.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/registration-states.ts
import type { RegistrationStatus } from '@/lib/types/feis-listing'

// ─── Transition map ───

const VALID_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  draft: ['pending_payment', 'cancelled', 'expired'],
  pending_payment: ['paid', 'expired', 'cancelled'],
  paid: [],       // Terminal state for MVP (no refunds/edits)
  expired: [],    // Terminal — parent must start a new registration
  cancelled: [],  // Terminal — parent must start a new registration
}

// ─── Public API ───

/**
 * Check whether a registration status transition is allowed.
 */
export function canTransitionRegistration(
  from: RegistrationStatus,
  to: RegistrationStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Return the list of valid next states for a given registration status.
 */
export function getNextRegistrationStates(
  current: RegistrationStatus
): RegistrationStatus[] {
  return VALID_TRANSITIONS[current] ?? []
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/registration-states.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/registration-states.ts tests/registration-states.test.ts
git commit -m "feat: add registration state machine — draft→pending→paid lifecycle"
```

---

## Task 3: Eligibility Engine (TDD)

**Files:**
- Create: `src/lib/engine/eligibility.ts`
- Create: `tests/engine/eligibility.test.ts`

Pure function. No Supabase, no React, no side effects.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import {
  getEligibleCompetitions,
  calculateAgeOnDate
} from '@/lib/engine/eligibility'
import type {
  DancerProfile,
  FeisCompetition,
  Level
} from '@/lib/types/feis-listing'

// ─── Helpers ───

function makeCompetition(overrides: Partial<FeisCompetition> = {}): FeisCompetition {
  return {
    id: 'comp-1',
    feis_listing_id: 'feis-1',
    age_group_key: 'U12',
    age_group_label: 'Under 12',
    age_max_jan1: 11,
    age_min_jan1: null,
    level_key: 'NOV',
    level_label: 'Novice',
    dance_key: 'reel',
    dance_label: 'Reel',
    competition_type: 'solo',
    championship_key: null,
    fee_category: 'solo',
    display_name: 'U12 Novice Reel',
    capacity_cap: null,
    enabled: true,
    ...overrides
  }
}

const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 },
]

// ─── calculateAgeOnDate ───

describe('calculateAgeOnDate', () => {
  it('calculates age for child born March 15 2014, on Jan 1 2026', () => {
    const dob = new Date('2014-03-15')
    const ref = new Date('2026-01-01')
    expect(calculateAgeOnDate(dob, ref)).toBe(11)
  })

  it('calculates age for child born Jan 1 2014, on Jan 1 2026 (exact birthday)', () => {
    const dob = new Date('2014-01-01')
    const ref = new Date('2026-01-01')
    expect(calculateAgeOnDate(dob, ref)).toBe(12)
  })

  it('calculates age for child born Dec 31 2014, on Jan 1 2026', () => {
    const dob = new Date('2014-12-31')
    const ref = new Date('2026-01-01')
    expect(calculateAgeOnDate(dob, ref)).toBe(11)
  })

  it('calculates age for child born Feb 29 2016 (leap year), on Jan 1 2026', () => {
    const dob = new Date('2016-02-29')
    const ref = new Date('2026-01-01')
    expect(calculateAgeOnDate(dob, ref)).toBe(9)
  })

  it('returns 0 for a baby born same year as reference', () => {
    const dob = new Date('2026-06-15')
    const ref = new Date('2026-01-01')
    // Born after cutoff in same year: age -1 but should floor to negative
    // Actually: 2026 - 2026 = 0, but monthDiff = 1-6 = -5, so age becomes -1
    // This edge case means the dancer is not yet born on the cutoff date
    expect(calculateAgeOnDate(dob, ref)).toBe(-1)
  })

  it('handles same date as DOB (age is 0)', () => {
    const dob = new Date('2020-06-15')
    const ref = new Date('2020-06-15')
    expect(calculateAgeOnDate(dob, ref)).toBe(0)
  })
})

// ─── getEligibleCompetitions ───

describe('getEligibleCompetitions', () => {
  const ageCutoff = new Date('2026-01-01')

  // 11 years old on Jan 1, 2026 → qualifies for U12 (max_age_jan1: 11)
  const noviceDancer: DancerProfile = {
    dob: new Date('2014-03-15'),
    gender: 'female',
    championshipStatus: 'none',
    danceLevels: { reel: 'NOV', slip_jig: 'NOV', treble_jig: 'NOV' }
  }

  it('marks a solo competition as eligible when age and level match', () => {
    const comps = [makeCompetition()]
    const result = getEligibleCompetitions(noviceDancer, comps, ageCutoff, LEVELS)

    expect(result).toHaveLength(1)
    expect(result[0].eligible).toBe(true)
    expect(result[0].reason).toContain('match')
  })

  it('marks a solo competition as ineligible when dancer level does not match', () => {
    const comps = [makeCompetition({ level_key: 'PW', display_name: 'U12 PW Reel' })]
    const result = getEligibleCompetitions(noviceDancer, comps, ageCutoff, LEVELS)

    expect(result).toHaveLength(1)
    expect(result[0].eligible).toBe(false)
  })

  it('uses per-dance level (not a single default level)', () => {
    // Dancer is NOV for reel but AB for slip_jig
    const dancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV', slip_jig: 'AB' }
    }

    const comps = [
      makeCompetition({ id: 'c1', dance_key: 'reel', level_key: 'NOV' }),
      makeCompetition({ id: 'c2', dance_key: 'slip_jig', level_key: 'NOV', display_name: 'U12 NOV Slip Jig' }),
    ]

    const result = getEligibleCompetitions(dancer, comps, ageCutoff, LEVELS)

    expect(result.find(r => r.competition.id === 'c1')!.eligible).toBe(true)
    expect(result.find(r => r.competition.id === 'c2')!.eligible).toBe(false)
  })

  it('marks solo as ineligible when age does not match (too old)', () => {
    // 12 years old on Jan 1 → does NOT qualify for U12 (max_age_jan1: 11)
    const olderDancer: DancerProfile = {
      dob: new Date('2013-03-15'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV' }
    }

    const comps = [makeCompetition()]
    const result = getEligibleCompetitions(olderDancer, comps, ageCutoff, LEVELS)

    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('age')
  })

  it('handles O18 age group (min_age_jan1)', () => {
    const adultDancer: DancerProfile = {
      dob: new Date('2005-06-01'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV' }
    }

    const comp = makeCompetition({
      age_group_key: 'O18',
      age_group_label: '18 & Over',
      age_max_jan1: null,
      age_min_jan1: 18,
      display_name: 'O18 Novice Reel'
    })

    const result = getEligibleCompetitions(adultDancer, [comp], ageCutoff, LEVELS)
    // 20 years old on Jan 1 2026
    expect(result[0].eligible).toBe(true)
  })

  it('handles O18 age group — too young', () => {
    const youngDancer: DancerProfile = {
      dob: new Date('2010-06-01'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV' }
    }

    const comp = makeCompetition({
      age_group_key: 'O18',
      age_max_jan1: null,
      age_min_jan1: 18,
      display_name: 'O18 Novice Reel'
    })

    const result = getEligibleCompetitions(youngDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  // ─── Championship eligibility ───

  it('marks prelim championship as eligible when dancer has prelim status', () => {
    const prelimDancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'prelim',
      danceLevels: { reel: 'PW' }
    }

    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'prelim',
      level_key: null,
      dance_key: null,
      fee_category: 'prelim_champ',
      display_name: 'U12 Preliminary Championship'
    })

    const result = getEligibleCompetitions(prelimDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks open championship as eligible when dancer has open status', () => {
    const openDancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'open',
      danceLevels: { reel: 'PW' }
    }

    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'open',
      level_key: null,
      dance_key: null,
      fee_category: 'open_champ',
      display_name: 'U12 Open Championship'
    })

    const result = getEligibleCompetitions(openDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks prelim championship as eligible when dancer has open status (open can enter prelim)', () => {
    const openDancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'open',
      danceLevels: { reel: 'PW' }
    }

    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'prelim',
      level_key: null,
      dance_key: null,
      fee_category: 'prelim_champ',
      display_name: 'U12 Preliminary Championship'
    })

    const result = getEligibleCompetitions(openDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks open championship as ineligible for prelim dancer', () => {
    const prelimDancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'prelim',
      danceLevels: { reel: 'PW' }
    }

    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'open',
      level_key: null,
      dance_key: null,
      fee_category: 'open_champ',
      display_name: 'U12 Open Championship'
    })

    const result = getEligibleCompetitions(prelimDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('championship')
  })

  it('marks championship as ineligible for none status dancer', () => {
    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'prelim',
      level_key: null,
      dance_key: null,
      fee_category: 'prelim_champ',
      display_name: 'U12 Preliminary Championship'
    })

    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  // ─── Specials ───

  it('marks specials as eligible when age matches', () => {
    const comp = makeCompetition({
      competition_type: 'special',
      level_key: null,
      dance_key: null,
      fee_category: 'solo',
      display_name: 'U12 Ceili'
    })

    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks cross-age specials as always eligible (both age fields null)', () => {
    const comp = makeCompetition({
      competition_type: 'special',
      age_group_key: null,
      age_group_label: null,
      age_max_jan1: null,
      age_min_jan1: null,
      level_key: null,
      dance_key: null,
      fee_category: 'solo',
      display_name: 'Ceili (Team)'
    })

    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  // ─── Custom ───

  it('marks custom competitions as always eligible', () => {
    const comp = makeCompetition({
      competition_type: 'custom',
      age_group_key: null,
      age_group_label: null,
      age_max_jan1: null,
      age_min_jan1: null,
      level_key: null,
      dance_key: null,
      fee_category: 'solo',
      display_name: 'Charity Dance'
    })

    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  // ─── Disabled filtering ───

  it('filters out disabled competitions', () => {
    const comps = [
      makeCompetition({ id: 'c1', enabled: true }),
      makeCompetition({ id: 'c2', enabled: false })
    ]

    const result = getEligibleCompetitions(noviceDancer, comps, ageCutoff, LEVELS)
    expect(result).toHaveLength(1)
    expect(result[0].competition.id).toBe('c1')
  })

  // ─── Edge cases ───

  it('handles empty competitions list', () => {
    const result = getEligibleCompetitions(noviceDancer, [], ageCutoff, LEVELS)
    expect(result).toEqual([])
  })

  it('handles dancer with no dance levels for the competition dance', () => {
    // Dancer has levels for reel but competition is for hornpipe
    const comp = makeCompetition({
      dance_key: 'hornpipe',
      level_key: 'NOV',
      display_name: 'U12 NOV Hornpipe'
    })

    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('level')
  })

  it('handles empty dancer dance levels', () => {
    const dancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: {}
    }

    const comps = [makeCompetition()]
    const result = getEligibleCompetitions(dancer, comps, ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('processes multiple competitions at once', () => {
    const comps = [
      makeCompetition({ id: 'c1', dance_key: 'reel', level_key: 'NOV' }),
      makeCompetition({ id: 'c2', dance_key: 'slip_jig', level_key: 'NOV' }),
      makeCompetition({ id: 'c3', dance_key: 'reel', level_key: 'PW' }),
      makeCompetition({
        id: 'c4',
        competition_type: 'special',
        level_key: null,
        dance_key: null,
        display_name: 'U12 Ceili'
      }),
    ]

    const result = getEligibleCompetitions(noviceDancer, comps, ageCutoff, LEVELS)
    expect(result).toHaveLength(4)
    expect(result.find(r => r.competition.id === 'c1')!.eligible).toBe(true)
    expect(result.find(r => r.competition.id === 'c2')!.eligible).toBe(true)
    expect(result.find(r => r.competition.id === 'c3')!.eligible).toBe(false) // PW level
    expect(result.find(r => r.competition.id === 'c4')!.eligible).toBe(true)  // special
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/eligibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/engine/eligibility.ts
import type {
  DancerProfile,
  FeisCompetition,
  EligibleCompetition,
  Level
} from '@/lib/types/feis-listing'

/**
 * Calculate a person's age on a given date.
 * Returns whole years (floor). Used with age_cutoff_date (typically Jan 1).
 */
export function calculateAgeOnDate(dob: Date, referenceDate: Date): number {
  let age = referenceDate.getFullYear() - dob.getFullYear()
  const monthDiff = referenceDate.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--
  }
  return age
}

/**
 * Check whether the dancer's age matches a competition's age constraints.
 * If both age_max_jan1 and age_min_jan1 are null, the competition is cross-age (always matches).
 */
function ageMatches(
  dancerAge: number,
  ageMaxJan1: number | null,
  ageMinJan1: number | null
): boolean {
  if (ageMaxJan1 === null && ageMinJan1 === null) return true
  if (ageMaxJan1 !== null && dancerAge > ageMaxJan1) return false
  if (ageMinJan1 !== null && dancerAge < ageMinJan1) return false
  return true
}

/**
 * Given a dancer profile and a list of competitions, return eligibility status
 * for each enabled competition with a human-readable reason.
 *
 * @param dancer - The dancer's profile (age, gender, championship status, per-dance levels)
 * @param competitions - All feis_competitions rows for this feis
 * @param ageCutoffDate - The feis's age cutoff date (typically Jan 1 of feis year)
 * @param levels - The level rank definitions from the syllabus template
 */
export function getEligibleCompetitions(
  dancer: DancerProfile,
  competitions: FeisCompetition[],
  ageCutoffDate: Date,
  levels: Level[]
): EligibleCompetition[] {
  const dancerAge = calculateAgeOnDate(dancer.dob, ageCutoffDate)

  // Build level rank lookup: level_key -> rank
  const levelRankMap: Record<string, number> = {}
  for (const level of levels) {
    levelRankMap[level.key] = level.rank
  }

  // Filter to enabled competitions only
  const enabledComps = competitions.filter(c => c.enabled)

  return enabledComps.map(comp => {
    // Step 1: Check age group match
    const ageMatch = ageMatches(dancerAge, comp.age_max_jan1, comp.age_min_jan1)

    if (!ageMatch) {
      return {
        competition: comp,
        eligible: false,
        reason: `Age ${dancerAge} does not match ${comp.age_group_label ?? 'age group'}`
      }
    }

    // Step 2: Check eligibility by competition type
    switch (comp.competition_type) {
      case 'solo': {
        // Solo: dancer's level for the specific dance_key must match the competition's level_key
        if (!comp.dance_key || !comp.level_key) {
          return { competition: comp, eligible: true, reason: 'Age matches' }
        }

        const dancerLevelKey = dancer.danceLevels[comp.dance_key]
        if (!dancerLevelKey) {
          return {
            competition: comp,
            eligible: false,
            reason: `No level set for ${comp.dance_label ?? comp.dance_key}`
          }
        }

        const dancerRank = levelRankMap[dancerLevelKey]
        const compRank = levelRankMap[comp.level_key]

        if (dancerRank === undefined || compRank === undefined) {
          // Unknown level — cannot determine eligibility
          return {
            competition: comp,
            eligible: false,
            reason: `Unknown level: ${dancerLevelKey} or ${comp.level_key}`
          }
        }

        // Exact level match (default eligibility behavior)
        if (dancerRank === compRank) {
          return {
            competition: comp,
            eligible: true,
            reason: 'Age and level match'
          }
        }

        return {
          competition: comp,
          eligible: false,
          reason: `Level mismatch: dancer is ${dancerLevelKey}, competition requires ${comp.level_key}`
        }
      }

      case 'championship': {
        // Championship: check championship_status
        if (comp.championship_key === 'prelim') {
          const eligible = dancer.championshipStatus === 'prelim' || dancer.championshipStatus === 'open'
          return {
            competition: comp,
            eligible,
            reason: eligible
              ? 'Age matches, championship status qualifies'
              : `Championship status '${dancer.championshipStatus}' insufficient for Preliminary Championship`
          }
        }

        if (comp.championship_key === 'open') {
          const eligible = dancer.championshipStatus === 'open'
          return {
            competition: comp,
            eligible,
            reason: eligible
              ? 'Age matches, championship status qualifies'
              : `Championship status '${dancer.championshipStatus}' insufficient for Open Championship`
          }
        }

        // Unknown championship key — ineligible
        return {
          competition: comp,
          eligible: false,
          reason: `Unknown championship type: ${comp.championship_key}`
        }
      }

      case 'special': {
        // Special: always eligible if age matches (already checked above)
        return {
          competition: comp,
          eligible: true,
          reason: 'Specials are open to all levels'
        }
      }

      case 'custom': {
        // Custom: always eligible regardless of age/level
        return {
          competition: comp,
          eligible: true,
          reason: 'Custom competition — no eligibility restrictions'
        }
      }

      default: {
        return {
          competition: comp,
          eligible: false,
          reason: `Unknown competition type: ${comp.competition_type}`
        }
      }
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/eligibility.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/eligibility.ts tests/engine/eligibility.test.ts
git commit -m "feat: add eligibility engine — age calculation, per-dance level matching, championship filtering"
```

---

## Task 4: Checkpoint — Run All Tests + Build

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All existing tests + new tests PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors.

---

## Task 5: Auth Updates — Onboarding + View Toggle

**Files:**
- Modify: `src/app/auth/signup/page.tsx`
- Modify: `src/middleware.ts`
- Create: `src/app/dashboard/actions.ts`
- Create: `src/components/navigation/view-toggle.tsx`

- [ ] **Step 1: Add intent picker to signup success state**

Modify `src/app/auth/signup/page.tsx`. After the "Check your email" success state, add a post-verification intent picker page. When the user first logs in after verification, check if they have a household or feis listings — if neither, show the intent picker.

The simplest approach: add a new page at `src/app/auth/onboarding/page.tsx`.

```typescript
// src/app/auth/onboarding/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { IntentPicker } from '@/components/auth/intent-picker'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check existing capabilities
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  const { data: listings } = await supabase
    .from('feis_listings')
    .select('id')
    .eq('created_by', user.id)
    .limit(1)

  // If user already has data, route them
  if (household && listings && listings.length > 0) {
    redirect('/dashboard')
  }
  if (household) {
    redirect('/dashboard')
  }
  if (listings && listings.length > 0) {
    redirect('/organiser/feiseanna')
  }

  return <IntentPicker />
}
```

```typescript
// src/components/auth/intent-picker.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createHousehold } from '@/app/dashboard/actions'

export function IntentPicker() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function handleParentIntent() {
    setLoading('parent')
    try {
      const result = await createHousehold()
      if ('error' in result) {
        console.error(result.error)
        return
      }
      router.push('/dashboard/dancers/new')
    } finally {
      setLoading(null)
    }
  }

  function handleOrganiserIntent() {
    setLoading('organiser')
    router.push('/organiser/feiseanna/new')
  }

  return (
    <div className="mx-auto mt-20 max-w-md px-6">
      <div className="feis-card p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Welcome to FeisTab</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            What do you want to do first?
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleParentIntent}
            disabled={loading !== null}
            className="w-full rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-muted disabled:opacity-50"
          >
            <div className="font-medium">Register a dancer for a feis</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Set up your family and browse competitions
            </div>
          </button>

          <button
            onClick={handleOrganiserIntent}
            disabled={loading !== null}
            className="w-full rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-muted disabled:opacity-50"
          >
            <div className="font-medium">Set up a feis as an organiser</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Create a feis listing with syllabus, fees, and deadlines
            </div>
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          You can always access both sides later.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the household Server Action**

```typescript
// src/app/dashboard/actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'

export async function createHousehold() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if household already exists
  const { data: existing } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    return { id: existing.id }
  }

  const { data, error } = await supabase
    .from('households')
    .insert({ user_id: user.id })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to create household:', error)
    return { error: 'Failed to create household' }
  }

  return { id: data.id }
}
```

- [ ] **Step 3: Update middleware for parent dashboard routes**

Modify `src/middleware.ts` to protect `/dashboard` routes and route authenticated users to onboarding if needed:

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protect organiser routes
  if (!user && request.nextUrl.pathname.startsWith('/organiser')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Protect dashboard routes
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Protect registration routes (require auth)
  if (!user && request.nextUrl.pathname.includes('/register')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from auth pages to onboarding
  if (user && request.nextUrl.pathname.startsWith('/auth') && !request.nextUrl.pathname.startsWith('/auth/callback') && !request.nextUrl.pathname.startsWith('/auth/onboarding')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/onboarding'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/organiser/:path*', '/dashboard/:path*', '/auth/:path*', '/feiseanna/:path*/register/:path*'],
}
```

- [ ] **Step 4: Create Parent/Organiser view toggle**

```typescript
// src/components/navigation/view-toggle.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface ViewToggleProps {
  hasHousehold: boolean
  hasListings: boolean
}

export function ViewToggle({ hasHousehold, hasListings }: ViewToggleProps) {
  const pathname = usePathname()
  const isParent = pathname.startsWith('/dashboard') || pathname.startsWith('/feiseanna')
  const isOrganiser = pathname.startsWith('/organiser')

  // Only show if user has both capabilities
  if (!hasHousehold || !hasListings) return null

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted p-1 text-sm">
      <Link
        href="/dashboard"
        className={`rounded px-3 py-1.5 font-medium transition-colors ${
          isParent ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Parent
      </Link>
      <Link
        href="/organiser/feiseanna"
        className={`rounded px-3 py-1.5 font-medium transition-colors ${
          isOrganiser ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Organiser
      </Link>
    </div>
  )
}
```

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/auth/onboarding/page.tsx src/components/auth/intent-picker.tsx src/app/dashboard/actions.ts src/middleware.ts src/components/navigation/view-toggle.tsx
git commit -m "feat: add onboarding intent picker, household creation, middleware updates, view toggle"
```

---

## Task 6: Dancer Management Pages

**Files:**
- Create: `src/app/dashboard/layout.tsx`
- Create: `src/app/dashboard/page.tsx` (placeholder for now)
- Create: `src/app/dashboard/dancers/page.tsx`
- Create: `src/app/dashboard/dancers/new/page.tsx`
- Create: `src/app/dashboard/dancers/[id]/page.tsx`
- Create: `src/app/dashboard/dancers/actions.ts`

- [ ] **Step 1: Create parent dashboard layout**

```typescript
// src/app/dashboard/layout.tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ViewToggle } from '@/components/navigation/view-toggle'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check capabilities for view toggle
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  const { data: listings } = await supabase
    .from('feis_listings')
    .select('id')
    .eq('created_by', user.id)
    .limit(1)

  const hasHousehold = !!household
  const hasListings = !!(listings && listings.length > 0)

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-bold text-primary">
              FeisTab
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="font-medium text-foreground hover:text-primary">
                Dashboard
              </Link>
              <Link href="/dashboard/dancers" className="text-muted-foreground hover:text-foreground">
                Dancers
              </Link>
              <Link href="/feiseanna" className="text-muted-foreground hover:text-foreground">
                Browse Feiseanna
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ViewToggle hasHousehold={hasHousehold} hasListings={hasListings} />
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-6 py-8">
        {children}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create placeholder dashboard page**

```typescript
// src/app/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // Check if household exists
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) {
    redirect('/auth/onboarding')
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <div className="feis-card px-6 py-12 text-center">
        <p className="text-muted-foreground">No registrations yet.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Browse open feiseanna to get started.
        </p>
        <Link
          href="/feiseanna"
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
        >
          Browse Feiseanna
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create dancer Server Actions**

```typescript
// src/app/dashboard/dancers/actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'

// Standard CLRG dances for populating default levels
const STANDARD_DANCES = [
  'reel', 'light_jig', 'slip_jig', 'single_jig', 'treble_jig', 'hornpipe'
]

interface CreateDancerInput {
  first_name: string
  last_name: string
  date_of_birth: string
  gender: 'female' | 'male'
  school_name?: string | null
  tcrg_name?: string | null
  championship_status: 'none' | 'prelim' | 'open'
  default_level: string  // e.g., 'NOV'
  level_overrides?: Record<string, string>  // dance_key -> level_key overrides
}

export async function createDancer(input: CreateDancerInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  // Get household
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (householdError || !household) {
    return { error: 'Household not found' }
  }

  // Create dancer
  const { data: dancer, error: dancerError } = await supabase
    .from('dancers')
    .insert({
      household_id: household.id,
      first_name: input.first_name,
      last_name: input.last_name,
      date_of_birth: input.date_of_birth,
      gender: input.gender,
      school_name: input.school_name || null,
      tcrg_name: input.tcrg_name || null,
      championship_status: input.championship_status,
    })
    .select('id')
    .single()

  if (dancerError || !dancer) {
    console.error('Failed to create dancer:', dancerError)
    return { error: 'Failed to create dancer' }
  }

  // Create dance levels for all standard dances
  const levels = STANDARD_DANCES.map(danceKey => ({
    dancer_id: dancer.id,
    dance_key: danceKey,
    level_key: input.level_overrides?.[danceKey] ?? input.default_level,
    source: 'parent' as const,
  }))

  const { error: levelsError } = await supabase
    .from('dancer_dance_levels')
    .insert(levels)

  if (levelsError) {
    console.error('Failed to create dance levels:', levelsError)
    return { error: 'Failed to create dance levels' }
  }

  return { id: dancer.id }
}

interface UpdateDancerInput {
  first_name: string
  last_name: string
  date_of_birth: string
  gender: 'female' | 'male'
  school_name?: string | null
  tcrg_name?: string | null
  championship_status: 'none' | 'prelim' | 'open'
  levels: Record<string, string>  // dance_key -> level_key
}

export async function updateDancer(dancerId: string, input: UpdateDancerInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  // Update dancer profile
  const { error: dancerError } = await supabase
    .from('dancers')
    .update({
      first_name: input.first_name,
      last_name: input.last_name,
      date_of_birth: input.date_of_birth,
      gender: input.gender,
      school_name: input.school_name || null,
      tcrg_name: input.tcrg_name || null,
      championship_status: input.championship_status,
    })
    .eq('id', dancerId)

  if (dancerError) {
    console.error('Failed to update dancer:', dancerError)
    return { error: 'Failed to update dancer' }
  }

  // Upsert dance levels (delete-and-reinsert for simplicity)
  const { error: deleteError } = await supabase
    .from('dancer_dance_levels')
    .delete()
    .eq('dancer_id', dancerId)

  if (deleteError) {
    console.error('Failed to clear dance levels:', deleteError)
    return { error: 'Failed to update dance levels' }
  }

  const levelRows = Object.entries(input.levels).map(([dance_key, level_key]) => ({
    dancer_id: dancerId,
    dance_key,
    level_key,
    source: 'parent' as const,
  }))

  if (levelRows.length > 0) {
    const { error: levelsError } = await supabase
      .from('dancer_dance_levels')
      .insert(levelRows)

    if (levelsError) {
      console.error('Failed to insert dance levels:', levelsError)
      return { error: 'Failed to update dance levels' }
    }
  }

  return { success: true as const }
}

export async function archiveDancer(dancerId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('dancers')
    .update({ is_active: false })
    .eq('id', dancerId)

  if (error) {
    console.error('Failed to archive dancer:', error)
    return { error: 'Failed to archive dancer' }
  }

  return { success: true as const }
}
```

- [ ] **Step 4: Create dancer list page**

Server component at `src/app/dashboard/dancers/page.tsx`. Fetches all dancers for the user's household. Shows active dancers with name, age, level summary, school. "Add Dancer" button. Archived dancers in collapsed section at bottom.

Key props: List of `Dancer` objects with their `DancerDanceLevel[]`. Link to `/dashboard/dancers/new` and `/dashboard/dancers/[id]`.

- [ ] **Step 5: Create add dancer page**

Client component at `src/app/dashboard/dancers/new/page.tsx`. Form fields:
1. First name, last name, date of birth (date picker), gender (radio: female/male)
2. School name (optional), teacher name (optional), championship status (select: none/prelim/open)
3. Default level (select: BG/AB/NOV/PW) — populates all dances at this level
4. Per-dance level adjustments (expandable section) — shows each standard dance with level select

On submit: calls `createDancer()` Server Action. On success: redirect to `/dashboard/dancers`.

- [ ] **Step 6: Create edit dancer page**

Server component wrapper + client form at `src/app/dashboard/dancers/[id]/page.tsx`. Same form as creation, pre-populated with existing data. Plus:
- Each dance shown with current level, editable
- "Update all to [level]" bulk action button
- "Archive dancer" button with confirmation dialog
- On submit: calls `updateDancer()` Server Action

- [ ] **Step 7: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/layout.tsx src/app/dashboard/page.tsx src/app/dashboard/dancers/page.tsx src/app/dashboard/dancers/new/page.tsx src/app/dashboard/dancers/actions.ts
git commit -m "feat: add dancer management — list, create, edit, archive with per-dance levels"
```

---

## Task 7: Browse Feiseanna (Public)

**Files:**
- Create: `src/app/feiseanna/page.tsx`
- Create: `src/app/feiseanna/[id]/page.tsx`

- [ ] **Step 1: Create browse feiseanna page**

Server component at `src/app/feiseanna/page.tsx`. No auth required. Fetches all `feis_listings WHERE status = 'open'` ordered by `feis_date ASC`.

```typescript
// src/app/feiseanna/page.tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { FeisListing } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function daysUntil(dateString: string): number {
  const target = new Date(dateString + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export default async function BrowseFeiseannaPage() {
  const supabase = await createClient()

  const { data: listings, error } = await supabase
    .from('feis_listings')
    .select('*')
    .eq('status', 'open')
    .order('feis_date', { ascending: true })

  if (error) {
    console.error('Failed to fetch listings:', error)
  }

  const feiseanna = (listings ?? []) as FeisListing[]

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-bold">Open Feiseanna</h1>

        {feiseanna.length === 0 ? (
          <div className="feis-card px-6 py-12 text-center text-muted-foreground">
            No feiseanna are currently open for registration.
          </div>
        ) : (
          <div className="space-y-4">
            {feiseanna.map((feis) => {
              const closeDays = feis.reg_closes_at
                ? daysUntil(feis.reg_closes_at.split('T')[0])
                : null

              return (
                <Link
                  key={feis.id}
                  href={`/feiseanna/${feis.id}`}
                  className="feis-card block p-5 transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">{feis.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDate(feis.feis_date)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {feis.venue_name}
                        {feis.venue_address ? ` — ${feis.venue_address}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      {closeDays !== null && closeDays <= 7 && closeDays > 0 && (
                        <span className="inline-block rounded-full bg-feis-orange-light px-2.5 py-0.5 text-xs font-medium text-feis-orange">
                          Closes in {closeDays} day{closeDays !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create feis detail page**

Server component at `src/app/feiseanna/[id]/page.tsx`. Public access (no auth required). Fetches the listing, fee schedule, and competitions. Shows:

1. Full feis details: name, date, venue (with map link), description, contact info
2. Registration timeline: opens, closes, late closes
3. Fee schedule table (all fee categories, family cap)
4. Competition list grouped by type (solos, championships, specials) — collapsible by age group
5. Capacity status (if dancer_cap set)

For logged-in parents with dancers: "Quick eligibility preview" dropdown (select a dancer, show eligible competitions client-side using the eligibility engine). "Register" CTA button.

For logged-out visitors: "Sign in to register" button. Optional: anonymous approximate preview ("Enter age and level for an estimate").

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/feiseanna/page.tsx src/app/feiseanna/\[id\]/page.tsx
git commit -m "feat: add public feis browse and detail pages with eligibility preview"
```

---

## Task 8: Registration Engine — Step 1 (Who's Dancing?)

**Files:**
- Create: `src/app/feiseanna/[id]/register/page.tsx`
- Create: `src/app/feiseanna/[id]/register/actions.ts`
- Create: `src/components/registration/step1-dancers.tsx`

- [ ] **Step 1: Create the registration page**

Client component at `src/app/feiseanna/[id]/register/page.tsx`. Requires auth. Manages step state (1, 2, 3) client-side. URL stays the same — step transitions are client-side state.

On mount:
1. Check if user has a household. If not, redirect to `/auth/onboarding`.
2. Check if user has dancers. If no dancers, redirect to `/dashboard/dancers/new?returnTo=/feiseanna/[id]/register`.
3. Check for existing `draft` or `pending_payment` registration for this household + feis. If found and not expired, restore it (skip to appropriate step). If expired, allow new registration.

Renders the current step component.

- [ ] **Step 2: Create Step 1 component**

```typescript
// src/components/registration/step1-dancers.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Dancer, DancerDanceLevel } from '@/lib/types/feis-listing'
import { calculateAgeOnDate } from '@/lib/engine/eligibility'

interface Step1DancersProps {
  dancers: (Dancer & { dance_levels: DancerDanceLevel[] })[]
  feisName: string
  ageCutoffDate: Date
  onNext: (selectedDancerIds: string[]) => void
}

export function Step1Dancers({ dancers, feisName, ageCutoffDate, onNext }: Step1DancersProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const activeDancers = dancers.filter(d => d.is_active)

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Who&apos;s dancing?</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Select the dancers from your family who will attend {feisName}.
      </p>

      {activeDancers.length === 0 ? (
        <div className="feis-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No dancers in your family yet.</p>
          <Link
            href="/dashboard/dancers/new"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Add a Dancer
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {activeDancers.map(dancer => {
            const age = calculateAgeOnDate(
              new Date(dancer.date_of_birth),
              ageCutoffDate
            )
            const isSelected = selected.has(dancer.id)

            return (
              <button
                key={dancer.id}
                onClick={() => toggle(dancer.id)}
                className={`feis-card w-full p-4 text-left transition-colors ${
                  isSelected ? 'border-primary ring-2 ring-primary/20' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {dancer.first_name} {dancer.last_name}
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      Age {age} for this feis
                      {dancer.school_name ? ` · ${dancer.school_name}` : ''}
                    </div>
                  </div>
                  <div className={`flex h-5 w-5 items-center justify-center rounded border ${
                    isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                  }`}>
                    {isSelected && (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-4">
        <Link
          href="/dashboard/dancers/new"
          className="text-sm font-medium text-primary hover:underline"
        >
          + Add a new dancer
        </Link>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={() => onNext(Array.from(selected))}
          disabled={selected.size === 0}
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)] disabled:opacity-50"
        >
          Next: Choose Competitions
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create registration Server Actions file**

```typescript
// src/app/feiseanna/[id]/register/actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { canTransitionRegistration } from '@/lib/registration-states'
import { calculateFees } from '@/lib/engine/fee-calculator'
import type { FeeSchedule, FeeEntry, RegistrationStatus } from '@/lib/types/feis-listing'

export async function getExistingRegistration(feisListingId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) return { error: 'No household' }

  const { data: registration } = await supabase
    .from('registrations')
    .select('*, registration_entries(*)')
    .eq('feis_listing_id', feisListingId)
    .eq('household_id', household.id)
    .in('status', ['draft', 'pending_payment'])
    .single()

  if (!registration) return { registration: null }

  // Check if hold is expired
  if (registration.hold_expires_at && new Date(registration.hold_expires_at) < new Date()) {
    // Mark as expired
    await supabase
      .from('registrations')
      .update({ status: 'expired' })
      .eq('id', registration.id)
    return { registration: null, expired: true }
  }

  return { registration }
}

export async function cancelRegistration(registrationId: string) {
  const supabase = await createClient()

  const { data: reg, error: fetchError } = await supabase
    .from('registrations')
    .select('status')
    .eq('id', registrationId)
    .single()

  if (fetchError || !reg) return { error: 'Registration not found' }

  const currentStatus = reg.status as RegistrationStatus
  if (!canTransitionRegistration(currentStatus, 'cancelled')) {
    return { error: `Cannot cancel registration in ${currentStatus} state` }
  }

  const { error } = await supabase
    .from('registrations')
    .update({ status: 'cancelled' })
    .eq('id', registrationId)

  if (error) {
    console.error('Failed to cancel registration:', error)
    return { error: 'Failed to cancel registration' }
  }

  return { success: true as const }
}
```

This file will be extended in Tasks 10 and 11 with `createDraftRegistration` and `createCheckoutSession`.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/feiseanna/\[id\]/register/page.tsx src/app/feiseanna/\[id\]/register/actions.ts src/components/registration/step1-dancers.tsx
git commit -m "feat: add registration Step 1 — dancer selection with age calculation"
```

---

## Task 9: Registration Engine — Step 2 (Build Cart)

**Files:**
- Create: `src/components/registration/step2-cart.tsx`

- [ ] **Step 1: Create Step 2 cart component**

```typescript
// src/components/registration/step2-cart.tsx
'use client'

import { useState, useMemo } from 'react'
import { getEligibleCompetitions, calculateAgeOnDate } from '@/lib/engine/eligibility'
import { calculateFees } from '@/lib/engine/fee-calculator'
import type {
  Dancer,
  DancerDanceLevel,
  FeisCompetition,
  FeeSchedule,
  DancerProfile,
  Level,
  FeeEntry,
  EligibleCompetition
} from '@/lib/types/feis-listing'

interface Step2CartProps {
  selectedDancers: (Dancer & { dance_levels: DancerDanceLevel[] })[]
  competitions: FeisCompetition[]
  feeSchedule: FeeSchedule
  ageCutoffDate: Date
  levels: Level[]
  isLate: boolean
  onNext: (cart: Record<string, string[]>) => void  // dancerId -> competitionIds
  onBack: () => void
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function Step2Cart({
  selectedDancers,
  competitions,
  feeSchedule,
  ageCutoffDate,
  levels,
  isLate,
  onNext,
  onBack,
}: Step2CartProps) {
  const [activeDancerIdx, setActiveDancerIdx] = useState(0)
  const [cart, setCart] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {}
    for (const d of selectedDancers) {
      initial[d.id] = new Set()
    }
    return initial
  })
  const [showAll, setShowAll] = useState(false)

  // Build eligibility for each dancer
  const eligibilityByDancer = useMemo(() => {
    const result: Record<string, EligibleCompetition[]> = {}
    for (const dancer of selectedDancers) {
      const profile: DancerProfile = {
        dob: new Date(dancer.date_of_birth),
        gender: dancer.gender,
        championshipStatus: dancer.championship_status,
        danceLevels: Object.fromEntries(
          dancer.dance_levels.map(dl => [dl.dance_key, dl.level_key])
        ),
      }
      result[dancer.id] = getEligibleCompetitions(profile, competitions, ageCutoffDate, levels)
    }
    return result
  }, [selectedDancers, competitions, ageCutoffDate, levels])

  // Calculate running total
  const feeBreakdown = useMemo(() => {
    const entries: FeeEntry[] = []
    for (const dancer of selectedDancers) {
      const selectedComps = cart[dancer.id] ?? new Set()
      for (const compId of selectedComps) {
        const comp = competitions.find(c => c.id === compId)
        if (comp) {
          entries.push({
            dancer_id: dancer.id,
            fee_category: comp.fee_category,
            is_late: isLate,
            is_day_of: false,
          })
        }
      }
    }
    return calculateFees(feeSchedule, entries)
  }, [cart, selectedDancers, competitions, feeSchedule, isLate])

  function toggleCompetition(dancerId: string, compId: string) {
    setCart(prev => {
      const next = { ...prev }
      const dancerSet = new Set(next[dancerId])
      if (dancerSet.has(compId)) {
        dancerSet.delete(compId)
      } else {
        dancerSet.add(compId)
      }
      next[dancerId] = dancerSet
      return next
    })
  }

  const totalSelected = Object.values(cart).reduce((sum, set) => sum + set.size, 0)
  const activeDancer = selectedDancers[activeDancerIdx]
  const activeEligibility = eligibilityByDancer[activeDancer.id] ?? []

  // Group competitions by type
  const solos = activeEligibility.filter(e => e.competition.competition_type === 'solo')
  const championships = activeEligibility.filter(e => e.competition.competition_type === 'championship')
  const specials = activeEligibility.filter(e => e.competition.competition_type === 'special')
  const custom = activeEligibility.filter(e => e.competition.competition_type === 'custom')

  function renderCompGroup(label: string, items: EligibleCompetition[]) {
    const visible = showAll ? items : items.filter(e => e.eligible)
    if (visible.length === 0) return null

    return (
      <div className="mt-4">
        <h4 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">{label}</h4>
        <div className="space-y-1.5">
          {visible.map(({ competition: comp, eligible, reason }) => {
            const isSelected = cart[activeDancer.id]?.has(comp.id)
            return (
              <button
                key={comp.id}
                onClick={() => eligible && toggleCompetition(activeDancer.id, comp.id)}
                disabled={!eligible}
                className={`w-full rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                  isSelected
                    ? 'border-primary bg-secondary'
                    : eligible
                    ? 'border-input hover:bg-muted'
                    : 'border-input bg-muted/50 opacity-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={!eligible ? 'text-muted-foreground' : ''}>
                    {comp.display_name}
                  </span>
                  <span className="font-medium">
                    {formatCents(
                      comp.fee_category === 'prelim_champ'
                        ? feeSchedule.prelim_champ_fee_cents
                        : comp.fee_category === 'open_champ'
                        ? feeSchedule.open_champ_fee_cents
                        : feeSchedule.solo_fee_cents
                    )}
                  </span>
                </div>
                {!eligible && (
                  <div className="mt-1 text-xs text-muted-foreground">{reason}</div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Choose competitions</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Select competitions for each dancer. Competitions are filtered by age and level.
      </p>

      {/* Dancer tabs */}
      {selectedDancers.length > 1 && (
        <div className="feis-segmented-bar mb-6">
          {selectedDancers.map((dancer, idx) => (
            <button
              key={dancer.id}
              onClick={() => setActiveDancerIdx(idx)}
              className={`feis-segmented-tab ${idx === activeDancerIdx ? 'feis-segmented-tab-active' : ''}`}
            >
              {dancer.first_name}
              {(cart[dancer.id]?.size ?? 0) > 0 && (
                <span className="ml-1.5 text-xs">({cart[dancer.id].size})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Dancer header */}
      <div className="mb-4 feis-card p-4">
        <div className="font-medium">{activeDancer.first_name} {activeDancer.last_name}</div>
        <div className="text-sm text-muted-foreground">
          Age {calculateAgeOnDate(new Date(activeDancer.date_of_birth), ageCutoffDate)}
          {activeDancer.school_name ? ` · ${activeDancer.school_name}` : ''}
        </div>
      </div>

      {/* Show all toggle */}
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
          className="rounded border-input"
        />
        Show all competitions (including ineligible)
      </label>

      {/* Competition groups */}
      {renderCompGroup('Solo Dances', solos)}
      {renderCompGroup('Championships', championships)}
      {renderCompGroup('Specials', specials)}
      {renderCompGroup('Custom', custom)}

      {/* Running total footer */}
      <div className="mt-8 feis-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Your Cart</div>
            <div className="text-xs text-muted-foreground">
              {totalSelected} competition{totalSelected !== 1 ? 's' : ''}, {selectedDancers.length} dancer{selectedDancers.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="text-xl font-bold">
            {formatCents(feeBreakdown.grand_total_cents)}
          </div>
        </div>
        {feeBreakdown.family_cap_applied && (
          <div className="mt-1 text-xs text-[var(--color-feis-green)]">
            Family cap applied — you saved {formatCents(feeBreakdown.subtotal_before_cap_cents - feeBreakdown.grand_total_cents)}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Back
        </button>
        <button
          onClick={() => {
            const cartObj: Record<string, string[]> = {}
            for (const [dancerId, compSet] of Object.entries(cart)) {
              cartObj[dancerId] = Array.from(compSet)
            }
            onNext(cartObj)
          }}
          disabled={totalSelected === 0}
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)] disabled:opacity-50"
        >
          Next: Review & Pay
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/registration/step2-cart.tsx
git commit -m "feat: add registration Step 2 — competition selection with eligibility filtering and running total"
```

---

## Task 10: Registration Engine — Step 3 (Review & Pay)

**Files:**
- Create: `src/components/registration/step3-review.tsx`
- Modify: `src/app/feiseanna/[id]/register/actions.ts` — add `createDraftRegistration`, `createCheckoutSession`
- Create: `src/lib/stripe.ts`

- [ ] **Step 1: Create Stripe client singleton**

```typescript
// src/lib/stripe.ts
import Stripe from 'stripe'

let stripeInstance: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not set')
    }
    stripeInstance = new Stripe(key, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    })
  }
  return stripeInstance
}
```

**Note:** Install Stripe SDK: `npm install stripe`

- [ ] **Step 2: Add createDraftRegistration Server Action**

Append to `src/app/feiseanna/[id]/register/actions.ts`:

```typescript
interface CreateDraftInput {
  feisListingId: string
  entries: { dancerId: string; competitionId: string }[]
  consentAcceptedAt: string
  consentIp: string
}

export async function createDraftRegistration(input: CreateDraftInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get household
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) return { error: 'Household not found' }

  // Get fee schedule
  const { data: feeSchedule, error: feeError } = await supabase
    .from('fee_schedules')
    .select('*')
    .eq('feis_listing_id', input.feisListingId)
    .single()

  if (feeError || !feeSchedule) return { error: 'Fee schedule not found' }

  // Get feis listing to check late status
  const { data: listing } = await supabase
    .from('feis_listings')
    .select('reg_closes_at, late_reg_closes_at, stripe_account_id')
    .eq('id', input.feisListingId)
    .single()

  if (!listing) return { error: 'Feis listing not found' }

  const now = new Date()
  const isLate = listing.reg_closes_at ? now > new Date(listing.reg_closes_at) : false

  // Get competition details for fee calculation
  const compIds = input.entries.map(e => e.competitionId)
  const { data: competitions } = await supabase
    .from('feis_competitions')
    .select('id, fee_category')
    .in('id', compIds)

  if (!competitions) return { error: 'Competitions not found' }

  const compMap = new Map(competitions.map(c => [c.id, c]))

  // Calculate fees
  const feeEntries: FeeEntry[] = input.entries.map(e => {
    const comp = compMap.get(e.competitionId)
    return {
      dancer_id: e.dancerId,
      fee_category: (comp?.fee_category ?? 'solo') as 'solo' | 'prelim_champ' | 'open_champ',
      is_late: isLate,
      is_day_of: false,
    }
  })

  const breakdown = calculateFees(feeSchedule as FeeSchedule, feeEntries)

  // Create registration + entries atomically via Supabase RPC or sequential inserts
  // Hold expires in 30 minutes
  const holdExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString()

  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .insert({
      feis_listing_id: input.feisListingId,
      household_id: household.id,
      status: 'draft',
      total_cents: breakdown.grand_total_cents,
      application_fee_cents: Math.round(
        breakdown.grand_total_cents * (parseInt(process.env.STRIPE_APPLICATION_FEE_PERCENT ?? '5', 10) / 100)
      ),
      event_fee_cents: breakdown.event_fee_cents,
      is_late: isLate,
      consent_accepted_at: input.consentAcceptedAt,
      consent_version: 'tos-v1-2026-03-01',
      platform_terms_version: 'platform-v1-2026-03-01',
      consent_ip: input.consentIp,
      hold_expires_at: holdExpiresAt,
    })
    .select('id')
    .single()

  if (regError || !reg) {
    console.error('Failed to create registration:', regError)
    return { error: 'Failed to create registration. You may already have an active registration for this feis.' }
  }

  // Build entry rows with frozen fee data
  const lateCharged = new Set<string>()
  const entryRows = input.entries.map(e => {
    const comp = compMap.get(e.competitionId)
    const feeCategory = (comp?.fee_category ?? 'solo') as 'solo' | 'prelim_champ' | 'open_champ'
    const baseFee = feeCategory === 'prelim_champ'
      ? feeSchedule.prelim_champ_fee_cents
      : feeCategory === 'open_champ'
      ? feeSchedule.open_champ_fee_cents
      : feeSchedule.solo_fee_cents

    let lateFee = 0
    if (isLate && !lateCharged.has(e.dancerId)) {
      lateFee = feeSchedule.late_fee_cents
      lateCharged.add(e.dancerId)
    }

    return {
      registration_id: reg.id,
      dancer_id: e.dancerId,
      feis_competition_id: e.competitionId,
      fee_category: feeCategory,
      base_fee_cents: baseFee,
      late_fee_cents: lateFee,
      day_of_surcharge_cents: 0,
    }
  })

  const { error: entriesError } = await supabase
    .from('registration_entries')
    .insert(entryRows)

  if (entriesError) {
    console.error('Failed to create entries:', entriesError)
    // Clean up the registration
    await supabase.from('registrations').delete().eq('id', reg.id)
    return { error: 'Failed to create registration entries' }
  }

  return {
    registrationId: reg.id,
    totalCents: breakdown.grand_total_cents,
    holdExpiresAt,
  }
}
```

- [ ] **Step 3: Add createCheckoutSession Server Action**

Append to `src/app/feiseanna/[id]/register/actions.ts`:

```typescript
export async function createCheckoutSession(registrationId: string) {
  const supabase = await createClient()

  // Load registration with entries
  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .select('*, registration_entries(*, dancers(first_name, last_name)), feis_listings(name, stripe_account_id)')
    .eq('id', registrationId)
    .single()

  if (regError || !reg) return { error: 'Registration not found' }
  if (reg.status !== 'draft') return { error: `Cannot create checkout for ${reg.status} registration` }

  // Check hold not expired
  if (reg.hold_expires_at && new Date(reg.hold_expires_at) < new Date()) {
    await supabase.from('registrations').update({ status: 'expired' }).eq('id', registrationId)
    return { error: 'Registration hold has expired. Please start over.' }
  }

  const connectedAccountId = reg.feis_listings?.stripe_account_id
  if (!connectedAccountId) {
    return { error: 'Organiser has not connected Stripe' }
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  try {
    const stripe = (await import('@/lib/stripe')).getStripe()

    // Build line items from entries
    const lineItems = reg.registration_entries.map((entry: Record<string, unknown>) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${(entry.dancers as Record<string, string>)?.first_name ?? 'Dancer'} — Competition Entry`,
        },
        unit_amount: (entry.base_fee_cents as number) + (entry.late_fee_cents as number) + (entry.day_of_surcharge_cents as number),
      },
      quantity: 1,
    }))

    // Add event fee as a separate line item
    if (reg.event_fee_cents > 0) {
      lineItems.unshift({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Event Fee (per family)',
          },
          unit_amount: reg.event_fee_cents,
        },
        quantity: 1,
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      payment_intent_data: {
        application_fee_amount: reg.application_fee_cents,
      },
      success_url: `${baseUrl}/feiseanna/${reg.feis_listing_id}/register/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/feiseanna/${reg.feis_listing_id}/register?step=3`,
      metadata: {
        registration_id: registrationId,
      },
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }, {
      stripeAccount: connectedAccountId,
      idempotencyKey: `checkout_${registrationId}`,
    })

    // Update registration status
    const { error: updateError } = await supabase
      .from('registrations')
      .update({
        status: 'pending_payment',
        stripe_checkout_session_id: session.id,
      })
      .eq('id', registrationId)

    if (updateError) {
      console.error('Failed to update registration status:', updateError)
      return { error: 'Failed to update registration status' }
    }

    return { url: session.url }
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return { error: 'Failed to create checkout session' }
  }
}
```

- [ ] **Step 4: Create Step 3 review component**

```typescript
// src/components/registration/step3-review.tsx
'use client'

import { useState, useEffect } from 'react'
import type {
  Dancer,
  FeisCompetition,
  FeeBreakdown,
  FeisListing
} from '@/lib/types/feis-listing'

interface Step3ReviewProps {
  feis: FeisListing
  dancers: Dancer[]
  cart: Record<string, string[]>  // dancerId -> competitionIds
  competitions: FeisCompetition[]
  feeBreakdown: FeeBreakdown
  registrationId: string | null
  holdExpiresAt: string | null
  onCreateDraft: () => Promise<void>
  onPay: () => Promise<void>
  onCancel: () => void
  onBack: () => void
  loading: boolean
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    function update() {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) {
        setRemaining('Expired')
        return
      }
      const mins = Math.floor(diff / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      setRemaining(`${mins}:${secs.toString().padStart(2, '0')}`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  return (
    <span className={remaining === 'Expired' ? 'text-destructive' : 'font-mono'}>
      {remaining}
    </span>
  )
}

export function Step3Review({
  feis,
  dancers,
  cart,
  competitions,
  feeBreakdown,
  registrationId,
  holdExpiresAt,
  onCreateDraft,
  onPay,
  onCancel,
  onBack,
  loading,
}: Step3ReviewProps) {
  const [consentChecked, setConsentChecked] = useState(false)

  const compMap = new Map(competitions.map(c => [c.id, c]))

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Review & Pay</h2>

      {holdExpiresAt && (
        <div className="mb-4 rounded-md border border-feis-orange/30 bg-feis-orange-light px-4 py-2 text-sm">
          Your spots are held for <CountdownTimer expiresAt={holdExpiresAt} />
        </div>
      )}

      {/* Feis info */}
      <div className="mb-4 feis-card p-4">
        <div className="font-semibold">{feis.name}</div>
        <div className="text-sm text-muted-foreground">{feis.venue_name}</div>
      </div>

      {/* Per-dancer summary */}
      {dancers.map(dancer => {
        const compIds = cart[dancer.id] ?? []
        if (compIds.length === 0) return null

        return (
          <div key={dancer.id} className="mb-4 feis-card p-4">
            <div className="mb-2 font-medium">{dancer.first_name} {dancer.last_name}</div>
            <ul className="space-y-1">
              {compIds.map(compId => {
                const comp = compMap.get(compId)
                return (
                  <li key={compId} className="flex items-center justify-between text-sm">
                    <span>{comp?.display_name ?? 'Unknown'}</span>
                    <span className="font-medium">
                      {comp ? formatCents(
                        comp.fee_category === 'prelim_champ'
                          ? feeBreakdown.line_items.find(li => li.dancer_id === dancer.id)?.base_fee_cents ?? 0
                          : comp.fee_category === 'open_champ'
                          ? feeBreakdown.line_items.find(li => li.dancer_id === dancer.id)?.base_fee_cents ?? 0
                          : feeBreakdown.line_items.find(li => li.dancer_id === dancer.id)?.base_fee_cents ?? 0
                      ) : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {/* Fee breakdown */}
      <div className="mb-4 feis-card p-4">
        <h3 className="mb-2 font-semibold">Fee Summary</h3>
        {feeBreakdown.event_fee_cents > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span>Event fee (per family)</span>
            <span>{formatCents(feeBreakdown.event_fee_cents)}</span>
          </div>
        )}
        {Object.entries(feeBreakdown.subtotal_per_dancer).map(([dancerId, subtotal]) => {
          const dancer = dancers.find(d => d.id === dancerId)
          return (
            <div key={dancerId} className="flex items-center justify-between text-sm">
              <span>{dancer?.first_name ?? 'Dancer'} — competitions</span>
              <span>{formatCents(subtotal)}</span>
            </div>
          )
        })}
        {feeBreakdown.family_cap_applied && (
          <div className="mt-1 flex items-center justify-between text-sm text-[var(--color-feis-green)]">
            <span>Family cap applied</span>
            <span>-{formatCents(feeBreakdown.subtotal_before_cap_cents - feeBreakdown.grand_total_cents)}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-lg font-bold">
          <span>Total</span>
          <span>{formatCents(feeBreakdown.grand_total_cents)}</span>
        </div>
      </div>

      {/* Consent checkbox */}
      <label className="mb-6 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={consentChecked}
          onChange={(e) => setConsentChecked(e.target.checked)}
          className="mt-0.5 rounded border-input"
        />
        <span>
          I agree to the{' '}
          <a href="https://feistab.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            FeisTab Terms of Service
          </a>{' '}
          and{' '}
          <a href="https://feistab.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            FeisTab Privacy Policy
          </a>
          {feis.privacy_policy_url && (
            <>
              , and the event-specific{' '}
              <a href={feis.privacy_policy_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Privacy Policy
              </a>
            </>
          )}
          {feis.terms_url && (
            <>
              {' '}and the organiser&apos;s{' '}
              <a href={feis.terms_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Terms
              </a>
            </>
          )}
          . I confirm I am the parent/legal guardian of the dancers listed above.
        </span>
      </label>

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
          <button
            onClick={onCancel}
            className="text-sm font-medium text-destructive hover:underline"
          >
            Cancel
          </button>
        </div>
        <button
          onClick={async () => {
            if (!registrationId) {
              await onCreateDraft()
            }
            await onPay()
          }}
          disabled={!consentChecked || loading}
          className="rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)] disabled:opacity-50"
        >
          {loading ? 'Processing...' : `Pay ${formatCents(feeBreakdown.grand_total_cents)}`}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Install Stripe SDK**

Run: `npm install stripe`

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/registration/step3-review.tsx src/app/feiseanna/\[id\]/register/actions.ts src/lib/stripe.ts
git commit -m "feat: add registration Step 3 — review, consent, draft creation, Stripe checkout session"
```

---

## Task 11: Stripe Webhook Handler

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Create the webhook handler**

```typescript
// src/app/api/webhooks/stripe/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStripe } from '@/lib/stripe'
import type Stripe from 'stripe'

// Use service_role for webhook handler (no user auth context)
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function generateConfirmationNumber(): string {
  const year = new Date().getFullYear()
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // No 0/O, 1/I/L
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `FT-${year}-${code}`
}

export async function POST(request: Request) {
  const body = await request.text() // RAW body — not .json()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_CONNECT_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const registrationId = session.metadata?.registration_id

    if (!registrationId) {
      console.error('No registration_id in checkout session metadata')
      return NextResponse.json({ error: 'Missing registration_id' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Idempotency: check if already processed
    const { data: registration, error: fetchError } = await supabase
      .from('registrations')
      .select('status')
      .eq('id', registrationId)
      .single()

    if (fetchError || !registration) {
      console.error('Registration not found:', registrationId)
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    if (registration.status === 'paid') {
      // Already processed — idempotent response
      return NextResponse.json({ received: true, already_processed: true })
    }

    // Extract charge ID from payment intent for reconciliation
    let chargeId: string | null = null
    if (session.payment_intent) {
      try {
        const stripe = getStripe()
        const paymentIntent = await stripe.paymentIntents.retrieve(
          session.payment_intent as string,
          { stripeAccount: event.account ?? undefined }
        )
        chargeId = (paymentIntent.latest_charge as string) ?? null
      } catch (err) {
        console.error('Failed to retrieve payment intent:', err)
      }
    }

    // Generate confirmation number with retry for uniqueness
    let confirmationNumber: string | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateConfirmationNumber()
      const { data: existing } = await supabase
        .from('registrations')
        .select('id')
        .eq('confirmation_number', candidate)
        .single()

      if (!existing) {
        confirmationNumber = candidate
        break
      }
    }

    // Update registration to paid
    const { error: updateError } = await supabase
      .from('registrations')
      .update({
        status: 'paid',
        stripe_payment_intent_id: session.payment_intent as string | null,
        stripe_charge_id: chargeId,
        total_cents: session.amount_total ?? 0,
        confirmation_number: confirmationNumber,
        hold_expires_at: null, // Clear hold — permanently confirmed
      })
      .eq('id', registrationId)

    if (updateError) {
      console.error('Failed to update registration:', updateError)
      return NextResponse.json({ error: 'Failed to update registration' }, { status: 500 })
    }

    // Create registration snapshot
    const { data: fullReg } = await supabase
      .from('registrations')
      .select('*, registration_entries(*, dancers(first_name, last_name, date_of_birth, championship_status), feis_competitions(display_name, age_group_key, level_key, dance_key, competition_type)), feis_listings(name, feis_date)')
      .eq('id', registrationId)
      .single()

    if (fullReg) {
      await supabase
        .from('registration_snapshots')
        .insert({
          registration_id: registrationId,
          snapshot_data: fullReg,
        })
    }

    // Send confirmation email (async, don't block webhook response)
    try {
      const { sendConfirmationEmail } = await import('@/lib/email/send-confirmation')
      await sendConfirmationEmail(registrationId, supabase)
    } catch (err) {
      // Log but don't fail the webhook — email is best-effort
      console.error('Failed to send confirmation email:', err)
    }
  }

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 2: Add `SUPABASE_SERVICE_ROLE_KEY` to .env.local notes**

The webhook handler needs `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. Add this to `.env.local`:

```
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat: add Stripe webhook handler — payment confirmation, confirmation number, snapshot"
```

---

## Task 12: Success Page

**Files:**
- Create: `src/app/feiseanna/[id]/register/success/page.tsx`

- [ ] **Step 1: Create the success page**

```typescript
// src/app/feiseanna/[id]/register/success/page.tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Registration } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function StatusDisplay({ registration }: { registration: Registration }) {
  switch (registration.status) {
    case 'paid':
      return (
        <div className="text-center">
          <div className="mb-4 text-4xl">&#10003;</div>
          <h1 className="mb-2 text-2xl font-bold">You&apos;re registered!</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Your confirmation number is:
          </p>
          <div className="mb-6 rounded-md bg-secondary px-6 py-3 font-mono text-2xl font-bold text-primary">
            {registration.confirmation_number}
          </div>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation email with your registration details.
          </p>
        </div>
      )
    case 'pending_payment':
      return (
        <div className="text-center">
          <div className="mb-4 text-4xl animate-pulse">&#8987;</div>
          <h1 className="mb-2 text-2xl font-bold">Processing your payment...</h1>
          <p className="text-sm text-muted-foreground">
            This page will update automatically. If it doesn&apos;t, check your dashboard in a few minutes.
          </p>
          {/* Auto-refresh every 3 seconds */}
          <meta httpEquiv="refresh" content="3" />
        </div>
      )
    case 'expired':
      return (
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold">Session expired</h1>
          <p className="text-sm text-muted-foreground">
            Your registration hold has expired. You can start a new registration.
          </p>
        </div>
      )
    case 'cancelled':
      return (
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold">Registration cancelled</h1>
          <p className="text-sm text-muted-foreground">
            Your registration was cancelled.
          </p>
        </div>
      )
    default:
      return (
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold">Registration status: {registration.status}</h1>
        </div>
      )
  }
}

export default async function SuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ session_id?: string }>
}) {
  const { id } = await params
  const { session_id } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Find the registration for this user + feis
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')

  // Look up by stripe session ID if available, otherwise by household + feis
  let registration: Registration | null = null

  if (session_id) {
    const { data } = await supabase
      .from('registrations')
      .select('*')
      .eq('stripe_checkout_session_id', session_id)
      .eq('household_id', household.id)
      .single()

    registration = data as Registration | null
  }

  if (!registration) {
    const { data } = await supabase
      .from('registrations')
      .select('*')
      .eq('feis_listing_id', id)
      .eq('household_id', household.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    registration = data as Registration | null
  }

  if (!registration) {
    redirect(`/feiseanna/${id}`)
  }

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="feis-card p-8">
          <StatusDisplay registration={registration} />

          <div className="mt-8 flex justify-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
            >
              Go to Dashboard
            </Link>
            <Link
              href="/feiseanna"
              className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted"
            >
              Browse More Feiseanna
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/feiseanna/\[id\]/register/success/page.tsx
git commit -m "feat: add post-payment success page with status display and auto-refresh"
```

---

## Task 13: Transactional Email (Resend)

**Files:**
- Create: `src/lib/email/send-confirmation.ts`

- [ ] **Step 1: Install Resend SDK**

Run: `npm install resend`

- [ ] **Step 2: Create the confirmation email sender**

```typescript
// src/lib/email/send-confirmation.ts
import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export async function sendConfirmationEmail(
  registrationId: string,
  supabase: SupabaseClient
) {
  // Fetch registration with related data
  const { data: reg, error } = await supabase
    .from('registrations')
    .select(`
      *,
      feis_listings(name, feis_date, venue_name, venue_address, contact_email),
      households(user_id)
    `)
    .eq('id', registrationId)
    .single()

  if (error || !reg) {
    console.error('Failed to fetch registration for email:', error)
    return
  }

  // Get user email
  const { data: { user } } = await supabase.auth.admin.getUserById(reg.households.user_id)
  if (!user?.email) {
    console.error('No email found for user')
    return
  }

  // Get entries with dancer and competition details
  const { data: entries } = await supabase
    .from('registration_entries')
    .select(`
      *,
      dancers(first_name, last_name),
      feis_competitions(display_name)
    `)
    .eq('registration_id', registrationId)

  const feis = reg.feis_listings
  const feisDate = feis.feis_date
    ? new Date(feis.feis_date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'TBD'

  // Group entries by dancer
  const dancerEntries: Record<string, { name: string; competitions: string[] }> = {}
  for (const entry of entries ?? []) {
    const dancerName = `${entry.dancers.first_name} ${entry.dancers.last_name}`
    if (!dancerEntries[entry.dancer_id]) {
      dancerEntries[entry.dancer_id] = { name: dancerName, competitions: [] }
    }
    dancerEntries[entry.dancer_id].competitions.push(entry.feis_competitions.display_name)
  }

  // Build HTML email
  const dancerSections = Object.values(dancerEntries)
    .map(d => `
      <div style="margin-bottom: 16px;">
        <strong>${d.name}</strong>
        <ul style="margin: 4px 0 0; padding-left: 20px;">
          ${d.competitions.map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>
    `)
    .join('')

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #0B4D2C; margin-bottom: 4px;">You're registered!</h1>
      <h2 style="color: #666; font-weight: normal; margin-top: 0;">${feis.name}</h2>

      <div style="background: #EBF4EF; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
        <div style="color: #666; font-size: 14px;">Confirmation Number</div>
        <div style="font-size: 28px; font-weight: bold; color: #0B4D2C; font-family: monospace;">${reg.confirmation_number}</div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Date</td>
          <td style="padding: 8px 0; text-align: right;">${feisDate}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Venue</td>
          <td style="padding: 8px 0; text-align: right;">${feis.venue_name}${feis.venue_address ? `, ${feis.venue_address}` : ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Total Paid</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${formatCents(reg.total_cents)}</td>
        </tr>
      </table>

      <h3>Dancers & Competitions</h3>
      ${dancerSections}

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="color: #666; font-size: 14px;">
        <strong>What's next?</strong> We'll email your schedule closer to the feis date.
      </p>

      ${feis.contact_email ? `<p style="color: #666; font-size: 14px;">Questions? Contact the organiser: <a href="mailto:${feis.contact_email}">${feis.contact_email}</a></p>` : ''}

      <p style="color: #999; font-size: 12px; margin-top: 20px;">
        Sent by FeisTab — <a href="${process.env.NEXT_PUBLIC_BASE_URL}/dashboard">View your registrations</a>
      </p>
    </div>
  `

  if (!resend) {
    console.log('Resend not configured — logging email instead:')
    console.log(`To: ${user.email}`)
    console.log(`Subject: You're registered for ${feis.name}`)
    console.log('HTML length:', html.length)
    return
  }

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'FeisTab <noreply@feistab.com>',
      to: user.email,
      subject: `You're registered for ${feis.name}`,
      html,
    })
  } catch (err) {
    console.error('Failed to send email via Resend:', err)
  }
}
```

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email/send-confirmation.ts
git commit -m "feat: add confirmation email via Resend — HTML receipt with dancer/competition details"
```

---

## Task 14: Parent Dashboard

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Build the full dashboard page**

Replace the placeholder dashboard with the full registration feed:

```typescript
// src/app/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Registration, Dancer, RegistrationStatus } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

const STATUS_STYLES: Record<RegistrationStatus, { bg: string; label: string }> = {
  draft: { bg: 'bg-muted text-muted-foreground', label: 'Draft' },
  pending_payment: { bg: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
  paid: { bg: 'bg-secondary text-primary', label: 'Paid' },
  expired: { bg: 'bg-destructive/10 text-destructive', label: 'Expired' },
  cancelled: { bg: 'bg-muted text-muted-foreground', label: 'Cancelled' },
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')

  // Get dancers for filter chips
  const { data: dancers } = await supabase
    .from('dancers')
    .select('id, first_name, last_name')
    .eq('household_id', household.id)
    .eq('is_active', true)
    .order('first_name')

  // Get registrations with feis info and entries
  const { data: registrations } = await supabase
    .from('registrations')
    .select(`
      *,
      feis_listings(name, feis_date, venue_name),
      registration_entries(dancer_id, feis_competitions(display_name))
    `)
    .eq('household_id', household.id)
    .order('created_at', { ascending: false })

  const typedRegistrations = (registrations ?? []) as (Registration & {
    feis_listings: { name: string; feis_date: string; venue_name: string }
    registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
  })[]

  const typedDancers = (dancers ?? []) as Pick<Dancer, 'id' | 'first_name' | 'last_name'>[]

  const hasRegistrations = typedRegistrations.length > 0

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link
          href="/feiseanna"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
        >
          Browse Feiseanna
        </Link>
      </div>

      {/* Dancer filter chips — client component needed for filtering */}
      {typedDancers.length > 0 && hasRegistrations && (
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
            All Dancers
          </span>
          {typedDancers.map(d => (
            <span key={d.id} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {d.first_name}
            </span>
          ))}
        </div>
      )}

      {!hasRegistrations ? (
        <div className="feis-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No registrations yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse open feiseanna to get started.
          </p>
          <Link
            href="/feiseanna"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
          >
            Browse Feiseanna
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {typedRegistrations.map(reg => {
            const status = STATUS_STYLES[reg.status]
            const dancerIds = [...new Set(reg.registration_entries.map(e => e.dancer_id))]
            const dancerNames = dancerIds
              .map(id => typedDancers.find(d => d.id === id))
              .filter(Boolean)
              .map(d => d!.first_name)

            return (
              <div key={reg.id} className="feis-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{reg.feis_listings.name}</h3>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {formatDate(reg.feis_listings.feis_date)} &middot; {reg.feis_listings.venue_name}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {dancerNames.join(', ')} &middot; {reg.registration_entries.length} competition{reg.registration_entries.length !== 1 ? 's' : ''}
                    </p>
                    {reg.confirmation_number && (
                      <p className="mt-1 font-mono text-sm font-medium text-primary">
                        {reg.confirmation_number}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {reg.status === 'paid' && (
                      <div className="font-semibold">{formatCents(reg.total_cents)}</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex gap-3">
                  {reg.status === 'paid' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register/success?session_id=${reg.stripe_checkout_session_id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      View Details
                    </Link>
                  )}
                  {reg.status === 'draft' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register?step=3`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Continue Registration
                    </Link>
                  )}
                  {reg.status === 'expired' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Register Again
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: add parent dashboard — registration feed with status badges and confirmation numbers"
```

---

## Task 15: Organiser Entries Tab

**Files:**
- Modify: `src/app/organiser/feiseanna/[id]/page.tsx`

- [ ] **Step 1: Add Entries tab to the feis dashboard**

Modify the existing feis dashboard page to add an "Entries" tab. The entries tab shows:

1. **Summary header:**
   - Total dancers registered
   - Total entries (sum of competition entries)
   - Revenue collected (sum of `total_cents` for paid registrations)
   - Pending registrations count

2. **Entries table:**
   - Columns: Dancer Name, School, Competitions, Payment Status, Registration Date
   - Filtering by payment status (All / Paid / Pending / Expired)
   - Search by dancer name

3. **CSV export button:**
   - Generates CSV with columns: `dancer_first_name`, `dancer_last_name`, `date_of_birth`, `gender`, `age_group`, `school_name`, `competition_display_name`, `competition_code`, `fee_category`, `payment_status`, `registration_date`, `confirmation_number`

**Data access:** The entries query uses `service_role` via a Server Action to limit what organiser sees (name + school only, not full dancer profiles). Add this Server Action to `src/app/organiser/feiseanna/actions.ts`:

```typescript
export async function getFeisEntries(feisListingId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify the user owns this listing
  const { data: listing } = await supabase
    .from('feis_listings')
    .select('id')
    .eq('id', feisListingId)
    .eq('created_by', user.id)
    .single()

  if (!listing) return { error: 'Listing not found or not authorized' }

  // Fetch entries with dancer name + school only
  const { data: entries, error } = await supabase
    .from('registration_entries')
    .select(`
      id,
      fee_category,
      base_fee_cents,
      late_fee_cents,
      created_at,
      dancers(first_name, last_name, school_name, date_of_birth, gender),
      feis_competitions(display_name, display_code, age_group_key),
      registrations!inner(
        status,
        confirmation_number,
        total_cents,
        created_at
      )
    `)
    .eq('registrations.feis_listing_id', feisListingId)

  if (error) {
    console.error('Failed to fetch entries:', error)
    return { error: 'Failed to fetch entries' }
  }

  // Fetch summary stats
  const { data: stats } = await supabase
    .from('registrations')
    .select('status, total_cents')
    .eq('feis_listing_id', feisListingId)

  const paidRegs = (stats ?? []).filter(s => s.status === 'paid')
  const pendingRegs = (stats ?? []).filter(s => s.status === 'pending_payment' || s.status === 'draft')

  return {
    entries: entries ?? [],
    summary: {
      totalDancers: new Set(entries?.map(e => `${(e.dancers as Record<string, string>).first_name}_${(e.dancers as Record<string, string>).last_name}`) ?? []).size,
      totalEntries: entries?.length ?? 0,
      revenueCents: paidRegs.reduce((sum, r) => sum + (r.total_cents ?? 0), 0),
      pendingCount: pendingRegs.length,
    },
  }
}
```

Update the TABS constant in the feis dashboard page to include `entries`:

```typescript
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'fees', label: 'Fees' },
  { key: 'entries', label: 'Entries' },
  { key: 'settings', label: 'Settings' },
] as const
```

Add the `EntriesTab` component that renders the summary header, entries table, and CSV export button. Use a client component for the CSV download functionality.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/organiser/feiseanna/\[id\]/page.tsx src/app/organiser/feiseanna/actions.ts
git commit -m "feat: add organiser entries tab — summary stats, entries table, CSV export"
```

---

## Task 16: Final Verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (existing + new).

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 4: Manual end-to-end test checklist**

1. **Signup + onboarding:** Create account → verify email → see intent picker
2. **Parent path:** Choose "Register a dancer" → household created → redirect to add dancer
3. **Add dancer:** Fill in details, set default level, save → dancer appears in list
4. **Edit dancer:** Change per-dance levels → levels update independently
5. **Browse feiseanna:** Visit `/feiseanna` (no login) → see open feiseanna cards
6. **Feis detail:** Click a feis → see details, fees, competition list
7. **Eligibility preview (logged in):** Select a dancer → see eligible competitions highlighted
8. **Registration Step 1:** Click "Register" → select dancers → proceed
9. **Registration Step 2:** See eligible competitions per dancer → toggle competitions → running total updates
10. **Registration Step 3:** Review summary → check consent → click Pay → redirect to Stripe
11. **After payment (Stripe test):** Webhook fires → registration marked paid → confirmation number generated → email sent
12. **Success page:** Shows confirmation number or "Processing..."
13. **Parent dashboard:** Shows registration card with status badge, confirmation number, and action links
14. **Multi-dancer family:** 2+ dancers in one registration → correct fees and family cap
15. **Organiser entries view:** Visit feis dashboard → Entries tab → see summary stats and entries table
16. **CSV export:** Click download → CSV generated with correct columns
17. **Capacity hold:** Wait 30 minutes → verify expiry and ability to re-register
18. **Page refresh during Step 3:** Draft is reused, not duplicated
19. **Stripe cancellation:** Return to review page with cart intact
20. **Mobile flow:** Complete registration on phone-sized viewport
21. **Account with both roles:** Create a feis + register a dancer → verify Parent/Organiser toggle works

- [ ] **Step 5: Commit any final fixes**

```bash
git commit -m "fix: final adjustments from end-to-end testing"
```

---

## CLAUDE.md Updates (After Implementation)

After all tasks are complete, update `CLAUDE.md` to reflect the new scope:

1. Update the "Scope" section:
   ```
   **Sub-project 2 is the current scope:** Parent registration portal.
   ```
2. Add new non-negotiables:
   - Registration state machine — all status changes through `canTransitionRegistration()`
   - Eligibility engine is pure — no Supabase, no side effects
   - Webhook handler is authoritative for payment status — success page is cosmetic
   - Capacity holds use `SELECT FOR UPDATE` — race condition safe
3. Add new key reference files:
   - `src/lib/registration-states.ts`
   - `src/lib/engine/eligibility.ts`
   - `src/app/feiseanna/[id]/register/actions.ts`
   - `src/app/api/webhooks/stripe/route.ts`
   - `src/lib/email/send-confirmation.ts`
