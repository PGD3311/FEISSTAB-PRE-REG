# Payment cases and emails: runbook

Who: the payments contacts, Daniel and Steve to start (their addresses go in `PAYMENTS_ALERT_EMAIL` once email is on).
Where: the Supabase SQL editor for the RunFeis project, and the Stripe dashboard (the connected account named in the case).

Every case has a reference like `PAY-7KQ2M`. The family sees it on the success page and their dashboard when
their charge went through but their registration isn't confirmed. Alerts arrive by email once email is turned on (it's paused for now; see below), and the Vercel
logs always have a `[PAYMENT_EXCEPTION] PAY-…` line.

During registration, run the open-cases query (section 1) and the stuck-emails query (section 4) routinely, for
example every day. A payment-case alert that fails to send is found only by the second query. Also watch the Vercel
logs for `[NOTIFICATION_FAILED]` lines: they mean an email failed or needs checking.

**Email is paused for now.** Resend's sender is still its sandbox address, which only delivers to the Resend account
owner, so until a sending domain is verified `PAYMENTS_ALERT_EMAIL` stays unset and RunFeis sends no email at all:
no alerts to you and no confirmations to families. The emails wait in the queue as `pending`. Meanwhile you find
cases with the open-cases query (section 1) and the stuck-emails query (section 4), and the `[PAYMENT_EXCEPTION]` and
`[NOTIFICATION_FAILED]` lines in the Vercel logs. Run both queries every day during registration: Vercel keeps its
logs only for a short time, so the queries are the record. Turning email on is in section 5.

## 1. Look up a case

```sql
SELECT e.*, r.status AS order_status, r.total_cents, h.first_name, h.last_name, h.phone, u.email
FROM pre_registration.payment_exceptions e
LEFT JOIN pre_registration.registrations r ON r.id = e.registration_id
LEFT JOIN pre_registration.households h ON h.id = e.household_id
LEFT JOIN auth.users u ON u.id = h.user_id
WHERE e.support_ref = 'PAY-XXXXX';
```

Open cases:
```sql
SELECT support_ref, severity, reason, created_at FROM pre_registration.payment_exceptions
WHERE status = 'open' ORDER BY created_at;
```

Then find the payment in Stripe: Dashboard → Connect → the account named in the case's `stripe_account_id` →
Payments → search for `stripe_payment_intent_id`, or open the checkout session `stripe_checkout_session_id`. That
account is usually the feis's, but for `account_mismatch` it is a different one, so don't assume.

For a `payment_reused` case, find the order that already holds the payment (use the case's `stripe_payment_intent_id`
for `<pi>`):
```sql
SELECT id, status, confirmation_number FROM pre_registration.registrations
WHERE stripe_payment_intent_id = '<pi>';
```

## 2. What each reason means and what to do

| Reason | What happened | Do this |
|---|---|---|
| `late_payment_conflict` | The family paid after their order expired, and they have a newer order for the same feis. | Ring or email the family. If they want the paid order and the newer order never reached checkout, confirm it (3a). Otherwise refund the late payment (3b). Once recorded, the system never confirms this payment by itself, even if the newer order later ends: only 3a does. |
| `amount_mismatch` | Stripe charged a different amount from the order total. | Refund it (3b). The family registers again. |
| `currency_mismatch` | The charge wasn't in USD. | Refund it (3b). |
| `order_not_payable` | A payment arrived for a cancelled order, or for an order already paid by a different checkout. | Refund the case's payment intent (3b), never the order's own payment: if the order is paid, that payment is the family's genuine one. |
| `payment_reused` | A payment that is already recorded on another order arrived for this one. That other order is paid and confirmed: use the lookup in section 1. | **Never refund this payment intent**: it is that order's payment. Look at this order's checkout session in Stripe. If it shows a genuine second charge, refund that charge only and record its refund ID: the one exception in 3b. If it shows none, close the case with no action (3c). |
| `account_mismatch` | A payment for this order arrived on a different Stripe account. The payer may not be this family. | Open the case's `stripe_account_id`, not the feis's account: the charge is there. Investigate in both accounts. Refund the charge in the case's account (3b). |
| `claim_mismatch` | A payment for this order came from a checkout this order didn't claim. The payer may not be this family. | Investigate. Refund the charge (3b). |
| `session_mismatch` | A payment arrived for a checkout session this order doesn't own. The payer may not be this family. | Investigate. Refund the charge (3b). |
| `order_not_found` | A payment named an order that doesn't exist. | Investigate. Refund the charge (3b). |
| `payment_failed` | A delayed payment failed. No money moved. | Close it with no action (3c). The family can register again. |
| `listing_account_changed` (notice) | The order is confirmed, but the feis has switched Stripe accounts since checkout. | Check the new account is right, then acknowledge it (3d). |

