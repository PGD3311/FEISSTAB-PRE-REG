# Organiser Feis Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the organiser feis setup wizard — syllabus templates, fee schedules, deadlines, clone, Stripe Connect — so organisers can create feis listings ready for parent registration.

**Architecture:** This is a **separate application** from FeisTab Phase 1. New Supabase project, new GitHub repo, same Next.js + Tailwind + shadcn stack. Four tables (`feis_listings`, `fee_schedules`, `syllabus_templates`, `feis_competitions`). Three pure engine functions handle fee calculation, syllabus expansion, and listing state transitions. A 5-step wizard UI (details → syllabus → fees → deadlines → review) with clone-from-previous shortcut. Stripe Connect OAuth for payment readiness. Design tokens copied from FeisTab for visual consistency.

**Why separate:** Pre-registration handles parent accounts, child data, and payments — a different risk class from day-of operations. Separate Supabase isolates auth/RLS, migration churn, and data sensitivity. The bridge (sub-project 3) becomes an explicit contract between systems.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (Postgres — new project), Vitest, Tailwind + shadcn/ui, Stripe Connect

**Spec:** Located in the FeisTab repo at `docs/superpowers/specs/2026-03-19-organiser-feis-setup-design.md`

**Implementation notes (resolve in Task 1):**
1. Use expression-based unique index for `feis_competitions` (COALESCE for nullable columns)
2. Persist `age_cutoff_date` explicitly — derive once from `feis_date`, don't rely on null-means-default
3. Deadline timestamp semantics: registration opens/closes at start of day (00:00:00) in the listing's timezone. UI shows date pickers, stored as timestamptz.
4. Add check constraints for enum-like text columns (`sanctioning_body`, `competition_type`, `championship_key`, `fee_category`)

**Wizard routing:** Single page at `/organiser/feiseanna/[id]/setup` with client-side step state. Listing row is created in `draft` status on first save (step 1), then subsequent steps update the same row. URL stays the same — step transitions are client-side. A separate entry page at `/organiser/feiseanna/new` handles fresh-vs-clone choice, creates the draft, and redirects to `/organiser/feiseanna/[id]/setup`.

---

## File Structure

All paths are relative to the NEW repo root (e.g., `feistab-prereg/`).

### New Files

```
supabase/migrations/001_feis_setup.sql           # Schema: 4 new tables + seed templates

src/lib/types/feis-listing.ts                    # Shared types: FeisListing, FeeSchedule, etc.
src/lib/feis-listing-states.ts                   # State machine + publish prerequisites
src/lib/engine/fee-calculator.ts                 # Pure: fee schedule + entries → breakdown
src/lib/engine/syllabus-expander.ts              # Pure: template + selections → competitions

tests/engine/fee-calculator.test.ts              # Fee calculator tests
tests/engine/syllabus-expander.test.ts           # Syllabus expander tests
tests/feis-listing-states.test.ts                # State machine + prerequisite tests

src/app/layout.tsx                               # Root layout (Outfit font, design tokens)
src/app/globals.css                              # Design tokens (copied from FeisTab)
src/app/page.tsx                                 # Root redirect to /organiser/feiseanna
src/app/organiser/layout.tsx                     # Organiser section layout (nav bar)
src/app/organiser/feiseanna/page.tsx             # List all feiseanna
src/app/organiser/feiseanna/new/page.tsx         # Fresh-vs-clone entry point
src/app/organiser/feiseanna/[id]/page.tsx        # Feis dashboard (tabs)
src/app/organiser/feiseanna/[id]/setup/page.tsx  # 5-step wizard (client-side step state)
src/app/organiser/feiseanna/[id]/edit/page.tsx   # Edit feis details
src/app/organiser/feiseanna/actions.ts           # Server Actions: clone, expand syllabus, transition status

src/components/organiser/feis-wizard.tsx          # Wizard container (manages step state)
src/components/organiser/feis-wizard-step1.tsx    # Details form
src/components/organiser/feis-wizard-step2.tsx    # Syllabus editor
src/components/organiser/feis-wizard-step3.tsx    # Fee schedule form
src/components/organiser/feis-wizard-step4.tsx    # Deadlines form
src/components/organiser/feis-wizard-step5.tsx    # Review + publish
src/components/organiser/clone-picker.tsx         # Clone-from-previous dialog
src/components/organiser/syllabus-toggle.tsx      # Matrix grid (desktop) / grouped list (mobile) syllabus editor
src/components/organiser/publish-checklist.tsx    # Prerequisite checklist display

src/lib/supabase/server.ts                       # Server client (createClient)
src/lib/supabase/client.ts                       # Browser client (createClient)
src/hooks/use-supabase.ts                        # Client hook
```

### Reference Files (in FeisTab Phase 1 repo — read-only, for pattern reference)

```
feistab/src/lib/competition-states.ts   # Pattern reference for state machine
feistab/src/lib/engine/rank-judges.ts   # Pattern reference for engine code
feistab/src/app/globals.css             # Design tokens to copy
feistab/src/lib/supabase/server.ts      # Server client pattern
feistab/src/hooks/use-supabase.ts       # Client hook pattern
```

---

## Task 0: Scaffold New Project

**Files:**
- Create: new GitHub repo `feistab-prereg`
- Create: new Supabase project

- [ ] **Step 1: Create GitHub repo**

```bash
mkdir feistab-prereg && cd feistab-prereg
git init
```

- [ ] **Step 2: Scaffold Next.js app**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

- [ ] **Step 3: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest @vitejs/plugin-react
npx shadcn@latest init
```

- [ ] **Step 4: Copy design tokens from FeisTab**

Copy `src/app/globals.css` from FeisTab Phase 1 repo. Copy the Outfit font setup from `src/app/layout.tsx`. This gives the pre-reg app the same visual identity.

- [ ] **Step 5: Set up Vitest config**

Create `vitest.config.ts` matching FeisTab's config. Set up path aliases (`@/` → `src/`).

- [ ] **Step 6: Create Supabase project**

```bash
npx supabase init
```

Set up `.env.local` with the new Supabase project's URL and anon key.

- [ ] **Step 7: Set up Supabase client files**

Create `src/lib/supabase/server.ts` and `src/lib/supabase/client.ts` and `src/hooks/use-supabase.ts` following FeisTab's patterns.

- [ ] **Step 8: Create CLAUDE.md**

Copy relevant conventions from FeisTab's CLAUDE.md. Adjust scope description for pre-registration.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold feistab-prereg — Next.js 15, Supabase, FeisTab design system"
```

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/001_feis_setup.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 001_feis_setup.sql
-- Pre-registration: organiser feis setup tables

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. feis_listings — core feis record (pre-registration only)
-- ============================================================
-- Columns are nullable where the wizard builds up the listing progressively.
-- Publish prerequisites (draft → open) enforce completeness at the application level.
CREATE TABLE feis_listings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text,
  feis_date date,
  end_date date,
  venue_name text,
  venue_address text,
  contact_email text,
  contact_phone text,
  description text,
  timezone text DEFAULT 'America/New_York',
  age_cutoff_date date,
  sanctioning_body text NOT NULL DEFAULT 'CLRG'
    CHECK (sanctioning_body IN ('CLRG')),
  season_year integer,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed')),
  reg_opens_at timestamptz,
  reg_closes_at timestamptz,
  late_reg_closes_at timestamptz,
  dancer_cap integer,
  syllabus_template_id uuid,
  syllabus_snapshot jsonb,
  cloned_from uuid REFERENCES feis_listings(id),
  stripe_account_id text,
  stripe_onboarding_complete boolean NOT NULL DEFAULT false,
  stripe_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  privacy_policy_url text,
  terms_url text,
  accepted_dpa_at timestamptz,
  show_contact_publicly boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER feis_listings_updated_at
  BEFORE UPDATE ON feis_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_feis_listings_created_by ON feis_listings(created_by);
