# The Bridge — "Launch Feis Day" Design Spec

## What This Is

The one-way handoff from pre-registration to competition day. When registration closes and the organiser is ready, they click one button and competition-day rosters flow into FeisTab Phase 1. Pre-reg becomes read-only archive. Phase 1 becomes the live operational truth.

## State Model

Pre-reg listing lifecycle:

```
draft → open → closed → launched
```

`launched` is a new terminal state meaning:
- Registration data has been instantiated into Phase 1
- Pre-reg listing is read-only (archive/reference)
- Phase 1 event is the live truth

### Listing Fields Added

| Field | Type | Purpose |
|---|---|---|
| `launched_at` | timestamptz | When the bridge was executed |
| `launched_event_id` | text | The Phase 1 event UUID (cross-project reference) |

## Launch Prerequisites

Before "Launch Feis Day" can execute, validate:

1. **Status is `closed`** — registration period is over
2. **All registrations settled** — no `draft` or `pending_payment` status (only `paid`, `expired`, `cancelled`)
3. **No dangling holds** — all `hold_expires_at` either null or expired
4. **Has paid registrations** — at least one `paid` registration exists (don't launch an empty event)

## Data Mapping

| Pre-Reg (source) | Phase 1 (target) | Notes |
|---|---|---|
| `feis_listings` | `events` | name, feis_date→start_date, end_date, venue→location |
| `feis_competitions` (enabled) | `competitions` | display_name→name, display_code→code, age_group, level. Status = `imported`. |
| `dancers` (from paid entries) | `dancers` | first_name, last_name, date_of_birth, school_name. Dedup on name+school. |
| `registration_entries` (paid) | `registrations` | dancer_id→dancer_id, competition_id→competition_id. Status = `registered`. |

### Dancer Dedup

Phase 1 `dancers` table has a unique index on `(first_name, last_name, coalesce(school_name, ''))`. On insert conflict, use the existing dancer ID. This handles dancers who already exist from previous events.

### Competition Code

Phase 1 `competitions.code` maps to the syllabus number. Use `feis_competitions.display_name` as the competition name. The `age_group` and `level` fields map directly.

## Execution Flow

```
Organiser clicks "Launch Feis Day"
  → Client confirms: "This will create the competition day event. Registration will be locked. Continue?"
  → Server Action: launchFeisDay(feisListingId)
    1. Validate prerequisites (status, registrations, holds)
    2. Fetch all paid registration data (entries + dancers + competitions)
    3. Connect to Phase 1 Supabase (service_role key)
    4. Create event
    5. Create competitions (batch upsert)
    6. Create/dedup dancers (batch upsert with ON CONFLICT)
    7. Create registrations (batch insert)
    8. If any Phase 1 write fails → return error, do NOT mark as launched
    9. If all succeed → update pre-reg listing:
       - status = 'launched'
       - launched_at = now()
       - launched_event_id = Phase 1 event UUID
    10. Return success with link to Phase 1 event
```

## After Launch

- **Pre-reg side:** Listing shows "Launched" badge. All edit/clone/delete actions disabled. Read-only view of registrations for reference.
- **Phase 1 side:** Event appears in dashboard. Organiser proceeds with check-in → scoring → tabulation → results.
- **Walk-ins:** Added directly in Phase 1 as `source: walk_in` or manual entries. Pre-reg is never reopened.

## Cross-Project Connection

- Pre-reg Supabase: `vwfrmhbczwpvqonlpfzs`
- Phase 1 Supabase: `acxyvouzwgvobtbmvoej`
- Bridge uses Phase 1's `SUPABASE_SERVICE_ROLE_KEY` for writes (no user auth context in Phase 1)
- New env var: `PHASE1_SUPABASE_URL` and `PHASE1_SUPABASE_SERVICE_ROLE_KEY`

## Error Handling

- If Phase 1 writes partially fail, the entire launch is aborted. No partial state.
- Pre-reg listing only transitions to `launched` after ALL Phase 1 records are confirmed created.
- Idempotency: if the listing is already `launched`, return the existing `launched_event_id`.

## Environment Variables (New)

```
PHASE1_SUPABASE_URL=https://acxyvouzwgvobtbmvoej.supabase.co
PHASE1_SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## Files

| File | Purpose |
|---|---|
| `src/app/organiser/feiseanna/[id]/launch/page.tsx` | Launch confirmation page |
| `src/app/organiser/feiseanna/actions.ts` | `launchFeisDay` server action (append) |
| `src/lib/bridge.ts` | Bridge logic — data mapping + Phase 1 writes |
| `src/lib/feis-listing-states.ts` | Add `launched` to state machine + transition |
| `supabase/migrations/004_bridge_launched_state.sql` | Add launched_at, launched_event_id columns |
