# Payment cases and emails: runbook

Who: the payments contacts in `PAYMENTS_ALERT_EMAIL` (Daniel and Steve to start).
Where: the Supabase SQL editor for the RunFeis project, and the feis's Stripe dashboard (the connected account).

Every case has a reference like `PAY-7KQ2M`. The family sees it on the success page and their dashboard when
their charge went through but their registration isn't confirmed. Alerts arrive by email, and the Vercel
logs have a `[PAYMENT_EXCEPTION] PAY-…` line.

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

Then find the payment in Stripe: Dashboard → Connect → the feis's account → Payments → search for
`stripe_payment_intent_id`, or open the checkout session `stripe_checkout_session_id`.

## 2. What each reason means and what to do

| Reason | What happened | Do this |
|---|---|---|
| `late_payment_conflict` | The family paid after their order expired, and they have a newer order for the same feis. | Ring or email the family. If they want the paid order and the newer order never reached checkout, confirm it (3a). Otherwise refund the late payment (3b). Once recorded, the system never confirms this payment by itself, even if the newer order later ends: only 3a does. |
| `amount_mismatch` | Stripe charged a different amount from the order total. | Refund it (3b). The family registers again. |
| `currency_mismatch` | The charge wasn't in USD. | Refund it (3b). |
| `order_not_payable` | A payment arrived for a cancelled order, or for an order already paid by a different checkout. | Refund it (3b). |
| `payment_reused` | A payment that is already recorded on another order arrived for this one. | Check both orders in Stripe. Refund anything that was charged twice (3b). |
| `account_mismatch` | A payment for this order arrived on a different Stripe account. The payer may not be this family. | Investigate in both accounts. Refund the charge (3b). |
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
```sql
SELECT payments_admin.confirm_late_payment('PAY-XXXXX', 'Daniel: rang the family; they want the paid order');
```

**3b. Refund.** Refund the payment in Stripe (on the connected account), copy the refund ID (`re_…`), then:
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'refunded', 're_...', 'Daniel: refunded the 3 Nov charge after checking');
```
The database refuses an ID that doesn't look like `re_…`, so replace the `re_...` placeholder.

**3c. A failed payment:**
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'Daniel: bank payment failed; nothing charged');
```

**3d. Acknowledge an account change:**
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'acknowledged', NULL, 'Daniel: organiser reconnected Stripe on 2 Nov');
```

## 4. Emails

`pre_registration.notifications` holds every confirmation and alert. A notification is retried after waits of 5
minutes, 15 minutes, 1 hour, 3 hours and 6 hours, so there are 6 attempts in total.

| Status | Meaning |
|---|---|
| `pending` | Waiting for its next attempt (or for email to be set up). |
| `sending` | A worker is sending it. If it's been more than 10 minutes, the worker stopped and it will be picked up again. |
| `sent` | Accepted by Resend (`provider_message_id`). |
| `failed` | Nothing went out: all 6 attempts were refused by Resend, or couldn't be built or addressed (see `last_error`). An alert was sent, unless it was itself an alert. |
| `needs_check` | It may have gone out, and a person must check. It is never resent automatically, and an alert was sent (unless it was itself an alert). See below for how it gets here. |

A notification becomes `needs_check` in any of three ways. Resend remembers a provider key for 24 hours and won't
send the same key twice, so retrying is only safe inside that window:
- An uncertain delivery (a timeout, a network error, a server error, or a worker that stopped mid-send) is still
  unconfirmed 23 hours after its first attempt. It stops there, before the window closes.
- An uncertain send reaches its 6th attempt.
- Resend refuses an attempt after an earlier attempt that may have gone out. A refusal only proves the retry sent
  nothing, so it counts as uncertain and the provider key is kept, which means no second copy can go out. It then
  keeps retrying like any uncertain send and ends here at the 6th attempt or the 23 hours.

For `needs_check` or `failed`: search the Resend dashboard (Emails) for the recipient around `first_attempt_at`.
If it was delivered, leave it. If it wasn't, resend it with a new provider key:
```sql
UPDATE pre_registration.notifications
SET status = 'pending', last_outcome = NULL, send_generation = send_generation + 1,
    first_attempt_at = NULL, attempts = 0, next_attempt_at = now(), claim_token = NULL