CREATE INDEX idx_feis_listings_status ON feis_listings(status);

-- ============================================================
-- 2. fee_schedules — one-to-one with feis_listings (cents)
-- ============================================================
CREATE TABLE fee_schedules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  feis_listing_id uuid NOT NULL UNIQUE REFERENCES feis_listings(id) ON DELETE CASCADE,
  event_fee_cents integer NOT NULL DEFAULT 0,
  solo_fee_cents integer NOT NULL DEFAULT 0,
  prelim_champ_fee_cents integer NOT NULL DEFAULT 0,
  open_champ_fee_cents integer NOT NULL DEFAULT 0,
  family_cap_cents integer,
  late_fee_cents integer NOT NULL DEFAULT 0,
  day_of_surcharge_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER fee_schedules_updated_at
  BEFORE UPDATE ON fee_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 3. syllabus_templates — system + custom templates
-- ============================================================
CREATE TABLE syllabus_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  template_data jsonb NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. feis_competitions — expanded syllabus (pre-reg offerings)
-- ============================================================
CREATE TABLE feis_competitions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  feis_listing_id uuid NOT NULL REFERENCES feis_listings(id) ON DELETE CASCADE,
  -- NULL for cross-age specials (e.g., Ceili). Parallels nullable dance_key for championships.
  age_group_key text,
  age_group_label text,
  age_max_jan1 integer,
  age_min_jan1 integer,
  level_key text,
  level_label text,
  dance_key text,
  dance_label text,
  competition_type text NOT NULL DEFAULT 'solo'
    CHECK (competition_type IN ('solo', 'championship', 'special', 'custom')),
  championship_key text
    CHECK (championship_key IN ('prelim', 'open') OR championship_key IS NULL),
  fee_category text NOT NULL
    CHECK (fee_category IN ('solo', 'prelim_champ', 'open_champ')),
  display_name text NOT NULL,
  display_code text,
  capacity_cap integer,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER feis_competitions_updated_at
  BEFORE UPDATE ON feis_competitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_feis_competitions_listing ON feis_competitions(feis_listing_id);

-- Expression-based unique index handles NULLs in level_key, dance_key, championship_key
-- Note: PostgREST cannot target this expression index via onConflict.
-- Bulk syllabus operations use delete-and-reinsert. Individual edits use UPDATE by primary key.
CREATE UNIQUE INDEX idx_feis_competitions_unique
  ON feis_competitions(
    feis_listing_id,
    COALESCE(age_group_key, ''),
    COALESCE(level_key, ''),
    COALESCE(dance_key, ''),
    competition_type,
    COALESCE(championship_key, '')
  );