## 3. Resolve it

Every function needs a note saying what you checked and decided. Each one writes an `admin_actions` row.

**Start every note with your own name**, as in the examples below. The database records only the role that ran the
call (`admin_actions.actor` and `payment_exceptions.resolved_by` say `postgres` for anything run in the SQL editor),
never the person, so the note is the only record of who decided.

**3a. Confirm a late payment** (only `late_payment_conflict`). This cancels the family's newer unpaid order, then
confirms the paid one: confirmation number, snapshot, competitor numbers and confirmation email. The order's
`paid_at` becomes the time of this confirmation, so its competitor numbers come after every family confirmed
before now. It refuses if any other order for the family and feis is paid, or reached checkout and isn't
cancelled: a delayed payment for it could still arrive. Refund instead (3b).

This function is the only way a payment recorded as a `late_payment_conflict` case is ever confirmed. The
automatic confirmation never does it, not on the success page, not on a Stripe retry, and not after the family's
other order ends, whether the case is open or already closed.

Before you run it:
1. In Stripe, in the case's connected account (`stripe_account_id`), open the case's `stripe_payment_intent_id`. It
   must show Succeeded, with no refund and no dispute.
   - If it shows a refund, don't confirm. Close the case with 3b, using that refund's ID.
   - If it shows a dispute, don't confirm. Leave the case open and handle the dispute in Stripe first.
2. Tell the other payments contact that you are taking this case, so nobody refunds it while you confirm it.
```sql
SELECT payments_admin.confirm_late_payment('PAY-XXXXX', 'Daniel: rang the family; they want the paid order');
```
Then email the family (3e).

**3b. Refund.** Before you refund:
1. Run the case lookup in section 1 again, and check the case's `status` is still `open`. If it says `resolved`,
   someone has already closed it (refunded or confirmed): don't refund.
2. Tell the other payments contact that you are taking this case, so nobody confirms or refunds it while you refund
   it.

For every reason except `payment_reused`, refund the case's payment intent in Stripe (in the case's
`stripe_account_id`), and nothing else.

The one exception is `payment_reused`: the case's payment intent belongs to the other, confirmed order, so never
refund it. Refund only the genuine second charge you found in Stripe for this order's checkout session, and record
that charge's refund ID.

Copy the refund ID (`re_…`), then run this straight after refunding, so the case doesn't sit open for someone to
refund or confirm it again:
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'refunded', 're_...', 'Daniel: refunded the 3 Nov charge after checking');
```
The database refuses an ID that doesn't look like `re_…`, so replace the `re_...` placeholder. If the reason is one
that showed the family message A, email the family next (3e).

**3c. No action** (only `payment_failed`, where no money moved, and `payment_reused`, where Stripe shows no second
charge and the payment belongs to the other order):
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'Daniel: bank payment failed; nothing charged');
```
For a reused payment the note says what you saw, for example `'Daniel: Stripe shows one charge only, on the other order'`.

