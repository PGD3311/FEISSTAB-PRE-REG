# Approval gate: a feis is listed and takes entries only after RunFeis approves it

Approved by Daniel on 2026-10-20. The design is the Claude Doc "RunFeis: making a feis official" (https://claude.ai/artifact/XrLt6GusSABZRrNvEyTTMG).

**The problem.** Today any signed-in user can set up a feis, press Publish, and start taking families' money. Nothing checks who they are or that the region sanctioned the feis.

**After this change:**
- Publish becomes "Submit for approval".
- The feis waits in a new `pending_review` status until a RunFeis admin (Daniel) approves it, or sends it back with a note.
- The database enforces this, not just the pages.

## Decisions

These are the controller's rulings where the design left details open. Steve's answers may refine the sanction fields later.

1. **Statuses.** Add `pending_review` to `feis_listings.status`.

   | From | To | Who |
   |---|---|---|
   | `draft` | `pending_review` | The owner (submit) |
   | `pending_review` | `draft` | The owner (withdraw), or an admin (send back, with a note) |
   | `pending_review` | `open` | An admin only (approve) |
   | `open` | `closed` | The owner |
   | `closed` | `open` | The owner, only if the listing was ever approved (`approved_at` is not null) |
   | `closed` | `launched` | The owner (unchanged) |

   `draft` → `open` directly is no longer allowed for anyone except through approval.
2. **New listing columns:**
   - `submitted_at timestamptz`, `approved_at timestamptz`, `approved_by uuid`, `review_note text` (the admin's note when sent back; cleared on resubmit);
   - `sanction_region text`, `sanction_reference text`, `sanction_notes text`.
3. **Who is an admin.** A new table `pre_registration.platform_admins (user_id uuid PRIMARY KEY REFERENCES auth.users)`.
   - `pre_registration.is_platform_admin()` is SECURITY DEFINER, STABLE, and returns `EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid())`.
   - It's granted to authenticated and revoked from anon and PUBLIC.
   - The table has RLS on with no policies, and no grants to anon or authenticated.
   - The migration seeds Daniel with `INSERT … SELECT id FROM auth.users WHERE email = 'walshdaniel143@gmail.com' ON CONFLICT DO NOTHING`.
4. **Organiser details.** A new table `pre_registration.organiser_profiles`, keyed by user:
   - columns: `user_id uuid PRIMARY KEY REFERENCES auth.users`, `full_name text NOT NULL`, `organisation text NOT NULL` (school or committee), `region text NOT NULL`, `phone text`, `created_at`, `updated_at`;
   - RLS: a user selects, inserts and updates only their own row; admins select all, through `is_platform_admin()`.
5. **The guard (the heart of it).** A `BEFORE INSERT OR UPDATE` trigger on `feis_listings` that applies only when `current_user IN ('anon', 'authenticated')`. Migrations, service-role code and SECURITY DEFINER functions owned by postgres pass through.
   - **INSERT:** status must be `draft`, and `approved_at`, `approved_by`, `review_note` and `submitted_at` must be null.
   - **UPDATE:** `approved_at`, `approved_by` and `review_note` can't change, except that `review_note` may be cleared on resubmit (below).
   - **A status change must be one of:**
     - `draft` → `pending_review`. This requires non-blank `sanction_region` and `sanction_reference`, and an `organiser_profiles` row for `auth.uid()`. It sets `submitted_at = now()` and clears `review_note`.
     - `pending_review` → `draft` (withdraw).
     - `open` → `closed`.
     - `closed` → `open`, only when `OLD.approved_at IS NOT NULL`.
     - `closed` → `launched`.
     - Any other status change raises a clear error.
   - **While `pending_review`, the owner can't edit the listing** (no column changes other than the withdraw). The admin reviews exactly what was submitted.
6. **Admin functions** (SECURITY DEFINER, `SET search_path = pre_registration, public`, EXECUTE granted to authenticated only; each raises unless `is_platform_admin()`):
   - `approve_listing(p_listing_id uuid)`: requires `pending_review`. Sets `status = 'open'`, `approved_at = now()`, `approved_by = auth.uid()`, `review_note = null`. Returns the row id.
   - `send_back_listing(p_listing_id uuid, p_note text)`: requires `pending_review` and a note with words in it. Sets `status = 'draft'` and `review_note = p_note`.
7. **Admins can read every listing.** Add a SELECT policy "Platform admins read all listings" using `is_platform_admin()`, and the same on `fee_schedules` and `feis_competitions`, so the admin can review fees and the syllabus.
8. **Existing listings are approved as they stand.** The migration sets `approved_at = now()` on every listing whose status is `open`, `closed` or `launched`. It runs as postgres, so the guard doesn't apply.
9. **Migration file:** `supabase/migrations/021_approval_gate.sql`. It must be re-runnable (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`) and is applied by hand in the SQL editor. It must also be added to the db-test harness's migration list.
10. **Emails** use the existing Resend setup in `src/lib/email/` and never block the action:
    - **On submit,** email the admins at `ADMIN_ALERT_EMAIL`, falling back to `PAYMENTS_ALERT_EMAIL`, with "New feis waiting for approval: <name>" and a link to `/admin/approvals`.
    - **On approve or send back,** email the organiser (the `auth.users` email of `created_by`, read with the service client) with "approved: entries open" or "sent back: <note>".
    - A send failure is logged as `[ADMIN_EMAIL_FAILED]` and not shown as an error.
11. **Region choices** for organisers and sanctions: a fixed list in code (`src/lib/regions.ts`).
    - The IDTANA regions: Mid-Atlantic, New England, Southern, Mid-America, Western, Eastern Canada, Western Canada.
    - Plus "Other (non-IDTANA)". Mid-Atlantic and New England are listed first.

## Tasks

### Task A: database and state machine

1. Write migration 021 as in Decisions 1–9.
2. Update `src/lib/types/feis-listing.ts` (`ListingStatus` gets `pending_review`, and the new columns on the listing type) and `src/lib/feis-listing-states.ts`:
   - the transitions in Decision 1;
   - the publish checks move to `draft` → `pending_review`, adding blocks for missing sanction region and reference, and for missing organiser details. The checks take a context flag `hasOrganiserProfile`.
3. **DB tests** in `tests/db/approval-gate.test.ts`, using the existing harness and helpers. Cover:
   - an owner can't insert as `open`;
   - an owner can't go `draft` → `open`;
   - submit without sanction details, or without a profile, is refused;
   - a good submit sets `submitted_at`;
   - an owner can't edit while pending;
   - withdraw works;
   - a non-admin can't call `approve_listing` or `send_back_listing`;
   - an admin approve sets `open`, `approved_at` and `approved_by`;
   - send back needs a note and sets `draft` plus the note;
   - resubmit clears the note;
   - `closed` → `open` works only when approved before;
   - anon can't read a pending listing; an admin can;
   - `platform_admins` can't be read or written by authenticated;
   - existing open listings stay readable to the public.
4. **Unit tests** for the state machine: the new transitions and the publish blocks.

### Task B: pages, admin screen and emails

1. **Organiser details page:** `/organiser/profile`. A form for full name, school or committee, region and phone, which upserts `organiser_profiles`. Link it from the organiser nav, and from the publish checklist when it's missing.
2. **Sanction details in the setup wizard's Details step:**
   - region (select from `src/lib/regions.ts`);
   - sanction reference ("The approval or permit number from your region", required to submit);
   - notes (optional).
   - Also shown and editable from the feis's Settings or Edit details, while the feis is a draft.
3. **Review step:** "Publish feis" becomes "Submit for approval". The checklist shows the new blocks. After submitting, the organiser's feis page shows "Waiting for RunFeis approval. We'll email you when it's approved." with a "Withdraw" button.
4. **Status display:**
   - **`listing-status-tag.tsx`:** add `pending_review` with the label "Waiting for approval".
   - **A draft with a `review_note`:** show a banner "Sent back by RunFeis: <note>. Fix what's needed and submit again."
   - **"Reopen entries" for `closed`:** keep it working; the DB allows it for approved listings.
5. **Admin page:** `/admin/approvals`, server-rendered.
   - **Access:** call `is_platform_admin()`. Show `notFound()` for anyone else.
   - **The list:** every `pending_review` listing, oldest submitted first. Each shows:
     - the name and date, venue, time zone;
     - the organiser's profile and email (service client for the email only);
     - the sanction region, reference and notes;
     - the fee summary, the count of enabled competitions, and the entry dates.
   - **Actions:** an Approve button, and "Send back" with a required note textarea. Server actions call the RPCs, check `.error`, then send the emails (Decision 10).
   - Plus a small "Recently approved" list (last 10) for context.
   - **Errors:** in the page, never `alert()`.
6. **Home page and register page:** nothing to change. They read `status = 'open'`. Confirm it.
7. **Docs:**
   - `docs/known-issues.md`: remove anything this fixes.
   - `CLAUDE.md`: a short "Approval gate" note covering the statuses, the guard, the admin table, and how to add an admin (one SQL insert).

## Rules (both tasks)

- **Project rules** from `CLAUDE.md`:
  - no `any`;
  - check `.error` on every Supabase response;
  - try/catch on form submissions;
  - every page has a loading state;
  - "RunFeis" in user-facing text.
- **Style:** single quotes, no semicolons, no trailing commas, 2-space indent, 100 columns.
- **Run, all clean** (the old `_onBack` lint warning is known):
  - `npx tsc --noEmit`
  - `npm run lint`
  - `npm test`
  - `npm run test:db`
  - `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build --webpack`
- **Never** push, touch live Supabase, Stripe, Vercel or Resend, read `.env.local`, or print keys.
- **Commits:** explicit `git add` paths and conventional messages, each ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DFiaMuXxfa7i87dnp8Yeqz
  ```