-- ============================================================
-- 5. Seed system syllabus templates
-- ============================================================
INSERT INTO syllabus_templates (name, description, template_data, is_system) VALUES
(
  'Standard Grade Feis',
  'U6–O18, Beginner through Prizewinner. 6 solo dances. No championship.',
  '{
    "age_groups": [
      {"key":"U6","label":"Under 6","max_age_jan1":5},
      {"key":"U7","label":"Under 7","max_age_jan1":6},
      {"key":"U8","label":"Under 8","max_age_jan1":7},
      {"key":"U9","label":"Under 9","max_age_jan1":8},
      {"key":"U10","label":"Under 10","max_age_jan1":9},
      {"key":"U11","label":"Under 11","max_age_jan1":10},
      {"key":"U12","label":"Under 12","max_age_jan1":11},
      {"key":"U13","label":"Under 13","max_age_jan1":12},
      {"key":"U14","label":"Under 14","max_age_jan1":13},
      {"key":"U15","label":"Under 15","max_age_jan1":14},
      {"key":"U16","label":"Under 16","max_age_jan1":15},
      {"key":"U17","label":"Under 17","max_age_jan1":16},
      {"key":"U18","label":"Under 18","max_age_jan1":17},
      {"key":"O18","label":"18 & Over","min_age_jan1":18}
    ],
    "levels": [
      {"key":"BG","label":"Beginner","rank":1},
      {"key":"AB","label":"Advanced Beginner","rank":2},
      {"key":"NOV","label":"Novice","rank":3},
      {"key":"PW","label":"Prizewinner","rank":4}
    ],
    "dances": [
      {"key":"reel","label":"Reel","type":"light"},
      {"key":"light_jig","label":"Light Jig","type":"light"},
      {"key":"slip_jig","label":"Slip Jig","type":"light"},
      {"key":"single_jig","label":"Single Jig","type":"light"},
      {"key":"treble_jig","label":"Treble Jig","type":"heavy"},
      {"key":"hornpipe","label":"Hornpipe","type":"heavy"}
    ],
    "championship_types": [],
    "specials": []
  }'::jsonb
),
(
  'Championship Feis',
  'All of Standard Grade plus Preliminary and Open Championship.',
  '{
    "age_groups": [
      {"key":"U6","label":"Under 6","max_age_jan1":5},
      {"key":"U7","label":"Under 7","max_age_jan1":6},
      {"key":"U8","label":"Under 8","max_age_jan1":7},
      {"key":"U9","label":"Under 9","max_age_jan1":8},
      {"key":"U10","label":"Under 10","max_age_jan1":9},
      {"key":"U11","label":"Under 11","max_age_jan1":10},
      {"key":"U12","label":"Under 12","max_age_jan1":11},
      {"key":"U13","label":"Under 13","max_age_jan1":12},
      {"key":"U14","label":"Under 14","max_age_jan1":13},
      {"key":"U15","label":"Under 15","max_age_jan1":14},
      {"key":"U16","label":"Under 16","max_age_jan1":15},
      {"key":"U17","label":"Under 17","max_age_jan1":16},
      {"key":"U18","label":"Under 18","max_age_jan1":17},
      {"key":"U19","label":"Under 19","max_age_jan1":18},
      {"key":"O18","label":"18 & Over","min_age_jan1":18},
      {"key":"O21","label":"21 & Over","min_age_jan1":21}
    ],
    "levels": [
      {"key":"BG","label":"Beginner","rank":1},
      {"key":"AB","label":"Advanced Beginner","rank":2},
      {"key":"NOV","label":"Novice","rank":3},
      {"key":"PW","label":"Prizewinner","rank":4}
    ],
    "dances": [
      {"key":"reel","label":"Reel","type":"light"},
      {"key":"light_jig","label":"Light Jig","type":"light"},
      {"key":"slip_jig","label":"Slip Jig","type":"light"},
      {"key":"single_jig","label":"Single Jig","type":"light"},
      {"key":"treble_jig","label":"Treble Jig","type":"heavy"},
      {"key":"hornpipe","label":"Hornpipe","type":"heavy"},
      {"key":"st_patricks_day","label":"St. Patrick''s Day","type":"set"},
      {"key":"treble_reel","label":"Treble Reel","type":"heavy"}
    ],
    "championship_types": [
      {"key":"prelim","label":"Preliminary Championship","eligible_levels":["PW"],"fee_category":"prelim_champ"},
      {"key":"open","label":"Open Championship","eligible_levels":["PW"],"requires_championship_status":true,"fee_category":"open_champ"}
    ],
    "specials": [
      {"key":"ceili","label":"Ceili (Team)","type":"team"},
      {"key":"figure","label":"Figure Choreography","type":"team"}
    ]
  }'::jsonb
),
(
  'Full CLRG',
  'All age groups, all levels, all dances, both championship types, ceili, and figure.',
  '{
    "age_groups": [
      {"key":"U6","label":"Under 6","max_age_jan1":5},
      {"key":"U7","label":"Under 7","max_age_jan1":6},
      {"key":"U8","label":"Under 8","max_age_jan1":7},
      {"key":"U9","label":"Under 9","max_age_jan1":8},
      {"key":"U10","label":"Under 10","max_age_jan1":9},
      {"key":"U11","label":"Under 11","max_age_jan1":10},
      {"key":"U12","label":"Under 12","max_age_jan1":11},
      {"key":"U13","label":"Under 13","max_age_jan1":12},
      {"key":"U14","label":"Under 14","max_age_jan1":13},
      {"key":"U15","label":"Under 15","max_age_jan1":14},
      {"key":"U16","label":"Under 16","max_age_jan1":15},
      {"key":"U17","label":"Under 17","max_age_jan1":16},
      {"key":"U18","label":"Under 18","max_age_jan1":17},
      {"key":"U19","label":"Under 19","max_age_jan1":18},
      {"key":"O18","label":"18 & Over","min_age_jan1":18},
      {"key":"O21","label":"21 & Over","min_age_jan1":21}
    ],
    "levels": [
      {"key":"BG","label":"Beginner","rank":1},
      {"key":"AB","label":"Advanced Beginner","rank":2},
      {"key":"NOV","label":"Novice","rank":3},
      {"key":"PW","label":"Prizewinner","rank":4}
    ],
    "dances": [
      {"key":"reel","label":"Reel","type":"light"},
      {"key":"light_jig","label":"Light Jig","type":"light"},
      {"key":"slip_jig","label":"Slip Jig","type":"light"},
      {"key":"single_jig","label":"Single Jig","type":"light"},
      {"key":"treble_jig","label":"Treble Jig","type":"heavy"},
      {"key":"hornpipe","label":"Hornpipe","type":"heavy"},
      {"key":"st_patricks_day","label":"St. Patrick''s Day","type":"set"},
      {"key":"treble_reel","label":"Treble Reel","type":"heavy"}
    ],
    "championship_types": [
      {"key":"prelim","label":"Preliminary Championship","eligible_levels":["PW"],"fee_category":"prelim_champ"},
      {"key":"open","label":"Open Championship","eligible_levels":["PW"],"requires_championship_status":true,"fee_category":"open_champ"}
    ],
    "specials": [
      {"key":"ceili","label":"Ceili (Team)","type":"team"},
      {"key":"figure","label":"Figure Choreography","type":"team"}
    ]
  }'::jsonb
);

-- ============================================================
-- 6. Row Level Security
-- ============================================================
ALTER TABLE feis_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE syllabus_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE feis_competitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organisers manage own listings" ON feis_listings
  FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "Public can view open listings" ON feis_listings
  FOR SELECT USING (status = 'open');

CREATE POLICY "Fee schedules follow listing" ON fee_schedules
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));
CREATE POLICY "Public fee schedules for open listings" ON fee_schedules
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));

CREATE POLICY "System templates visible to all" ON syllabus_templates
  FOR SELECT USING (is_system = true);
CREATE POLICY "Users manage own templates" ON syllabus_templates
  FOR ALL USING (created_by = auth.uid());

CREATE POLICY "Competitions follow listing" ON feis_competitions
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));
CREATE POLICY "Public competitions for open listings" ON feis_competitions
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npx supabase db reset` to apply the migration to local Supabase.
Expected: Migration applies without errors. Tables created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/001_feis_setup.sql
git commit -m "feat: add feis setup migration — 4 new tables for pre-registration"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/lib/types/feis-listing.ts`

- [ ] **Step 1: Write the shared types file**

All types used across engine code, state machine, and UI. Reference the spec for field definitions.

```typescript
// Listing status
export type ListingStatus = 'draft' | 'open' | 'closed'

// Fee category — maps to fee_schedule columns
export type FeeCategoryType = 'solo' | 'prelim_champ' | 'open_champ'

// Competition type in syllabus
export type CompetitionType = 'solo' | 'championship' | 'special' | 'custom'

// Championship key
export type ChampionshipKey = 'prelim' | 'open'

// ─── Template data types ───

export interface AgeGroup {
  key: string
  label: string
  max_age_jan1?: number
  min_age_jan1?: number
}

export interface Level {
  key: string
  label: string
  rank: number
}

export interface Dance {
  key: string
  label: string
  type: 'light' | 'heavy' | 'set'
}

export interface ChampionshipType {
  key: string
  label: string
  eligible_levels: string[]
  requires_championship_status?: boolean
  fee_category: string
}

export interface Special {
  key: string
  label: string
  type: string
}

export interface TemplateData {
  age_groups: AgeGroup[]
  levels: Level[]
  dances: Dance[]
  championship_types: ChampionshipType[]
  specials: Special[]
}

// ─── Feis listing types ───

export interface FeisListing {
  id: string
  name: string | null
  feis_date: string | null
  end_date: string | null
  venue_name: string | null
  venue_address: string | null
  contact_email: string | null
  contact_phone: string | null
  description: string | null
  timezone: string | null
  age_cutoff_date: string | null
  sanctioning_body: string
  season_year: number | null
  status: ListingStatus
  reg_opens_at: string | null
  reg_closes_at: string | null
  late_reg_closes_at: string | null
  dancer_cap: number | null
  syllabus_template_id: string | null
  syllabus_snapshot: TemplateData | null
  cloned_from: string | null
  stripe_account_id: string | null
  stripe_onboarding_complete: boolean
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
  privacy_policy_url: string | null
  terms_url: string | null
  accepted_dpa_at: string | null
  show_contact_publicly: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Fee schedule types ───

export interface FeeSchedule {
  id: string
  feis_listing_id: string
  event_fee_cents: number
  solo_fee_cents: number
  prelim_champ_fee_cents: number
  open_champ_fee_cents: number
  family_cap_cents: number | null
  late_fee_cents: number
  day_of_surcharge_cents: number
}

// ─── Fee calculator types ───

export interface FeeEntry {
  dancer_id: string
  fee_category: FeeCategoryType
  is_late: boolean
  is_day_of: boolean
}

export interface FeeLineItem {
  dancer_id: string
  base_fee_cents: number
  late_fee_cents: number
  day_of_surcharge_cents: number
  line_total_cents: number
}

export interface FeeBreakdown {
  line_items: FeeLineItem[]
  event_fee_cents: number
  subtotal_per_dancer: Record<string, number>
  subtotal_before_cap_cents: number
  family_cap_applied: boolean
  grand_total_cents: number
}

// ─── Syllabus expander types ───

export interface SyllabusSelection {
  enabled_age_groups: string[]
  enabled_levels: string[]
  enabled_dances: string[]
  enable_prelim: boolean
  prelim_age_groups: string[]
  enable_open: boolean
  open_age_groups: string[]
  enable_specials: string[]
}

export interface ExpandedCompetition {
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
  sort_order: number
}

// ─── State machine types ───

export interface PublishValidation {
  blocks: string[]
  warnings: string[]
}

export interface ListingTransitionContext {
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  enabledCompetitions: {
    competition_type: CompetitionType
    championship_key: ChampionshipKey | null
    fee_category: FeeCategoryType
  }[]
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/feis-listing.ts
git commit -m "feat: add shared types for feis listing, fees, syllabus, state machine"
```