WHERE dedupe_key = 'confirmation:<order id>';
```
For any other kind, use the `Notification` line of the delivery-failure email as the `dedupe_key`. The resend sends the same
message to the same address; if the address was wrong, add `recipient = '<corrected address>'` to the `SET`. If it
fails again, no second alert is sent, so watch the row.

## 5. Setting up an environment

Environment variables on Vercel:
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMENTS_ALERT_EMAIL` (comma-separated)
- `NOTIFICATIONS_CRON_SECRET` (`openssl rand -hex 32`)
- `RESEND_API_KEY` and `EMAIL_FROM`
- `STRIPE_SECRET_KEY` and `STRIPE_CONNECT_WEBHOOK_SECRET`
- `STRIPE_APPLICATION_FEE_PERCENT` (without it Submit refuses to price an order)
- `NEXT_PUBLIC_BASE_URL` (the site's real URL; without it the links in emails point to localhost)

Emails stay `pending` until Resend, the sender address and the payments contacts are all set.

Schedule the email job, once per environment, in the SQL editor. Use the site's real URL and the same secret:
```sql
CREATE EXTENSION IF NOT EXISTS pg_net;
SELECT vault.create_secret('<NOTIFICATIONS_CRON_SECRET>', 'notifications_cron_secret');
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
(`200` is working, `401` means the secret doesn't match, and the body says `"paused":true` until email is set up):
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
(`postgres`, in the SQL editor) has to do it on purpose, in one transaction that switches the row guards off
and back on before it commits. Never do this to a real family's order. Put the test feis's id in the first query:
```sql
BEGIN;
CREATE TEMP TABLE reset_orders ON COMMIT DROP AS
  SELECT id FROM pre_registration.registrations WHERE feis_listing_id = '<test feis id>';
ALTER TABLE pre_registration.registrations DISABLE TRIGGER guard_registrations;
ALTER TABLE pre_registration.registration_entries DISABLE TRIGGER guard_registration_entries;
ALTER TABLE pre_registration.registration_snapshots DISABLE TRIGGER guard_registration_snapshots;
DELETE FROM pre_registration.notifications
WHERE registration_id IN (SELECT id FROM reset_orders)
   OR exception_id IN (SELECT id FROM pre_registration.payment_exceptions
                       WHERE registration_id IN (SELECT id FROM reset_orders));
DELETE FROM pre_registration.admin_actions WHERE registration_id IN (SELECT id FROM reset_orders);
DELETE FROM pre_registration.payment_exceptions WHERE registration_id IN (SELECT id FROM reset_orders);
DELETE FROM pre_registration.competitor_numbers WHERE registration_id IN (SELECT id FROM reset_orders);
DELETE FROM pre_registration.registration_snapshots WHERE registration_id IN (SELECT id FROM reset_orders);
-- The entries go with their orders (ON DELETE CASCADE)
DELETE FROM pre_registration.registrations WHERE id IN (SELECT id FROM reset_orders);
ALTER TABLE pre_registration.registrations ENABLE TRIGGER guard_registrations;
ALTER TABLE pre_registration.registration_entries ENABLE TRIGGER guard_registration_entries;
ALTER TABLE pre_registration.registration_snapshots ENABLE TRIGGER guard_registration_snapshots;
COMMIT;
```
If any line fails, nothing is changed: the whole block rolls back, guards included. If the editor then says the
transaction is aborted, run `ROLLBACK;` on its own.

Check afterwards that every guard is back on (`tgenabled` is `O` on all six rows):
```sql
SELECT tgrelid::regclass AS table_name, tgname, tgenabled FROM pg_trigger
WHERE tgrelid IN ('pre_registration.registrations'::regclass, 'pre_registration.registration_entries'::regclass,
                  'pre_registration.registration_snapshots'::regclass)
  AND tgname LIKE 'guard\_%'
ORDER BY 1, 2;
```

Don't `TRUNCATE` these tables, even as the owner: the `TRUNCATE` guards refuse it, and they stay on.
