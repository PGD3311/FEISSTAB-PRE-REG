# Known issues

Found during the October 2026 restyle and left for later. RunFeis is for Northeast feiseanna for now (Eastern time is the default), though every feis stores its own time zone so others can be added.

## Organiser setup
- **Suggested deadline dates can be a day early outside the Americas.** `daysBeforeDate` in `src/components/organiser/feis-wizard-step4.tsx` builds a local date, then reads it back with `toISOString()` (UTC). It's fine in US time zones and only goes wrong east of UTC (e.g. Ireland). Fix it before adding non-US feiseanna.
- **A failed "connect Stripe" shows nothing.** `handleSimulateStripe` in `feis-wizard-step5.tsx` only logs the error to the console. The step is simulated anyway; real Stripe Connect onboarding still needs building.
- **Step 5 ignores a failed competitions load.** `fetchCompetitions` doesn't check `.error`, so the breakdown silently shows zero.
- **Step 1 save has no try/catch** around the server action (steps 2 to 5 do).
- **The setup page ignores query errors** on the fee schedule and competition count (`src/app/organiser/feiseanna/[id]/setup/page.tsx`).
- **Some organiser buttons still use browser `alert()`** for errors (copy feis, delete draft, status changes).

## Organiser feis page
- **Entry counts include expired and cancelled registrations.** `getFeisEntries` in `src/app/organiser/feiseanna/actions.ts` counts every status, so "Dancers" and "Entries" run high. The page labels them "every entry, paid or not" until this is fixed.
- **The launch page's "Entries are closed" check is hard-coded to passed.** It's true today only because of the redirect above it.

## Parents
- **The after-payment page says a confirmation email was sent** even when email isn't set up (`RESEND_API_KEY` missing means the email is only logged).
- **The "See receipt" link on My entries** builds `?session_id=null` when a registration has no Stripe session, and the page then falls back to the latest registration for that feis.
- **The entry page links to `/terms` and `/privacy`, which don't exist yet.**

## Already tracked elsewhere
Payment and Stripe webhook problems, and changing entries after paying, are being handled on the `payment-hardening` branch.

## Fixed: signed-out pages crashed in development ("frame.join is not a function")
React 19.2's dev mode records the value of every `await` in a server component. For a signed-out visitor, `supabase.auth.getUser()` resolves to an "Auth session missing" error object. When a page also passed whole feis listings (including the full syllabus) to small components, React's dev data budget ran out, the error's stack was replaced with an "omitted" note, and Next 16.2.0's dev tools crashed reading it. Fixed by reading the user through `getSignedInUser()` in `src/lib/supabase/server.ts` and passing components only the fields they show. Keep both habits on public pages.

## Fixed: parts of pages never came to life in development (stuck "Loading entries…")
The `loading.tsx` files added during the restyle wrapped pages in a loading boundary. In development with Next 16.2.0, the browser waited forever on a debug-data chunk the server never sent, so the parts of pages inside that boundary never hydrated. The organiser's Entries tab showed "Loading entries…" indefinitely. The loading files were removed (the original app had none); client pages keep their own loading messages. Don't add `loading.tsx` back without checking that the page still hydrates in development.