**3d. Acknowledge an account change:**
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'acknowledged', NULL, 'Daniel: organiser reconnected Stripe on 2 Nov');
```

**3e. Email the family.** After closing any case that showed the family message A (`amount_mismatch`,
`currency_mismatch`, `late_payment_conflict` and `order_not_payable`), whether by 3a or 3b, email the family yourself,
at the `email` the case lookup in section 1 shows. Message A told them "Please don't pay again… We'll email you", and
once the case is closed it disappears from their dashboard (the success page says only that the payment has been
reviewed and to contact the organiser), so this email is the only word they get. Say what you
did: confirmed, with the confirmation number, or refunded, and whether they need to register again. RunFeis never
emails about a closed case, and while email is paused it sends nothing at all, not even the confirmation after 3a, so
all contact with the family is by hand.

## 4. Emails

`pre_registration.notifications` holds every confirmation and alert. A notification is retried after waits of 5
minutes, 15 minutes, 1 hour, 3 hours and 6 hours, so there are 6 attempts in total.

| Status | Meaning |
|---|---|
| `pending` | Waiting for its next attempt (or for email to be set up). |
| `sending` | A worker is sending it. If it's been more than 10 minutes, the worker stopped and it will be picked up again. |
| `sent` | Accepted by Resend (`provider_message_id`). |
| `failed` | Nothing went out: all 6 attempts were refused by Resend, or couldn't be built or addressed (see `last_error`). |
| `needs_check` | It may have gone out, and a person must check. It is never resent automatically. See below for how it gets here. |

Only a failed or stuck `registration_confirmation` sends you a delivery-failure email. A payment-case alert (or a
delivery-failure email) that fails or gets stuck is only logged: look for `[NOTIFICATION_FAILED]` lines in the Vercel
logs (an alert held at the 23-hour mark is logged by the database instead: look in the Supabase dashboard's Postgres
logs). So run this routinely, for example every
day during registration, along with the open-cases query in section 1:
```sql
SELECT id, kind, dedupe_key, status, recipient, first_attempt_at, last_error
FROM pre_registration.notifications
WHERE status IN ('needs_check','failed') ORDER BY created_at;
```

A notification becomes `needs_check` in any of three ways. Resend remembers a provider key for 24 hours and won't
send the same key twice, so retrying is only safe inside that window:
- An uncertain delivery (a timeout, a network error, a server error, or a worker that stopped mid-send) is still
  unconfirmed 23 hours after its first attempt. It stops there, before the window closes.
- An uncertain send reaches its 6th attempt.
- Resend refuses an attempt after an earlier attempt that may have gone out. A refusal only proves the retry sent
  nothing, so it counts as uncertain and the provider key is kept, which means no second copy can go out. It then
  keeps retrying like any uncertain send and ends here at the 6th attempt or the 23 hours.

For each row from that query: search the Resend dashboard (Emails) for the recipient around `first_attempt_at`.
If it was delivered, leave it. If it wasn't, resend it with a new provider key. This works for any kind: put the
row's `id` in:
```sql
UPDATE pre_registration.notifications
SET status = 'pending', last_outcome = NULL, send_generation = send_generation + 1,
    first_attempt_at = NULL, attempts = 0, next_attempt_at = now(), claim_token = NULL
WHERE id = '<id from the query>' AND status IN ('needs_check','failed')
RETURNING id, status;
```
It returns one row, with `pending`. No row means the notification isn't `needs_check` or `failed` (it was sent, or
is being sent right now): leave it, because resending it would send a duplicate. It also means a mistyped id, so check
the id.

The resend sends the same message to the same address; if the address was wrong, add `recipient = '<corrected
address>'` to the `SET`. If it fails again, no second delivery-failure email is sent, so run the query above again.

## 5. Setting up an environment

