# Payment Hardening

**Date:** 2026-10-16
**Status:** Revision 5: add-on orders and $0 orders come into scope before go-live (see "Changes in Revision 5"). Revision 4 was the implementation baseline for Tasks 1–15, which are built on branch `payment-hardening`; revision 5 changes migrations 012–017 in place (they aren't applied live yet) and the app. Revision 3 made the three payment-correctness fixes, and revision 2 answered the review of revision 1. The implementation plan is `docs/2026-10-16-payment-hardening.md`.
**Goal:**
- An order counts as paid only when three things are true:
  - The right amount reached the Stripe account the order was bound to.
  - It paid for exactly the entries the server priced.
  - Every step of confirmation succeeded together.
- An order that costs nothing is confirmed by the database through the same all-or-nothing steps, with no payment.
- Every family who is charged ends up either confirmed or in a recorded review case with a reference number. Nobody is charged and forgotten.

---

## Changes in Revision 5

Add-on orders went live on `main` (commit `0670edb`, migration `019_add_on_orders.sql`) while this work was being built. That version writes the order tables directly and bypasses the protections below, so it can't be kept. Daniel decided (2026-10-17) to rebuild add-ons here before go-live, on the model this spec had agreed for November, including $0 add-ons confirmed without Stripe (Decisions 8–13).

| Change | Where |
|---|---|
| `main` is merged into `payment-hardening` first. That brings 019 byte-identical, `summarisePaidOrders` and `prior`, and the add-on screens. The same series then removes `confirmFreeOrder`, `src/lib/confirmation-number.ts` and every direct write to the order tables | Rollout step 3 |
| Add-on orders are in scope: a family that has paid can add dances or dancers as a new order while registration is open. Replacing or withdrawing an entered dance stays out | Scope, §14 |
| One unpaid order per family per feis and any number of paid ones. 012–017 require 019's index and never create or drop it. A new last migration, `020_assert_unpaid_index.sql`, refuses to apply unless the index is 019's | §2, §14, Rollout |
| `create_order` refuses only when an unpaid order exists. It refuses a dance already in a paid order, a total of 1–49 cents, and a price whose counted paid orders aren't exactly the family's paid orders now. The refusal `active_order_exists` is renamed `unpaid_order_exists` (in the SQL, `order-store.ts` and `REFUSAL_MESSAGES`) | §4 |
| Prices count earlier paid orders: the family fee once, no second late fee for a dancer, and the family max and late-tier max across orders. `purchase_snapshot.pricing.prior` freezes which orders were counted and what they counted, in an exact shape that `create_order` rebuilds and compares | §4 |
| A $0 order is confirmed without Stripe by `confirm_free_order`. Only a $0 draft may become paid without a claim and session, and every move into `paid` happens inside `_fulfil_order` (`pre_registration.fulfilling_order` marker). Totals of 1–49 cents are still refused | §3, §4, §6 |
| The automatic late-payment rule for several orders: a conflict when another unpaid order exists, or when an order was paid after this one was priced. Other lapsed holds expire first. The relabel branch and its tests are removed, since after 019 a move into `paid` can't hit the index | §9 |
| The admin rule for several orders: every other order must be paid and counted, cancelled, expired, or an unclaimed draft, which is cancelled. A newer order that reached checkout and expired unpaid no longer blocks | §11 |
| The entry page, the add-on receipt, My entries, the success page and the email handle several orders per feis. One pure function, `canStartOrder`, decides when a new order (a first order or an add-on) can start, and blocks it while message A is open | §12, §14 |
| The runbook (`docs/runbooks/payment-exceptions.md`) is updated: the "a newer order" wording, step 3a's conditions, the new admin rule, and $0 orders. `CLAUDE.md`'s rule that only `confirm_order_payment` marks an order paid also names `confirm_free_order` and `payments_admin.confirm_late_payment` | §11, §6 |
| Tests and rollout cover add-ons and $0 orders. The test database applies 019 and 020, as live will have them | Testing, Rollout |

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
| 2. An expired checkout doesn't prove the competing order was unpaid | §11: the admin confirmation never replaces an order that reached checkout, unless it was cancelled through Cancel (superseded in revision 5 by Decision 12); those cases are refunded. It closes its case as `confirmed_late_payment` in the same transaction. |
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
- Add-on orders: adding dances or dancers after paying, as a new order (§14).
- Confirming a $0 order without Stripe (§6).
- Tests:
  - database and concurrency tests on a local Postgres
  - unit tests
  - live verification
  - an end-to-end run in Stripe test mode

**Out (planned elsewhere):**
- Automated refunds, and withdrawals the family starts themselves. These wait on Steve's policy.
- Replacing or withdrawing a dance after paying (for example Novice Reel → Prizewinner Reel). Add-ons only add; a change to an entered dance stays a manual matter for the organiser (§14).
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
| Add-on order | A later order by a household that already has a paid order for the feis, for just what's added | a `registrations` row |
| Counted orders | The paid orders an order's price counted, frozen when the order was created | `purchase_snapshot.pricing.prior` |
| Event participation | All of a household's paid orders for a feis | derived |
| Active entry | An entry of a paid order. With no withdrawals or replacements yet, every one is active | derived |

**Attempts:**
- An order gets at most one claim. A claim produces at most one Stripe session, because it has one idempotency key and one frozen request.
- "The same attempt" means the same order and claim. Retries replay it.
- "A new attempt" means a new order. Paying again after an order expires or is cancelled always starts a new order.

---

## What's Wrong Today

These were verified in the repo on 2026-10-16, and row 12 on 2026-10-17. The live database is checked in Rollout step 1.

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
| 12 | Add-on orders (live on `main` since `0670edb`) confirm a $0 order with direct service-role writes and no lock, check for a dance already paid for only in TypeScript, and price earlier orders from what was read before the order was created. | `actions.ts` (`confirmFreeOrder`, `createDraftRegistration`) |

**Already correct, and kept:**
- Server-side pricing (`calculateFees` with the feis's own fee settings), including `main`'s counting of earlier orders (`summarisePaidOrders`).
- Ownership checks in all four actions.
- Webhook signature verification.
- `UNIQUE (registration_id, dancer_id, feis_competition_id)` on entries.
- One competitor number per dancer per feis.
- One unpaid order per family per feis: `idx_registrations_active_unique` as 019 narrowed it, to `draft` and `pending_payment`.

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
- `confirm_free_order`
- `record_payment_failure`
- the notification functions (§12)

TypeScript makes the Stripe and Resend calls between these functions, and calls the functions through `supabase.rpc(...)` with the service role. No TypeScript writes order tables directly.

**Locks:**
- A function that changes an order first locks that order's row (`SELECT … FOR UPDATE`). It then checks the status and the claim it expects.
- Some functions create an order or make one paid: `create_order`, `confirm_order_payment`, `confirm_free_order` and `payments_admin.confirm_late_payment`. Each changes what the family's next order counts (§4). These take a transaction lock on the (household, feis) pair first, with `pg_advisory_xact_lock` on a hash of both IDs.
- So Submit, a late payment and a $0 confirmation for the same family and feis always run one after the other.
- Lock order is always pair, then row, so the functions can't deadlock each other.

**Function security:**
- Every function is `SECURITY DEFINER` with `SET search_path = pre_registration, pg_temp`.
- Every function has `REVOKE ALL … FROM PUBLIC`.
- `EXECUTE` goes only to the role that needs it:
  - `service_role` for app functions
  - `authenticated` for the parent view function (§10)
- Admin functions live in a separate schema, `payments_admin`, which the API doesn't expose. `USAGE` on that schema, and `EXECUTE` on each function, are revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, so only `postgres` (the SQL editor) can run them.

### 2. Database permissions

**The three order tables** (registrations, entries and snapshots):
- Migration `012_order_integrity.sql` drops every existing policy on them. This work ships as migrations 012–017, split by concern; see the implementation plan. Migration 018 belongs to the separate schools work, 019 to add-on orders (from `main`, already live), and 020 is this work's index check (below), so any extra migration starts at 021. 012 loops over `pg_policies`, so a policy applied by hand can't survive.
- 012–017 require 019's definition of `idx_registrations_active_unique` (on `(feis_listing_id, household_id)` where status is `draft` or `pending_payment`) and never create or drop the index. Their functions decide conflicts with explicit checks (§4, §9, §11). They apply cleanly whether 019 runs before them (live) or after them (the test database applies files in name order).
- `020_assert_unpaid_index.sql` raises an error unless `idx_registrations_active_unique` has exactly 019's definition. It runs last either way: live after 012–017, and in tests after 019.
- It then creates exactly two policies on each:
  - parent `SELECT` on their own household's rows (`auth_household_id()`)
  - organiser `SELECT` for their own feiseanna
- Every privilege is revoked from `PUBLIC`, `anon` and `authenticated`. `authenticated` then gets `SELECT` back: table-level on entries and snapshots, and column by column on `registrations` (below). On Postgres 17 a list of named privileges would leave `MAINTAIN`, which can lock the table.
- 012 turns row-level security on for the three tables itself, instead of trusting earlier migrations, because the live database was migrated by hand.
- `TRUNCATE` is revoked from the service role and refused by a trigger for every role, so it can't get around the delete rules.
- `authenticated` reads `registrations` column by column. `consent_ip` and `checkout_config` are left out (Decision 7), so neither organisers nor parents can read a parent's IP address or the checkout details. The service role and the payment functions still can. App code reads orders through one shared column list, never `*`, and a test keeps that list equal to the grant.

**The new tables** (`payment_exceptions`, `notifications` and `admin_actions`):
- They have no policies for `anon` or `authenticated`, and get the same revokes. Only the service role and the functions can use them.
- `admin_actions` is revoked from the service role as well. The app never touches the audit trail, so only the admin functions (§11) write it, and the app's key can't rewrite or erase it.
- Parents see their review cases only through `get_my_payment_reviews` (§10).

**Profiles:** parents keep full control of `households`, `dancers` and `dancer_dance_levels`. Profile edits never change an existing order (§3).

### 3. Immutability and the state machine

Once `create_order` commits, the order's contents are fixed for good, even while the order is still a draft. That covers:
- its entries
- its amounts
- `purchase_snapshot`
- its consent record
- its household and feis

Changing anything means cancelling and starting a new order. The entry page can pre-fill the new one. Adding dances after paying is a new order too (§14); the paid order never changes.

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
  - Moving into `paid` happens only inside `_fulfil_order`. It reuses the snapshot marker `pre_registration.fulfilling_order`: `_fulfil_order` sets it to the order's ID before its paid update, and clears it after the snapshot insert. The trigger requires the marker to name the order for any move into `paid`, and checks it after the status-table check, so an illegal move still gets the status message. The move also needs `paid_at` and the confirmation number, and then either:
    - the claim and the session, for an order whose total is above 0, or
    - for a $0 order, no claim, session, payment intent or charge at all, and the move must be from `draft`. This is the one relaxation, for free orders (§6). `claim_checkout` never claims an order under 50 cents, so a $0 order can't have a claim.
  - Moving into `pending_payment` needs the claim and the session.
- **Snapshots:** an insert is allowed only at confirmation, for an order marked paid in that same transaction. Updates and deletes are refused.
- **Status:** a change must follow this table.

| From | To | Made by |
|---|---|---|
| draft | pending_payment | `attach_checkout_session` (the claim must match) |
| draft | cancelled | `cancel_order`; `confirm_free_order`, for its own $0 draft when the counted orders no longer hold (§6); `payments_admin.confirm_late_payment`, for the family's unclaimed drafts (§11) |
| draft | expired | the expiry job; `create_order` or `confirm_order_payment`, for this household's lapsed order for the feis (§4, §9); `expire_checkout` for this order's own claim (§8); `record_payment_failure` for this order's own claim |
| draft | paid | `confirm_order_payment`, when the payment came through the order's own claim before the session was attached (Pay crashed in between); or `confirm_free_order`, for a $0 order (§6) |
| pending_payment | paid | `confirm_order_payment` |
| pending_payment | cancelled | `cancel_order`, after the caller has closed the Stripe session |
| pending_payment | expired | the expiry job; `create_order` or `confirm_order_payment`, for this household's lapsed order for the feis; `expire_checkout` for this order's own session; `record_payment_failure` for this order's own claim |
| expired | paid | `confirm_order_payment` (a late payment on the order's own claim that passes §9's late-payment rule) or `payments_admin.confirm_late_payment` (§11) |

`paid` and `cancelled` are final in this spec. A payment against a cancelled order is refunded (§11). `canTransitionRegistration()` in TypeScript holds the same table, and a unit test keeps the two in step.

### 4. Submit (`createDraftRegistration` → `create_order`)

**In TypeScript:**
1. Authenticate, then load the household with the user's own client; this proves ownership. Check the household is complete (existing check).
2. Load the listing, fee schedule, competitions, the dancers with their levels, and the family's paid orders for this feis with their entries.
3. Run `validateOrderRequest`, a pure function. Each failure has its own message:
   - The listing's `status` is `'open'`.
   - `reg_opens_at ≤ now ≤` the close date (`late_reg_closes_at` if set, otherwise `reg_closes_at`).
   - There's at least one entry, with no duplicate pairs.
   - No (dancer, competition) pair is already in one of the family's paid orders for this feis ("Aoife is already entered in Reel. Reload this page to see your entries.").
   - Every dancer belongs to this household and is active.
   - Every competition belongs to this feis and is enabled.
   - Every (dancer, competition) pair passes `getEligibleCompetitions`, judged against every competition of the feis so that a dancer stays in their own age group. It uses the listing's `age_cutoff_date` (or 1 January of the feis year when none is set) and `syllabus_snapshot.levels`, exactly as the entry page does.
4. **Count earlier orders.** `summarisePaidOrders` (ported from `main`, but taking each earlier entry's own family-max flag rather than one flag per competition) works out what the family's paid orders for this feis already covered, and `calculateFees` takes it as `prior`, with `main`'s semantics:
   - **Event fee:** the family fee is charged once. An add-on charges it only if no earlier paid order charged one, that is, no counted order has `event_fee_cents > 0` (Decision 11).
   - **Family max:** entry fees already paid that count toward it are counted, and this order gets only what's left of the max.
   - **Late fees:** a dancer already charged a late fee isn't charged again, and the late tier's family max counts the late fees already paid.
   - Day-of surcharges are never charged at pre-registration, so there's nothing to count.
   - Whether an earlier entry counted toward the family max is read from that order's own purchase snapshot. An older paid order without one (made before this work went live) uses the competition's current setting.

   A family's first order has nothing to count, and is priced as before.
5. Price with `calculateFees`, then build `purchase_snapshot` with `buildPurchaseSnapshot` (pure). The snapshot holds:
   - **Each dancer:** ID, names, school, TCRG name, date of birth, gender, championship status, dance levels, and competition age at the cutoff.
   - **Each competition:** ID, display code, display name, age group with its label and age bounds, level and dance with their labels, type, championship key, the grades-only and family-cap flags, fee category and fee.
   - **Each entry:** dancer, competition, and its base, late and day-of fees.
   - **Pricing:** the fee schedule as used, the full breakdown, and `priced_at`.
   - **Counted orders:** `pricing.prior` records exactly what step 4 counted, in the shape below. Any order's price can then be explained from its own snapshot.
   - **Rules:** the age cutoff, the syllabus levels, the consent and terms versions, the feis's own terms link, and the `PRICING_VERSION` and `ELIGIBILITY_VERSION` constants. `PRICING_VERSION` becomes `pricing-2026-10-17`, because prices now count earlier orders.

   Dance selections, such as a championship set piece, aren't collected yet. When they are, they go in the snapshot too.

   `PurchaseSnapshot.version` stays 1: `pricing.prior` is a new field, and the snapshot has no readers that depend on its absence.

   The application fee is `STRIPE_APPLICATION_FEE_PERCENT` of the total, worked out in whole basis points and rounded to the cent. If the percentage is missing or out of range, Submit stops instead of pricing the order wrongly.

   If the priced total is 1 to 49 cents, Submit refuses with "This order is too small to pay by card. Please contact the organiser." and creates nothing, since Stripe's card minimum is 50 cents. `create_order` refuses it too (Decision 10). A total of 0 is allowed: it's typically an add-on once the family max is reached, and Pay confirms it without Stripe (§6, Decision 9).

   **The counted-orders record.** `pricing.prior` is null for a family's first order. Otherwise it is exactly:
   ```
   { orders: [{ id, confirmation_number, event_fee_cents,
                entries: [{ dancer_id, competition_id, base_fee_cents, late_fee_cents, counts_toward_family_cap }] }],
     event_fee_paid, cappable_paid_cents, late_fee_dancer_ids, late_fees_paid_cents }
   ```
   - `orders` are the family's paid orders for this feis, sorted by `id`. Each order's `entries` are sorted by (`dancer_id`, `competition_id`), and `late_fee_dancer_ids` is sorted ascending.
   - The comparison is exact `jsonb` equality, so both sides follow three rules:
     - Every key is always present, with null when there's no value. For example, `confirmation_number` can be null on a legacy paid order.
     - `late_fee_dancer_ids` has no repeats.
     - The SQL side orders by the `uuid` values. TypeScript sorts the lowercase ID strings with plain `<` comparison, never `localeCompare`; that gives the same order.
   - `counts_toward_family_cap` is `NOT exclude_from_family_cap` for that competition as frozen in the paid order's own `purchase_snapshot.competitions`. For an older paid order whose snapshot is null, it's `NOT feis_competitions.exclude_from_family_cap` as set now.
   - The four figures are `main`'s `PriorPaidFees`: `event_fee_paid` is true when any counted order has `event_fee_cents > 0`; `cappable_paid_cents` sums the base fees of the entries that count toward the family max; `late_fee_dancer_ids` lists the dancers with a late fee above 0; and `late_fees_paid_cents` sums every late fee.
6. Record consent on the server. The browser sends only `consentAccepted: true`. The server sets the time and reads the IP from the request headers. The consent version names the checkbox wording, and the platform terms version names the RunFeis terms and privacy pages. Each changes in the same commit as the wording or page it names.

**In the database:** `create_order(household_id, feis_listing_id, order jsonb)` runs as one transaction:
1. Take the household-and-feis lock.
2. Re-check that the listing is `open` and inside its window.
3. Refuse with `amount_too_small` if the total is 1 to 49 cents.
4. Expire this household's unpaid orders for this feis whose hold has passed, by the same rule as the expiry job.
5. Refuse with `unpaid_order_exists` if this household still has an order for this feis that is neither paid, expired nor cancelled. In practice that's a `draft` or `pending_payment` order, the orders 019's index allows only one of. A leftover `confirmed` order from 011 refuses too, rather than being priced around. Paid orders don't refuse: they're counted.
6. Rebuild the counted-orders record in SQL from the rows of this household's paid orders for this feis, by the rules above, and refuse with `paid_orders_changed` unless it equals the payload's `pricing.prior` as `jsonb` (both null when there are no paid orders). This catches an order paid between Submit's read and now, such as a late payment, and any record that was built wrongly.
7. Refuse with `already_entered` if any requested (dancer, competition) pair is in one of those paid orders.
8. Insert the order: `draft`, the totals, the application fee, the event fee, `is_late`, consent, `purchase_snapshot`, and `hold_expires_at = now() + 30 min`. Then insert its entries.
9. Check all of these. Any difference aborts everything:
   - The entries match `purchase_snapshot` exactly: the same dancer–competition pairs and the same per-entry fees.
   - The order's totals equal the snapshot's breakdown: the total is the event fee plus the entry fees minus the family-max saving. Counting earlier orders doesn't change this check, because the breakdown's event fee and saving already reflect them.
   - The once-per-family rules hold against the counted orders:
     - The event fee is 0 when a counted order paid it, and otherwise is the frozen schedule's event fee.
     - No dancer the counted orders charged a late fee is charged one here, and no dancer is charged more than one here.
     - The family-max saving is what the frozen family max leaves after the counted orders: `max(0, this order's capped entry fees − max(0, family max − counted capped fees))`, or 0 when there's no family max.

     The late tier's family max is left to `calculateFees`, which is unit-tested, as it is within a single order today.
   - The late flag, the consent and terms versions, and the dancers and competitions are checked as before.

The refusals have their own messages:
- `amount_too_small`: "This order is too small to pay by card. Please contact the organiser."
- `unpaid_order_exists` (revision 4's `active_order_exists`, renamed in the SQL, `order-store.ts` and `REFUSAL_MESSAGES`): "You already have entries waiting for payment at this feis. Reload this page to see them."
- `already_entered`: "One of these dances is already entered and paid for. Reload this page to see your entries."
- `paid_orders_changed`: "Your entries for this feis changed while you were choosing. Reload this page and check the total."

Nothing is visible to other requests until the transaction commits, and nothing needs cleaning up on failure.

### 5. Deadlines and organiser stops

- **The deadline.** A submitted order is a fixed quote, and the family can pay it within its hold even if the registration deadline passes in between:
  - They have 30 minutes from Submit to press Pay.
  - Once they press Pay, they have 60 minutes to pay. The hold runs 15 minutes longer only as an internal buffer for reconciling late payment notices; checkout isn't open for longer.
  - Prices are never recalculated.

  For example, a family submits at 11:58 pm for an 11:59 pm deadline, presses Pay at 12:05 am, and pays at 12:20 am. Their order is confirmed at the price they were quoted. Submit itself is refused after the deadline.
- **The organiser stops registration.** If the organiser closes registration (the listing is no longer `open`), or disables a competition that's in the order, no new checkout starts. Pay says "Registration has been closed by the organiser". It changes nothing, and the draft expires with its hold. `claim_checkout` makes this decision under its locks. A successful claim is the boundary: once a checkout is claimed, that attempt may finish even if registration closes afterwards.
- **A checkout that's already open** can still be paid until it expires (at most 60 minutes), and is confirmed normally. If the whole event is cancelled, the organiser refunds through Stripe (§11).
- **A $0 order** follows the same rules. It can be confirmed within its hold even if the deadline passes in between, and the organiser stop applies until the moment it's confirmed, which is its boundary in place of a claim (§6).
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
   - **`draft` with a total of 0:** go to step 3a. A $0 order never claims a checkout.
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

     `claim_checkout` still blocks any total under 50 cents (`amount_too_small`), so a $0 order can never be claimed.
3a. **Confirm a $0 order without Stripe.** Call `confirm_free_order(order_id, household_id)`. It takes the household-and-feis lock, then locks the order's row, and returns one of these:
   - `not_found`: there's no such order in this household.
   - `already_confirmed`: the order is already paid (a second click).
   - `not_confirmable`, with `hold_expired`: the order isn't a `draft` with a total of 0, no claim, and an unexpired hold.
   - `blocked`, with `reason`: the organiser has stopped registration (`organiser_stopped`) or disabled one of the order's competitions (`competition_unavailable`). Nothing changes. These are the only blocks: a missing Stripe account doesn't block a $0 order, and nor does the card minimum. The listing is locked `FOR UPDATE` for this check, not `FOR SHARE` as in `claim_checkout`, because `_fulfil_order` then locks it `FOR UPDATE` for numbering, and upgrading from a share lock would deadlock two $0 confirmations at one feis.
   - `paid_orders_changed`: the counted orders no longer hold (§9, rule (b)). The draft is cancelled. This can't happen while the order is unpaid, but it's checked anyway. No money moved, so there's no case.
   - `confirmed`: the order is fulfilled through `_fulfil_order`, with no Stripe details and an amount of 0. That's the same all-or-nothing steps as §9.6:
     - the order becomes `paid`, with `paid_at` and a confirmation number
     - the snapshot is written, and its payment part has an amount of 0, currency `usd`, and no session, payment intent, charge or account
     - any dancer without a number at this feis gets one
     - the confirmation email is queued with key `confirmation:<order id>`

   Pay maps these results as follows:
   - `confirmed` and `already_confirmed` → "paid". Pay tries to send the notification as a best effort, as after any confirmation, and the entry page sends the family to the success page for this order.
   - `blocked` → "blocked", with `claim_checkout`'s message for that reason.
   - `paid_orders_changed` → "start again", with `create_order`'s `paid_orders_changed` message.
   - `not_confirmable` → "start again".
   - `not_found` → an error.

   `confirm_free_order` is executable by the service role only.
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
4. **State checks.** First, the family's other unpaid orders for this feis whose hold has passed are expired, by the same rule as the expiry job and `create_order`. A family who started again isn't held up by a hold the job hasn't ended yet. Then two rules apply:
   - **(a) No other unpaid order.** The family has no other order for this feis that is neither paid, expired nor cancelled (in practice a `draft` or `pending_payment` order). That order was priced without this payment, may repeat its dances, and can be paid at any moment.
   - **(b) The price still holds.** Every other paid order of the family for this feis is one this order counted (`purchase_snapshot.pricing.prior.orders`). An order without a purchase snapshot, or whose snapshot has no `prior`, counted none.

   Why (b) is enough: paid orders never change and never stop being paid, and `create_order` checked, under the same lock, that the counted orders were exactly the family's paid orders. So (b) means no order has been paid since this one was priced. Its entries repeat no paid entry, and the event fee, family max and late fees it was quoted are still right. Another paid order is no longer a conflict by itself.

   How each state is judged:
   - A `draft` with this claim, or `pending_payment`, is fine if (b) holds. (b) can't fail while an order is unpaid: (a) stops late payments while it exists, `confirm_late_payment` cancels or refuses around it (§11), and a $0 confirmation is only ever for the one unpaid order itself. It's checked anyway, and a failure is recorded as `late_payment_conflict`.
   - An `expired` order is fine only if (a) and (b) both hold. Otherwise it's `late_payment_conflict`. The case's `details.why` is an array with one item for every rule that failed, each naming the orders involved: `{ "rule": "unpaid_order_exists", "orders": [<the unpaid order>] }` and `{ "rule": "paid_orders_changed", "orders": [<the paid orders it didn't count>] }`.
   - Once a session's payment has been recorded as a `late_payment_conflict` case for this order, open or resolved, every later call for that session and order returns that case and never fulfils, even if the other order has since ended. This is checked straight after the already-confirmed check, before the payment checks. Only `payments_admin.confirm_late_payment` (§11) can confirm it.
   - A `cancelled` order, or one already paid through another session, is `order_not_payable`.
5. **Any failed check** records a case (§10) and returns its reference. The order is left exactly as it was.
6. **Otherwise, all of these happen together, or none of them do:**
   - The status becomes `paid`, the session is attached if it wasn't, and the order records `paid_at`, the payment intent and the charge ID. `hold_expires_at` is cleared.
   - A confirmation number is assigned, in the form `RF-2026-7KQ2M`, using the year in Eastern time. Older orders keep their `FT-` numbers.
   - The snapshot is written, built from `purchase_snapshot` plus the payment details. Snapshots have `UNIQUE (registration_id)` and are immutable.
   - Competitor numbers are assigned with `_assign_numbers_for_registration`.
   - The confirmation email is queued with key `confirmation:<order id>`. The recipient is frozen from `auth.users` now.

   If any step fails, everything rolls back. The order stays as it was, and the webhook returns 500 so Stripe retries. Any uniqueness failure, such as numbering or payment reuse, rolls back the same way.

   **The relabel branch is removed.** Revision 4 caught a rejection by `idx_registrations_active_unique` here and recorded it as `late_payment_conflict`. Since 019 narrowed that index to `draft` and `pending_payment`, moving an order into `paid` can't touch it, so the branch could never run. Conflicts are decided only by the rules in step 4, under the lock. Rollout step 1 and a database test check the index is 019's.
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

**Once a message-A case is closed**, message A's "don't pay again" and "we'll email you" no longer hold. For an order whose message-A case is resolved and that has no open case, the success page says instead: "This payment has been reviewed. If you have questions, contact the organiser." The dashboard shows nothing for a resolved case, so the payments contacts email the family themselves when they close it (runbook).

**When any case is recorded:**
- An alert to the payments contacts is queued (key `exception:<id>`).
- `[PAYMENT_EXCEPTION] <support_ref>` is logged by whichever caller got the case back: the webhook, or the sync in Pay, Cancel or the success page.
- A `listing_account_changed` notice is the one case that isn't logged: the confirmation it comes with returns `confirmed`, not the case. It's still alerted, and it appears in the runbook's open-cases query until someone acknowledges it.

### 11. Resolving exceptions

Resolutions are allowed by reason. No function marks an order paid by skipping checks.

| Reason | Allowed resolutions |
|---|---|
| `late_payment_conflict` | (a) Refund the late payment in Stripe and record it. Or (b) `payments_admin.confirm_late_payment(support_ref, note)`, only under the rule below. |
| `amount_mismatch`, `currency_mismatch`, `order_not_payable`, `account_mismatch`, `claim_mismatch`, `session_mismatch`, `order_not_found` | Check the payment in the Stripe dashboard, refund it there, and record the refund. The family starts a new order if they still want to enter. |
| `payment_reused` | The payment intent is the recorded payment of another order that is already paid and confirmed, so that payment is never refunded. If Stripe shows a genuine second charge, refund that charge and record the refund. If it shows none, close as `no_action`. |
| `payment_failed` | No money moved. Close as `no_action`. |
| `listing_account_changed` | Check that the new account is right, then close as `acknowledged`. |

**Confirming a late payment by hand.** `payments_admin.confirm_late_payment(support_ref, note)` is allowed only when **all** of these hold:
- The recorded evidence passes every check in §9.3, and the payment intent isn't used by another order.
- The order is `expired`.
- Its price still holds (§9, rule (b)): every other paid order for this family and feis is one this order counted. A paid order it didn't count was paid after it was priced, so it may repeat this order's dances, or have made its event fee, family max or late fees wrong.
- Every other order for this family and feis is paid (and counted, above), cancelled, expired, or an unclaimed draft.

In one transaction, under the household-and-feis lock and after re-checking those orders, it does four things:
- It cancels the family's unclaimed drafts for the feis. They were priced without the late payment, so they couldn't be paid correctly afterwards.
- It confirms the late order through the same steps as §9.6.
- It closes the case as `confirmed_late_payment`.
- It writes an audit row that also names the counted orders.

Only (a), a refund, is allowed when (b) fails, or when another order is still unpaid and open: a draft with a claim, or a `pending_payment` order. Either of those may be paid at any moment, and it was priced without the late payment.

A newer order that reached checkout and then expired unpaid no longer blocks (Decision 12; revision 4 refused it). Confirming the late order is safe anyway: if a payment for that newer order arrives later, rule (b) turns it into a case, because the newer order didn't count the late one. The operator is never offered a confirmation whose frozen price no longer holds.

**Recording a resolution:**
- Use `payments_admin.close_exception(support_ref, resolution, stripe_refund_id, note)`.
- The resolution is one of `refunded`, `no_action` or `acknowledged`: `no_action` for `payment_failed` and `payment_reused`, `acknowledged` for `listing_account_changed`. A case closed by `confirm_late_payment` is marked `confirmed_late_payment`.
- `refunded` requires the Stripe refund ID, and no other resolution takes one. A closing without a refund adds no `stripe_refund_id` to the case's `details`.
- Every admin function refuses a note that is empty or only whitespace.
- Every admin function writes an `admin_actions` audit row: who, when, what, and the evidence.

**The runbook:** `docs/runbooks/payment-exceptions.md` walks through each reason step by step. Revision 5 updates it:
- its "a newer order" wording now allows several paid orders
- step 3a's conditions become the rule above
- reading `details.why`
- $0 orders, which never have a Stripe payment or a case

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

**Confirmation email content:** one email per order, built with the tested `renderConfirmationEmail()`. It keeps what today's email shows: the order's dances with their competition codes, and each dancer's competitor number.
- Numbers are looked up by feis and dancer (`get_notification_context`), never by order, so a dancer added to in a later order shows the number from their first.
- An add-on's email lists only that order's dances, and says they were added to the family's entry. It knows it's an add-on because its purchase snapshot counted earlier orders.
- A $0 order's email shows a total of $0.00.

**Worker claims:** `claim_notifications(limit)` gives each claimed row a new `claim_token`. A row can be claimed when:
- it's `pending` and due, or
- it's `sending` with a claim more than 10 minutes old (from a worker that crashed).

`complete_notification(id, claim_token, …)` only works if the token still matches, so an old worker can never finish a newer worker's claim.

One row that throws (its context, freeze, send or completion) doesn't stop the rest of the batch: the worker logs `[NOTIFICATION_FAILED] <id> <error>` and carries on. The row stays `sending`, so a later run takes it over after 10 minutes as it would a crashed worker's claim, with the same key.

These claim, backoff and outcome rules are database functions (migration 016), so each step is atomic. Classifying a Resend error is a pure function in `src/lib/engine/email-errors.ts`.

**Sending:** the worker sends through Resend with idempotency key `<dedupe_key>:<send_generation>`. The Resend SDK in use (6.9.4) supports idempotency keys, and Resend keeps them for 24 hours.

**Outcomes:**
- **Accepted:** mark it `sent` and save `provider_message_id`.
- **Explicit failure** (Resend rejected it, so nothing was sent): increase `send_generation`, set it back to `pending`, and wait before the next try: 5 min, 15 min, 1 h, 3 h, then 6 h, which is 6 attempts in total. After the sixth attempt it's `failed`.
  - A failed confirmation queues an alert.
  - A failed alert is only logged (`[NOTIFICATION_FAILED]`), so failures can't loop. The same applies when an alert becomes `needs_check` (below): it never raises another alert.
- **Uncertain** (a timeout, a network error or a 5xx): retry with the same key, so Resend deduplicates it, while within 23 hours of `first_attempt_at`. After that it becomes `needs_check` and an alert is raised. It's never sent again automatically. The runbook covers checking Resend's logs and resending by hand.
  - It uses the same waits and the same six attempts in total: an uncertain send that reaches its sixth attempt becomes `needs_check` too.
  - A refusal after an attempt that may have gone out (an earlier uncertain outcome, or a crashed claim that was taken over) only proves that the retry sent nothing. It's treated as uncertain: the key and `send_generation` stay as they are, and the 23-hour rule applies. The key only changes after a refusal when no earlier attempt under that key may have been delivered.

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

### 14. Add-on orders (changes after paying)

A family that has paid can come back while registration is open, and add dances for an entered dancer or enter another dancer. Each visit is a new order for just what's added, and paid orders never change. Revision 4 agreed this model for November; revision 5 builds it.

**What this spec guarantees:**
- One unpaid order at a time per household per feis, and any number of paid orders. `idx_registrations_active_unique`, which 019 narrowed to `draft` and `pending_payment`, enforces the one unpaid order. `create_order` checks it before inserting, so a family gets a clear refusal rather than an index error (§4).
- No (dancer, competition) pair in two paid orders. `create_order` refuses a pair that's already paid for (§4). Confirmation and the admin path refuse a payment whose counted orders no longer hold (§9, §11), which covers a pair paid for in between.
- One competitor number per dancer per feis (already enforced). An added dancer gets the next number, and an entered dancer keeps theirs.
- The once-per-family event fee, the family max and late fees count earlier paid orders, and each order freezes what it counted (§4).
- Two purchases can't use the same unused family-max allowance. One unpaid order at a time, the household-and-feis lock, and rule (b) in §9 make them take turns.
- With no withdrawals or replacements yet, every entry of a paid order is active.

**Out of scope: replacements and withdrawals.** Add-ons only add. Changing an entered dance (Novice Reel → Prizewinner Reel) or dropping one stays a manual matter for the organiser. When it's designed, it must be recorded explicitly: a replacement is not two active entries, the original purchase stays unchanged, and the family-max and once-per-family rules above stay right. "No new table" is a possible outcome, not a requirement; if an amendments table keeps the records correct, use one.

**Where one order per feis was assumed.** All of these change together in this revision:
- the unique index `idx_registrations_active_unique` (019, already live)
- `create_order`'s check (§4)
- the automatic late-payment rule in `confirm_order_payment` (§9)
- the manual rule in `payments_admin.confirm_late_payment` (§11)
- in the app: `getExistingRegistration` (it reads the one unpaid order, and 019 guarantees there's at most one), the entry page, the success page's choice of order, and My entries

**When a new order can start.** One pure function decides it everywhere: `canStartOrder({ listing, now, hasUnpaidOrder, hasOpenMessageA })`. It's the earlier `canAddDances`, extended to a family's first order, because a first order and an add-on are both a new order and start under the same conditions. One gate reads clearer than two that must agree.
- The entry page uses it for choosing dances and for Pay, whether or not the family has paid before.
- My entries and the paid receipt use it for "Add dances".

It's false in any of these cases:
- registration isn't open (the listing isn't `open`, or `now` is before `reg_opens_at`)
- `now` is after the close date (`late_reg_closes_at` if set, otherwise `reg_closes_at`)
- the family holds an unpaid order for the feis
- the family has an open message-A case for the feis. Message A says not to pay again, so no new order starts. That includes a first order, for example while the late payment for the family's earlier, expired order is under review (Decision 13).

**What families see.** This ports `main`'s live screens onto this branch's order model:
- **Entry page.** It loads the family's paid orders for the feis, oldest first, and their unpaid order if there is one. Paid dances show ticked and locked, marked "Entered". New choices are marked "Adding". A dancer with paid dances offers "Add dances" when `canStartOrder` allows it. Otherwise the paid dances show and nothing can be added, and a held unpaid order shows as it does today. While a message-A case is open for the feis, the page shows message A with its reference in place of choosing and Pay, and it offers no Pay for a held unpaid order either.
- **The receipt for an add-on.** It's titled "Adding to your entry", with the note "You've already paid $X for this feis. This is only for what you're adding." It lists only the new dances, priced with the same counting as Submit: no event fee line once an earlier order charged one, the family max across orders, and no second late fee for a dancer. It reads the paid orders' purchase snapshots for the family-max flags, by the same rule as Submit. Submit's price is the one that counts. If it differs, the page shows Submit's total and asks the family to check it, as it does today.
- **The Pay button's label** follows the total on screen. Before Submit, that's the receipt's estimate. Once an order is submitted, it's Submit's frozen total. At $0 the button reads "Confirm entries" instead of "Pay", and the receipt says there's nothing to pay.
- **Paid, with nothing new chosen.** The paid receipt shows the total paid across the family's orders for the feis and the latest confirmation number, with "Add dances" when `canStartOrder` allows it.
- **My entries.** Each order is its own row, newest first, with its own confirmation number and dances. An add-on's row is labelled "Added". The feis's newest paid order offers "Add dances" when `canStartOrder` allows it. A held unpaid order's row offers Pay instead. Receipt links name their order.
- **Success page.** It shows the order named by `order` (a registration ID), or, on the return from Stripe, the one named by `session_id`, or else the family's latest order for the feis. It only ever shows the family's own orders. Pay's $0 path and the entry page send the family to `?order=<registration id>`. A $0 order arrives already paid. An add-on's page says the dances were added to the family's entry and that dancers keep their numbers.
- **Confirmation email.** One per order (§12).

---

## Testing

### Database and concurrency tests

These run on Vitest, using node-postgres (`pg`, added as a dev dependency), against a temporary Postgres 17:
- Global setup runs `initdb` into a temporary folder and starts the server on a free port, in UTC like Supabase.
- It applies stand-ins for Supabase's `auth` schema, roles and `cron`, then every migration in name order, 018, 019 and 020 included, so the tests run on 019's unpaid-only index as live does, and 020's check runs after it.
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
- No order moves into `paid` without `pre_registration.fulfilling_order` naming it. An illegal move (for example `cancelled` → `paid`) still gets the status-table message, because the marker is checked after the status table.
- A $0 order can't move into `paid` with a claim, session, payment intent or charge, or from any status but `draft`. An order above 0 can't move into `paid` without its claim and session.
- `idx_registrations_active_unique` covers only `draft` and `pending_payment`, and re-applying 012–017 leaves it so. 020 raises an error when the index has any other definition.

**Atomic creation:** if the entries don't match the snapshot or the totals, nothing is created.

**Fixtures this work changes:**
- The paid marker means any test that moves an order into `paid` directly must set `pre_registration.fulfilling_order` first. That's `insertOrderDirect` (set the marker before its UPDATE), `FULFIL_SQL` in `order-integrity.test.ts`, and the direct paid update in `payment-confirmation.test.ts` around line 552.
- Legacy paid orders (a null purchase snapshot, as `main`'s live code made them) are inserted as superuser under `SET LOCAL session_replication_role = replica`, which skips the order triggers for that transaction only.
- The relabel-branch tests are removed (§9).

**Concurrency and crash cases:**

| Test | Expected |
|---|---|
| Two confirmations run at the same time | One fulfilment, one snapshot, one notification row |
| Submit races a late payment for the same family and feis | Either the late payment is confirmed first, and Submit is priced with it counted or refused (`paid_orders_changed` if Submit read the paid orders before it, `already_entered` for a dance it paid for), or Submit wins and the late payment becomes a `late_payment_conflict` case (`unpaid_order_exists`). Nothing is lost and nothing fails unhandled. |
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

**Add-on and $0 orders:**

| Test | Expected |
|---|---|
| An add-on when the family has a paid order | A new draft is created and the paid order is unchanged. `pricing.prior` names the paid order and what it counted, and the totals check holds |
| An add-on with a dance already in a paid order | Refused (`already_entered`); nothing is created |
| An add-on while the family holds an unpaid order | Refused (`unpaid_order_exists`) |
| Prior-order pricing | No event fee once a counted order paid it. The family max counts earlier capped fees. No second late fee for a dancer. The late tier's max counts earlier late fees. `create_order` refuses a payload that charges the event fee again, charges a late fee to a dancer already charged one, or saves less than the family max leaves |
| A payload whose counted orders aren't the family's paid orders now (stale or made up) | Refused (`paid_orders_changed`); nothing is created |
| A legacy paid order (null snapshot) and an add-on | The legacy order is counted from its rows, with the competition's current family-max flag, and the add-on is created |
| The same, with a payload that uses a different family-max flag for the legacy entry | Refused (`paid_orders_changed`) |
| A late payment is confirmed between Submit's read and `create_order` | Refused (`paid_orders_changed`) |
| Two add-on Submits at once | One draft; the other is refused |
| A $0 add-on (the family max is already reached) | Pay confirms it with no Stripe call: the order is paid, with a confirmation number, a snapshot whose payment has an amount of 0 and no Stripe IDs, numbers only for dancers who had none at the feis, and one confirmation notification |
| A $0 order at a feis with no Stripe account | Confirmed |
| Two Pay clicks on a $0 order | One confirmation; the second click is told it's already confirmed |
| Two families confirm $0 orders at one feis at the same time | Both confirmed, with distinct competitor numbers; no deadlock |
| A $0 order after the organiser stops registration, or after its hold | `blocked` or `not_confirmable`; nothing changes |
| `confirm_free_order` for another household's order | `not_found`; nothing changes |
| `claim_checkout` on a $0 order, and `confirm_free_order` on an order above 0 | Both refused |
| A total of 1 to 49 cents, at Submit and in `create_order` directly | Refused (`amount_too_small`); nothing is created. Totals of 0 and 50 cents are created |

**Late payments with several orders:**

| Test | Expected |
|---|---|
| A late payment for an expired add-on whose only other paid order is one it counted, with no unpaid order | Confirmed automatically |
| A late payment while the family holds an unpaid order for the feis | `late_payment_conflict` (`unpaid_order_exists`); both orders are unchanged |
| A late payment after another order was paid that it didn't count | `late_payment_conflict` (`paid_orders_changed`). `confirm_late_payment` refuses it, and a refund closes it |
| A late payment when both rules fail (an unpaid order, and a paid order it didn't count) | One case; `details.why` has both items, each naming its orders |
| A late payment while another unpaid order's hold has passed but the job hasn't run | That order expires first, and the late payment is confirmed |
| `confirm_late_payment` with a counted paid order and an unclaimed draft | The draft is cancelled and the late order confirmed, in one transaction |
| `confirm_late_payment` when a newer order reached checkout and expired unpaid | Confirmed. A payment for that newer order arriving afterwards becomes a `late_payment_conflict` case (`paid_orders_changed`) |
| `confirm_late_payment` when another order is a draft with a claim, or `pending_payment` | Refused; only a refund is allowed |
| A recorded conflict whose unpaid order has since expired | Every later call still returns the case; only `confirm_late_payment` confirms it |
| A $0 confirmation races a late payment for an expired order | The $0 order is confirmed, and the late payment is a case whichever runs first (`unpaid_order_exists` or `paid_orders_changed`) |
| A payment for a `pending_payment` add-on whose counted orders still hold | Confirmed: the normal path checks rule (b) too |

The Pay, Cancel and email cases use small fakes of Stripe and Resend, plus a clock the tests control. The fakes follow the real idempotency rules: the same key with the same parameters returns the stored result, and a changed parameter is an error.

### Unit tests (Vitest)

- order validation, including refusing a pair that's already paid for
- the purchase snapshot builder, including the counted-orders record: which orders, their figures, and family-max flags taken from each order's snapshot, or from the current competition for an order without one
- `calculateFees` with `prior`, and `summarisePaidOrders` (ported from `main` with its tests)
- the card minimum: 1 to 49 cents refused, 0 and 50 allowed
- `canStartOrder`: false when the listing isn't open, before it opens, after the close date, while an unpaid order exists, or while message A is open; true otherwise. It's also false for a family with no paid order and an open message-A case, so a first order is blocked too
- the checkout config builder (deterministic for an order and claim)
- the deadline and organiser-stop policy
- consent IP parsing
- the TypeScript state table, matched against the trigger's table
- the notification backoff, claim and outcome rules

### Live verification

The parent permission tests run on the live project with controlled test identities. They run inside a transaction that always rolls back, using the `apply_migration` plus final `RAISE` pattern from the feis-day repo's `supabase/tests/032_phase1_rpc_tests.sql`.

The same rolled-back transaction also checks, against fixture orders:
- an add-on after a paid order: its earlier order counted, and a dance already paid for refused
- a $0 add-on confirmed by `confirm_free_order`
- a late payment judged against several orders: confirmed when its counted orders hold, a case when another order was paid since

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
- an add-on paid by card, with no second event fee and the family max across orders
- a $0 add-on confirmed without Stripe
- an add-on refused for a dance already paid for
- a family whose first order's late payment is an open message-A case: the entry page shows message A and offers no way to choose or pay a new order

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
   - that `idx_registrations_active_unique` is 019's: on `(feis_listing_id, household_id)`, for `draft` and `pending_payment` only
   - add-ons made by `main`'s live code:
     - families with more than one paid order for a feis
     - any (dancer, competition) pair paid for twice at one feis
     - families with `event_fee_cents > 0` on more than one paid order for a feis (`main`'s add-on path had no lock, so it could charge the family fee twice)
     - paid orders with a total of 0 (from `main`'s free path, with no claim or session)
     - paid orders with no snapshot row (`main`'s $0 path wrote none)

   Adjust the migrations to what's there. If the 011 trigger or functions exist, 012 removes them. Duplicates are resolved before the unique keys are added. Then rehearse 012–017 and 020 on a copy of the live data, which has 019 applied, before applying them for real. The rehearsal includes an add-on and a $0 add-on.
2. **Existing orders.**
   - Unpaid orders (`draft` and `pending_payment`) can't have a `purchase_snapshot`, because the column is new. Step 1 confirms that no feis has taken real registrations and that none of these orders has an open Stripe session; with Stripe still simulated, none can. 012 then expires them.
   - Paid orders keep `purchase_snapshot = NULL`. No purchase record is made up for them, and Launch keeps reading live data for those orders. That includes paid add-ons made by `main`'s code, $0 ones among them: 012's rules apply only to later changes. A later order counts them from their entry rows and event fee, with the family-max flag read from the competition as it is set then (§4).
   - What the organiser does about each finding from step 1:
     - a pair paid for twice: it goes to the organiser before go-live
     - a family fee paid twice: refund the extra family fee in Stripe
     - a paid order with no snapshot row: nothing; this is for information only
   - From now on, a check constraint requires a `purchase_snapshot` on every `draft` or `pending_payment` order.
3. **Merge `main` into `payment-hardening` first, then build.** The merge brings 019 byte-identical, `summarisePaidOrders` and `prior`, and the add-on screens. The same series then removes `confirmFreeOrder`, `src/lib/confirmation-number.ts` and every direct write to the order tables, and adds 020. Every test passes locally.
4. **Set environment variables** on Vercel:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PAYMENTS_ALERT_EMAIL`
   - `NOTIFICATIONS_CRON_SECRET`

   The Stripe and Resend keys come with their own items.
5. **Apply 012–017 and then 020 (019 is already live), deploy straight after, then schedule the notification job.** 020 runs last: it refuses to apply unless the index is 019's, which also proves 012–017 left it alone. The old code can't write under the new permissions, so the migration and the deploy go out together. That includes `main`'s add-on code, which writes order tables directly; the deploy replaces it. If the deploy fails, registration stays shut until a fixed deploy goes out. There are no real registrations yet, so there's nothing to roll back.
6. **Run the live verification** and record the result here. It includes the add-on and $0 checks, and checking that the organiser entries view works under the new policies and lists a family's add-on entries.

---

## Decisions (Daniel, 2026-10-16)

1. **Payment alerts** go to both Daniel and Steve to start. `PAYMENTS_ALERT_EMAIL` takes a comma-separated list.
2. **Test database:** a local Postgres through Homebrew (`postgresql@17`, installed). Each run starts its own temporary server and removes it afterwards.
3. **Cards only:** cards, Apple Pay and Google Pay. No bank debits for now.
4. **Retry schedule:** pg_cron with pg_net, every 5 minutes.
5. **Deadline policy (proposed in revision 2; Daniel or Steve may change it):** a submitted order can be paid within its hold even if the deadline passes. When the organiser closes registration, new checkouts stop.
6. **Consent record:** each order records the consent checkbox wording (`consent-2026-10-16b`: "I'm the parent or guardian of these dancers, or I'm entering them with their parent or guardian's permission", since a family friend or guardian sometimes enters a child), the RunFeis terms and privacy pages (`runfeis-terms-2026-10-16/privacy-2026-10-16`), and the feis's own terms link. Bump the versions whenever the wording or pages change.
7. **Private order details:** organisers (and parents' database role) can't read a parent's IP address or the order's checkout details.

## Decisions (Daniel, 2026-10-17)

8. **Add-on orders before go-live:** a family that has paid can add dances or dancers as a new order while registration is open, with the family max counted across orders. They're rebuilt here on this spec's model rather than kept from `main`. Replacing or withdrawing a dance stays a manual organiser matter.
9. **$0 orders:** an order that costs nothing is confirmed without Stripe. This replaces revision 4's rule that refused every total under 50 cents.
10. **1–49 cents:** an order priced at 1 to 49 cents, add-ons included, is refused with "contact the organiser", both at Submit and in `create_order`.
11. **The family fee is charged once:** an add-on charges the event fee only if no earlier paid order charged one (`main`'s rule: any paid order with `event_fee_cents > 0`).
12. **Late payments after a newer order expired:** `payments_admin.confirm_late_payment` may confirm a late payment when a newer order of the family reached checkout and then expired unpaid. Rule (b) turns any later payment on that newer order into a case.
13. **No new order while message A is open:** while the family has an open message-A case for a feis, no new order for that feis can start. That covers a first order as well as an add-on. The entry page blocks choosing and paying, and "Add dances" is hidden on the entry page and in My entries. Submit and Pay also refuse on the server, with message A and its reference, so an entry page opened before the case existed (another tab, or Back from Stripe) can't start or pay an order; if the open-case check can't be read, they refuse and ask the family to try again. This extension to a first order, and the server check, are the controller's rulings.

## Dependencies

- **Supabase connector** reconnected to the RunFeis organisation, for the live check, applying 012–017 and 020, and the live verification. Otherwise Daniel pastes the SQL in.
- **Vercel connector** reconnected to the cgds-projects team, for the environment variables. Otherwise Daniel sets them.
- **Resend.** Emails are only sent once Resend is configured (the domain and email item). Until then they wait as `pending` without using up attempts (§12), and alerts can be seen in the logs and in `payment_exceptions`.
- **Stripe test keys and a connected test account** (the real Stripe item), for the end-to-end run.
