# Payment Hardening

**Date:** 2026-10-16
**Status:** Revision 4, the implementation baseline: revision 3 plus what building Tasks 1–4 settled (see "Changes in Revision 4"). Revision 2 answered the review of revision 1. Revision 3 makes the three payment-correctness fixes and the clarifications from the review of revision 2 (see "Changes in Revision 3"). The implementation plan is `docs/2026-10-16-payment-hardening.md`.
**Goal:**
- An order counts as paid only when three things are true:
  - The right amount reached the Stripe account the order was bound to.
  - It paid for exactly the entries the server priced.
  - Every step of confirmation succeeded together.
- Every family who is charged ends up either confirmed or in a recorded review case with a reference number. Nobody is charged and forgotten.

---

## Changes in Revision 4

Building and reviewing Tasks 1–4 settled these. None of them changes the design. Each one tightens a rule the design already states, or records a decision.

| Change | Where |
|---|---|
| Every privilege on the order tables is revoked from `PUBLIC`, `anon` and `authenticated` before `SELECT` is granted back. 012 turns row-level security on itself. `TRUNCATE` is refused for every role | §2 |
| A checkout claim is all-or-nothing and never null. An unpaid order always has a hold. Moving to `paid` or `pending_payment` needs payment evidence. Entries and snapshots can only be written in the transaction that creates or pays the order | §3 |
| Submit judges eligibility against every competition of the feis, with 1 January of the feis year as the fallback age cutoff, exactly as the entry page does | §4 |
| The purchase snapshot also freezes each competition's labels, age bounds and flags, and the feis's own terms link. The application fee is worked out in whole basis points | §4 |
| The consent and terms versions name the documents the parent actually accepts. The checkbox also covers a guardian or family friend entering a dancer with permission | §4, Decision 6 |
| `consent_ip` and `checkout_config` can't be read by parents or organisers | §2, Decision 7 |
| The confirmation number uses the year in Eastern time | §9 |
| The confirmation email keeps the competitor numbers and competition codes that the redesigned email shows | §12 |
| The live check also covers row-level security, column grants, `TRUNCATE` and 011's `confirmed` status. 012–017 are rehearsed on a copy of the live data first | Rollout |
| The registration UI is now a single entry page (the redesign on `main`), not a wizard | §3 |

## Changes in Revision 3

| Review point | Where it's handled |
|---|---|
| 1. A Stripe 4xx doesn't prove no session exists, and a cached 500 can hide one that does | §6 step 4: errors are classified by Stripe type and code, and describe only that one request. §6a: a claim's session is found by retrieving or listing. "None" holds only once nothing is found and no create request can still be running. §7: Cancel never infers anything from an error. |
| 2. An expired checkout doesn't prove the competing order was unpaid | §11: the admin confirmation never replaces an order that reached checkout, unless it was cancelled through Cancel; those cases are refunded. It closes its case as `confirmed_late_payment` in the same transaction. |
| 3. Recovery paths must handle a session that is already complete | §6a: one outcome handler for every recovered session, used by §6 step 5, §7 and the success-page sync |
| Clarifications | §5: the 60-minute payment window (the 15 minutes is a reconciliation buffer), and the organiser stop decided inside `claim_checkout`. §5 and §6: fixed pricing replaces "recalculate at Pay". §9: the `claim_mismatch` reason, and only the active-order conflict is caught. §12: alerts never alert about themselves. November section: the unique index and the manual rule. |

## Changes in Revision 2

| Review point | Where it's handled |
|---|---|
| 1. Frozen at submit vs. draft edits; non-atomic creation | §3: contents are immutable from creation, even as a draft. §4: `create_order` builds the order, entries, consent and snapshot in one transaction and checks they match. |
| 2. Pay could cancel or finish another request's operation | §6, §7: Pay never cancels. Every claimed operation names its exact `checkout_claim_id`, and pre-claim cancellation requires an unclaimed draft. |
| 3. Freeze the whole checkout request; recover from uncertain creation | §6: `checkout_config` freezes every Stripe parameter, including the bound account. §6.4: uncertain creation is resolved by replaying the identical request. |
| 4. Deadline policy | §5: a submitted order is a quote, payable within its hold. The organiser stopping registration is handled separately. |
| 5. Submit vs. late-payment race; the November contradiction | §1: a household-and-feis lock. §9: conflicts become cases, never failures. "Changes After Paying" now updates the conflict rule. |
| 6. Manual confirmation escape hatch | §11: resolutions are defined per case reason, and there is no generic "mark paid". Admin functions live in a non-exposed schema, with explicit grants and a safe `search_path`. |
| 7. One email isn't guaranteed | §12: Resend idempotency keys, a frozen recipient and payload, the provider ID saved, worker claim tokens, and explicit vs. uncertain outcomes. Delivery pauses while email isn't configured. |
| 8. Messages must match the evidence; restricted parent view | §10: three parent messages tied to evidence, and a restricted parent function. §8: every Stripe event handler applies the same account, claim and session checks. |
| 9. Real concurrency and crash tests; existing rows | Testing: the reviewer's cases as concurrent tests. Rollout step 2: a policy for existing orders. |

---

## Why This Matters

Registration produces the data the rest of RunFeis runs on. Entry lists, money totals, competitor numbers and the feis-day snapshot all trust `status = 'paid'`, and today they can't:
- Parents can write to their own registrations directly.
- The Stripe webhook accepts whatever Stripe reports.
- A family can be charged without being confirmed.

## Scope

**In:**
- Database permissions for registrations, entries and snapshots.
- The four parent actions in `src/app/feiseanna/[id]/register/actions.ts`.
- The Stripe webhook and the hold-expiry job.
- Payment exceptions:
  - a durable record
  - alerts
  - parent messages
  - defined manual resolutions, including manual refunds through the Stripe dashboard
- A notification queue for confirmation emails and alerts.
- Freezing the purchase details when the order is created.
- Tests:
  - database and concurrency tests on a local Postgres
  - unit tests
  - live verification
  - an end-to-end run in Stripe test mode