Environment variables on Vercel:
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMENTS_ALERT_EMAIL` (comma-separated; leave it unset while email is paused, below)
- `NOTIFICATIONS_CRON_SECRET` (`openssl rand -hex 32`)
- `RESEND_API_KEY` and `EMAIL_FROM`
- `STRIPE_SECRET_KEY` and `STRIPE_CONNECT_WEBHOOK_SECRET`
- `STRIPE_APPLICATION_FEE_PERCENT` (without it Submit refuses to price an order)
- `NEXT_PUBLIC_BASE_URL` (the site's real URL; without it the links in emails and Stripe's checkout return URLs point to localhost)
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Emails stay `pending` until Resend, the sender address and the payments contacts are all set.

**Turning email on.** Until a sending domain is verified, email stays paused: `PAYMENTS_ALERT_EMAIL` is unset, so
nothing is sent and the queue waits as `pending` without using any attempts. To turn it on, before the first real
feis opens:
1. In Resend, add and verify a sending domain.
2. On Vercel, with `RESEND_API_KEY` already set, set `EMAIL_FROM` to an address on that domain and
   `PAYMENTS_ALERT_EMAIL` to the payments contacts. Redeploy so the site picks them up.
3. Everything queued then sends, up to 20 emails each time the email job runs (every 5 minutes): the confirmations for
   every order paid while email was paused, and alerts for cases you may already have closed. Check the first ones
   arrive (Resend dashboard → Emails), then run the stuck-emails query (section 4).

**The Stripe webhook.** One endpoint on the platform account, listening to events on connected accounts (a Connect
endpoint): `https://<site>/api/webhooks/stripe`, with its signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET`. It must
send these four events:
- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

The handler ignores any other event.

Schedule the email job, once per environment. First add the secret in the Supabase dashboard rather than in a SQL
snippet, because the editor saves snippets and a saved snippet would hold the secret: open Vault (under
Integrations; older dashboards list it under Database), choose Add new secret, name it `notifications_cron_secret`,
and paste the same value as `NOTIFICATIONS_CRON_SECRET`. (If you create it with `SELECT vault.create_secret(...)` in
the SQL editor instead, delete that snippet straight afterwards.) Then run this in the SQL editor, with the site's
real URL:
```sql
-- only needed if pg_cron isn't enabled yet (or turn it on in the dashboard: Integrations or Extensions page)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT cron.schedule('process-notifications', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://<site>/api/notifications/process',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifications_cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 30000
  )
$$);
```

Then check it runs. `succeeded` means the request was sent; the site's answer is in `net._http_response`
(`200` is working, `401` means the secret is missing from Vault or doesn't match, and the body says
`"paused":true` until email is set up):
```sql
SELECT status, return_message, start_time FROM cron.job_run_details d JOIN cron.job j USING (jobid)
WHERE j.jobname = 'process-notifications' ORDER BY start_time DESC LIMIT 3;

SELECT status_code, content, error_msg, created FROM net._http_response ORDER BY created DESC LIMIT 3;
```

Never add the `payments_admin` schema to the API's exposed schemas (Dashboard → Settings → API).

## 6. Orders are never deleted

The database refuses to delete orders, entries and snapshots, and refuses `TRUNCATE` of those three tables, for
every role: the service role and the table owner included (the guard triggers from migration 012). Cancel an
order, or let it expire, instead.

Removing test orders, for example after trying things out on a test feis, is the one exception. The table owner
(`postgres`, in the SQL editor) has to do it on purpose. It cannot be undone, and a wrong feis id would delete a real
family's orders, snapshots, competitor numbers, cases and audit rows, so the steps below check the feis twice and
stop if anything is off. Never do this to a real family's order.

**Step 1: preview.** This only reads. Put the test feis's id in it:
```sql
SELECT l.name, r.status, count(r.id) AS orders, sum(count(r.id)) OVER () AS all_orders
FROM pre_registration.feis_listings l
LEFT JOIN pre_registration.registrations r ON r.feis_listing_id = l.id
WHERE l.id = '<test feis id>'
GROUP BY l.name, r.status
ORDER BY r.status;
```
Read it before going on. No rows means the id is wrong. Check that `name` is the test feis and that its orders look
like test orders. Note the exact name and the `all_orders` figure.

