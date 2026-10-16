# Payment Hardening

**Date:** 2026-10-16
**Status:** Written spec for review. The design was agreed over three review rounds on 2026-10-16; the implementation plan comes after this is approved.
**Goal:** An order counts as paid only when the right amount reached the right feis's Stripe account for exactly the entries the server priced. Every family who is charged ends up either confirmed or in a recorded review case with a reference number. Nobody is charged and forgotten.

---

## Why This Matters

Registration produces the data the rest of RunFeis runs on. Entry lists, money totals, competitor numbers and the feis-day snapshot all trust `status = 'paid'`, and today they can't:

- Parents can write to their own registrations directly.
- The Stripe webhook accepts whatever Stripe reports.
- A family can be charged without being confirmed.

## Scope

**In:**
- database permissions for registrations, entries and snapshots
- the four parent actions in `src/app/feiseanna/[id]/register/actions.ts`
- the Stripe webhook and the hold-expiry job
- payment exceptions: a durable record, an alert, a message to the parent and a manual resolution runbook
- a notification queue for confirmation emails and alerts
- freezing the purchase details when the family submits
- tests: database tests in an isolated Postgres, unit tests, live verification and an end-to-end run in Stripe test mode

**Out (planned elsewhere):**
- Refunds and withdrawals. These wait on Steve's policy.
- Changes after paying. These come in November; the model is agreed below, and nothing here blocks it.
- Recording actual Stripe fees. That belongs to the #2 entries view. Confirmation never waits for fee data; the view shows "pending" until the amount is known.
- Making Launch read the frozen purchase details. That comes in November.
- Capacity caps. No screen shows a cap today; ask Steve whether the first feis needs them.
- The organiser's "needs attention" screen, which is part of #2.

**Already done:** the uncommitted pay-at-the-door work is parked on branch `parked/pay-at-door` (commit `66162ce`).

---

## Terms

| Term | Meaning | Where it lives |
|---|---|---|
| Order | One fixed purchase by a household for one feis | A `registrations` row. The table name is kept. |
| Payment attempt | One Stripe Checkout session for an order | `stripe_checkout_session_id` and `checkout_expires_at` on the order |
| Event participation | All of a household's paid orders for a feis | Derived. Comes in November. |
| Active entry | A paid entry that hasn't later been withdrawn or replaced | Derived. Comes in November. |

In this spec an order has at most one payment attempt. If that attempt expires, the order expires, and paying again means starting a new order. That is the explicit line between "the same attempt" and "a new attempt": a new attempt is a new order with a new ID, so it gets a new Stripe idempotency key.

---

## What's Wrong Today

These were verified in the repo on 2026-10-16. The live database hasn't been checked yet; that's Rollout step 1.

| # | Problem | Where |
|---|---|---|
| 1 | Parents have `FOR ALL` policies on registrations, entries and snapshots. They can set `status = 'paid'`, add entries to a paid order, change prices and totals, and write or delete snapshots. | `005_performance_indexes.sql` (originally `002`) |
| 2 | The webhook overwrites `total_cents` with Stripe's `amount_total` instead of checking it. | `src/app/api/webhooks/stripe/route.ts` |
| 3 | The webhook doesn't check the connected account (`event.account`), the session ID or the currency. | same |
| 4 | The hold runs 30 minutes from submit, but the Stripe session runs 30 minutes from Pay. The every-minute cron expires `pending_payment` orders while their session can still be paid. The webhook then marks paid without checking the state. If the family has started again, it fails instead, on `idx_registrations_active_unique`. | `002` cron, `actions.ts`, webhook |
| 5 | Cancelling during checkout leaves the Stripe session payable. | `cancelRegistration` |
| 6 | Pressing Pay after backing out of Stripe fails with "Cannot create checkout for pending_payment registration". | `createCheckoutSession` |
| 7 | Payment methods aren't restricted, and `async_payment_succeeded` isn't handled, so a delayed payment is never confirmed. | `createCheckoutSession`, webhook |
| 8 | Two deliveries of the same event can both pass the "already paid?" check. That produces two confirmation numbers, two snapshots and two emails. | webhook |
| 9 | Marking paid, the snapshot, numbering and the email are separate steps. A crash between them leaves a paid order with no snapshot, and the retry path skips the missing steps. | webhook |
| 10 | Submit doesn't check eligibility, the listing's status or its opening date. It takes the consent time and IP from the browser. | `createDraftRegistration` |
| 11 | The paid snapshot re-reads the dancer's current profile, and parents can edit DOB and levels at any time. The record of what was bought can drift. | webhook snapshot, `dancers` policies |