**Out (planned elsewhere):**
- Automated refunds, and withdrawals the family starts themselves. These wait on Steve's policy.
- Changes after paying. This comes in November; the model is agreed below.
- Recording actual Stripe fees. This goes with the #2 entries view. Confirmation never waits for fee data, and the view shows "pending" until it arrives.
- Making Launch read the frozen purchase details (November).
- Capacity caps. No screen shows a cap today; ask Steve whether the first feis needs them.
- The organiser's "needs attention" screen (#2).

**Already done:** the uncommitted pay-at-the-door work is parked on branch `parked/pay-at-door` (commit `66162ce`).

---

## Terms

| Term | Meaning | Where it lives |
|---|---|---|
| Order | One fixed purchase by a household for one feis | A `registrations` row (the table name is kept) |
| Checkout claim | The one-time right an order gets to create a Stripe checkout, with that checkout's full request frozen | `checkout_claim_id`, `checkout_config` |
| Payment attempt | The Stripe Checkout session created under the claim | `stripe_checkout_session_id` |
| Event participation | All of a household's paid orders for a feis | derived (November) |
| Active entry | A paid entry that hasn't later been withdrawn or replaced | derived (November) |

**Attempts:**
- An order gets at most one claim. A claim produces at most one Stripe session, because it has one idempotency key and one frozen request.
- "The same attempt" means the same order and claim. Retries replay it.
- "A new attempt" means a new order. Paying again after an order expires or is cancelled always starts a new order.

---

## What's Wrong Today

These were verified in the repo on 2026-10-16. The live database is checked in Rollout step 1.

| # | Problem | Where |
|---|---|---|
| 1 | Parents have `FOR ALL` policies on registrations, entries and snapshots. They can set `status = 'paid'`, add entries to a paid order, change prices and totals, and write or delete snapshots. | `005_performance_indexes.sql` (originally `002`) |
| 2 | The webhook overwrites `total_cents` with Stripe's `amount_total` instead of checking it. | `src/app/api/webhooks/stripe/route.ts` |
| 3 | The webhook doesn't check the connected account, the session or the currency. | same |
| 4 | The hold runs 30 minutes from Submit, while the Stripe session runs 30 minutes from Pay. The every-minute cron can expire a `pending_payment` order whose session is still payable. The webhook then marks it paid without a state check, or fails on `idx_registrations_active_unique` if the family started again. | `002` cron, `actions.ts`, webhook |
| 5 | Cancelling during checkout leaves the Stripe session payable. | `cancelRegistration` |
| 6 | Pressing Pay after backing out of Stripe fails with "Cannot create checkout for pending_payment registration". | `createCheckoutSession` |
| 7 | Payment methods aren't restricted, and `async_payment_succeeded` isn't handled, so a delayed payment is never confirmed. | `createCheckoutSession`, webhook |
| 8 | Two deliveries of one event can both pass the "already paid?" check, giving two confirmation numbers, two snapshots and two emails. | webhook |
| 9 | Marking paid, the snapshot, numbering and the email are separate steps. A crash between them leaves a paid order with no snapshot, and retries skip it. | webhook |
| 10 | Submit doesn't check eligibility, the listing's status or its opening date. It takes the consent time and IP from the browser, and it creates the order and its entries in two separate requests. | `createDraftRegistration` |
| 11 | The paid snapshot re-reads the dancer's current profile, which parents can edit at any time. | webhook snapshot, `dancers` policies |

