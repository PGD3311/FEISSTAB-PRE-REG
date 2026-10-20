# Known issues

Found during the October 2026 restyle and left for later. RunFeis is for Northeast feiseanna for now (Eastern time is the default), though every feis stores its own time zone so others can be added.

## Organiser setup
- **Suggested deadline dates can be a day early outside the Americas.** `daysBeforeDate` in `src/components/organiser/feis-wizard-step4.tsx` builds a local date, then reads it back with `toISOString()` (UTC). It's fine in US time zones and only goes wrong east of UTC (e.g. Ireland). Fix it before adding non-US feiseanna.
- **Two organiser buttons still use browser `alert()`** for errors: `clone-feis-button.tsx` and `delete-draft-button.tsx`. (Status changes now show an in-page message.)
- **A failed "connect Stripe" shows nothing.** `handleSimulateStripe` in `feis-wizard-step5.tsx` only logs the error to the console. The step is simulated anyway; real Stripe Connect onboarding still needs building.
- **Step 5 ignores a failed competitions load.** `fetchCompetitions` doesn't check `.error`, so the breakdown silently shows zero.
- **Step 1 save has no try/catch** around the server action (steps 2 to 5 do).
- **The setup page ignores query errors** on the fee schedule and competition count (`src/app/organiser/feiseanna/[id]/setup/page.tsx`).

## Organiser feis page
- **The launch page's "Entries are closed" check is hard-coded to passed.** It's true today only because of the redirect above it.

## Parents
- **The entry page links to `/terms` and `/privacy`, which don't exist yet.**

## Payments
- **RunFeis's $6 is never refunded, by Daniel's decision (2026-10-19).** The runbook's refund step (3b) refunds the payment intent and nothing else, and Stripe returns an application fee only when the refund asks for it, so RunFeis keeps the $6 and the feis's account bears the whole refund. Accepted results: the family's next first paid order carries the $6 again, and in a `late_payment_conflict` or `payment_reused` refund, when another paid order already carried the $6, RunFeis holds two $6 fees from that family. Refunding entry money is the organiser's business. No code refunds anything yet.
- **The email job is off (Daniel, 2026-10-19).** `process-notifications` isn't scheduled, so emails send only straight away after Pay (`createCheckoutSession` in the register `actions.ts`) and after Stripe's notice (`src/app/api/webhooks/stripe/route.ts`). A failed first attempt, a confirmation queued by runbook step 3a, and the success-page sync's and Cancel's confirmations wait for the next payment, which at low volume can be days. The runbook's daily stuck-emails query shows waiting rows, and 3a/3e tell the operator to email the family. Turn the job on (runbook section 5, "Turning the email job on") when several families are signing up. `pg_net` isn't installed on live and no `NOTIFICATIONS_CRON_SECRET` exists yet.
- **After the organiser closes registration, "Return to payment" is hidden.** The register page loads the listing with `.eq('status','open')` (`src/app/feiseanna/[id]/register/page.tsx:~85,124`), so a family with a claimed checkout who presses Back on Stripe sees "no longer taking entries". No money is at risk: the order expires with its hold. (Existing behaviour.)
- **The success page's "Your payment is going through…" view** (`src/app/feiseanna/[id]/register/success/page.tsx:~173,313`) shows for any `pending_payment` order whose session is still open, including a family who reached the page without paying. It refreshes every 5 seconds, calling Stripe each time, until the hold ends.
- **The message after a refused claim is wrong.** If an earlier create was refused (for example a connected account that can't take charges), the next Pay after 10 minutes cancels the order with "This registration has expired" (`src/app/_payments/checkout-workflow.ts:~208`).
- **011's live versions of `_assign_numbers_for_registration` and `assign_missing_competitor_numbers` accept `'confirmed'`.** The tests run 007's versions. Behaviour for `paid` is identical, so it is harmless. Tidy them in a future migration 021, together with the status check.
- **Two small drifts:** the new-order gate queries through a user client, not an injected `RpcCaller` (`src/app/_payments/new-order-gate.ts`; its `NewOrderReader` interface keeps it testable), and `payments_admin.confirm_late_payment` records no charge id (017 passes NULL).

## Found during the launch fixes (Oct 20), not fixed
- **Organiser setup-step dates still use the browser's zone in two places:** `daysBeforeDate` (see above) and the wizard's date inputs. Fine for Eastern organisers in the US.
- **A failed launch can leave partial feis-day rows** (the event, and possibly competitions, dancers, registrations). Every write is an upsert on a pre-reg ID, so Launch again fills in the rest; but until then the feis-day event exists in `draft` with import status `partial_failed`.
- **Eligibility:** an Open champion is offered Novice grade solos (`grades_only` per competition). Per current rules; a question for Steve.

## Already tracked elsewhere
Payment and Stripe webhook problems are handled by the payment hardening work (`docs/2026-10-16-payment-hardening-design.md`). Dropping or swapping a dance after paying waits on Steve's refund and withdrawal policy.

## Fixed: signed-out pages crashed in development ("frame.join is not a function")
React 19.2's dev mode records the value of every `await` in a server component. For a signed-out visitor, `supabase.auth.getUser()` resolves to an "Auth session missing" error object. When a page also passed whole feis listings (including the full syllabus) to small components, React's dev data budget ran out, the error's stack was replaced with an "omitted" note, and Next 16.2.0's dev tools crashed reading it. Fixed by reading the user through `getSignedInUser()` in `src/lib/supabase/server.ts` and passing components only the fields they show. Keep both habits on public pages.

## Fixed: parts of pages never came to life in development (stuck "Loading entries…")
The `loading.tsx` files added during the restyle wrapped pages in a loading boundary. In development with Next 16.2.0, the browser waited forever on a debug-data chunk the server never sent, so the parts of pages inside that boundary never hydrated. The organiser's Entries tab showed "Loading entries…" indefinitely. The loading files were removed (the original app had none); client pages keep their own loading messages. Don't add `loading.tsx` back without checking that the page still hydrates in development.

## From the end-to-end run as a new parent (Oct 16)
- **Team dances (ceili, figure) have no team entry.** They were offered to each dancer at the solo price, so they're switched off in the demo feis until Steve says how teams are entered.
- **The pinned total bar on phones stays visible while the receipt is on screen**, so the total shows twice and the bar can cover the form's Done button until you scroll.
- **Organiser late entries and changes after paying** aren't built yet; build them on `create_order`, never as direct writes, so they're built once on the new model.
- **Adding to a feis after paying** works: each visit after paying is a new order for just what's added, priced on top of what the family already paid (payment hardening's add-on orders, spec §14). Dropping or swapping a dance after paying still goes through the organiser.