**Already correct, and kept:**
- server-side pricing at submit (`calculateFees` with the feis's own fee settings)
- ownership checks in all four actions
- webhook signature verification and the `payment_status` check
- `UNIQUE (registration_id, dancer_id, feis_competition_id)` on entries
- one competitor number per dancer per feis (`competitor_numbers` unique keys)

---

## Design

### 1. Database permissions

Migration `012_payment_hardening.sql`:

- On `registrations`, `registration_entries` and `registration_snapshots`, drop **every** existing policy. The migration loops over `pg_policies`, so a policy applied by hand can't survive. It then creates exactly two policies on each table:
  - a parent `SELECT` on their own household's rows, via `auth_household_id()`
  - an organiser `SELECT` for their own feiseanna, as today
- `REVOKE INSERT, UPDATE, DELETE` on those three tables from `anon` and `authenticated`. Writes are then refused at the privilege level as well as by RLS.
- The new tables get the same `REVOKE`s:
  - `payment_exceptions` (§8) gets read-only policies. Parents can read their own household's cases, and organisers can read their feis's.
  - `notifications` (§9) gets no policies at all, so only the service role can touch it.
- Parents keep full control of `households`, `dancers` and `dancer_dance_levels`. Profile edits never change an existing order (§3).

All order writes happen either in server code using the service role, or in `SECURITY DEFINER` functions that only `service_role` can execute.

### 2. State machine, enforced in the database

`canTransitionRegistration()` in TypeScript and a database trigger hold the same table:

| From | To | Made by |
|---|---|---|
| draft | pending_payment | Pay |
| draft | cancelled | Cancel |
| draft | expired | the expiry job |
| pending_payment | paid | the confirmation function |
| pending_payment | cancelled | Cancel, after Stripe confirms the session is closed |
| pending_payment | expired | the expiry job, or Stripe's `checkout.session.expired` |
| expired | paid | the confirmation function only: a late payment on the order's own session, with no conflicting active order |

A `BEFORE UPDATE` trigger on `registrations` refuses any other status change for every role, including the service role. `paid` is final in this spec; refunds and withdrawals will add their own moves later.

Other rules the database enforces:
- Entries can be inserted only while their order is a `draft`. They can never be updated, and can be deleted only while the order is a `draft`.
- Once an order leaves `draft`, its amounts and `purchase_snapshot` can't change.

### 3. Frozen purchase details

The purchase is fixed at submit. From then on nothing about the order can change (§2), so the details are frozen there. `registrations.purchase_snapshot` (jsonb, write-once) holds exactly what was validated and priced:

- **Each dancer:** ID, first and last name, school, TCRG name, date of birth, gender, championship status, dance levels, and competition age at the feis's age cutoff date.
- **Each competition entered:** ID, display code, display name, age group, level, dance, type, championship key, fee category and fee.
- **Each entry:** dancer, competition, and its base, late and day-of fees.
- **Pricing:** the fee schedule as used, the full breakdown (including family max and event fee), and `priced_at`.
- **Rules:**
  - `age_cutoff_date` and the syllabus levels used
  - the consent and terms versions
  - `PRICING_VERSION` and `ELIGIBILITY_VERSION` constants from the code

Required dance selections, such as a championship set piece, aren't collected yet. When they are, they go here too.

The paid snapshot in `registration_snapshots` is built from `purchase_snapshot` plus the payment details. It never re-reads profiles. Launch keeps its current reads until November, when it switches to the frozen details.

### 4. Submit (`createDraftRegistration`)

1. Authenticate, then load the household with the user's own client; this proves ownership. Check the household is complete (existing).
2. Load the listing, fee schedule, competitions, and the dancers with their levels.
3. Check each of these, and return a specific message for each failure:
   - The listing's `status` is `'open'`.
   - `now` is on or after `reg_opens_at` (if set).
   - `now` is on or before the close date: `late_reg_closes_at` if set, otherwise `reg_closes_at`.
   - There's at least one entry, and no (dancer, competition) pair appears twice.
   - Every dancer belongs to this household and is active.
   - Every competition belongs to this feis and is enabled.
   - Every (dancer, competition) pair is eligible under `getEligibleCompetitions`, with the listing's `age_cutoff_date` and `syllabus_snapshot.levels`. These are the same inputs the cart uses.
4. Record consent on the server. The browser sends only `consentAccepted: true`; the server sets `consent_accepted_at = now()` and reads `consent_ip` from the request headers.
5. Price the order with `calculateFees` (existing) and build `purchase_snapshot`.
6. Insert the order with the service client: `draft`, the totals, the snapshot, and `hold_expires_at = now + 30 min`. Then insert its entries.
   - Check the inserted row counts.
   - If the entries fail, delete the order (the existing pattern).
   - `idx_registrations_active_unique` still produces "you already have an active registration".

Validation and the snapshot builder are pure functions in `src/lib/engine/`, so they can be unit-tested.

### 5. Pay (`createCheckoutSession`)

**Concurrency rule for every write in §5–§8:** an `UPDATE` names three things in its `WHERE` clause:
- the order ID
- the expected status
- the expected checkout identity: `stripe_checkout_session_id`, or `checkout_expires_at IS NULL` before a session exists

The code then checks that exactly one row came back (`.select('id')`). Zero rows means another request got there first. The action re-reads the order and responds to its new state; it never overwrites.

**Steps:**
1. Authenticate and confirm ownership.
2. Act on the status:
   - `paid`: return "already paid".
   - `pending_payment`: retrieve the session from Stripe, on the connected account.
     - If it's `open`, return its URL so the family resumes.
     - If it's `complete`, run the confirmation sync (§7) and return the result.
     - If it's `expired`, expire the order (conditional on the session ID) and ask the family to start again.
   - `expired` or `cancelled`: ask the family to start again.
   - `draft`: continue below.
3. Re-check against the current settings:
   - the listing is still open
   - the competitions are still enabled
   - prices recomputed from the current fee settings, priced as at the order's `created_at`, still equal the stored totals and entry fees

   If anything differs, cancel the draft and say what changed.
4. Claim the attempt:
   `UPDATE … SET checkout_expires_at = now() + 60 min, hold_expires_at = now() + 75 min WHERE id = $1 AND status = 'draft' AND checkout_expires_at IS NULL AND hold_expires_at > now()`.
   - If 0 rows come back and `checkout_expires_at` is set, another click is already creating the session. Carry on with the stored value: the parameters and the key are the same, so Stripe returns the same session. If Stripe answers that the same key is still in progress, tell the family it's starting and to try again in a moment.
   - If 0 rows come back for any other reason, the hold has expired or the order has changed. Re-read and respond.
5. Create the Checkout session:
   - `idempotencyKey: checkout_<order id>`, stable for the order's single attempt
   - `expires_at` = the stored `checkout_expires_at`, so a retry sends identical parameters
   - `payment_method_types: ['card']`; Apple Pay and Google Pay work through card
   - `metadata.registration_id`, `application_fee_amount` and the line items from stored values (existing)

   If Stripe rejects the stored expiry, this is a first-time create more than 30 minutes after the claim. Cancel the draft and ask the family to start again.
6. Record the session:
   `UPDATE … SET status = 'pending_payment', stripe_checkout_session_id = $s WHERE id = $1 AND status = 'draft' AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = $s)`.
   - If 0 rows come back, re-read the order. If it now points at `$s`, a parallel click finished first, so return the URL.
   - Otherwise the order was cancelled or expired in the meantime. Expire `$s` at Stripe and report it.

**What this guarantees:**
- Two clicks produce one session.
- The expiry job can't act mid-claim. The claim checks the hold and moves it in the same statement, and Postgres serialises the two updates on the row.

### 6. Cancel (`cancelRegistration`)

1. Authenticate and confirm ownership.
2. If the order is a `draft` with no claim (`checkout_expires_at IS NULL`), make a conditional update to `cancelled`. If 0 rows come back, re-read and respond.
3. If the order is a `draft` with a claim but no session yet, refuse: "Payment is starting, try again in a moment."
4. If the order is `pending_payment`, call `stripe.checkout.sessions.expire(session, { stripeAccount })`.
   - If Stripe says the session is complete, refuse to cancel ("your payment went through, we're confirming it") and run the confirmation sync.
   - If the session is now expired, or already was, make a conditional update from `pending_payment` to `cancelled` on the session ID. If 0 rows come back, re-read; the webhook may have confirmed the order.

### 7. Confirmation: one database transaction

`confirm_order_payment(p_registration_id, p_session_id, p_account_id, p_amount_cents, p_currency, p_payment_status, p_payment_intent_id, p_charge_id, p_event_id)` is `SECURITY DEFINER`, and only `service_role` can execute it. It runs as one transaction:

1. `SELECT … FOR UPDATE` the order and its listing. This serialises duplicate deliveries.
2. If the order is already `paid` with this session, return `already_confirmed` with no side effects.
3. Check the payment:
   - `p_payment_status = 'paid'`
   - the account is the listing's `stripe_account_id`
   - the session is the order's `stripe_checkout_session_id`
   - the currency is `usd`
   - the amount equals `total_cents`
4. Check the order's state:
   - `pending_payment` is fine.
   - `expired` is fine only if the household has no other order for this feis in `draft`, `pending_payment` or `paid`. Otherwise it's a `late_payment_conflict` exception.
   - `cancelled`, or no order found, is an exception.
5. If any check fails, record an exception (§8) and return `exception` with its reference. The order is left exactly as it was, and nothing is overwritten.
6. Otherwise, do all of the following or none of them:
   - Set the status to `paid`, with `paid_at`, the payment intent and charge IDs, and `hold_expires_at = NULL`.
   - Generate a unique confirmation number in SQL, in the format `RF-2026-7KQ2M`. Older orders keep their `FT-` numbers.
   - Insert the snapshot, built from `purchase_snapshot` plus the payment details. Snapshots have `UNIQUE (registration_id)`, and a trigger blocks updates and deletes.
   - Assign competitor numbers with `_assign_numbers_for_registration` (existing).
   - Queue the confirmation email in `notifications`, with dedupe key `confirmation:<order id>`.
7. Return `confirmed` and the confirmation number.

**Callers:**
- **The webhook,** for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. The second can't happen with cards only, but handling it costs nothing.
- **The confirmation sync,** run from the success page, Pay and Cancel when Stripe says the session is complete but the order isn't paid yet. These read the session from the Stripe API themselves, never from the URL, and call the same function. A late or missed webhook can't strand a family. This changes the project rule "success page is cosmetic", and the plan updates `CLAUDE.md` to match. Stripe's own fulfilment guide recommends this.

**The webhook route after the change:**
- Verify the signature (existing).
- For `completed` or `async_payment_succeeded`, call `confirm_order_payment`. The route passes the charge ID if it can get one; confirmation doesn't wait for it.
- For `async_payment_failed`, record a `payment_failed` exception.
- For `checkout.session.expired`, run `UPDATE … SET status = 'expired' WHERE id = <metadata.registration_id> AND stripe_checkout_session_id = <session.id> AND status = 'pending_payment'`. An old session can't expire anything else, and a paid order is never expired.
- Then send that order's pending notifications, best effort.
- Return 200 once the database step has succeeded. Return 500 only if the database call itself failed, so that Stripe retries; the function is idempotent.

### 8. Payment exceptions and recovery

Table `payment_exceptions`:
- `id`, and `support_ref`: unique and short, e.g. `PAY-7KQ2M`. This is the reference the family sees.
- `registration_id`, `household_id` and `feis_listing_id`. Each can be null if the order wasn't found.
- `reason`, one of:
  - `amount_mismatch`
  - `currency_mismatch`
  - `account_mismatch`
  - `session_mismatch`
  - `order_not_payable`
  - `late_payment_conflict`
  - `order_not_found`
  - `payment_failed`
- The Stripe event ID, account, session and payment intent, plus the amount and currency received.
- `details` (jsonb).
- `status` (`open` or `resolved`), `resolution`, `resolved_at`, `resolved_by` and `created_at`.
- `UNIQUE (stripe_checkout_session_id, reason)`, so repeat deliveries don't duplicate a case.

**When an exception is recorded:**
1. The order and the payment reference are kept exactly as they are. In a late-payment conflict, both orders stay untouched; neither is discarded and neither is auto-confirmed.
2. An alert to the payments contact is queued, with dedupe key `exception:<id>`. It includes the reference, the reason, the family, the feis and the Stripe IDs.
3. The server logs `[PAYMENT_EXCEPTION] <support_ref>`, so the case can be found in the Vercel logs.
4. The success page and the dashboard show the parent: "We've received your payment and are checking it. Please don't pay again. Your reference is PAY-7KQ2M. We'll email you." Parents can read their own exceptions, and organisers can read their feis's.

**Manual resolution:** `docs/runbooks/payment-exceptions.md` goes through each reason:
1. Find the case by its reference.
2. Check the payment in the Stripe dashboard.
3. Either confirm the order with `admin_confirm_order(support_ref, note)`, which runs the same steps as §7.6, or refund the payment in Stripe.
4. Close the case with `resolve_payment_exception(support_ref, resolution)`.

Both functions run only from the SQL editor and are never exposed through the API.

### 9. Notifications queue

Table `notifications`:
- `id`
- `kind`: `registration_confirmation` or `payment_exception_alert`
- `dedupe_key` (unique)
- `registration_id` and `payload` (jsonb)
- `status`: `pending`, `sending`, `sent` or `failed`
- `attempts`, `last_error`, `next_attempt_at`, `claimed_at`, `sent_at` and `created_at`

The sender works out the recipient when it sends. A confirmation goes to the family's email (from `auth.users`, as today). An alert goes to `PAYMENTS_ALERT_EMAIL`.

**Sending** happens in the route `src/app/api/notifications/process/route.ts`. The claim and backoff rules are pure functions in `src/lib/engine/`.
1. Claim a row with a conditional update. Either it's `pending` and due, or it's `sending` with a `claimed_at` more than 10 minutes old (a sender that crashed).
2. Send it through Resend, using the existing confirmation template.
3. Mark it `sent`. On failure, set it back to `pending` with `attempts + 1`. The waits between tries are 5 min, 15 min, 1 h, 3 h, 6 h, 12 h and 24 h.
4. After 8 failed attempts, mark it `failed`. A failed confirmation queues an alert. A failed alert only logs `[NOTIFICATION_FAILED]`, so failures can't loop.

The dedupe key means each order gets one confirmation email, however many deliveries or syncs happen.

**When it runs:**
- Right after a confirmation, best effort.
- Every 5 minutes from a scheduled job. pg_cron (already used for holds) calls `POST /api/notifications/process` through pg_net, with the bearer secret `NOTIFICATIONS_CRON_SECRET`. The job is set up by hand for each environment, and the runbook documents how. The secret never goes in the repo.

### 10. Expiry job

The cron rule stays as it is: `status IN ('draft', 'pending_payment') AND hold_expires_at < now()` becomes `expired`. What changes is how the hold is set. The Pay claim moves `hold_expires_at` 15 minutes past the end of Stripe's window, in the same statement, so the job never expires a checkout that can still be paid.

A draft that was claimed but never got a session (Pay crashed between steps 4 and 6) expires when its hold passes.

`getExistingRegistration` stops writing. It reports a passed hold as expired and leaves the change to the job.

---

## Changes After Paying (November): What This Spec Guarantees

Agreed model: one purchase per order record. The November work must meet these conditions:

- One unpaid order at a time per household per feis. `idx_registrations_active_unique` narrows to `draft` and `pending_payment`.
- Any number of paid orders.
- No duplicate active (dancer, competition) entry across orders.
- One competitor number per dancer per feis. This is already enforced.
- The family max and once-per-family fees count earlier orders.
- Replacements and withdrawals are recorded explicitly. For example, moving from Novice Reel to Prizewinner Reel is a replacement, not two active entries. The original purchase stays unchanged.
- Two purchases can't both use the same unused family-max allowance. The one-unpaid-order rule makes them take turns.

"No new table" is a possible outcome, not a requirement. If an amendments table keeps the records correct, use one.

This spec keeps the November work possible:
- Paid orders can't change (§2).
- Each order has its own frozen details (§3), its own snapshot and its own payment record (§7).
- Nothing assumes one paid order per family.

---

## Testing

### Isolated database tests

These run against a throwaway local Postgres (Homebrew `postgresql@17`). Small stand-ins for Supabase's `auth` schema, its roles and `cron` let migrations 001–012 apply unchanged. `npm run test:db` creates a temporary database, applies the stand-ins and migrations, runs `supabase/tests/payment_hardening.sql`, and drops the database.

Each test switches to the real `authenticated` role with JWT claims, never a role that bypasses RLS. Tests assert the resulting database state, not just error messages.

**Parent permissions:**
- A parent can read their own orders, entries and snapshots.
- A parent can't read another household's.
- A parent can't:
  - mark an order paid
  - add an entry to any order
  - change a price or a total
  - change a status
  - insert, update or delete a snapshot

  After each refused write, the rows are unchanged.
- The effective policies on the three tables are exactly the expected set (checked in `pg_policies`).
- `anon` and `authenticated` have no write privileges.

**Confirmation function:**
- A correct payment ends up paid, with a snapshot, competitor numbers and one queued email.
- Calling it again changes nothing.
- A wrong amount, currency, account or session each produces exactly one exception, and the order is unchanged.
- A late payment with no conflict ends up paid.
- A late payment with a conflict produces an exception, and both orders are unchanged.
- A cancelled or missing order produces an exception.

**Database rules:**
- The state trigger refuses illegal moves.
- Entries can't change after `draft`.
- `purchase_snapshot` can't be rewritten.

**Expiry:**
- The expiry job leaves a payable checkout alone.
- An expired notice for an old session changes nothing else.

### Unit tests (Vitest)

- **Order validation:** a closed feis, a feis not yet open, an empty order, duplicates, another household's dancer, an inactive dancer, a disabled competition, an ineligible age or level.
- **Purchase snapshot builder:** the contents, including age at the cutoff.
- **Checkout parameters:** the same order always gives the same key and `expires_at`.
- **Price re-check at Pay:** a changed fee is caught.
- **Consent IP:** parsed correctly from the request headers.
- **Registration state table:** includes `expired → paid`.
- **Notifications:** the claim and backoff rules.

### Live verification

The same parent tests run against the live project with controlled test identities, after 012 is applied. They run inside a transaction that always rolls back, using the `apply_migration` plus final `RAISE` pattern from the feis-day repo's `supabase/tests/032_phase1_rpc_tests.sql`.

### End to end, in Stripe test mode

This needs Stripe test keys and a connected test account, so it runs together with the real Stripe setup. The cases:
- paying
- backing out and paying again (resumes the same session)
- double-clicking Pay (one session)
- cancelling mid-checkout (the old link stops working)
- letting the session expire
- delivering the same event twice
- delivering the webhook late, after the expiry job has run

**Done** means all of the above pass, along with `npm test` and `npm run build`.

---

## Rollout

1. **Live check (read-only).** Look at:
   - the policies and grants on the three tables
   - whether the parked pay-at-the-door objects (migration 011) exist
   - the cron jobs
   - duplicate snapshots for any order
   - orders by status
   - any order in `pending_payment`, or with totals that don't match its entries

   Adjust 012 to what's there. If 011's trigger or functions exist, 012 removes them. If any order has duplicate snapshots, resolve that before adding the unique key.
2. **Build** on branch `payment-hardening`, with all tests passing locally.
3. **Set environment variables** on Vercel:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PAYMENTS_ALERT_EMAIL`
   - `NOTIFICATIONS_CRON_SECRET`

   The Stripe and Resend keys come with the real-Stripe and email items.
4. **Apply 012, deploy straight after, and schedule the notification job.** The old app code can't write under the new permissions, so the migration and the deploy go out together. Step 1 confirms that no feis is taking real registrations yet, so the short gap affects no one.
5. **Run the live verification** and record the result in this document.

---

## Decisions for Daniel

1. **Who gets payment alerts?** You, Steve, or both. This sets `PAYMENTS_ALERT_EMAIL`.
2. **Test database.** Recommended: a local Postgres through Homebrew, which is free, needs no account, and runs in seconds. The alternative is a separate free Supabase project, which is closer to live and could also be the staging site for the December run.
3. **Cards only?** Cards, Apple Pay and Google Pay, but no bank debits.
4. **Retry schedule.** Recommended: pg_cron with pg_net every 5 minutes, which works on any plan. The alternative is Vercel Cron, if the Vercel plan allows it.

## Dependencies

- **Supabase connector** reconnected to the RunFeis organisation, for the live check, applying 012 and the live verification. Otherwise Daniel pastes the SQL in.
- **Vercel connector** reconnected to the cgds-projects team, for the environment variables. Otherwise Daniel sets them.
- **Resend** configured (the domain-and-email item) before emails actually send. Until then they wait in the queue, and alerts are visible in the logs and in `payment_exceptions`.
- **Stripe test keys and a connected test account** (the real-Stripe item), for the end-to-end run.