A test feis with no name (`name` is empty in the preview) can't be reset this way: the block refuses it safely. Give it
a name first, then run the preview again:
```sql
UPDATE pre_registration.feis_listings SET name = 'Test feis'
WHERE id = '<test feis id>' AND coalesce(name, '') = ''  -- only a feis with no name
RETURNING id, name;  -- exactly one row; no row means a wrong id or a feis that already has a name
```

**Step 2: delete.** Fill in the id, the exact name from the preview (double any apostrophe: `O''Brien`), and the
`all_orders` figure as the expected count. The whole block is one statement, so it does everything or nothing. It stops with an error, before changing anything, if the
id and name don't match one feis or the number of orders isn't the number you typed. An error part-way rolls
back everything, the guards included, and there is no `BEGIN` to leave a session open holding locks:
```sql
DO $$
DECLARE
  v_listing constant uuid := '<test feis id>';
  v_name constant text := '<exact test feis name>';
  v_expected constant integer := <all_orders from the preview>;
  v_ids uuid[];
BEGIN
  SET LOCAL lock_timeout = '3s'; -- limits how long other order writes wait behind this block; it doesn't stop them waiting

  IF NOT EXISTS (SELECT 1 FROM pre_registration.feis_listings WHERE id = v_listing AND name = v_name) THEN
    RAISE EXCEPTION 'no feis has that id and that exact name: nothing was deleted';
  END IF;
  SELECT coalesce(array_agg(r.id), '{}') INTO v_ids
  FROM pre_registration.registrations r
  JOIN pre_registration.feis_listings l ON l.id = r.feis_listing_id
  WHERE l.id = v_listing AND l.name = v_name;
  IF cardinality(v_ids) <> v_expected THEN
    RAISE EXCEPTION 'expected % orders but this feis has %: nothing was deleted', v_expected, cardinality(v_ids);
  END IF;

  ALTER TABLE pre_registration.registrations DISABLE TRIGGER guard_registrations;
  ALTER TABLE pre_registration.registration_entries DISABLE TRIGGER guard_registration_entries;
  ALTER TABLE pre_registration.registration_snapshots DISABLE TRIGGER guard_registration_snapshots;
  DELETE FROM pre_registration.notifications
  WHERE registration_id = ANY (v_ids)
     OR exception_id IN (SELECT id FROM pre_registration.payment_exceptions WHERE registration_id = ANY (v_ids));
  DELETE FROM pre_registration.admin_actions WHERE registration_id = ANY (v_ids);
  DELETE FROM pre_registration.payment_exceptions WHERE registration_id = ANY (v_ids);
  DELETE FROM pre_registration.competitor_numbers WHERE registration_id = ANY (v_ids);
  DELETE FROM pre_registration.registration_snapshots WHERE registration_id = ANY (v_ids);
  -- The entries go with their orders (ON DELETE CASCADE)
  DELETE FROM pre_registration.registrations WHERE id = ANY (v_ids);
  ALTER TABLE pre_registration.registrations ENABLE TRIGGER guard_registrations;
  ALTER TABLE pre_registration.registration_entries ENABLE TRIGGER guard_registration_entries;
  ALTER TABLE pre_registration.registration_snapshots ENABLE TRIGGER guard_registration_snapshots;
END $$;
```
Run the preview again: `all_orders` should now be 0.

**Step 3: check the guards are back on** (`tgenabled` is `O` on all six rows):
```sql
SELECT tgrelid::regclass AS table_name, tgname, tgenabled FROM pg_trigger
WHERE tgrelid IN ('pre_registration.registrations'::regclass, 'pre_registration.registration_entries'::regclass,
                  'pre_registration.registration_snapshots'::regclass)
  AND tgname LIKE 'guard\_%'
ORDER BY 1, 2;
```

Don't `TRUNCATE` these tables, even as the owner: the `TRUNCATE` guards refuse it, and they stay on.