---

## Task 3: Feis Listing State Machine (TDD)

**Files:**
- Create: `src/lib/feis-listing-states.ts`
- Create: `tests/feis-listing-states.test.ts`

Follow the pattern in `src/lib/competition-states.ts`.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import {
  canTransitionListing,
  getNextListingStates,
  getListingTransitionBlockReasons
} from '@/lib/feis-listing-states'
import type { ListingTransitionContext, FeisListing, FeeSchedule } from '@/lib/types/feis-listing'

// Helper to build a minimal valid listing for publish
function validListing(overrides: Partial<FeisListing> = {}): FeisListing {
  return {
    id: 'test-id',
    name: 'Test Feis 2026',
    feis_date: '2026-06-15',
    end_date: null,
    venue_name: 'Community Hall',
    venue_address: '123 Main St',
    contact_email: 'org@test.com',
    contact_phone: null,
    description: null,
    timezone: 'America/New_York',
    age_cutoff_date: '2026-01-01',
    sanctioning_body: 'CLRG',
    season_year: 2026,
    status: 'draft',
    reg_opens_at: '2026-04-01T00:00:00Z',
    reg_closes_at: '2026-06-01T00:00:00Z',
    late_reg_closes_at: null,
    dancer_cap: null,
    syllabus_template_id: null,
    syllabus_snapshot: null,
    cloned_from: null,
    stripe_account_id: 'acct_123',
    stripe_onboarding_complete: true,
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    privacy_policy_url: 'https://example.com/privacy',
    terms_url: null,
    accepted_dpa_at: null,
    show_contact_publicly: true,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

function validFeeSchedule(): FeeSchedule {
  return {
    id: 'fee-id',
    feis_listing_id: 'test-id',
    event_fee_cents: 2500,
    solo_fee_cents: 1300,
    prelim_champ_fee_cents: 5500,
    open_champ_fee_cents: 6000,
    family_cap_cents: 15000,
    late_fee_cents: 2500,
    day_of_surcharge_cents: 5000
  }
}

function validContext(overrides: Partial<ListingTransitionContext> = {}): ListingTransitionContext {
  return {
    listing: validListing(),
    feeSchedule: validFeeSchedule(),
    enabledCompetitions: [
      { competition_type: 'solo', championship_key: null, fee_category: 'solo' }
    ],
    ...overrides
  }
}

describe('canTransitionListing', () => {
  it('allows draft → open', () => {
    expect(canTransitionListing('draft', 'open')).toBe(true)
  })

  it('allows open → closed', () => {
    expect(canTransitionListing('open', 'closed')).toBe(true)
  })

  it('allows closed → open (reopen)', () => {
    expect(canTransitionListing('closed', 'open')).toBe(true)
  })

  it('rejects draft → closed', () => {
    expect(canTransitionListing('draft', 'closed')).toBe(false)
  })

  it('rejects open → draft', () => {
    expect(canTransitionListing('open', 'draft')).toBe(false)
  })

  it('rejects same-state transitions', () => {
    expect(canTransitionListing('draft', 'draft')).toBe(false)
    expect(canTransitionListing('open', 'open')).toBe(false)
  })
})

describe('getNextListingStates', () => {
  it('returns [open] for draft', () => {
    expect(getNextListingStates('draft')).toEqual(['open'])
  })

  it('returns [closed] for open', () => {
    expect(getNextListingStates('open')).toEqual(['closed'])
  })

  it('returns [open] for closed', () => {
    expect(getNextListingStates('closed')).toEqual(['open'])
  })
})

describe('getListingTransitionBlockReasons (returns PublishValidation { blocks, warnings })', () => {
  it('returns empty blocks and warnings when all prerequisites met', () => {
    const result = getListingTransitionBlockReasons('draft', 'open', validContext())
    expect(result.blocks).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('blocks publish when name is missing', () => {
    const ctx = validContext({ listing: validListing({ name: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.length).toBeGreaterThan(0)
    expect(result.blocks.some(r => r.toLowerCase().includes('name'))).toBe(true)
  })

  it('blocks publish when feis_date is missing', () => {
    const ctx = validContext({ listing: validListing({ feis_date: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('date'))).toBe(true)
  })

  it('blocks publish when feis_date is in the past', () => {
    const ctx = validContext({ listing: validListing({ feis_date: '2020-01-01' }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('past'))).toBe(true)
  })

  it('blocks publish when venue is missing', () => {
    const ctx = validContext({ listing: validListing({ venue_name: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('venue'))).toBe(true)
  })

  it('blocks publish when contact email is missing', () => {
    const ctx = validContext({ listing: validListing({ contact_email: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('contact'))).toBe(true)
  })

  it('blocks publish when timezone is missing', () => {
    const ctx = validContext({ listing: validListing({ timezone: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('timezone'))).toBe(true)
  })

  it('blocks publish when privacy_policy_url is missing', () => {
    const ctx = validContext({ listing: validListing({ privacy_policy_url: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('privacy policy'))).toBe(true)
  })

  it('blocks publish when no competitions enabled', () => {
    const ctx = validContext({ enabledCompetitions: [] })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('competition'))).toBe(true)
  })

  it('blocks publish when fee schedule is missing', () => {
    const ctx = validContext({ feeSchedule: null })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('fee'))).toBe(true)
  })

  it('blocks publish when solo competitions exist but solo fee is zero', () => {
    const ctx = validContext({
      feeSchedule: { ...validFeeSchedule(), solo_fee_cents: 0 }
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('solo fee'))).toBe(true)
  })

  it('blocks publish when championship competitions exist but champ fee is zero', () => {
    const ctx = validContext({
      enabledCompetitions: [
        { competition_type: 'championship', championship_key: 'prelim', fee_category: 'prelim_champ' }
      ],
      feeSchedule: { ...validFeeSchedule(), prelim_champ_fee_cents: 0 }
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('championship fee'))).toBe(true)
  })

  it('blocks publish when reg dates missing', () => {
    const ctx = validContext({
      listing: validListing({ reg_opens_at: null, reg_closes_at: null })
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('registration'))).toBe(true)
  })

  it('blocks publish when reg_closes_at is after feis_date', () => {
    const ctx = validContext({
      listing: validListing({ reg_closes_at: '2026-07-01T00:00:00Z' })
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('before'))).toBe(true)
  })

  it('blocks publish when reg_opens_at is after reg_closes_at', () => {
    const ctx = validContext({
      listing: validListing({
        reg_opens_at: '2026-06-05T00:00:00Z',
        reg_closes_at: '2026-04-01T00:00:00Z'
      })
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('open'))).toBe(true)
  })

  it('blocks publish when late_reg_closes_at violates ordering', () => {
    const ctx = validContext({
      listing: validListing({
        reg_closes_at: '2026-06-01T00:00:00Z',
        late_reg_closes_at: '2026-05-01T00:00:00Z'
      })
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('late'))).toBe(true)
  })

  it('blocks publish when Stripe charges not enabled', () => {
    const ctx = validContext({
      listing: validListing({ stripe_charges_enabled: false })
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('stripe'))).toBe(true)
  })

  it('blocks publish when multi-day end_date before feis_date', () => {
    const ctx = validContext({
      listing: validListing({ feis_date: '2026-06-15', end_date: '2026-06-14' })
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks.some(r => r.toLowerCase().includes('end date'))).toBe(true)
  })

  // ─── Soft warnings (do NOT block publish) ───

  it('warns when event fee is $0', () => {
    const ctx = validContext({
      feeSchedule: { ...validFeeSchedule(), event_fee_cents: 0 }
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks).toEqual([])
    expect(result.warnings.some(r => r.toLowerCase().includes('event fee'))).toBe(true)
  })

  it('warns when description is empty', () => {
    const ctx = validContext({ listing: validListing({ description: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks).toEqual([])
    expect(result.warnings.some(r => r.toLowerCase().includes('description'))).toBe(true)
  })

  it('warns when venue address is empty', () => {
    const ctx = validContext({ listing: validListing({ venue_address: null }) })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks).toEqual([])
    expect(result.warnings.some(r => r.toLowerCase().includes('address'))).toBe(true)
  })

  it('warns when reg_opens_at is in the past', () => {
    const ctx = validContext({
      listing: validListing({ reg_opens_at: '2020-01-01T00:00:00Z' })
    })
    const result = getListingTransitionBlockReasons('draft', 'open', ctx)
    expect(result.blocks).toEqual([])
    expect(result.warnings.some(r => r.toLowerCase().includes('registration opens'))).toBe(true)
  })

  it('returns empty blocks for non-draft transitions (no prerequisites)', () => {
    const result = getListingTransitionBlockReasons('open', 'closed', validContext())
    expect(result.blocks).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/feis-listing-states.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Follow the pattern in `src/lib/competition-states.ts`. The implementation should make all tests pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/feis-listing-states.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feis-listing-states.ts tests/feis-listing-states.test.ts
git commit -m "feat: add feis listing state machine with publish prerequisites"
```

---

## Task 4: Fee Calculator (TDD)

**Files:**
- Create: `src/lib/engine/fee-calculator.ts`
- Create: `tests/engine/fee-calculator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { calculateFees } from '@/lib/engine/fee-calculator'
import type { FeeSchedule, FeeEntry } from '@/lib/types/feis-listing'

const SCHEDULE: FeeSchedule = {
  id: 'fee-id',
  feis_listing_id: 'listing-id',
  event_fee_cents: 2500,
  solo_fee_cents: 1300,
  prelim_champ_fee_cents: 5500,
  open_champ_fee_cents: 6000,
  family_cap_cents: 15000,
  late_fee_cents: 2500,
  day_of_surcharge_cents: 5000
}

describe('calculateFees', () => {
  it('calculates single solo entry', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.line_items).toHaveLength(1)
    expect(result.line_items[0].base_fee_cents).toBe(1300)
    expect(result.event_fee_cents).toBe(2500)
    expect(result.grand_total_cents).toBe(3800) // 2500 + 1300
  })

  it('calculates multiple solos for one dancer', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.grand_total_cents).toBe(2500 + 3 * 1300) // 6400
    expect(result.subtotal_per_dancer['d1']).toBe(3900)
  })

  it('calculates championship fees', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'prelim_champ', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.line_items[0].base_fee_cents).toBe(5500)
    expect(result.grand_total_cents).toBe(2500 + 5500)
  })

  it('applies late fee per dancer', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: true, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: true, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    // Late fee is per dancer, not per entry
    expect(result.line_items[0].late_fee_cents).toBe(2500)
    expect(result.line_items[1].late_fee_cents).toBe(0) // only charged once per dancer
  })

  it('applies day-of surcharge per dancer', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: true }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.line_items[0].day_of_surcharge_cents).toBe(5000)
  })

  it('applies family cap', () => {
    const entries: FeeEntry[] = Array.from({ length: 15 }, (_, i) => ({
      dancer_id: `d${i % 3}`,
      fee_category: 'solo' as const,
      is_late: false,
      is_day_of: false
    }))
    const result = calculateFees(SCHEDULE, entries)
    // 2500 event + 15 * 1300 = 22000, capped at 15000
    expect(result.family_cap_applied).toBe(true)
    expect(result.grand_total_cents).toBe(15000)
    expect(result.subtotal_before_cap_cents).toBe(2500 + 15 * 1300)
  })

  it('does not apply cap when under limit', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.family_cap_applied).toBe(false)
  })

  it('handles no cap (null)', () => {
    const noCap = { ...SCHEDULE, family_cap_cents: null }
    const entries: FeeEntry[] = Array.from({ length: 20 }, () => ({
      dancer_id: 'd1',
      fee_category: 'solo' as const,
      is_late: false,
      is_day_of: false
    }))
    const result = calculateFees(noCap, entries)
    expect(result.family_cap_applied).toBe(false)
    expect(result.grand_total_cents).toBe(2500 + 20 * 1300)
  })

  it('handles empty entries (event fee only)', () => {
    const result = calculateFees(SCHEDULE, [])
    expect(result.line_items).toHaveLength(0)
    expect(result.event_fee_cents).toBe(2500)
    expect(result.grand_total_cents).toBe(2500)
  })

  it('handles zero event fee', () => {
    const noEventFee = { ...SCHEDULE, event_fee_cents: 0 }
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(noEventFee, entries)
    expect(result.event_fee_cents).toBe(0)
    expect(result.grand_total_cents).toBe(1300)
  })

  it('calculates subtotal per dancer across multiple dancers', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd2', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd2', fee_category: 'prelim_champ', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.subtotal_per_dancer['d1']).toBe(2600) // 2 * 1300
    expect(result.subtotal_per_dancer['d2']).toBe(6800) // 1300 + 5500
  })

  it('uses integer math only — no floating point', () => {
    const oddSchedule = { ...SCHEDULE, solo_fee_cents: 1333 }
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(oddSchedule, entries)
    expect(Number.isInteger(result.grand_total_cents)).toBe(true)
    expect(result.grand_total_cents).toBe(2500 + 3 * 1333) // 6499
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/fee-calculator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Pure function, integer math, no imports beyond types. Follow the pattern in `src/lib/engine/rank-judges.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/fee-calculator.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/fee-calculator.ts tests/engine/fee-calculator.test.ts
git commit -m "feat: add fee calculator engine — integer math, family cap, late/day-of fees"
```

---

## Task 5: Syllabus Expander (TDD)

**Files:**
- Create: `src/lib/engine/syllabus-expander.ts`
- Create: `tests/engine/syllabus-expander.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { expandSyllabus } from '@/lib/engine/syllabus-expander'
import type { TemplateData, SyllabusSelection } from '@/lib/types/feis-listing'

const TEMPLATE: TemplateData = {
  age_groups: [
    { key: 'U8', label: 'Under 8', max_age_jan1: 7 },
    { key: 'U9', label: 'Under 9', max_age_jan1: 8 },
    { key: 'U10', label: 'Under 10', max_age_jan1: 9 }
  ],
  levels: [
    { key: 'BG', label: 'Beginner', rank: 1 },
    { key: 'AB', label: 'Advanced Beginner', rank: 2 }
  ],
  dances: [
    { key: 'reel', label: 'Reel', type: 'light' },
    { key: 'light_jig', label: 'Light Jig', type: 'light' }
  ],
  championship_types: [
    { key: 'prelim', label: 'Preliminary Championship', eligible_levels: ['PW'], fee_category: 'prelim_champ' }
  ],
  specials: [
    { key: 'ceili', label: 'Ceili (Team)', type: 'team' }
  ]
}

describe('expandSyllabus', () => {
  it('generates all combinations for full selection', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8', 'U9', 'U10'],
      enabled_levels: ['BG', 'AB'],
      enabled_dances: ['reel', 'light_jig'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    // 3 ages × 2 levels × 2 dances = 12 solo competitions
    expect(result).toHaveLength(12)
    expect(result.every(r => r.competition_type === 'solo')).toBe(true)
  })

  it('generates correct display names', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8'],
      enabled_levels: ['BG'],
      enabled_dances: ['reel'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(1)
    expect(result[0].display_name).toBe('U8 Beginner Reel')
  })

  it('freezes eligibility data on each row', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8'],
      enabled_levels: ['BG'],
      enabled_dances: ['reel'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result[0].age_group_key).toBe('U8')
    expect(result[0].age_group_label).toBe('Under 8')
    expect(result[0].age_max_jan1).toBe(7)
    expect(result[0].age_min_jan1).toBeNull()
    expect(result[0].level_key).toBe('BG')
    expect(result[0].level_label).toBe('Beginner')
    expect(result[0].fee_category).toBe('solo')
  })

  it('handles partial age group selection', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8'],
      enabled_levels: ['BG', 'AB'],
      enabled_dances: ['reel', 'light_jig'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(4) // 1 age × 2 levels × 2 dances
    expect(result.every(r => r.age_group_key === 'U8')).toBe(true)
  })

  it('generates championship rows', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: [],
      enabled_levels: [],
      enabled_dances: [],
      enable_prelim: true,
      prelim_age_groups: ['U10'],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(1)
    expect(result[0].competition_type).toBe('championship')
    expect(result[0].championship_key).toBe('prelim')
    expect(result[0].dance_key).toBeNull()
    expect(result[0].fee_category).toBe('prelim_champ')
    expect(result[0].display_name).toBe('U10 Preliminary Championship')
  })

  it('generates special rows with null age_group_key', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: [],
      enabled_levels: [],
      enabled_dances: [],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: ['ceili']
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(1)
    expect(result[0].competition_type).toBe('special')
    expect(result[0].age_group_key).toBeNull()
    expect(result[0].age_group_label).toBeNull()
    expect(result[0].display_name).toBe('Ceili (Team)')
  })

  it('returns empty array for empty selection', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: [],
      enabled_levels: [],
      enabled_dances: [],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(0)
  })

  it('assigns deterministic sort order', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8', 'U9'],
      enabled_levels: ['BG'],
      enabled_dances: ['reel', 'light_jig'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    const orders = result.map(r => r.sort_order)
    // Sort orders should be strictly increasing
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1])
    }
  })

  it('combines solos + championships + specials', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8'],
      enabled_levels: ['BG'],
      enabled_dances: ['reel'],
      enable_prelim: true,
      prelim_age_groups: ['U10'],
      enable_open: false,
      open_age_groups: [],
      enable_specials: ['ceili']
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(3) // 1 solo + 1 champ + 1 special
    expect(result.filter(r => r.competition_type === 'solo')).toHaveLength(1)
    expect(result.filter(r => r.competition_type === 'championship')).toHaveLength(1)
    expect(result.filter(r => r.competition_type === 'special')).toHaveLength(1)
  })

  it('ignores unknown keys in selection', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U99'],
      enabled_levels: ['FAKE'],
      enabled_dances: ['tango'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/syllabus-expander.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Pure function, no side effects. Takes template data + selection, returns expanded competitions with frozen eligibility data.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/syllabus-expander.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/syllabus-expander.ts tests/engine/syllabus-expander.test.ts
git commit -m "feat: add syllabus expander engine — template + selections → frozen competitions"
```

---

## Task 6: Freezing & Isolation Tests (TDD)

**Files:**
- Modify: `tests/engine/syllabus-expander.test.ts`

The spec requires testing that frozen snapshots and clones produce independent data. The pure-function tests can verify the expander returns new objects. DB-level clone isolation is deferred to manual testing (Task 15).

- [ ] **Step 1: Add freezing tests to syllabus expander test file**

```typescript
describe('freezing behavior', () => {
  it('returns new objects not referencing input template', () => {
    const template = structuredClone(TEMPLATE)
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8'],
      enabled_levels: ['BG'],
      enabled_dances: ['reel'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(template, selection)

    // Mutate the original template
    template.age_groups[0].label = 'MUTATED'
    template.levels[0].label = 'MUTATED'

    // Result should be unaffected
    expect(result[0].age_group_label).toBe('Under 8')
    expect(result[0].level_label).toBe('Beginner')
  })

  it('produces independent results on repeated calls', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8'],
      enabled_levels: ['BG'],
      enabled_dances: ['reel'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result1 = expandSyllabus(TEMPLATE, selection)
    const result2 = expandSyllabus(TEMPLATE, selection)

    // Results should be equal but not the same reference
    expect(result1).toEqual(result2)
    expect(result1).not.toBe(result2)
    expect(result1[0]).not.toBe(result2[0])
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/engine/syllabus-expander.test.ts`
Expected: All tests PASS (implementation should already handle this if it copies data correctly).

- [ ] **Step 3: Commit**

```bash
git add tests/engine/syllabus-expander.test.ts
git commit -m "test: add freezing/isolation tests for syllabus expander"
```

---

## Task 7: Run All Tests + Build (Checkpoint)

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

## Task 8: Organiser Layout + Feiseanna List Page

**Files:**
- Create: `src/app/organiser/layout.tsx`
- Create: `src/app/organiser/feiseanna/page.tsx`

- [ ] **Step 1: Create the organiser layout**

Simple layout with nav bar for the organiser section. Server component. Use FeisTab design system (feis-green, Outfit font, flat panels).

Layout should include a top nav with "FeisTab" logo link and "Organiser" section label. Use existing `feis-nav-accent` class pattern.

- [ ] **Step 2: Create the feiseanna list page**

Server component with `export const dynamic = 'force-dynamic'`. Fetches all `feis_listings` ordered by `feis_date DESC`. Shows:
- Name, date, status badge (Draft/Open/Closed)
- "New Feis" button linking to `/organiser/feiseanna/new`
- Each row links to `/organiser/feiseanna/[id]`

Use `createClient()` from `src/lib/supabase/server.ts`. Check `.error` on Supabase response.

- [ ] **Step 3: Verify page renders**

Run: `npm run dev` and visit `http://localhost:3000/organiser/feiseanna`
Expected: Page renders (empty list or with any test data).

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/organiser/layout.tsx src/app/organiser/feiseanna/page.tsx
git commit -m "feat: add organiser layout and feiseanna list page"
```

---

## Task 9: Wizard Step 1 — Feis Details

**Files:**
- Create: `src/app/organiser/feiseanna/new/page.tsx`
- Create: `src/app/organiser/feiseanna/[id]/setup/page.tsx`
- Create: `src/components/organiser/feis-wizard.tsx`
- Create: `src/components/organiser/feis-wizard-step1.tsx`
- Create: `src/components/organiser/clone-picker.tsx`

- [ ] **Step 1: Create the entry page (fresh vs clone)**

Server component at `/organiser/feiseanna/new`. Shows two options: "Start Fresh" and "Clone Previous Feis". Clone picker loads existing listings. Both paths create a draft `feis_listings` row and redirect to `/organiser/feiseanna/[id]/setup`.

- [ ] **Step 2: Create the wizard container**

Client component `feis-wizard.tsx`. Manages step state (1–5) with client-side navigation. Renders the current step component. Shows the step indicator bar at the top. Receives the listing ID as a prop.

- [ ] **Step 3: Create the wizard setup page**

Server component at `/organiser/feiseanna/[id]/setup`. Fetches the listing, fee_schedule, and feis_competitions from Supabase. Passes data to the `feis-wizard` client component.

- [ ] **Step 4: Create Step 1 form component**

Client component (`'use client'`). Fields: name, feis_date, end_date (toggle), venue_name, venue_address, contact_email, contact_phone, description, timezone (auto-detected via `Intl.DateTimeFormat().resolvedOptions().timeZone`).

On save: updates `feis_listings` row, auto-derives `age_cutoff_date` as Jan 1 of feis_date year, auto-derives `season_year`. Advances to step 2 in client state.

- [ ] **Step 5: Create clone picker component**

Client component. Lists previous feis listings. On select: calls the `cloneFeis()` Server Action (in `src/app/organiser/feiseanna/actions.ts`) which deep-copies listing + fee_schedule + feis_competitions into new rows server-side, increments year in name, clears dates. Redirects to `/organiser/feiseanna/[newId]/setup`.

- [ ] **Step 6: Test manually**

Visit `/organiser/feiseanna/new`, fill in details, save. Verify draft listing appears in feiseanna list.

- [ ] **Step 7: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/organiser/feiseanna/new/ src/app/organiser/feiseanna/\[id\]/setup/ src/components/organiser/feis-wizard.tsx src/components/organiser/feis-wizard-step1.tsx src/components/organiser/clone-picker.tsx
git commit -m "feat: add wizard entry point, container, step 1 — feis details + clone picker"
```

---

## Task 10: Wizard Step 2 — Syllabus Editor

**Files:**
- Create: `src/components/organiser/feis-wizard-step2.tsx`
- Create: `src/components/organiser/syllabus-toggle.tsx`

- [ ] **Step 1: Create Step 2 page/component**

Loads syllabus templates from Supabase. If listing has no syllabus yet, show template picker. If listing already has syllabus (clone path), show existing competitions.

- [ ] **Step 2: Create syllabus toggle component**

Client component. Responsive syllabus editor:
- **Desktop (>=768px): Matrix grid** — rows = dances, columns = age groups. Row header toggles enable/disable all competitions for that dance. Column header toggles enable/disable all competitions for that age group. Cell click toggles individual competition. Bulk operations via header toggles.
- **Mobile (<768px): Grouped list** with expand/collapse per dance type. Each section shows competitions grouped by dance with enable/disable toggles and capacity cap inputs.
- **Championship section:** separate toggles for Prelim/Open with age group selectors.
- **Specials:** ceili, figure toggles.
- **Custom competitions:** An "Add Custom Competition" button at the bottom of the syllabus editor allows organizers to manually add competitions that don't come from the template (charity dances, exhibition, non-standard categories). Inserts a `feis_competitions` row with `competition_type = 'custom'` and freetext `display_name`. This is an advanced escape hatch, not the primary workflow.

Checking/unchecking re-runs `expandSyllabus()` client-side to preview changes.

On template selection: freeze `template_data` into `syllabus_snapshot` on the listing. Call `expandSyllabus()` client-side to preview the competition list.

On save: call the `expandAndSaveSyllabus()` Server Action (in `src/app/organiser/feiseanna/actions.ts`) which runs `expandSyllabus()` server-side, then does a delete-and-reinsert of all `feis_competitions` rows for this listing within a single operation. Navigate to step 3.

- [ ] **Step 3: Test manually**

Pick a template, toggle age groups/levels, verify competition count updates. Drill into individual competitions.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/organiser/feis-wizard-step2.tsx src/components/organiser/syllabus-toggle.tsx
git commit -m "feat: add wizard step 2 — syllabus template picker + toggle editor"
```

---

## Task 11: Wizard Step 3 — Fee Schedule

**Files:**
- Create: `src/components/organiser/feis-wizard-step3.tsx`

- [ ] **Step 1: Create fee schedule form**

Client component. Standard form with labeled dollar inputs for each fee category. Shows "Typical: $X–Y" hints. Input as dollars (with `$` prefix), convert to cents on save via `Math.round(parseFloat(value) * 100)`.

On save: upsert `fee_schedules` row for this listing. Navigate to step 4.

Family cap field is optional (leave blank for no cap).

- [ ] **Step 2: Test manually**

Fill in fees, save, verify values persist when navigating back.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/organiser/feis-wizard-step3.tsx
git commit -m "feat: add wizard step 3 — fee schedule form"
```

---

## Task 12: Wizard Step 4 — Deadlines & Caps

**Files:**
- Create: `src/components/organiser/feis-wizard-step4.tsx`

- [ ] **Step 1: Create deadlines form**

Client component. Date pickers for reg_opens_at, reg_closes_at, late_reg_closes_at (optional). Dancer cap input (optional).

Smart defaults: reg_opens_at = 8 weeks before feis_date, reg_closes_at = 2 weeks before, late_reg_closes_at = 1 week before.

**Date ordering validation in UI:** prevent reg_opens_at >= reg_closes_at, late_reg_closes_at <= reg_closes_at, etc. Show inline error messages.

**Timestamp semantics decision:** Registration opens/closes at start of day (00:00:00) in the listing's timezone. The UI shows date pickers (not datetime). Stored as timestamptz using the listing's timezone.

On save: update `feis_listings` row. Navigate to step 5.

- [ ] **Step 2: Test manually**

Set dates, verify smart defaults populate. Verify date ordering validation works.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/organiser/feis-wizard-step4.tsx
git commit -m "feat: add wizard step 4 — deadlines with date ordering validation"
```

---

## Task 13: Wizard Step 5 — Review & Publish

**Files:**
- Create: `src/components/organiser/feis-wizard-step5.tsx`
- Create: `src/components/organiser/publish-checklist.tsx`

- [ ] **Step 1: Create review summary component**

Client component. Shows read-only summary of all wizard steps: details, syllabus stats, fee table, deadlines, Stripe status.

- [ ] **Step 2: Create publish checklist component**

Uses `getListingTransitionBlockReasons()` to show pass/fail checklist. Green check for met prerequisites, red X for missing ones with human-readable messages.

- [ ] **Step 3: Add Stripe Connect button**

"Connect Stripe Account" button. For now, this can be a placeholder that sets `stripe_charges_enabled = true` on the listing (real Account Links integration will be wired later when we have Stripe API keys).

**Important:** The Stripe Connect Account Links flow requires server-side API keys and redirect URLs. For the prototype, implement a "Simulate Stripe Connect" button that marks the account as connected. Add a `// TODO: Replace with real Stripe Connect Account Links` comment. The real integration will use `stripe.accountLinks.create()` for the redirect and a callback route to capture the connected account ID and verify status. Note: `return_url` does NOT mean onboarding is complete — always check `charges_enabled` and `payouts_enabled` on the account object.

- [ ] **Step 4: Add publish button**

Calls `canTransitionListing('draft', 'open')` first for client-side validation. If allowed, calls the `transitionListingStatus()` Server Action (in `src/app/organiser/feiseanna/actions.ts`) which re-validates server-side and updates listing status to `open`. Shows success toast. Redirects to feis dashboard.

- [ ] **Step 5: Test manually**

Complete all wizard steps. Verify checklist shows all green. Publish. Verify listing status changes to `open`.

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/organiser/feis-wizard-step5.tsx src/components/organiser/publish-checklist.tsx
git commit -m "feat: add wizard step 5 — review, publish checklist, Stripe placeholder"
```

---

## Task 14: Feis Dashboard Page

**Files:**
- Create: `src/app/organiser/feiseanna/[id]/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Server component with `force-dynamic`. Fetches listing + fee_schedule + feis_competitions count. Shows tabbed interface:

- **Overview tab:** Feis details summary, status badge, quick actions (Open/Close Registration buttons using state machine).
- **Syllabus tab:** Reuses `syllabus-toggle.tsx` in edit mode. Editing allowed when status is `draft`. Read-only when `open` or `closed`.
- **Fees tab:** Reuses `feis-wizard-step3.tsx`. Same edit rules.
- **Settings tab:** Deadlines, Stripe status display, "Delete Draft" button (only for draft status).

Use `feis-segmented-bar` and `feis-segmented-tab` classes for the tab navigation (existing pattern in globals.css).

- [ ] **Step 2: Test manually**

Navigate to a created feis. Verify tabs work. Verify status transitions (open → closed, closed → open).

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/organiser/feiseanna/\[id\]/page.tsx
git commit -m "feat: add feis dashboard with tabs — overview, syllabus, fees, settings"
```

---

## Task 15: Edit Feis Details Page

**Files:**
- Create: `src/app/organiser/feiseanna/[id]/edit/page.tsx`

- [ ] **Step 1: Create the edit page**

Reuses `feis-wizard-step1.tsx` in edit mode (pre-populated from existing listing). When status is `open`, show a warning banner: "This feis has published registration. Changes to date or venue will affect registered families."

On save: update listing, redirect to dashboard.

- [ ] **Step 2: Test manually**

Edit a draft listing. Edit an open listing (verify warning). Verify changes persist.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/organiser/feiseanna/\[id\]/edit/page.tsx
git commit -m "feat: add edit feis details page with open-listing warning"
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

- [ ] **Step 4: Manual end-to-end test**

1. Visit `/organiser/feiseanna` — empty list
2. Click "New Feis" → start fresh
3. Fill in details (step 1) → save as draft
4. Pick template, toggle competitions (step 2) → save
5. Set fees (step 3) → save
6. Set deadlines (step 4) → save
7. Review (step 5) → connect Stripe (placeholder) → publish
8. Verify listing shows status "Open" in list
9. Visit dashboard → verify tabs work
10. Close registration → verify status changes
11. Reopen → verify status changes back to Open
12. Go back to list → clone the feis → verify all data copies
13. Verify cloned feis is independent (edit clone, check original unchanged)

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final adjustments from end-to-end testing"
```

---

## Design Notes for Sub-Projects 2 and 3

These are NOT implementation tasks for this plan. They are documented decisions that prevent schema rework later.

- **"Register Again" matching:** Parent portal matches entries to competitions via composite key `(age_group_key, level_key, dance_key, competition_type)`, not `feis_competitions.id`.
- **Capacity race conditions:** Hold/timer pattern (15-min holds, `SELECT FOR UPDATE`) — capacity_cap column provides the ceiling.
- **Deadline semantics:** Date pickers produce dates stored as end-of-day (23:59:59) in listing's timezone.
- **Grace period:** 15-minute grace for in-progress registrations at deadline cutoff.
- **Template-defined levels:** `expandSyllabus()` treats levels as template data, not system constants. Enables future WIDA/An Coimisiun templates.
- **Data portability:** Clean table structure enables CSV/JSON export of all organiser data.