**Already correct, and kept:**
- Server-side pricing (`calculateFees` with the feis's own fee settings).
- Ownership checks in all four actions.
- Webhook signature verification.
- `UNIQUE (registration_id, dancer_id, feis_competition_id)` on entries.
- One competitor number per dancer per feis.

---

## Design

### 1. Where the logic lives

**Every change to order state is a Postgres function.** Each function runs in one transaction and checks the expected state itself:
- `create_order`
- `claim_checkout`
- `attach_checkout_session`
- `cancel_order`
- `expire_checkout`
- `confirm_order_payment`
- `record_payment_failure`
- the notification functions (§12)

TypeScript makes the Stripe and Resend calls between these functions, and calls the functions through `supabase.rpc(...)` with the service role. No TypeScript writes order tables directly.

**Locks:**
- A function that changes an order first locks that order's row (`SELECT … FOR UPDATE`). It then checks the status and the claim it expects.
- Some functions can create or revive an active order: `create_order`, `confirm_order_payment` and `payments_admin.confirm_late_payment`. These take a transaction lock on the (household, feis) pair first, with `pg_advisory_xact_lock` on a hash of both IDs.
- So Submit and a late payment for the same family and feis always run one after the other.
- Lock order is always pair, then row, so the functions can't deadlock each other.

**Function security:**
- Every function is `SECURITY DEFINER` with `SET search_path = pre_registration, pg_temp`.
- Every function has `REVOKE ALL … FROM PUBLIC`.
- `EXECUTE` goes only to the role that needs it:
  - `service_role` for app functions
  - `authenticated` for the parent view function (§10)
- Admin functions live in a separate schema, `payments_admin`, which the API doesn't expose. `USAGE` on that schema is revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, so only `postgres` (the SQL editor) can run them.

### 2. Database permissions

**The three order tables** (registrations, entries and snapshots):
- Migration `012_order_integrity.sql` drops every existing policy on them. This work ships as migrations 012–017, split by concern; see the implementation plan. Migration 018 belongs to the separate schools work, so any extra migration starts at 019. It loops over `pg_policies`, so a policy applied by hand can't survive.
- It then creates exactly two policies on each:
  - parent `SELECT` on their own household's rows (`auth_household_id()`)
  - organiser `SELECT` for their own feiseanna
- Every privilege is revoked from `PUBLIC`, `anon` and `authenticated`. `authenticated` then gets `SELECT` back: table-level on entries and snapshots, and column by column on `registrations` (below). On Postgres 17 a list of named privileges would leave `MAINTAIN`, which can lock the table.
- 012 turns row-level security on for the three tables itself, instead of trusting earlier migrations, because the live database was migrated by hand.
- `TRUNCATE` is revoked from the service role and refused by a trigger for every role, so it can't get around the delete rules.
- `authenticated` reads `registrations` column by column. `consent_ip` and `checkout_config` are left out (Decision 7), so neither organisers nor parents can read a parent's IP address or the checkout details. The service role and the payment functions still can. App code reads orders through one shared column list, never `*`, and a test keeps that list equal to the grant.

**The new tables** (`payment_exceptions`, `notifications` and `admin_actions`):
- They have no policies for `anon` or `authenticated`, and get the same revokes. Only the service role and the functions can use them.
- Parents see their review cases only through `get_my_payment_reviews` (§10).

**Profiles:** parents keep full control of `households`, `dancers` and `dancer_dance_levels`. Profile edits never change an existing order (§3).

### 3. Immutability and the state machine

Once `create_order` commits, the order's contents are fixed for good, even while the order is still a draft. That covers:
- its entries
- its amounts
- `purchase_snapshot`
- its consent record
- its household and feis

Changing anything means cancelling and starting a new order. The entry page can pre-fill the new one.

Triggers enforce this for every role, including the service role:
- **Entries:**
  - An insert is allowed only inside `create_order`, for the order it is creating. The function sets a transaction-local marker that the trigger checks, and the order must have been created in that same transaction.
  - Updates and deletes are always refused.
- **Orders:**
  - A delete is always refused.
  - Amounts, `purchase_snapshot`, consent, household and feis never change after insert.
  - A checkout claim is all-or-nothing. `checkout_claim_id`, `checkout_config`, `checkout_claimed_at` and `checkout_expires_at` are set together, once, from null, and none of them can be null afterwards. Before the claim, they all stay null.
  - An unpaid order (`draft` or `pending_payment`) always has a hold, so the expiry job can always end it.
  - `stripe_checkout_session_id` can be set once, and only on a claimed order.
  - Moving into `paid` needs the claim, the session, `paid_at` and the confirmation number. Moving into `pending_payment` needs the claim and the session.
- **Snapshots:** an insert is allowed only at confirmation, for an order marked paid in that same transaction. Updates and deletes are refused.
- **Status:** a change must follow this table.

| From | To | Made by |
|---|---|---|
| draft | pending_payment | `attach_checkout_session` (the claim must match) |
| draft | cancelled | `cancel_order` |
| draft | expired | the expiry job, `create_order` (this household's lapsed order for the feis), or `expire_checkout` for this order's own claim (§8) |
| draft | paid | `confirm_order_payment`, when the payment came through the order's own claim before the session was attached (Pay crashed in between) |
| pending_payment | paid | `confirm_order_payment` |
| pending_payment | cancelled | `cancel_order`, after the caller has closed the Stripe session |
| pending_payment | expired | the expiry job, or `expire_checkout` for this order's own session |
| expired | paid | `confirm_order_payment` (late payment on the order's own claim with no conflict, §9) or `payments_admin.confirm_late_payment` (§11) |

`paid` and `cancelled` are final in this spec. A payment against a cancelled order is refunded (§11). `canTransitionRegistration()` in TypeScript holds the same table, and a unit test keeps the two in step.

### 4. Submit (`createDraftRegistration` → `create_order`)

**In TypeScript:**
1. Authenticate, then load the household with the user's own client; this proves ownership. Check the household is complete (existing check).
2. Load the listing, fee schedule, competitions, and the dancers with their levels.
3. Run `validateOrderRequest`, a pure function. Each failure has its own message:
   - The listing's `status` is `'open'`.
   - `reg_opens_at ≤ now ≤` the close date (`late_reg_closes_at` if set, otherwise `reg_closes_at`).
   - There's at least one entry, with no duplicate pairs.
   - Every dancer belongs to this household and is active.
   - Every competition belongs to this feis and is enabled.
   - Every (dancer, competition) pair passes `getEligibleCompetitions`, judged against every competition of the feis so that a dancer stays in their own age group. It uses the listing's `age_cutoff_date` (or 1 January of the feis year when none is set) and `syllabus_snapshot.levels`, exactly as the entry page does.
4. Price with `calculateFees`, then build `purchase_snapshot` with `buildPurchaseSnapshot` (pure). The snapshot holds:
   - **Each dancer:** ID, names, school, TCRG name, date of birth, gender, championship status, dance levels, and competition age at the cutoff.
   - **Each competition:** ID, display code, display name, age group with its label and age bounds, level and dance with their labels, type, championship key, the grades-only and family-cap flags, fee category and fee.
   - **Each entry:** dancer, competition, and its base, late and day-of fees.
   - **Pricing:** the fee schedule as used, the full breakdown, and `priced_at`.
   - **Rules:** the age cutoff, the syllabus levels, the consent and terms versions, the feis's own terms link, and the `PRICING_VERSION` and `ELIGIBILITY_VERSION` constants.

   Dance selections, such as a championship set piece, aren't collected yet. When they are, they go in the snapshot too.

   The application fee is `STRIPE_APPLICATION_FEE_PERCENT` of the total, worked out in whole basis points and rounded to the cent. If the percentage is missing or out of range, Submit stops instead of pricing the order wrongly.
5. Record consent on the server. The browser sends only `consentAccepted: true`. The server sets the time and reads the IP from the request headers. The consent version names the checkbox wording, and the platform terms version names the RunFeis terms and privacy pages. Each changes in the same commit as the wording or page it names.

**In the database:** `create_order(household_id, feis_listing_id, order jsonb)` runs as one transaction:
1. Take the household-and-feis lock.
2. Re-check that the listing is `open` and inside its window.
3. Refuse with a clear result if this household already has an active order for this feis, rather than letting the unique index raise an error.
4. Insert the order: `draft`, the totals, the application fee, the event fee, `is_late`, consent, `purchase_snapshot`, and `hold_expires_at = now() + 30 min`. Then insert its entries.
5. Check that the entries match `purchase_snapshot` exactly (the same dancer–competition pairs and the same per-entry fees), and that the order's totals equal the snapshot's breakdown. Any difference aborts everything.

Nothing is visible to other requests until the transaction commits, and nothing needs cleaning up on failure.

### 5. Deadlines and organiser stops

- **The deadline.** A submitted order is a fixed quote, and the family can pay it within its hold even if the registration deadline passes in between:
  - They have 30 minutes from Submit to press Pay.
  - Once they press Pay, they have 60 minutes to pay. The hold runs 15 minutes longer only as an internal buffer for reconciling late payment notices; checkout isn't open for longer.
  - Prices are never recalculated.

  For example, a family submits at 11:58 pm for an 11:59 pm deadline, presses Pay at 12:05 am, and pays at 12:20 am. Their order is confirmed at the price they were quoted. Submit itself is refused after the deadline.
- **The organiser stops registration.** If the organiser closes registration (the listing is no longer `open`), or disables a competition that's in the order, no new checkout starts. Pay says "Registration has been closed by the organiser". It changes nothing, and the draft expires with its hold. `claim_checkout` makes this decision under its locks. A successful claim is the boundary: once a checkout is claimed, that attempt may finish even if registration closes afterwards.
- **A checkout that's already open** can still be paid until it expires (at most 60 minutes), and is confirmed normally. If the whole event is cancelled, the organiser refunds through Stripe (§11).
- **What Pay doesn't check:** the deadline, and prices. Fixed pricing deliberately replaces revision 1's "recalculate at Pay" rule: the server creates and prices each order, and orders never change.

### 6. Pay (`createCheckoutSession`)

1. **Authenticate, confirm ownership and read the order.**
2. **Branch on the status:**
   - **`paid`:** say it's already paid.
   - **`pending_payment`:** retrieve the session from Stripe on the bound account (`checkout_config.account`):
     - If it's open, return its URL so the family resumes.
     - If it's complete, run the confirmation sync (§9).
     - If it's expired, call `expire_checkout` for this claim and session, and ask the family to start again.
   - **`expired` or `cancelled`:** ask the family to start again.
   - **`draft` with a claim:** go to step 4 with the stored claim. Either another click is creating the session, or an earlier Pay crashed. This request adopts that claim and never replaces it.
   - **`draft` without a claim:** go to step 3.
3. **Check for an organiser stop, then claim.**
   - If the organiser has stopped registration (§5), refuse and change nothing.
   - Otherwise build `checkout_config`, the complete Stripe request, from the order's stored values. It contains:
     - the bound connected account (the listing's `stripe_account_id` now)
     - currency `usd`
     - the application fee stored on the order
     - the line items: names and amounts from `purchase_snapshot`, collapsed to one line when the family max applies (existing rule)
     - the success and cancel URLs
     - `payment_method_types: ['card']`; Apple Pay and Google Pay work through card
     - `expires_at = now + 60 min`
     - metadata `{ registration_id, claim_id }`
     - the idempotency key `checkout:<order id>:<claim id>`
   - Then call `claim_checkout(order_id, household_id, claim_id, checkout_config)`, which locks the row and does one of four things:
     - If the order is a draft, unclaimed and inside its hold, and the organiser hasn't stopped registration (checked here, under the lock): store the claim, the time of the claim and the config, set `hold_expires_at = expires_at + 15 min`, and return them.
     - If the organiser has stopped registration: return `blocked` and change nothing.
     - If it's already claimed: return the existing claim and config.
     - Otherwise: return the current state.
4. **Create the session using exactly `checkout_config`** (every parameter, and its key). Pay sends no create request more than 5 minutes after the claim.
   - **Created:** go to step 5.
   - **Failed:** the error is classified by its Stripe type and code. The class describes only that one request:
     - *In progress* (`idempotency_key_in_use`, a 409): the same request is still running. Pause, then replay with the same key.
     - *Retry* (a network error, a Stripe 5xx or a rate limit): the outcome is unknown. Pause, then replay with the same key. Stripe may have made the session even though it answered 500, and it can keep replaying that cached 500.
     - *Rejected* (invalid parameters, a key reused with different parameters, authentication or permissions): Stripe refused this request. That says nothing about what an earlier attempt with the same key did.
   - **No session after the attempts:** look it up through §6a.
     - If it's found, go to step 5.
     - If it's established that none exists, the claim is dead: cancel the order and ask the family to start again.
     - Otherwise keep the order. Tell the family to try again shortly, or, after a refusal, that payment couldn't start and to contact the organiser.
5. **Call `attach_checkout_session(order_id, claim_id, session_id)`:**
   - If the order is a draft with the same claim and no session yet, it becomes `pending_payment` with this session. Return the URL.
   - If the same session is already attached (a parallel click got there first), return the URL.
   - Anything else means the order moved on in the meantime: cancelled, expired or confirmed. Settle this session through §6a. An open session is expired and checked; a complete, paid one is confirmed or recorded as a case. Never assume a session can be expired.

**A payment that may have gone through.** When settling the session (§6a) finds the checkout complete but not confirmed (complete but unpaid, or confirmation failed for now), Pay keeps the order and returns "checking". The entry page sends the family to the success page, which shows message C and checks again every 5 seconds, so message C never sits next to a live Pay button.

The bound account in `checkout_config` is used for every later call about this checkout: retrieve, expire and confirm. It never switches to the listing's current account.

### 6a. Finding and settling a claim's session

Pay, Cancel and the success page all use the same two steps whenever they need to know what happened to a claim's checkout.

1. **Find it.** If a session is attached, retrieve it on the bound account. Otherwise, list the bound account's Checkout Sessions created in the claim window, from 1 minute before the claim to 10 minutes after, and pick the one whose metadata names this claim and order.
   - **Found:** go to step 2.
   - **Nothing found, and the claim is more than 10 minutes old:** no session exists. Pay sends no create request more than 5 minutes after the claim, so by then every request has finished.
   - **Anything else, including when Stripe can't be reached:** unknown. Keep the order, and ask the family to try again in a few minutes.
2. **Settle it.**
   - **`open`:** resume it (Pay), or expire it and read it back to check it's expired (Cancel, or an order that moved on).
   - **`expired`:** it can't be paid. Bring the order's state in line with `expire_checkout` or `cancel_order`.
   - **`complete` and paid:** run confirmation (§9), which confirms the order or records the right case.
   - **`complete` but unpaid:** unknown, and a payment may have gone through. Keep the order and show message C: Pay and Cancel answer "checking" (§6, §7).
   - **An expiry Stripe won't confirm:** unknown. Keep the order. Pay asks the family to try again shortly, and Cancel says it can't cancel yet because a payment may still be starting; neither shows message C. Only attached sessions ever reached a family, and Pay closes a session only when the order has moved on from it.

An error never stands in for this lookup.

### 7. Cancel (`cancelRegistration`)

1. Authenticate, confirm ownership and read the order.
2. **A draft without a claim:** call `cancel_order(order_id, household_id, expected_claim => null)`. It only cancels a draft that is still unclaimed. If a claim has appeared in the meantime, it returns the new state, and the action follows from there.
3. **An order with a claim** (a draft, with or without a session, or `pending_payment`): find and settle its session through §6a, with the intent to close it. Cancel never replays the create request.
   - **Closed and checked, or established that no session exists:** call `cancel_order` with the claim. If no row changes, re-read the order; the webhook may have confirmed it.
   - **Complete and paid:** the payment is confirmed, or recorded as a case, instead of the order being cancelled.
   - **A payment that may have gone through** (complete but unpaid, or confirmation failed for now): keep the order and return "checking". The entry page sends the family to the success page, which shows message C and checks again.
   - **Unknown otherwise, including while a create request may still be running:** refuse ("We can't cancel this yet… try again in a few minutes") and keep the order.

When a claim exists, `cancel_order` requires that exact claim, so one request can't cancel or finish another request's newer operation.

### 8. Stripe events (webhook)

Every handler runs the same checks before acting:
- the order is found from `metadata.registration_id`
- `metadata.claim_id` equals the order's claim
- `event.account` equals `checkout_config.account`
- if a session is attached, it's the event's session

| Event | Action |
|---|---|
| `checkout.session.completed` with `payment_status = 'paid'` | `confirm_order_payment` |
| `checkout.session.async_payment_succeeded` | `confirm_order_payment` (shouldn't happen with cards only; handled anyway) |
| `checkout.session.completed` with `payment_status = 'unpaid'` | Log only. With cards only this shouldn't happen. |
| `checkout.session.async_payment_failed` | `record_payment_failure` → a `payment_failed` case (§10) |
| `checkout.session.expired` | `expire_checkout(order_id, claim_id, session_id, account)`. This expires only this order, and only if it's still `pending_payment` with this session or a draft with this claim. |

- A payment event that fails the checks goes to `confirm_order_payment`, which records the right case (§9).
- A failure or expiry notice that fails the checks changes nothing and is logged, since no money moved.
- The webhook returns 200 once the database step has succeeded. It returns 500 only when the database call itself failed, so Stripe retries; every function is idempotent.
- After a confirmation, the webhook tries to send that order's notifications. This is best effort.

### 9. Confirmation (`confirm_order_payment`)

**Inputs:** order ID, claim ID, session ID, account, amount, currency, payment status, payment intent, charge ID (optional), event ID, and the source (`webhook` or `sync`).

It runs as one transaction:
1. **Lock.** Take the household-and-feis lock, then `SELECT … FOR UPDATE` the order. If there's no order, record `order_not_found` and stop.
2. **Already done.** If the order is already `paid` with this session, return `already_confirmed`, with no side effects.
3. **Payment checks.** Every check is against the order's own claim, never the listing's current settings:
   - the payment status is `paid`
   - the claim ID matches (otherwise `claim_mismatch`)
   - the account is `checkout_config.account`
   - the session is the attached one; if none is attached, the claim must match, and this session gets attached now
   - the currency is `checkout_config.currency`
   - the amount equals `total_cents`
   - the payment intent isn't already recorded on another order (a new partial unique index); otherwise `payment_reused`
4. **State checks:**
   - A `draft` with this claim, or `pending_payment`, is fine.
   - An `expired` order is fine only if no other order for this household and feis is active (`draft`, `pending_payment` or `paid`). Otherwise it's `late_payment_conflict`.
   - A `cancelled` order is `order_not_payable`.
5. **Any failed check** records a case (§10) and returns its reference. The order is left exactly as it was.
6. **Otherwise, all of these happen together, or none of them do:**
   - The status becomes `paid`, the session is attached if it wasn't, and the order records `paid_at`, the payment intent and the charge ID. `hold_expires_at` is cleared.
   - A confirmation number is assigned, in the form `RF-2026-7KQ2M`, using the year in Eastern time. Older orders keep their `FT-` numbers.
   - The snapshot is written, built from `purchase_snapshot` plus the payment details. Snapshots have `UNIQUE (registration_id)` and are immutable.
   - Competitor numbers are assigned with `_assign_numbers_for_registration`.
   - The confirmation email is queued with key `confirmation:<order id>`. The recipient is frozen from `auth.users` now.

   If any step fails, everything rolls back. The order stays as it was, and the webhook returns 500 so Stripe retries. If the one-active-order index (`idx_registrations_active_unique`) rejects the status change, a conflicting order slipped past the checks. The function then records `late_payment_conflict` instead of failing. Any other uniqueness failure, such as numbering or payment reuse, is not relabelled: it rolls back, and Stripe retries.
7. **A changed Stripe account.** If the listing's current Stripe account differs from the bound account, the function also records a notice-level `listing_account_changed` case. The order is still confirmed, because the money went to the account that was the feis's when the family paid.

**The confirmation sync:** Pay, Cancel and the success page call this same function after retrieving the session from Stripe themselves, on the bound account. They never use data from the URL. This updates the project rule "success page is cosmetic", which `CLAUDE.md` will reflect. Stripe's own fulfilment guidance recommends handling both the webhook and the return page this way.

### 10. Payment exceptions

**Table `payment_exceptions`:**
- `id`
- `support_ref`: unique, for example `PAY-7KQ2M`
- `severity`: `blocking` (the order isn't confirmed) or `notice`
- `reason`
- `registration_id`, `household_id`, `feis_listing_id`, `claim_id`
- the Stripe event, account, session and payment intent
- the amount and currency received
- `details` (jsonb)
- `status`: `open` or `resolved`
- `resolution`, `resolved_at`, `resolved_by`, `created_at`
- `UNIQUE (stripe_checkout_session_id, reason)`, so repeat deliveries don't duplicate a case

**What each reason means and what the family sees:**

| Reason | What it means | Family sees |
|---|---|---|
| `amount_mismatch`, `currency_mismatch`, `late_payment_conflict`, `order_not_payable` | The charge is verified, but the registration isn't resolved | Message A |
| `payment_failed` | The payment failed | Message B |
| `account_mismatch`, `claim_mismatch`, `session_mismatch`, `payment_reused`, `order_not_found` | The payer may not be this family | No case view or reference; at most message C (below). Admin alert. |
| `listing_account_changed` | Notice only; the order is confirmed | Nothing. Admin alert only. |

**Parent messages:**
- **A:** "Your payment went through, but we need to check your registration before confirming it. Please don't pay again. Your reference is PAY-7KQ2M. We'll email you."
- **B:** "Your payment didn't go through, so this registration isn't confirmed. You can try again."
- **C:** "We're checking your payment. Please don't try again until this updates." Message C usually has no case behind it. Pay, Cancel and the success page show it when Stripe says the checkout is complete but confirmation hasn't finished yet, for example while a database retry is pending. Pay and Cancel then answer "checking" and send the family to the success page, which checks again every 5 seconds. When Pay, Cancel or the success page records a case whose reason has no parent message, the family sees message C too, without a reference and without the refresh, since nothing will change by itself.

**The parent view** is `get_my_payment_reviews(order_id)`. It's executable by `authenticated` and only returns orders in the caller's own household. It returns only:
- `support_ref`
- the message code (A or B)
- `created_at`
- whether the case is resolved

No Stripe IDs, amounts, details or notes are included.

**When any case is recorded:**
- An alert to the payments contacts is queued (key `exception:<id>`).
- `[PAYMENT_EXCEPTION] <support_ref>` is logged.

### 11. Resolving exceptions

Resolutions are allowed by reason. No function marks an order paid by skipping checks.

| Reason | Allowed resolutions |
|---|---|
| `late_payment_conflict` | (a) Refund the late payment in Stripe and record it. Or (b) `payments_admin.confirm_late_payment(support_ref, note)`, which is allowed only when **all** of these hold: the recorded evidence passes every check in §9.3; the payment intent isn't used by another order; and no other order for this family and feis can have a payment on the way. That means each other order either never reached checkout (no claim, so no payment can exist) or was cancelled through Cancel, which settles its checkout first (§7). In one transaction, under the household-and-feis lock and after re-checking those orders, it does four things: cancels the family's other unpaid orders that never reached checkout, confirms the late one through the same steps as §9.6, closes the case as `confirmed_late_payment`, and writes an audit row. If any other order is paid, or reached checkout and isn't cancelled, only (a) is allowed. A checkout that has since expired still counts, because a delayed payment for it could still arrive. |
| `amount_mismatch`, `currency_mismatch`, `order_not_payable`, `payment_reused`, `account_mismatch`, `claim_mismatch`, `session_mismatch`, `order_not_found` | Check the payment in the Stripe dashboard, refund it there, and record the refund. The family starts a new order if they still want to enter. |
| `payment_failed` | No money moved. Close as `no_action`. |
| `listing_account_changed` | Check that the new account is right, then close as `acknowledged`. |

**Recording a resolution:**
- Use `payments_admin.close_exception(support_ref, resolution, stripe_refund_id, note)`.
- The resolution is one of `refunded`, `no_action` or `acknowledged`. A case closed by `confirm_late_payment` is marked `confirmed_late_payment`.
- `refunded` requires the Stripe refund ID.
- Every admin function writes an `admin_actions` audit row: who, when, what, and the evidence.

**The runbook:** `docs/runbooks/payment-exceptions.md` walks through each reason step by step.

### 12. Notifications

**Table `notifications`:**
- `id`, `kind`
- `dedupe_key` (unique)
- `registration_id`
- `recipient` and `payload` (frozen)
- `status`: `pending`, `sending`, `sent`, `failed` or `needs_check`
- `attempts`, `send_generation`
- `first_attempt_at`, `next_attempt_at`
- `claim_token`, `claimed_at`
- `provider_message_id`, `last_error`
- `sent_at`, `created_at`

**Freezing:**
- **Recipient:** a confirmation's recipient is frozen when the row is created, inside the confirmation transaction. An alert's recipients come from `PAYMENTS_ALERT_EMAIL` and are frozen on the worker's first claim.
- **Message:** the worker renders the message on its first claim and saves it. Every later attempt sends the saved version.

**Confirmation email content:** the confirmation keeps what today's email shows, each dancer's competitor number and competition codes, built with the tested `renderConfirmationEmail()`.

**Worker claims:** `claim_notifications(limit)` gives each claimed row a new `claim_token`. A row can be claimed when:
- it's `pending` and due, or
- it's `sending` with a claim more than 10 minutes old (from a worker that crashed).

`complete_notification(id, claim_token, …)` only works if the token still matches, so an old worker can never finish a newer worker's claim.

These claim, backoff and outcome rules are database functions (migration 016), so each step is atomic. Classifying a Resend error is a pure function in `src/lib/engine/email-errors.ts`.

**Sending:** the worker sends through Resend with idempotency key `<dedupe_key>:<send_generation>`. The Resend SDK in use (6.9.4) supports idempotency keys, and Resend keeps them for 24 hours.

**Outcomes:**
- **Accepted:** mark it `sent` and save `provider_message_id`.
- **Explicit failure** (Resend rejected it, so nothing was sent): increase `send_generation`, set it back to `pending`, and wait before the next try: 5 min, 15 min, 1 h, 3 h, 6 h, then 12 h. After the last try it's `failed`.
  - A failed confirmation queues an alert.
  - A failed alert is only logged (`[NOTIFICATION_FAILED]`), so failures can't loop. The same applies when an alert becomes `needs_check` (below): it never raises another alert.
- **Uncertain** (a timeout, a network error or a 5xx): retry with the same key, so Resend deduplicates it, while within 23 hours of `first_attempt_at`. After that it becomes `needs_check` and an alert is raised. It's never sent again automatically. The runbook covers checking Resend's logs and resending by hand.

**What this guarantees:** at most one email per notification within Resend's 24-hour window. Outside that window, an uncertain delivery waits for a person rather than risking a duplicate.

**When email isn't configured** (`RESEND_API_KEY`, `EMAIL_FROM` or `PAYMENTS_ALERT_EMAIL` is missing), the worker claims nothing. Rows stay `pending` without using up attempts, and the worker logs that email is paused.

**When the worker runs:**
- right after a confirmation, as a best effort
- every 5 minutes, when pg_cron calls `POST /api/notifications/process` through pg_net with a bearer secret (`NOTIFICATIONS_CRON_SECRET`)

The schedule is set up by hand for each environment, following the runbook. The secret never goes in the repo.

### 13. Expiry job

The rule doesn't change: an order in `draft` or `pending_payment` whose hold has passed (`hold_expires_at < now()`) becomes `expired`. Migration 012 re-schedules the job with schema-qualified table names, because pg_cron runs jobs with the default `search_path`. The live check looks at whether the old job has been failing.

Holds:
- An unclaimed draft holds for 30 minutes from Submit.
- A claimed order holds for 75 minutes from its claim, while its Stripe session expires 60 minutes from the claim.

The job therefore never expires an order whose checkout can still be paid. If Pay crashed after creating a session but before attaching it, the order expires only after that session has expired at Stripe. If the session was paid in time, the webhook still confirms the order by its claim (§9).

`getExistingRegistration` stops writing. It reports a passed hold as expired and leaves the change to the job.

---

## Changes After Paying (November): What This Spec Guarantees

The agreed model is one purchase per order record. The November work must meet these conditions:

- One unpaid order at a time per household per feis. `idx_registrations_active_unique` narrows to `draft` and `pending_payment`, and `create_order`'s "already has an active order" check becomes "already has an unpaid order".
- Any number of paid orders.
- No duplicate active (dancer, competition) entry across orders.
- One competitor number per dancer per feis (already enforced).
- The family max and once-per-family fees count earlier orders.
- Replacements and withdrawals are recorded explicitly. For example, Novice Reel → Prizewinner Reel is a replacement, not two active entries, and the original purchase stays unchanged.
- Two purchases can't use the same unused family-max allowance. The one-unpaid-order rule and the household-and-feis lock make them take turns.
- **The conflict rule for late payments changes.** Once several paid orders are allowed, another paid order is no longer a conflict by itself. A late payment conflicts only if confirming it would create a duplicate active entry, or if the family-max or once-per-family pricing it was quoted no longer holds.

"No new table" is a possible outcome, not a requirement. If an amendments table keeps the records correct, use one.

**How this spec keeps the November work possible:**
- Paid orders can't change.
- Each order has its own frozen details, claim, snapshot and payment record.
- The one-active-order assumption appears in four places, and all four change together in November:
  - the unique index `idx_registrations_active_unique`
  - `create_order`'s check
  - the automatic late-payment conflict rule in `confirm_order_payment`
  - the manual rule in `payments_admin.confirm_late_payment`

---

## Testing

### Database and concurrency tests

These run on Vitest, using node-postgres (`pg`, added as a dev dependency), against a temporary Postgres 17:
- Global setup runs `initdb` into a temporary folder and starts the server on a free port, in UTC like Supabase.
- It applies stand-ins for Supabase's `auth` schema, roles and `cron`, then every migration up to 017.
- Teardown stops the server and deletes the folder. Nothing keeps running.
- The command is `npm run test:db`.
- Parent tests switch to the real `authenticated` role with JWT claims.
- Every test checks the resulting database state, not just error messages.

**Permissions:**
- A parent can read their own orders, entries and snapshots, and can't read another household's.
- A parent can't:
  - mark an order paid
  - add an entry
  - change a price, total or status
  - write a snapshot
  - run any app or admin function

  After each refused write, the rows are unchanged.
- The effective policies equal the expected list exactly.
- `anon` and `authenticated` hold no write privileges, including column-level grants. Row-level security is on, and `TRUNCATE` is refused for every role.
- `payments_admin` isn't reachable by `anon`, `authenticated` or `service_role`.

**Immutability:**
- Entries can't be added, changed or deleted after `create_order`, even on a draft.
- Amounts and `purchase_snapshot` can't change.
- Orders can't be deleted.
- Illegal status changes are refused.

**Atomic creation:** if the entries don't match the snapshot or the totals, nothing is created.

**Concurrency and crash cases:**

| Test | Expected |
|---|---|
| Two confirmations run at the same time | One fulfilment, one snapshot, one notification row |
| Submit races a late payment for the same family and feis | Either the late payment is confirmed and Submit is refused, or Submit wins and a `late_payment_conflict` case is recorded. Nothing is lost and nothing fails unhandled. |
| Pay races Cancel | One consistent end state, and no payable session the order doesn't know about |
| Two Pay clicks | One claim, one session |
| Cancel while Pay's create request may still be running (an in-progress 409 for the same key) | Cancel keeps the order and says to try again. Once the session exists, Cancel expires it and then cancels. |
| A cached 500: Stripe made the session but keeps answering 500 for the key | Pay finds the session by listing and resumes it; Cancel finds it and closes it |
| A recovered session is already complete (Cancel, or Pay after the order moved on) | Confirmed, or recorded as a case; never treated as expired |
| A claim that never produced a session | The order is kept until that's established (10 minutes), then cancelled |
| Pay crashes after Stripe creates the session, before attaching it | The next Pay or Cancel adopts the claim and recovers the session, or the webhook confirms by claim |
| Snapshot or numbering fails during confirmation | Everything rolls back, and a retry then succeeds |
| An email is accepted and the worker crashes before recording it | The retry uses the same key and Resend deduplicates it. After 23 hours the notification becomes `needs_check`. |
| An alert that may not have been delivered becomes `needs_check` | No further alert is raised |
| An old worker finishes after a newer claim | Refused; the newer claim stands |
| A profile changes after Submit | The snapshot and purchased entries are unchanged |
| Checkout across the deadline | Allowed within the hold. Refused if the organiser stopped registration before the claim; a checkout claimed before the stop may finish. |
| Expiry notice for an old session arrives after the order is paid | No change |
| Late payment confirmed while email isn't configured | The notification stays `pending` and no attempts are used |

The Pay, Cancel and email cases use small fakes of Stripe and Resend, plus a clock the tests control. The fakes follow the real idempotency rules: the same key with the same parameters returns the stored result, and a changed parameter is an error.

### Unit tests (Vitest)

- order validation
- the purchase snapshot builder
- the checkout config builder (deterministic for an order and claim)
- the deadline and organiser-stop policy
- consent IP parsing
- the TypeScript state table, matched against the trigger's table
- the notification backoff, claim and outcome rules

### Live verification

The parent permission tests run on the live project with controlled test identities. They run inside a transaction that always rolls back, using the `apply_migration` plus final `RAISE` pattern from the feis-day repo's `supabase/tests/032_phase1_rpc_tests.sql`.

### End to end in Stripe test mode

This runs with the real Stripe setup, using test keys and a connected test account. It covers:
- paying
- backing out and paying again (resuming the same session)
- double-clicking Pay
- cancelling mid-checkout (the old link stops working)
- letting the session expire
- delivering the same event twice
- delivering the webhook late, after the expiry job has run
- an expiry notice for an old session

**Done** means all of the above pass, along with `npm test` and `npm run build`.

---

## Rollout

1. **Live check (read-only).** Look at:
   - the policies and grants on the three order tables
   - whether the parked pay-at-door objects from 011 exist
   - the cron jobs
   - any duplicate snapshots or duplicate payment intents
   - the number of orders by status
   - unpaid orders without `purchase_snapshot`
   - row-level security, column-level grants and `TRUNCATE` on the three order tables
   - any `confirmed` orders, or a status check that allows them (from 011)
   - the live `STRIPE_APPLICATION_FEE_PERCENT` value

   Adjust the migrations to what's there. If the 011 trigger or functions exist, 012 removes them. Duplicates are resolved before the unique keys are added. Then rehearse 012–017 on a copy of the live data before applying them for real.
2. **Existing orders.**
   - Unpaid orders (`draft` and `pending_payment`) can't have a `purchase_snapshot`, because the column is new. Step 1 confirms that no feis has taken real registrations and that none of these orders has an open Stripe session; with Stripe still simulated, none can. 012 then expires them.
   - Paid orders keep `purchase_snapshot = NULL`. No purchase record is made up for them, and Launch keeps reading live data for those orders.
   - From now on, a check constraint requires a `purchase_snapshot` on every `draft` or `pending_payment` order.
3. **Build** on branch `payment-hardening`, with every test passing locally.
4. **Set environment variables** on Vercel:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PAYMENTS_ALERT_EMAIL`
   - `NOTIFICATIONS_CRON_SECRET`

   The Stripe and Resend keys come with their own items.
5. **Apply 012–017, deploy straight after, then schedule the notification job.** The old code can't write under the new permissions, so the migration and the deploy go out together. If the deploy fails, registration stays shut until a fixed deploy goes out. There are no real registrations yet, so there's nothing to roll back.
6. **Run the live verification** and record the result here. It includes checking that the organiser entries view works under the new policies.

---

## Decisions (Daniel, 2026-10-16)

1. **Payment alerts** go to both Daniel and Steve to start. `PAYMENTS_ALERT_EMAIL` takes a comma-separated list.
2. **Test database:** a local Postgres through Homebrew (`postgresql@17`, installed). Each run starts its own temporary server and removes it afterwards.
3. **Cards only:** cards, Apple Pay and Google Pay. No bank debits for now.
4. **Retry schedule:** pg_cron with pg_net, every 5 minutes.
5. **Deadline policy (proposed in revision 2; Daniel or Steve may change it):** a submitted order can be paid within its hold even if the deadline passes. When the organiser closes registration, new checkouts stop.
6. **Consent record:** each order records the consent checkbox wording (`consent-2026-10-16b`: "I'm the parent or guardian of these dancers, or I'm entering them with their parent or guardian's permission", since a family friend or guardian sometimes enters a child), the RunFeis terms and privacy pages (`runfeis-terms-2026-10-16/privacy-2026-10-16`), and the feis's own terms link. Bump the versions whenever the wording or pages change.
7. **Private order details:** organisers (and parents' database role) can't read a parent's IP address or the order's checkout details.

## Dependencies

- **Supabase connector** reconnected to the RunFeis organisation, for the live check, applying 012–017 and the live verification. Otherwise Daniel pastes the SQL in.
- **Vercel connector** reconnected to the cgds-projects team, for the environment variables. Otherwise Daniel sets them.
- **Resend.** Emails are only sent once Resend is configured (the domain and email item). Until then they wait as `pending` without using up attempts (§12), and alerts can be seen in the logs and in `payment_exceptions`.
- **Stripe test keys and a connected test account** (the real Stripe item), for the end-to-end run.
