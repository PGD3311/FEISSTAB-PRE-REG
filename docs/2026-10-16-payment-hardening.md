# Payment Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "paid" trustworthy:
- An order is created in one step and its contents never change.
- Checkout runs on one frozen claim per order.
- Confirmation is a single database transaction.
- Every family who is charged ends up either confirmed or in a recorded review case.

**Architecture:**
- **State changes:** every change to an order's state is a Postgres function (migrations 012–017). Each function locks the rows it touches and checks the state and claim it expects.
- **Orchestration:** TypeScript in `src/app/_payments/` makes the Stripe and Resend calls between those functions. It reaches the database through an injected `RpcCaller`, so the same code runs against Supabase in production and against a throwaway local Postgres in tests.
- **Pure rules:** validation, the pricing snapshot, the checkout configuration, error classification and the email templates live in `src/lib/engine/` and `src/lib/email/`.

**Tech Stack:**
- Next.js 16 (App Router, server actions) and TypeScript
- Supabase: Postgres 17 with RLS
- Stripe Connect direct charges (stripe-node 20)
- Resend 6.9
- Vitest 4
- node-postgres (`pg`), for the database tests
- Homebrew `postgresql@17`

**Spec:** `docs/2026-10-16-payment-hardening-design.md` (revision 5). Read it before you start. "§n" below means section n of the spec.

## Progress (2026-10-17)

- **Tasks 1–4 are built, reviewed and fixed:** commits `e9f05f3..284ca4f` on `payment-hardening`, rebased onto the redesigned `main` (337ab01).
  - Their task text below is the plan as first written. The code on the branch is the record of what was built.
  - Every decision taken while building is in the ledger, `.superpowers/sdd/2026-10-16-payment-hardening/progress.md`.
- **What building them changed** (all reviewed; spec revision 4 records the same):
  - **Migration 001:** its seed rows now apply to an empty database.
  - **Migration 012** goes further than Task 3's text:
    - It revokes everything from `PUBLIC`, `anon` and `authenticated` before granting `SELECT`.
    - It turns row-level security on itself.
    - It refuses `TRUNCATE` for every role.
    - It makes a checkout claim all-or-nothing and never null.
    - It requires a hold on every unpaid order, and payment evidence for `paid` and `pending_payment`.
    - It lets entries and snapshots be written only in the transaction that creates or pays the order.
    - Its policies call `(SELECT auth.uid())` and `(SELECT auth_household_id())`.
  - **The test harness** runs Postgres in UTC and tests its own helpers.
  - **The Submit engine:**
    - It judges eligibility over every competition of the feis, as the redesigned entry page does.
    - The age cutoff falls back to 1 January of the feis year.
    - The snapshot freezes each competition's labels, age bounds and flags, and the feis's own terms link (`priceOrder` takes `feisTermsUrl`).
    - The application fee is computed in basis points from a validated percentage.
    - `CONSENT_VERSION` and `PLATFORM_TERMS_VERSION` name the current checkbox wording and the RunFeis terms and privacy pages (Daniel's decision).
- **Follow-up 1** (Daniel and Steve's decisions, after the batch):
  - `authenticated` reads `registrations` column by column, without `consent_ip` and `checkout_config`.
  - App reads use `REGISTRATION_COLUMNS`.
  - The consent checkbox also covers someone entering a dancer with the parent or guardian's permission (`CONSENT_VERSION = 'consent-2026-10-16b'`).
- **Tasks 5–7 are built, reviewed and fixed** (batch 2): commits `4b403da..61f92cd`.
  - The code is the record where it differs from the task text below:
    - `create_order` compares the whole frozen record (fee category, late flag, consent and terms versions).
    - `create_order`'s active-order check uses the unique index's predicate.
    - `create_order` expires this household's lapsed orders for the feis first.
    - Stripe shows late and day-of fees as their own lines, and respects its 100-line limit.
    - The `competition_unavailable` message points at Change entries.
- **Tasks 8–10 are built, reviewed and fixed** (batch 3): commits `e392ec2..c5a8049`.
  - The code is the record where it differs from the task text below:
    - `claim_checkout` also refuses bad line amounts or counts and any method but card.
    - `confirm_order_payment`'s active-order check uses the unique index's predicate.
    - Stripe create requests never retry on their own (20 s timeout).
    - Pay and Cancel return `checking` when a payment may have gone through.
    - The sync logs its cases.
    - Submit refuses an order below the 50-cent card minimum.
- **Tasks 5–16 are revised** to fit the as-built code and the redesigned registration pages. Tasks 7 and 12 were rewritten for the new entry page, success page and dashboard.
- **Tasks 11–15 are built, reviewed and fixed** (batch 4): commits `259c74b..6e2db2e`, then the batch 4 fixes.
  - The code is the record where it differs from the task text below:
    - **The late-payment-case rule (015):** once a session's payment is recorded as a `late_payment_conflict` case for an order, open or resolved, every later confirmation for that session and order returns that case and never fulfils it. Only `payments_admin.confirm_late_payment` confirms it.
    - **The notification key and attempts rules (016):** six attempts in total for every outcome, with waits of 5 min, 15 min, 1 h, 3 h and 6 h. A refusal after an attempt that may have gone out (an earlier uncertain send, or a stale `sending` claim taken over) counts as uncertain, so the key and `send_generation` stay. An uncertain send that reaches its sixth attempt becomes `needs_check`.
    - **The `payment_reused` closing (017):** `close_exception` allows `no_action` for `payment_reused` when Stripe shows no second charge, since the case's payment intent is the other, confirmed order's payment. Batch 4 also revokes `admin_actions` from the service role and both functions from every API role by name, refuses a note without a non-space character, and takes a refund ID only on `refunded`.
    - **The runbook's safety changes (Task 15):** the test-data reset is a read-only preview, then one all-or-nothing block that checks the feis id, its exact name and the order count. Before confirming a late payment (3a), Stripe is checked for refunds and disputes. Before 3a or a refund (3b), the other payments contact is told, and 3b first checks the case is still open. A reused payment's intent is never refunded. Stuck emails have a query and a guarded resend. The family is emailed by hand after any message-A case is closed (3e). Email is paused until a sending domain is verified.
    - **The app (batch 4):** Back from Stripe re-enables Pay. The dashboard says when it couldn't load entries. The success page shows "This payment has been reviewed…" once a message-A case is closed. One bad email row doesn't stall the rest. An ignored failure notice is logged.
  - **Task 16** is updated to match: the live test fixture's snapshot has `rules`; Step 4 sets `STRIPE_APPLICATION_FEE_PERCENT` and `NEXT_PUBLIC_BASE_URL`, checks Fluid compute and sets `PAYMENTS_ALERT_EMAIL` (Task 16 goes live with email on: Daniel, 2026-10-17); Step 7 reloads the API's schema cache and adds the three new webhook events after the deploy; the live script also checks `payments_admin`, the email queue functions and the one-active-order index; Step 8 dry-reads the runbook and checks the email job isn't paused; Step 12 confirms the first real email arrives.
- **Spec revision 5 (add-on orders and $0 orders, Daniel 2026-10-17) adds Tasks 17–21, which run before Task 16.** Task 17 merges `main` (migration 019 and its add-on screens) into this branch; Tasks 18–20 rebuild add-ons and $0 orders on this branch's order model (012, 013, 015 and 017 change in place, and the new last migration 020 checks 019's index); Task 21 updates the runbook and `CLAUDE.md`. Task 16 is updated for them: it applies 012–017 and then 020, its live check counts main's live add-ons, and its rehearsal and live tests cover an add-on, a $0 add-on and late payments against several orders.
- **A flat RunFeis fee (Daniel, 2026-10-19), built on this branch before it goes live:** RunFeis's own fee is now a flat $6, once per family per feis, taken from the host's share. It replaces the percentage, and the family's total doesn't change.
  - Submit decides it from the same paid orders it priced the order on (`runfeisFeeCents` in `src/lib/engine/purchase-snapshot.ts`): the first paid order carries the $6, and an add-on carries none.
  - Nothing reads `STRIPE_APPLICATION_FEE_PERCENT` any more, and no Vercel setting is needed.
  - The earlier tasks' text below, which describes the percentage and basis points (Tasks 4 and 7, and their tests), is left as it was written. The code is the record. Task 16 below is updated: Steps 2, 4 and 10 no longer set or read the variable, and Step 11 checks the $6 in Stripe. The Task 16 line above that says Step 4 sets `STRIPE_APPLICATION_FEE_PERCENT` is the old plan.

## Global Constraints

- **Branch:** work on `payment-hardening` in `~/FEISSTAB-PRE-REG`. Never commit to `main`.
- **Money:** always integer cents. Never use floats for amounts.
- **Order writes:** every order state change goes through the Postgres functions in this plan. No TypeScript writes `registrations`, `registration_entries` or `registration_snapshots` directly.
- **`SECURITY DEFINER` functions:**
  - set `SET search_path = pre_registration, pg_temp`
  - `REVOKE ALL … FROM PUBLIC, anon, authenticated`
  - `GRANT EXECUTE` only to the role that needs it
  - write `auth.*` references with the schema name
- **Engine purity:** code in `src/lib/engine/` and `src/lib/email/templates.ts` is pure. No Supabase, no Stripe SDK, no React, no I/O.
- **Where queries live:** database access happens only in route handlers, server actions, server components, or `src/app/_payments/*`. The `_payments` code reaches the database only through an injected `RpcCaller`.
- **Parent-facing text:**
  - The product is called "RunFeis".
  - Parent messages A, B and C use the exact wording in spec §10.
- **Checkout settings:**
  - `payment_method_types: ['card']`
  - currency `usd`
  - a 60-minute checkout window
  - a hold of the window plus 15 minutes
  - idempotency key `checkout:<order id>:<claim id>`
- **Checkout attempts:**
  - Pay sends no create request more than 5 minutes after a claim.
  - A claim counts as never having produced a session only when Stripe has nothing for it and the claim is more than 10 minutes old.
  - A Stripe error never decides that on its own.
- **Reference formats:**
  - confirmation numbers look like `RF-YYYY-XXXXX`
  - support references look like `PAY-XXXXX`
  - both use the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
- **Notification retries:**
  - waits of 5 min, 15 min, 1 h, 3 h and 6 h between attempts, for 6 attempts in total, whatever the outcomes: a refusal on the 6th attempt makes it `failed`, an uncertain send on the 6th makes it `needs_check`
  - a refusal after an attempt that may have gone out (an earlier uncertain outcome, or a taken-over crashed claim) is treated as uncertain: the idempotency key does not change
  - an uncertain delivery is never retried more than 23 hours after its first attempt; it becomes `needs_check`
  - the provider idempotency key is `<dedupe_key>:<send_generation>`
- **Code style:** match the surrounding code: single quotes, no semicolons, no trailing commas, 2-space indent, 100 columns. The repo has no Prettier config, so run Prettier with `--single-quote --no-semi --trailing-comma none --print-width 100`.
- **Order reads:**
  - Code that reads `registrations` with a user's client selects `REGISTRATION_COLUMNS` (`src/lib/registration-columns.ts`), never `*`.
  - `consent_ip` and `checkout_config` are private: only the service role and the payment functions read them.
  - A migration that adds a `registrations` column grants `SELECT` on it to `authenticated` and adds it to `REGISTRATION_COLUMNS`, unless it is private.
- **Migrations:** this plan owns 012–017 and 020. Migration 018 belongs to the schools work on `feisweb-layout`, and 019 is `main`'s add-on orders, which stays byte-identical to `main`'s, so any extra migration starts at 021. 012–017 never create or drop 019's `idx_registrations_active_unique`.
- **Migration 012 as built:** every later function and every test setup must satisfy its rules (see Progress). Create test states the way the real functions do, or the way `tests/db/helpers/fixtures.ts` does.
- **Next 16.2 dev traps** (`docs/known-issues.md`):
  - Never add `loading.tsx` files.
  - In public server pages, read the signed-in user with `getSignedInUser()` from `src/lib/supabase/server.ts`.
- **Finishing a task:** run its tests, `npm test`, and (where noted) `npm run test:db` and `npm run build`. They must pass before you mark the task done.

## Review Focus

These five inputs aren't covered by the spec's own tests, but they're the ones most likely to bite real users. Each has a test pinned in the task that owns the code.

1. **An organiser's own Stripe sales.** Their unrelated `checkout.session.*` events arrive at our Connect webhook with no `registration_id`. They must be ignored quietly: no case, no alert. *(Task 11)*
2. **A `session_id` in the success-page URL that isn't this order's,** from a copied link or another order. The sync never uses the URL's session id: it finds the order's own session by its claim. So another order's payment can neither create a case nor confirm anything. *(Task 10)*
3. **Line items Stripe can't take.** A family max that makes the total smaller than the line items must become one capped line. A zero-fee competition must not become a zero-amount line. *(Task 5)*
4. **A birthday on the age-cutoff date** (1 January). The frozen competition age must match the cart: the older age, as the engine does today. *(Task 4)*
5. **Names with HTML characters** (`<`, `&`, quotes) in dancer, school or feis names. They must be escaped in every email. *(Task 13)*

---

## File Map

**Database** (`supabase/migrations/`):
- `012_order_integrity.sql`: read-only parent access, new order columns, the "never changes" triggers, the state machine, the pay-at-door cleanup, and the rescheduled expiry job.
- `013_create_order.sql`: the household-and-feis lock, `create_order` and `get_order_for_checkout`.
- `014_checkout_claims.sql`: `claim_checkout`, `attach_checkout_session`, `cancel_order` and `expire_checkout`.
- `015_payment_confirmation.sql`:
  - the `payment_exceptions` and `notifications` tables
  - the reference generators
  - fulfilment and confirmation
  - payment failure
  - the parent review view
- `016_notification_delivery.sql`: claiming, freezing and completing notifications, and the email context.
- `017_payments_admin.sql`: the `payments_admin` schema, `admin_actions`, `confirm_late_payment` and `close_exception`.
- `019_add_on_orders.sql` (from `main`, unchanged): one unpaid order per family per feis, any number of paid ones.
- `020_assert_unpaid_index.sql`: refuses to apply unless `idx_registrations_active_unique` is exactly 019's.
- `supabase/checks/payment-hardening-live-check.sql`: read-only queries for the live database.
- `supabase/tests/payment_hardening_live_tests.sql`: the live permission tests, which always roll back.
- `supabase/checks/rehearse-on-live-copy.sh`: rehearses 012–017 and 020 on a copy of the live data before the real rollout.

**Pure code:**
- `src/lib/registration-states.ts` (modify): the transition table, exported.
- `src/lib/engine/order-validation.ts`: Submit's checks.
- `src/lib/engine/purchase-snapshot.ts`: pricing, the frozen purchase details, and the `create_order` payload.
- `src/lib/engine/consent.ts`: the client IP, taken from the request headers.
- `src/lib/engine/checkout-config.ts`: the frozen Stripe request.
- `src/lib/engine/checkout-policy.ts`: when a checkout may start.
- `src/lib/engine/stripe-errors.ts`: whether a Stripe error means refused or uncertain.
- `src/lib/engine/email-errors.ts`: whether a Resend error means refused or uncertain.
- `src/lib/payment-review-messages.ts`: parent messages A, B and C.
- `src/lib/email/templates.ts`: the confirmation and alert emails, with escaped HTML.
- `src/lib/email/email-config.ts`: whether email is set up, so pages only promise an email when one can be sent.
- `src/lib/fetch-all-rows.ts`: loads every row of a query page by page, because PostgREST returns at most 1000 rows.

**App code:**
- `src/app/_payments/rpc.ts`: `RpcCaller` and its Supabase adapter.
- `src/app/_payments/order-store.ts`: typed wrappers for the order functions.
- `src/app/_payments/stripe-gateway.ts`: the Stripe calls behind a small interface.
- `src/app/_payments/checkout-workflow.ts`: Pay, Cancel and the confirmation sync.
- `src/app/_payments/checkout-deps.ts`: the real dependencies for the workflow.
- `src/app/_payments/webhook-handler.ts`: Stripe event → database function.
- `src/app/_payments/notification-store.ts`, `email-sender.ts`, `notification-worker.ts` and `notification-deps.ts`: the email queue.
- `src/app/api/webhooks/stripe/route.ts` (rewrite).
- `src/app/api/notifications/process/route.ts` (new).
- `src/app/feiseanna/[id]/register/actions.ts`, `page.tsx` and `success/page.tsx` (modify).
- `src/app/dashboard/page.tsx` (modify).
- `src/components/registration/entry-page.tsx` and `family-receipt.tsx` (modify): the redesigned entry page uses the engine's rules, then Pay, resume and Cancel.
- `src/lib/email/send-confirmation.ts` (delete; the queue replaces it).

**Tests:**
- `tests/db/` (database tests, run with `npm run test:db`):
  - `global-setup.ts`
  - `sql/supabase-standins.sql`
  - `helpers/db.ts`, `helpers/fixtures.ts`, `helpers/pg-rpc.ts`, `helpers/fake-stripe.ts` and `helpers/fake-email.ts`
  - one `*.test.ts` file per task
- `tests/engine/*.test.ts` and `tests/*.test.ts`: unit tests, run with `npm test`.

**Docs:**
- `docs/runbooks/payment-exceptions.md` (new)
- `docs/known-issues.md`: entries the payment work fixes are removed
- `CLAUDE.md`
- the spec: migration numbers, and the result of the live verification

---

### Task 1: Local Postgres test harness (done)

**Files:**
- Modify: `package.json` (scripts and dev dependencies)
- Modify: `vitest.config.ts`
- Create: `vitest.db.config.ts`
- Create: `tests/db/sql/supabase-standins.sql`
- Create: `tests/db/global-setup.ts`
- Create: `tests/db/helpers/db.ts`
- Test: `tests/db/harness.test.ts`

**Interfaces:**
- Produces:
  - `createTestDatabase(): Promise<TestDatabase>`, where `TestDatabase = { pool: Pool; drop(): Promise<void> }`. Each test file gets its own copy of a migrated template database. Its `search_path` is `pre_registration, public`, and dates and timestamps come back as strings, as they do from Supabase.
  - `asRole(pool, role, userId, fn)`. It runs `fn(client)` in one transaction as `authenticated`, `anon` or `service_role`, with JWT claims set the way PostgREST sets them.
  - `asParent(pool, userId, fn)` and `asService(pool, fn)`, which are shorthands for `asRole`.
  - `refused(promise): Promise<string>`. It resolves to the error message, and fails the test if the statement succeeded.
  - Scripts: `npm test` (unit tests) and `npm run test:db` (database tests).

- [ ] **Step 1: Install node-postgres and add the scripts**

Run:
```bash
cd ~/FEISSTAB-PRE-REG && npm install --save-dev pg @types/pg
```
In `package.json`, replace the `"scripts"` block with:
```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:db": "vitest run --config vitest.db.config.ts"
  },
```

- [ ] **Step 2: Write the failing harness test**

Create `tests/db/harness.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, type TestDatabase } from './helpers/db'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db.drop()
})

describe('database test harness', () => {
  it('applies the migrations into the pre_registration schema', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'pre_registration'
        AND table_name IN ('feis_listings', 'fee_schedules', 'feis_competitions', 'households',
                           'dancers', 'registrations', 'registration_entries', 'registration_snapshots')`)
    expect(rows[0].n).toBe(8)
  })

  it('reads the JWT subject through auth.uid() for the authenticated role', async () => {
    const uid = '11111111-1111-4111-8111-111111111111'
    const { rows } = await asRole(db.pool, 'authenticated', uid, (c) =>
      c.query('SELECT auth.uid() AS uid, current_user AS role')
    )
    expect(rows[0]).toEqual({ uid, role: 'authenticated' })
  })

  it('returns timestamps as strings, the way Supabase does', async () => {
    const { rows } = await db.pool.query(`SELECT now() AS at, current_date AS day`)
    expect(typeof rows[0].at).toBe('string')
    expect(rows[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test:db`
Expected: FAIL. The config is missing (`vitest.db.config.ts`) or `./helpers/db` can't be resolved.

- [ ] **Step 4: Add the Vitest configs**

In `vitest.config.ts`, keep the database tests out of `npm test`:
```ts
import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    exclude: [...configDefaults.exclude, 'tests/db/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```
Create `vitest.db.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

// Database tests: a temporary Postgres 17 started by tests/db/global-setup.ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 5: Add the Supabase stand-ins**

Create `tests/db/sql/supabase-standins.sql`:
```sql
-- Stand-ins for the Supabase pieces the pre-registration migrations use, so they apply
-- unchanged to a plain Postgres 17. Grants mirror a project where pre_registration is
-- exposed to the API with Supabase's defaults: the most permissive starting point.

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  aud text,
  role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- pg_cron: keep the jobs so tests can run their commands
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  jobname text UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL
);
CREATE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text) RETURNS bigint
LANGUAGE sql
AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_jobname, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid
$$;

CREATE SCHEMA pre_registration;
GRANT USAGE ON SCHEMA pre_registration TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pre_registration GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pre_registration GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pre_registration GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
```

- [ ] **Step 6: Add the global setup**

Create `tests/db/global-setup.ts`:
```ts
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string
    pgTemplateDb: string
  }
}

const ROOT = process.cwd()
const TEMPLATE_DB = 'runfeis_template'

function pgBin(name: string): string {
  const dir =
    process.env.PG_BIN ??
    path.join(execFileSync('brew', ['--prefix', 'postgresql@17'], { encoding: 'utf8' }).trim(), 'bin')
  return path.join(dir, name)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not find a free port'))
      })
    })
  })
}

async function waitForPostgres(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const client = new Client({ connectionString: url })
    try {
      await client.connect()
      await client.end()
      return
    } catch {
      await client.end().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Postgres did not start at ${url}`)
}

function migrationFiles(): string[] {
  const dir = path.join(ROOT, 'supabase/migrations')
  return readdirSync(dir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .map((name) => path.join(dir, name))
}

export default async function setup(project: TestProject) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'runfeis-pg-'))
  execFileSync(
    pgBin('initdb'),
    ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'],
    { stdio: 'ignore' }
  )
  const port = await freePort()
  const server: ChildProcess = spawn(
    pgBin('postgres'),
    ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1',
     '-c', 'unix_socket_directories=', '-c', 'fsync=off'],
    { stdio: 'ignore' }
  )

  const stop = async () => {
    if (server.exitCode === null) {
      server.kill('SIGINT')
      await new Promise((resolve) => server.once('exit', resolve))
    }
    rmSync(dataDir, { recursive: true, force: true })
  }

  try {
    const adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`
    await waitForPostgres(adminUrl)

    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`)
    await admin.end()

    const template = new Client({ connectionString: `postgres://postgres@127.0.0.1:${port}/${TEMPLATE_DB}` })
    await template.connect()
    await template.query(readFileSync(path.join(ROOT, 'tests/db/sql/supabase-standins.sql'), 'utf8'))
    for (const file of migrationFiles()) {
      try {
        await template.query(readFileSync(file, 'utf8'))
      } catch (err) {
        throw new Error(`${path.basename(file)} failed: ${(err as Error).message}`)
      }
    }
    await template.end()

    project.provide('pgAdminUrl', adminUrl)
    project.provide('pgTemplateDb', TEMPLATE_DB)
  } catch (err) {
    await stop()
    throw err
  }

  return stop
}
```

- [ ] **Step 7: Add the database helpers**

Create `tests/db/helpers/db.ts`:
```ts
import { randomUUID } from 'node:crypto'
import pg, { Client, Pool, type PoolClient } from 'pg'
import { inject } from 'vitest'

// Return dates and timestamps as strings, the way Supabase's API does
pg.types.setTypeParser(1082, (value: string) => value) // date
pg.types.setTypeParser(1114, (value: string) => value) // timestamp
pg.types.setTypeParser(1184, (value: string) => value) // timestamptz

export type DbRole = 'authenticated' | 'anon' | 'service_role'

export interface TestDatabase {
  pool: Pool
  drop(): Promise<void>
}

/** A fresh copy of the migrated template database for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl')
  const name = `t_${randomUUID().replace(/-/g, '')}`

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${inject('pgTemplateDb')}`)
  await admin.query(`ALTER DATABASE ${name} SET search_path TO pre_registration, public`)
  await admin.end()

  const pool = new Pool({ connectionString: adminUrl.replace(/\/postgres$/, `/${name}`), max: 8 })

  return {
    pool,
    async drop() {
      await pool.end()
      const cleanup = new Client({ connectionString: adminUrl })
      await cleanup.connect()
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await cleanup.end()
    },
  }
}

/** Runs fn in one transaction as the given role, with JWT claims set the way PostgREST sets them. */
export async function asRole<T>(
  pool: Pool,
  role: DbRole,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('role', $2, true)`, [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
      role,
    ])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

export function asParent<T>(pool: Pool, userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return asRole(pool, 'authenticated', userId, fn)
}

export function asService<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return asRole(pool, 'service_role', null, fn)
}

/** Expects the database to refuse; resolves to its error message. */
export async function refused(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('Expected the database to refuse this, but it succeeded')
}
```

- [ ] **Step 8: Run the harness test**

Run: `npm run test:db`
Expected: PASS (3 tests). If `brew --prefix postgresql@17` fails, run `brew install postgresql@17`, or set `PG_BIN` to the folder that contains `initdb`.

- [ ] **Step 9: Confirm the unit tests still run on their own**

Run: `npm test`
Expected: PASS. The existing engine and state tests run, and nothing under `tests/db/` does.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vitest.db.config.ts tests/db
git commit -m "test: local Postgres harness for database tests"
```

---

### Task 2: Registration state table in TypeScript (done)

**Files:**
- Modify: `src/lib/registration-states.ts`
- Test: `tests/registration-states.test.ts` (rewrite)

**Interfaces:**
- Produces: `REGISTRATION_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]>`, plus `canTransitionRegistration(from, to)` and `getNextRegistrationStates(current)`, both with unchanged signatures. Task 3 checks that the SQL function `registration_transition_allowed` agrees with this table.

- [ ] **Step 1: Rewrite the tests for the new table**

Replace `tests/registration-states.test.ts` with:
```ts
import { describe, it, expect } from 'vitest'
import {
  REGISTRATION_TRANSITIONS,
  canTransitionRegistration,
  getNextRegistrationStates
} from '@/lib/registration-states'

describe('canTransitionRegistration', () => {
  it.each([
    ['draft', 'pending_payment'],
    ['draft', 'cancelled'],
    ['draft', 'expired'],
    ['draft', 'paid'],
    ['pending_payment', 'paid'],
    ['pending_payment', 'expired'],
    ['pending_payment', 'cancelled'],
    ['expired', 'paid'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransitionRegistration(from, to)).toBe(true)
  })

  it('treats paid and cancelled as final', () => {
    for (const to of ['draft', 'pending_payment', 'paid', 'expired', 'cancelled'] as const) {
      expect(canTransitionRegistration('paid', to)).toBe(false)
      expect(canTransitionRegistration('cancelled', to)).toBe(false)
    }
  })

  it('only lets an expired order become paid', () => {
    expect(canTransitionRegistration('expired', 'draft')).toBe(false)
    expect(canTransitionRegistration('expired', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('expired', 'cancelled')).toBe(false)
  })

  it('never moves backwards to draft', () => {
    expect(canTransitionRegistration('pending_payment', 'draft')).toBe(false)
    expect(canTransitionRegistration('draft', 'draft')).toBe(false)
  })
})

describe('getNextRegistrationStates', () => {
  it('lists the moves from each state', () => {
    expect(getNextRegistrationStates('draft').sort()).toEqual(['cancelled', 'expired', 'paid', 'pending_payment'])
    expect(getNextRegistrationStates('pending_payment').sort()).toEqual(['cancelled', 'expired', 'paid'])
    expect(getNextRegistrationStates('expired')).toEqual(['paid'])
    expect(getNextRegistrationStates('paid')).toEqual([])
    expect(getNextRegistrationStates('cancelled')).toEqual([])
  })

  it('is backed by the exported table', () => {
    expect(getNextRegistrationStates('draft')).toBe(REGISTRATION_TRANSITIONS.draft)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/registration-states.test.ts`
Expected: FAIL. `REGISTRATION_TRANSITIONS` isn't exported, and `draft → paid` and `expired → paid` are refused.

- [ ] **Step 3: Update the table**

Replace `src/lib/registration-states.ts` with:
```ts
import type { RegistrationStatus } from '@/lib/types/feis-listing'

// Mirrors registration_transition_allowed() in supabase/migrations/012_order_integrity.sql.
// tests/db/order-integrity.test.ts checks that the two agree.
export const REGISTRATION_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  // draft → paid: the payment came through the order's own checkout claim before Pay attached the session
  draft: ['pending_payment', 'cancelled', 'expired', 'paid'],
  pending_payment: ['paid', 'expired', 'cancelled'],
  paid: [],
  // expired → paid: a late payment on the order's own claim, confirmed by the database
  expired: ['paid'],
  cancelled: [],
}

export function canTransitionRegistration(
  from: RegistrationStatus,
  to: RegistrationStatus
): boolean {
  return REGISTRATION_TRANSITIONS[from]?.includes(to) ?? false
}

export function getNextRegistrationStates(
  current: RegistrationStatus
): RegistrationStatus[] {
  return REGISTRATION_TRANSITIONS[current] ?? []
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/registration-states.ts tests/registration-states.test.ts
git commit -m "feat: registration transitions for late and claim-matched payments"
```

---

### Task 3: Migration 012, order integrity (done)

**Files:**
- Create: `supabase/migrations/012_order_integrity.sql`
- Create: `tests/db/helpers/fixtures.ts`
- Test: `tests/db/order-integrity.test.ts`

**Interfaces:**
- Consumes: `asRole`, `asParent`, `asService`, `refused` and `createTestDatabase` (Task 1), and `REGISTRATION_TRANSITIONS` (Task 2).
- Produces:
  - **Columns:** `registrations.purchase_snapshot jsonb`, `checkout_claim_id uuid`, `checkout_config jsonb`, `checkout_claimed_at timestamptz` and `checkout_expires_at timestamptz`.
  - **SQL:** `registration_transition_allowed(text, text) → boolean`.
  - **Markers.** Transaction-local settings that the triggers trust:
    - `pre_registration.creating_order`: the order ID being created, for inserting orders and entries
    - `pre_registration.fulfilling_order`: the order ID being fulfilled, for inserting snapshots
  - **Fixtures:**
    - `createUser`, `createFamily`, `createListing`, `createDancer` and `insertOrderDirect`
    - `LEVELS`
    - the types `Family`, `ListingFixture` and `FixtureDancer`

- [ ] **Step 1: Write the fixtures**

Create `tests/db/helpers/fixtures.ts`:
```ts
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Dancer, FeeSchedule, FeisCompetition, FeisListing, Level } from '@/lib/types/feis-listing'

/** A dancer row plus its levels; the same shape the register page and Submit use. */
export type FixtureDancer = Dancer & { dance_levels: { dance_key: string; level_key: string }[] }

export const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 },
]

export interface Family {
  userId: string
  email: string
  householdId: string
}

export interface ListingFixture {
  listing: FeisListing
  feeSchedule: FeeSchedule
  competitions: FeisCompetition[]
  organiserId: string
}

export async function createUser(pool: Pool, label = 'parent'): Promise<{ id: string; email: string }> {
  const id = randomUUID()
  const email = `${label}-${id.slice(0, 8)}@runfeis.test`
  await pool.query(
    `INSERT INTO auth.users (id, email, aud, role) VALUES ($1, $2, 'authenticated', 'authenticated')`,
    [id, email]
  )
  return { id, email }
}

export async function createFamily(pool: Pool, label = 'parent'): Promise<Family> {
  const user = await createUser(pool, label)
  const { rows } = await pool.query(
    `INSERT INTO households (user_id, first_name, last_name, phone, address_line1, city, state_region, postal_code)
     VALUES ($1, 'Test', 'Family', '555-0100', '1 Reel Road', 'Boston', 'MA', '02101') RETURNING id`,
    [user.id]
  )
  return { userId: user.id, email: user.email, householdId: rows[0].id }
}

export async function createListing(
  pool: Pool,
  opts: { status?: string; regClosesAt?: string | null; account?: string | null; familyCapCents?: number | null } = {}
): Promise<ListingFixture> {
  const organiser = await createUser(pool, 'organiser')
  const closes =
    opts.regClosesAt === undefined ? new Date(Date.now() + 7 * 86_400_000).toISOString() : opts.regClosesAt
  const syllabus = { age_groups: [], levels: LEVELS, dances: [], championship_types: [], specials: [] }
  const { rows: [listing] } = await pool.query(
    `INSERT INTO feis_listings (name, feis_date, venue_name, contact_email, age_cutoff_date, status,
       reg_opens_at, reg_closes_at, syllabus_snapshot, stripe_account_id, stripe_charges_enabled, created_by)
     VALUES ('Test Feis', '2027-03-14', 'Test Hall', 'organiser@runfeis.test', '2027-01-01', $1,
       now() - interval '1 day', $2, $3, $4, true, $5)
     RETURNING *`,
    [opts.status ?? 'open', closes, JSON.stringify(syllabus),
     opts.account === undefined ? 'acct_test_feis' : opts.account, organiser.id]
  )
  const { rows: [feeSchedule] } = await pool.query(
    `INSERT INTO fee_schedules (feis_listing_id, event_fee_cents, solo_fee_cents, prelim_champ_fee_cents,
       open_champ_fee_cents, family_cap_cents)
     VALUES ($1, 1000, 1500, 5000, 6000, $2) RETURNING *`,
    [listing.id, opts.familyCapCents ?? null]
  )
  const competitions: FeisCompetition[] = []
  for (const c of [
    { code: '210R', name: 'Novice Reel U10', level: 'NOV', dance: 'reel', maxAge: 9 },
    { code: '210SJ', name: 'Novice Slip Jig U10', level: 'NOV', dance: 'slip_jig', maxAge: 9 },
    { code: '412TJ', name: 'Prizewinner Treble Jig U12', level: 'PW', dance: 'treble_jig', maxAge: 11 },
  ]) {
    const { rows: [comp] } = await pool.query(
      `INSERT INTO feis_competitions (feis_listing_id, age_group_key, age_group_label, age_max_jan1, level_key,
         level_label, dance_key, dance_label, competition_type, fee_category, display_name, display_code, enabled)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $6, 'solo', 'solo', $7, $8, true) RETURNING *`,
      [listing.id, `U${c.maxAge + 1}`, `Under ${c.maxAge + 1}`, c.maxAge, c.level, c.dance, c.name, c.code]
    )
    competitions.push(comp)
  }
  return { listing, feeSchedule, competitions, organiserId: organiser.id }
}

export async function createDancer(
  pool: Pool,
  householdId: string,
  opts: { firstName?: string; dob?: string; levels?: Record<string, string>; school?: string | null } = {}
): Promise<FixtureDancer> {
  const { rows: [dancer] } = await pool.query(
    `INSERT INTO dancers (household_id, first_name, last_name, date_of_birth, gender, school_name)
     VALUES ($1, $2, 'Walsh', $3, 'female', $4) RETURNING *`,
    [householdId, opts.firstName ?? 'Aoife', opts.dob ?? '2018-05-01', opts.school ?? 'Scoil Rince Test']
  )
  const levels = opts.levels ?? { reel: 'NOV', slip_jig: 'NOV' }
  for (const [danceKey, levelKey] of Object.entries(levels)) {
    await pool.query(
      `INSERT INTO dancer_dance_levels (dancer_id, dance_key, level_key) VALUES ($1, $2, $3)`,
      [dancer.id, danceKey, levelKey]
    )
  }
  return {
    ...dancer,
    dance_levels: Object.entries(levels).map(([dance_key, level_key]) => ({ dance_key, level_key })),
  }
}

/**
 * Test-only: writes an order the way create_order will (Task 5), using the same trigger markers.
 * The real app never does this.
 */
export async function insertOrderDirect(
  pool: Pool,
  householdId: string,
  listingId: string,
  entries: { dancerId: string; competitionId: string }[],
  opts: { status?: 'draft' | 'paid' } = {}
): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = randomUUID()
    await client.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [id])
    await client.query(
      `INSERT INTO registrations (id, feis_listing_id, household_id, status, total_cents, application_fee_cents,
         event_fee_cents, hold_expires_at, purchase_snapshot)
       VALUES ($1, $2, $3, 'draft', 4000, 200, 1000, now() + interval '30 minutes', '{"version": 1}')`,
      [id, listingId, householdId]
    )
    for (const entry of entries) {
      await client.query(
        `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
         VALUES ($1, $2, $3, 'solo', 1500)`,
        [id, entry.dancerId, entry.competitionId]
      )
    }
    await client.query(`SELECT set_config('pre_registration.creating_order', '', true)`)
    if (opts.status === 'paid') {
      await client.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-' || substr($1::text, 1, 5),
           stripe_payment_intent_id = 'pi_' || replace($1::text, '-', '')
         WHERE id = $1`,
        [id]
      )
      await client.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
      await client.query(
        `INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{"test": true}')`,
        [id]
      )
    }
    await client.query('COMMIT')
    return id
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```
- [ ] **Step 2: Write the failing integrity tests**

Create `tests/db/order-integrity.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REGISTRATION_TRANSITIONS } from '@/lib/registration-states'
import type { RegistrationStatus } from '@/lib/types/feis-listing'
import { asParent, asRole, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createDancer, createFamily, createListing, insertOrderDirect } from './helpers/fixtures'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db.drop()
})

async function familyWithDraft() {
  const listing = await createListing(db.pool)
  const family = await createFamily(db.pool)
  const dancer = await createDancer(db.pool, family.householdId)
  const draftId = await insertOrderDirect(db.pool, family.householdId, listing.listing.id, [
    { dancerId: dancer.id, competitionId: listing.competitions[0].id },
  ])
  return { listing, family, dancer, draftId }
}

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

describe('parent access to orders', () => {
  it('lets a parent read their own orders, entries and snapshots, and nothing of another family', async () => {
    const { family, dancer, draftId } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(
      db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }],
      { status: 'paid' }
    )
    const other = await familyWithDraft()

    const seen = await asParent(db.pool, family.userId, async (c) => ({
      orders: (await c.query('SELECT id FROM registrations')).rows.map((r) => r.id),
      entries: (await c.query('SELECT registration_id FROM registration_entries')).rowCount,
      snapshots: (await c.query('SELECT registration_id FROM registration_snapshots')).rows.map((r) => r.registration_id),
    }))

    expect(seen.orders.sort()).toEqual([draftId, paidId].sort())
    expect(seen.orders).not.toContain(other.draftId)
    expect(seen.entries).toBe(2)
    expect(seen.snapshots).toEqual([paidId])
  })

  it('refuses every parent write and leaves the rows unchanged', async () => {
    const { family, dancer, listing, draftId } = await familyWithDraft()
    const before = await orderRow(draftId)
    const attempts = [
      `UPDATE registrations SET status = 'paid' WHERE id = '${draftId}'`,
      `UPDATE registrations SET total_cents = 1 WHERE id = '${draftId}'`,
      `UPDATE registrations SET status = 'cancelled' WHERE id = '${draftId}'`,
      `DELETE FROM registrations WHERE id = '${draftId}'`,
      `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
         VALUES ('${draftId}', '${dancer.id}', '${listing.competitions[1].id}', 'solo', 0)`,
      `UPDATE registration_entries SET base_fee_cents = 0 WHERE registration_id = '${draftId}'`,
      `DELETE FROM registration_entries WHERE registration_id = '${draftId}'`,
      `INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ('${draftId}', '{}')`,
    ]
    for (const sql of attempts) {
      expect(await refused(asParent(db.pool, family.userId, (c) => c.query(sql)))).toMatch(/permission denied/)
    }
    expect(await orderRow(draftId)).toEqual(before)
    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n, sum(base_fee_cents)::int AS fees FROM registration_entries WHERE registration_id = $1',
      [draftId]
    )
    expect(rows[0]).toEqual({ n: 1, fees: 1500 })
  })

  it('gives anon no access to orders at all', async () => {
    const { draftId } = await familyWithDraft()
    const message = await refused(
      asRole(db.pool, 'anon', null, (c) => c.query('SELECT id FROM registrations WHERE id = $1', [draftId]))
    )
    expect(message).toMatch(/permission denied/)
  })

  it('has exactly the expected policies on the three order tables', async () => {
    const { rows } = await db.pool.query(`
      SELECT tablename, policyname, cmd, array_to_string(roles, ',') AS roles
      FROM pg_policies
      WHERE schemaname = 'pre_registration'
        AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots')
      ORDER BY tablename, policyname`)
    expect(rows).toEqual([
      { tablename: 'registration_entries', policyname: 'Organisers read entries for their feiseanna', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registration_entries', policyname: 'Parents read own entries', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registration_snapshots', policyname: 'Organisers read snapshots for their feiseanna', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registration_snapshots', policyname: 'Parents read own snapshots', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registrations', policyname: 'Organisers read registrations for their feiseanna', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registrations', policyname: 'Parents read own registrations', cmd: 'SELECT', roles: 'authenticated' },
    ])
  })

  it('leaves anon and authenticated with no write privileges on the order tables', async () => {
    const { rows } = await db.pool.query(`
      SELECT r.role, t.tbl, p.priv
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
      CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)
      WHERE has_table_privilege(r.role, 'pre_registration.' || t.tbl, p.priv)`)
    expect(rows).toEqual([])
  })
})

describe('what never changes, for any role', () => {
  it('refuses entries added outside order creation, even by the service role', async () => {
    const { dancer, listing, draftId } = await familyWithDraft()
    const message = await refused(asService(db.pool, (c) => c.query(
      `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
       VALUES ($1, $2, $3, 'solo', 1500)`,
      [draftId, dancer.id, listing.competitions[1].id]
    )))
    expect(message).toMatch(/entries are fixed/)
  })

  it('refuses orders created outside create_order', async () => {
    const { family } = await familyWithDraft()
    const other = await createListing(db.pool)
    const message = await refused(asService(db.pool, (c) => c.query(
      `INSERT INTO registrations (feis_listing_id, household_id, purchase_snapshot) VALUES ($1, $2, '{}')`,
      [other.listing.id, family.householdId]
    )))
    expect(message).toMatch(/only be created by create_order/)
  })

  it("refuses changes to an order's contents", async () => {
    const { draftId } = await familyWithDraft()
    for (const sql of [
      `UPDATE registrations SET total_cents = 1 WHERE id = $1`,
      `UPDATE registrations SET purchase_snapshot = '{"version": 2}' WHERE id = $1`,
      `UPDATE registrations SET consent_ip = '1.1.1.1' WHERE id = $1`,
    ]) {
      expect(await refused(asService(db.pool, (c) => c.query(sql, [draftId])))).toMatch(/contents never change/)
    }
  })

  it('never deletes an order', async () => {
    const { draftId } = await familyWithDraft()
    expect(await refused(asService(db.pool, (c) => c.query('DELETE FROM registrations WHERE id = $1', [draftId]))))
      .toMatch(/never deleted/)
  })

  it('sets a checkout claim once', async () => {
    const { draftId } = await familyWithDraft()
    await asService(db.pool, (c) => c.query(
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}', checkout_expires_at = now() + interval '1 hour'
       WHERE id = $1`, [draftId]))
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid() WHERE id = $1`, [draftId]))))
      .toMatch(/claim is set once/)
  })

  it('refuses status moves outside the table', async () => {
    const { family, dancer } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }], { status: 'paid' })
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET status = 'draft' WHERE id = $1`, [paidId])))).toMatch(/cannot move from paid to draft/)

    const cancelled = await familyWithDraft()
    await asService(db.pool, (c) => c.query(`UPDATE registrations SET status = 'cancelled' WHERE id = $1`, [cancelled.draftId]))
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET status = 'paid' WHERE id = $1`, [cancelled.draftId])))).toMatch(/cannot move from cancelled to paid/)
  })

  it('keeps snapshots permanent', async () => {
    const { family, dancer } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }], { status: 'paid' })
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registration_snapshots SET snapshot_data = '{}' WHERE registration_id = $1`, [paidId])))).toMatch(/written once/)
    expect(await refused(asService(db.pool, (c) => c.query(
      `DELETE FROM registration_snapshots WHERE registration_id = $1`, [paidId])))).toMatch(/written once/)
  })

  it('requires a purchase snapshot on every unpaid order', async () => {
    const { family } = await familyWithDraft()
    const other = await createListing(db.pool)
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query('SELECT gen_random_uuid() AS id')
      await client.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [rows[0].id])
      const message = await refused(client.query(
        `INSERT INTO registrations (id, feis_listing_id, household_id) VALUES ($1, $2, $3)`,
        [rows[0].id, other.listing.id, family.householdId]
      ))
      expect(message).toMatch(/registrations_unpaid_needs_purchase_snapshot/)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('agrees with the TypeScript transition table', async () => {
    const statuses = Object.keys(REGISTRATION_TRANSITIONS) as RegistrationStatus[]
    for (const from of statuses) {
      for (const to of statuses) {
        const { rows } = await db.pool.query('SELECT registration_transition_allowed($1, $2) AS ok', [from, to])
        expect({ from, to, ok: rows[0].ok }).toEqual({ from, to, ok: REGISTRATION_TRANSITIONS[from].includes(to) })
      }
    }
  })

  it('schedules the hold-expiry job with schema-qualified names', async () => {
    const { rows } = await db.pool.query(`SELECT command FROM cron.job WHERE jobname = 'expire-registration-holds'`)
    expect(rows[0].command).toContain('pre_registration.registrations')
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test:db -- tests/db/order-integrity.test.ts`
Expected: FAIL. The policy names don't match, parent writes succeed, and `registration_transition_allowed` doesn't exist.

- [ ] **Step 4: Write migration 012**

Create `supabase/migrations/012_order_integrity.sql`:
```sql
-- 012_order_integrity.sql
-- Payment hardening, part 1: who can write orders, and what never changes.
-- Spec: docs/2026-10-16-payment-hardening-design.md (§2, §3, Rollout step 2)

SET search_path TO pre_registration, public;

-- ─── Leftovers from the parked pay-at-the-door work (011), if they were applied by hand ───
DROP TRIGGER IF EXISTS guard_parent_registration_write ON registrations;
DROP FUNCTION IF EXISTS guard_parent_registration_write();
DROP FUNCTION IF EXISTS confirm_pay_at_door(uuid);
DROP FUNCTION IF EXISTS mark_registration_paid(uuid);

-- ─── New order columns ───
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS purchase_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS checkout_claim_id uuid,
  ADD COLUMN IF NOT EXISTS checkout_config jsonb,
  ADD COLUMN IF NOT EXISTS checkout_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz;

-- ─── Unpaid orders from before purchase snapshots existed ───
-- Rollout step 1 confirms these are test orders with no open Stripe session.
UPDATE registrations
SET status = 'expired', updated_at = now()
WHERE status IN ('draft', 'pending_payment') AND purchase_snapshot IS NULL;

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_unpaid_needs_purchase_snapshot;
ALTER TABLE registrations ADD CONSTRAINT registrations_unpaid_needs_purchase_snapshot
  CHECK (status NOT IN ('draft', 'pending_payment') OR purchase_snapshot IS NOT NULL);

-- ─── Uniqueness that confirmation relies on ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_checkout_session_unique
  ON registrations (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_payment_intent_unique
  ON registrations (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_snapshots_one_per_order
  ON registration_snapshots (registration_id);

-- ─── Read-only access for parents and organisers ───
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'pre_registration'
      AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots')
  LOOP
    EXECUTE format('DROP POLICY %I ON pre_registration.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

CREATE POLICY "Parents read own registrations" ON registrations
  FOR SELECT TO authenticated
  USING (household_id = auth_household_id());

CREATE POLICY "Organisers read registrations for their feiseanna" ON registrations
  FOR SELECT TO authenticated
  USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));

CREATE POLICY "Parents read own entries" ON registration_entries
  FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE household_id = auth_household_id()));

CREATE POLICY "Organisers read entries for their feiseanna" ON registration_entries
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r
    JOIN feis_listings l ON l.id = r.feis_listing_id
    WHERE l.created_by = auth.uid()
  ));

CREATE POLICY "Parents read own snapshots" ON registration_snapshots
  FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE household_id = auth_household_id()));

CREATE POLICY "Organisers read snapshots for their feiseanna" ON registration_snapshots
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r
    JOIN feis_listings l ON l.id = r.feis_listing_id
    WHERE l.created_by = auth.uid()
  ));

REVOKE ALL ON registrations, registration_entries, registration_snapshots FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON registrations, registration_entries, registration_snapshots FROM authenticated;
GRANT SELECT ON registrations, registration_entries, registration_snapshots TO authenticated;

-- ─── The state machine (mirrors REGISTRATION_TRANSITIONS in src/lib/registration-states.ts) ───
CREATE OR REPLACE FUNCTION registration_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pre_registration, pg_temp
AS $$
  SELECT (p_from || '>' || p_to) = ANY (ARRAY[
    'draft>pending_payment', 'draft>cancelled', 'draft>expired', 'draft>paid',
    'pending_payment>paid', 'pending_payment>cancelled', 'pending_payment>expired',
    'expired>paid'
  ])
$$;

-- ─── Orders: created by create_order only; contents fixed; claims and sessions set once ───
CREATE OR REPLACE FUNCTION guard_registrations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are never deleted; cancel them instead' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF current_setting('pre_registration.creating_order', true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'orders can only be created by create_order' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'draft'
       OR NEW.checkout_claim_id IS NOT NULL OR NEW.checkout_config IS NOT NULL OR NEW.checkout_claimed_at IS NOT NULL
       OR NEW.stripe_checkout_session_id IS NOT NULL OR NEW.stripe_payment_intent_id IS NOT NULL
       OR NEW.confirmation_number IS NOT NULL OR NEW.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new order starts as an unpaid draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.id, NEW.household_id, NEW.feis_listing_id, NEW.total_cents, NEW.application_fee_cents,
      NEW.event_fee_cents, NEW.is_late, NEW.purchase_snapshot, NEW.consent_accepted_at,
      NEW.consent_version, NEW.platform_terms_version, NEW.consent_ip, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.household_id, OLD.feis_listing_id, OLD.total_cents, OLD.application_fee_cents,
      OLD.event_fee_cents, OLD.is_late, OLD.purchase_snapshot, OLD.consent_accepted_at,
      OLD.consent_version, OLD.platform_terms_version, OLD.consent_ip, OLD.created_at) THEN
    RAISE EXCEPTION 'an order''s contents never change' USING ERRCODE = '42501';
  END IF;

  IF OLD.checkout_claim_id IS NOT NULL
     AND (NEW.checkout_claim_id, NEW.checkout_config, NEW.checkout_claimed_at, NEW.checkout_expires_at)
         IS DISTINCT FROM (OLD.checkout_claim_id, OLD.checkout_config, OLD.checkout_claimed_at, OLD.checkout_expires_at) THEN
    RAISE EXCEPTION 'a checkout claim is set once' USING ERRCODE = '42501';
  END IF;

  IF OLD.stripe_checkout_session_id IS NOT NULL
     AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'a checkout session is attached once' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'paid'
     AND (NEW.stripe_payment_intent_id, NEW.stripe_charge_id, NEW.confirmation_number, NEW.paid_at)
         IS DISTINCT FROM (OLD.stripe_payment_intent_id, OLD.stripe_charge_id, OLD.confirmation_number, OLD.paid_at) THEN
    RAISE EXCEPTION 'a paid order''s payment record never changes' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT registration_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'an order cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_registrations ON registrations;
CREATE TRIGGER guard_registrations
  BEFORE INSERT OR UPDATE OR DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION guard_registrations();

-- ─── Entries: written once, inside create_order ───
CREATE OR REPLACE FUNCTION guard_registration_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND current_setting('pre_registration.creating_order', true) = NEW.registration_id::text THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order entries are fixed when the order is created' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_registration_entries ON registration_entries;
CREATE TRIGGER guard_registration_entries
  BEFORE INSERT OR UPDATE OR DELETE ON registration_entries
  FOR EACH ROW EXECUTE FUNCTION guard_registration_entries();

-- ─── Snapshots: written once, at confirmation ───
CREATE OR REPLACE FUNCTION guard_registration_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND current_setting('pre_registration.fulfilling_order', true) = NEW.registration_id::text THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order snapshots are written once, at confirmation' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_registration_snapshots ON registration_snapshots;
CREATE TRIGGER guard_registration_snapshots
  BEFORE INSERT OR UPDATE OR DELETE ON registration_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_registration_snapshots();

-- ─── Hold expiry ───
-- pg_cron runs jobs with the default search_path, so the job names its schema.
-- Same rule as 002: an unpaid order whose hold has passed expires.
SELECT cron.schedule('expire-registration-holds', '* * * * *', $$
  UPDATE pre_registration.registrations
  SET status = 'expired', updated_at = now()
  WHERE status IN ('draft', 'pending_payment')
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at < now()
$$);
```

- [ ] **Step 5: Run the integrity tests**

Run: `npm run test:db`
Expected: PASS (the harness tests and the order-integrity tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/012_order_integrity.sql tests/db/helpers/fixtures.ts tests/db/order-integrity.test.ts
git commit -m "feat: read-only parent access and immutable orders (migration 012)"
```

---

### Task 4: Submit's checks and the frozen purchase details (pure) (done)

**Files:**
- Create: `src/lib/engine/order-validation.ts`
- Create: `src/lib/engine/purchase-snapshot.ts`
- Create: `src/lib/engine/consent.ts`
- Test: `tests/engine/order-validation.test.ts`, `tests/engine/purchase-snapshot.test.ts`, `tests/engine/consent.test.ts`

**Interfaces:**
- Consumes:
  - `getEligibleCompetitions` and `calculateAgeOnDate` (`src/lib/engine/eligibility.ts`)
  - `calculateFees` (`src/lib/engine/fee-calculator.ts`)
  - `parseLocalDate` (`src/lib/format.ts`)
- Produces:
  - **Types:** `OrderListing`, `OrderDancer`, `RequestedEntry { dancerId; competitionId }` and `OrderRequest`
  - **Validation:**
    - `validateOrderRequest(request): { ok: true; ageCutoffDate: Date } | { ok: false; error: string }`
    - `ageCutoffDateFor(listing, now): Date`
    - `registrationCloseTime(listing): Date | null`
    - `toDancerProfile(dancer): DancerProfile`
  - **Pricing:**
    - `priceOrder(input): { breakdown: FeeBreakdown; snapshot: PurchaseSnapshot }`
    - `buildCreateOrderPayload(priced, { applicationFeePercent, consentIp }): CreateOrderPayload`
    - the types `PurchaseSnapshot` (with `SnapshotDancer`, `SnapshotCompetition` and `SnapshotEntry`) and `CreateOrderPayload`
    - the constants `PRICING_VERSION`, `ELIGIBILITY_VERSION`, `CONSENT_VERSION` and `PLATFORM_TERMS_VERSION`
  - **Consent:** `clientIpFrom(headers: { get(name: string): string | null }): string | null`

- [ ] **Step 1: Write the failing validation tests**

Create `tests/engine/order-validation.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { validateOrderRequest, type OrderDancer, type OrderRequest } from '@/lib/engine/order-validation'
import type { FeisCompetition, Level } from '@/lib/types/feis-listing'

const NOW = new Date('2026-11-01T12:00:00Z')
const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 },
]

function dancer(overrides: Partial<OrderDancer> = {}): OrderDancer {
  return {
    id: 'd1', household_id: 'h1', first_name: 'Aoife', last_name: 'Walsh', date_of_birth: '2018-05-01',
    gender: 'female', school_name: 'Scoil Rince', tcrg_name: null, championship_status: 'none', is_active: true,
    dance_levels: [{ dance_key: 'reel', level_key: 'NOV' }],
    ...overrides,
  }
}

function competition(overrides: Partial<FeisCompetition> = {}): FeisCompetition {
  return {
    id: 'c1', feis_listing_id: 'f1', age_group_key: 'U10', age_group_label: 'Under 10', age_max_jan1: 9,
    age_min_jan1: null, level_key: 'NOV', level_label: 'Novice', dance_key: 'reel', dance_label: 'Reel',
    competition_type: 'solo', championship_key: null, fee_category: 'solo', fee_cents: null,
    exclude_from_family_cap: false, grades_only: false, display_name: 'Novice Reel U10', display_code: '210R',
    capacity_cap: null, enabled: true,
    ...overrides,
  }
}

function request(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    now: NOW,
    householdId: 'h1',
    listing: {
      status: 'open', reg_opens_at: '2026-10-01T00:00:00Z', reg_closes_at: '2026-12-01T00:00:00Z',
      late_reg_closes_at: null, age_cutoff_date: '2027-01-01', feis_date: '2027-03-14', levels: LEVELS,
    },
    dancers: [dancer()],
    competitions: [competition()],
    entries: [{ dancerId: 'd1', competitionId: 'c1' }],
    ...overrides,
  }
}

describe('validateOrderRequest', () => {
  it('accepts an eligible order and returns the age cutoff date', () => {
    const result = validateOrderRequest(request())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ageCutoffDate.getFullYear()).toBe(2027)
  })

  it('refuses when the organiser has not opened registration', () => {
    const r = request()
    expect(validateOrderRequest({ ...r, listing: { ...r.listing, status: 'closed' } }))
      .toEqual({ ok: false, error: 'Registration for this feis is not open.' })
  })

  it('refuses before the opening time', () => {
    const r = request()
    expect(validateOrderRequest({ ...r, listing: { ...r.listing, reg_opens_at: '2026-11-02T00:00:00Z' } }))
      .toEqual({ ok: false, error: 'Registration for this feis has not opened yet.' })
  })

  it('refuses after the deadline, and uses the late deadline when there is one', () => {
    const r = request()
    const closed = { ...r.listing, reg_closes_at: '2026-10-31T00:00:00Z' }
    expect(validateOrderRequest({ ...r, listing: closed }))
      .toEqual({ ok: false, error: 'Registration for this feis has closed.' })
    expect(validateOrderRequest({ ...r, listing: { ...closed, late_reg_closes_at: '2026-11-15T00:00:00Z' } }).ok)
      .toBe(true)
  })

  it('refuses an empty order and duplicate entries', () => {
    expect(validateOrderRequest(request({ entries: [] })))
      .toEqual({ ok: false, error: 'Choose at least one competition.' })
    expect(validateOrderRequest(request({ entries: [{ dancerId: 'd1', competitionId: 'c1' }, { dancerId: 'd1', competitionId: 'c1' }] })))
      .toEqual({ ok: false, error: 'The same competition is listed twice for one dancer.' })
  })

  it("refuses another family's dancer and an inactive dancer", () => {
    expect(validateOrderRequest(request({ dancers: [dancer({ household_id: 'h2' })] })))
      .toEqual({ ok: false, error: 'One or more dancers do not belong to your family.' })
    expect(validateOrderRequest(request({ dancers: [dancer({ is_active: false })] })))
      .toEqual({ ok: false, error: 'Aoife is no longer active on your account.' })
  })

  it('refuses a disabled or unknown competition', () => {
    expect(validateOrderRequest(request({ competitions: [competition({ enabled: false })] })))
      .toEqual({ ok: false, error: 'One or more competitions are not available.' })
    expect(validateOrderRequest(request({ entries: [{ dancerId: 'd1', competitionId: 'nope' }] })))
      .toEqual({ ok: false, error: 'One or more competitions are not available.' })
  })

  it('refuses an ineligible age or level with the reason', () => {
    const tooOld = validateOrderRequest(request({ dancers: [dancer({ date_of_birth: '2015-05-01' })] }))
    expect(tooOld.ok).toBe(false)
    if (!tooOld.ok) expect(tooOld.error).toMatch(/^Aoife Walsh can't enter Novice Reel U10: age 11/)

    const wrongLevel = validateOrderRequest(request({ dancers: [dancer({ dance_levels: [{ dance_key: 'reel', level_key: 'PW' }] })] }))
    expect(wrongLevel.ok).toBe(false)
    if (!wrongLevel.ok) expect(wrongLevel.error).toMatch(/Level mismatch/)
  })
})
```

- [ ] **Step 2: Write the failing snapshot and consent tests**

Create `tests/engine/purchase-snapshot.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { calculateFees } from '@/lib/engine/fee-calculator'
import {
  buildCreateOrderPayload,
  CONSENT_VERSION,
  PRICING_VERSION,
  priceOrder,
  type PriceOrderInput
} from '@/lib/engine/purchase-snapshot'
import type { OrderDancer } from '@/lib/engine/order-validation'
import { parseLocalDate } from '@/lib/format'
import type { FeeSchedule, FeisCompetition } from '@/lib/types/feis-listing'

const schedule: FeeSchedule = {
  id: 's1', feis_listing_id: 'f1', event_fee_cents: 1000, solo_fee_cents: 1500, prelim_champ_fee_cents: 5000,
  open_champ_fee_cents: 6000, family_cap_cents: null, late_fee_tiers: [], day_of_surcharge_cents: 0,
}

function comp(id: string, code: string, dance: string): FeisCompetition {
  return {
    id, feis_listing_id: 'f1', age_group_key: 'U10', age_group_label: 'Under 10', age_max_jan1: 9, age_min_jan1: null,
    level_key: 'NOV', level_label: 'Novice', dance_key: dance, dance_label: dance, competition_type: 'solo',
    championship_key: null, fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false, grades_only: false,
    display_name: `Novice ${dance} U10`, display_code: code, capacity_cap: null, enabled: true,
  }
}

const aoife: OrderDancer = {
  id: 'd1', household_id: 'h1', first_name: 'Aoife', last_name: 'Walsh', date_of_birth: '2018-05-01',
  gender: 'female', school_name: 'Scoil Rince', tcrg_name: 'Mary Murphy', championship_status: 'none', is_active: true,
  dance_levels: [{ dance_key: 'reel', level_key: 'NOV' }, { dance_key: 'slip_jig', level_key: 'NOV' }],
}

function input(overrides: Partial<PriceOrderInput> = {}): PriceOrderInput {
  return {
    now: new Date('2026-11-01T12:00:00Z'),
    ageCutoffDate: parseLocalDate('2027-01-01'),
    levels: [{ key: 'NOV', label: 'Novice', rank: 3 }],
    dancers: [aoife],
    competitions: [comp('c1', '210R', 'reel'), comp('c2', '210SJ', 'slip_jig')],
    entries: [{ dancerId: 'd1', competitionId: 'c1' }, { dancerId: 'd1', competitionId: 'c2' }],
    feeSchedule: schedule,
    ...overrides,
  }
}

describe('priceOrder', () => {
  it('prices with the fee calculator and freezes what the price was based on', () => {
    const { breakdown, snapshot } = priceOrder(input())
    expect(breakdown.grand_total_cents).toBe(4000)
    expect(breakdown).toEqual(calculateFees(schedule, [
      { dancer_id: 'd1', fee_category: 'solo', fee_cents_override: null, exclude_from_family_cap: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', fee_cents_override: null, exclude_from_family_cap: false, is_day_of: false },
    ], new Date('2026-11-01T12:00:00Z')))
    expect(snapshot.dancers).toEqual([{
      id: 'd1', first_name: 'Aoife', last_name: 'Walsh', school_name: 'Scoil Rince', tcrg_name: 'Mary Murphy',
      date_of_birth: '2018-05-01', gender: 'female', championship_status: 'none',
      dance_levels: { reel: 'NOV', slip_jig: 'NOV' }, competition_age: 8,
    }])
    expect(snapshot.competitions.map((c) => c.display_code)).toEqual(['210R', '210SJ'])
    expect(snapshot.entries).toEqual([
      { dancer_id: 'd1', competition_id: 'c1', fee_category: 'solo', base_fee_cents: 1500, late_fee_cents: 0, day_of_surcharge_cents: 0 },
      { dancer_id: 'd1', competition_id: 'c2', fee_category: 'solo', base_fee_cents: 1500, late_fee_cents: 0, day_of_surcharge_cents: 0 },
    ])
    expect(snapshot.pricing.priced_at).toBe('2026-11-01T12:00:00.000Z')
    expect(snapshot.rules).toMatchObject({ age_cutoff_date: '2027-01-01', pricing_version: PRICING_VERSION, consent_version: CONSENT_VERSION })
  })

  it('counts a birthday on the cutoff date as the older age, the same as the cart', () => {
    const born = { ...aoife, date_of_birth: '2017-01-01' }
    const { snapshot } = priceOrder(input({ dancers: [born] }))
    expect(snapshot.dancers[0].competition_age).toBe(10)
  })

  it('keeps each entry with its own fees when a late tier applies', () => {
    const late = { ...schedule, late_fee_tiers: [{ starts_at: '2026-10-15T00:00:00Z', fee_cents: 2500, family_max_cents: null }] }
    const { snapshot, breakdown } = priceOrder(input({ feeSchedule: late }))
    expect(snapshot.entries.map((e) => e.late_fee_cents)).toEqual([2500, 0])
    expect(breakdown.grand_total_cents).toBe(6500)
  })
})

describe('buildCreateOrderPayload', () => {
  it('carries whole-cent totals, the entries and the snapshot', () => {
    const payload = buildCreateOrderPayload(priceOrder(input()), { applicationFeePercent: 3.3, consentIp: '203.0.113.7' })
    expect(payload.total_cents).toBe(4000)
    expect(payload.application_fee_cents).toBe(132)
    expect(payload.event_fee_cents).toBe(1000)
    expect(payload.is_late).toBe(false)
    expect(payload.consent_ip).toBe('203.0.113.7')
    expect(payload.entries.map((e) => e.feis_competition_id)).toEqual(['c1', 'c2'])
    expect(payload.purchase_snapshot.entries).toHaveLength(2)
  })
})
```
Create `tests/engine/consent.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { clientIpFrom } from '@/lib/engine/consent'

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null })

describe('clientIpFrom', () => {
  it('takes the first address from x-forwarded-for', () => {
    expect(clientIpFrom(headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }))).toBe('203.0.113.7')
  })
  it('falls back to x-real-ip', () => {
    expect(clientIpFrom(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })
  it('returns null when neither header is present', () => {
    expect(clientIpFrom(headers({}))).toBeNull()
  })
})
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `npx vitest run tests/engine/order-validation.test.ts tests/engine/purchase-snapshot.test.ts tests/engine/consent.test.ts`
Expected: FAIL. The modules don't exist.

- [ ] **Step 4: Write the validation module**

Create `src/lib/engine/order-validation.ts`:
```ts
import { getEligibleCompetitions } from '@/lib/engine/eligibility'
import { parseLocalDate } from '@/lib/format'
import type {
  Dancer,
  DancerDanceLevel,
  DancerProfile,
  FeisCompetition,
  FeisListing,
  Level
} from '@/lib/types/feis-listing'

export type OrderListing = Pick<
  FeisListing,
  'status' | 'reg_opens_at' | 'reg_closes_at' | 'late_reg_closes_at' | 'age_cutoff_date' | 'feis_date'
> & { levels: Level[] }

export type OrderDancer = Pick<
  Dancer,
  | 'id' | 'household_id' | 'first_name' | 'last_name' | 'date_of_birth' | 'gender'
  | 'school_name' | 'tcrg_name' | 'championship_status' | 'is_active'
> & { dance_levels: Pick<DancerDanceLevel, 'dance_key' | 'level_key'>[] }

export interface RequestedEntry {
  dancerId: string
  competitionId: string
}

export interface OrderRequest {
  now: Date
  householdId: string
  listing: OrderListing
  dancers: OrderDancer[]
  /** Every competition of this feis, enabled or not */
  competitions: FeisCompetition[]
  entries: RequestedEntry[]
}

export type OrderValidation = { ok: true; ageCutoffDate: Date } | { ok: false; error: string }

/** The date ages are counted on, with the same fallbacks as the register page. */
export function ageCutoffDateFor(listing: Pick<FeisListing, 'age_cutoff_date' | 'feis_date'>, now: Date): Date {
  if (listing.age_cutoff_date) return parseLocalDate(listing.age_cutoff_date)
  if (listing.feis_date) return parseLocalDate(listing.feis_date)
  return now
}

/** When registration closes: the late deadline if there is one, otherwise the normal one. */
export function registrationCloseTime(
  listing: Pick<FeisListing, 'reg_closes_at' | 'late_reg_closes_at'>
): Date | null {
  const close = listing.late_reg_closes_at ?? listing.reg_closes_at
  return close ? new Date(close) : null
}

export function toDancerProfile(dancer: OrderDancer): DancerProfile {
  const danceLevels: Record<string, string> = {}
  for (const level of dancer.dance_levels) danceLevels[level.dance_key] = level.level_key
  return {
    dob: parseLocalDate(dancer.date_of_birth),
    gender: dancer.gender,
    championshipStatus: dancer.championship_status,
    danceLevels
  }
}

function fail(error: string): OrderValidation {
  return { ok: false, error }
}

/** Submit's checks (spec §4): the feis is open, and every entry is this family's and eligible. */
export function validateOrderRequest(request: OrderRequest): OrderValidation {
  const { listing, now } = request

  if (listing.status !== 'open') return fail('Registration for this feis is not open.')
  if (listing.reg_opens_at && now < new Date(listing.reg_opens_at)) {
    return fail('Registration for this feis has not opened yet.')
  }
  const close = registrationCloseTime(listing)
  if (close && now > close) return fail('Registration for this feis has closed.')

  if (request.entries.length === 0) return fail('Choose at least one competition.')

  const seen = new Set<string>()
  for (const entry of request.entries) {
    const key = `${entry.dancerId}:${entry.competitionId}`
    if (seen.has(key)) return fail('The same competition is listed twice for one dancer.')
    seen.add(key)
  }

  const dancers = new Map(request.dancers.map((d) => [d.id, d]))
  const competitions = new Map(request.competitions.map((c) => [c.id, c]))

  for (const entry of request.entries) {
    const dancer = dancers.get(entry.dancerId)
    if (!dancer || dancer.household_id !== request.householdId) {
      return fail('One or more dancers do not belong to your family.')
    }
    if (!dancer.is_active) return fail(`${dancer.first_name} is no longer active on your account.`)
    const competition = competitions.get(entry.competitionId)
    if (!competition || !competition.enabled) return fail('One or more competitions are not available.')
  }

  const ageCutoffDate = ageCutoffDateFor(listing, now)
  const chosenByDancer = new Map<string, FeisCompetition[]>()
  for (const entry of request.entries) {
    const chosen = chosenByDancer.get(entry.dancerId) ?? []
    chosen.push(competitions.get(entry.competitionId)!)
    chosenByDancer.set(entry.dancerId, chosen)
  }
  for (const [dancerId, chosen] of chosenByDancer) {
    const dancer = dancers.get(dancerId)!
    const blocked = getEligibleCompetitions(toDancerProfile(dancer), chosen, ageCutoffDate, listing.levels)
      .find((result) => !result.eligible)
    if (blocked) {
      return fail(
        `${dancer.first_name} ${dancer.last_name} can't enter ${blocked.competition.display_name}: ${blocked.reason}.`
      )
    }
  }

  return { ok: true, ageCutoffDate }
}
```

- [ ] **Step 5: Write the pricing and snapshot module**

Create `src/lib/engine/purchase-snapshot.ts`:
```ts
import { calculateAgeOnDate } from '@/lib/engine/eligibility'
import { calculateFees } from '@/lib/engine/fee-calculator'
import { toDancerProfile, type OrderDancer, type RequestedEntry } from '@/lib/engine/order-validation'
import type {
  ChampionshipStatus,
  FeeBreakdown,
  FeeCategoryType,
  FeeEntry,
  FeeSchedule,
  FeisCompetition,
  Level
} from '@/lib/types/feis-listing'

export const PRICING_VERSION = 'pricing-2026-10-16'
export const ELIGIBILITY_VERSION = 'eligibility-2026-10-16'
export const CONSENT_VERSION = 'tos-v1-2026-03-01'
export const PLATFORM_TERMS_VERSION = 'platform-v1-2026-03-01'

export interface SnapshotDancer {
  id: string
  first_name: string
  last_name: string
  school_name: string | null
  tcrg_name: string | null
  date_of_birth: string
  gender: string
  championship_status: ChampionshipStatus
  dance_levels: Record<string, string>
  competition_age: number
}

export interface SnapshotCompetition {
  id: string
  display_code: string | null
  display_name: string
  age_group_key: string | null
  level_key: string | null
  dance_key: string | null
  competition_type: string
  championship_key: string | null
  fee_category: FeeCategoryType
  fee_cents: number | null
}

export interface SnapshotEntry {
  dancer_id: string
  competition_id: string
  fee_category: FeeCategoryType
  base_fee_cents: number
  late_fee_cents: number
  day_of_surcharge_cents: number
}

/** What an order was validated and priced on, frozen at Submit (spec §3). */
export interface PurchaseSnapshot {
  version: 1
  dancers: SnapshotDancer[]
  competitions: SnapshotCompetition[]
  entries: SnapshotEntry[]
  pricing: { fee_schedule: FeeSchedule; breakdown: FeeBreakdown; priced_at: string }
  rules: {
    age_cutoff_date: string
    levels: Level[]
    consent_version: string
    platform_terms_version: string
    pricing_version: string
    eligibility_version: string
  }
}

export interface PriceOrderInput {
  now: Date
  ageCutoffDate: Date
  levels: Level[]
  dancers: OrderDancer[]
  competitions: FeisCompetition[]
  entries: RequestedEntry[]
  feeSchedule: FeeSchedule
}

export interface PricedOrder {
  breakdown: FeeBreakdown
  snapshot: PurchaseSnapshot
}

export interface CreateOrderPayload {
  total_cents: number
  application_fee_cents: number
  event_fee_cents: number
  is_late: boolean
  consent_ip: string | null
  consent_version: string
  platform_terms_version: string
  entries: {
    dancer_id: string
    feis_competition_id: string
    fee_category: FeeCategoryType
    base_fee_cents: number
    late_fee_cents: number
    day_of_surcharge_cents: number
  }[]
  purchase_snapshot: PurchaseSnapshot
}

/** yyyy-mm-dd of a date made by parseLocalDate */
function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function feeEntriesFor(
  entries: RequestedEntry[],
  competitions: Map<string, FeisCompetition>
): FeeEntry[] {
  return entries.map((entry) => {
    const competition = competitions.get(entry.competitionId)!
    return {
      dancer_id: entry.dancerId,
      fee_category: competition.fee_category,
      fee_cents_override: competition.fee_cents,
      exclude_from_family_cap: competition.exclude_from_family_cap,
      is_day_of: false
    }
  })
}

/** Prices a validated order and freezes everything the price and eligibility were based on. */
export function priceOrder(input: PriceOrderInput): PricedOrder {
  const competitions = new Map(input.competitions.map((c) => [c.id, c]))
  const dancers = new Map(input.dancers.map((d) => [d.id, d]))
  const feeEntries = feeEntriesFor(input.entries, competitions)
  const breakdown = calculateFees(input.feeSchedule, feeEntries, input.now)

  const dancerIds = [...new Set(input.entries.map((e) => e.dancerId))]
  const competitionIds = [...new Set(input.entries.map((e) => e.competitionId))]

  const snapshot: PurchaseSnapshot = {
    version: 1,
    dancers: dancerIds.map((id) => {
      const dancer = dancers.get(id)!
      const profile = toDancerProfile(dancer)
      return {
        id: dancer.id,
        first_name: dancer.first_name,
        last_name: dancer.last_name,
        school_name: dancer.school_name,
        tcrg_name: dancer.tcrg_name,
        date_of_birth: dancer.date_of_birth,
        gender: dancer.gender,
        championship_status: dancer.championship_status,
        dance_levels: profile.danceLevels,
        competition_age: calculateAgeOnDate(profile.dob, input.ageCutoffDate)
      }
    }),
    competitions: competitionIds.map((id) => {
      const c = competitions.get(id)!
      return {
        id: c.id,
        display_code: c.display_code,
        display_name: c.display_name,
        age_group_key: c.age_group_key,
        level_key: c.level_key,
        dance_key: c.dance_key,
        competition_type: c.competition_type,
        championship_key: c.championship_key,
        fee_category: c.fee_category,
        fee_cents: c.fee_cents
      }
    }),
    entries: input.entries.map((entry, i) => ({
      dancer_id: entry.dancerId,
      competition_id: entry.competitionId,
      fee_category: feeEntries[i].fee_category,
      base_fee_cents: breakdown.line_items[i].base_fee_cents,
      late_fee_cents: breakdown.line_items[i].late_fee_cents,
      day_of_surcharge_cents: breakdown.line_items[i].day_of_surcharge_cents
    })),
    pricing: { fee_schedule: input.feeSchedule, breakdown, priced_at: input.now.toISOString() },
    rules: {
      age_cutoff_date: localIsoDate(input.ageCutoffDate),
      levels: input.levels,
      consent_version: CONSENT_VERSION,
      platform_terms_version: PLATFORM_TERMS_VERSION,
      pricing_version: PRICING_VERSION,
      eligibility_version: ELIGIBILITY_VERSION
    }
  }

  return { breakdown, snapshot }
}

/** What create_order (migration 013) receives. The database checks it against the snapshot. */
export function buildCreateOrderPayload(
  order: PricedOrder,
  opts: { applicationFeePercent: number; consentIp: string | null }
): CreateOrderPayload {
  const total = order.breakdown.grand_total_cents
  return {
    total_cents: total,
    application_fee_cents: Math.round(total * (opts.applicationFeePercent / 100)),
    event_fee_cents: order.breakdown.event_fee_cents,
    is_late: order.breakdown.active_late_tier !== null,
    consent_ip: opts.consentIp,
    consent_version: CONSENT_VERSION,
    platform_terms_version: PLATFORM_TERMS_VERSION,
    entries: order.snapshot.entries.map((e) => ({
      dancer_id: e.dancer_id,
      feis_competition_id: e.competition_id,
      fee_category: e.fee_category,
      base_fee_cents: e.base_fee_cents,
      late_fee_cents: e.late_fee_cents,
      day_of_surcharge_cents: e.day_of_surcharge_cents
    })),
    purchase_snapshot: order.snapshot
  }
}
```

- [ ] **Step 6: Write the consent module**

Create `src/lib/engine/consent.ts`:
```ts
/** The client's IP as the server sees it, from the proxy headers Vercel sets. */
export function clientIpFrom(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')?.trim()
  return real ? real : null
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/engine/order-validation.ts src/lib/engine/purchase-snapshot.ts src/lib/engine/consent.ts tests/engine/order-validation.test.ts tests/engine/purchase-snapshot.test.ts tests/engine/consent.test.ts
git commit -m "feat: server-side order checks and frozen purchase details"
```

---

### Task 5: The frozen Stripe request, checkout policy and Stripe errors (pure) (done)

**Files:**
- Create: `src/lib/engine/checkout-config.ts`
- Create: `src/lib/engine/checkout-policy.ts`
- Create: `src/lib/engine/stripe-errors.ts`
- Test: `tests/engine/checkout-config.test.ts`, `tests/engine/checkout-policy.test.ts`, `tests/engine/stripe-errors.test.ts`

**Interfaces:**
- Consumes: `PurchaseSnapshot` (Task 4) and `ListingStatus` (`src/lib/types/feis-listing.ts`). The tests also price a real order with `priceOrder` and `buildCreateOrderPayload` (Task 4).
- Produces:
  - **The checkout request:**
    - `CheckoutConfig` and `CheckoutLineItem`
    - `buildCheckoutConfig(input: CheckoutConfigInput): CheckoutConfig`
    - `checkoutLineItems(snapshot, eventFeeCents, totalCents)`
    - the constants `CHECKOUT_WINDOW_MINUTES = 60` and `HOLD_AFTER_CHECKOUT_MINUTES = 15`
  - **The checkout policy:**
    - `checkoutBlockReason(input): CheckoutBlock | null`
    - `CheckoutBlock = 'organiser_stopped' | 'competition_unavailable' | 'stripe_not_connected' | 'amount_too_small'`
    - `CHECKOUT_BLOCK_MESSAGES` and `MIN_CHARGE_CENTS = 50`
  - **Stripe errors:** `classifyStripeError(err: unknown): StripeFailure`, where `StripeFailure = 'in_progress' | 'retry' | 'rejected'`. It describes only the one request, never what an earlier attempt with the same key did.

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/checkout-config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildCheckoutConfig, checkoutLineItems, type CheckoutConfigInput } from '@/lib/engine/checkout-config'
import type { OrderDancer } from '@/lib/engine/order-validation'
import { buildCreateOrderPayload, priceOrder, type PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'
import { parseLocalDate } from '@/lib/format'
import type { FeeSchedule, FeisCompetition } from '@/lib/types/feis-listing'

/** A frozen purchase with one dancer and one solo per fee, with every field priceOrder freezes */
function snapshot(fees: number[]): PurchaseSnapshot {
  return {
    version: 1,
    dancers: [{ id: 'd1', first_name: 'Aoife', last_name: 'Walsh', school_name: null, tcrg_name: null,
      date_of_birth: '2018-05-01', gender: 'female', championship_status: 'none', dance_levels: {}, competition_age: 8 }],
    competitions: fees.map((_, i) => ({ id: `c${i}`, display_code: `21${i}R`, display_name: `Comp ${i}`,
      age_group_key: null, age_group_label: null, age_min_jan1: null, age_max_jan1: null, level_key: null,
      level_label: null, dance_key: null, dance_label: null, competition_type: 'solo', championship_key: null,
      grades_only: false, fee_category: 'solo' as const, fee_cents: null, exclude_from_family_cap: false })),
    entries: fees.map((fee, i) => ({ dancer_id: 'd1', competition_id: `c${i}`, fee_category: 'solo' as const,
      base_fee_cents: fee, late_fee_cents: 0, day_of_surcharge_cents: 0 })),
    pricing: { fee_schedule: {} as never, breakdown: {} as never, priced_at: '2026-11-01T12:00:00.000Z' },
    rules: { age_cutoff_date: '2027-01-01', levels: [], consent_version: 'x', platform_terms_version: 'y',
      feis_terms_url: null, pricing_version: 'p', eligibility_version: 'e' },
  }
}

function configInput(overrides: Partial<CheckoutConfigInput> = {}): CheckoutConfigInput {
  return {
    registrationId: 'reg-1', feisListingId: 'feis-1', claimId: 'claim-1', account: 'acct_123',
    totalCents: 4000, applicationFeeCents: 200, eventFeeCents: 1000, snapshot: snapshot([1500, 1500]),
    baseUrl: 'https://runfeis.test', now: new Date('2026-11-01T12:00:00Z'),
    ...overrides,
  }
}

describe('buildCheckoutConfig', () => {
  it('is the same for the same order and claim', () => {
    expect(buildCheckoutConfig(configInput())).toEqual(buildCheckoutConfig(configInput()))
  })

  it('freezes the whole Stripe request', () => {
    const config = buildCheckoutConfig(configInput())
    expect(config).toMatchObject({
      version: 1, account: 'acct_123', currency: 'usd', total_cents: 4000, application_fee_cents: 200,
      payment_method_types: ['card'], client_reference_id: 'reg-1',
      metadata: { registration_id: 'reg-1', claim_id: 'claim-1' },
      idempotency_key: 'checkout:reg-1:claim-1',
      expires_at: Date.parse('2026-11-01T13:00:00Z') / 1000,
      success_url: 'https://runfeis.test/feiseanna/feis-1/register/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://runfeis.test/feiseanna/feis-1/register',
    })
  })
})

describe('checkoutLineItems', () => {
  it('lists the event fee and each entry when they add up to the total', () => {
    expect(checkoutLineItems(snapshot([1500, 1500]), 1000, 4000)).toEqual([
      { name: 'Event fee (per family)', amount_cents: 1000 },
      { name: 'Aoife: 210R Comp 0', amount_cents: 1500 },
      { name: 'Aoife: 211R Comp 1', amount_cents: 1500 },
    ])
  })

  it('charges one capped line when the family max applies, since Stripe has no negative lines', () => {
    expect(checkoutLineItems(snapshot([1500, 1500, 1500]), 1000, 4500)).toEqual([
      { name: 'Feis entries (family maximum applied)', amount_cents: 4500 },
    ])
  })

  it('leaves a free competition out instead of sending a zero-amount line', () => {
    expect(checkoutLineItems(snapshot([1500, 0]), 0, 1500)).toEqual([
      { name: 'Aoife: 210R Comp 0', amount_cents: 1500 },
    ])
  })
})

describe('the checkout for an order Submit priced', () => {
  // Two solos and a late fee, priced and frozen by the engine (Task 4)
  const schedule: FeeSchedule = {
    id: 's1', feis_listing_id: 'f1', event_fee_cents: 1000, solo_fee_cents: 1500, prelim_champ_fee_cents: 5000,
    open_champ_fee_cents: 6000, family_cap_cents: null, day_of_surcharge_cents: 0,
    late_fee_tiers: [{ starts_at: '2026-10-15T00:00:00Z', fee_cents: 2500, family_max_cents: null }],
  }
  const aoife: OrderDancer = {
    id: 'd1', household_id: 'h1', first_name: 'Aoife', last_name: 'Walsh', date_of_birth: '2018-05-01',
    gender: 'female', school_name: null, tcrg_name: null, championship_status: 'none', is_active: true,
    dance_levels: [{ dance_key: 'reel', level_key: 'NOV' }, { dance_key: 'slip_jig', level_key: 'NOV' }],
  }
  const solo = (id: string, code: string, dance: string): FeisCompetition => ({
    id, feis_listing_id: 'f1', age_group_key: 'U10', age_group_label: 'Under 10', age_max_jan1: 9, age_min_jan1: null,
    level_key: 'NOV', level_label: 'Novice', dance_key: dance, dance_label: dance, competition_type: 'solo',
    championship_key: null, fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false, grades_only: false,
    display_name: `Novice ${dance} U10`, display_code: code, capacity_cap: null, enabled: true,
  })

  it("adds up to the total the family was quoted, with each fee on its own entry and the order's own application fee", () => {
    const priced = priceOrder({
      now: new Date('2026-11-01T12:00:00Z'), ageCutoffDate: parseLocalDate('2027-01-01'),
      levels: [{ key: 'NOV', label: 'Novice', rank: 3 }], feisTermsUrl: null, dancers: [aoife],
      competitions: [solo('c1', '210R', 'reel'), solo('c2', '210SJ', 'slip_jig')],
      entries: [{ dancerId: 'd1', competitionId: 'c1' }, { dancerId: 'd1', competitionId: 'c2' }],
      feeSchedule: schedule,
    })
    const order = buildCreateOrderPayload(priced, { applicationFeePercent: 2.9, consentIp: null })
    const config = buildCheckoutConfig(configInput({
      totalCents: order.total_cents, applicationFeeCents: order.application_fee_cents,
      eventFeeCents: order.event_fee_cents, snapshot: order.purchase_snapshot,
    }))
    expect(config.line_items).toEqual([
      { name: 'Event fee (per family)', amount_cents: 1000 },
      { name: 'Aoife: 210R Novice reel U10', amount_cents: 4000 },
      { name: 'Aoife: 210SJ Novice slip_jig U10', amount_cents: 1500 },
    ])
    // The config carries the fee Submit worked out in whole basis points: 2.9% of $65.00 is 188.5 cents,
    // so 189 (a float percent gives 188)
    expect(config).toMatchObject({ total_cents: 6500, application_fee_cents: 189 })
  })
})
```
Create `tests/engine/checkout-policy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { checkoutBlockReason } from '@/lib/engine/checkout-policy'

const base = {
  listingStatus: 'open' as const, stripeAccountId: 'acct_1', competitionIds: ['c1'], enabledCompetitionIds: ['c1', 'c2'],
  totalCents: 4000,
}

describe('checkoutBlockReason', () => {
  it('lets a checkout start while the organiser keeps registration open, even after the deadline', () => {
    // Deadlines are not checked at Pay: a submitted order is a quote (spec §5)
    expect(checkoutBlockReason(base)).toBeNull()
  })
  it('stops new checkouts once the organiser closes registration', () => {
    expect(checkoutBlockReason({ ...base, listingStatus: 'closed' })).toBe('organiser_stopped')
  })
  it('stops new checkouts when a competition in the order is disabled', () => {
    expect(checkoutBlockReason({ ...base, enabledCompetitionIds: ['c2'] })).toBe('competition_unavailable')
  })
  it('needs a connected Stripe account', () => {
    expect(checkoutBlockReason({ ...base, stripeAccountId: null })).toBe('stripe_not_connected')
  })
  it('refuses totals below the minimum card charge', () => {
    expect(checkoutBlockReason({ ...base, totalCents: 49 })).toBe('amount_too_small')
  })
})
```
Create `tests/engine/stripe-errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { classifyStripeError } from '@/lib/engine/stripe-errors'

describe('classifyStripeError', () => {
  it('treats a key that is still being processed as in progress, whatever the error type', () => {
    expect(classifyStripeError({ type: 'StripeInvalidRequestError', code: 'idempotency_key_in_use', statusCode: 409 }))
      .toBe('in_progress')
    expect(classifyStripeError({ type: 'StripeIdempotencyError', statusCode: 409 })).toBe('in_progress')
  })
  it.each(['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'])('treats %s as retry with the same key', (type) => {
    expect(classifyStripeError({ type })).toBe('retry')
  })
  it.each(['StripeInvalidRequestError', 'StripeCardError', 'StripeAuthenticationError', 'StripePermissionError', 'StripeIdempotencyError'])(
    'treats %s as a refusal of this one request', (type) => {
      expect(classifyStripeError({ type, statusCode: 400 })).toBe('rejected')
    })
  it('falls back to the status code, and treats anything unknown as retry', () => {
    expect(classifyStripeError({ statusCode: 503 })).toBe('retry')
    expect(classifyStripeError({ statusCode: 429 })).toBe('retry')
    expect(classifyStripeError({ statusCode: 400 })).toBe('rejected')
    expect(classifyStripeError(new Error('socket hang up'))).toBe('retry')
  })
})
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run tests/engine/checkout-config.test.ts tests/engine/checkout-policy.test.ts tests/engine/stripe-errors.test.ts`
Expected: FAIL. The modules don't exist.

- [ ] **Step 3: Write the checkout config**

Create `src/lib/engine/checkout-config.ts`:
```ts
import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

export const CHECKOUT_WINDOW_MINUTES = 60
export const HOLD_AFTER_CHECKOUT_MINUTES = 15

export interface CheckoutLineItem {
  name: string
  amount_cents: number
}

/** The complete Stripe Checkout request for one claim, frozen when the claim is made (spec §6). */
export interface CheckoutConfig {
  version: 1
  account: string
  currency: 'usd'
  total_cents: number
  application_fee_cents: number
  line_items: CheckoutLineItem[]
  success_url: string
  cancel_url: string
  /** Unix seconds */
  expires_at: number
  payment_method_types: ['card']
  client_reference_id: string
  metadata: { registration_id: string; claim_id: string }
  idempotency_key: string
}

export interface CheckoutConfigInput {
  registrationId: string
  feisListingId: string
  claimId: string
  account: string
  totalCents: number
  applicationFeeCents: number
  eventFeeCents: number
  snapshot: PurchaseSnapshot
  baseUrl: string
  now: Date
}

export function checkoutLineItems(
  snapshot: PurchaseSnapshot,
  eventFeeCents: number,
  totalCents: number
): CheckoutLineItem[] {
  const dancers = new Map(snapshot.dancers.map((d) => [d.id, d]))
  const competitions = new Map(snapshot.competitions.map((c) => [c.id, c]))
  const items: CheckoutLineItem[] = []
  if (eventFeeCents > 0) items.push({ name: 'Event fee (per family)', amount_cents: eventFeeCents })
  for (const entry of snapshot.entries) {
    const amount = entry.base_fee_cents + entry.late_fee_cents + entry.day_of_surcharge_cents
    if (amount === 0) continue
    const dancer = dancers.get(entry.dancer_id)
    const competition = competitions.get(entry.competition_id)
    const label = [competition?.display_code, competition?.display_name].filter(Boolean).join(' ')
    items.push({ name: `${dancer?.first_name ?? 'Dancer'}: ${label || 'Competition entry'}`, amount_cents: amount })
  }
  const sum = items.reduce((total, item) => total + item.amount_cents, 0)
  // Stripe has no negative line items, so a family-max discount becomes one line at the capped total
  if (sum !== totalCents) return [{ name: 'Feis entries (family maximum applied)', amount_cents: totalCents }]
  return items
}

export function buildCheckoutConfig(input: CheckoutConfigInput): CheckoutConfig {
  return {
    version: 1,
    account: input.account,
    currency: 'usd',
    total_cents: input.totalCents,
    application_fee_cents: input.applicationFeeCents,
    line_items: checkoutLineItems(input.snapshot, input.eventFeeCents, input.totalCents),
    success_url: `${input.baseUrl}/feiseanna/${input.feisListingId}/register/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.baseUrl}/feiseanna/${input.feisListingId}/register`,
    expires_at: Math.floor(input.now.getTime() / 1000) + CHECKOUT_WINDOW_MINUTES * 60,
    payment_method_types: ['card'],
    client_reference_id: input.registrationId,
    metadata: { registration_id: input.registrationId, claim_id: input.claimId },
    idempotency_key: `checkout:${input.registrationId}:${input.claimId}`
  }
}
```

- [ ] **Step 4: Write the checkout policy**

Create `src/lib/engine/checkout-policy.ts`:
```ts
import type { ListingStatus } from '@/lib/types/feis-listing'

export const MIN_CHARGE_CENTS = 50

export type CheckoutBlock =
  | 'organiser_stopped'
  | 'competition_unavailable'
  | 'stripe_not_connected'
  | 'amount_too_small'

export const CHECKOUT_BLOCK_MESSAGES: Record<CheckoutBlock, string> = {
  organiser_stopped: 'Registration has been closed by the organiser.',
  competition_unavailable:
    'A competition in this registration is no longer available. Please cancel it and start again.',
  stripe_not_connected: "The organiser hasn't finished setting up payments yet. Please try again later.",
  amount_too_small: 'This registration is below the minimum card payment. Please contact the organiser.'
}

/**
 * Whether a new checkout may start for a submitted order (spec §5). Deadlines are not checked
 * here: a submitted order is a quote that can be paid within its hold.
 */
export function checkoutBlockReason(input: {
  listingStatus: ListingStatus
  stripeAccountId: string | null
  competitionIds: string[]
  enabledCompetitionIds: string[]
  totalCents: number
}): CheckoutBlock | null {
  if (input.listingStatus !== 'open') return 'organiser_stopped'
  const enabled = new Set(input.enabledCompetitionIds)
  if (input.competitionIds.some((id) => !enabled.has(id))) return 'competition_unavailable'
  if (!input.stripeAccountId) return 'stripe_not_connected'
  if (input.totalCents < MIN_CHARGE_CENTS) return 'amount_too_small'
  return null
}
```

- [ ] **Step 5: Write the Stripe error classifier**

Create `src/lib/engine/stripe-errors.ts`:
```ts
/**
 * What one failed Stripe call says about that request. It never says what an earlier attempt with
 * the same idempotency key did: Stripe can cache a 500 even when the session was made.
 * - 'in_progress': the same key is still being processed; retry later with the same key
 * - 'retry': the outcome is unknown (network, Stripe 5xx, rate limit); retry with the same key
 * - 'rejected': Stripe refused this request (bad parameters, a key reused with different
 *   parameters, authentication, permissions)
 * When attempts end without a session, the workflow looks the session up (spec §6a).
 */
export type StripeFailure = 'in_progress' | 'retry' | 'rejected'

export function classifyStripeError(err: unknown): StripeFailure {
  const e = (err ?? {}) as { type?: string; code?: string; statusCode?: number }
  if (e.code === 'idempotency_key_in_use' || e.statusCode === 409) return 'in_progress'
  switch (e.type) {
    case 'StripeConnectionError':
    case 'StripeAPIError':
    case 'StripeRateLimitError':
      return 'retry'
    case 'StripeInvalidRequestError':
    case 'StripeCardError':
    case 'StripeAuthenticationError':
    case 'StripePermissionError':
    case 'StripeIdempotencyError':
      return 'rejected'
  }
  if (typeof e.statusCode === 'number') return e.statusCode >= 500 || e.statusCode === 429 ? 'retry' : 'rejected'
  return 'retry'
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine/checkout-config.ts src/lib/engine/checkout-policy.ts src/lib/engine/stripe-errors.ts tests/engine/checkout-config.test.ts tests/engine/checkout-policy.test.ts tests/engine/stripe-errors.test.ts
git commit -m "feat: frozen Stripe checkout request, checkout policy and Stripe error classes"
```

---

### Task 6: Migration 013 (`create_order`) and the order store (done)

**Files:**
- Create: `supabase/migrations/013_create_order.sql`
- Create: `src/app/_payments/rpc.ts`
- Create: `src/app/_payments/order-store.ts`
- Create: `tests/db/helpers/pg-rpc.ts`
- Modify: `tests/db/helpers/fixtures.ts` (add `buildPayload` and `createDraftOrder`)
- Test: `tests/db/create-order.test.ts`

**Interfaces:**
- Consumes:
  - `CreateOrderPayload`, `PurchaseSnapshot`, `priceOrder`, `buildCreateOrderPayload`, `ageCutoffDateFor` and `RequestedEntry` (Task 4)
  - `CheckoutConfig` (Task 5)
- Produces:
  - **SQL:**
    - `lock_household_feis(uuid, uuid)` (internal)
    - `create_order(p_household_id uuid, p_feis_listing_id uuid, p_order jsonb) → jsonb`
    - `get_order_for_checkout(p_registration_id uuid, p_household_id uuid) → jsonb`
  - **RPC:** `RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>`, and `supabaseRpc(client: ServiceClient): RpcCaller`.
  - **Order store:** `createOrderStore(rpc)`, with:
    - `createOrder(householdId, feisListingId, payload): Promise<CreateOrderResult>`
    - `getOrderForCheckout(registrationId, householdId): Promise<CheckoutOrder | null>`
    - the types `OrderStore`, `CheckoutOrder` and `CreateOrderResult`
  - **Test helpers:** `pgRpc(pool): RpcCaller`, plus the fixtures `buildPayload(...)`, `createDraftOrder(pool, opts)` and `DraftOrderFixture`.

- [ ] **Step 1: Write the RPC caller, the store, and the test RPC**

Create `src/app/_payments/rpc.ts`:
```ts
import type { ServiceClient } from '@/lib/supabase/service'

/** Calls a pre_registration database function by name, with named arguments. */
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>

export function supabaseRpc(client: ServiceClient): RpcCaller {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new Error(`${fn} failed: ${error.message}`)
    return data
  }
}
```
Create `src/app/_payments/order-store.ts`:
```ts
import type { CheckoutConfig } from '@/lib/engine/checkout-config'
import type { CreateOrderPayload, PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'
import type { ListingStatus, RegistrationStatus } from '@/lib/types/feis-listing'
import type { RpcCaller } from './rpc'

export type CreateOrderResult =
  | { status: 'created'; registration_id: string; hold_expires_at: string }
  | {
      status: 'refused'
      reason: 'listing_closed' | 'outside_window' | 'active_order_exists'
      registration_id?: string
    }

/** An order as Pay, Cancel and the sync see it (get_order_for_checkout). */
export interface CheckoutOrder {
  id: string
  household_id: string
  feis_listing_id: string
  status: RegistrationStatus
  total_cents: number
  application_fee_cents: number
  event_fee_cents: number
  hold_expires_at: string | null
  confirmation_number: string | null
  checkout_claim_id: string | null
  checkout_config: CheckoutConfig | null
  checkout_claimed_at: string | null
  checkout_expires_at: string | null
  stripe_checkout_session_id: string | null
  purchase_snapshot: PurchaseSnapshot
  listing: { status: ListingStatus; stripe_account_id: string | null }
  competition_ids: string[]
  enabled_competition_ids: string[]
}

export function createOrderStore(rpc: RpcCaller) {
  return {
    async createOrder(
      householdId: string,
      feisListingId: string,
      payload: CreateOrderPayload
    ): Promise<CreateOrderResult> {
      return (await rpc('create_order', {
        p_household_id: householdId,
        p_feis_listing_id: feisListingId,
        p_order: payload
      })) as CreateOrderResult
    },

    async getOrderForCheckout(registrationId: string, householdId: string): Promise<CheckoutOrder | null> {
      return (await rpc('get_order_for_checkout', {
        p_registration_id: registrationId,
        p_household_id: householdId
      })) as CheckoutOrder | null
    }
  }
}

export type OrderStore = ReturnType<typeof createOrderStore>
```
Create `tests/db/helpers/pg-rpc.ts`:
```ts
import type { Pool } from 'pg'
import type { RpcCaller } from '@/app/_payments/rpc'
import { asService } from './db'

/** The same calls supabase.rpc makes, sent straight to the test database as the service role. */
export function pgRpc(pool: Pool): RpcCaller {
  return async (fn, args) => {
    const names = Object.keys(args)
    const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ')
    const values = names.map((name) => {
      const value = args[name]
      if (value === undefined) return null
      return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
    })
    return asService(pool, async (client) => {
      const { rows } = await client.query(`SELECT pre_registration.${fn}(${params}) AS result`, values)
      return rows[0]?.result ?? null
    })
  }
}
```

- [ ] **Step 2: Add the order fixtures**

Append to `tests/db/helpers/fixtures.ts`:
```ts
import { ageCutoffDateFor, type RequestedEntry } from '@/lib/engine/order-validation'
import { buildCreateOrderPayload, priceOrder, type CreateOrderPayload } from '@/lib/engine/purchase-snapshot'
import { createOrderStore } from '@/app/_payments/order-store'
import { pgRpc } from './pg-rpc'

export function buildPayload(input: {
  listing: ListingFixture
  dancers: FixtureDancer[]
  entries: RequestedEntry[]
  now?: Date
}): CreateOrderPayload {
  const now = input.now ?? new Date()
  const priced = priceOrder({
    now,
    ageCutoffDate: ageCutoffDateFor(input.listing.listing, now),
    levels: LEVELS,
    feisTermsUrl: input.listing.listing.terms_url,
    dancers: input.dancers,
    competitions: input.listing.competitions,
    entries: input.entries,
    feeSchedule: input.listing.feeSchedule,
  })
  // 5% in whole basis points: $40.00 gives an application fee of 200 cents
  return buildCreateOrderPayload(priced, { applicationFeePercent: 5, consentIp: '203.0.113.7' })
}

export interface DraftOrderFixture {
  family: Family
  listing: ListingFixture
  dancers: FixtureDancer[]
  entries: RequestedEntry[]
  payload: CreateOrderPayload
  registrationId: string
}

/** A real draft order, made through create_order: Novice Reel and Novice Slip Jig for one dancer, $40.00. */
export async function createDraftOrder(
  pool: Pool,
  opts: { family?: Family; listing?: ListingFixture } = {}
): Promise<DraftOrderFixture> {
  const listing = opts.listing ?? (await createListing(pool))
  const family = opts.family ?? (await createFamily(pool))
  const dancer = await createDancer(pool, family.householdId)
  const entries = [
    { dancerId: dancer.id, competitionId: listing.competitions[0].id },
    { dancerId: dancer.id, competitionId: listing.competitions[1].id },
  ]
  const payload = buildPayload({ listing, dancers: [dancer], entries })
  const result = await createOrderStore(pgRpc(pool)).createOrder(family.householdId, listing.listing.id, payload)
  if (result.status !== 'created') throw new Error(`Fixture order was refused: ${result.reason}`)
  return { family, listing, dancers: [dancer], entries, payload, registrationId: result.registration_id }
}
```
Move the new `import` lines to the top of the file with the others.

- [ ] **Step 3: Write the failing tests**

Create `tests/db/create-order.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore } from '@/app/_payments/order-store'
import { CONSENT_VERSION, PLATFORM_TERMS_VERSION } from '@/lib/engine/purchase-snapshot'
import { asParent, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { buildPayload, createDancer, createDraftOrder, createFamily, createListing } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: ReturnType<typeof createOrderStore>

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

async function ordersFor(householdId: string): Promise<number> {
  const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM registrations WHERE household_id = $1', [householdId])
  return rows[0].n
}

describe('create_order', () => {
  it('creates the order, its entries and its frozen details in one step', async () => {
    const order = await createDraftOrder(db.pool)
    const { rows: [row] } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [order.registrationId])
    expect(row).toMatchObject({
      status: 'draft', total_cents: 4000, application_fee_cents: 200, event_fee_cents: 1000, consent_ip: '203.0.113.7',
      consent_version: CONSENT_VERSION, platform_terms_version: PLATFORM_TERMS_VERSION,
    })
    expect(row.purchase_snapshot).toEqual(order.payload.purchase_snapshot)
    // create_order stamps the consent time itself, when it creates the order: the payload carries none
    expect(row.consent_accepted_at).toBe(row.created_at)
    const holdMinutes = (new Date(row.hold_expires_at).getTime() - Date.now()) / 60_000
    expect(holdMinutes).toBeGreaterThan(29)
    expect(holdMinutes).toBeLessThanOrEqual(30)
    const { rows: entries } = await db.pool.query(
      'SELECT count(*)::int AS n, sum(base_fee_cents)::int AS fees FROM registration_entries WHERE registration_id = $1',
      [order.registrationId]
    )
    expect(entries[0]).toEqual({ n: 2, fees: 3000 })
  })

  it('refuses a second active order for the same family and feis', async () => {
    const first = await createDraftOrder(db.pool)
    const again = await store.createOrder(first.family.householdId, first.listing.listing.id, first.payload)
    expect(again).toEqual({ status: 'refused', reason: 'active_order_exists', registration_id: first.registrationId })
  })

  it('refuses once the organiser closes registration, and after the deadline', async () => {
    const family = await createFamily(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)

    const closed = await createListing(db.pool, { status: 'closed' })
    const closedPayload = buildPayload({ listing: closed, dancers: [dancer], entries: [{ dancerId: dancer.id, competitionId: closed.competitions[0].id }] })
    expect(await store.createOrder(family.householdId, closed.listing.id, closedPayload))
      .toEqual({ status: 'refused', reason: 'listing_closed' })

    const late = await createListing(db.pool, { regClosesAt: new Date(Date.now() - 60_000).toISOString() })
    const latePayload = buildPayload({ listing: late, dancers: [dancer], entries: [{ dancerId: dancer.id, competitionId: late.competitions[0].id }] })
    expect(await store.createOrder(family.householdId, late.listing.id, latePayload))
      .toEqual({ status: 'refused', reason: 'outside_window' })
  })

  it('creates nothing when an entry does not match the frozen details', async () => {
    const family = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const payload = buildPayload({ listing, dancers: [dancer], entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }] })
    payload.entries[0].base_fee_cents = 1
    expect(await refused(store.createOrder(family.householdId, listing.listing.id, payload))).toMatch(/do not match the purchase snapshot/)
    expect(await ordersFor(family.householdId)).toBe(0)
  })

  it('creates nothing when the totals do not match', async () => {
    const family = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const payload = buildPayload({ listing, dancers: [dancer], entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }] })
    payload.total_cents += 100
    expect(await refused(store.createOrder(family.householdId, listing.listing.id, payload))).toMatch(/totals do not match/)
    expect(await ordersFor(family.householdId)).toBe(0)
  })

  it("creates nothing for another family's dancer", async () => {
    const family = await createFamily(db.pool)
    const other = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const theirDancer = await createDancer(db.pool, other.householdId)
    const payload = buildPayload({ listing, dancers: [theirDancer], entries: [{ dancerId: theirDancer.id, competitionId: listing.competitions[0].id }] })
    expect(await refused(store.createOrder(family.householdId, listing.listing.id, payload))).toMatch(/not available/)
    expect(await ordersFor(family.householdId)).toBe(0)
  })

  it('keeps the order unchanged when the parent edits the dancer afterwards', async () => {
    const order = await createDraftOrder(db.pool)
    const dancerId = order.dancers[0].id
    await asParent(db.pool, order.family.userId, async (c) => {
      await c.query(`UPDATE dancers SET date_of_birth = '2012-01-01', school_name = 'New School' WHERE id = $1`, [dancerId])
      await c.query(`UPDATE dancer_dance_levels SET level_key = 'PW' WHERE dancer_id = $1`, [dancerId])
    })
    const { rows: [row] } = await db.pool.query('SELECT purchase_snapshot FROM registrations WHERE id = $1', [order.registrationId])
    expect(row.purchase_snapshot).toEqual(order.payload.purchase_snapshot)
    expect(row.purchase_snapshot.dancers[0]).toMatchObject({ date_of_birth: '2018-05-01', school_name: 'Scoil Rince Test' })
  })

  it('lets only the service role create orders', async () => {
    const order = await createDraftOrder(db.pool)
    const message = await refused(asParent(db.pool, order.family.userId, (c) =>
      c.query('SELECT create_order($1, $2, $3)', [order.family.householdId, order.listing.listing.id, JSON.stringify(order.payload)])))
    expect(message).toMatch(/permission denied/)
  })

  it('serialises two submits for the same family and feis', async () => {
    const family = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const payload = buildPayload({ listing, dancers: [dancer], entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }] })
    const results = await Promise.all([
      store.createOrder(family.householdId, listing.listing.id, payload),
      store.createOrder(family.householdId, listing.listing.id, payload),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'refused'])
    expect(await ordersFor(family.householdId)).toBe(1)
  })
})

describe('get_order_for_checkout', () => {
  it("returns the order with its listing's state, only to its own household", async () => {
    const order = await createDraftOrder(db.pool)
    const found = await store.getOrderForCheckout(order.registrationId, order.family.householdId)
    expect(found).toMatchObject({
      id: order.registrationId, status: 'draft', total_cents: 4000, checkout_claim_id: null,
      listing: { status: 'open', stripe_account_id: 'acct_test_feis' },
    })
    expect(found?.competition_ids.sort()).toEqual(order.entries.map((e) => e.competitionId).sort())
    expect(found?.enabled_competition_ids).toHaveLength(3)

    const stranger = await createFamily(db.pool)
    expect(await store.getOrderForCheckout(order.registrationId, stranger.householdId)).toBeNull()
  })
})
```

- [ ] **Step 4: Run them to confirm they fail**

Run: `npm run test:db -- tests/db/create-order.test.ts`
Expected: FAIL with `function pre_registration.create_order(...) does not exist`.

- [ ] **Step 5: Write migration 013**

Create `supabase/migrations/013_create_order.sql`:
```sql
-- 013_create_order.sql
-- Payment hardening, part 2: an order, its entries, consent and frozen details are created
-- in one transaction, or not at all. Spec §1, §4.

SET search_path TO pre_registration, public;

-- Serialises everything that can create or revive an active order for one family at one feis
CREATE OR REPLACE FUNCTION lock_household_feis(p_household_id uuid, p_feis_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':' || p_feis_listing_id::text, 0));
END;
$$;

REVOKE ALL ON FUNCTION lock_household_feis(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION create_order(p_household_id uuid, p_feis_listing_id uuid, p_order jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_listing feis_listings%ROWTYPE;
  v_close timestamptz;
  v_existing uuid;
  v_id uuid := gen_random_uuid();
  v_hold timestamptz := now() + interval '30 minutes';
  v_snapshot jsonb := p_order -> 'purchase_snapshot';
  v_breakdown jsonb := p_order -> 'purchase_snapshot' -> 'pricing' -> 'breakdown';
  v_mismatches integer;
  v_entry_total integer;
BEGIN
  PERFORM lock_household_feis(p_household_id, p_feis_listing_id);

  SELECT * INTO v_listing FROM feis_listings WHERE id = p_feis_listing_id;
  IF NOT FOUND OR v_listing.status <> 'open' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'listing_closed');
  END IF;
  v_close := coalesce(v_listing.late_reg_closes_at, v_listing.reg_closes_at);
  IF (v_listing.reg_opens_at IS NOT NULL AND now() < v_listing.reg_opens_at)
     OR (v_close IS NOT NULL AND now() > v_close) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'outside_window');
  END IF;

  SELECT id INTO v_existing FROM registrations
  WHERE household_id = p_household_id AND feis_listing_id = p_feis_listing_id
    AND status IN ('draft', 'pending_payment', 'paid')
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'active_order_exists', 'registration_id', v_existing);
  END IF;

  -- Migration 012 lets an order and its entries in only while this marker names that order, and only
  -- in the transaction that created it, so created_at is left to its default (now()). The order starts
  -- as a draft with a 30-minute hold and no checkout or payment details, and the consent time is
  -- stamped here: the payload carries none.
  PERFORM set_config('pre_registration.creating_order', v_id::text, true);

  INSERT INTO registrations (id, feis_listing_id, household_id, status, total_cents, application_fee_cents,
    event_fee_cents, is_late, consent_accepted_at, consent_version, platform_terms_version, consent_ip,
    hold_expires_at, purchase_snapshot)
  VALUES (v_id, p_feis_listing_id, p_household_id, 'draft',
    (p_order ->> 'total_cents')::integer, (p_order ->> 'application_fee_cents')::integer,
    (p_order ->> 'event_fee_cents')::integer, (p_order ->> 'is_late')::boolean,
    now(), p_order ->> 'consent_version', p_order ->> 'platform_terms_version', p_order ->> 'consent_ip',
    v_hold, v_snapshot);

  INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category,
    base_fee_cents, late_fee_cents, day_of_surcharge_cents)
  SELECT v_id, e.dancer_id, e.feis_competition_id, e.fee_category,
         e.base_fee_cents, e.late_fee_cents, e.day_of_surcharge_cents
  FROM jsonb_to_recordset(p_order -> 'entries') AS e(dancer_id uuid, feis_competition_id uuid, fee_category text,
    base_fee_cents integer, late_fee_cents integer, day_of_surcharge_cents integer);

  PERFORM set_config('pre_registration.creating_order', '', true);

  IF NOT EXISTS (SELECT 1 FROM registration_entries WHERE registration_id = v_id) THEN
    RAISE EXCEPTION 'an order needs at least one entry';
  END IF;

  -- The entries must be exactly the snapshot's entries, fee for fee
  WITH stored AS (
    SELECT dancer_id, feis_competition_id AS competition_id, base_fee_cents, late_fee_cents, day_of_surcharge_cents
    FROM registration_entries WHERE registration_id = v_id
  ), frozen AS (
    SELECT s.dancer_id, s.competition_id, s.base_fee_cents, s.late_fee_cents, s.day_of_surcharge_cents
    FROM jsonb_to_recordset(v_snapshot -> 'entries') AS s(dancer_id uuid, competition_id uuid,
      base_fee_cents integer, late_fee_cents integer, day_of_surcharge_cents integer)
  )
  SELECT count(*) INTO v_mismatches FROM (
    (SELECT * FROM stored EXCEPT ALL SELECT * FROM frozen)
    UNION ALL
    (SELECT * FROM frozen EXCEPT ALL SELECT * FROM stored)
  ) AS diff;
  IF v_mismatches > 0 THEN
    RAISE EXCEPTION 'order entries do not match the purchase snapshot';
  END IF;

  -- The totals must be the snapshot's priced totals
  SELECT coalesce(sum(base_fee_cents + late_fee_cents + day_of_surcharge_cents), 0)::integer INTO v_entry_total
  FROM registration_entries WHERE registration_id = v_id;
  IF (p_order ->> 'total_cents')::integer IS DISTINCT FROM (v_breakdown ->> 'grand_total_cents')::integer
     OR (p_order ->> 'event_fee_cents')::integer IS DISTINCT FROM (v_breakdown ->> 'event_fee_cents')::integer
     OR (v_entry_total + (v_breakdown ->> 'event_fee_cents')::integer
         - (v_breakdown ->> 'family_cap_savings_cents')::integer)
        IS DISTINCT FROM (p_order ->> 'total_cents')::integer THEN
    RAISE EXCEPTION 'order totals do not match the purchase snapshot';
  END IF;

  -- Every dancer is this family's and active; every competition is this feis's and enabled
  IF EXISTS (
    SELECT 1 FROM registration_entries e
    LEFT JOIN dancers d
      ON d.id = e.dancer_id AND d.household_id = p_household_id AND d.is_active
    LEFT JOIN feis_competitions c
      ON c.id = e.feis_competition_id AND c.feis_listing_id = p_feis_listing_id AND c.enabled
    WHERE e.registration_id = v_id AND (d.id IS NULL OR c.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'order entries name a dancer or competition that is not available';
  END IF;

  RETURN jsonb_build_object('status', 'created', 'registration_id', v_id, 'hold_expires_at', v_hold);
END;
$$;

REVOKE ALL ON FUNCTION create_order(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_order(uuid, uuid, jsonb) TO service_role;

-- Everything Pay, Cancel and the confirmation sync need to decide what to do with an order
CREATE OR REPLACE FUNCTION get_order_for_checkout(p_registration_id uuid, p_household_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'household_id', r.household_id,
    'feis_listing_id', r.feis_listing_id,
    'status', r.status,
    'total_cents', r.total_cents,
    'application_fee_cents', r.application_fee_cents,
    'event_fee_cents', r.event_fee_cents,
    'hold_expires_at', r.hold_expires_at,
    'confirmation_number', r.confirmation_number,
    'checkout_claim_id', r.checkout_claim_id,
    'checkout_config', r.checkout_config,
    'checkout_claimed_at', r.checkout_claimed_at,
    'checkout_expires_at', r.checkout_expires_at,
    'stripe_checkout_session_id', r.stripe_checkout_session_id,
    'purchase_snapshot', r.purchase_snapshot,
    'listing', jsonb_build_object('status', l.status, 'stripe_account_id', l.stripe_account_id),
    'competition_ids', coalesce(
      (SELECT jsonb_agg(DISTINCT e.feis_competition_id) FROM registration_entries e WHERE e.registration_id = r.id),
      '[]'::jsonb),
    'enabled_competition_ids', coalesce(
      (SELECT jsonb_agg(c.id) FROM feis_competitions c WHERE c.feis_listing_id = r.feis_listing_id AND c.enabled),
      '[]'::jsonb)
  )
  FROM registrations r
  JOIN feis_listings l ON l.id = r.feis_listing_id
  WHERE r.id = p_registration_id AND r.household_id = p_household_id
$$;

REVOKE ALL ON FUNCTION get_order_for_checkout(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_order_for_checkout(uuid, uuid) TO service_role;
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/013_create_order.sql src/app/_payments/rpc.ts src/app/_payments/order-store.ts tests/db/helpers/pg-rpc.ts tests/db/helpers/fixtures.ts tests/db/create-order.test.ts
git commit -m "feat: create orders in one transaction, checked against their frozen details (migration 013)"
```

---

### Task 7: Submit action and the register page (done)

**Files:**
- Create: `src/lib/fetch-all-rows.ts`
- Modify: `src/lib/engine/order-validation.ts` and `src/lib/engine/purchase-snapshot.ts` (the snapshot freezes each dancer's `relationship` and `school_id`, from migration 018)
- Modify: `tests/engine/checkout-config.test.ts` (Task 5's typed snapshot literal gains those two fields)
- Modify: `src/lib/types/feis-listing.ts` (the new `Registration` fields)
- Modify: `src/app/feiseanna/[id]/register/actions.ts`: Submit (`createDraftRegistration`) and the resume lookup (`getExistingRegistration`). `cancelRegistration` moves below Submit unchanged, and `createCheckoutSession` stays as it is; Task 12 replaces both.
- Modify: `src/app/feiseanna/[id]/register/page.tsx` (competitions read in pages)
- Modify: `src/components/registration/entry-page.tsx` (the engine's rules instead of its own copies, the agreement sent as a yes, the frozen price)
- Modify: `src/components/registration/family-receipt.tsx` (Pay reports the agreement box; the wording is tied to `CONSENT_VERSION`)
- Test: `tests/fetch-all-rows.test.ts` (create); `tests/engine/order-validation.test.ts` and `tests/engine/purchase-snapshot.test.ts` (modify)
- Local only (never committed): `.env.local`

**Interfaces:**
- Consumes:
  - `validateOrderRequest`, `ageCutoffDateFor`, `toDancerProfile`, `OrderDancer` and `RequestedEntry` (Task 4, `order-validation.ts`)
  - `priceOrder` (its input includes `feisTermsUrl`), `buildCreateOrderPayload`, `feeEntriesFor`, `CreateOrderPayload` and `CONSENT_VERSION` (Task 4, `purchase-snapshot.ts`)
  - `clientIpFrom` (Task 4)
  - `supabaseRpc`, `createOrderStore` and `CreateOrderResult` (Task 6)
  - `getSignedInUser` (`src/lib/supabase/server.ts`); `isHouseholdComplete` and `REQUIRED_HOUSEHOLD_FIELDS` (`src/lib/household.ts`)
- Produces:
  - `createDraftRegistration({ feisListingId, entries, consentAccepted }): Promise<{ error: string } | { registrationId: string; totalCents: number; holdExpiresAt: string; breakdown: FeeBreakdown }>`
  - `getExistingRegistration(feisListingId)`, now read-only. It resolves to `{ registration }`, `{ registration: null, expired?: true }` or `{ error }`.
  - `currentHousehold(): Promise<HouseholdContext>`, private to `actions.ts`. Task 12's Pay and Cancel use it.
  - `fetchAllRows<Row>(fetchPage, pageSize?): Promise<Row[]>`, `RowPage<Row>` and `ROWS_PER_PAGE` (`src/lib/fetch-all-rows.ts`)
  - `OrderDancer` gains `school_id` and `relationship`, optional as they are on `Dancer`. `SnapshotDancer` gains `school_id: string | null` and `relationship: 'household' | 'guest'`, always set. Any later typed `PurchaseSnapshot` literal needs both.
  - `Registration` gains `purchase_snapshot`, `checkout_claim_id`, `checkout_expires_at` and `paid_at`.
  - On the entry page, `requestedEntries` and the `orderBreakdown` state (with `setOrderBreakdown`), which Task 12's handlers use. `FamilyReceipt`'s `onPay` becomes `(consentAccepted: boolean) => void`.

The entry page and Submit must apply one rule. The page imports `ageCutoffDateFor`, `toDancerProfile` and `feeEntriesFor` from the engine and deletes its own copies (`ageCutoffOf`, `profileOf` and its fee-entry builder). So a dance the page offers, and the total it shows, are the ones Submit accepts and charges. The page now sends only `consentAccepted`: its made-up `consentAcceptedAt` and `consentIp: '0.0.0.0'` go. The old consent literals in `actions.ts` go too. The consent and terms versions now come only from `buildCreateOrderPayload` (`CONSENT_VERSION` and `PLATFORM_TERMS_VERSION`), and `create_order` stamps the consent time itself; Task 6's tests pin both versions to those constants.

Migration 018 (on `main`) lets an account holder enter a guest, someone else's child, and links each dancer to a shared schools list. A guest is still a row under the account holder's household, so the household check doesn't change. But an order keeps what it was placed with, so the snapshot now freezes each dancer's `relationship` and `school_id` too (Steps 2–3).

PostgREST returns at most 1000 rows per request: `max_rows` in `supabase/config.toml`, and Supabase's default. A large syllabus can pass that, and a short list would change which age group counts as a dancer's own. So Submit and the page read competitions through `fetchAllRows`. The helper never touches Supabase: the caller passes the query, so queries stay in the page and the action.

`handlePay` keeps its one click: it submits the order, then calls the old `createCheckoutSession`, which Task 12 replaces. Components need no tests (project rule §5). The paging helper is tested, and the two engine functions the page now shares get direct tests.

No browser run in this task. `.env.local` points at the live project, which gets migrations 012–017 only in Task 16 Step 7, so `create_order` doesn't exist there yet. Task 16 Step 11 runs the whole flow.

- [ ] **Step 1: Give the server its database key and fee percentage locally**

Pre-reg and the feis-day app share one Supabase project, so the service key is the one already in `.env.local` under `PHASE1_`. Submit now refuses to price an order while `STRIPE_APPLICATION_FEE_PERCENT` is missing (spec §4), so set it locally to 5, the value the old code fell back to. Task 16 confirms the live value.
```bash
cd ~/FEISSTAB-PRE-REG
grep -q '^SUPABASE_SERVICE_ROLE_KEY=' .env.local || grep '^PHASE1_SUPABASE_SERVICE_ROLE_KEY=' .env.local | sed 's/^PHASE1_//' >> .env.local
grep -q '^STRIPE_APPLICATION_FEE_PERCENT=' .env.local || echo 'STRIPE_APPLICATION_FEE_PERCENT=5' >> .env.local
grep -cE '^(SUPABASE_SERVICE_ROLE_KEY|STRIPE_APPLICATION_FEE_PERCENT)=' .env.local
```
Expected: `2`. Don't print the values.

- [ ] **Step 2: Write the failing tests for guests and school links (migration 018)**

In `tests/engine/purchase-snapshot.test.ts`:

(a) The first `priceOrder` test checks the frozen dancer exactly, so it gains the two fields, in that literal's own style. Replace:
```ts
      dance_levels: { reel: 'NOV', slip_jig: 'NOV' }, competition_age: 8,
    }])
```
with:
```ts
      dance_levels: { reel: 'NOV', slip_jig: 'NOV' }, competition_age: 8, school_id: null,
      relationship: 'household',
    }])
```

(b) Append to `tests/engine/purchase-snapshot.test.ts`:
```ts
// Migration 018: the order keeps whether each dancer was a guest (someone else's child the
// account holder entered) and their school's id, as they were when it was placed
describe('guests and school links', () => {
  it('freezes whether each dancer is a guest, and their school id', () => {
    const niamh: OrderDancer = {
      ...aoife,
      id: 'd2',
      first_name: 'Niamh',
      relationship: 'guest',
      school_id: 'b7a1c2d3-0000-4000-8000-000000000018'
    }
    const { snapshot } = priceOrder(
      input({
        dancers: [aoife, niamh],
        entries: [
          { dancerId: 'd1', competitionId: 'c1' },
          { dancerId: 'd2', competitionId: 'c2' }
        ]
      })
    )
    // Aoife has neither field set, so she freezes as a household dancer with no school link
    expect(snapshot.dancers.map((d) => [d.id, d.relationship, d.school_id])).toEqual([
      ['d1', 'household', null],
      ['d2', 'guest', 'b7a1c2d3-0000-4000-8000-000000000018']
    ])
  })
})
```

(c) Append to `tests/engine/order-validation.test.ts`:
```ts
// Migration 018: a guest is someone else's child the account holder enters. The row still belongs
// to the account holder's household, so the household check treats a guest like any dancer.
describe('guest dancers', () => {
  it("accepts a guest under the account holder's household, and refuses one under another", () => {
    const guest = dancer({ relationship: 'guest' })
    expect(validateOrderRequest(request({ dancers: [guest] })).ok).toBe(true)
    expect(validateOrderRequest(request({ dancers: [{ ...guest, household_id: 'h2' }] }))).toEqual({
      ok: false,
      error: 'One or more dancers do not belong to your family.'
    })
  })
})
```

Run: `npx vitest run tests/engine/purchase-snapshot.test.ts tests/engine/order-validation.test.ts`
Expected: FAIL in the two snapshot tests, because the frozen dancer has no `school_id` or `relationship` yet. The guest test already passes: guests need no new rule.

- [ ] **Step 3: Freeze each dancer's guest status and school link, and commit**

(a) In `src/lib/engine/order-validation.ts`, replace:
```ts
  | 'school_name' | 'tcrg_name' | 'championship_status' | 'is_active'
```
with:
```ts
  | 'school_name' | 'school_id' | 'relationship' | 'tcrg_name' | 'championship_status' | 'is_active'
```

(b) In `src/lib/engine/purchase-snapshot.ts`, replace (in `interface SnapshotDancer`):
```ts
  school_name: string | null
  tcrg_name: string | null
```
with:
```ts
  school_name: string | null
  /** The shared schools list's row for school_name (migration 018), or null */
  school_id: string | null
  /** 'guest': someone else's child the account holder entered (migration 018) */
  relationship: 'household' | 'guest'
  tcrg_name: string | null
```

(c) In `src/lib/engine/purchase-snapshot.ts`, replace (in `priceOrder`):
```ts
        school_name: dancer.school_name,
        tcrg_name: dancer.tcrg_name,
```
with:
```ts
        school_name: dancer.school_name,
        // Optional on Dancer; without them, a household dancer with no school link
        school_id: dancer.school_id ?? null,
        relationship: dancer.relationship ?? 'household',
        tcrg_name: dancer.tcrg_name,
```

(d) In `tests/engine/checkout-config.test.ts` (Task 5), whose typed `PurchaseSnapshot` now needs both fields, replace:
```ts
    dancers: [{ id: 'd1', first_name: 'Aoife', last_name: 'Walsh', school_name: null, tcrg_name: null,
      date_of_birth: '2018-05-01', gender: 'female', championship_status: 'none', dance_levels: {}, competition_age: 8 }],
```
with:
```ts
    dancers: [{ id: 'd1', first_name: 'Aoife', last_name: 'Walsh', school_name: null,
      school_id: null, relationship: 'household', tcrg_name: null, date_of_birth: '2018-05-01',
      gender: 'female', championship_status: 'none', dance_levels: {}, competition_age: 8 }],
```

The household check is unchanged: a guest is a row under the account holder's household, so `validateOrderRequest` and `create_order` already accept them. Submit (Step 8) and the register page read dancers with `*`, so both columns reach the snapshot. Task 13's test purchase is cast `as unknown as PurchaseSnapshot`, so it compiles without them.

Run: `npx vitest run tests/engine/ && npx tsc --noEmit`
Expected: PASS, and no type errors.

```bash
git add src/lib/engine/order-validation.ts src/lib/engine/purchase-snapshot.ts tests/engine/order-validation.test.ts tests/engine/purchase-snapshot.test.ts tests/engine/checkout-config.test.ts
git commit -m "feat: the purchase snapshot freezes whether each dancer is a guest, and their school link"
```

- [ ] **Step 4: Write the failing paging tests**

Create `tests/fetch-all-rows.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fetchAllRows, type RowPage } from '@/lib/fetch-all-rows'

type Row = { id: number }

/** A table of `total` rows behind a server that sends at most `maxRows` per request */
function table(total: number, maxRows: number) {
  const rows: Row[] = Array.from({ length: total }, (_, id) => ({ id }))
  const asked: [number, number][] = []
  async function fetchPage(from: number, to: number): Promise<RowPage<Row>> {
    asked.push([from, to])
    return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null, count: total }
  }
  return { rows, asked, fetchPage }
}

describe('fetchAllRows', () => {
  it('reads past the 1000-row limit a page at a time', async () => {
    const t = table(2500, 1000)
    expect(await fetchAllRows(t.fetchPage)).toEqual(t.rows)
    expect(t.asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ])
  })

  it('asks once when every row fits in the first page', async () => {
    const t = table(40, 1000)
    expect(await fetchAllRows(t.fetchPage)).toEqual(t.rows)
    expect(t.asked).toEqual([[0, 999]])
  })

  it('keeps going when the server sends fewer rows than asked for', async () => {
    const t = table(1200, 500)
    expect(await fetchAllRows(t.fetchPage)).toEqual(t.rows)
    expect(t.asked).toEqual([
      [0, 999],
      [500, 1499],
      [1000, 1999]
    ])
  })

  it('returns no rows for an empty result', async () => {
    expect(await fetchAllRows(table(0, 1000).fetchPage)).toEqual([])
  })

  it('stops when rows disappear while it reads', async () => {
    const t = table(1000, 1000)
    // The count says 1500, but only 1000 rows are left when the second page is read
    const shrinking = async (from: number, to: number) => ({
      ...(await t.fetchPage(from, to)),
      count: 1500
    })
    expect(await fetchAllRows(shrinking)).toHaveLength(1000)
    expect(t.asked).toHaveLength(2)
  })

  it("throws the query's error", async () => {
    const failing = async () => ({
      data: null,
      error: { message: 'permission denied' },
      count: null
    })
    await expect(fetchAllRows(failing)).rejects.toThrow('permission denied')
  })

  it('refuses a query that was not asked for its row count', async () => {
    const uncounted = async () => ({ data: [], error: null, count: null })
    await expect(fetchAllRows(uncounted)).rejects.toThrow(/count: 'exact'/)
  })
})
```

Run: `npx vitest run tests/fetch-all-rows.test.ts`
Expected: FAIL, because `@/lib/fetch-all-rows` doesn't exist yet.

- [ ] **Step 5: Write the paging helper**

Create `src/lib/fetch-all-rows.ts`:
```ts
/** One page of a query, as supabase-js returns it when the query asks for `{ count: 'exact' }` */
export interface RowPage<Row> {
  data: Row[] | null
  error: { message: string } | null
  count: number | null
}

/** Rows asked for per request: Supabase's default `max-rows` */
export const ROWS_PER_PAGE = 1000

/**
 * Every row of a query, read a page at a time. PostgREST sends at most `max-rows` rows per
 * request (1000 on Supabase), whatever range is asked for, so a single select can silently stop
 * short. `fetchPage(from, to)` runs the query with `{ count: 'exact' }`, a stable order and
 * `.range(from, to)`; the query itself stays in the page or action that calls this.
 */
export async function fetchAllRows<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<RowPage<Row>>,
  pageSize = ROWS_PER_PAGE
): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const { data, error, count } = await fetchPage(rows.length, rows.length + pageSize - 1)
    if (error) throw new Error(error.message)
    if (count === null) {
      throw new Error("fetchAllRows needs the query's row count ({ count: 'exact' })")
    }
    const page = data ?? []
    rows.push(...page)
    // A page can come back shorter than asked when the server's limit is lower, so keep going
    // until every counted row is in. An empty page means rows were removed while reading.
    if (rows.length >= count || page.length === 0) return rows
  }
}
```

Run: `npx vitest run tests/fetch-all-rows.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Pin the engine functions the entry page will share**

In `tests/engine/order-validation.test.ts`:

(a) Replace:
```ts
import {
  ageCutoffDateFor,
  validateOrderRequest,
```
with:
```ts
import {
  ageCutoffDateFor,
  toDancerProfile,
  validateOrderRequest,
```

(b) Append to `tests/engine/order-validation.test.ts`:
```ts
// The entry page builds each dancer's eligibility profile with this too, so the two can't drift
describe('toDancerProfile', () => {
  it('reads the date of birth as a local date and maps each dance to its level', () => {
    const profile = toDancerProfile(
      dancer({
        championship_status: 'prelim',
        dance_levels: [
          { dance_key: 'reel', level_key: 'NOV' },
          { dance_key: 'treble_jig', level_key: 'PW' }
        ]
      })
    )
    expect(profile).toEqual({
      dob: new Date(2018, 4, 1),
      gender: 'female',
      championshipStatus: 'prelim',
      danceLevels: { reel: 'NOV', treble_jig: 'PW' }
    })
  })
})
```

In `tests/engine/purchase-snapshot.test.ts`:

(c) Replace:
```ts
import {
  buildCreateOrderPayload,
  CONSENT_VERSION,
```
with:
```ts
import {
  buildCreateOrderPayload,
  CONSENT_VERSION,
  feeEntriesFor,
```

(d) Append to `tests/engine/purchase-snapshot.test.ts`:
```ts
// The entry page prices its cart with this too, so the total it shows is the one Submit charges
describe('feeEntriesFor', () => {
  it("copies each competition's category, own fee and family-max flag, in entry order", () => {
    const champ: FeisCompetition = {
      ...comp('c3', 'PC1', 'reel'),
      competition_type: 'championship',
      fee_category: 'prelim_champ'
    }
    const special: FeisCompetition = {
      ...comp('c4', 'SP1', 'reel'),
      competition_type: 'special',
      fee_cents: 2000,
      exclude_from_family_cap: true
    }
    const competitions = new Map([champ, special].map((c) => [c.id, c]))
    const entries = [
      { dancerId: 'd2', competitionId: 'c4' },
      { dancerId: 'd1', competitionId: 'c3' }
    ]
    expect(feeEntriesFor(entries, competitions)).toEqual([
      {
        dancer_id: 'd2',
        fee_category: 'solo',
        fee_cents_override: 2000,
        exclude_from_family_cap: true,
        is_day_of: false
      },
      {
        dancer_id: 'd1',
        fee_category: 'prelim_champ',
        fee_cents_override: null,
        exclude_from_family_cap: false,
        is_day_of: false
      }
    ])
  })
})
```

Run: `npx vitest run tests/engine/order-validation.test.ts tests/engine/purchase-snapshot.test.ts`
Expected: PASS. Both functions already exist (Task 4). These tests pin them now that the entry page depends on them as well as Submit.

- [ ] **Step 7: Add the new order fields to the shared type**

In `src/lib/types/feis-listing.ts`:

(a) Replace:
```ts
// Listing status
export type ListingStatus = 'draft' | 'open' | 'closed' | 'launched'
```
with:
```ts
import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

// Listing status
export type ListingStatus = 'draft' | 'open' | 'closed' | 'launched'
```

(b) Replace (in `interface Registration`):
```ts
  hold_expires_at: string | null
  created_at: string
```
with:
```ts
  hold_expires_at: string | null
  /** What the order was checked and priced on, frozen at Submit; null on orders from before that */
  purchase_snapshot: PurchaseSnapshot | null
  checkout_claim_id: string | null
  checkout_expires_at: string | null
  paid_at: string | null
  created_at: string
```

The type-only import cycle with `purchase-snapshot.ts` is fine; both sides import types only.

- [ ] **Step 8: Rewrite Submit and the resume lookup**

In `src/app/feiseanna/[id]/register/actions.ts`, replace everything above `export async function createCheckoutSession` with the code below. That is the imports, `getExistingRegistration`, `cancelRegistration`, `CreateDraftInput` and `createDraftRegistration`. The code below includes `cancelRegistration` unchanged, moved below Submit, so Task 12 can replace it and `createCheckoutSession` in one piece. Leave `createCheckoutSession` exactly as it is. Until Task 12, those two still write `registrations` directly, which 012 refuses. Nothing deploys before Task 16, and Task 12 replaces them well before that.
```ts
'use server'

import { headers } from 'next/headers'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { canTransitionRegistration } from '@/lib/registration-states'
import { clientIpFrom } from '@/lib/engine/consent'
import {
  validateOrderRequest,
  type OrderDancer,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import {
  buildCreateOrderPayload,
  priceOrder,
  type CreateOrderPayload
} from '@/lib/engine/purchase-snapshot'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isHouseholdComplete, REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import { createOrderStore, type CreateOrderResult } from '@/app/_payments/order-store'
import { supabaseRpc } from '@/app/_payments/rpc'
import type {
  FeeBreakdown,
  FeeSchedule,
  FeisCompetition,
  FeisListing,
  Household,
  Registration,
  RegistrationEntry,
  RegistrationStatus
} from '@/lib/types/feis-listing'

type RefusalReason = Extract<CreateOrderResult, { status: 'refused' }>['reason']

/** What a family is told when create_order refuses after the checks here have passed */
const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  listing_closed: 'Registration for this feis is not open.',
  outside_window: 'Registration for this feis has closed.',
  active_order_exists: 'You already have entries for this feis. Reload this page to see them.'
}

type HouseholdContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>
      household: Pick<Household, 'id' | (typeof REQUIRED_HOUSEHOLD_FIELDS)[number]>
    }

/**
 * The signed-in parent's household, read with their own client: this is what proves an order
 * is theirs (spec §4, §6, §7).
 */
async function currentHousehold(): Promise<HouseholdContext> {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) return { error: 'Please sign in again to continue.' }

  const { data: household, error } = await supabase
    .from('households')
    .select('id, first_name, last_name, phone, address_line1, city, state_region, postal_code')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return { error: 'Your family details could not be loaded. Please try again.' }
  if (!household) return { error: 'Please finish setting up your family account first.' }
  return { supabase, household }
}

/**
 * The family's unpaid order for this feis while it still holds its places. Read-only: a hold
 * that has passed already counts as expired here, and the expiry job makes the change (spec §13).
 */
export async function getExistingRegistration(feisListingId: string): Promise<
  | { error: string }
  | {
      registration: (Registration & { registration_entries: RegistrationEntry[] }) | null
      expired?: true
    }
> {
  const ctx = await currentHousehold()
  if ('error' in ctx) return { error: ctx.error }

  const { data: registration, error } = await ctx.supabase
    .from('registrations')
    .select(`${REGISTRATION_COLUMNS}, registration_entries(*)`)
    .eq('feis_listing_id', feisListingId)
    .eq('household_id', ctx.household.id)
    .in('status', ['draft', 'pending_payment'])
    .maybeSingle()
  if (error) return { error: 'Your entries could not be loaded. Please try again.' }
  if (!registration) return { registration: null }

  if (registration.hold_expires_at && new Date(registration.hold_expires_at) <= new Date()) {
    return { registration: null, expired: true }
  }
  return {
    registration: registration as Registration & { registration_entries: RegistrationEntry[] }
  }
}

/** What Submit checks and prices an order against, read fresh with the service role */
async function loadOrderInputs(service: ServiceClient, feisListingId: string, householdId: string) {
  const [listing, feeSchedule, dancers, competitions] = await Promise.all([
    service.from('feis_listings').select('*').eq('id', feisListingId).maybeSingle(),
    service.from('fee_schedules').select('*').eq('feis_listing_id', feisListingId).maybeSingle(),
    service
      .from('dancers')
      .select('*, dance_levels:dancer_dance_levels(dance_key, level_key)')
      .eq('household_id', householdId),
    // Every competition of this feis, enabled or not, since eligibility is judged against the
    // whole list. Read in pages: PostgREST returns at most 1000 rows per request.
    fetchAllRows<FeisCompetition>((from, to) =>
      service
        .from('feis_competitions')
        .select('*', { count: 'exact' })
        .eq('feis_listing_id', feisListingId)
        .order('id', { ascending: true })
        .range(from, to)
    )
  ])
  const failed = listing.error ?? feeSchedule.error ?? dancers.error
  if (failed) throw new Error(failed.message)
  return {
    listing: listing.data as FeisListing | null,
    feeSchedule: feeSchedule.data as FeeSchedule | null,
    dancers: (dancers.data ?? []) as OrderDancer[],
    competitions
  }
}

interface CreateDraftInput {
  feisListingId: string
  entries: RequestedEntry[]
  /** The family ticked the agreement. The server records when, and from which address. */
  consentAccepted: boolean
}

/** Submit (spec §4): check, price and create the order on the server, in one database step */
export async function createDraftRegistration(
  input: CreateDraftInput
): Promise<
  | { error: string }
  | { registrationId: string; totalCents: number; holdExpiresAt: string; breakdown: FeeBreakdown }
> {
  if (input.consentAccepted !== true) return { error: 'Please accept the terms to continue.' }

  const ctx = await currentHousehold()
  if ('error' in ctx) return { error: ctx.error }
  if (!isHouseholdComplete(ctx.household)) {
    return { error: 'Please add your family details (name, phone and address) before registering.' }
  }

  const service = createServiceClient()
  const loaded = await loadOrderInputs(service, input.feisListingId, ctx.household.id).catch(
    (err: unknown) => {
      console.error('Submit could not load the feis:', err)
      return null
    }
  )
  if (!loaded) return { error: 'The feis details could not be loaded. Please try again.' }
  const { listing, feeSchedule, dancers, competitions } = loaded
  if (!listing) return { error: 'This feis could not be found.' }
  if (!feeSchedule) return { error: "This feis hasn't set its fees yet, so entries can't be paid." }

  const now = new Date()
  const levels = listing.syllabus_snapshot?.levels ?? []
  const validation = validateOrderRequest({
    now,
    householdId: ctx.household.id,
    listing: { ...listing, levels },
    dancers,
    competitions,
    entries: input.entries
  })
  if (!validation.ok) return { error: validation.error }

  let payload: CreateOrderPayload
  let breakdown: FeeBreakdown
  try {
    const priced = priceOrder({
      now,
      ageCutoffDate: validation.ageCutoffDate,
      levels,
      feisTermsUrl: listing.terms_url,
      dancers,
      competitions,
      entries: input.entries,
      feeSchedule
    })
    payload = buildCreateOrderPayload(priced, {
      // parseFloat keeps a fractional percent. Missing, it parses as NaN, which the engine refuses
      // like any value outside 0 to 100, so Submit stops instead of pricing wrongly (spec §4)
      applicationFeePercent: Number.parseFloat(process.env.STRIPE_APPLICATION_FEE_PERCENT ?? ''),
      consentIp: clientIpFrom(await headers())
    })
    breakdown = priced.breakdown
  } catch (err) {
    console.error('Submit could not price the order:', err)
    return { error: 'Your entries could not be priced. Please try again later.' }
  }

  try {
    const result = await createOrderStore(supabaseRpc(service)).createOrder(
      ctx.household.id,
      input.feisListingId,
      payload
    )
    if (result.status === 'refused') return { error: REFUSAL_MESSAGES[result.reason] }
    return {
      registrationId: result.registration_id,
      totalCents: payload.total_cents,
      holdExpiresAt: result.hold_expires_at,
      breakdown
    }
  } catch (err) {
    console.error('create_order failed:', err)
    return { error: 'Your entries could not be saved. Please try again.' }
  }
}

export async function cancelRegistration(registrationId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!household) return { error: 'Household not found' }

  const { data: reg, error: fetchError } = await supabase
    .from('registrations')
    .select('status')
    .eq('id', registrationId)
    .eq('household_id', household.id)
    .single()

  if (fetchError || !reg) return { error: 'Registration not found' }

  const currentStatus = reg.status as RegistrationStatus
  if (!canTransitionRegistration(currentStatus, 'cancelled')) {
    return { error: `Cannot cancel registration in ${currentStatus} state` }
  }

  const { error } = await supabase
    .from('registrations')
    .update({ status: 'cancelled' })
    .eq('id', registrationId)

  if (error) {
    console.error('Failed to cancel registration:', error)
    return { error: 'Failed to cancel registration' }
  }

  return { success: true as const }
}
```
Keep one blank line between the end of `cancelRegistration` and `export async function createCheckoutSession`.

What changed, and why:
- `getExistingRegistration` no longer writes. A passed hold counts as expired here; the expiry job makes the change (spec §13).
- The household is read with the parent's own client, which proves the order is theirs. The listing, fees, dancers and every competition of the feis are read with the service role, scoped by `feis_listing_id` and `household_id`. The competitions are ordered by `id`, so the pages are stable.
- `STRIPE_APPLICATION_FEE_PERCENT` is read with `parseFloat`, so a fractional percent such as `2.9` is kept. There is no fallback any more: a missing value parses as `NaN`, and `buildCreateOrderPayload` throws on anything that isn't a number from 0 up to 100. Submit then refuses with a message instead of creating an order (spec §4). Task 16 confirms the live value is set.
- `currentHousehold()` has an explicit return type. Without it, TypeScript adds `error?: undefined` to the success shape, and `'error' in ctx` no longer narrows.
- The refusal messages are keyed by `CreateOrderResult`'s reasons, so a reason added to `create_order` won't compile until it has a message. `create_order` counts a paid order as active too, so its message covers both cases.

- [ ] **Step 9: Read every competition on the register page**

In `src/app/feiseanna/[id]/register/page.tsx`:

(a) Replace:
```tsx
import { isHouseholdComplete } from '@/lib/household'
```
with:
```tsx
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isHouseholdComplete } from '@/lib/household'
```

(b) Replace:
```tsx
        const [listingResult, feesResult, compsResult, dancersResult, heldResult, paidResult] =
```
with:
```tsx
        const [listingResult, feesResult, competitions, dancersResult, heldResult, paidResult] =
```

(c) Replace:
```tsx
            supabase
              .from('feis_competitions')
              .select('*')
              .eq('feis_listing_id', feisId)
              .eq('enabled', true)
              .order('sort_order', { ascending: true }),
```
with:
```tsx
            // Every enabled competition, read in pages: PostgREST returns at most 1000 rows per
            // request, and Submit judges eligibility against the feis's whole list
            fetchAllRows<FeisCompetition>((from, to) =>
              supabase
                .from('feis_competitions')
                .select('*', { count: 'exact' })
                .eq('feis_listing_id', feisId)
                .eq('enabled', true)
                .order('sort_order', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to)
            ),
```

(d) Replace:
```tsx
        for (const result of [compsResult, dancersResult, paidResult]) {
```
with:
```tsx
        for (const result of [dancersResult, paidResult]) {
```

(e) Replace:
```tsx
            competitions: (compsResult.data ?? []) as FeisCompetition[],
```
with:
```tsx
            competitions,
```

`fetchAllRows` throws on a query error, and the page's existing `catch` turns that into its "could not load" message. Loading only the enabled competitions here is fine: `getEligibleCompetitions` judges only enabled ones, so the page and Submit, which passes the full list, reach the same answer.

- [ ] **Step 10: The entry page uses the engine's rules and sends only the agreement**

In `src/components/registration/entry-page.tsx`:

(a) Replace:
```tsx
import { calculateAgeOnDate, getEligibleCompetitions } from '@/lib/engine/eligibility'
```
with:
```tsx
import { calculateAgeOnDate, getEligibleCompetitions } from '@/lib/engine/eligibility'
import {
  ageCutoffDateFor,
  toDancerProfile,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import { feeEntriesFor } from '@/lib/engine/purchase-snapshot'
```

(b) Replace:
```tsx
import type {
  Dancer,
  DancerDanceLevel,
  DancerProfile,
  EligibleCompetition,
  FeeEntry,
  FeeSchedule,
```
with:
```tsx
import type {
  Dancer,
  DancerDanceLevel,
  EligibleCompetition,
  FeeBreakdown,
  FeeSchedule,
```

(c) Delete the page's own copies of the engine rules. Replace:
```tsx
function profileOf(dancer: DancerWithLevels): DancerProfile {
  const danceLevels: Record<string, string> = {}
  for (const dl of dancer.dance_levels) danceLevels[dl.dance_key] = dl.level_key
  return {
    dob: parseLocalDate(dancer.date_of_birth),
    gender: dancer.gender,
    championshipStatus: dancer.championship_status,
    danceLevels
  }
}

/** Feis age is the dancer's age on January 1 of the feis year. */
function ageCutoffOf(listing: FeisListing): Date {
  if (listing.age_cutoff_date) return parseLocalDate(listing.age_cutoff_date)
  const year = listing.feis_date
    ? parseLocalDate(listing.feis_date).getFullYear()
    : new Date().getFullYear()
  return new Date(year, 0, 1)
}

export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
```
with:
```tsx
export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
```

(d) Replace:
```tsx
  const ageCutoffDate = ageCutoffOf(listing)
```
with:
```tsx
  // The cutoff Submit uses: the organiser's date, otherwise January 1 of the feis year
  const ageCutoffDate = useMemo(() => ageCutoffDateFor(listing, new Date()), [listing])
```

(e) Replace:
```tsx
  const [paymentStarted, setPaymentStarted] = useState(
    data.heldRegistration?.status === 'pending_payment'
  )
```
with:
```tsx
  const [paymentStarted, setPaymentStarted] = useState(
    data.heldRegistration?.status === 'pending_payment'
  )
  // The price the server froze for the order in progress; the cart's own sum is an estimate
  const [orderBreakdown, setOrderBreakdown] = useState<FeeBreakdown | null>(
    data.heldRegistration?.purchase_snapshot?.pricing.breakdown ?? null
  )
```

(f) Replace:
```tsx
  const eligibleByDancer = useMemo(() => {
    const map: Record<string, EligibleCompetition[]> = {}
    const cutoff = ageCutoffOf(listing)
    const syllabusLevels = listing.syllabus_snapshot?.levels ?? []
    for (const dancer of dancers) {
      map[dancer.id] = getEligibleCompetitions(
        profileOf(dancer),
        competitions,
        cutoff,
        syllabusLevels
      )
    }
    return map
  }, [dancers, competitions, listing])
```
with:
```tsx
  const eligibleByDancer = useMemo(() => {
    const map: Record<string, EligibleCompetition[]> = {}
    const syllabusLevels = listing.syllabus_snapshot?.levels ?? []
    for (const dancer of dancers) {
      map[dancer.id] = getEligibleCompetitions(
        toDancerProfile(dancer),
        competitions,
        ageCutoffDate,
        syllabusLevels
      )
    }
    return map
  }, [dancers, competitions, listing, ageCutoffDate])
```

(g) Replace:
```tsx
  const feeEntries: FeeEntry[] = useMemo(() => {
    const entries: FeeEntry[] = []
    for (const dancer of dancers) {
      for (const compId of cart[dancer.id] ?? []) {
        const comp = competitionById.get(compId)
        if (!comp) continue
        entries.push({
          dancer_id: dancer.id,
          fee_category: comp.fee_category,
          fee_cents_override: comp.fee_cents,
          exclude_from_family_cap: comp.exclude_from_family_cap,
          is_day_of: false
        })
      }
    }
    return entries
  }, [cart, dancers, competitionById])

  const breakdown = useMemo(
    () => (feeSchedule && feeEntries.length > 0 ? calculateFees(feeSchedule, feeEntries) : null),
    [feeSchedule, feeEntries]
  )
```
with:
```tsx
  // What Pay submits: each dancer's chosen dances that this feis still offers
  const requestedEntries: RequestedEntry[] = useMemo(
    () =>
      dancers.flatMap((dancer) =>
        (cart[dancer.id] ?? [])
          .filter((competitionId) => competitionById.has(competitionId))
          .map((competitionId) => ({ dancerId: dancer.id, competitionId }))
      ),
    [cart, dancers, competitionById]
  )

  // Priced the way Submit prices it; once Submit has run, its frozen price is shown instead
  const cartBreakdown = useMemo(
    () =>
      feeSchedule && requestedEntries.length > 0
        ? calculateFees(feeSchedule, feeEntriesFor(requestedEntries, competitionById))
        : null,
    [feeSchedule, requestedEntries, competitionById]
  )
  const breakdown = orderBreakdown ?? cartBreakdown
```

(h) Replace:
```tsx
  const dancesChosen = feeEntries.length
```
with:
```tsx
  const dancesChosen = requestedEntries.length
```

(i) Replace:
```tsx
  async function handlePay() {
    setError(null)
    setLoading(true)
    try {
      let regId: string | null = registrationId
      if (regId === null) {
        const result = await createDraftRegistration({
          feisListingId: feisId,
          entries: Object.entries(cart).flatMap(([dancerId, compIds]) =>
            compIds.map((competitionId) => ({ dancerId, competitionId }))
          ),
          consentAcceptedAt: new Date().toISOString(),
          consentIp: '0.0.0.0'
        })
        if ('error' in result) {
          setError(result.error ?? 'Your entries could not be saved. Try again.')
          return
        }
        regId = result.registrationId
        setRegistrationId(regId)
        setHoldExpiresAt(result.holdExpiresAt)
        setEditingId(null)
      }
      if (regId === null) return
```
with:
```tsx
  async function handlePay(consentAccepted: boolean) {
    setError(null)
    setLoading(true)
    try {
      let regId: string | null = registrationId
      if (regId === null) {
        // The browser says only that the family agreed; the server records when and from where
        const order = await createDraftRegistration({
          feisListingId: feisId,
          entries: requestedEntries,
          consentAccepted
        })
        if ('error' in order) {
          setError(order.error)
          return
        }
        regId = order.registrationId
        setRegistrationId(regId)
        setHoldExpiresAt(order.holdExpiresAt)
        setOrderBreakdown(order.breakdown)
        setEditingId(null)
      }
```

(j) In `handleChangeEntries`, replace:
```tsx
      setRegistrationId(null)
      setHoldExpiresAt(null)
      setPaymentStarted(false)
```
with:
```tsx
      setRegistrationId(null)
      setHoldExpiresAt(null)
      setPaymentStarted(false)
      setOrderBreakdown(null)
```

`<FamilyReceipt onPay={handlePay} … />` stays as it is: Step 11 changes the prop's type to match. The rest of `handlePay` (the old `createCheckoutSession` call, and `parentPaymentMessage`, which reads that call's errors) stays until Task 12. `requestedEntries` is both what the page prices and what Pay submits. So a competition the cart remembers but this feis no longer offers is left out of both. Before, it was left out of the price but still submitted.

- [ ] **Step 11: Pay reports the agreement box**

In `src/components/registration/family-receipt.tsx`:

(a) Replace:
```tsx
import Link from 'next/link'
import { formatCents } from '@/lib/format'
```
with:
```tsx
import Link from 'next/link'
import { CONSENT_VERSION } from '@/lib/engine/purchase-snapshot'
import { formatCents } from '@/lib/format'
```

(b) Replace:
```tsx
  onPay: () => void
```
with:
```tsx
  /** Pay, with whether the agreement is ticked; Submit records that agreement on a new order */
  onPay: (consentAccepted: boolean) => void
```

(c) Replace:
```tsx
        <label className="mt-3.5 mb-3 flex items-start gap-2 text-[12.5px] text-muted-foreground">
```
with:
```tsx
        <label
          // This wording is CONSENT_VERSION: change the two in the same commit
          data-consent-version={CONSENT_VERSION}
          className="mt-3.5 mb-3 flex items-start gap-2 text-[12.5px] text-muted-foreground"
        >
```

(d) Replace:
```tsx
          onClick={onPay}
```
with:
```tsx
          onClick={() => onPay(agreed)}
```

`CONSENT_VERSION`'s comment already says the checkbox wording here must change with it. The attribute makes the link visible where the wording lives, and in the page itself.

- [ ] **Step 12: Type-check, lint and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all three succeed. `npm run lint` reports no errors; the one warning, in `feis-wizard-step2.tsx`, was there before.

- [ ] **Step 13: Run all tests**

Run: `npm test && npm run test:db`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add src/lib/fetch-all-rows.ts tests/fetch-all-rows.test.ts tests/engine/order-validation.test.ts tests/engine/purchase-snapshot.test.ts src/lib/types/feis-listing.ts 'src/app/feiseanna/[id]/register/actions.ts' 'src/app/feiseanna/[id]/register/page.tsx' src/components/registration/entry-page.tsx src/components/registration/family-receipt.tsx
git commit -m "feat: submit checks, prices and creates orders on the server, by the entry page's own rules"
```

---

### Task 8: Migration 014, checkout claims (done)

**Files:**
- Create: `supabase/migrations/014_checkout_claims.sql`
- Modify: `src/app/_payments/order-store.ts` (add four methods)
- Test: `tests/db/checkout-claims.test.ts`

**Interfaces:**
- Consumes:
  - `CheckoutConfig`, `buildCheckoutConfig` and `CheckoutBlock` (Task 5)
  - `createDraftOrder`, `DraftOrderFixture` and `pgRpc` (Task 6)
- Produces SQL functions. Each one locks the order row and names the state and claim it expects:
  - `claim_checkout(p_registration_id uuid, p_household_id uuid, p_claim_id uuid, p_config jsonb) → jsonb`. It also makes the final organiser-stop decision. A successful claim is the boundary after which that attempt may finish.
  - `attach_checkout_session(p_registration_id uuid, p_claim_id uuid, p_session_id text) → jsonb`
  - `cancel_order(p_registration_id uuid, p_household_id uuid, p_expected_claim_id uuid) → jsonb`
  - `expire_checkout(p_registration_id uuid, p_claim_id uuid, p_session_id text, p_account text) → jsonb`
- Produces store methods:
  - `claimCheckout({ registrationId, householdId, claimId, config }): Promise<ClaimResult>`. `ClaimResult` includes `claimed_at` and `{ result: 'blocked'; reason: CheckoutBlock }`.
  - `attachCheckoutSession(registrationId, claimId, sessionId): Promise<AttachResult>`
  - `cancelOrder(registrationId, householdId, expectedClaimId | null): Promise<CancelOrderResult>`
  - `expireCheckout({ registrationId, claimId, sessionId, account }): Promise<ExpireCheckoutResult>`

- [ ] **Step 1: Add the store methods and their result types**

In `src/app/_payments/order-store.ts`, add `import type { CheckoutBlock } from '@/lib/engine/checkout-policy'`. Then add these types after `CheckoutOrder`:
```ts
export type ClaimResult =
  | {
      result: 'claimed' | 'already_claimed'
      status: RegistrationStatus
      claim_id: string
      config: CheckoutConfig
      claimed_at: string
      session_id: string | null
    }
  | { result: 'blocked'; reason: CheckoutBlock }
  | { result: 'not_claimable'; status: RegistrationStatus; hold_expired: boolean }
  | { result: 'not_found' }

export type AttachResult =
  | { result: 'attached' | 'already_attached' | 'claim_mismatch'; status: RegistrationStatus }
  | { result: 'not_attachable'; status: RegistrationStatus; session_id: string | null }
  | { result: 'not_found' }

export type CancelOrderResult =
  | { result: 'cancelled'; status: 'cancelled' }
  | { result: 'not_cancellable'; status: RegistrationStatus; claim_id: string | null }
  | { result: 'not_found' }

export type ExpireCheckoutResult =
  | { result: 'expired'; status: 'expired' }
  | { result: 'ignored'; why: 'not_found' | 'mismatch' | 'not_open'; status?: RegistrationStatus }
```
Add these methods to the object `createOrderStore` returns:
```ts
    async claimCheckout(input: {
      registrationId: string
      householdId: string
      claimId: string
      config: CheckoutConfig
    }): Promise<ClaimResult> {
      return (await rpc('claim_checkout', {
        p_registration_id: input.registrationId,
        p_household_id: input.householdId,
        p_claim_id: input.claimId,
        p_config: input.config
      })) as ClaimResult
    },

    async attachCheckoutSession(registrationId: string, claimId: string, sessionId: string): Promise<AttachResult> {
      return (await rpc('attach_checkout_session', {
        p_registration_id: registrationId,
        p_claim_id: claimId,
        p_session_id: sessionId
      })) as AttachResult
    },

    async cancelOrder(
      registrationId: string,
      householdId: string,
      expectedClaimId: string | null
    ): Promise<CancelOrderResult> {
      return (await rpc('cancel_order', {
        p_registration_id: registrationId,
        p_household_id: householdId,
        p_expected_claim_id: expectedClaimId
      })) as CancelOrderResult
    },

    async expireCheckout(input: {
      registrationId: string
      claimId: string | null
      sessionId: string
      account: string
    }): Promise<ExpireCheckoutResult> {
      return (await rpc('expire_checkout', {
        p_registration_id: input.registrationId,
        p_claim_id: input.claimId,
        p_session_id: input.sessionId,
        p_account: input.account
      })) as ExpireCheckoutResult
    },
```

- [ ] **Step 2: Write the failing tests**

Create `tests/db/checkout-claims.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore } from '@/app/_payments/order-store'
import { buildCheckoutConfig } from '@/lib/engine/checkout-config'
import { asParent, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createDraftOrder, type DraftOrderFixture } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: ReturnType<typeof createOrderStore>

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

function configFor(order: DraftOrderFixture, claimId: string) {
  return buildCheckoutConfig({
    registrationId: order.registrationId,
    feisListingId: order.listing.listing.id,
    claimId,
    account: 'acct_test_feis',
    totalCents: order.payload.total_cents,
    applicationFeeCents: order.payload.application_fee_cents,
    eventFeeCents: order.payload.event_fee_cents,
    snapshot: order.payload.purchase_snapshot,
    baseUrl: 'https://runfeis.test',
    now: new Date(),
  })
}

function claim(order: DraftOrderFixture, claimId = randomUUID()) {
  return store.claimCheckout({
    registrationId: order.registrationId,
    householdId: order.family.householdId,
    claimId,
    config: configFor(order, claimId),
  })
}

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

async function runExpiryJob() {
  const { rows } = await db.pool.query(`SELECT command FROM cron.job WHERE jobname = 'expire-registration-holds'`)
  await db.pool.query(rows[0].command)
}

describe('claim_checkout', () => {
  it('freezes the request, records when it was claimed, and moves the hold 15 minutes past the window', async () => {
    const order = await createDraftOrder(db.pool)
    const claimId = randomUUID()
    const config = configFor(order, claimId)
    const result = await store.claimCheckout({
      registrationId: order.registrationId, householdId: order.family.householdId, claimId, config,
    })
    expect(result).toMatchObject({ result: 'claimed', status: 'draft', claim_id: claimId, session_id: null })

    const row = await orderRow(order.registrationId)
    expect(row.checkout_claim_id).toBe(claimId)
    expect(row.checkout_config).toEqual(config)
    expect(Math.abs(new Date(row.checkout_claimed_at).getTime() - Date.now())).toBeLessThan(60_000)
    const window = new Date(row.checkout_expires_at).getTime()
    expect(new Date(row.hold_expires_at).getTime() - window).toBe(15 * 60_000)
  })

  it('adopts an existing claim instead of replacing it', async () => {
    const order = await createDraftOrder(db.pool)
    const first = await claim(order)
    const second = await claim(order)
    expect(second.result).toBe('already_claimed')
    if (first.result === 'claimed' && second.result === 'already_claimed') {
      expect(second.claim_id).toBe(first.claim_id)
      expect(second.config).toEqual(first.config)
      expect(second.claimed_at).toBe(first.claimed_at)
    }
  })

  it('gives two simultaneous claims the same claim', async () => {
    const order = await createDraftOrder(db.pool)
    const results = await Promise.all([claim(order), claim(order)])
    expect(results.map((r) => r.result).sort()).toEqual(['already_claimed', 'claimed'])
    const ids = results.map((r) => ('claim_id' in r ? r.claim_id : null))
    expect(ids[0]).toBe(ids[1])
  })

  it('refuses a request that does not describe the order', async () => {
    const order = await createDraftOrder(db.pool)
    const claimId = randomUUID()
    for (const config of [
      { ...configFor(order, claimId), total_cents: 1 },
      { ...configFor(order, claimId), account: 'acct_someone_else' },
    ]) {
      const message = await refused(store.claimCheckout({
        registrationId: order.registrationId, householdId: order.family.householdId, claimId, config,
      }))
      expect(message).toMatch(/does not match order/)
    }
    expect((await orderRow(order.registrationId)).checkout_claim_id).toBeNull()
  })

  it('refuses a request with no expiry, or a claim with no id, and leaves the order as it was', async () => {
    const order = await createDraftOrder(db.pool)
    const before = await orderRow(order.registrationId)
    const claimId = randomUUID()
    // Straight to the function: the store's types never allow either
    const rpc = pgRpc(db.pool)
    for (const args of [
      { p_claim_id: claimId, p_config: { ...configFor(order, claimId), expires_at: null } },
      { p_claim_id: null, p_config: configFor(order, claimId) },
    ]) {
      const message = await refused(rpc('claim_checkout', {
        p_registration_id: order.registrationId, p_household_id: order.family.householdId, ...args,
      }))
      expect(message).toMatch(/does not match order/)
    }
    expect(await orderRow(order.registrationId)).toEqual(before)
  })

  it('will not claim once the hold has passed', async () => {
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.registrationId])
    expect(await claim(order)).toEqual({ result: 'not_claimable', status: 'draft', hold_expired: true })
  })

  it('lets the organiser stop new checkouts right up to the claim', async () => {
    const closed = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [closed.listing.listing.id])
    expect(await claim(closed)).toEqual({ result: 'blocked', reason: 'organiser_stopped' })
    expect((await orderRow(closed.registrationId)).checkout_claim_id).toBeNull()

    const disabled = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_competitions SET enabled = false WHERE id = $1`, [disabled.entries[0].competitionId])
    expect(await claim(disabled)).toEqual({ result: 'blocked', reason: 'competition_unavailable' })
  })

  it('lets an attempt claimed before the organiser closed registration finish', async () => {
    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [order.listing.listing.id])
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_after_close'))
      .toEqual({ result: 'attached', status: 'pending_payment' })
  })
})

describe('attach_checkout_session', () => {
  it('needs the exact claim, accepts the same session twice and refuses another', async () => {
    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')

    expect(await store.attachCheckoutSession(order.registrationId, randomUUID(), 'cs_other'))
      .toEqual({ result: 'claim_mismatch', status: 'draft' })
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_1'))
      .toEqual({ result: 'attached', status: 'pending_payment' })
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_1'))
      .toEqual({ result: 'already_attached', status: 'pending_payment' })
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_2'))
      .toEqual({ result: 'not_attachable', status: 'pending_payment', session_id: 'cs_1' })
  })

  it('refuses to attach without a claim id or a session id, and leaves the order as it was', async () => {
    const unclaimed = await createDraftOrder(db.pool)
    const claimedOrder = await createDraftOrder(db.pool)
    const claimed = await claim(claimedOrder)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    const rpc = pgRpc(db.pool)
    const attempts: [DraftOrderFixture, Record<string, unknown>][] = [
      // An unclaimed draft and no claim id: nothing in the order to compare against
      [unclaimed, { p_claim_id: null, p_session_id: 'cs_no_claim' }],
      [claimedOrder, { p_claim_id: claimed.claim_id, p_session_id: null }],
    ]
    for (const [order, args] of attempts) {
      const before = await orderRow(order.registrationId)
      expect(await refused(rpc('attach_checkout_session', { p_registration_id: order.registrationId, ...args })))
        .toMatch(/needs the claim id and the session id/)
      expect(await orderRow(order.registrationId)).toEqual(before)
    }
  })
})

describe('cancel_order', () => {
  it('cancels an unclaimed draft without a claim, but needs the claim once there is one', async () => {
    const unclaimed = await createDraftOrder(db.pool)
    expect(await store.cancelOrder(unclaimed.registrationId, unclaimed.family.householdId, null))
      .toEqual({ result: 'cancelled', status: 'cancelled' })

    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    expect(await store.cancelOrder(order.registrationId, order.family.householdId, null))
      .toEqual({ result: 'not_cancellable', status: 'draft', claim_id: claimed.claim_id })
    expect(await store.cancelOrder(order.registrationId, order.family.householdId, randomUUID()))
      .toMatchObject({ result: 'not_cancellable' })
    expect(await store.cancelOrder(order.registrationId, order.family.householdId, claimed.claim_id))
      .toEqual({ result: 'cancelled', status: 'cancelled' })
  })

  it("will not cancel another family's order", async () => {
    const order = await createDraftOrder(db.pool)
    const other = await createDraftOrder(db.pool)
    expect(await store.cancelOrder(order.registrationId, other.family.householdId, null)).toEqual({ result: 'not_found' })
    expect((await orderRow(order.registrationId)).status).toBe('draft')
  })
})

describe('expire_checkout', () => {
  it("only expires the order's own open checkout", async () => {
    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_own')
    const base = { registrationId: order.registrationId, claimId: claimed.claim_id, sessionId: 'cs_own', account: 'acct_test_feis' }

    expect(await store.expireCheckout({ ...base, account: 'acct_other' })).toMatchObject({ result: 'ignored', why: 'mismatch' })
    expect(await store.expireCheckout({ ...base, sessionId: 'cs_old' })).toMatchObject({ result: 'ignored', why: 'mismatch' })
    expect(await store.expireCheckout({ ...base, claimId: null })).toMatchObject({ result: 'ignored', why: 'mismatch' })
    expect(await store.expireCheckout(base)).toEqual({ result: 'expired', status: 'expired' })
    expect(await store.expireCheckout(base)).toEqual({ result: 'ignored', why: 'not_open', status: 'expired' })
  })
})

describe('the expiry job', () => {
  it('leaves a claimed checkout alone until 15 minutes after its window', async () => {
    const order = await createDraftOrder(db.pool)
    await claim(order)
    await runExpiryJob()
    expect((await orderRow(order.registrationId)).status).toBe('draft')

    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [order.registrationId])
    await runExpiryJob()
    expect((await orderRow(order.registrationId)).status).toBe('expired')
  })
})

describe('who may call the checkout functions', () => {
  it('refuses parents', async () => {
    const order = await createDraftOrder(db.pool)
    for (const sql of [
      `SELECT claim_checkout('${order.registrationId}', '${order.family.householdId}', gen_random_uuid(), '{}')`,
      `SELECT attach_checkout_session('${order.registrationId}', gen_random_uuid(), 'cs_x')`,
      `SELECT cancel_order('${order.registrationId}', '${order.family.householdId}', NULL)`,
      `SELECT expire_checkout('${order.registrationId}', NULL, 'cs_x', 'acct_x')`,
    ]) {
      expect(await refused(asParent(db.pool, order.family.userId, (c) => c.query(sql)))).toMatch(/permission denied/)
    }
  })
})
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `npm run test:db -- tests/db/checkout-claims.test.ts`
Expected: FAIL with `function pre_registration.claim_checkout(...) does not exist`.

- [ ] **Step 4: Write migration 014**

Create `supabase/migrations/014_checkout_claims.sql`:
```sql
-- 014_checkout_claims.sql
-- Payment hardening, part 3: one checkout claim per order, with the whole Stripe request frozen,
-- and changes that only succeed for the exact claim they name. Spec §5, §6, §7, §13.

SET search_path TO pre_registration, public;

CREATE OR REPLACE FUNCTION claim_checkout(p_registration_id uuid, p_household_id uuid, p_claim_id uuid, p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
  v_listing feis_listings%ROWTYPE;
  v_expires timestamptz;
  v_line_total integer;
BEGIN
  SELECT * INTO v_order FROM registrations
  WHERE id = p_registration_id AND household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- One claim per order: a second request adopts the first, never replaces it
  IF v_order.checkout_claim_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_claimed', 'status', v_order.status,
      'claim_id', v_order.checkout_claim_id, 'config', v_order.checkout_config,
      'claimed_at', v_order.checkout_claimed_at, 'session_id', v_order.stripe_checkout_session_id);
  END IF;

  IF v_order.status <> 'draft' OR v_order.hold_expires_at IS NULL OR v_order.hold_expires_at <= now() THEN
    RETURN jsonb_build_object('result', 'not_claimable', 'status', v_order.status,
      'hold_expired', v_order.hold_expires_at IS NOT NULL AND v_order.hold_expires_at <= now());
  END IF;

  -- The organiser can stop new checkouts until this moment. A successful claim is the boundary:
  -- after it, this attempt may finish even if registration closes (spec §5).
  SELECT * INTO v_listing FROM feis_listings WHERE id = v_order.feis_listing_id FOR SHARE;
  IF v_listing.status <> 'open' THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'organiser_stopped');
  END IF;
  IF EXISTS (
    SELECT 1 FROM registration_entries e
    JOIN feis_competitions c ON c.id = e.feis_competition_id
    WHERE e.registration_id = p_registration_id AND NOT c.enabled
  ) THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'competition_unavailable');
  END IF;
  IF v_listing.stripe_account_id IS NULL THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'stripe_not_connected');
  END IF;
  IF v_order.total_cents < 50 THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'amount_too_small');
  END IF;

  -- The frozen request must describe this order exactly, on the feis's current Stripe account. A claim
  -- with no id or no expiry is refused here: 012 only takes a claim whose id, config, claim time and
  -- expiry all arrive together, and an unpaid order must keep a hold.
  v_expires := to_timestamp((p_config ->> 'expires_at')::bigint);
  SELECT coalesce(sum((item ->> 'amount_cents')::integer), -1)::integer INTO v_line_total
  FROM jsonb_array_elements(coalesce(p_config -> 'line_items', '[]'::jsonb)) AS item;
  IF p_claim_id IS NULL
     OR v_expires IS NULL
     OR p_config ->> 'account' IS DISTINCT FROM v_listing.stripe_account_id
     OR p_config ->> 'currency' IS DISTINCT FROM 'usd'
     OR (p_config ->> 'total_cents')::integer IS DISTINCT FROM v_order.total_cents
     OR v_line_total IS DISTINCT FROM v_order.total_cents
     OR (p_config ->> 'application_fee_cents')::integer IS DISTINCT FROM v_order.application_fee_cents
     OR p_config -> 'metadata' ->> 'registration_id' IS DISTINCT FROM p_registration_id::text
     OR p_config -> 'metadata' ->> 'claim_id' IS DISTINCT FROM p_claim_id::text
     OR p_config ->> 'idempotency_key' IS DISTINCT FROM ('checkout:' || p_registration_id::text || ':' || p_claim_id::text)
     OR v_expires < now() + interval '50 minutes'
     OR v_expires > now() + interval '70 minutes' THEN
    RAISE EXCEPTION 'checkout configuration does not match order %', p_registration_id;
  END IF;

  UPDATE registrations
  SET checkout_claim_id = p_claim_id,
      checkout_config = p_config,
      checkout_claimed_at = now(),
      checkout_expires_at = v_expires,
      hold_expires_at = v_expires + interval '15 minutes'
  WHERE id = p_registration_id;

  RETURN jsonb_build_object('result', 'claimed', 'status', 'draft', 'claim_id', p_claim_id,
    'config', p_config, 'claimed_at', now(), 'session_id', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION attach_checkout_session(p_registration_id uuid, p_claim_id uuid, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
BEGIN
  -- Pay always names its claim and the session that claim made. Refuse anything less here, rather than
  -- leave it to 012 (a session needs a claim, and an order awaiting payment needs both)
  IF p_claim_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'attach_checkout_session needs the claim id and the session id';
  END IF;

  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF v_order.checkout_claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN jsonb_build_object('result', 'claim_mismatch', 'status', v_order.status);
  END IF;
  IF v_order.stripe_checkout_session_id = p_session_id THEN
    RETURN jsonb_build_object('result', 'already_attached', 'status', v_order.status);
  END IF;
  IF v_order.status <> 'draft' OR v_order.stripe_checkout_session_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'not_attachable', 'status', v_order.status,
      'session_id', v_order.stripe_checkout_session_id);
  END IF;

  UPDATE registrations
  SET status = 'pending_payment', stripe_checkout_session_id = p_session_id
  WHERE id = p_registration_id;
  RETURN jsonb_build_object('result', 'attached', 'status', 'pending_payment');
END;
$$;

-- With no expected claim, only an unclaimed draft can be cancelled. With a claim, the caller has
-- already settled that claim's Stripe session (spec §6a): closed and verified, or established
-- never to have been made.
CREATE OR REPLACE FUNCTION cancel_order(p_registration_id uuid, p_household_id uuid, p_expected_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM registrations
  WHERE id = p_registration_id AND household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF v_order.status NOT IN ('draft', 'pending_payment')
     OR v_order.checkout_claim_id IS DISTINCT FROM p_expected_claim_id THEN
    RETURN jsonb_build_object('result', 'not_cancellable', 'status', v_order.status,
      'claim_id', v_order.checkout_claim_id);
  END IF;

  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  RETURN jsonb_build_object('result', 'cancelled', 'status', 'cancelled');
END;
$$;

-- Stripe's checkout.session.expired, or Pay finding the session expired: only the order's own
-- claim, account and session, and only while it is unpaid.
CREATE OR REPLACE FUNCTION expire_checkout(p_registration_id uuid, p_claim_id uuid, p_session_id text, p_account text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'ignored', 'why', 'not_found');
  END IF;
  IF p_claim_id IS NULL
     OR v_order.checkout_claim_id IS DISTINCT FROM p_claim_id
     OR v_order.checkout_config ->> 'account' IS DISTINCT FROM p_account
     OR (v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM p_session_id) THEN
    RETURN jsonb_build_object('result', 'ignored', 'why', 'mismatch', 'status', v_order.status);
  END IF;
  IF v_order.status NOT IN ('draft', 'pending_payment') THEN
    RETURN jsonb_build_object('result', 'ignored', 'why', 'not_open', 'status', v_order.status);
  END IF;

  UPDATE registrations SET status = 'expired' WHERE id = p_registration_id;
  RETURN jsonb_build_object('result', 'expired', 'status', 'expired');
END;
$$;

REVOKE ALL ON FUNCTION claim_checkout(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION attach_checkout_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION expire_checkout(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_checkout(uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION attach_checkout_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_order(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION expire_checkout(uuid, uuid, text, text) TO service_role;
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/014_checkout_claims.sql src/app/_payments/order-store.ts tests/db/checkout-claims.test.ts
git commit -m "feat: one frozen checkout claim per order, with the organiser's stop decided at the claim (migration 014)"
```

---

### Task 9: Migration 015, confirmation in one transaction, payment cases and the parent view (done)

**Files:**
- Create: `supabase/migrations/015_payment_confirmation.sql`
- Modify: `src/app/_payments/order-store.ts` (add `confirmOrderPayment` and `recordPaymentFailure`)
- Modify: `tests/db/helpers/fixtures.ts` (add `checkoutConfigFor` and `readyToPay`)
- Test: `tests/db/payment-confirmation.test.ts`

**Interfaces:**
- Consumes:
  - `lock_household_feis` (Task 6)
  - `_assign_numbers_for_registration` (migration 007)
  - the claim functions (Task 8)
  - `buildCheckoutConfig` (Task 5)
- Produces tables:
  - `payment_exceptions`
  - `notifications`, with every column §12 needs: `kind`, `dedupe_key`, `registration_id`, `exception_id`, `related_notification_id`, `recipient`, `payload`, `status`, `attempts`, `send_generation`, `last_outcome`, `first_attempt_at`, `next_attempt_at`, `claim_token`, `claimed_at`, `provider_message_id`, `last_error`, `sent_at` and `created_at`
- Produces SQL functions:
  - internal: `_random_code`, `new_confirmation_number(p_at timestamptz DEFAULT now())` (the year as it is in Eastern time at `p_at`), `new_support_ref`, `_record_payment_exception(...) → text` (the support reference) and `_fulfil_order(...) → text` (the confirmation number)
  - service role: `confirm_order_payment(p_registration_id uuid, p_claim_id uuid, p_session_id text, p_account text, p_amount_cents integer, p_currency text, p_payment_status text, p_payment_intent_id text, p_charge_id text, p_event_id text, p_source text) → jsonb`
  - service role: `record_payment_failure(p_registration_id uuid, p_claim_id uuid, p_session_id text, p_account text, p_event_id text) → jsonb`
  - authenticated: `get_my_payment_reviews(p_registration_id uuid DEFAULT NULL) → jsonb`, a restricted array
- Produces store methods and types:
  - `confirmOrderPayment(input: ConfirmPaymentInput): Promise<ConfirmResult>`
  - `recordPaymentFailure(input): Promise<PaymentFailureResult>`
  - types `PaymentExceptionReason` (which includes `claim_mismatch`), `ConfirmPaymentInput`, `ConfirmResult` and `PaymentFailureResult`
- Produces fixtures:
  - `checkoutConfigFor(order, claimId)`
  - `readyToPay(pool, order, { attach })`, which resolves to `{ claimId, config, sessionId }`

- [ ] **Step 1: Add the store methods and types**

In `src/app/_payments/order-store.ts`, add:
```ts
export type PaymentExceptionReason =
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'account_mismatch'
  | 'claim_mismatch'
  | 'session_mismatch'
  | 'payment_reused'
  | 'order_not_payable'
  | 'late_payment_conflict'
  | 'order_not_found'
  | 'payment_failed'
  | 'listing_account_changed'

export interface ConfirmPaymentInput {
  registrationId: string
  claimId: string | null
  sessionId: string
  account: string
  amountCents: number | null
  currency: string | null
  paymentStatus: string
  paymentIntentId: string | null
  chargeId: string | null
  eventId: string
  source: 'webhook' | 'sync'
}

export type ConfirmResult =
  | { result: 'confirmed' | 'already_confirmed'; confirmation_number: string | null }
  | { result: 'exception'; reason: PaymentExceptionReason; support_ref: string }
  | { result: 'not_paid' }

export type PaymentFailureResult = { result: 'recorded'; support_ref: string } | { result: 'ignored' }
```
Then add these to the object `createOrderStore` returns:
```ts
    async confirmOrderPayment(input: ConfirmPaymentInput): Promise<ConfirmResult> {
      return (await rpc('confirm_order_payment', {
        p_registration_id: input.registrationId,
        p_claim_id: input.claimId,
        p_session_id: input.sessionId,
        p_account: input.account,
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
        p_payment_status: input.paymentStatus,
        p_payment_intent_id: input.paymentIntentId,
        p_charge_id: input.chargeId,
        p_event_id: input.eventId,
        p_source: input.source
      })) as ConfirmResult
    },

    async recordPaymentFailure(input: {
      registrationId: string
      claimId: string | null
      sessionId: string
      account: string
      eventId: string
    }): Promise<PaymentFailureResult> {
      return (await rpc('record_payment_failure', {
        p_registration_id: input.registrationId,
        p_claim_id: input.claimId,
        p_session_id: input.sessionId,
        p_account: input.account,
        p_event_id: input.eventId
      })) as PaymentFailureResult
    },
```

- [ ] **Step 2: Add the checkout fixtures**

Append to `tests/db/helpers/fixtures.ts`, and move the new import to the top of the file:
```ts
import { buildCheckoutConfig, type CheckoutConfig } from '@/lib/engine/checkout-config'

export function checkoutConfigFor(order: DraftOrderFixture, claimId: string): CheckoutConfig {
  return buildCheckoutConfig({
    registrationId: order.registrationId,
    feisListingId: order.listing.listing.id,
    claimId,
    account: order.listing.listing.stripe_account_id ?? 'acct_test_feis',
    totalCents: order.payload.total_cents,
    applicationFeeCents: order.payload.application_fee_cents,
    eventFeeCents: order.payload.event_fee_cents,
    snapshot: order.payload.purchase_snapshot,
    baseUrl: 'https://runfeis.test',
    now: new Date(),
  })
}

/** Claims checkout for an order and, unless attach is false, attaches a session, as Pay would. */
export async function readyToPay(
  pool: Pool,
  order: DraftOrderFixture,
  opts: { attach?: boolean } = {}
): Promise<{ claimId: string; config: CheckoutConfig; sessionId: string }> {
  const store = createOrderStore(pgRpc(pool))
  const claimId = randomUUID()
  const config = checkoutConfigFor(order, claimId)
  const claim = await store.claimCheckout({
    registrationId: order.registrationId, householdId: order.family.householdId, claimId, config,
  })
  if (claim.result !== 'claimed') throw new Error(`expected a claim, got ${claim.result}`)
  const sessionId = `cs_${claimId.replace(/-/g, '').slice(0, 12)}`
  if (opts.attach !== false) await store.attachCheckoutSession(order.registrationId, claimId, sessionId)
  return { claimId, config, sessionId }
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/db/payment-confirmation.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore, type ConfirmPaymentInput, type OrderStore } from '@/app/_payments/order-store'
import { asParent, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { buildPayload, createDraftOrder, readyToPay, type DraftOrderFixture } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: OrderStore

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

type Ready = Awaited<ReturnType<typeof readyToPay>>

function payment(order: DraftOrderFixture, ready: Ready, overrides: Partial<ConfirmPaymentInput> = {}): ConfirmPaymentInput {
  return {
    registrationId: order.registrationId,
    claimId: ready.claimId,
    sessionId: ready.sessionId,
    account: ready.config.account,
    amountCents: order.payload.total_cents,
    currency: 'usd',
    paymentStatus: 'paid',
    paymentIntentId: `pi_${ready.sessionId}`,
    chargeId: 'ch_test',
    eventId: `evt_${randomUUID()}`,
    source: 'webhook',
    ...overrides,
  }
}

/** Resolves once another connection to this test database is waiting on a lock */
async function someoneIsWaiting(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
    if (rows[0].n > 0) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('No connection started waiting on a lock')
}

async function counts(registrationId: string) {
  const { rows } = await db.pool.query(
    `SELECT
       (SELECT count(*)::int FROM registration_snapshots WHERE registration_id = $1) AS snapshots,
       (SELECT count(*)::int FROM notifications WHERE registration_id = $1 AND kind = 'registration_confirmation') AS emails,
       (SELECT count(*)::int FROM competitor_numbers WHERE registration_id = $1) AS numbers,
       (SELECT count(*)::int FROM payment_exceptions WHERE registration_id = $1) AS cases`,
    [registrationId]
  )
  return rows[0]
}

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

describe('confirm_order_payment', () => {
  it('confirms a correct payment: paid, numbered, snapshotted and one email queued, together', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const result = await store.confirmOrderPayment(payment(order, ready))
    expect(result.result).toBe('confirmed')
    if (result.result === 'confirmed') expect(result.confirmation_number).toMatch(/^RF-\d{4}-[A-HJKMNP-Z2-9]{5}$/)

    const row = await orderRow(order.registrationId)
    expect(row).toMatchObject({ status: 'paid', stripe_payment_intent_id: `pi_${ready.sessionId}`, stripe_charge_id: 'ch_test', hold_expires_at: null })
    expect(await counts(order.registrationId)).toEqual({ snapshots: 1, emails: 1, numbers: 1, cases: 0 })

    const { rows: [snapshot] } = await db.pool.query('SELECT snapshot_data FROM registration_snapshots WHERE registration_id = $1', [order.registrationId])
    expect(snapshot.snapshot_data.purchase).toEqual(order.payload.purchase_snapshot)
    expect(snapshot.snapshot_data.payment).toMatchObject({ amount_cents: 4000, currency: 'usd', account: 'acct_test_feis' })

    const { rows: [email] } = await db.pool.query(`SELECT recipient FROM notifications WHERE registration_id = $1`, [order.registrationId])
    expect(email.recipient).toBe(order.family.email)
  })

  it('does nothing more when the same payment is confirmed again', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.confirmOrderPayment(payment(order, ready))
    const again = await store.confirmOrderPayment(payment(order, ready))
    expect(again.result).toBe('already_confirmed')
    expect(await counts(order.registrationId)).toEqual({ snapshots: 1, emails: 1, numbers: 1, cases: 0 })
  })

  it('fulfils once when two confirmations arrive together', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const results = await Promise.all([
      store.confirmOrderPayment(payment(order, ready)),
      store.confirmOrderPayment(payment(order, ready)),
    ])
    expect(results.map((r) => r.result).sort()).toEqual(['already_confirmed', 'confirmed'])
    expect(await counts(order.registrationId)).toEqual({ snapshots: 1, emails: 1, numbers: 1, cases: 0 })
  })

  it.each([
    ['amount_mismatch', { amountCents: 3999 }],
    ['currency_mismatch', { currency: 'eur' }],
    ['account_mismatch', { account: 'acct_other' }],
    ['claim_mismatch', { claimId: randomUUID() }],
    ['session_mismatch', { sessionId: 'cs_someone_else' }],
  ] as const)('records a %s case instead of confirming, once per session', async (reason, overrides) => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const first = await store.confirmOrderPayment(payment(order, ready, overrides))
    const second = await store.confirmOrderPayment(payment(order, ready, overrides))
    expect(first).toMatchObject({ result: 'exception', reason })
    expect(second).toEqual(first)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
    const { rows } = await db.pool.query(
      `SELECT e.severity, e.support_ref, (SELECT count(*)::int FROM notifications n WHERE n.exception_id = e.id) AS alerts
       FROM payment_exceptions e WHERE e.registration_id = $1`, [order.registrationId])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ severity: 'blocking', alerts: 1 })
    expect(rows[0].support_ref).toMatch(/^PAY-[A-HJKMNP-Z2-9]{5}$/)
  })

  it('refuses a payment already recorded on another order', async () => {
    const first = await createDraftOrder(db.pool)
    const firstReady = await readyToPay(db.pool, first)
    await store.confirmOrderPayment(payment(first, firstReady))
    const second = await createDraftOrder(db.pool)
    const secondReady = await readyToPay(db.pool, second)
    const result = await store.confirmOrderPayment(payment(second, secondReady, { paymentIntentId: `pi_${firstReady.sessionId}` }))
    expect(result).toMatchObject({ result: 'exception', reason: 'payment_reused' })
  })

  it('confirms a payment that arrived before Pay attached its session', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order, { attach: false })
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    expect(await orderRow(order.registrationId)).toMatchObject({ status: 'paid', stripe_checkout_session_id: ready.sessionId })
  })

  it('confirms a late payment when nothing conflicts', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })

  it('keeps both orders and records a case when a late payment conflicts with a newer order', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })
    const newer = await store.createOrder(order.family.householdId, order.listing.listing.id,
      buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries }))
    expect(newer.status).toBe('created')

    const result = await store.confirmOrderPayment(payment(order, ready))
    expect(result).toMatchObject({ result: 'exception', reason: 'late_payment_conflict' })
    expect((await orderRow(order.registrationId)).status).toBe('expired')
    if (newer.status === 'created') expect((await orderRow(newer.registration_id)).status).toBe('draft')
  })

  it('never loses a late payment that races a new Submit', async () => {
    for (let round = 0; round < 5; round++) {
      const order = await createDraftOrder(db.pool)
      const ready = await readyToPay(db.pool, order)
      await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })
      const [created, confirmed] = await Promise.all([
        store.createOrder(order.family.householdId, order.listing.listing.id,
          buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries })),
        store.confirmOrderPayment(payment(order, ready)),
      ])
      const confirmedWins = confirmed.result === 'confirmed' && created.status === 'refused'
      const submitWins = created.status === 'created' && confirmed.result === 'exception' && confirmed.reason === 'late_payment_conflict'
      expect(confirmedWins || submitWins).toBe(true)
    }
  })

  it('records a case for a payment against a cancelled order', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.cancelOrder(order.registrationId, order.family.householdId, ready.claimId)
    expect(await store.confirmOrderPayment(payment(order, ready))).toMatchObject({ result: 'exception', reason: 'order_not_payable' })
  })

  it('records a case when the order does not exist', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const missing = randomUUID()
    const result = await store.confirmOrderPayment(payment(order, ready, { registrationId: missing, sessionId: 'cs_orphan' }))
    expect(result).toMatchObject({ result: 'exception', reason: 'order_not_found' })
    const { rows } = await db.pool.query(`SELECT registration_id, details FROM payment_exceptions WHERE stripe_checkout_session_id = 'cs_orphan'`)
    expect(rows[0].registration_id).toBeNull()
    expect(rows[0].details.claimed_registration_id).toBe(missing)
  })

  it('rolls everything back when a step fails, and a retry then succeeds', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION public.numbering_is_down() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'numbering is down'; END $$;
      CREATE TRIGGER numbering_is_down BEFORE INSERT ON pre_registration.competitor_numbers
        FOR EACH ROW EXECUTE FUNCTION public.numbering_is_down();`)
    try {
      expect(await refused(store.confirmOrderPayment(payment(order, ready)))).toMatch(/numbering is down/)
      expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
      expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
    } finally {
      await db.pool.query('DROP TRIGGER numbering_is_down ON pre_registration.competitor_numbers')
    }
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
  })

  it('lets an unrelated uniqueness failure roll back for a retry instead of calling it a conflict', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION public.fake_unique_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE unique_violation USING MESSAGE = 'duplicate key in some other table', CONSTRAINT = 'some_other_unique'; END $$;
      CREATE TRIGGER fake_unique_failure BEFORE INSERT ON pre_registration.registration_snapshots
        FOR EACH ROW EXECUTE FUNCTION public.fake_unique_failure();`)
    try {
      expect(await refused(store.confirmOrderPayment(payment(order, ready)))).toMatch(/duplicate key in some other table/)
      expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
    } finally {
      await db.pool.query('DROP TRIGGER fake_unique_failure ON pre_registration.registration_snapshots')
    }
  })

  it('confirms, and flags it, when the feis has since switched Stripe accounts', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await db.pool.query(`UPDATE feis_listings SET stripe_account_id = 'acct_new' WHERE id = $1`, [order.listing.listing.id])
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    const { rows } = await db.pool.query(`SELECT severity, reason FROM payment_exceptions WHERE registration_id = $1`, [order.registrationId])
    expect(rows).toEqual([{ severity: 'notice', reason: 'listing_account_changed' }])
  })
})

describe('record_payment_failure', () => {
  it('records a failed payment and frees the family to try again; ignores a mismatched notice', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const base = { registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, eventId: 'evt_fail' }
    expect(await store.recordPaymentFailure({ ...base, account: 'acct_other' })).toEqual({ result: 'ignored' })
    expect(await store.recordPaymentFailure({ ...base, account: ready.config.account })).toMatchObject({ result: 'recorded' })
    expect((await orderRow(order.registrationId)).status).toBe('expired')
  })
})

describe('what parents can see', () => {
  it('shows a parent only a restricted view of their own family-facing cases', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.confirmOrderPayment(payment(order, ready, { amountCents: 1 }))
    await store.confirmOrderPayment(payment(order, ready, { account: 'acct_other' })) // admin-only reason

    const mine = await asParent(db.pool, order.family.userId, async (c) =>
      (await c.query('SELECT get_my_payment_reviews(NULL) AS reviews')).rows[0].reviews)
    expect(mine).toHaveLength(1)
    expect(Object.keys(mine[0]).sort()).toEqual(['created_at', 'message_code', 'registration_id', 'resolved', 'support_ref'])
    expect(mine[0]).toMatchObject({ registration_id: order.registrationId, message_code: 'A', resolved: false })

    const stranger = await createDraftOrder(db.pool)
    const theirs = await asParent(db.pool, stranger.family.userId, async (c) =>
      (await c.query('SELECT get_my_payment_reviews(NULL) AS reviews')).rows[0].reviews)
    expect(theirs).toEqual([])
  })

  it('keeps the payment tables and functions away from parents', async () => {
    const order = await createDraftOrder(db.pool)
    for (const sql of [
      'SELECT * FROM payment_exceptions',
      'SELECT * FROM notifications',
      `SELECT confirm_order_payment('${order.registrationId}', NULL, 'cs', 'acct', 1, 'usd', 'paid', 'pi', NULL, 'evt', 'webhook')`,
    ]) {
      expect(await refused(asParent(db.pool, order.family.userId, (c) => c.query(sql)))).toMatch(/permission denied/)
    }
  })
})

describe('the unique keys confirmation relies on (migration 012)', () => {
  it('lets one payment intent pay only one order, even when two confirmations race', async () => {
    const first = await createDraftOrder(db.pool)
    const firstReady = await readyToPay(db.pool, first)
    const second = await createDraftOrder(db.pool)
    const secondReady = await readyToPay(db.pool, second)
    const shared = `pi_shared_${randomUUID().slice(0, 8)}`
    const p = payment(first, firstReady, { paymentIntentId: shared })

    // The first confirmation is still open when the second checks for reuse, so only the unique index
    // on stripe_payment_intent_id can stop the second one
    const client = await db.pool.connect()
    let racing: Promise<string> | undefined
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('role', 'service_role', true)`)
      const { rows } = await client.query(
        'SELECT confirm_order_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS result',
        [p.registrationId, p.claimId, p.sessionId, p.account, p.amountCents, p.currency, p.paymentStatus,
         p.paymentIntentId, p.chargeId, p.eventId, p.source])
      expect(rows[0].result.result).toBe('confirmed')
      racing = refused(store.confirmOrderPayment(payment(second, secondReady, { paymentIntentId: shared })))
      await someoneIsWaiting()
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
    expect(await racing).toMatch(/idx_registrations_payment_intent_unique/)

    const { rows: holders } = await db.pool.query('SELECT id FROM registrations WHERE stripe_payment_intent_id = $1', [shared])
    expect(holders).toEqual([{ id: first.registrationId }])
    expect((await orderRow(second.registrationId)).status).toBe('pending_payment')
    expect(await counts(second.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
    // Stripe retries the second delivery, which the reuse check now records as a case
    expect(await store.confirmOrderPayment(payment(second, secondReady, { paymentIntentId: shared })))
      .toMatchObject({ result: 'exception', reason: 'payment_reused' })
  })

  it('never lets two orders share a checkout session', async () => {
    const first = await createDraftOrder(db.pool)
    const firstReady = await readyToPay(db.pool, first)
    const second = await createDraftOrder(db.pool)
    const secondReady = await readyToPay(db.pool, second, { attach: false })
    // A payment on the second order's own claim that names the first order's session would attach that
    // session to the second order too, when it marks it paid
    expect(await refused(store.confirmOrderPayment(payment(second, secondReady, { sessionId: firstReady.sessionId }))))
      .toMatch(/idx_registrations_checkout_session_unique/)
    expect(await refused(store.attachCheckoutSession(second.registrationId, secondReady.claimId, firstReady.sessionId)))
      .toMatch(/idx_registrations_checkout_session_unique/)
    expect(await orderRow(second.registrationId)).toMatchObject({ status: 'draft', stripe_checkout_session_id: null })
    expect(await counts(second.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
  })

  it('keeps one snapshot per order, even inside the transaction that paid it', async () => {
    const order = await createDraftOrder(db.pool)
    await readyToPay(db.pool, order)
    // _fulfil_order's steps with the snapshot written twice: the guard lets both through, so the index decides
    const message = await refused(asService(db.pool, async (c) => {
      await c.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-TWICE',
           stripe_payment_intent_id = 'pi_twice'
         WHERE id = $1`, [order.registrationId])
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [order.registrationId])
      await c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [order.registrationId])
      return c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [order.registrationId])
    }))
    expect(message).toMatch(/idx_registration_snapshots_one_per_order/)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
    expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
  })
})

describe('confirmation numbers', () => {
  it("take their year from Eastern time, so a payment on New Year's Eve in Boston keeps the old year", async () => {
    // 03:00 UTC on 1 January is 10pm on 31 December in Boston; 05:30 UTC is half past midnight there
    const { rows: [numbers] } = await db.pool.query(`
      SELECT new_confirmation_number('2027-01-01T03:00:00Z') AS new_years_eve,
             new_confirmation_number('2027-01-01T05:30:00Z') AS new_years_day`)
    expect(numbers.new_years_eve).toMatch(/^RF-2026-[A-HJKMNP-Z2-9]{5}$/)
    expect(numbers.new_years_day).toMatch(/^RF-2027-[A-HJKMNP-Z2-9]{5}$/)
  })
})
```

- [ ] **Step 4: Run them to confirm they fail**

Run: `npm run test:db -- tests/db/payment-confirmation.test.ts`
Expected: FAIL with `function pre_registration.confirm_order_payment(...) does not exist`.

- [ ] **Step 5: Write migration 015**

Create `supabase/migrations/015_payment_confirmation.sql`:
```sql
-- 015_payment_confirmation.sql
-- Payment hardening, part 4: confirmation is one transaction; anything that doesn't add up becomes
-- a durable case with a reference, an alert and a restricted parent view. Spec §9, §10, §12.

SET search_path TO pre_registration, public;

CREATE TABLE IF NOT EXISTS payment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_ref text NOT NULL UNIQUE,
  severity text NOT NULL CHECK (severity IN ('blocking', 'notice')),
  reason text NOT NULL CHECK (reason IN (
    'amount_mismatch', 'currency_mismatch', 'account_mismatch', 'claim_mismatch', 'session_mismatch',
    'payment_reused', 'order_not_payable', 'late_payment_conflict', 'order_not_found', 'payment_failed',
    'listing_account_changed')),
  registration_id uuid REFERENCES registrations(id),
  household_id uuid REFERENCES households(id),
  feis_listing_id uuid REFERENCES feis_listings(id),
  claim_id uuid,
  stripe_event_id text,
  stripe_account_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount_cents integer,
  currency text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text CHECK (resolution IN ('refunded', 'no_action', 'acknowledged', 'confirmed_late_payment')),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_exceptions_one_per_session_reason UNIQUE NULLS NOT DISTINCT (stripe_checkout_session_id, reason)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('registration_confirmation', 'payment_exception_alert', 'delivery_failure_alert')),
  dedupe_key text NOT NULL UNIQUE,
  registration_id uuid REFERENCES registrations(id),
  exception_id uuid REFERENCES payment_exceptions(id),
  related_notification_id uuid REFERENCES notifications(id),
  recipient text,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'needs_check')),
  attempts integer NOT NULL DEFAULT 0,
  send_generation integer NOT NULL DEFAULT 0,
  last_outcome text CHECK (last_outcome IN ('sent', 'explicit_failure', 'uncertain')),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_payment_exceptions_registration ON payment_exceptions (registration_id);

ALTER TABLE payment_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- PUBLIC as well, as in 012: whatever PUBLIC holds, every role holds
REVOKE ALL ON payment_exceptions, notifications FROM PUBLIC, anon, authenticated;

-- ─── References ───
CREATE OR REPLACE FUNCTION _random_code(p_length integer)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = pre_registration, pg_temp
AS $$
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, p_length)
$$;

-- The year is the one the family is in: RunFeis runs Northeast feiseanna only, so it is taken in
-- Eastern time, not UTC (a payment at 9pm on New Year's Eve in Boston keeps the old year).
-- p_at is there for the tests; payments always use now().
CREATE OR REPLACE FUNCTION new_confirmation_number(p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := 'RF-' || extract(year FROM p_at AT TIME ZONE 'America/New_York')::int || '-' || _random_code(5);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM registrations WHERE confirmation_number = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION new_support_ref()
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := 'PAY-' || _random_code(5);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM payment_exceptions WHERE support_ref = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- ─── Cases: one per session and reason, each with an alert queued ───
CREATE OR REPLACE FUNCTION _record_payment_exception(
  p_severity text, p_reason text, p_registration_id uuid, p_claim_id uuid, p_event_id text, p_account text,
  p_session_id text, p_payment_intent_id text, p_amount_cents integer, p_currency text, p_details jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_ref text;
  v_household uuid;
  v_listing uuid;
BEGIN
  IF p_registration_id IS NOT NULL THEN
    SELECT household_id, feis_listing_id INTO v_household, v_listing FROM registrations WHERE id = p_registration_id;
  END IF;

  INSERT INTO payment_exceptions (support_ref, severity, reason, registration_id, household_id, feis_listing_id,
    claim_id, stripe_event_id, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    amount_cents, currency, details)
  VALUES (new_support_ref(), p_severity, p_reason, p_registration_id, v_household, v_listing,
    p_claim_id, p_event_id, p_account, p_session_id, p_payment_intent_id,
    p_amount_cents, lower(p_currency), coalesce(p_details, '{}'::jsonb))
  ON CONFLICT ON CONSTRAINT payment_exceptions_one_per_session_reason DO NOTHING
  RETURNING id, support_ref INTO v_id, v_ref;

  IF v_id IS NULL THEN
    -- A repeat delivery of a case we already have
    SELECT support_ref INTO v_ref FROM payment_exceptions
    WHERE stripe_checkout_session_id IS NOT DISTINCT FROM p_session_id AND reason = p_reason;
    RETURN v_ref;
  END IF;

  INSERT INTO notifications (kind, dedupe_key, registration_id, exception_id)
  VALUES ('payment_exception_alert', 'exception:' || v_id, p_registration_id, v_id)
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN v_ref;
END;
$$;

-- ─── Fulfilment: every step or none. Callers hold the household-and-feis lock and the order row. ───
CREATE OR REPLACE FUNCTION _fulfil_order(p_registration_id uuid, p_session_id text, p_payment_intent_id text,
  p_charge_id text, p_amount_cents integer, p_currency text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
  v_number text := new_confirmation_number();
  v_email text;
BEGIN
  -- One UPDATE sets every payment field with the status: 012 needs the claim, session, payment time and
  -- confirmation number to arrive with 'paid', and freezes them from then on. The snapshot below is
  -- written in this same transaction, as 012's snapshot guard requires (paid_at = now()).
  UPDATE registrations
  SET status = 'paid',
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
      stripe_payment_intent_id = p_payment_intent_id,
      stripe_charge_id = p_charge_id,
      confirmation_number = v_number,
      paid_at = now(),
      hold_expires_at = NULL
  WHERE id = p_registration_id
  RETURNING * INTO v_order;

  PERFORM set_config('pre_registration.fulfilling_order', p_registration_id::text, true);
  INSERT INTO registration_snapshots (registration_id, snapshot_data)
  VALUES (p_registration_id, jsonb_build_object(
    'snapshot_version', 1,
    'order', jsonb_build_object(
      'id', v_order.id, 'household_id', v_order.household_id, 'feis_listing_id', v_order.feis_listing_id,
      'total_cents', v_order.total_cents, 'application_fee_cents', v_order.application_fee_cents,
      'event_fee_cents', v_order.event_fee_cents, 'is_late', v_order.is_late, 'created_at', v_order.created_at),
    'purchase', v_order.purchase_snapshot,
    'payment', jsonb_build_object(
      'confirmation_number', v_number, 'paid_at', v_order.paid_at,
      'checkout_session_id', v_order.stripe_checkout_session_id, 'payment_intent_id', p_payment_intent_id,
      'charge_id', p_charge_id, 'amount_cents', p_amount_cents, 'currency', p_currency,
      'account', v_order.checkout_config ->> 'account')));
  PERFORM set_config('pre_registration.fulfilling_order', '', true);

  -- Numbers go out in payment order, one feis at a time
  PERFORM 1 FROM feis_listings WHERE id = v_order.feis_listing_id FOR UPDATE;
  PERFORM _assign_numbers_for_registration(p_registration_id);

  SELECT u.email INTO v_email
  FROM households h JOIN auth.users u ON u.id = h.user_id
  WHERE h.id = v_order.household_id;

  INSERT INTO notifications (kind, dedupe_key, registration_id, recipient)
  VALUES ('registration_confirmation', 'confirmation:' || p_registration_id, p_registration_id, v_email)
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN v_number;
END;
$$;

-- ─── Confirmation ───
CREATE OR REPLACE FUNCTION confirm_order_payment(
  p_registration_id uuid, p_claim_id uuid, p_session_id text, p_account text, p_amount_cents integer,
  p_currency text, p_payment_status text, p_payment_intent_id text, p_charge_id text, p_event_id text, p_source text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_household uuid;
  v_listing uuid;
  v_order registrations%ROWTYPE;
  v_reason text;
  v_ref text;
  v_number text;
  v_constraint text;
  v_details jsonb := jsonb_build_object('source', p_source, 'claimed_registration_id', p_registration_id);
BEGIN
  IF p_payment_status IS DISTINCT FROM 'paid' THEN
    RETURN jsonb_build_object('result', 'not_paid');
  END IF;

  SELECT household_id, feis_listing_id INTO v_household, v_listing FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    v_ref := _record_payment_exception('blocking', 'order_not_found', NULL, p_claim_id, p_event_id, p_account,
      p_session_id, p_payment_intent_id, p_amount_cents, p_currency, v_details);
    RETURN jsonb_build_object('result', 'exception', 'reason', 'order_not_found', 'support_ref', v_ref);
  END IF;

  PERFORM lock_household_feis(v_household, v_listing);
  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;

  IF v_order.status = 'paid' AND v_order.stripe_checkout_session_id = p_session_id THEN
    RETURN jsonb_build_object('result', 'already_confirmed', 'confirmation_number', v_order.confirmation_number);
  END IF;

  -- Every check is against the order's own claim, never the listing's current settings
  v_reason := CASE
    WHEN v_order.checkout_claim_id IS NULL OR v_order.checkout_claim_id IS DISTINCT FROM p_claim_id THEN 'claim_mismatch'
    WHEN v_order.checkout_config ->> 'account' IS DISTINCT FROM p_account THEN 'account_mismatch'
    WHEN v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM p_session_id THEN 'session_mismatch'
    WHEN lower(p_currency) IS DISTINCT FROM v_order.checkout_config ->> 'currency' THEN 'currency_mismatch'
    WHEN p_amount_cents IS DISTINCT FROM v_order.total_cents THEN 'amount_mismatch'
    WHEN p_payment_intent_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM registrations WHERE stripe_payment_intent_id = p_payment_intent_id AND id <> p_registration_id)
      THEN 'payment_reused'
    WHEN v_order.status IN ('cancelled', 'paid') THEN 'order_not_payable'
    WHEN v_order.status = 'expired' AND EXISTS (
      SELECT 1 FROM registrations
      WHERE household_id = v_household AND feis_listing_id = v_listing AND id <> p_registration_id
        AND status IN ('draft', 'pending_payment', 'paid'))
      THEN 'late_payment_conflict'
    ELSE NULL
  END;

  IF v_reason IS NOT NULL THEN
    v_ref := _record_payment_exception('blocking', v_reason, p_registration_id, p_claim_id, p_event_id, p_account,
      p_session_id, p_payment_intent_id, p_amount_cents, p_currency, v_details);
    RETURN jsonb_build_object('result', 'exception', 'reason', v_reason, 'support_ref', v_ref);
  END IF;

  BEGIN
    v_number := _fulfil_order(p_registration_id, p_session_id, p_payment_intent_id, p_charge_id,
      p_amount_cents, lower(p_currency));
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    -- Only the one-active-order rule means "a newer order got there first". Any other uniqueness
    -- failure (numbers, payment reuse) rolls the whole transaction back so Stripe retries it.
    IF v_constraint IS DISTINCT FROM 'idx_registrations_active_unique' THEN
      RAISE;
    END IF;
    v_ref := _record_payment_exception('blocking', 'late_payment_conflict', p_registration_id, p_claim_id,
      p_event_id, p_account, p_session_id, p_payment_intent_id, p_amount_cents, p_currency,
      v_details || jsonb_build_object('caught', v_constraint));
    RETURN jsonb_build_object('result', 'exception', 'reason', 'late_payment_conflict', 'support_ref', v_ref);
  END;

  -- The money went to the account bound at checkout; flag it if the feis has since switched accounts
  IF (SELECT stripe_account_id FROM feis_listings WHERE id = v_listing) IS DISTINCT FROM p_account THEN
    PERFORM _record_payment_exception('notice', 'listing_account_changed', p_registration_id, p_claim_id,
      p_event_id, p_account, p_session_id, p_payment_intent_id, p_amount_cents, p_currency, v_details);
  END IF;

  RETURN jsonb_build_object('result', 'confirmed', 'confirmation_number', v_number);
END;
$$;

-- A failed delayed payment: record it, and free the family to start again
CREATE OR REPLACE FUNCTION record_payment_failure(p_registration_id uuid, p_claim_id uuid, p_session_id text,
  p_account text, p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
  v_ref text;
BEGIN
  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND
     OR p_claim_id IS NULL
     OR v_order.checkout_claim_id IS DISTINCT FROM p_claim_id
     OR v_order.checkout_config ->> 'account' IS DISTINCT FROM p_account
     OR (v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM p_session_id) THEN
    RETURN jsonb_build_object('result', 'ignored');
  END IF;

  v_ref := _record_payment_exception('blocking', 'payment_failed', p_registration_id, p_claim_id, p_event_id,
    p_account, p_session_id, NULL, NULL, NULL, '{}'::jsonb);
  IF v_order.status IN ('draft', 'pending_payment') THEN
    UPDATE registrations SET status = 'expired' WHERE id = p_registration_id;
  END IF;
  RETURN jsonb_build_object('result', 'recorded', 'support_ref', v_ref);
END;
$$;

-- What a parent may see of their own cases: a reference, a message code and whether it is resolved
CREATE OR REPLACE FUNCTION get_my_payment_reviews(p_registration_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'registration_id', e.registration_id,
      'support_ref', e.support_ref,
      'message_code', CASE WHEN e.reason = 'payment_failed' THEN 'B' ELSE 'A' END,
      'created_at', e.created_at,
      'resolved', e.status = 'resolved'
    ) ORDER BY e.created_at DESC), '[]'::jsonb)
  FROM payment_exceptions e
  JOIN registrations r ON r.id = e.registration_id
  WHERE r.household_id = (SELECT h.id FROM households h WHERE h.user_id = auth.uid())
    AND (p_registration_id IS NULL OR e.registration_id = p_registration_id)
    AND e.reason IN ('amount_mismatch', 'currency_mismatch', 'late_payment_conflict', 'order_not_payable', 'payment_failed')
$$;

REVOKE ALL ON FUNCTION _random_code(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION new_confirmation_number(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION new_support_ref() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION _record_payment_exception(text, text, uuid, uuid, text, text, text, text, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION _fulfil_order(uuid, text, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_my_payment_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION get_my_payment_reviews(uuid) TO authenticated;
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/015_payment_confirmation.sql src/app/_payments/order-store.ts tests/db/helpers/fixtures.ts tests/db/payment-confirmation.test.ts
git commit -m "feat: confirm payments in one transaction and record every case that doesn't add up (migration 015)"
```

---

### Task 10: The Stripe gateway, a fake Stripe, and the Pay, Cancel and sync workflows (done)

**Files:**
- Create: `src/lib/payment-review-messages.ts`
- Create: `src/app/_payments/stripe-gateway.ts`
- Create: `src/app/_payments/checkout-workflow.ts`
- Create: `tests/db/helpers/fake-stripe.ts`
- Test: `tests/payment-review-messages.test.ts`, `tests/db/checkout-workflow.test.ts`

**Interfaces:**
- Consumes:
  - `CheckoutConfig` and `buildCheckoutConfig`, `checkoutBlockReason` and `CHECKOUT_BLOCK_MESSAGES`, `classifyStripeError` and `StripeFailure` (Task 5)
  - `OrderStore`, `CheckoutOrder` (with `checkout_claimed_at`), `ClaimResult` and `ConfirmResult` (Tasks 6, 8 and 9)
- Produces:
  - **Parent messages:**
    - `ReviewMessageCode = 'A' | 'B' | 'C'`
    - `reviewCodeForReason(reason)` and `reviewMessage(code, supportRef)`
  - **Gateway:**
    - `StripeGateway`, with `createCheckoutSession(config): CreateSessionOutcome`, `retrieveCheckoutSession(id, account)`, `listClaimSessions(account, claimId, from, to)`, `expireCheckoutSession(id, account): ExpireSessionOutcome` and `latestChargeId(...)`
    - `GatewaySession`, `toGatewaySession` and `checkoutSessionParams`
    - `createStripeGateway(stripe)`
  - **Workflow:**
    - `CheckoutDeps`, which is `{ store, stripe, now, wait, baseUrl, newClaimId }`
    - `PayResult` and `CancelResult`
    - `pay(deps, ids)`, `cancel(deps, ids)` and `syncConfirmation(deps, ids)`
    - `payResultFromConfirmation(result)` and `CHECKOUT_MESSAGES`
    - `CREATE_DEADLINE_MS = 5 min` and `CREATE_SETTLED_AFTER_MS = 10 min`
  - **Test double:** `FakeStripe`, a `StripeGateway` with:
    - forced create outcomes `retry-before`, `retry-after`, `cached-500`, `in-progress` and `reject`
    - `listFails`
    - `pay(sessionId)`, `expire(sessionId)` and `sessionsFor(registrationId)`
    - `sessionId(n = 1)`: the id of the nth session this fake made. Ids are unique across fakes, as Stripe's are, because migration 012's unique index refuses one session id on two orders, and every test in a file shares one database.

How a claim's session is found and settled (spec §6a), in one place:
- **`locateClaimSession`:**
  - If a session is attached, retrieve it.
  - Otherwise, list the bound account's sessions created in the claim window and match the claim.
  - The result is `none` only when nothing is found **and** the claim is more than 10 minutes old. By then no create request can still be running: Pay sends no create request more than 5 minutes after the claim.
- **`settleSession`:**
  - An `open` session is resumed, or expired and checked expired.
  - An `expired` session counts as closed.
  - A `complete` and paid session goes through `confirm_order_payment`.
  - Anything else, including an expiry Stripe won't confirm, is unknown: the order is kept.
- **Errors never decide on their own:** a Stripe error never by itself decides whether a session exists. When a create attempt ends without a session, the workflow looks the session up.

- [ ] **Step 1: Write and pass the parent-message tests**

Create `tests/payment-review-messages.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { reviewCodeForReason, reviewMessage } from '@/lib/payment-review-messages'

describe('parent review messages', () => {
  it('uses message A when the charge is verified but the registration is not resolved', () => {
    for (const reason of ['amount_mismatch', 'currency_mismatch', 'late_payment_conflict', 'order_not_payable']) {
      expect(reviewCodeForReason(reason)).toBe('A')
    }
    expect(reviewMessage('A', 'PAY-7KQ2M')).toBe(
      "Your payment went through, but we need to check your registration before confirming it. Please don't pay again. Your reference is PAY-7KQ2M. We'll email you."
    )
  })

  it('uses message B for a failed payment', () => {
    expect(reviewCodeForReason('payment_failed')).toBe('B')
    expect(reviewMessage('B', null)).toBe("Your payment didn't go through, so this registration isn't confirmed. You can try again.")
  })

  it('shows families nothing for cases where the payer may not be them', () => {
    for (const reason of ['account_mismatch', 'claim_mismatch', 'session_mismatch', 'payment_reused', 'order_not_found', 'listing_account_changed']) {
      expect(reviewCodeForReason(reason)).toBeNull()
    }
  })

  it('has message C for a payment that is still being checked', () => {
    expect(reviewMessage('C', null)).toBe("We're checking your payment. Please don't try again until this updates.")
  })
})
```
Create `src/lib/payment-review-messages.ts`:
```ts
/** Parent-facing payment messages, worded exactly as in the payment hardening spec (§10). */
export type ReviewMessageCode = 'A' | 'B' | 'C'

const VERIFIED_CHARGE_REASONS = new Set([
  'amount_mismatch',
  'currency_mismatch',
  'late_payment_conflict',
  'order_not_payable'
])

/** null: the payer may not be this family, so only the payments contacts are told */
export function reviewCodeForReason(reason: string): ReviewMessageCode | null {
  if (reason === 'payment_failed') return 'B'
  return VERIFIED_CHARGE_REASONS.has(reason) ? 'A' : null
}

export function reviewMessage(code: ReviewMessageCode, supportRef: string | null): string {
  switch (code) {
    case 'A':
      return `Your payment went through, but we need to check your registration before confirming it. Please don't pay again.${
        supportRef ? ` Your reference is ${supportRef}.` : ''
      } We'll email you.`
    case 'B':
      return "Your payment didn't go through, so this registration isn't confirmed. You can try again."
    case 'C':
      return "We're checking your payment. Please don't try again until this updates."
  }
}
```
Run: `npx vitest run tests/payment-review-messages.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the Stripe gateway**

Create `src/app/_payments/stripe-gateway.ts`:
```ts
import type Stripe from 'stripe'
import type { CheckoutConfig } from '@/lib/engine/checkout-config'
import { classifyStripeError, type StripeFailure } from '@/lib/engine/stripe-errors'

export interface GatewaySession {
  id: string
  url: string | null
  status: 'open' | 'complete' | 'expired'
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required'
  amountTotal: number | null
  currency: string | null
  paymentIntentId: string | null
  metadata: Record<string, string>
}

export type CreateSessionOutcome =
  | { kind: 'created'; session: GatewaySession }
  | { kind: 'failed'; failure: StripeFailure; message: string }

/** What Stripe says the session is after an attempt to expire it. Read back, never assumed. */
export type ExpireSessionOutcome =
  | { kind: 'expired'; session: GatewaySession }
  | { kind: 'complete'; session: GatewaySession }
  | { kind: 'unknown'; message: string }

export interface StripeGateway {
  /** Sends exactly the frozen request, with its idempotency key, on its bound account */
  createCheckoutSession(config: CheckoutConfig): Promise<CreateSessionOutcome>
  /** null when Stripe couldn't be reached */
  retrieveCheckoutSession(sessionId: string, account: string): Promise<GatewaySession | null>
  /** The account's sessions created in the window whose metadata names this claim; null if Stripe couldn't be reached */
  listClaimSessions(account: string, claimId: string, createdFrom: Date, createdTo: Date): Promise<GatewaySession[] | null>
  expireCheckoutSession(sessionId: string, account: string): Promise<ExpireSessionOutcome>
  latestChargeId(paymentIntentId: string, account: string): Promise<string | null>
}

export function toGatewaySession(session: Stripe.Checkout.Session): GatewaySession {
  const paymentIntent = session.payment_intent
  return {
    id: session.id,
    url: session.url ?? null,
    status: session.status ?? 'open',
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    paymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? null),
    metadata: (session.metadata ?? {}) as Record<string, string>
  }
}

export function checkoutSessionParams(config: CheckoutConfig): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    line_items: config.line_items.map((item) => ({
      price_data: {
        currency: config.currency,
        product_data: { name: item.name },
        unit_amount: item.amount_cents
      },
      quantity: 1
    })),
    payment_method_types: [...config.payment_method_types],
    payment_intent_data: { application_fee_amount: config.application_fee_cents },
    success_url: config.success_url,
    cancel_url: config.cancel_url,
    expires_at: config.expires_at,
    client_reference_id: config.client_reference_id,
    // Built field by field, so a config read back from the database (jsonb reorders keys)
    // produces exactly the same request as the one first sent
    metadata: { registration_id: config.metadata.registration_id, claim_id: config.metadata.claim_id }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createStripeGateway(stripe: Stripe): StripeGateway {
  async function retrieveCheckoutSession(sessionId: string, account: string): Promise<GatewaySession | null> {
    try {
      return toGatewaySession(await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account }))
    } catch {
      return null
    }
  }

  return {
    async createCheckoutSession(config) {
      try {
        const session = await stripe.checkout.sessions.create(checkoutSessionParams(config), {
          stripeAccount: config.account,
          idempotencyKey: config.idempotency_key
        })
        return { kind: 'created', session: toGatewaySession(session) }
      } catch (err) {
        return { kind: 'failed', failure: classifyStripeError(err), message: message(err) }
      }
    },

    retrieveCheckoutSession,

    async listClaimSessions(account, claimId, createdFrom, createdTo) {
      try {
        const found: GatewaySession[] = []
        const sessions = stripe.checkout.sessions.list(
          {
            created: { gte: Math.floor(createdFrom.getTime() / 1000), lte: Math.ceil(createdTo.getTime() / 1000) },
            limit: 100
          },
          { stripeAccount: account }
        )
        for await (const session of sessions) {
          if (session.metadata?.claim_id === claimId) found.push(toGatewaySession(session))
        }
        return found
      } catch {
        return null
      }
    },

    async expireCheckoutSession(sessionId, account) {
      let failure = ''
      try {
        await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: account })
      } catch (err) {
        // Stripe refuses for a session that is complete or already expired. Inspect it either way.
        failure = message(err)
      }
      const current = await retrieveCheckoutSession(sessionId, account)
      if (current?.status === 'expired') return { kind: 'expired', session: current }
      if (current?.status === 'complete') return { kind: 'complete', session: current }
      return {
        kind: 'unknown',
        message: current ? `checkout is still ${current.status}` : failure || 'Stripe could not be reached'
      }
    },

    async latestChargeId(paymentIntentId, account) {
      try {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: account })
        const charge = intent.latest_charge
        return typeof charge === 'string' ? charge : (charge?.id ?? null)
      } catch {
        return null
      }
    }
  }
}
```

- [ ] **Step 3: Write the fake Stripe**

Create `tests/db/helpers/fake-stripe.ts`:
```ts
import { randomUUID } from 'node:crypto'
import type { CheckoutConfig } from '@/lib/engine/checkout-config'
import type { StripeFailure } from '@/lib/engine/stripe-errors'
import {
  checkoutSessionParams,
  type CreateSessionOutcome,
  type ExpireSessionOutcome,
  type GatewaySession,
  type StripeGateway
} from '@/app/_payments/stripe-gateway'

type StoredSession = GatewaySession & { account: string; created: number }

type ForcedCreate =
  | 'retry-before' // Stripe never saw the request
  | 'retry-after' // Stripe made the session, but the reply was lost
  | 'cached-500' // Stripe made the session, answered 500, and replays that 500 for this key
  | 'in-progress' // another request with this key is still running
  | 'reject' // Stripe refuses, and replays the refusal for this key

/**
 * Behaves like Stripe where it matters here:
 * - the same idempotency key with the same parameters returns the stored result, including a stored
 *   refusal or a cached 500
 * - the same key with different parameters is refused
 * - a new session must expire at least 30 minutes after it is made
 * - complete sessions can't be expired
 */
export class FakeStripe implements StripeGateway {
  readonly sessions = new Map<string, StoredSession>()
  nextCreate: ForcedCreate[] = []
  /** Make every list call fail, as if Stripe were unreachable */
  listFails = false
  createCalls = 0
  private readonly byKey = new Map<string, { params: string; outcome: CreateSessionOutcome }>()
  private counter = 0
  /** Unique to this fake, so no two fakes make the same session id (the database refuses one session on two orders) */
  private readonly idPrefix = `cs_test_${randomUUID().slice(0, 8)}_`

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** The id of the nth session this fake made, counting from 1 */
  sessionId(n = 1): string {
    return `${this.idPrefix}${n}`
  }

  async createCheckoutSession(config: CheckoutConfig): Promise<CreateSessionOutcome> {
    this.createCalls++
    const forced = this.nextCreate.shift()
    if (forced === 'retry-before') return this.failure('retry', 'connection reset before Stripe')
    if (forced === 'in-progress') return this.failure('in_progress', 'idempotency_key_in_use')

    const params = JSON.stringify(checkoutSessionParams(config)) + config.account
    const stored = this.byKey.get(config.idempotency_key)
    if (stored) {
      if (stored.params !== params) {
        return this.failure('rejected', 'Keys for idempotent requests can only be used with the same parameters')
      }
      return stored.outcome
    }

    if (forced === 'reject') {
      const refusal = this.failure('rejected', 'Your account cannot currently make live charges.')
      this.byKey.set(config.idempotency_key, { params, outcome: refusal })
      return refusal
    }
    if (config.expires_at * 1000 < this.now().getTime() + 30 * 60_000) {
      return this.failure('rejected', 'expires_at must be at least 30 minutes in the future')
    }

    const session = this.makeSession(config)
    if (forced === 'cached-500') {
      const serverError = this.failure('retry', 'Stripe API error (500)')
      this.byKey.set(config.idempotency_key, { params, outcome: serverError })
      return serverError
    }
    const created: CreateSessionOutcome = { kind: 'created', session: this.view(session) }
    this.byKey.set(config.idempotency_key, { params, outcome: created })
    if (forced === 'retry-after') return this.failure('retry', 'reply lost after Stripe made the session')
    return created
  }

  async retrieveCheckoutSession(sessionId: string, account: string): Promise<GatewaySession | null> {
    const session = this.sessions.get(sessionId)
    return session && session.account === account ? this.view(session) : null
  }

  async listClaimSessions(account: string, claimId: string, createdFrom: Date, createdTo: Date): Promise<GatewaySession[] | null> {
    if (this.listFails) return null
    return [...this.sessions.values()]
      .filter((s) =>
        s.account === account && s.metadata.claim_id === claimId &&
        s.created >= createdFrom.getTime() && s.created <= createdTo.getTime())
      .map((s) => this.view(s))
  }

  async expireCheckoutSession(sessionId: string, account: string): Promise<ExpireSessionOutcome> {
    const session = this.sessions.get(sessionId)
    if (!session || session.account !== account) return { kind: 'unknown', message: 'No such checkout.session' }
    if (session.status === 'open') session.status = 'expired'
    return session.status === 'complete'
      ? { kind: 'complete', session: this.view(session) }
      : { kind: 'expired', session: this.view(session) }
  }

  async latestChargeId(paymentIntentId: string): Promise<string | null> {
    return `ch_for_${paymentIntentId}`
  }

  /** The family pays on Stripe's page */
  pay(sessionId: string): GatewaySession {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'open') throw new Error(`checkout ${sessionId} is not open`)
    session.status = 'complete'
    session.paymentStatus = 'paid'
    session.paymentIntentId = `pi_${sessionId}`
    return this.view(session)
  }

  /** Stripe expires the session on its own */
  expire(sessionId: string): GatewaySession {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'open') throw new Error(`checkout ${sessionId} is not open`)
    session.status = 'expired'
    return this.view(session)
  }

  sessionsFor(registrationId: string): StoredSession[] {
    return [...this.sessions.values()].filter((s) => s.metadata.registration_id === registrationId)
  }

  private makeSession(config: CheckoutConfig): StoredSession {
    const id = this.sessionId(++this.counter)
    const session: StoredSession = {
      id, url: `https://checkout.stripe.test/${id}`, status: 'open', paymentStatus: 'unpaid',
      amountTotal: config.total_cents, currency: config.currency, paymentIntentId: null,
      metadata: { ...config.metadata }, account: config.account, created: this.now().getTime(),
    }
    this.sessions.set(id, session)
    return session
  }

  private failure(failure: StripeFailure, message: string): CreateSessionOutcome {
    return { kind: 'failed', failure, message }
  }

  private view(session: StoredSession): GatewaySession {
    return {
      id: session.id, url: session.url, status: session.status, paymentStatus: session.paymentStatus,
      amountTotal: session.amountTotal, currency: session.currency, paymentIntentId: session.paymentIntentId,
      metadata: { ...session.metadata },
    }
  }
}
```

- [ ] **Step 4: Write the failing workflow tests**

Create `tests/db/checkout-workflow.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cancel, CHECKOUT_MESSAGES, pay, syncConfirmation, type CheckoutDeps } from '@/app/_payments/checkout-workflow'
import { createOrderStore, type OrderStore } from '@/app/_payments/order-store'
import { reviewMessage } from '@/lib/payment-review-messages'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { FakeStripe } from './helpers/fake-stripe'
import { checkoutConfigFor, createDraftOrder, type DraftOrderFixture } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: OrderStore

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

function deps(stripe: FakeStripe, overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return {
    store, stripe, now: () => new Date(), wait: async () => undefined,
    baseUrl: 'https://runfeis.test', newClaimId: () => randomUUID(),
    ...overrides,
  }
}

/** A clock this many minutes ahead of the database, as if the family came back later */
const minutesLater = (minutes: number) => () => new Date(Date.now() + minutes * 60_000)

const ids = (order: DraftOrderFixture) => ({ registrationId: order.registrationId, householdId: order.family.householdId })

/** What Pay returns for the nth checkout this fake Stripe made */
const checkoutPage = (stripe: FakeStripe, n = 1) =>
  ({ kind: 'redirect', url: `https://checkout.stripe.test/${stripe.sessionId(n)}` })

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

/** A store whose attach step dies, like a Pay request that stopped after Stripe made the session */
const crashingAttach = (): OrderStore => ({ ...store, attachCheckoutSession: async () => { throw new Error('crashed') } })

/** Claims checkout the way Pay does, without making a session: a Pay that stopped right after claiming */
async function claimOnly(order: DraftOrderFixture) {
  const claimId = randomUUID()
  const config = checkoutConfigFor(order, claimId)
  const claim = await store.claimCheckout({
    registrationId: order.registrationId, householdId: order.family.householdId, claimId, config,
  })
  if (claim.result !== 'claimed') throw new Error('expected a claim')
  return { claimId, config }
}

describe('pay', () => {
  it('creates one checkout and moves the order to pending_payment', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    const row = await orderRow(order.registrationId)
    expect(row).toMatchObject({ status: 'pending_payment', stripe_checkout_session_id: stripe.sessionId() })
    expect(row.checkout_config.payment_method_types).toEqual(['card'])
    expect(stripe.sessions.size).toBe(1)
  })

  it('gives two simultaneous clicks one claim and one session', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    const [a, b] = await Promise.all([pay(deps(stripe), ids(order)), pay(deps(stripe), ids(order))])
    expect(a).toEqual(b)
    expect(a.kind).toBe('redirect')
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(1)
  })

  it('resumes the same session after the family backs out of Stripe', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    const first = await pay(deps(stripe), ids(order))
    expect(await pay(deps(stripe), ids(order))).toEqual(first)
    expect(stripe.createCalls).toBe(1)
  })

  it('recovers a session Stripe made before an earlier Pay stopped', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    expect(await pay({ ...deps(stripe), store: crashingAttach() }, ids(order)).catch(() => null)).toBeNull()
    expect((await orderRow(order.registrationId)).stripe_checkout_session_id).toBeNull()

    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(1)
    expect((await orderRow(order.registrationId)).stripe_checkout_session_id).toBe(stripe.sessionId())
  })

  it('replays retryable failures with the identical request', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['retry-before', 'retry-after']
    const order = await createDraftOrder(db.pool)
    expect((await pay(deps(stripe), ids(order))).kind).toBe('redirect')
    expect(stripe.createCalls).toBe(3)
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(1)
  })

  it('finds a session hidden behind a cached 500 by looking it up, and resumes it', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['cached-500']
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    expect(stripe.createCalls).toBe(4)
    expect((await orderRow(order.registrationId)).stripe_checkout_session_id).toBe(stripe.sessionId())
  })

  it('waits instead of guessing while the same request is still in progress', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['in-progress', 'in-progress', 'in-progress', 'in-progress']
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual({ kind: 'try_again', message: CHECKOUT_MESSAGES.starting })
    const row = await orderRow(order.registrationId)
    expect(row.status).toBe('draft')
    expect(row.checkout_claim_id).not.toBeNull()
  })

  it('reports a refusal without cancelling, and frees the family only once no session can exist', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['reject']
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual({ kind: 'error', message: CHECKOUT_MESSAGES.couldNotStart })
    expect((await orderRow(order.registrationId)).status).toBe('draft')

    // 11 minutes on: no create request can still be running, and Stripe has no session for the claim
    expect((await pay(deps(stripe, { now: minutesLater(11) }), ids(order))).kind).toBe('start_again')
    expect((await orderRow(order.registrationId)).status).toBe('cancelled')
    expect(stripe.sessions.size).toBe(0)
  })

  it('starts no checkout once the organiser closes registration, and leaves the order alone', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [order.listing.listing.id])
    expect(await pay(deps(stripe), ids(order)))
      .toEqual({ kind: 'blocked', message: 'Registration has been closed by the organiser.' })
    expect((await orderRow(order.registrationId)).checkout_claim_id).toBeNull()
  })

  it('lets a submitted order be paid after the deadline while registration stays open', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_listings SET reg_closes_at = now() - interval '1 minute' WHERE id = $1`, [order.listing.listing.id])
    expect((await pay(deps(stripe), ids(order))).kind).toBe('redirect')
  })

  it('asks the family to start again once the hold has passed', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.registrationId])
    expect(await pay(deps(stripe), ids(order))).toEqual({ kind: 'start_again', message: CHECKOUT_MESSAGES.expired })
    expect(stripe.createCalls).toBe(0)
  })

  it('confirms when the family paid and comes back before the webhook', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    const result = await pay(deps(stripe), ids(order))
    expect(result.kind).toBe('paid')
    if (result.kind === 'paid') expect(result.confirmationNumber).toMatch(/^RF-/)
  })

  it('settles a session that was paid while the order moved on, instead of trying to expire it', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    // While Pay is attaching, the family has already paid and the order's hold has run out
    const racing: OrderStore = {
      ...store,
      attachCheckoutSession: async (registrationId, claimId, sessionId) => {
        stripe.pay(sessionId)
        await store.expireCheckout({ registrationId, claimId, sessionId, account: 'acct_test_feis' })
        return store.attachCheckoutSession(registrationId, claimId, sessionId)
      },
    }
    expect((await pay({ ...deps(stripe), store: racing }, ids(order))).kind).toBe('paid')
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })
})

describe('cancel', () => {
  it('cancels an unclaimed draft', async () => {
    const order = await createDraftOrder(db.pool)
    expect(await cancel(deps(new FakeStripe()), ids(order))).toEqual({ kind: 'cancelled' })
    expect((await orderRow(order.registrationId)).status).toBe('cancelled')
  })

  it('closes the Stripe page, and checks it closed, before cancelling during checkout', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
    expect(() => stripe.pay(stripe.sessionId())).toThrow(/not open/)
  })

  it('confirms the payment instead of cancelling once the family has paid', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    expect((await cancel(deps(stripe), ids(order))).kind).toBe('paid')
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })

  it('finds and closes a session that Pay never attached', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay({ ...deps(stripe), store: crashingAttach() }, ids(order)).catch(() => null)
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
  })

  it('will not cancel while a session may still be being made, and cancels once it can', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await claimOnly(order) // Pay has claimed; its create request may still be running
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater })
    expect((await orderRow(order.registrationId)).status).toBe('draft')

    // Pay finishes making the session, then the family cancels
    expect((await pay(deps(stripe), ids(order))).kind).toBe('redirect')
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
  })

  it('finds a session behind a cached 500 and closes it before cancelling', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    const { config } = await claimOnly(order)
    stripe.nextCreate = ['cached-500']
    expect((await stripe.createCheckoutSession(config)).kind).toBe('failed')
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
  })

  it('cancels a claim that never made a session, once that is established', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await claimOnly(order)
    expect(await cancel(deps(stripe, { now: minutesLater(11) }), ids(order))).toEqual({ kind: 'cancelled' })
  })

  it('keeps the order when Stripe cannot be reached to check', async () => {
    const stripe = new FakeStripe()
    stripe.listFails = true
    const order = await createDraftOrder(db.pool)
    await claimOnly(order)
    expect(await cancel(deps(stripe, { now: minutesLater(11) }), ids(order)))
      .toEqual({ kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater })
    expect((await orderRow(order.registrationId)).status).toBe('draft')
  })

  it('ends Pay racing Cancel in one consistent state, with no payable session the order does not know about', async () => {
    for (let round = 0; round < 10; round++) {
      const stripe = new FakeStripe()
      const order = await createDraftOrder(db.pool)
      await Promise.all([pay(deps(stripe), ids(order)), cancel(deps(stripe), ids(order))])

      const row = await orderRow(order.registrationId)
      const open = stripe.sessionsFor(order.registrationId).filter((s) => s.status === 'open')
      expect(['cancelled', 'pending_payment']).toContain(row.status)
      if (row.status === 'cancelled') expect(open).toEqual([])
      else expect(open.map((s) => s.id)).toEqual([row.stripe_checkout_session_id])
    }
  })
})

describe('syncConfirmation', () => {
  it('confirms from the success page when Stripe says the checkout is complete', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    expect((await syncConfirmation(deps(stripe), ids(order)))?.kind).toBe('paid')
  })

  it("never confirms from another order's session", async () => {
    const stripe = new FakeStripe()
    const theirs = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(theirs))
    stripe.pay(stripe.sessionId())

    const mine = await createDraftOrder(db.pool)
    await claimOnly(mine)
    expect(await syncConfirmation(deps(stripe), ids(mine))).toBeNull()
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM payment_exceptions WHERE registration_id = $1', [mine.registrationId])
    expect(rows[0].n).toBe(0)
    expect((await orderRow(mine.registrationId)).status).toBe('draft')
  })

  it('tells the family to wait, not to pay again, when confirmation fails for now', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    const broken = { ...deps(stripe), store: { ...store, confirmOrderPayment: async () => { throw new Error('database is down') } } }
    expect(await pay(broken, ids(order))).toEqual({ kind: 'try_again', message: reviewMessage('C', null) })
  })
})
```

- [ ] **Step 5: Run them to confirm they fail**

Run: `npm run test:db -- tests/db/checkout-workflow.test.ts`
Expected: FAIL. `@/app/_payments/checkout-workflow` doesn't exist.

- [ ] **Step 6: Write the workflow**

Create `src/app/_payments/checkout-workflow.ts`:
```ts
import { buildCheckoutConfig, type CheckoutConfig } from '@/lib/engine/checkout-config'
import { CHECKOUT_BLOCK_MESSAGES, checkoutBlockReason } from '@/lib/engine/checkout-policy'
import { reviewCodeForReason, reviewMessage } from '@/lib/payment-review-messages'
import type { CheckoutOrder, ConfirmResult, OrderStore } from './order-store'
import type { GatewaySession, StripeGateway } from './stripe-gateway'

export interface CheckoutDeps {
  store: OrderStore
  stripe: StripeGateway
  now: () => Date
  wait: (ms: number) => Promise<void>
  baseUrl: string
  newClaimId: () => string
}

export type PayResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'paid'; confirmationNumber: string | null }
  | { kind: 'start_again'; message: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'try_again'; message: string }
  | { kind: 'review'; message: string; supportRef: string | null }
  | { kind: 'error'; message: string }

export type CancelResult =
  | { kind: 'cancelled' }
  | { kind: 'paid'; confirmationNumber: string | null }
  | { kind: 'try_again'; message: string }
  | { kind: 'review'; message: string; supportRef: string | null }
  | { kind: 'error'; message: string }

export const CHECKOUT_MESSAGES = {
  notFound: 'Registration not found.',
  expired: 'This registration has expired. Please start a new one.',
  cancelled: 'This registration was cancelled. Please start a new one.',
  starting: 'Payment is taking a moment to start. Please try again.',
  couldNotStart: "Payment couldn't start for this feis. Please contact the organiser.",
  cancelLater: "We can't cancel this yet because a payment may still be starting. Please try again in a few minutes.",
  noCheckoutPage: "Stripe didn't return a payment page. Please try again."
} as const

/** Pay sends no create request once a claim is this old */
export const CREATE_DEADLINE_MS = 5 * 60_000
/** By this age every create request for a claim has finished, so a session that can't be found was never made */
export const CREATE_SETTLED_AFTER_MS = 10 * 60_000
/** Look this far before the claim time too, in case the clocks differ */
const CLAIM_LOOKUP_BEFORE_MS = 60_000
/** Calls per attempt to create a session: the first try plus identical replays */
const CREATE_TRIES = 4

type ClaimedOrder = CheckoutOrder & {
  checkout_claim_id: string
  checkout_config: CheckoutConfig
  checkout_claimed_at: string
}

function isClaimed(order: CheckoutOrder): order is ClaimedOrder {
  return Boolean(order.checkout_claim_id && order.checkout_config && order.checkout_claimed_at)
}

function claimAge(deps: CheckoutDeps, order: ClaimedOrder): number {
  return deps.now().getTime() - new Date(order.checkout_claimed_at).getTime()
}

function redirectTo(session: GatewaySession): PayResult {
  return session.url
    ? { kind: 'redirect', url: session.url }
    : { kind: 'error', message: CHECKOUT_MESSAGES.noCheckoutPage }
}

// ─── Pay ───

export async function pay(
  deps: CheckoutDeps,
  input: { registrationId: string; householdId: string }
): Promise<PayResult> {
  const order = await deps.store.getOrderForCheckout(input.registrationId, input.householdId)
  if (!order) return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
  return payOrder(deps, order)
}

async function payOrder(deps: CheckoutDeps, order: CheckoutOrder): Promise<PayResult> {
  switch (order.status) {
    case 'paid':
      return { kind: 'paid', confirmationNumber: order.confirmation_number }
    case 'expired':
      return { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }
    case 'cancelled':
      return { kind: 'start_again', message: CHECKOUT_MESSAGES.cancelled }
    case 'draft':
    case 'pending_payment':
      break
  }
  if (isClaimed(order)) return resumeClaim(deps, order)
  if (order.status !== 'draft') return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }

  // A quick check for a clear message; claim_checkout makes the final decision under its lock
  const block = checkoutBlockReason({
    listingStatus: order.listing.status,
    stripeAccountId: order.listing.stripe_account_id,
    competitionIds: order.competition_ids,
    enabledCompetitionIds: order.enabled_competition_ids,
    totalCents: order.total_cents
  })
  if (block) return { kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES[block] }

  const claimId = deps.newClaimId()
  const config = buildCheckoutConfig({
    registrationId: order.id,
    feisListingId: order.feis_listing_id,
    claimId,
    account: order.listing.stripe_account_id!,
    totalCents: order.total_cents,
    applicationFeeCents: order.application_fee_cents,
    eventFeeCents: order.event_fee_cents,
    snapshot: order.purchase_snapshot,
    baseUrl: deps.baseUrl,
    now: deps.now()
  })
  const claim = await deps.store.claimCheckout({
    registrationId: order.id,
    householdId: order.household_id,
    claimId,
    config
  })
  switch (claim.result) {
    case 'claimed':
      return createAndAttach(deps, {
        ...order,
        checkout_claim_id: claim.claim_id,
        checkout_config: claim.config,
        checkout_claimed_at: claim.claimed_at
      })
    case 'already_claimed':
      return reread(deps, order)
    case 'blocked':
      return { kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES[claim.reason] }
    case 'not_claimable':
      return claim.hold_expired
        ? { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }
        : reread(deps, order)
    case 'not_found':
      return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
  }
}

/** Another request changed the order: answer from its current state */
async function reread(deps: CheckoutDeps, order: CheckoutOrder): Promise<PayResult> {
  const fresh = await deps.store.getOrderForCheckout(order.id, order.household_id)
  if (!fresh) return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
  if (fresh.status === 'draft' && !isClaimed(fresh)) {
    return { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }
  }
  return payOrder(deps, fresh)
}

/** The order already has its one claim: carry on with it, never replace it. */
async function resumeClaim(deps: CheckoutDeps, order: ClaimedOrder): Promise<PayResult> {
  if (order.status === 'draft' && !order.stripe_checkout_session_id && claimAge(deps, order) < CREATE_DEADLINE_MS) {
    // Another click is making the session, or an earlier Pay stopped: replay the identical request
    return createAndAttach(deps, order)
  }
  const located = await locateClaimSession(deps, order)
  switch (located.kind) {
    case 'found':
      return order.stripe_checkout_session_id
        ? settleForPay(deps, order, located.session)
        : attachOrSettle(deps, order, located.session)
    case 'none':
      return abandonClaim(deps, order, CHECKOUT_MESSAGES.expired)
    case 'unknown':
      return { kind: 'try_again', message: CHECKOUT_MESSAGES.starting }
  }
}

async function createAndAttach(deps: CheckoutDeps, order: ClaimedOrder): Promise<PayResult> {
  let refused = false
  for (let tries = 0; tries < CREATE_TRIES && claimAge(deps, order) < CREATE_DEADLINE_MS; tries++) {
    const outcome = await deps.stripe.createCheckoutSession(order.checkout_config)
    if (outcome.kind === 'created') return attachOrSettle(deps, order, outcome.session)
    if (outcome.failure === 'rejected') {
      console.error(`[CHECKOUT] Stripe refused the checkout for order ${order.id}: ${outcome.message}`)
      refused = true
      break
    }
    // 'retry' or 'in_progress': pause, then replay the identical request
    await deps.wait(500 * (tries + 1))
  }

  // No session in hand. An error, even a refusal, says nothing certain about earlier attempts
  // with this key, so look the session up instead of guessing (spec §6a).
  const located = await locateClaimSession(deps, order)
  if (located.kind === 'found') return attachOrSettle(deps, order, located.session)
  if (located.kind === 'none') {
    return abandonClaim(deps, order, refused ? CHECKOUT_MESSAGES.couldNotStart : CHECKOUT_MESSAGES.expired)
  }
  return refused
    ? { kind: 'error', message: CHECKOUT_MESSAGES.couldNotStart }
    : { kind: 'try_again', message: CHECKOUT_MESSAGES.starting }
}

/** Attaches a session made or found for this claim, or settles it if the order moved on meanwhile. */
async function attachOrSettle(deps: CheckoutDeps, order: ClaimedOrder, session: GatewaySession): Promise<PayResult> {
  const attach = await deps.store.attachCheckoutSession(order.id, order.checkout_claim_id, session.id)
  if (attach.result === 'attached' || attach.result === 'already_attached') {
    if (attach.status === 'pending_payment') {
      return settleForPay(deps, { ...order, status: 'pending_payment', stripe_checkout_session_id: session.id }, session)
    }
    if (attach.status === 'paid') return reread(deps, order)
  }
  // Cancelled, expired or confirmed while the session was being made: settle the session itself
  const settled = await settleSession(deps, order, session, 'close')
  if (settled.kind === 'result') return settled.result
  if (settled.kind === 'unknown') return unknownResult(settled)
  return reread(deps, order)
}

async function settleForPay(deps: CheckoutDeps, order: ClaimedOrder, session: GatewaySession): Promise<PayResult> {
  const settled = await settleSession(deps, order, session, 'resume')
  switch (settled.kind) {
    case 'open':
      return redirectTo(settled.session)
    case 'result':
      return settled.result
    case 'unknown':
      return unknownResult(settled)
    case 'closed':
      // Stripe has expired this checkout: record that here, then the family starts again
      await deps.store.expireCheckout({
        registrationId: order.id,
        claimId: order.checkout_claim_id,
        sessionId: session.id,
        account: order.checkout_config.account
      })
      return reread(deps, order)
  }
}

/** The claim never produced a session and never will (established by locateClaimSession). */
async function abandonClaim(deps: CheckoutDeps, order: ClaimedOrder, message: string): Promise<PayResult> {
  if (order.status === 'draft') {
    await deps.store.cancelOrder(order.id, order.household_id, order.checkout_claim_id)
  }
  return { kind: 'start_again', message }
}

// ─── Finding and settling a claim's session (spec §6a) ───

type Located = { kind: 'found'; session: GatewaySession } | { kind: 'none' } | { kind: 'unknown' }

/**
 * Finds the session this claim produced: by its id if attached, otherwise by listing the bound
 * account's sessions from the claim window. 'none' only once no create request can still be running.
 */
async function locateClaimSession(deps: CheckoutDeps, order: ClaimedOrder): Promise<Located> {
  const account = order.checkout_config.account
  if (order.stripe_checkout_session_id) {
    const session = await deps.stripe.retrieveCheckoutSession(order.stripe_checkout_session_id, account)
    return session ? { kind: 'found', session } : { kind: 'unknown' }
  }
  const claimedAt = new Date(order.checkout_claimed_at).getTime()
  const sessions = await deps.stripe.listClaimSessions(
    account,
    order.checkout_claim_id,
    new Date(claimedAt - CLAIM_LOOKUP_BEFORE_MS),
    new Date(claimedAt + CREATE_SETTLED_AFTER_MS)
  )
  if (!sessions) return { kind: 'unknown' }
  const mine = sessions.find((s) => s.metadata.registration_id === order.id)
  if (mine) return { kind: 'found', session: mine }
  return claimAge(deps, order) > CREATE_SETTLED_AFTER_MS ? { kind: 'none' } : { kind: 'unknown' }
}

type Settled =
  | { kind: 'open'; session: GatewaySession }
  | { kind: 'closed' }
  | { kind: 'result'; result: PayResult }
  | { kind: 'unknown'; paymentMayHaveHappened: boolean }

/**
 * The one place a claim's session is settled. Open: resume it, or expire it and check it expired.
 * Expired: it can't be paid. Complete and paid: confirm through the same checks as the webhook.
 * Anything else is unknown, and the order is kept.
 */
async function settleSession(
  deps: CheckoutDeps,
  order: ClaimedOrder,
  session: GatewaySession,
  intent: 'resume' | 'close'
): Promise<Settled> {
  let current = session
  if (current.status === 'open') {
    if (intent === 'resume') return { kind: 'open', session: current }
    const expired = await deps.stripe.expireCheckoutSession(current.id, order.checkout_config.account)
    if (expired.kind === 'unknown') return { kind: 'unknown', paymentMayHaveHappened: false }
    current = expired.session
  }
  if (current.status === 'expired') return { kind: 'closed' }
  if (current.paymentStatus === 'paid') {
    return { kind: 'result', result: await confirmFromSession(deps, order, current) }
  }
  // Complete without a payment: only a delayed payment method does this. Keep the order and check.
  return { kind: 'unknown', paymentMayHaveHappened: true }
}

function unknownResult(settled: { paymentMayHaveHappened: boolean }): PayResult {
  return {
    kind: 'try_again',
    message: settled.paymentMayHaveHappened ? reviewMessage('C', null) : CHECKOUT_MESSAGES.starting
  }
}

// ─── Confirmation from a session the server fetched itself ───

export function payResultFromConfirmation(result: ConfirmResult): PayResult {
  switch (result.result) {
    case 'confirmed':
    case 'already_confirmed':
      return { kind: 'paid', confirmationNumber: result.confirmation_number }
    case 'exception': {
      const code = reviewCodeForReason(result.reason) ?? 'C'
      const supportRef = code === 'A' ? result.support_ref : null
      return { kind: 'review', message: reviewMessage(code, supportRef), supportRef }
    }
    case 'not_paid':
      return { kind: 'try_again', message: reviewMessage('C', null) }
  }
}

async function confirmFromSession(
  deps: Pick<CheckoutDeps, 'store' | 'stripe'>,
  order: Pick<ClaimedOrder, 'id' | 'checkout_config'>,
  session: GatewaySession
): Promise<PayResult> {
  const account = order.checkout_config.account
  try {
    const chargeId = session.paymentIntentId ? await deps.stripe.latestChargeId(session.paymentIntentId, account) : null
    const result = await deps.store.confirmOrderPayment({
      registrationId: order.id,
      claimId: session.metadata.claim_id ?? null,
      sessionId: session.id,
      account,
      amountCents: session.amountTotal,
      currency: session.currency,
      paymentStatus: session.paymentStatus,
      paymentIntentId: session.paymentIntentId,
      chargeId,
      eventId: `sync:${session.id}`,
      source: 'sync'
    })
    return payResultFromConfirmation(result)
  } catch (err) {
    console.error(`[CHECKOUT] Confirming order ${order.id} from Stripe failed:`, err)
    return { kind: 'try_again', message: reviewMessage('C', null) }
  }
}

// ─── Cancel ───

function cancelResultFrom(result: PayResult): CancelResult {
  if (result.kind === 'paid' || result.kind === 'review' || result.kind === 'try_again' || result.kind === 'error') {
    return result
  }
  return { kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater }
}

export async function cancel(
  deps: CheckoutDeps,
  input: { registrationId: string; householdId: string }
): Promise<CancelResult> {
  // One re-read is allowed: a Pay click or the webhook may change the order underneath us
  for (let round = 0; round < 2; round++) {
    const order = await deps.store.getOrderForCheckout(input.registrationId, input.householdId)
    if (!order) return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
    if (order.status === 'paid') return { kind: 'paid', confirmationNumber: order.confirmation_number }
    if (order.status === 'expired' || order.status === 'cancelled') return { kind: 'cancelled' }

    if (!isClaimed(order)) {
      const result = await deps.store.cancelOrder(order.id, order.household_id, null)
      if (result.result === 'cancelled') return { kind: 'cancelled' }
      continue
    }

    // Never cancel on a guess: find the claim's session and settle it first (spec §7)
    const located = await locateClaimSession(deps, order)
    if (located.kind === 'unknown') return { kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater }
    if (located.kind === 'found') {
      const settled = await settleSession(deps, order, located.session, 'close')
      if (settled.kind === 'result') return cancelResultFrom(settled.result)
      if (settled.kind === 'unknown') {
        return {
          kind: 'try_again',
          message: settled.paymentMayHaveHappened ? reviewMessage('C', null) : CHECKOUT_MESSAGES.cancelLater
        }
      }
    }
    // Stripe confirms the checkout can't be paid, or it is established that none was ever made
    const result = await deps.store.cancelOrder(order.id, order.household_id, order.checkout_claim_id)
    if (result.result === 'cancelled') return { kind: 'cancelled' }
  }
  return { kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater }
}

// ─── The success page ───

/**
 * If Stripe says this order's checkout is complete but the order isn't paid, confirm it now.
 * It finds the order's own session by its claim; it never uses a session id from the URL.
 */
export async function syncConfirmation(
  deps: CheckoutDeps,
  input: { registrationId: string; householdId: string }
): Promise<PayResult | null> {
  const order = await deps.store.getOrderForCheckout(input.registrationId, input.householdId)
  if (!order) return null
  if (order.status === 'paid') return { kind: 'paid', confirmationNumber: order.confirmation_number }
  if (order.status === 'cancelled' || !isClaimed(order)) return null

  const located = await locateClaimSession(deps, order)
  if (located.kind !== 'found' || located.session.status !== 'complete') return null
  const settled = await settleSession(deps, order, located.session, 'resume')
  if (settled.kind === 'result') return settled.result
  if (settled.kind === 'unknown') return unknownResult(settled)
  return null
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test && npm run test:db`
Expected: PASS. If the Pay-versus-Cancel race ever fails, it has found a real ordering bug. Don't loosen the assertion; fix the workflow.

- [ ] **Step 8: Commit**

```bash
git add src/lib/payment-review-messages.ts src/app/_payments/stripe-gateway.ts src/app/_payments/checkout-workflow.ts tests/db/helpers/fake-stripe.ts tests/payment-review-messages.test.ts tests/db/checkout-workflow.test.ts
git commit -m "feat: Pay, Cancel and the sync find and settle a claim's session instead of guessing from errors"
```

---

### Task 11: The new webhook (done)

**Files:**
- Create: `src/app/_payments/webhook-handler.ts`
- Modify: `src/app/api/webhooks/stripe/route.ts` (rewrite)
- Test: `tests/db/webhook-handler.test.ts`

**Interfaces:**
- Consumes:
  - `confirmOrderPayment`, `recordPaymentFailure` and `expireCheckout` (Tasks 8 and 9)
  - `toGatewaySession` and `StripeGateway` (Task 10)
- Produces: `handleStripeEvent(deps: WebhookDeps, event): Promise<WebhookOutcome>`, where `WebhookOutcome = { status: 200 | 500; registrationId: string | null; body }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/db/webhook-handler.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore, type OrderStore } from '@/app/_payments/order-store'
import { handleStripeEvent, type WebhookDeps } from '@/app/_payments/webhook-handler'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { FakeStripe } from './helpers/fake-stripe'
import { createDraftOrder, readyToPay, type DraftOrderFixture } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: OrderStore

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

function deps(log: string[] = []): WebhookDeps {
  return { store, stripe: new FakeStripe(), log: (line) => log.push(line) }
}

type Ready = Awaited<ReturnType<typeof readyToPay>>

function sessionFor(order: DraftOrderFixture, ready: Ready, overrides: Record<string, unknown> = {}) {
  return {
    object: 'checkout.session', id: ready.sessionId, status: 'complete', payment_status: 'paid',
    amount_total: order.payload.total_cents, currency: 'usd', payment_intent: `pi_${ready.sessionId}`,
    metadata: { registration_id: order.registrationId, claim_id: ready.claimId },
    ...overrides,
  }
}

function event(type: string, session: Record<string, unknown>, account = 'acct_test_feis', id = `evt_${randomUUID()}`): Stripe.Event {
  return { id, object: 'event', type, account, data: { object: session } } as unknown as Stripe.Event
}

async function status(id: string) {
  const { rows } = await db.pool.query('SELECT status FROM registrations WHERE id = $1', [id])
  return rows[0].status
}

describe('handleStripeEvent', () => {
  it('confirms a paid checkout, and treats a repeat delivery as done', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const paid = event('checkout.session.completed', sessionFor(order, ready))
    expect(await handleStripeEvent(deps(), paid)).toMatchObject({ status: 200, body: { result: 'confirmed' } })
    expect(await handleStripeEvent(deps(), paid)).toMatchObject({ status: 200, body: { result: 'already_confirmed' } })
    expect(await status(order.registrationId)).toBe('paid')
  })

  it('waits on a checkout that completed without payment', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const outcome = await handleStripeEvent(deps(), event('checkout.session.completed', sessionFor(order, ready, { payment_status: 'unpaid' })))
    expect(outcome).toMatchObject({ status: 200, body: { waiting: true } })
    expect(await status(order.registrationId)).toBe('pending_payment')
  })

  it("quietly ignores an organiser's own Stripe sales", async () => {
    const before = await db.pool.query('SELECT (SELECT count(*)::int FROM payment_exceptions) AS cases, (SELECT count(*)::int FROM notifications) AS alerts')
    for (const metadata of [{}, { registration_id: 'not-a-uuid' }]) {
      const outcome = await handleStripeEvent(deps(), event('checkout.session.completed', {
        object: 'checkout.session', id: 'cs_other_sale', payment_status: 'paid', amount_total: 2500, currency: 'usd', metadata,
      }))
      expect(outcome).toMatchObject({ status: 200, body: { ignored: 'not a RunFeis checkout' } })
    }
    const after = await db.pool.query('SELECT (SELECT count(*)::int FROM payment_exceptions) AS cases, (SELECT count(*)::int FROM notifications) AS alerts')
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('records a case for a payment from the wrong account', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const log: string[] = []
    const outcome = await handleStripeEvent(deps(log), event('checkout.session.completed', sessionFor(order, ready), 'acct_other'))
    expect(outcome).toMatchObject({ status: 200, body: { result: 'exception', reason: 'account_mismatch' } })
    expect(log.some((line) => line.startsWith('[PAYMENT_EXCEPTION] PAY-'))).toBe(true)
    expect(await status(order.registrationId)).toBe('pending_payment')
  })

  it('records a failed payment and frees the family', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const outcome = await handleStripeEvent(deps(), event('checkout.session.async_payment_failed', sessionFor(order, ready, { payment_status: 'unpaid' })))
    expect(outcome).toMatchObject({ status: 200, body: { result: 'recorded' } })
    expect(await status(order.registrationId)).toBe('expired')
  })

  it("expires only the order's own checkout, and never a paid order", async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    expect(await handleStripeEvent(deps(), event('checkout.session.expired', sessionFor(order, ready, { id: 'cs_old', status: 'expired' }))))
      .toMatchObject({ body: { result: 'ignored', why: 'mismatch' } })
    expect(await handleStripeEvent(deps(), event('checkout.session.expired', sessionFor(order, ready, { status: 'expired' }))))
      .toMatchObject({ body: { result: 'expired' } })

    const paidOrder = await createDraftOrder(db.pool)
    const paidReady = await readyToPay(db.pool, paidOrder)
    await handleStripeEvent(deps(), event('checkout.session.completed', sessionFor(paidOrder, paidReady)))
    expect(await handleStripeEvent(deps(), event('checkout.session.expired', sessionFor(paidOrder, paidReady, { status: 'expired' }))))
      .toMatchObject({ body: { result: 'ignored', why: 'not_open' } })
    expect(await status(paidOrder.registrationId)).toBe('paid')
  })

  it('asks Stripe to retry when the database step fails', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const broken: WebhookDeps = { ...deps(), store: { ...store, confirmOrderPayment: async () => { throw new Error('database is down') } } }
    expect(await handleStripeEvent(broken, event('checkout.session.completed', sessionFor(order, ready))))
      .toMatchObject({ status: 500 })
  })
})
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npm run test:db -- tests/db/webhook-handler.test.ts`
Expected: FAIL. `@/app/_payments/webhook-handler` doesn't exist.

- [ ] **Step 3: Write the webhook handler**

Create `src/app/_payments/webhook-handler.ts`:
```ts
import type Stripe from 'stripe'
import type { OrderStore } from './order-store'
import { toGatewaySession, type StripeGateway } from './stripe-gateway'

export interface WebhookDeps {
  store: OrderStore
  stripe: StripeGateway
  log: (line: string) => void
}

export interface WebhookOutcome {
  status: 200 | 500
  registrationId: string | null
  body: Record<string, unknown>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ok(registrationId: string | null, body: Record<string, unknown>): WebhookOutcome {
  return { status: 200, registrationId, body }
}

/** Maps a verified Stripe event to the database function that handles it (spec §8). */
export async function handleStripeEvent(deps: WebhookDeps, event: Stripe.Event): Promise<WebhookOutcome> {
  if (!event.type.startsWith('checkout.session.')) return ok(null, { ignored: event.type })

  const session = event.data.object as Stripe.Checkout.Session
  const registrationId = session.metadata?.registration_id ?? null
  // Organisers' own Stripe sales reach this Connect endpoint too; they carry no RunFeis order
  if (!registrationId || !UUID.test(registrationId)) return ok(null, { ignored: 'not a RunFeis checkout' })

  const metadataClaim = session.metadata?.claim_id ?? null
  const claimId = metadataClaim && UUID.test(metadataClaim) ? metadataClaim : null
  const account = event.account ?? ''

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (session.payment_status !== 'paid') {
          deps.log(`[WEBHOOK] ${session.id} completed without payment yet; waiting`)
          return ok(registrationId, { waiting: true })
        }
        const paymentIntentId = toGatewaySession(session).paymentIntentId
        const chargeId = paymentIntentId ? await deps.stripe.latestChargeId(paymentIntentId, account) : null
        const result = await deps.store.confirmOrderPayment({
          registrationId,
          claimId,
          sessionId: session.id,
          account,
          amountCents: session.amount_total ?? null,
          currency: session.currency ?? null,
          paymentStatus: session.payment_status,
          paymentIntentId,
          chargeId,
          eventId: event.id,
          source: 'webhook'
        })
        if (result.result === 'exception') {
          deps.log(`[PAYMENT_EXCEPTION] ${result.support_ref} ${result.reason} order ${registrationId}`)
        }
        return ok(registrationId, result)
      }

      case 'checkout.session.async_payment_failed': {
        const result = await deps.store.recordPaymentFailure({
          registrationId, claimId, sessionId: session.id, account, eventId: event.id
        })
        if (result.result === 'recorded') {
          deps.log(`[PAYMENT_EXCEPTION] ${result.support_ref} payment_failed order ${registrationId}`)
        }
        return ok(registrationId, result)
      }

      case 'checkout.session.expired': {
        const result = await deps.store.expireCheckout({ registrationId, claimId, sessionId: session.id, account })
        if (result.result === 'ignored') deps.log(`[WEBHOOK] expiry of ${session.id} ignored: ${result.why}`)
        return ok(registrationId, result)
      }

      default:
        return ok(registrationId, { ignored: event.type })
    }
  } catch (err) {
    deps.log(`[WEBHOOK] database step failed for ${event.id}: ${err instanceof Error ? err.message : String(err)}`)
    return { status: 500, registrationId, body: { error: 'database step failed' } }
  }
}
```

- [ ] **Step 4: Rewrite the webhook route**

Replace `src/app/api/webhooks/stripe/route.ts` with:
```ts
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import { createOrderStore } from '@/app/_payments/order-store'
import { supabaseRpc } from '@/app/_payments/rpc'
import { createStripeGateway } from '@/app/_payments/stripe-gateway'
import { handleStripeEvent } from '@/app/_payments/webhook-handler'

export async function POST(request: Request) {
  const body = await request.text() // RAW body: signature verification needs it unparsed
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_CONNECT_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const outcome = await handleStripeEvent(
    {
      store: createOrderStore(supabaseRpc(createServiceClient())),
      stripe: createStripeGateway(stripe),
      log: (line) => console.log(line)
    },
    event
  )
  return NextResponse.json(outcome.body, { status: outcome.status })
}
```

- [ ] **Step 5: Run all the tests and the build**

Run: `npm test && npm run test:db && npm run build`
Expected: PASS, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/_payments/webhook-handler.ts src/app/api/webhooks/stripe/route.ts tests/db/webhook-handler.test.ts
git commit -m "feat: the webhook confirms, records failures and expires checkouts through the same database checks"
```

---

### Task 12: Pay and Cancel actions, the success page and the dashboard (done)

**Files:**
- Create: `src/app/_payments/checkout-deps.ts`
- Create: `src/lib/email/email-config.ts`
- Modify: `src/lib/payment-review-messages.ts` (add `PaymentReview` and `openReviewsByOrder`)
- Modify: `src/app/feiseanna/[id]/register/actions.ts` (Pay and Cancel through the workflow)
- Modify: `src/components/registration/entry-page.tsx` (handle the new result kinds; delete `parentPaymentMessage`)
- Modify: `src/components/registration/family-receipt.tsx` (resume a started payment; the agreement box only before an order exists)
- Modify: `src/app/feiseanna/[id]/register/success/page.tsx` (rewrite)
- Modify: `src/app/dashboard/page.tsx`
- Modify: `docs/known-issues.md` (two parent issues this task fixes)
- Test: `tests/email-config.test.ts` (create), `tests/payment-review-messages.test.ts` (modify)

**Interfaces:**
- Consumes:
  - `pay`, `cancel`, `syncConfirmation`, `CheckoutDeps`, `PayResult` and `CancelResult` (Task 10)
  - `reviewMessage` (Task 10)
  - `createStripeGateway` (Task 10); `createOrderStore` and `supabaseRpc` (Task 6); `getStripe` (`src/lib/stripe.ts`)
  - `get_my_payment_reviews(p_registration_id uuid DEFAULT NULL)`, called with the parent's own client (Task 9)
  - From Task 7: `currentHousehold()` in `actions.ts`; the entry page's `requestedEntries`, `orderBreakdown` and `setOrderBreakdown`; and `FamilyReceipt`'s `onPay(consentAccepted)`
  - `getSignedInUser` (`src/lib/supabase/server.ts`) and `CoverBand` (`src/components/feis-cover.tsx`)
- Produces:
  - `createCheckoutSession(registrationId): Promise<PayResult>`
  - `cancelRegistration(registrationId): Promise<CancelResult>`
  - `checkoutDeps(): CheckoutDeps`
  - `PaymentReview`, and `openReviewsByOrder(reviews): Map<string, PaymentReview>`
  - `emailIsConfigured(env): boolean`, the rule for whether RunFeis sends email at all. Task 13's `notificationDeps()` applies the same rule and can call it.

The entry page keeps its one click: `handlePay` submits the order if there isn't one yet, then calls Pay. "Change entries" calls Cancel. What changes is what the page does with the answers:
- **Pay's answers:**
  - It can send the family to Stripe.
  - It can report the order paid, or under review. Both go to the success page, which says what happens next.
  - It can ask the family to start again. The order is finished, but the cart stays, so the next Pay submits a fresh order.
  - Otherwise it explains why nothing happened (blocked, try again, or an error), and the order stays as it is.
- **A started payment can be resumed.** The receipt shows "Return to payment", which runs Pay, and Pay returns the open Stripe session (spec §6). The redesigned receipt hid Pay once a payment had started, so a family who backed out of Stripe could only start over.
- **The agreement box shows only before an order exists.** Submit records the agreement, so an order in progress doesn't ask again.

The success page doesn't wait for the webhook: it confirms from Stripe (spec §9) through the sync, which finds the order's own session by its claim and never uses the URL's `session_id` (Review Focus 2). It shows message A or B for an open case, and message C while confirmation is unfinished, all worded by `reviewMessage` (spec §10). It mentions the confirmation email only when email is set up. Today it says an email was sent even when none can be.

No component tests (UI, project rule §5). The two new pure helpers are tested, and Tasks 9–11 cover the logic underneath. There's no browser walk-through here: `.env.local` points at the live project, which gets 012–017 only in Task 16 Step 7, so Submit, Pay and the case views can't run against it before then. Task 16 Step 11 walks through them end to end.

- [ ] **Step 1: Write the failing helper tests**

In `tests/payment-review-messages.test.ts` (Task 10):

(a) Replace:
```ts
import { reviewCodeForReason, reviewMessage } from '@/lib/payment-review-messages'
```
with:
```ts
import {
  openReviewsByOrder,
  reviewCodeForReason,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'
```

(b) Append to `tests/payment-review-messages.test.ts`:
```ts
describe('openReviewsByOrder', () => {
  function review(overrides: Partial<PaymentReview> = {}): PaymentReview {
    return {
      registration_id: 'r1',
      support_ref: 'PAY-7KQ2M',
      message_code: 'A',
      created_at: '2026-10-16T12:00:00+00:00',
      resolved: false,
      ...overrides
    }
  }

  it("keeps each order's newest unresolved case, whatever order the rows come in", () => {
    const older = review({ support_ref: 'PAY-OLDER' })
    const newer = review({ support_ref: 'PAY-NEWER', created_at: '2026-10-16T13:00:00+00:00' })
    const other = review({ registration_id: 'r2', support_ref: 'PAY-OTHER', message_code: 'B' })
    for (const rows of [
      [newer, other, older],
      [older, other, newer]
    ]) {
      const open = openReviewsByOrder(rows)
      expect(open.get('r1')).toBe(newer)
      expect(open.get('r2')).toBe(other)
    }
  })

  it('shows nothing for a resolved case', () => {
    const resolvedLater = review({ created_at: '2026-10-16T13:00:00+00:00', resolved: true })
    expect(openReviewsByOrder([review({ resolved: true })]).size).toBe(0)
    expect(openReviewsByOrder([review(), resolvedLater]).get('r1')).toEqual(review())
  })
})
```

Create `tests/email-config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { emailIsConfigured } from '@/lib/email/email-config'

const CONFIGURED = {
  RESEND_API_KEY: 're_test_123',
  EMAIL_FROM: 'RunFeis <entries@runfeis.com>',
  PAYMENTS_ALERT_EMAIL: 'daniel@example.com, steve@example.com'
}

describe('emailIsConfigured', () => {
  it('is on when Resend, the sender and the payments contacts are all set', () => {
    expect(emailIsConfigured(CONFIGURED)).toBe(true)
  })

  it('is off when any one of them is missing', () => {
    expect(emailIsConfigured({ ...CONFIGURED, RESEND_API_KEY: undefined })).toBe(false)
    expect(emailIsConfigured({ ...CONFIGURED, EMAIL_FROM: '' })).toBe(false)
    expect(emailIsConfigured({ ...CONFIGURED, PAYMENTS_ALERT_EMAIL: undefined })).toBe(false)
  })

  it('needs at least one real address among the payments contacts', () => {
    expect(emailIsConfigured({ ...CONFIGURED, PAYMENTS_ALERT_EMAIL: ' , ' })).toBe(false)
    const oneContact = { ...CONFIGURED, PAYMENTS_ALERT_EMAIL: 'steve@example.com' }
    expect(emailIsConfigured(oneContact)).toBe(true)
  })
})
```

Run: `npx vitest run tests/payment-review-messages.test.ts tests/email-config.test.ts`
Expected: FAIL. `openReviewsByOrder` isn't exported yet, and `@/lib/email/email-config` doesn't exist.

- [ ] **Step 2: Add the review helpers and the email rule**

Append to `src/lib/payment-review-messages.ts`:
```ts
/** A row of get_my_payment_reviews(): all a parent may see of a payment case on their own order */
export interface PaymentReview {
  registration_id: string
  support_ref: string
  message_code: 'A' | 'B'
  created_at: string
  resolved: boolean
}

/**
 * Each order's newest unresolved case, from get_my_payment_reviews() rows in any order. A
 * resolved case shows nothing: the payments contacts have dealt with it and told the family.
 */
export function openReviewsByOrder(reviews: PaymentReview[]): Map<string, PaymentReview> {
  const open = new Map<string, PaymentReview>()
  for (const review of reviews) {
    if (review.resolved) continue
    const shown = open.get(review.registration_id)
    if (!shown || Date.parse(review.created_at) > Date.parse(shown.created_at)) {
      open.set(review.registration_id, review)
    }
  }
  return open
}
```

Create `src/lib/email/email-config.ts`:
```ts
/**
 * Whether RunFeis sends email: Resend, the sender address and at least one payments contact must
 * all be set (spec §12). Until then confirmations wait in the queue unsent, so no page may tell a
 * family that one is on its way. Pass `process.env`; the notification worker uses the same rule.
 */
export function emailIsConfigured(env: Record<string, string | undefined>): boolean {
  const contacts = (env.PAYMENTS_ALERT_EMAIL ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM && contacts.length > 0)
}
```
The parameter is a plain string map rather than an interface of three optional keys: TypeScript refuses to pass `process.env` to a type whose properties are all optional ("has no properties in common").

Run: `npx vitest run tests/payment-review-messages.test.ts tests/email-config.test.ts`
Expected: PASS.

- [ ] **Step 3: Add the real checkout dependencies**

Create `src/app/_payments/checkout-deps.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import type { CheckoutDeps } from './checkout-workflow'
import { createOrderStore } from './order-store'
import { supabaseRpc } from './rpc'
import { createStripeGateway } from './stripe-gateway'

/** The real dependencies for Pay, Cancel and the confirmation sync */
export function checkoutDeps(): CheckoutDeps {
  return {
    store: createOrderStore(supabaseRpc(createServiceClient())),
    stripe: createStripeGateway(getStripe()),
    now: () => new Date(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000',
    newClaimId: () => randomUUID()
  }
}
```
`getStripe()` throws while `STRIPE_SECRET_KEY` isn't set. Pay and Cancel catch that and say payment couldn't start. The success page logs it and shows the order as it stands.

- [ ] **Step 4: Pay and Cancel go through the workflow**

In `src/app/feiseanna/[id]/register/actions.ts`:

(a) Replace:
```ts
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { canTransitionRegistration } from '@/lib/registration-states'
```
with:
```ts
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
```

(b) Replace:
```ts
import { isHouseholdComplete, REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'
```
with:
```ts
import { isHouseholdComplete, REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'
import { checkoutDeps } from '@/app/_payments/checkout-deps'
import { cancel, pay, type CancelResult, type PayResult } from '@/app/_payments/checkout-workflow'
```

(c) Replace:
```ts
  RegistrationEntry,
  RegistrationStatus
} from '@/lib/types/feis-listing'
```
with:
```ts
  RegistrationEntry
} from '@/lib/types/feis-listing'
```

(d) In `src/app/feiseanna/[id]/register/actions.ts`, replace everything from `export async function cancelRegistration` to the end of the file with:
```ts
/** Pay (spec §6): start or resume this order's one checkout, or settle what Stripe already has */
export async function createCheckoutSession(registrationId: string): Promise<PayResult> {
  const ctx = await currentHousehold()
  if ('error' in ctx) return { kind: 'error', message: ctx.error }
  try {
    return await pay(checkoutDeps(), { registrationId, householdId: ctx.household.id })
  } catch (err) {
    console.error('Pay failed:', err)
    return { kind: 'error', message: "Payment couldn't start. Please try again in a moment." }
  }
}

/** Cancel (spec §7): close this order's checkout first, then cancel; never on a guess */
export async function cancelRegistration(registrationId: string): Promise<CancelResult> {
  const ctx = await currentHousehold()
  if ('error' in ctx) return { kind: 'error', message: ctx.error }
  try {
    return await cancel(checkoutDeps(), { registrationId, householdId: ctx.household.id })
  } catch (err) {
    console.error('Cancel failed:', err)
    return {
      kind: 'error',
      message: "Your entries couldn't be reopened. Please try again in a moment."
    }
  }
}
```
From here on, no TypeScript writes an order table: every change goes through the database functions (Global Constraints). Ownership is `currentHousehold()` (Task 7) plus the household id the workflow passes to every function.

- [ ] **Step 5: The entry page follows Pay's and Cancel's answers**

In `src/components/registration/entry-page.tsx`, replace everything from `async function handlePay(consentAccepted: boolean) {` down to, but not including, `const activeLateTier = feeSchedule`, with the code below. That covers `handlePay` and `handleChangeEntries`. Keep one blank line before `const activeLateTier`.
```tsx
  // Where a family goes once Stripe has taken a payment for the order: the success page
  // confirms it, or says what happens next
  const successHref = `/feiseanna/${feisId}/register/success`

  // The order can't be paid any more: forget it, keep the cart, and Pay submits a fresh one
  function startAgain(message: string) {
    setRegistrationId(null)
    setHoldExpiresAt(null)
    setOrderBreakdown(null)
    setPaymentStarted(false)
    setError(message)
  }

  async function handlePay(consentAccepted: boolean) {
    setError(null)
    setLoading(true)
    let leaving = false
    try {
      let regId: string | null = registrationId
      if (regId === null) {
        // The browser says only that the family agreed; the server records when and from where
        const order = await createDraftRegistration({
          feisListingId: feisId,
          entries: requestedEntries,
          consentAccepted
        })
        if ('error' in order) {
          setError(order.error)
          return
        }
        regId = order.registrationId
        setRegistrationId(regId)
        setHoldExpiresAt(order.holdExpiresAt)
        setOrderBreakdown(order.breakdown)
        setEditingId(null)
        // Submit priced the order afresh. If that isn't the total the Pay button showed (a late
        // tier started, or the organiser changed a fee, while the page was open), the held order
        // and its receipt keep Submit's price, and the family presses Pay again to pay it
        if (order.totalCents !== totalCents) {
          setError(
            `Your total is now ${formatCents(order.totalCents)}. ` +
              'Fees changed since you opened this page (for example, late fees started). ' +
              'Check the receipt, then press Pay to continue.'
          )
          return
        }
      }

      const payment = await createCheckoutSession(regId)
      switch (payment.kind) {
        case 'redirect':
          leaving = true
          window.location.href = payment.url
          return
        case 'paid':
        case 'review':
        case 'checking':
          // Stripe has, or may have, the money: the success page says what happens next
          leaving = true
          window.location.href = successHref
          return
        case 'start_again':
          startAgain(payment.message)
          return
        default:
          // blocked, try_again or error: the order stays as it is
          setError(payment.message)
      }
    } catch (err) {
      console.error('Payment failed to start:', err)
      setError('The payment page could not be opened. Check your connection and try again.')
    } finally {
      // Stay busy while the browser leaves, so a second click can't start anything
      if (!leaving) setLoading(false)
    }
  }

  async function handleChangeEntries() {
    if (!registrationId) return
    setError(null)
    setLoading(true)
    let leaving = false
    try {
      // A submitted order never changes: cancel it, keep the cart, and Pay submits a new one
      const result = await cancelRegistration(registrationId)
      switch (result.kind) {
        case 'cancelled':
          setRegistrationId(null)
          setHoldExpiresAt(null)
          setOrderBreakdown(null)
          setPaymentStarted(false)
          return
        case 'paid':
        case 'review':
        case 'checking':
          // The checkout was paid after all, or may have been
          leaving = true
          window.location.href = successHref
          return
        default:
          // try_again or error: the order stays as it is
          setError(result.message)
      }
    } catch (err) {
      console.error('Failed to reopen entries:', err)
      setError('Your entries could not be reopened. Check your connection and try again.')
    } finally {
      if (!leaving) setLoading(false)
    }
  }
```
The page's price is worked out when the cart changes, so if the order Submit creates costs something other than the total the Pay button showed (a late tier started, or the organiser changed a fee, while the page was open), Pay keeps the held order, shows the new total and stops, and the next press, which has an order id, goes straight to Pay: no family reaches Stripe at a price they weren't shown.

How each answer is handled:
- **`review`** goes to the success page, because Stripe has the money. That page shows message A, with the reference, for a recorded case, or message C for a case only the payments contacts see. On the entry page, the family would see a Pay button next to "Please don't pay again".
- **`checking`** goes to the success page too, from Pay or from Change entries: a payment may have gone through but isn't confirmed, so the family sees message C on a page that checks again every 5 seconds, not next to a live Pay button.
- **`try_again`** stays on the entry page. Its message is "Payment is taking a moment to start", or Cancel's "We can't cancel this yet"; never message C, which comes as `checking`.
- **The old `holdOver` workaround is gone.** Cancel answers `cancelled` for an order that has already expired.

Then delete `parentPaymentMessage`. It turned the old Pay's error strings into parent wording, and nothing calls it now: every Pay answer carries its own message. Its "Stripe not connected" case is the workflow's `stripe_not_connected` block (Task 5), and its "expired" case is `start_again`. Replace:
```tsx
/** The checkout's error, said the way a parent needs to hear it. */
function parentPaymentMessage(error: string | undefined): string {
  if (error?.toLowerCase().includes('not connected stripe')) {
    return 'This feis isn’t taking card payments yet. Your places are held for 30 minutes, so try again later, or contact the organiser.'
  }
  if (error?.toLowerCase().includes('expired')) {
    return 'The hold on these places ran out. Choose Change entries to start again.'
  }
  return 'The payment page could not be opened. Try again in a moment.'
}

export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
```
with:
```tsx
export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
```

- [ ] **Step 6: The receipt resumes a started payment**

In `src/components/registration/family-receipt.tsx`:

(a) Replace:
```tsx
      {paymentStarted ? (
        <p className="mt-3.5 text-[13px] text-muted-foreground">
          A payment was started for these entries. If you closed the payment page without paying,
          choose Change entries to start again.
        </p>
      ) : (
        <label
```
with:
```tsx
      {!held && (
        <label
```

(b) Replace:
```tsx
      {held && <HoldCountdown holdExpiresAt={holdExpiresAt} />}

      {!paymentStarted && (
        <button
          type="button"
          onClick={() => onPay(agreed)}
          disabled={!agreed || loading || nothingChosen}
          className="mt-3 w-full rounded-[3px] bg-primary py-3 text-[17px] font-extrabold text-primary-foreground [font-stretch:85%] hover:bg-[var(--color-feis-green-600)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)] disabled:opacity-50"
        >
          {loading ? 'Opening payment…' : `Pay ${formatCents(totalCents)}`}
        </button>
      )}
```
with:
```tsx
      {held && paymentStarted && (
        <p className="mt-3.5 text-[13px] text-muted-foreground">
          You started paying for these entries. Return to the payment page to finish, or choose
          Change entries to start again.
        </p>
      )}

      {held && <HoldCountdown holdExpiresAt={holdExpiresAt} />}

      <button
        type="button"
        onClick={() => onPay(agreed)}
        // An order in progress already records the agreement, from when it was submitted
        disabled={loading || nothingChosen || (!held && !agreed)}
        className="mt-3 w-full rounded-[3px] bg-primary py-3 text-[17px] font-extrabold text-primary-foreground [font-stretch:85%] hover:bg-[var(--color-feis-green-600)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)] disabled:opacity-50"
      >
        {loading
          ? 'Opening payment…'
          : paymentStarted
            ? 'Return to payment'
            : `Pay ${formatCents(totalCents)}`}
      </button>
```
`held` is true exactly when the page holds an order: the entry page sets and clears `holdExpiresAt` together with the order id. For a held order the button stays enabled without the box; `handlePay` uses `consentAccepted` only when it submits a new order. "Return to payment" runs the same Pay, which resumes the open session. If that session has expired, Pay answers `start_again`, and the page keeps the cart for a fresh order.

- [ ] **Step 7: Rewrite the success page**

Replace `src/app/feiseanna/[id]/register/success/page.tsx` with:
```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { emailIsConfigured } from '@/lib/email/email-config'
import {
  openReviewsByOrder,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import type { RegistrationStatus } from '@/lib/types/feis-listing'
import { checkoutDeps } from '@/app/_payments/checkout-deps'
import { syncConfirmation, type PayResult } from '@/app/_payments/checkout-workflow'
import { CoverBand } from '@/components/feis-cover'

export const dynamic = 'force-dynamic'

interface SuccessPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ session_id?: string }>
}

type ServerClient = Awaited<ReturnType<typeof createClient>>
type OrderSummary = { id: string; status: RegistrationStatus; confirmation_number: string | null }

/** What the page tells the family, most important first */
type View =
  | { kind: 'paid'; confirmationNumber: string | null }
  | { kind: 'case'; code: PaymentReview['message_code']; message: string }
  | { kind: 'checking'; message: string; refresh: boolean }
  | { kind: 'paying' | 'unpaid' | 'expired' | 'cancelled' | 'unavailable' }

const TITLES: Record<Exclude<View['kind'], 'case'>, string> = {
  paid: 'You’re entered',
  checking: 'Checking your payment',
  paying: 'Taking your payment',
  unpaid: 'Not paid yet',
  expired: 'Your hold ran out',
  cancelled: 'Entries cancelled',
  unavailable: 'Something went wrong'
}

function titleOf(view: View): string {
  if (view.kind !== 'case') return TITLES[view.kind]
  return view.code === 'A' ? 'We’re checking your registration' : 'Payment didn’t go through'
}

/**
 * The order this page is about: the one this checkout belongs to, otherwise the family's latest
 * for this feis. The session id from the URL only picks which of the family's own orders to show
 * (their own client can't read anyone else's); the sync never uses it.
 */
async function findOrder(
  supabase: ServerClient,
  householdId: string,
  feisId: string,
  sessionId: string | null
): Promise<OrderSummary | null | 'error'> {
  const orders = () =>
    supabase
      .from('registrations')
      .select('id, status, confirmation_number')
      .eq('household_id', householdId)
      .eq('feis_listing_id', feisId)

  if (sessionId) {
    const { data, error } = await orders()
      .eq('stripe_checkout_session_id', sessionId)
      .maybeSingle()
    if (error) return 'error'
    if (data) return data as OrderSummary
  }
  const { data, error } = await orders()
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 'error'
  return (data as OrderSummary | null) ?? null
}

async function viewFor(
  supabase: ServerClient,
  userId: string,
  feisId: string,
  sessionId: string | null
): Promise<View> {
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (householdError) {
    console.error('Success page: household failed to load:', householdError)
    return { kind: 'unavailable' }
  }
  if (!household) redirect(`/feiseanna/${feisId}`)

  const order = await findOrder(supabase, household.id, feisId, sessionId)
  if (order === 'error') {
    console.error('Success page: the order failed to load')
    return { kind: 'unavailable' }
  }
  if (!order) redirect(`/feiseanna/${feisId}`)
  if (order.status === 'paid') {
    return { kind: 'paid', confirmationNumber: order.confirmation_number }
  }

  // Don't wait for the webhook: if Stripe says this order's checkout is complete, confirm it now
  // (spec §9). The sync finds the order's own session by its claim; it never reads the URL.
  let synced: PayResult | null = null
  if (order.status !== 'cancelled') {
    try {
      synced = await syncConfirmation(checkoutDeps(), {
        registrationId: order.id,
        householdId: household.id
      })
    } catch (err) {
      console.error('Success page sync failed:', err)
    }
  }
  if (synced?.kind === 'paid') {
    return { kind: 'paid', confirmationNumber: synced.confirmationNumber }
  }

  // A case on this order outranks its status: it tells the family not to pay again, or to retry
  const { data: reviewRows, error: reviewsError } = await supabase.rpc('get_my_payment_reviews', {
    p_registration_id: order.id
  })
  if (reviewsError) {
    console.error('Success page: payment reviews failed to load:', reviewsError)
    return { kind: 'unavailable' }
  }
  const review = openReviewsByOrder((reviewRows ?? []) as PaymentReview[]).get(order.id)
  if (review) {
    return {
      kind: 'case',
      code: review.message_code,
      message: reviewMessage(review.message_code, review.support_ref)
    }
  }

  // Stripe has the payment, but confirmation isn't finished ('checking'), or it's a case only the
  // payments contacts see: message C. Only an unfinished confirmation is worth checking again.
  if (synced?.kind === 'checking' || synced?.kind === 'review') {
    return { kind: 'checking', message: synced.message, refresh: synced.kind === 'checking' }
  }

  switch (order.status) {
    case 'pending_payment':
      return { kind: 'paying' }
    case 'draft':
      return { kind: 'unpaid' }
    case 'expired':
      return { kind: 'expired' }
    case 'cancelled':
      return { kind: 'cancelled' }
  }
}

export default async function SuccessPage({ params, searchParams }: SuccessPageProps) {
  const { id: feisId } = await params
  const { session_id: sessionId } = await searchParams

  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
    const back = `/feiseanna/${feisId}/register/success${query}`
    redirect(`/auth/login?redirect=${encodeURIComponent(back)}`)
  }

  const view = await viewFor(supabase, user.id, feisId, sessionId ?? null)
  const entryHref = `/feiseanna/${feisId}/register`
  // Confirmation emails wait unsent until email is set up, so only promise one when it is
  const emailOn = emailIsConfigured(process.env)

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand
        links={[
          { href: '/dashboard', label: 'My entries' },
          { href: '/', label: 'Feiseanna' }
        ]}
      >
        <div className="min-w-0 pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">{titleOf(view)}</h1>
          {view.kind === 'paid' && (
            <p className="mt-1.5 max-w-[52ch] opacity-85">
              Payment received. Your dancers&apos; competitor numbers are ready.
            </p>
          )}
        </div>
      </CoverBand>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        {view.kind === 'paid' && (
          <>
            <div className="feis-receipt px-[18px] pt-5 pb-[18px]">
              <h2 className="text-[22px] leading-tight font-extrabold [font-stretch:75%]">
                Receipt
              </h2>
              <p className="mb-3 text-[13px] text-muted-foreground">Keep this for your records.</p>
              <div className="flex items-baseline justify-between border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
                <span className="font-bold">Status</span>
                <span className="rounded-[2px] bg-[var(--color-feis-green-light)] px-1.5 py-0.5 text-xs font-bold text-[var(--color-feis-green-700)]">
                  Paid in full
                </span>
              </div>
              {view.confirmationNumber && (
                <div className="mt-2 flex items-baseline gap-1.5 text-sm">
                  <span>Confirmation number</span>
                  <span className="feis-leader" />
                  <span className="feis-narrow text-[22px] leading-none select-all">
                    {view.confirmationNumber}
                  </span>
                </div>
              )}
              {emailOn && (
                <p className="mt-4 text-[13px] text-muted-foreground">
                  We&apos;ll also email this confirmation to the address you sign in with.
                </p>
              )}
            </div>

            <div className="mt-8">
              <p className="text-[15px]">
                Each dancer&apos;s competitor number is on the entry page for this feis. Bring them
                on the day.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={entryHref} className="feis-btn feis-btn-primary">
                  See competitor numbers
                </Link>
                <Link href="/dashboard" className="feis-btn feis-btn-outline">
                  All my entries
                </Link>
              </div>
            </div>
          </>
        )}

        {view.kind === 'case' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p role="status" className="text-[15px]">
              {view.message}
            </p>
            {view.code === 'A' ? (
              <Link href="/dashboard" className="feis-btn feis-btn-outline mt-4">
                All my entries
              </Link>
            ) : (
              <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
                Try again
              </Link>
            )}
          </div>
        )}

        {view.kind === 'checking' && (
          <div role="status" className="feis-card p-6">
            {view.refresh && <meta httpEquiv="refresh" content="5" />}
            <p className="text-[15px] font-bold">{view.message}</p>
          </div>
        )}

        {view.kind === 'paying' && (
          <div role="status" className="feis-card p-6">
            <meta httpEquiv="refresh" content="5" />
            <p className="text-[15px] font-bold">Your payment is going through.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This page checks again every few seconds. Please don&apos;t pay a second time.
            </p>
          </div>
        )}

        {view.kind === 'unpaid' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">These entries haven&apos;t been paid for</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Go back to the entry page to check the dances and pay.
            </p>
            <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
              Back to the entry page
            </Link>
          </div>
        )}

        {view.kind === 'expired' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">
              Your places were held for a limited time, and that time ran out
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Choose your dances again to enter.</p>
            <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
              Enter again
            </Link>
          </div>
        )}

        {view.kind === 'cancelled' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">These entries were cancelled</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You can enter again while the feis is taking entries.
            </p>
            <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
              Enter again
            </Link>
          </div>
        )}

        {view.kind === 'unavailable' && (
          <div role="alert" className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">We couldn&apos;t load your entries just now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Refresh this page in a moment. If you&apos;ve just paid, please don&apos;t pay a
              second time.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
```
What the page shows, most important first:
- **Paid**, from the order or from the sync: the redesigned receipt. It never says an email was sent. Sending is queued (Task 13), and parents can't read the queue, so at render time the page can't know whether the email has gone. When `emailIsConfigured` holds, it says one will follow. Until then confirmations wait unsent, so it says nothing about email. This fixes a known issue.
- **An open case on this order:** message A, with its reference and a link to My entries; or message B, with "Try again". A case outranks the order's status: an expired order with a late payment shows A, not "Your hold ran out".
- **Message C:** Stripe says the checkout is complete but confirmation isn't finished. The page checks again every 5 seconds. A case only the payments contacts see also shows C, but without the refresh, since nothing will change by itself. The sync answers `checking` for an unfinished confirmation, the same answer that sends a family here from Pay or Change entries, and the page shows it as this view.
- **Otherwise the order's own status:** the redesigned panels, with the same wording as before. `pending_payment` checks again every 5 seconds (it was 3; each check now also asks Stripe). Each refresh re-runs the sync, so the page catches up even if the webhook is slow.
- **A query that fails:** the "couldn't load" panel, rather than a guess, which could hide message A.

The page reads the user with `getSignedInUser()` (`docs/known-issues.md`). Don't add a `loading.tsx` for it: Next 16.2 then never hydrates the page in development.

- [ ] **Step 8: The dashboard shows payment cases and lets a started payment resume**

In `src/app/dashboard/page.tsx`:

(a) Replace:
```tsx
import { createClient } from '@/lib/supabase/server'
```
with:
```tsx
import { createClient, getSignedInUser } from '@/lib/supabase/server'
```

(b) Replace:
```tsx
import { isHouseholdComplete } from '@/lib/household'
```
with:
```tsx
import { isHouseholdComplete } from '@/lib/household'
import {
  openReviewsByOrder,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'
```

(c) Replace:
```tsx
    label: 'Cancelled'
  }
}
```
with:
```tsx
    label: 'Cancelled'
  }
}

// An open payment case says more than the order's status: what the family should do next
const REVIEW_STYLES: Record<PaymentReview['message_code'], { tag: string; label: string }> = {
  A: {
    tag: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]',
    label: 'Being checked'
  },
  B: {
    tag: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]',
    label: 'Payment didn’t go through'
  }
}

// The orders My entries lists, besides any with an open payment case
const LISTED_STATUSES: RegistrationStatus[] = ['paid', 'pending_payment', 'draft']
```

(d) Replace:
```tsx
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
```
with:
```tsx
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) redirect('/auth/login')
```

(e) Replace:
```tsx
  // Get dancers and registrations in parallel (both use household.id)
  const [{ data: dancers }, { data: registrations }] = await Promise.all([
```
with:
```tsx
  // Dancers, registrations and the family's view of any payment cases, in parallel
  const [{ data: dancers }, { data: registrations }, reviews] = await Promise.all([
```

(f) `main` filters the query to paid, pending and draft orders. That would hide an expired or cancelled order that has an open case, such as a late payment's message A. So the filter moves after the reviews load, and keeps those orders too. Replace:
```tsx
      .eq('household_id', household.id)
      // Released and expired holds never became entries
      .in('status', ['paid', 'pending_payment', 'draft'])
      .order('created_at', { ascending: false })
  ])

  // `unknown` first: the client types a to-one embed (feis_listings) as an array, but each registration has one feis
  const typedRegistrations = (registrations ?? []) as unknown as (Registration & {
    feis_listings: { name: string; feis_date: string; venue_name: string }
    registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
  })[]
```
with:
```tsx
      .eq('household_id', household.id)
      .order('created_at', { ascending: false }),
    supabase.rpc('get_my_payment_reviews', { p_registration_id: null })
  ])
  if (reviews.error) console.error('Payment reviews failed to load:', reviews.error)
  const openReviews = openReviewsByOrder((reviews.data ?? []) as PaymentReview[])

  // Released and expired holds never became entries, so they stay off the list, unless the order
  // has an open payment case: then it shows, so its message A or B reaches the family
  // `unknown` first: the client types a to-one embed (feis_listings) as an array, but each registration has one feis
  const typedRegistrations = (
    (registrations ?? []) as unknown as (Registration & {
      feis_listings: { name: string; feis_date: string; venue_name: string }
      registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
    })[]
  ).filter((reg) => LISTED_STATUSES.includes(reg.status) || openReviews.has(reg.id))
```

(g) Replace:
```tsx
      {typedDancers.length > 0 && hasRegistrations && (
```
with:
```tsx
      {reviews.error && (
        <p
          role="status"
          className="mb-6 max-w-3xl border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-2.5 text-sm text-[var(--color-feis-orange-ink)]"
        >
          We couldn&apos;t check for messages about your payments just now. Refresh the page to
          try again.
        </p>
      )}

      {typedDancers.length > 0 && hasRegistrations && (
```

(h) Replace:
```tsx
            const status = STATUS_STYLES[reg.status]
```
with:
```tsx
            const review = openReviews.get(reg.id)
            const status = review ? REVIEW_STYLES[review.message_code] : STATUS_STYLES[reg.status]
            // Message A says not to pay again, so nothing offers another payment beside it
            const canPayAgain = review?.message_code !== 'A'
            // Name the session only when there is one (never `session_id=null`); the success
            // page finds the family's order without it too
            const receiptHref = `/feiseanna/${reg.feis_listing_id}/register/success${
              reg.stripe_checkout_session_id ? `?session_id=${reg.stripe_checkout_session_id}` : ''
            }`
```

(i) Replace:
```tsx
                  {reg.confirmation_number && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Confirmation{' '}
                      <span className="feis-narrow text-lg text-foreground">
                        {reg.confirmation_number}
                      </span>
                    </p>
                  )}
                </div>
```
with:
```tsx
                  {reg.confirmation_number && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Confirmation{' '}
                      <span className="feis-narrow text-lg text-foreground">
                        {reg.confirmation_number}
                      </span>
                    </p>
                  )}
                  {review && (
                    <p
                      role="status"
                      className="mt-2 max-w-[62ch] border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-3 py-2 text-sm text-[var(--color-feis-orange-ink)]"
                    >
                      {reviewMessage(review.message_code, review.support_ref)}
                    </p>
                  )}
                </div>
```

(j) Replace:
```tsx
                  {reg.status === 'paid' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register/success?session_id=${reg.stripe_checkout_session_id}`}
                      className="feis-btn feis-btn-outline"
                    >
                      See receipt
                    </Link>
                  )}
                  {reg.status === 'draft' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register?step=3`}
                      className="feis-btn feis-btn-primary"
                    >
                      Finish and pay
                    </Link>
                  )}
                  {reg.status === 'expired' && (
```
with:
```tsx
                  {reg.status === 'paid' && (
                    <Link href={receiptHref} className="feis-btn feis-btn-outline">
                      See receipt
                    </Link>
                  )}
                  {(reg.status === 'draft' || reg.status === 'pending_payment') && canPayAgain && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register`}
                      className="feis-btn feis-btn-primary"
                    >
                      Finish and pay
                    </Link>
                  )}
                  {reg.status === 'expired' && canPayAgain && (
```

What this does:
- My entries keeps `main`'s rule, listing only paid, pending and draft orders, plus any order with an open payment case. An expired order whose late payment is being checked still shows its message A.
- Each order shows its open case's message, A or B, and its tag says "Being checked" or "Payment didn’t go through" instead of the order's status.
- A family who backed out of Stripe (`pending_payment`) gets "Finish and pay". It leads to the entry page, where "Return to payment" resumes the same checkout.
- The old wizard's `?step=3` is dropped; the entry page has no steps.
- "See receipt" no longer builds `?session_id=null` (this fixes a known issue).
- Nothing offers another payment beside message A.
- If the reviews can't be read, the page says so instead of silently showing no messages.

- [ ] **Step 9: Mark the two parent issues fixed**

In `docs/known-issues.md`, replace:
```markdown
## Parents
- **The after-payment page says a confirmation email was sent** even when email isn't set up (`RESEND_API_KEY` missing means the email is only logged).
- **The "See receipt" link on My entries** builds `?session_id=null` when a registration has no Stripe session, and the page then falls back to the latest registration for that feis.
```
with:
```markdown
## Parents
```

- [ ] **Step 10: Type-check, lint, test and build**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db && npm run build`
Expected: all pass. `npm run lint` reports no errors; the one warning, in `feis-wizard-step2.tsx`, was there before.

- [ ] **Step 11: Commit**

```bash
git add src/app/_payments/checkout-deps.ts src/lib/email/email-config.ts tests/email-config.test.ts src/lib/payment-review-messages.ts tests/payment-review-messages.test.ts 'src/app/feiseanna/[id]/register/actions.ts' 'src/app/feiseanna/[id]/register/success/page.tsx' src/components/registration/entry-page.tsx src/components/registration/family-receipt.tsx src/app/dashboard/page.tsx docs/known-issues.md
git commit -m "feat: Pay and Cancel use the claim workflow; success page confirms from Stripe and shows payment reviews"
```

---

### Task 13: Migration 016 and the notification queue (done)

**Files:**
- Create: `supabase/migrations/016_notification_delivery.sql`
- Create: `src/lib/engine/email-errors.ts`
- Create: `src/lib/email/templates.ts`
- Create: `src/app/_payments/notification-store.ts`
- Create: `src/app/_payments/email-sender.ts`
- Create: `src/app/_payments/notification-worker.ts`
- Create: `src/app/_payments/notification-deps.ts`
- Create: `src/app/api/notifications/process/route.ts`
- Modify: `src/app/api/webhooks/stripe/route.ts` (send right after a confirmation)
- Delete: `src/lib/email/send-confirmation.ts` (its tested `renderConfirmationEmail` moves into `templates.ts` first)
- Modify: `tests/email-confirmation.test.ts` (import from `templates.ts`)
- Create: `tests/db/helpers/fake-email.ts`
- Test: `tests/engine/email-errors.test.ts`, `tests/email-templates.test.ts`, `tests/db/notifications.test.ts`

**Interfaces:**
- Consumes:
  - the `notifications` table, plus the alert and confirmation rows queued by Task 9
  - `PurchaseSnapshot` (Task 4)
  - `formatCents` and `formatDate` (`src/lib/format.ts`)
  - main's confirmation email: `renderConfirmationEmail(data: ConfirmationEmailData): string`, with `ConfirmationEmailData` and `DancerBlock` (`src/lib/email/send-confirmation.ts`, tested by `tests/email-confirmation.test.ts`)
- Produces:
  - **SQL, internal:** `_queue_delivery_alert(uuid)`.
  - **SQL, service role:**
    - `claim_notifications(p_limit integer, p_now timestamptz) → jsonb`, an array of rows
    - `freeze_notification(p_id uuid, p_claim_token uuid, p_recipient text, p_payload jsonb) → jsonb`, which returns `{ recipient, payload }`, or null when the claim has gone stale
    - `complete_notification(p_id uuid, p_claim_token uuid, p_outcome text, p_provider_message_id text, p_error text, p_now timestamptz) → jsonb`
    - `get_notification_context(p_notification_id uuid) → jsonb`, which includes each of the order's dancers' competitor numbers (`numbers`)
  - **Classifier:** `classifyEmailError(error): 'rejected' | 'uncertain'`
  - **Templates:**
    - `renderConfirmationEmail(data: ConfirmationEmailData): string`, main's HTML, moved here unchanged except that it uses the shared `escapeHtml`
    - `confirmationEmail(ctx: ConfirmationEmailContext): EmailContent`, which fills main's email from the frozen purchase and the competitor numbers
    - `renderPaymentAlertEmail` and `renderDeliveryFailureAlertEmail`, each returning `EmailContent`
    - `escapeHtml`, which escapes all five HTML characters
  - **Queue:**
    - `createNotificationStore(rpc)`
    - `createResendSender(apiKey): EmailSender`
    - `processNotifications(deps: WorkerDeps, { limit }): Promise<{ paused; claimed; sent }>`
    - `notificationDeps()`

The family's confirmation keeps main's email: each dancer drawn as their number card with their competitor number, the competition codes and dances, what was paid and the confirmation number (subject `You're entered: <feis>`). The queue builds it with main's tested `renderConfirmationEmail()`. The only change is where the details come from: the frozen purchase and the competitor numbers, not the dancer's profile today.

- [ ] **Step 1: Write the failing pure tests**

Create `tests/engine/email-errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { classifyEmailError } from '@/lib/engine/email-errors'

describe('classifyEmailError', () => {
  it('treats a refusal as nothing sent', () => {
    expect(classifyEmailError({ statusCode: 422, name: 'validation_error' })).toBe('rejected')
    expect(classifyEmailError({ statusCode: 429, name: 'rate_limit_exceeded' })).toBe('rejected')
  })
  it('treats server errors, in-progress keys and unknowns as maybe sent', () => {
    expect(classifyEmailError({ statusCode: 500, name: 'application_error' })).toBe('uncertain')
    expect(classifyEmailError({ statusCode: 409, name: 'concurrent_idempotent_requests' })).toBe('uncertain')
    expect(classifyEmailError({ statusCode: null, name: 'application_error' })).toBe('uncertain')
    expect(classifyEmailError(null)).toBe('uncertain')
  })
})
```
Create `tests/email-templates.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { confirmationEmail, escapeHtml, renderPaymentAlertEmail } from '@/lib/email/templates'
import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

// The parts of a frozen purchase the confirmation reads, shaped as priceOrder freezes them
const purchase = {
  version: 1,
  dancers: [{ id: 'd1', first_name: 'Aoife <script>', last_name: "O'Brien & Co", school_name: null, tcrg_name: null,
    date_of_birth: '2018-05-01', gender: 'female', championship_status: 'none', dance_levels: {}, competition_age: 8 }],
  competitions: [{ id: 'c1', display_code: '210R', display_name: 'Novice Reel U10', age_group_key: 'U10',
    age_group_label: 'Under 10', age_min_jan1: null, age_max_jan1: 9, level_key: 'NOV', level_label: 'Novice',
    dance_key: 'reel', dance_label: 'Reel', competition_type: 'solo', championship_key: null, grades_only: false,
    fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false }],
  entries: [{ dancer_id: 'd1', competition_id: 'c1', fee_category: 'solo', base_fee_cents: 1500, late_fee_cents: 0, day_of_surcharge_cents: 0 }],
} as unknown as PurchaseSnapshot

const order = { confirmation_number: 'RF-2026-7KQ2M', total_cents: 4000 }
const listing = { name: 'Newport Feis', feis_date: '2027-03-14', venue_name: 'Hall', venue_address: null, contact_email: 'org@runfeis.test' }

describe('email templates', () => {
  it("fills main's confirmation from the frozen purchase: competitor number, code, dance and what was paid", () => {
    const email = confirmationEmail({
      order, listing, purchase, numbers: [{ dancer_id: 'd1', competitor_number: 214 }], baseUrl: 'https://runfeis.test',
    })
    expect(email.subject).toBe("You're entered: Newport Feis")
    expect(email.html).toContain('>214<')
    expect(email.html).toContain('>210R<')
    expect(email.html).toContain('>Reel<')
    expect(email.html).toContain('RF-2026-7KQ2M')
    expect(email.html).toContain('$40.00')
    expect(email.html).toContain('https://runfeis.test/dashboard')
  })

  it('shows a dash for a dancer whose number has not been assigned', () => {
    const email = confirmationEmail({ order, listing, purchase, numbers: [], baseUrl: 'https://runfeis.test' })
    expect(email.html).toContain('&ndash;')
  })

  it('escapes HTML in names in every email', () => {
    const email = confirmationEmail({
      order,
      listing: { name: 'Feis <b>One</b>', feis_date: null, venue_name: null, venue_address: null, contact_email: null },
      purchase,
      numbers: [],
      baseUrl: 'https://runfeis.test',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('Aoife &lt;script&gt; O&#39;Brien &amp; Co')
    expect(email.html).toContain('Feis &lt;b&gt;One&lt;/b&gt;')

    const alert = renderPaymentAlertEmail({
      exception: { support_ref: 'PAY-7KQ2M', severity: 'blocking', reason: 'amount_mismatch', amount_cents: 1, currency: 'usd',
        stripe_account_id: 'acct_1', stripe_checkout_session_id: 'cs_1', stripe_payment_intent_id: 'pi_1', created_at: '2026-11-01T12:00:00Z' },
      listing: { name: '<img src=x>' },
      family: { first_name: 'A&B', last_name: null, phone: null, email: 'p@runfeis.test' },
      order: { id: 'reg-1', status: 'pending_payment' },
    })
    expect(alert.subject).toBe('[RunFeis] Payment case PAY-7KQ2M: amount_mismatch')
    expect(alert.html).not.toContain('<img src=x>')
    expect(alert.html).toContain('A&amp;B')
  })

  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
```
Run: `npx vitest run tests/engine/email-errors.test.ts tests/email-templates.test.ts`
Expected: FAIL. The modules don't exist.

- [ ] **Step 2: Write the classifier and the templates**

Create `src/lib/engine/email-errors.ts`:
```ts
/**
 * How to treat a Resend error.
 * 'rejected': Resend refused it, so nothing was sent; a retry may use a new idempotency key.
 * 'uncertain': it may have been sent; retry only with the same key, inside Resend's 24-hour window.
 */
export function classifyEmailError(
  error: { statusCode?: number | null; name?: string } | null | undefined
): 'rejected' | 'uncertain' {
  const status = error?.statusCode ?? null
  if (status === null || status === 409 || status >= 500) return 'uncertain'
  return 'rejected'
}
```
Create `src/lib/email/templates.ts`:
```ts
import { formatCents, formatDate } from '@/lib/format'
import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

export interface EmailContent {
  subject: string
  html: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const text = (value: string | null | undefined) => escapeHtml(value ?? '')

// ─── The family's confirmation ───
// main's "You're entered" email, moved here from src/lib/email/send-confirmation.ts unchanged, except that
// it uses the shared escapeHtml above (which also escapes single quotes). tests/email-confirmation.test.ts
// keeps testing it.

export interface DancerBlock {
  name: string
  number: number | null
  competitions: { code: string | null; name: string }[]
}

/** One dancer drawn like their number card, with the competition codes beside it. */
function dancerBlock(d: DancerBlock): string {
  const codes = d.competitions
    .map(
      (c) => `
        <tr>
          <td style="padding:5px 0;border-top:1px solid #E2DCCD;font-size:15px;font-weight:bold;color:#17191B;width:72px;vertical-align:top;">${escapeHtml(c.code ?? '')}</td>
          <td style="padding:5px 0;border-top:1px solid #E2DCCD;font-size:14px;color:#3F4441;vertical-align:top;">${escapeHtml(c.name)}</td>
        </tr>`
    )
    .join('')

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:2px solid #17191B;background:#FFFFFF;">
      <tr>
        <td style="padding:16px 18px;width:120px;vertical-align:top;border-right:1px solid #E2DCCD;text-align:center;">
          <div style="font-size:11px;color:#615D55;">Competitor number</div>
          <div style="font-size:44px;line-height:1.05;font-weight:bold;color:#17191B;letter-spacing:-1px;">${d.number ?? '&ndash;'}</div>
        </td>
        <td style="padding:14px 18px;vertical-align:top;">
          <div style="font-size:17px;font-weight:bold;color:#17191B;margin-bottom:6px;">${escapeHtml(d.name)}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${codes}</table>
        </td>
      </tr>
    </table>`
}

export interface ConfirmationEmailData {
  feisName: string
  feisDate: string
  venue: string
  dancers: DancerBlock[]
  totalCents: number
  confirmationNumber: string | null
  contactEmail: string | null
  baseUrl: string
}

/** The "you're entered" email: each dancer's competitor number and dances, and what was paid. */
export function renderConfirmationEmail(data: ConfirmationEmailData): string {
  const {
    feisName,
    feisDate,
    venue,
    dancers,
    totalCents,
    confirmationNumber,
    contactEmail,
    baseUrl
  } = data
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>You're entered</title></head>
<body style="margin:0;padding:0;background-color:#FBF9F4;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your competitor numbers for ${escapeHtml(feisName)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF9F4;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr>
      <td style="background-color:#1F5538;padding:20px 28px 22px;border-bottom:6px double #C59D5F;">
        <div style="font-size:15px;font-weight:bold;font-style:italic;color:#FFFFFF;opacity:0.85;">RunFeis</div>
        <div style="font-size:28px;line-height:1.1;font-weight:bold;color:#FFFFFF;margin-top:10px;">You're entered</div>
        <div style="font-size:15px;color:#FFFFFF;opacity:0.85;margin-top:4px;">${escapeHtml(feisName)}, ${escapeHtml(feisDate)}${venue ? `, ${escapeHtml(venue)}` : ''}</div>
      </td>
    </tr>
    <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr>
      <td>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3F4441;">
          Here are your competitor numbers and dances. Keep this email; you'll need the numbers on the day.
        </p>
        ${dancers.map(dancerBlock).join('')}
      </td>
    </tr>
    <tr>
      <td style="background:#FFFFFF;border:2px solid #17191B;padding:16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:14px;color:#615D55;">Paid</td>
            <td style="font-size:22px;font-weight:bold;color:#17191B;text-align:right;">${formatCents(totalCents)}</td>
          </tr>
          <tr>
            <td style="font-size:14px;color:#615D55;padding-top:6px;">Confirmation</td>
            <td style="font-size:15px;font-weight:bold;color:#17191B;text-align:right;padding-top:6px;">${escapeHtml(confirmationNumber ?? '')}</td>
          </tr>
        </table>
      </td>
    </tr>
    ${
      baseUrl
        ? `<tr><td style="padding-top:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          <td style="background-color:#2F7A52;border-radius:3px;text-align:center;">
            <a href="${baseUrl}/dashboard" target="_blank" style="display:block;padding:14px 20px;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">See your entries</a>
          </td>
        </tr></table>
      </td></tr>`
        : ''
    }
    <tr>
      <td style="padding:20px 2px 0;font-size:13px;line-height:1.6;color:#615D55;">
        To add or drop a dance, contact the organiser${contactEmail ? ` at <a href="mailto:${escapeHtml(contactEmail)}" style="color:#2F7A52;">${escapeHtml(contactEmail)}</a>` : ''}. Entry fees aren't refundable.
      </td>
    </tr>
    <tr>
      <td style="padding:12px 2px 0;font-size:12px;color:#615D55;">RunFeis runs Irish dance feiseanna, from entries to results.</td>
    </tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

/** What the worker has for a confirmation (get_notification_context) */
export interface ConfirmationEmailContext {
  order: { confirmation_number: string | null; total_cents: number }
  listing: {
    name: string | null
    feis_date: string | null
    venue_name: string | null
    venue_address: string | null
    contact_email: string | null
  }
  purchase: PurchaseSnapshot | null
  /** Each of the order's dancers' competitor numbers at this feis */
  numbers: { dancer_id: string; competitor_number: number }[]
  baseUrl: string
}

/**
 * The confirmation for a paid order: main's email, filled from what the family bought (the frozen
 * purchase) and their competitor numbers, not from the dancer's profile today.
 */
export function confirmationEmail(ctx: ConfirmationEmailContext): EmailContent {
  const dancers = new Map((ctx.purchase?.dancers ?? []).map((d) => [d.id, d]))
  const competitions = new Map((ctx.purchase?.competitions ?? []).map((c) => [c.id, c]))
  const numbers = new Map(ctx.numbers.map((n) => [n.dancer_id, n.competitor_number]))

  // One block per dancer, in entry order, as main's sender built them
  const blocks = new Map<string, DancerBlock>()
  for (const entry of ctx.purchase?.entries ?? []) {
    const dancer = dancers.get(entry.dancer_id)
    const competition = competitions.get(entry.competition_id)
    const block = blocks.get(entry.dancer_id) ?? {
      name: dancer ? `${dancer.first_name} ${dancer.last_name}` : 'Dancer',
      number: numbers.get(entry.dancer_id) ?? null,
      competitions: []
    }
    block.competitions.push({
      code: competition?.display_code ?? null,
      // A solo shows its dance; anything else its full name
      name:
        competition?.competition_type === 'solo' && competition.dance_label
          ? competition.dance_label
          : (competition?.display_name ?? 'Competition')
    })
    blocks.set(entry.dancer_id, block)
  }

  const feisName = ctx.listing.name ?? 'your feis'
  return {
    subject: `You're entered: ${feisName}`,
    html: renderConfirmationEmail({
      feisName,
      feisDate: formatDate(ctx.listing.feis_date, { weekday: 'long', fallback: 'Date to be announced' }),
      venue: [ctx.listing.venue_name, ctx.listing.venue_address].filter(Boolean).join(', '),
      dancers: [...blocks.values()],
      totalCents: ctx.order.total_cents,
      confirmationNumber: ctx.order.confirmation_number,
      contactEmail: ctx.listing.contact_email,
      baseUrl: ctx.baseUrl
    })
  }
}

export interface PaymentAlertContext {
  exception: {
    support_ref: string
    severity: string
    reason: string
    amount_cents: number | null
    currency: string | null
    stripe_account_id: string | null
    stripe_checkout_session_id: string | null
    stripe_payment_intent_id: string | null
    created_at: string
  }
  listing: { name: string | null } | null
  family: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null
  order: { id: string; status: string } | null
}

function rows(pairs: [string, string | null | undefined][]): string {
  return pairs
    .map(([label, value]) => `<tr><td style="padding: 4px 12px 4px 0; color: #666;">${text(label)}</td><td>${text(value ?? '—')}</td></tr>`)
    .join('')
}

/** For the payments contacts: everything needed to find the payment in Stripe and follow the runbook */
export function renderPaymentAlertEmail(ctx: PaymentAlertContext): EmailContent {
  const e = ctx.exception
  const label = e.severity === 'notice' ? 'Payment notice' : 'Payment case'
  const family = ctx.family ? [ctx.family.first_name, ctx.family.last_name].filter(Boolean).join(' ') : null
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; padding: 20px;">
      <h2>${text(label)} ${text(e.support_ref)}: ${text(e.reason)}</h2>
      <table style="border-collapse: collapse;">
        ${rows([
          ['Feis', ctx.listing?.name],
          ['Family', family],
          ['Family email', ctx.family?.email],
          ['Family phone', ctx.family?.phone],
          ['Order', ctx.order ? `${ctx.order.id} (${ctx.order.status})` : null],
          ['Amount', e.amount_cents === null ? null : `${formatCents(e.amount_cents)} ${(e.currency ?? '').toUpperCase()}`],
          ['Stripe account', e.stripe_account_id],
          ['Checkout session', e.stripe_checkout_session_id],
          ['Payment intent', e.stripe_payment_intent_id],
          ['Recorded', e.created_at],
        ])}
      </table>
      <p>Follow docs/runbooks/payment-exceptions.md for "${text(e.reason)}".</p>
    </div>`
  return { subject: `[RunFeis] ${label} ${e.support_ref}: ${e.reason}`, html }
}

export interface DeliveryFailureContext {
  failed: { kind: string; dedupe_key: string; status: string; last_error: string | null; attempts: number }
  order: { id: string; status: string } | null
  family: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null
}

/** For the payments contacts: an email RunFeis could not deliver, or could not tell whether it delivered */
export function renderDeliveryFailureAlertEmail(ctx: DeliveryFailureContext): EmailContent {
  const f = ctx.failed
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; padding: 20px;">
      <h2>Email ${f.status === 'needs_check' ? 'needs checking' : 'not delivered'}: ${text(f.kind)}</h2>
      <table style="border-collapse: collapse;">
        ${rows([
          ['Notification', f.dedupe_key],
          ['Status', f.status],
          ['Attempts', String(f.attempts)],
          ['Last error', f.last_error],
          ['Order', ctx.order?.id],
          ['Family email', ctx.family?.email],
        ])}
      </table>
      <p>Check the Resend logs before resending by hand: docs/runbooks/payment-exceptions.md, "Emails".</p>
    </div>`
  return { subject: `[RunFeis] Email ${f.status === 'needs_check' ? 'needs checking' : 'not delivered'}: ${f.dedupe_key}`, html }
}
```
main's email tests now read the moved function. In `tests/email-confirmation.test.ts`, change the import to:
```ts
import { renderConfirmationEmail } from '@/lib/email/templates'
```
Run: `npx vitest run tests/engine/email-errors.test.ts tests/email-templates.test.ts tests/email-confirmation.test.ts`
Expected: PASS, with main's email tests unchanged apart from that import.

- [ ] **Step 3: Write the store, the sender, the worker and the fake email**

Create `src/app/_payments/notification-store.ts`:
```ts
import type { PaymentAlertContext, DeliveryFailureContext, ConfirmationEmailContext } from '@/lib/email/templates'
import type { RpcCaller } from './rpc'

export interface StoredEmail {
  from: string
  subject: string
  html: string
}

export interface NotificationRow {
  id: string
  kind: 'registration_confirmation' | 'payment_exception_alert' | 'delivery_failure_alert'
  dedupe_key: string
  registration_id: string | null
  recipient: string | null
  payload: StoredEmail | null
  status: string
  attempts: number
  send_generation: number
  claim_token: string
}

/** What get_notification_context returns */
export interface NotificationContext {
  kind: NotificationRow['kind']
  order: ({ id: string; status: string } & ConfirmationEmailContext['order']) | null
  listing: ConfirmationEmailContext['listing'] | null
  purchase: ConfirmationEmailContext['purchase']
  numbers: ConfirmationEmailContext['numbers']
  family: PaymentAlertContext['family']
  exception: PaymentAlertContext['exception'] | null
  failed_notification: DeliveryFailureContext['failed'] | null
}

export type CompleteOutcome = 'sent' | 'explicit_failure' | 'uncertain'
export type CompleteResult = 'sent' | 'retry_scheduled' | 'failed' | 'stale_claim'

export function createNotificationStore(rpc: RpcCaller) {
  return {
    async claim(limit: number, now: Date): Promise<NotificationRow[]> {
      return ((await rpc('claim_notifications', { p_limit: limit, p_now: now.toISOString() })) ?? []) as NotificationRow[]
    },

    async freeze(
      id: string,
      claimToken: string,
      recipient: string,
      payload: StoredEmail
    ): Promise<{ recipient: string; payload: StoredEmail } | null> {
      return (await rpc('freeze_notification', {
        p_id: id,
        p_claim_token: claimToken,
        p_recipient: recipient,
        p_payload: payload
      })) as { recipient: string; payload: StoredEmail } | null
    },

    async complete(input: {
      id: string
      claimToken: string
      outcome: CompleteOutcome
      providerMessageId: string | null
      error: string | null
      now: Date
    }): Promise<CompleteResult> {
      const result = (await rpc('complete_notification', {
        p_id: input.id,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome,
        p_provider_message_id: input.providerMessageId,
        p_error: input.error,
        p_now: input.now.toISOString()
      })) as { result: CompleteResult }
      return result.result
    },

    async context(id: string): Promise<NotificationContext | null> {
      return (await rpc('get_notification_context', { p_notification_id: id })) as NotificationContext | null
    }
  }
}

export type NotificationStore = ReturnType<typeof createNotificationStore>
```
Create `src/app/_payments/email-sender.ts`:
```ts
import { Resend } from 'resend'
import { classifyEmailError } from '@/lib/engine/email-errors'

export interface OutgoingEmail {
  from: string
  to: string[]
  subject: string
  html: string
}

export type SendOutcome =
  | { kind: 'accepted'; id: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'uncertain'; message: string }

export interface EmailSender {
  send(email: OutgoingEmail, idempotencyKey: string): Promise<SendOutcome>
}

export function createResendSender(apiKey: string): EmailSender {
  const resend = new Resend(apiKey)
  return {
    async send(email, idempotencyKey) {
      try {
        const { data, error } = await resend.emails.send(email, { idempotencyKey })
        if (error) {
          return classifyEmailError(error) === 'rejected'
            ? { kind: 'rejected', message: error.message }
            : { kind: 'uncertain', message: error.message }
        }
        return data?.id ? { kind: 'accepted', id: data.id } : { kind: 'uncertain', message: 'Resend returned no message id' }
      } catch (err) {
        return { kind: 'uncertain', message: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
```
Create `src/app/_payments/notification-worker.ts`:
```ts
import {
  confirmationEmail,
  renderDeliveryFailureAlertEmail,
  renderPaymentAlertEmail,
  type EmailContent
} from '@/lib/email/templates'
import type { EmailSender } from './email-sender'
import type { NotificationContext, NotificationRow, NotificationStore, StoredEmail } from './notification-store'

export interface WorkerConfig {
  from: string
  alertRecipients: string[]
  baseUrl: string
}

export interface WorkerDeps {
  store: NotificationStore
  sender: EmailSender | null
  /** null while email isn't configured: nothing is claimed and no attempts are used */
  config: WorkerConfig | null
  now: () => Date
  log: (line: string) => void
}

export interface WorkerResult {
  paused: boolean
  claimed: number
  sent: number
}

function render(row: NotificationRow, ctx: NotificationContext | null, config: WorkerConfig): EmailContent | null {
  if (!ctx) return null
  switch (row.kind) {
    case 'registration_confirmation':
      return ctx.order && ctx.listing
        ? confirmationEmail({
            order: ctx.order, listing: ctx.listing, purchase: ctx.purchase, numbers: ctx.numbers, baseUrl: config.baseUrl
          })
        : null
    case 'payment_exception_alert':
      return ctx.exception
        ? renderPaymentAlertEmail({ exception: ctx.exception, listing: ctx.listing, family: ctx.family, order: ctx.order })
        : null
    case 'delivery_failure_alert':
      return ctx.failed_notification
        ? renderDeliveryFailureAlertEmail({ failed: ctx.failed_notification, order: ctx.order, family: ctx.family })
        : null
  }
}

/** Sends due notifications (spec §12): at most once each within the provider's idempotency window. */
export async function processNotifications(deps: WorkerDeps, opts: { limit?: number } = {}): Promise<WorkerResult> {
  const config = deps.config
  const sender = deps.sender
  if (!config || !sender) {
    deps.log('[NOTIFICATIONS] email is paused: RESEND_API_KEY, EMAIL_FROM or PAYMENTS_ALERT_EMAIL is not set')
    return { paused: true, claimed: 0, sent: 0 }
  }
  const rows = await deps.store.claim(opts.limit ?? 20, deps.now())
  let sent = 0

  for (const row of rows) {
    let frozen: { recipient: string; payload: StoredEmail } | null =
      row.recipient && row.payload ? { recipient: row.recipient, payload: row.payload } : null

    if (!frozen) {
      // First attempt: render once, then freeze the recipient and message for every later attempt
      const content = render(row, await deps.store.context(row.id), config)
      const recipient = row.kind === 'registration_confirmation' ? row.recipient : config.alertRecipients.join(',')
      if (!content || !recipient) {
        await deps.store.complete({
          id: row.id, claimToken: row.claim_token, outcome: 'explicit_failure', providerMessageId: null,
          error: content ? 'no recipient' : 'nothing to render', now: deps.now()
        })
        continue
      }
      frozen = await deps.store.freeze(row.id, row.claim_token, recipient, {
        from: config.from, subject: content.subject, html: content.html
      })
      if (!frozen) {
        deps.log(`[NOTIFICATIONS] claim on ${row.id} went stale before sending`)
        continue
      }
    }

    const outcome = await sender.send(
      {
        from: frozen.payload.from,
        to: frozen.recipient.split(',').map((address) => address.trim()).filter(Boolean),
        subject: frozen.payload.subject,
        html: frozen.payload.html
      },
      `${row.dedupe_key}:${row.send_generation}`
    )
    const result = await deps.store.complete({
      id: row.id,
      claimToken: row.claim_token,
      outcome: outcome.kind === 'accepted' ? 'sent' : outcome.kind === 'rejected' ? 'explicit_failure' : 'uncertain',
      providerMessageId: outcome.kind === 'accepted' ? outcome.id : null,
      error: outcome.kind === 'accepted' ? null : outcome.message,
      now: deps.now()
    })
    if (outcome.kind === 'accepted') sent++
    if (result === 'stale_claim') deps.log(`[NOTIFICATIONS] ${row.id} was claimed again while sending; the newer claim stands`)
    if (result === 'failed') deps.log(`[NOTIFICATION_FAILED] ${row.kind} ${row.id}`)
  }

  return { paused: false, claimed: rows.length, sent }
}
```
Create `src/app/_payments/notification-deps.ts`:
```ts
import { createServiceClient } from '@/lib/supabase/service'
import { createResendSender } from './email-sender'
import { createNotificationStore } from './notification-store'
import type { WorkerDeps } from './notification-worker'
import { supabaseRpc } from './rpc'

/** Email only runs when Resend, the sender address and the payments contacts are all set */
export function notificationDeps(): WorkerDeps {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  const alertRecipients = (process.env.PAYMENTS_ALERT_EMAIL ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  const configured = Boolean(apiKey && from && alertRecipients.length > 0)

  return {
    store: createNotificationStore(supabaseRpc(createServiceClient())),
    sender: configured ? createResendSender(apiKey!) : null,
    config: configured
      ? { from: from!, alertRecipients, baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000' }
      : null,
    now: () => new Date(),
    log: (line) => console.log(line)
  }
}
```
Create `tests/db/helpers/fake-email.ts`:
```ts
import type { EmailSender, OutgoingEmail, SendOutcome } from '@/app/_payments/email-sender'

/** Behaves like Resend with idempotency keys: one delivery per key, whatever the replies said */
export class FakeEmail implements EmailSender {
  readonly delivered: { key: string; email: OutgoingEmail; id: string }[] = []
  /** Forced outcomes for the next sends */
  next: Array<'reject' | 'uncertain-before' | 'uncertain-after'> = []
  private readonly byKey = new Map<string, string>()

  async send(email: OutgoingEmail, key: string): Promise<SendOutcome> {
    const forced = this.next.shift()
    if (forced === 'reject') return { kind: 'rejected', message: 'validation_error' }
    if (forced === 'uncertain-before') return { kind: 'uncertain', message: 'timeout before Resend' }
    let id = this.byKey.get(key)
    if (!id) {
      id = `em_${this.byKey.size + 1}`
      this.byKey.set(key, id)
      this.delivered.push({ key, email, id })
    }
    if (forced === 'uncertain-after') return { kind: 'uncertain', message: 'timeout after Resend accepted it' }
    return { kind: 'accepted', id }
  }
}
```

- [ ] **Step 4: Write the failing queue tests**

Create `tests/db/notifications.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNotificationStore, type NotificationStore } from '@/app/_payments/notification-store'
import { processNotifications, type WorkerDeps } from '@/app/_payments/notification-worker'
import { createOrderStore } from '@/app/_payments/order-store'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { FakeEmail } from './helpers/fake-email'
import { createDraftOrder, readyToPay, type DraftOrderFixture } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let notifications: NotificationStore
let clock: Date

beforeEach(async () => {
  db = await createTestDatabase()
  notifications = createNotificationStore(pgRpc(db.pool))
  clock = new Date()
})

afterEach(async () => {
  await db?.drop()
})

const CONTACTS = ['daniel@runfeis.test', 'steve@runfeis.test']

function worker(email: FakeEmail, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    store: notifications,
    sender: email,
    config: { from: 'RunFeis <hello@runfeis.test>', alertRecipients: CONTACTS, baseUrl: 'https://runfeis.test' },
    now: () => clock,
    log: () => undefined,
    ...overrides,
  }
}

function advance(minutes: number) {
  clock = new Date(clock.getTime() + minutes * 60_000)
}

async function confirmedOrder(opts: { amountCents?: number } = {}): Promise<DraftOrderFixture> {
  const order = await createDraftOrder(db.pool)
  const ready = await readyToPay(db.pool, order)
  await createOrderStore(pgRpc(db.pool)).confirmOrderPayment({
    registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account,
    amountCents: opts.amountCents ?? order.payload.total_cents, currency: 'usd', paymentStatus: 'paid',
    paymentIntentId: `pi_${ready.sessionId}`, chargeId: null, eventId: 'evt_test', source: 'webhook',
  })
  // The queued rows are due "now" by the database clock; start the test clock just after that
  clock = new Date(Date.now() + 1_000)
  return order
}

async function row(kind: string) {
  const { rows } = await db.pool.query('SELECT * FROM notifications WHERE kind = $1 ORDER BY created_at LIMIT 1', [kind])
  return rows[0]
}

describe('the notification queue', () => {
  it('sends a queued confirmation once and saves the provider id', async () => {
    const order = await confirmedOrder()
    const email = new FakeEmail()
    expect(await processNotifications(worker(email))).toEqual({ paused: false, claimed: 1, sent: 1 })
    await processNotifications(worker(email))

    expect(email.delivered).toHaveLength(1)
    expect(email.delivered[0].key).toBe(`confirmation:${order.registrationId}:0`)
    expect(email.delivered[0].email.to).toEqual([order.family.email])
    expect(email.delivered[0].email.subject).toBe("You're entered: Test Feis")
    // main's email: the dancer's competitor number (the feis numbers from 101) and competition codes
    expect(email.delivered[0].email.html).toContain('>101<')
    expect(email.delivered[0].email.html).toContain('>210R<')
    expect(email.delivered[0].email.html).toContain('>210SJ<')
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent', provider_message_id: 'em_1', attempts: 1 })
  })

  it('freezes the recipient and message before the first send', async () => {
    const order = await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['reject']
    await processNotifications(worker(email))
    await db.pool.query(`UPDATE feis_listings SET name = 'Renamed Feis' WHERE id = $1`, [order.listing.listing.id])
    advance(6)
    await processNotifications(worker(email))

    expect(email.delivered).toHaveLength(1)
    expect(email.delivered[0].email.subject).toBe("You're entered: Test Feis")
    expect(email.delivered[0].key).toBe(`confirmation:${order.registrationId}:1`)
  })

  it('gives up after six refusals and alerts the payments contacts', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['reject', 'reject', 'reject', 'reject', 'reject', 'reject']
    for (let attempt = 0; attempt < 6; attempt++) {
      await processNotifications(worker(email))
      advance(13 * 60)
    }
    expect(await row('registration_confirmation')).toMatchObject({ status: 'failed', attempts: 6 })
    await processNotifications(worker(email))
    expect(email.delivered.map((d) => d.email.to)).toEqual([CONTACTS])
    expect(email.delivered[0].email.subject).toMatch(/^\[RunFeis\] Email not delivered: confirmation:/)
  })

  it('retries an uncertain send with the same key, so it is delivered once', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['uncertain-after']
    await processNotifications(worker(email))
    expect(await row('registration_confirmation')).toMatchObject({ status: 'pending', last_outcome: 'uncertain', send_generation: 0 })
    advance(6)
    await processNotifications(worker(email))
    expect(email.delivered).toHaveLength(1)
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent' })
  })

  it('recovers a send whose worker stopped after the provider accepted it', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    const [claimed] = await notifications.claim(10, clock)
    const frozen = await notifications.freeze(claimed.id, claimed.claim_token, claimed.recipient!, { from: 'x', subject: 's', html: 'h' })
    await email.send({ from: frozen!.payload.from, to: [frozen!.recipient], subject: 's', html: 'h' }, `${claimed.dedupe_key}:0`)
    // The worker stopped here, before complete_notification
    advance(11)
    await processNotifications(worker(email))
    expect(email.delivered).toHaveLength(1)
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent' })
  })

  it('holds an uncertain delivery for a person after 23 hours, and never sends it again', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['uncertain-before']
    await processNotifications(worker(email))
    advance(23 * 60 + 1)
    await processNotifications(worker(email))
    expect(await row('registration_confirmation')).toMatchObject({ status: 'needs_check' })
    expect(email.delivered.filter((d) => d.key.startsWith('confirmation:'))).toEqual([])
    expect(await row('delivery_failure_alert')).toBeDefined()
  })

  it('lets only the newest claim finish', async () => {
    await confirmedOrder()
    const [first] = await notifications.claim(10, clock)
    advance(11)
    const [second] = await notifications.claim(10, clock)
    expect(second.id).toBe(first.id)
    expect(await notifications.complete({ id: first.id, claimToken: first.claim_token, outcome: 'sent', providerMessageId: 'em_old', error: null, now: clock }))
      .toBe('stale_claim')
    expect(await notifications.complete({ id: second.id, claimToken: second.claim_token, outcome: 'sent', providerMessageId: 'em_new', error: null, now: clock }))
      .toBe('sent')
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent', provider_message_id: 'em_new' })
  })

  it('pauses without using attempts while email is not set up', async () => {
    await confirmedOrder()
    expect(await processNotifications(worker(new FakeEmail(), { config: null, sender: null })))
      .toEqual({ paused: true, claimed: 0, sent: 0 })
    expect(await row('registration_confirmation')).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('sends payment alerts to every payments contact', async () => {
    await confirmedOrder({ amountCents: 1 })
    const email = new FakeEmail()
    await processNotifications(worker(email))
    const alert = email.delivered.find((d) => d.key.startsWith('exception:'))
    expect(alert?.email.to).toEqual(CONTACTS)
    expect(alert?.email.subject).toMatch(/^\[RunFeis\] Payment case PAY-[A-Z2-9]{5}: amount_mismatch$/)
  })

  it('never raises an alert about an alert', async () => {
    await confirmedOrder({ amountCents: 1 })
    const email = new FakeEmail()
    email.next = Array(6).fill('reject')
    for (let attempt = 0; attempt < 6; attempt++) {
      await processNotifications(worker(email))
      advance(13 * 60)
    }
    expect(await row('payment_exception_alert')).toMatchObject({ status: 'failed' })
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'delivery_failure_alert'`)
    expect(rows[0].n).toBe(0)
  })

  it('never raises an alert about an alert that may not have been delivered', async () => {
    await confirmedOrder({ amountCents: 1 })
    const email = new FakeEmail()
    email.next = ['uncertain-before']
    await processNotifications(worker(email))
    advance(23 * 60 + 1)
    await processNotifications(worker(email))
    expect(await row('payment_exception_alert')).toMatchObject({ status: 'needs_check' })
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'delivery_failure_alert'`)
    expect(rows[0].n).toBe(0)
  })
})
```

- [ ] **Step 5: Run them to confirm they fail**

Run: `npm run test:db -- tests/db/notifications.test.ts`
Expected: FAIL with `function pre_registration.claim_notifications(...) does not exist`.

- [ ] **Step 6: Write migration 016**

Create `supabase/migrations/016_notification_delivery.sql`:
```sql
-- 016_notification_delivery.sql
-- Payment hardening, part 5: the email queue. Workers hold claim tokens, the recipient and message
-- are frozen before the first send, and an uncertain delivery is never retried outside the
-- provider's 24-hour idempotency window. Spec §12.

SET search_path TO pre_registration, public;

-- An alert that a notification couldn't be delivered. Alerts about alerts are only logged.
CREATE OR REPLACE FUNCTION _queue_delivery_alert(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_kind text;
  v_registration uuid;
BEGIN
  SELECT kind, registration_id INTO v_kind, v_registration FROM notifications WHERE id = p_notification_id;
  IF v_kind IN ('payment_exception_alert', 'delivery_failure_alert') THEN
    RAISE LOG '[NOTIFICATION_FAILED] alert % could not be delivered', p_notification_id;
    RETURN;
  END IF;
  INSERT INTO notifications (kind, dedupe_key, registration_id, related_notification_id)
  VALUES ('delivery_failure_alert', 'delivery_failed:' || p_notification_id, v_registration, p_notification_id)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION claim_notifications(p_limit integer, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_held uuid;
  v_claimed jsonb;
BEGIN
  -- Resend keeps idempotency keys for 24 hours. A delivery that may already have gone out, and
  -- is more than 23 hours old, waits for a person instead of risking a duplicate.
  FOR v_held IN
    UPDATE notifications
    SET status = 'needs_check', claim_token = NULL
    WHERE first_attempt_at <= p_now - interval '23 hours'
      AND ((status = 'pending' AND last_outcome = 'uncertain')
        OR (status = 'sending' AND claimed_at < p_now - interval '10 minutes'))
    RETURNING id
  LOOP
    PERFORM _queue_delivery_alert(v_held);
  END LOOP;

  WITH due AS (
    SELECT id FROM notifications
    WHERE (status = 'pending' AND next_attempt_at <= p_now)
       OR (status = 'sending' AND claimed_at < p_now - interval '10 minutes')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE notifications n
    SET status = 'sending',
        claim_token = gen_random_uuid(),
        claimed_at = p_now,
        first_attempt_at = coalesce(n.first_attempt_at, p_now)
    FROM due
    WHERE n.id = due.id
    RETURNING n.*
  )
  SELECT coalesce(jsonb_agg(to_jsonb(claimed) ORDER BY claimed.created_at), '[]'::jsonb)
  INTO v_claimed
  FROM claimed;

  RETURN v_claimed;
END;
$$;

-- Freezes the recipient and message on the first attempt; later attempts send exactly these
CREATE OR REPLACE FUNCTION freeze_notification(p_id uuid, p_claim_token uuid, p_recipient text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_frozen jsonb;
BEGIN
  UPDATE notifications
  SET recipient = coalesce(recipient, p_recipient),
      payload = coalesce(payload, p_payload)
  WHERE id = p_id AND claim_token = p_claim_token AND status = 'sending'
  RETURNING jsonb_build_object('recipient', recipient, 'payload', payload) INTO v_frozen;
  RETURN v_frozen;
END;
$$;

CREATE OR REPLACE FUNCTION complete_notification(p_id uuid, p_claim_token uuid, p_outcome text,
  p_provider_message_id text, p_error text, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_row notifications%ROWTYPE;
  v_backoff interval[] := ARRAY['5 minutes', '15 minutes', '1 hour', '3 hours', '6 hours', '12 hours']::interval[];
  v_attempts integer;
BEGIN
  -- Only the newest claim may finish: an older worker's token no longer matches
  SELECT * INTO v_row FROM notifications
  WHERE id = p_id AND claim_token = p_claim_token AND status = 'sending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'stale_claim');
  END IF;
  v_attempts := v_row.attempts + 1;

  IF p_outcome = 'sent' THEN
    UPDATE notifications
    SET status = 'sent', last_outcome = 'sent', attempts = v_attempts, provider_message_id = p_provider_message_id,
        sent_at = p_now, claim_token = NULL, last_error = NULL
    WHERE id = p_id;
    RETURN jsonb_build_object('result', 'sent');
  END IF;

  IF p_outcome = 'explicit_failure' THEN
    IF v_attempts >= array_length(v_backoff, 1) THEN
      UPDATE notifications
      SET status = 'failed', last_outcome = 'explicit_failure', attempts = v_attempts, last_error = p_error,
          claim_token = NULL
      WHERE id = p_id;
      PERFORM _queue_delivery_alert(p_id);
      RETURN jsonb_build_object('result', 'failed');
    END IF;
    -- Nothing was sent, so the next try may use a new provider key
    UPDATE notifications
    SET status = 'pending', last_outcome = 'explicit_failure', attempts = v_attempts,
        send_generation = send_generation + 1, last_error = p_error, claim_token = NULL,
        next_attempt_at = p_now + v_backoff[v_attempts]
    WHERE id = p_id;
    RETURN jsonb_build_object('result', 'retry_scheduled');
  END IF;

  IF p_outcome = 'uncertain' THEN
    -- It may have gone out: retry with the same provider key so the provider deduplicates it
    UPDATE notifications
    SET status = 'pending', last_outcome = 'uncertain', attempts = v_attempts, last_error = p_error,
        claim_token = NULL, next_attempt_at = p_now + v_backoff[least(v_attempts, array_length(v_backoff, 1))]
    WHERE id = p_id;
    RETURN jsonb_build_object('result', 'retry_scheduled');
  END IF;

  RAISE EXCEPTION 'unknown notification outcome %', p_outcome;
END;
$$;

-- Everything the worker needs to render a notification
CREATE OR REPLACE FUNCTION get_notification_context(p_notification_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
  SELECT jsonb_build_object(
    'kind', n.kind,
    'order', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'confirmation_number', r.confirmation_number, 'total_cents', r.total_cents) END,
    'listing', CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', l.name, 'feis_date', l.feis_date, 'venue_name', l.venue_name, 'venue_address', l.venue_address,
      'contact_email', l.contact_email) END,
    'purchase', s.snapshot_data -> 'purchase',
    -- The competitor numbers of the order's dancers at this feis (a dancer keeps one number per feis), for
    -- the confirmation; numbers are assigned in the same transaction as the payment, before it is queued
    'numbers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('dancer_id', cn.dancer_id, 'competitor_number', cn.competitor_number)
                       ORDER BY cn.competitor_number)
      FROM competitor_numbers cn
      WHERE cn.feis_listing_id = r.feis_listing_id
        AND cn.dancer_id IN (SELECT re.dancer_id FROM registration_entries re WHERE re.registration_id = r.id)
    ), '[]'::jsonb),
    'family', CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object(
      'first_name', h.first_name, 'last_name', h.last_name, 'phone', h.phone, 'email', u.email) END,
    'exception', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
      'support_ref', e.support_ref, 'severity', e.severity, 'reason', e.reason, 'amount_cents', e.amount_cents,
      'currency', e.currency, 'stripe_account_id', e.stripe_account_id,
      'stripe_checkout_session_id', e.stripe_checkout_session_id,
      'stripe_payment_intent_id', e.stripe_payment_intent_id, 'created_at', e.created_at) END,
    'failed_notification', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object(
      'kind', f.kind, 'dedupe_key', f.dedupe_key, 'status', f.status, 'last_error', f.last_error,
      'attempts', f.attempts) END
  )
  FROM notifications n
  LEFT JOIN payment_exceptions e ON e.id = n.exception_id
  LEFT JOIN registrations r ON r.id = coalesce(n.registration_id, e.registration_id)
  LEFT JOIN feis_listings l ON l.id = coalesce(r.feis_listing_id, e.feis_listing_id)
  LEFT JOIN registration_snapshots s ON s.registration_id = r.id
  LEFT JOIN households h ON h.id = coalesce(r.household_id, e.household_id)
  LEFT JOIN auth.users u ON u.id = h.user_id
  LEFT JOIN notifications f ON f.id = n.related_notification_id
  WHERE n.id = p_notification_id
$$;

REVOKE ALL ON FUNCTION _queue_delivery_alert(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION claim_notifications(integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION freeze_notification(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_notification(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_notification_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_notifications(integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION freeze_notification(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION complete_notification(uuid, uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION get_notification_context(uuid) TO service_role;
```

- [ ] **Step 7: Run the queue tests**

Run: `npm run test:db -- tests/db/notifications.test.ts`
Expected: PASS.

- [ ] **Step 8: Add the scheduled route, send right after confirmation, and retire the old sender**

Create `src/app/api/notifications/process/route.ts`:
```ts
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { notificationDeps } from '@/app/_payments/notification-deps'
import { processNotifications } from '@/app/_payments/notification-worker'

function authorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// Called every 5 minutes by pg_cron through pg_net (docs/runbooks/payment-exceptions.md, "Emails")
export async function POST(request: Request) {
  if (!authorised(request.headers.get('authorization'), process.env.NOTIFICATIONS_CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await processNotifications(notificationDeps(), { limit: 20 })
  return NextResponse.json(result)
}
```
In `src/app/api/webhooks/stripe/route.ts`, change the first import to:
```ts
import { after, NextResponse } from 'next/server'
```
Then add these imports:
```ts
import { notificationDeps } from '@/app/_payments/notification-deps'
import { processNotifications } from '@/app/_payments/notification-worker'
```
Replace the final `return NextResponse.json(outcome.body, { status: outcome.status })` with:
```ts
  if (outcome.status === 200 && outcome.registrationId) {
    // Send the confirmation or alert straight away; the 5-minute job retries anything that fails
    after(() =>
      processNotifications(notificationDeps(), { limit: 5 }).catch((err) =>
        console.error('[NOTIFICATIONS] immediate send failed:', err)
      )
    )
  }
  return NextResponse.json(outcome.body, { status: outcome.status })
```
Delete the old sender (its email now lives in `templates.ts`), and check that nothing still refers to it:
```bash
git rm src/lib/email/send-confirmation.ts
grep -rn "send-confirmation\|sendConfirmationEmail" src tests || echo "no references left"
```
Expected: `no references left`.

- [ ] **Step 9: Run everything and build**

Run: `npm test && npm run test:db && npm run build`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/016_notification_delivery.sql src/lib/engine/email-errors.ts src/lib/email/templates.ts src/app/_payments/notification-store.ts src/app/_payments/email-sender.ts src/app/_payments/notification-worker.ts src/app/_payments/notification-deps.ts src/app/api/notifications/process/route.ts src/app/api/webhooks/stripe/route.ts tests/db/helpers/fake-email.ts tests/engine/email-errors.test.ts tests/email-templates.test.ts tests/email-confirmation.test.ts tests/db/notifications.test.ts
git commit -m "feat: email queue with frozen messages, claim tokens and provider idempotency (migration 016)"
```

---

### Task 14: Migration 017, resolving cases safely (admin only) (done)

**Files:**
- Create: `supabase/migrations/017_payments_admin.sql`
- Test: `tests/db/payments-admin.test.ts`

**Interfaces:**
- Consumes:
  - `lock_household_feis` (Task 6)
  - `_fulfil_order` and `payment_exceptions` (Task 9)
  - the fixtures `createDraftOrder`, `readyToPay`, `buildPayload` and `checkoutConfigFor`
- Produces:
  - **Table:** `admin_actions`
  - **Schema:** `payments_admin`, with no access for `anon`, `authenticated` or `service_role`
  - **Functions:**
    - `payments_admin.confirm_late_payment(p_support_ref text, p_note text) → jsonb`
    - `payments_admin.close_exception(p_support_ref text, p_resolution text, p_stripe_refund_id text, p_note text) → jsonb`

**Notes:**
- `confirm_late_payment` fulfils the order through `_fulfil_order` (Task 9), so it meets migration 012 the same way a webhook confirmation does. One UPDATE moves the order from `expired` to `paid` with its claim, session, `paid_at` and confirmation number, and the snapshot is written in that same transaction. The function checks the order's claim and session against the case before it gets there.
- `paid_at` is therefore the time of the confirmation, not the time Stripe took the money, and competitor numbers are assigned at that moment. Numbers go out in `paid_at` order, so a late payment confirmed by hand gets numbers after every family confirmed before it. When Stripe took the money is in the case row (`created_at`, the payment intent) and the audit row's evidence.

- [ ] **Step 1: Write the failing tests**

Create `tests/db/payments-admin.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore, type ConfirmPaymentInput, type OrderStore } from '@/app/_payments/order-store'
import { asParent, asRole, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { buildPayload, createDraftOrder, readyToPay, type DraftOrderFixture } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: OrderStore

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

type Ready = Awaited<ReturnType<typeof readyToPay>>

function payment(order: DraftOrderFixture, ready: Ready, overrides: Partial<ConfirmPaymentInput> = {}): ConfirmPaymentInput {
  return {
    registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account,
    amountCents: order.payload.total_cents, currency: 'usd', paymentStatus: 'paid', paymentIntentId: `pi_${ready.sessionId}`,
    chargeId: null, eventId: `evt_${randomUUID()}`, source: 'webhook', ...overrides,
  }
}

/** A late payment on an expired order, after the family started a newer one */
async function lateConflict(newer: 'unclaimed' | 'claimed' | 'paid' = 'unclaimed') {
  const order = await createDraftOrder(db.pool)
  const ready = await readyToPay(db.pool, order)
  await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })

  const payload = buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries })
  const created = await store.createOrder(order.family.householdId, order.listing.listing.id, payload)
  if (created.status !== 'created') throw new Error('expected a newer order')
  const newerOrder: DraftOrderFixture = { ...order, payload, registrationId: created.registration_id }
  if (newer !== 'unclaimed') {
    const newerReady = await readyToPay(db.pool, newerOrder)
    if (newer === 'paid') await store.confirmOrderPayment(payment(newerOrder, newerReady))
  }

  const result = await store.confirmOrderPayment(payment(order, ready))
  if (result.result !== 'exception') throw new Error('expected a late-payment case')
  return { order, newerId: created.registration_id, supportRef: result.support_ref }
}

async function statusOf(id: string) {
  const { rows } = await db.pool.query('SELECT status FROM registrations WHERE id = $1', [id])
  return rows[0].status
}

const confirmLate = (ref: string, note = 'Family paid late; spoke to them by phone') =>
  db.pool.query('SELECT payments_admin.confirm_late_payment($1, $2) AS result', [ref, note])

describe('payments_admin.confirm_late_payment', () => {
  it('confirms the late payment, cancels the newer unpaid order, resolves the case and keeps an audit row', async () => {
    const { order, newerId, supportRef } = await lateConflict()
    const { rows } = await confirmLate(supportRef)
    expect(rows[0].result).toMatchObject({ result: 'confirmed', cancelled_orders: [newerId] })
    expect(await statusOf(order.registrationId)).toBe('paid')
    expect(await statusOf(newerId)).toBe('cancelled')

    const { rows: [caseRow] } = await db.pool.query('SELECT status, resolution, resolved_by FROM payment_exceptions WHERE support_ref = $1', [supportRef])
    expect(caseRow).toMatchObject({ status: 'resolved', resolution: 'confirmed_late_payment', resolved_by: 'postgres' })
    const { rows: [audit] } = await db.pool.query('SELECT action, note, evidence FROM admin_actions WHERE support_ref = $1', [supportRef])
    expect(audit).toMatchObject({ action: 'confirm_late_payment', note: 'Family paid late; spoke to them by phone' })
    expect(audit.evidence.cancelled_orders).toEqual([newerId])

    // paid_at is when the case was confirmed, after it was recorded, and the numbers were assigned then
    const { rows: [timing] } = await db.pool.query(
      `SELECT r.paid_at > e.created_at AS paid_at_is_confirmation,
              (SELECT count(*)::int FROM competitor_numbers c WHERE c.registration_id = r.id) AS numbers
       FROM registrations r JOIN payment_exceptions e ON e.registration_id = r.id
       WHERE e.support_ref = $1`, [supportRef])
    expect(timing).toEqual({ paid_at_is_confirmation: true, numbers: 1 })
  })

  it('refuses when another order was taken to checkout, even once that checkout has expired', async () => {
    const { supportRef, newerId } = await lateConflict('claimed')
    expect(await refused(confirmLate(supportRef))).toMatch(/was taken to checkout/)

    // The newer order's checkout runs out, but a delayed payment for it could still arrive
    const { rows: [newer] } = await db.pool.query(
      'SELECT checkout_claim_id, stripe_checkout_session_id, checkout_config FROM registrations WHERE id = $1', [newerId])
    await store.expireCheckout({
      registrationId: newerId, claimId: newer.checkout_claim_id, sessionId: newer.stripe_checkout_session_id,
      account: newer.checkout_config.account,
    })
    expect(await refused(confirmLate(supportRef))).toMatch(/was taken to checkout/)
  })

  it('refuses when the family paid twice; that case is closed with a refund', async () => {
    const { supportRef } = await lateConflict('paid')
    expect(await refused(confirmLate(supportRef))).toMatch(/refund one payment instead/)
  })

  it('refuses when the recorded payment does not match the order', async () => {
    const { supportRef } = await lateConflict()
    await db.pool.query('UPDATE payment_exceptions SET amount_cents = 1 WHERE support_ref = $1', [supportRef])
    expect(await refused(confirmLate(supportRef))).toMatch(/does not match/)
  })

  it('only confirms late-payment cases, and needs a note', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const wrong = await store.confirmOrderPayment(payment(order, ready, { amountCents: 1 }))
    if (wrong.result !== 'exception') throw new Error('expected a case')
    expect(await refused(confirmLate(wrong.support_ref))).toMatch(/resolved by a refund/)

    const { supportRef } = await lateConflict()
    expect(await refused(confirmLate(supportRef, '  '))).toMatch(/note/)
  })
})

describe('payments_admin.close_exception', () => {
  it('allows only the closings each reason permits, and records them', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const wrong = await store.confirmOrderPayment(payment(order, ready, { amountCents: 1 }))
    if (wrong.result !== 'exception') throw new Error('expected a case')
    const close = (resolution: string, refund: string | null) =>
      db.pool.query('SELECT payments_admin.close_exception($1, $2, $3, $4) AS result',
        [wrong.support_ref, resolution, refund, 'Refunded in Stripe after checking'])

    expect(await refused(close('refunded', null))).toMatch(/refund ID/)
    expect(await refused(close('no_action', null))).toMatch(/only failed payments/)
    expect((await close('refunded', 're_3QabcDEF')).rows[0].result).toEqual({ result: 'resolved', resolution: 'refunded' })
    expect(await refused(close('refunded', 're_3QabcDEF'))).toMatch(/already resolved/)

    const { rows } = await db.pool.query(`SELECT evidence FROM admin_actions WHERE support_ref = $1`, [wrong.support_ref])
    expect(rows[0].evidence).toEqual({ resolution: 'refunded', stripe_refund_id: 're_3QabcDEF' })
  })
})

describe('who can reach the admin functions', () => {
  it('refuses parents, anon and the service role', async () => {
    const { family } = await createDraftOrder(db.pool)
    const sql = `SELECT payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'x')`
    expect(await refused(asParent(db.pool, family.userId, (c) => c.query(sql)))).toMatch(/permission denied for schema payments_admin/)
    expect(await refused(asRole(db.pool, 'anon', null, (c) => c.query(sql)))).toMatch(/permission denied for schema payments_admin/)
    expect(await refused(asService(db.pool, (c) => c.query(sql)))).toMatch(/permission denied for schema payments_admin/)
  })
})
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npm run test:db -- tests/db/payments-admin.test.ts`
Expected: FAIL with `schema "payments_admin" does not exist`.

- [ ] **Step 3: Write migration 017**

Create `supabase/migrations/017_payments_admin.sql`:
```sql
-- 017_payments_admin.sql
-- Payment hardening, part 6: how a person resolves a payment case. There is no generic "mark paid":
-- each reason has its allowed resolutions, every action needs a note and leaves an audit row, and
-- these functions live in a schema the API can't reach. Run them from the SQL editor. Spec §11.

SET search_path TO pre_registration, public;

CREATE TABLE IF NOT EXISTS admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  support_ref text,
  registration_id uuid REFERENCES registrations(id),
  actor text NOT NULL DEFAULT session_user,
  note text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
-- PUBLIC as well, as in 012: whatever PUBLIC holds, every role holds
REVOKE ALL ON admin_actions FROM PUBLIC, anon, authenticated;

CREATE SCHEMA IF NOT EXISTS payments_admin;
REVOKE ALL ON SCHEMA payments_admin FROM PUBLIC;
REVOKE ALL ON SCHEMA payments_admin FROM anon, authenticated, service_role;

-- A late payment that conflicts with a newer order: confirm it only if the recorded payment passes
-- every confirmation check, no other order for the family and feis can have a payment on the way,
-- and the payment isn't already on another order. Cancels the newer unpaid order and fulfils the late
-- one, atomically, and closes the case as confirmed_late_payment in the same transaction.
CREATE OR REPLACE FUNCTION payments_admin.confirm_late_payment(p_support_ref text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_household uuid;
  v_listing uuid;
  v_case payment_exceptions%ROWTYPE;
  v_order registrations%ROWTYPE;
  v_other registrations%ROWTYPE;
  v_cancelled uuid[] := '{}';
  v_number text;
BEGIN
  IF coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'a note explaining the decision is required';
  END IF;

  SELECT household_id, feis_listing_id INTO v_household, v_listing
  FROM payment_exceptions WHERE support_ref = p_support_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no payment case %', p_support_ref;
  END IF;
  PERFORM lock_household_feis(v_household, v_listing);

  SELECT * INTO v_case FROM payment_exceptions WHERE support_ref = p_support_ref FOR UPDATE;
  IF v_case.status <> 'open' THEN
    RAISE EXCEPTION 'case % is already resolved', p_support_ref;
  END IF;
  IF v_case.reason <> 'late_payment_conflict' THEN
    RAISE EXCEPTION 'case % is %, which is resolved by a refund, not a confirmation', p_support_ref, v_case.reason;
  END IF;

  SELECT * INTO v_order FROM registrations WHERE id = v_case.registration_id FOR UPDATE;
  IF v_order.status <> 'expired' THEN
    RAISE EXCEPTION 'order % is %, not expired', v_order.id, v_order.status;
  END IF;
  IF v_order.checkout_claim_id IS DISTINCT FROM v_case.claim_id
     OR v_order.checkout_config ->> 'account' IS DISTINCT FROM v_case.stripe_account_id
     OR (v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM v_case.stripe_checkout_session_id)
     OR v_case.currency IS DISTINCT FROM v_order.checkout_config ->> 'currency'
     OR v_case.amount_cents IS DISTINCT FROM v_order.total_cents
     OR v_case.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'the recorded payment does not match order %', v_order.id;
  END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE stripe_payment_intent_id = v_case.stripe_payment_intent_id) THEN
    RAISE EXCEPTION 'payment % is already recorded on an order', v_case.stripe_payment_intent_id;
  END IF;

  -- Another order may only be replaced when no payment for it can exist. An order that never had a
  -- checkout claim can't have been paid; one cancelled through Cancel had its checkout settled first.
  -- Anything else that reached checkout, even if it has since expired, could still have a delayed
  -- payment on the way, so the case is resolved by refund instead (spec §11).
  FOR v_other IN
    SELECT * FROM registrations
    WHERE household_id = v_order.household_id AND feis_listing_id = v_order.feis_listing_id
      AND id <> v_order.id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_other.status = 'paid' THEN
      RAISE EXCEPTION 'the family also paid order %; refund one payment instead', v_other.id;
    END IF;
    IF v_other.checkout_claim_id IS NOT NULL AND v_other.status <> 'cancelled' THEN
      RAISE EXCEPTION 'order % was taken to checkout, so a payment for it may still arrive; refund the late payment instead',
        v_other.id;
    END IF;
    IF v_other.status = 'draft' THEN
      UPDATE registrations SET status = 'cancelled' WHERE id = v_other.id;
      v_cancelled := v_cancelled || v_other.id;
    END IF;
  END LOOP;

  v_number := _fulfil_order(v_order.id, v_case.stripe_checkout_session_id, v_case.stripe_payment_intent_id,
    NULL, v_case.amount_cents, v_case.currency);

  UPDATE payment_exceptions
  SET status = 'resolved', resolution = 'confirmed_late_payment', resolved_at = now(), resolved_by = session_user
  WHERE id = v_case.id;

  INSERT INTO admin_actions (action, support_ref, registration_id, note, evidence)
  VALUES ('confirm_late_payment', p_support_ref, v_order.id, p_note, jsonb_build_object(
    'payment_intent_id', v_case.stripe_payment_intent_id,
    'checkout_session_id', v_case.stripe_checkout_session_id,
    'amount_cents', v_case.amount_cents,
    'cancelled_orders', to_jsonb(v_cancelled),
    'confirmation_number', v_number));

  RETURN jsonb_build_object('result', 'confirmed', 'confirmation_number', v_number,
    'cancelled_orders', to_jsonb(v_cancelled));
END;
$$;

-- Closes a case without confirming anything. Which closings are allowed depends on the reason.
CREATE OR REPLACE FUNCTION payments_admin.close_exception(p_support_ref text, p_resolution text,
  p_stripe_refund_id text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_case payment_exceptions%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'a note explaining the decision is required';
  END IF;

  SELECT * INTO v_case FROM payment_exceptions WHERE support_ref = p_support_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no payment case %', p_support_ref;
  END IF;
  IF v_case.status <> 'open' THEN
    RAISE EXCEPTION 'case % is already resolved', p_support_ref;
  END IF;

  IF p_resolution = 'refunded' THEN
    IF v_case.reason NOT IN ('amount_mismatch', 'currency_mismatch', 'order_not_payable', 'payment_reused',
                             'account_mismatch', 'claim_mismatch', 'session_mismatch', 'order_not_found',
                             'late_payment_conflict') THEN
      RAISE EXCEPTION '% cases are not closed by a refund', v_case.reason;
    END IF;
    IF p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_[A-Za-z0-9]+$' THEN
      RAISE EXCEPTION 'a Stripe refund ID (re_...) is required';
    END IF;
  ELSIF p_resolution = 'no_action' THEN
    -- A failed payment moved no money. A reused payment is the recorded payment of another, confirmed order:
    -- refunding it would refund that order, so unless Stripe shows a genuine second charge there is nothing to refund
    IF v_case.reason NOT IN ('payment_failed', 'payment_reused') THEN
      RAISE EXCEPTION 'only failed payments, and payments already recorded on another order, close with no action';
    END IF;
  ELSIF p_resolution = 'acknowledged' THEN
    IF v_case.reason <> 'listing_account_changed' THEN
      RAISE EXCEPTION 'only account-change notices are acknowledged';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown resolution %', p_resolution;
  END IF;

  UPDATE payment_exceptions
  SET status = 'resolved', resolution = p_resolution, resolved_at = now(), resolved_by = session_user,
      details = details || jsonb_build_object('stripe_refund_id', p_stripe_refund_id)
  WHERE id = v_case.id;

  INSERT INTO admin_actions (action, support_ref, registration_id, note, evidence)
  VALUES ('close_exception', p_support_ref, v_case.registration_id, p_note,
    jsonb_build_object('resolution', p_resolution, 'stripe_refund_id', p_stripe_refund_id));

  RETURN jsonb_build_object('result', 'resolved', 'resolution', p_resolution);
END;
$$;

REVOKE ALL ON FUNCTION payments_admin.confirm_late_payment(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments_admin.close_exception(text, text, text, text) FROM PUBLIC;
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/017_payments_admin.sql tests/db/payments-admin.test.ts
git commit -m "feat: per-reason case resolutions in a schema the API can't reach (migration 017)"
```

---

### Task 15: The payment-cases runbook and the project rules (done)

**Files:**
- Create: `docs/runbooks/payment-exceptions.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: migration 012's guard triggers (Task 3), and the functions and tables from Tasks 9, 13 and 14.
- Produces: the runbook that alert emails point to, and project rules that match the new payment code.

- [ ] **Step 1: Write the runbook**

> **Superseded:** this is the plan's first draft. The runbook as built, reviewed and checked against the migrations is `docs/runbooks/payment-exceptions.md`. Use that file, not this draft.

Create `docs/runbooks/payment-exceptions.md`:
````markdown
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
| `late_payment_conflict` | The family paid after their order expired, and they have a newer order for the same feis. | Ring or email the family. If they want the paid order and the newer order never reached checkout, confirm it (3a). Otherwise refund one payment (3b). |
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

**3a. Confirm a late payment** (only `late_payment_conflict`). This cancels the family's newer unpaid order, then
confirms the paid one: confirmation number, snapshot, competitor numbers and confirmation email. The order's
`paid_at` becomes the time of this confirmation, so its competitor numbers come after every family confirmed
before now. It refuses if any other order for the family and feis is paid, or reached checkout and isn't
cancelled: a delayed payment for it could still arrive. Refund instead (3b).
```sql
SELECT payments_admin.confirm_late_payment('PAY-XXXXX', 'Rang the family; they want the paid order');
```

**3b. Refund.** Refund the payment in Stripe (on the connected account), copy the refund ID (`re_…`), then:
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'refunded', 're_...', 'Refunded the 3 Nov charge after checking');
```

**3c. A failed payment:**
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'Bank payment failed; nothing charged');
```

**3d. Acknowledge an account change:**
```sql
SELECT payments_admin.close_exception('PAY-XXXXX', 'acknowledged', NULL, 'Organiser reconnected Stripe on 2 Nov');
```

## 4. Emails

`pre_registration.notifications` holds every confirmation and alert.

| Status | Meaning |
|---|---|
| `pending` | Waiting for its next attempt (or for email to be set up). |
| `sending` | A worker is sending it. If it's been more than 10 minutes, the worker stopped and it will be retried. |
| `sent` | Accepted by Resend (`provider_message_id`). |
| `failed` | Resend refused it 6 times. An alert was sent, unless it was itself an alert. |
| `needs_check` | It may have gone out, but we couldn't confirm it within Resend's 24-hour deduplication window. Never resent automatically. |

For `needs_check` or `failed`: search the Resend dashboard (Emails) for the recipient around `first_attempt_at`.
If it was delivered, leave it. If it wasn't, resend it with a new provider key:
```sql
UPDATE pre_registration.notifications
SET status = 'pending', last_outcome = NULL, send_generation = send_generation + 1,
    first_attempt_at = NULL, attempts = 0, next_attempt_at = now(), claim_token = NULL
WHERE dedupe_key = 'confirmation:<order id>';
```

## 5. Setting up an environment

Environment variables on Vercel:
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMENTS_ALERT_EMAIL` (comma-separated)
- `NOTIFICATIONS_CRON_SECRET` (`openssl rand -hex 32`)
- `RESEND_API_KEY` and `EMAIL_FROM`
- `STRIPE_SECRET_KEY` and `STRIPE_CONNECT_WEBHOOK_SECRET`

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
    )
  )
$$);
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
Don't `TRUNCATE` these tables, even as the owner: the `TRUNCATE` guards refuse it, and they stay on.
````

- [ ] **Step 2: Update the project rules**

In `CLAUDE.md`:

(a) Replace ``- **Backend:** Supabase (Postgres + Auth) — project `vwfrmhbczwpvqonlpfzs` `` with:
```markdown
- **Backend:** Supabase (Postgres + Auth) — project `acxyvouzwgvobtbmvoej`, `pre_registration` schema
```

(b) In Quick Commands, after `npm test                 # vitest unit tests`, add:
```markdown
npm run test:db          # database tests on a temporary Postgres (needs: brew install postgresql@17)
```

(c) Replace `- Webhook handler is authoritative for payment status — success page is cosmetic` with:
```markdown
- Only `confirm_order_payment` marks an order paid. The webhook and the success-page sync both call it with data they fetched from Stripe themselves; never trust payment data from a URL
- Order state changes go through the Postgres functions in migrations 012–017 (via `src/app/_payments/`). Never write `registrations`, `registration_entries` or `registration_snapshots` directly
- A submitted order never changes. To change entries, cancel it and create a new one
```

(d) Under "### Must be tested", add:
```markdown
- **Order and payment functions** (migrations 012–017): `tests/db/`, including concurrency and crash cases
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/payment-exceptions.md CLAUDE.md
git commit -m "docs: payment cases runbook and payment rules in CLAUDE.md"
```

---

### Task 17: Merge `main` (add-on orders, migration 019) into `payment-hardening`

Spec revision 5, Rollout step 3. `main` went live with a simpler add-on version at `0670edb`: migration 019, `summarisePaidOrders` and `prior` in the fee calculator, the add-on entry-page screens, "Add dances" on My entries, email numbers by feis and dancer, and `confirmFreeOrder` with `src/lib/confirmation-number.ts`, which write the order tables directly. This task brings `main` in with a real merge (the branch is pushed, so never a rebase) and keeps this branch's order flow everywhere the two collide. Nothing behaves differently afterwards: Tasks 18–20 rebuild main's add-on behaviour on this branch's order model.

**Files:**
- Merge: `origin/main` at `0670edb`
- Add (from `main`, unchanged): `supabase/migrations/019_add_on_orders.sql`
- Delete: `src/lib/email/send-confirmation.ts` (deleted on this branch, changed on `main`), `src/lib/confirmation-number.ts` (new on `main`, used only by the code this merge leaves out)
- Modify (resolution): `src/components/registration/entry-page.tsx`

**Interfaces:**
- Consumes: `origin/main` at `0670edb`.
- Produces, unchanged from `main`:
  - migration 019: `idx_registrations_active_unique` on `(feis_listing_id, household_id)` where status is `draft` or `pending_payment`
  - `PriorPaidFees` (`src/lib/types/feis-listing.ts`), `calculateFees(schedule, entries, at, prior)` and `summarisePaidOrders` (`src/lib/engine/fee-calculator.ts`, whose signature Task 18 changes), with their tests
  - `DancerEntry`'s optional `entered` prop (`src/components/registration/dancer-entry.tsx`)
  - `FamilyReceipt`'s optional `title` and `note`, and `PaidReceipt`'s required `canAdd` (`src/components/registration/family-receipt.tsx`)
  - main's sign-up and account-page fixes, and its `docs/known-issues.md` line

**How each of the nine files both branches changed is resolved:**

| File | What git does | Resolution |
|---|---|---|
| `src/app/api/webhooks/stripe/route.ts` | conflict | Keep this branch's (`--ours`): the new webhook (Task 11). main only moved `generateConfirmationNumber` out of its old handler. |
| `src/app/dashboard/page.tsx` | conflict | Keep this branch's. main's "Add dances" link on the latest paid order comes back in Task 20, behind `canStartOrder` and message A. |
| `src/app/feiseanna/[id]/register/actions.ts` | conflict | Keep this branch's: Submit through `create_order`, Pay and Cancel through the checkout workflow. main's counting of paid orders and its paid-dance refusal are rebuilt in Tasks 18–20. `confirmFreeOrder` and its direct service-role writes are not kept: Pay's $0 path is `confirm_free_order` (Tasks 19 and 20). |
| `src/components/registration/entry-page.tsx` | conflict | Keep this branch's, and pass `canAdd={false}` to `PaidReceipt`, whose prop main made required. Task 20 ports main's add-on screens. |
| `src/lib/email/send-confirmation.ts` | modify/delete | Delete it (`git rm`). The email queue (Task 13) replaced it, and main's change, numbers looked up by feis and dancer, is already how 016's `get_notification_context` reads them. |
| `src/app/feiseanna/[id]/register/page.tsx` | merges cleanly | Take this branch's version back (`git checkout HEAD --`): main's version passes `paidRegistrations`, which the entry page kept above doesn't take. Task 20 loads every paid order. |
| `src/components/registration/family-receipt.tsx` | merges cleanly | Keep the merge (main's `title`, `note` and `canAdd`; Task 20 uses them). |
| `src/lib/types/feis-listing.ts` | merges cleanly | Keep the merge (main's `PriorPaidFees`). |
| `docs/known-issues.md` | merges cleanly | Keep the merge. Task 21 rewords main's add-on line. |

Every other file main changed merges cleanly and is kept as merged: 019, the fee calculator and its tests, `dancer-entry.tsx`, `src/app/auth/signup/page.tsx` and `src/app/dashboard/account/page.tsx`. `src/lib/confirmation-number.ts` is deleted in the merge: nothing left imports it, and confirmation numbers are `new_confirmation_number()` in 015.

- [ ] **Step 1: Check where `main` is**

Work in `~/FEISSTAB-PRE-REG` on `payment-hardening`, with nothing uncommitted (`git status --short` prints nothing).
```bash
git fetch origin
test "$(git rev-parse origin/main)" = "$(git rev-parse 0670edb)" && echo "main is at 0670edb"
```
Expected: `main is at 0670edb`. If `main` has moved on, stop and ask: the resolutions below are for `0670edb`.

- [ ] **Step 2: Start the merge**

```bash
git merge --no-ff --no-commit origin/main || true
git status --short
```
Expected: git reports conflicts in `src/app/api/webhooks/stripe/route.ts`, `src/app/dashboard/page.tsx`, `src/app/feiseanna/[id]/register/actions.ts` and `src/components/registration/entry-page.tsx` (`UU`), and a modify/delete conflict on `src/lib/email/send-confirmation.ts` (`DU`). Everything else is staged.

- [ ] **Step 3: Resolve the conflicts as the table says**

```bash
git checkout --ours -- src/app/api/webhooks/stripe/route.ts src/app/dashboard/page.tsx \
  'src/app/feiseanna/[id]/register/actions.ts' src/components/registration/entry-page.tsx
git checkout HEAD -- 'src/app/feiseanna/[id]/register/page.tsx'
git rm -q -f src/lib/email/send-confirmation.ts src/lib/confirmation-number.ts
```

In `src/components/registration/entry-page.tsx`, replace:
```tsx
            cardsHref={`/dashboard/numbers/${feisId}`}
          />
```
with:
```tsx
            cardsHref={`/dashboard/numbers/${feisId}`}
            canAdd={false}
          />
```

- [ ] **Step 4: Check the result**

```bash
git add src/app/api/webhooks/stripe/route.ts src/app/dashboard/page.tsx \
  'src/app/feiseanna/[id]/register/actions.ts' 'src/app/feiseanna/[id]/register/page.tsx' \
  src/components/registration/entry-page.tsx
git diff --quiet origin/main -- supabase/migrations/019_add_on_orders.sql && echo "019 is byte-identical"
test -z "$(git grep -n -e confirmFreeOrder -e generateConfirmationNumber -e send-confirmation -- src)"
test -z "$(git diff --name-only --diff-filter=U)" && echo "no leftovers and nothing unmerged"
```
Expected: `019 is byte-identical`, then `no leftovers and nothing unmerged`.

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db && npm run build`
Expected: all pass. `npm test` runs 24 files and 288 tests (main's add-on fee tests included), and `npm run test:db` 9 files and 211 tests, now on 019's index: nothing in 012–017 depends on the old one.

- [ ] **Step 5: Commit the merge**

```bash
git commit -q -m "chore: merge main's add-on orders (migration 019) into payment-hardening"
git log --oneline -1
```

---

### Task 18: Prices count the family's paid orders (pure)

Spec §4, §14 and Decision 10. Every new order, a first order or an add-on, is priced on top of the family's paid orders for the feis, and freezes what it counted as `purchase_snapshot.pricing.prior`, in the exact shape `create_order` rebuilds (Task 19).

**Files:**
- Modify: `src/lib/types/feis-listing.ts`, `src/lib/engine/fee-calculator.ts`, `src/lib/engine/purchase-snapshot.ts`, `src/lib/engine/order-validation.ts`, `src/lib/engine/checkout-policy.ts`
- Test: `tests/engine/fee-calculator.test.ts`, `tests/engine/purchase-snapshot.test.ts`, `tests/engine/order-validation.test.ts`, `tests/engine/checkout-policy.test.ts`, `tests/engine/checkout-config.test.ts`

**Interfaces:**
- Consumes: `calculateFees(schedule, entries, at, prior)` and `PriorPaidFees` (Task 17).
- Produces:
  - **Types** (`feis-listing.ts`): `PaidOrderEntry { dancer_id, competition_id, base_fee_cents, late_fee_cents, counts_toward_family_cap }`, `PaidOrder { id, confirmation_number, event_fee_cents, entries }` and `CountedOrders extends PriorPaidFees { orders: PaidOrder[] }`
  - **`fee-calculator.ts`:** `compareIds(a, b)` (plain code-unit order) and `summarisePaidOrders(orders: PaidOrder[]): PriorPaidFees | null`, which now takes each entry's own family-max flag
  - **`purchase-snapshot.ts`:**
    - `PaidOrderRow`, the row shape Submit and the entry page read, and `paidOrdersFrom(rows, competitions): PaidOrder[]`
    - `countedOrdersRecord(orders): CountedOrders | null`, the exact record
    - `PriceOrderInput.paidOrders?: PaidOrder[]`, and `PurchaseSnapshot.pricing.prior: CountedOrders | null`
    - `PRICING_VERSION = 'pricing-2026-10-17'`
  - **`order-validation.ts`:** `OrderRequest.paidOrders?`, which refuses a pair already paid for, and `canStartOrder({ listing, now, hasUnpaidOrder, hasOpenMessageA }): boolean`
  - **`checkout-policy.ts`:** `tooSmallToCharge(totalCents)`, true for 1 to 49 cents

**Notes:**
- **The exact record** (spec §4). `create_order` compares the payload's `pricing.prior` with its own rebuild as `jsonb`, so `countedOrdersRecord` follows the SQL to the letter: orders sorted by `id`, each order's entries by `dancer_id` then `competition_id`, `late_fee_dancer_ids` sorted and without repeats, ids in lower case, every key present (`confirmation_number` is `null` on a legacy order), and `null` for a family with no paid order. Sorting uses `compareIds`, never `localeCompare`, which matches Postgres's `uuid` order.
- **Family-max flags.** An earlier entry counts toward the family max by its own order's frozen flag (`purchase_snapshot.competitions`). An order made before purchase snapshots uses the competition's flag now. `paidOrdersFrom` falls back to "counts" only when it can't find the competition at all, which on the entry page (enabled competitions only) is an estimate anyway.
- `PurchaseSnapshot.version` stays 1: `prior` is a new field, and nothing reads the snapshot in a way its absence would break. Snapshots from before this task have no `prior` key, which `isAddOnOrder` (Task 20) and `create_order` (Task 19) read as none.
- `belowCardMinimum` keeps blocking a card checkout under 50 cents (`claim_checkout`'s `amount_too_small`). Submit switches to `tooSmallToCharge` in Task 20, so a $0 order can be made.

- [ ] **Step 1: Write the failing tests**

In `tests/engine/fee-calculator.test.ts`:

(a) Replace:
```ts
describe('summarisePaidOrders', () => {
  it('is null when nothing has been paid', () => {
    expect(summarisePaidOrders([], [], new Set())).toBeNull()
  })

  it('totals the earlier orders, leaving out competitions excluded from the family max', () => {
    const prior = summarisePaidOrders(
      [{ event_fee_cents: 2500 }],
      [
        { dancer_id: 'd1', feis_competition_id: 'r', base_fee_cents: 1300, late_fee_cents: 2500 },
        { dancer_id: 'd1', feis_competition_id: 'lj', base_fee_cents: 1300, late_fee_cents: 0 },
        { dancer_id: 'd2', feis_competition_id: 'team', base_fee_cents: 4000, late_fee_cents: 0 }
      ],
      new Set(['team'])
    )
    expect(prior).toEqual({
```
with:
```ts
describe('summarisePaidOrders', () => {
  const entry = (dancer_id: string, competition_id: string, base: number, late = 0, counts = true) => ({
    dancer_id,
    competition_id,
    base_fee_cents: base,
    late_fee_cents: late,
    counts_toward_family_cap: counts
  })

  it('is null when nothing has been paid', () => {
    expect(summarisePaidOrders([])).toBeNull()
  })

  it("totals the earlier orders, leaving out entries that didn't count toward the family max", () => {
    const prior = summarisePaidOrders([
      {
        id: 'o1',
        confirmation_number: 'RF-2026-AAAAA',
        event_fee_cents: 2500,
        entries: [
          entry('d1', 'r', 1300, 2500),
          entry('d1', 'lj', 1300),
          entry('d2', 'team', 4000, 0, false)
        ]
      }
    ])
    expect(prior).toEqual({
```

(b) Replace:
```ts
    })
  })
})

```
with:
```ts
    })
  })

  it("adds up several orders, each entry with its own order's family-max flag", () => {
    const prior = summarisePaidOrders([
      { id: 'o2', confirmation_number: null, event_fee_cents: 0, entries: [entry('d3', 'r', 1300, 500, false)] },
      { id: 'o1', confirmation_number: null, event_fee_cents: 0, entries: [entry('d1', 'r', 1300, 500)] }
    ])
    expect(prior).toEqual({
      // Neither order charged the family fee, so the next one still does
      event_fee_paid: false,
      cappable_paid_cents: 1300,
      late_fee_dancer_ids: ['d1', 'd3'],
      late_fees_paid_cents: 1000
    })
  })
})

```

In `tests/engine/purchase-snapshot.test.ts`:

(a) Replace:
```ts
  CONSENT_VERSION,
  feeEntriesFor,
  pairLineItems,
  PRICING_VERSION,
  priceOrder,
  type PriceOrderInput
} from '@/lib/engine/purchase-snapshot'
import type { OrderDancer } from '@/lib/engine/order-validation'
import { parseLocalDate } from '@/lib/format'
import type { FeeSchedule, FeisCompetition } from '@/lib/types/feis-listing'

```
with:
```ts
  CONSENT_VERSION,
  countedOrdersRecord,
  feeEntriesFor,
  pairLineItems,
  paidOrdersFrom,
  PRICING_VERSION,
  priceOrder,
  type PaidOrderRow,
  type PriceOrderInput
} from '@/lib/engine/purchase-snapshot'
import type { OrderDancer } from '@/lib/engine/order-validation'
import { parseLocalDate } from '@/lib/format'
import type { FeeSchedule, FeisCompetition, PaidOrder } from '@/lib/types/feis-listing'

```

(b) Replace:
```ts
    expect(snapshot.rules).toMatchObject({ age_cutoff_date: '2027-01-01', pricing_version: PRICING_VERSION, consent_version: CONSENT_VERSION })
  })
```
with:
```ts
    expect(snapshot.rules).toMatchObject({ age_cutoff_date: '2027-01-01', pricing_version: PRICING_VERSION, consent_version: CONSENT_VERSION })
    expect(PRICING_VERSION).toBe('pricing-2026-10-17')
  })
```

(c) Replace:
```ts
      }
    ])
  })
})

```
with:
```ts
      }
    ])
  })
})

// Spec §4: an add-on is priced on top of the family's paid orders, and freezes what it counted
describe('pricing with earlier paid orders', () => {
  const paid = (id: string, overrides: Partial<PaidOrder> = {}): PaidOrder => ({
    id,
    confirmation_number: `RF-2026-${id.slice(0, 5).toUpperCase()}`,
    event_fee_cents: 1000,
    entries: [
      {
        dancer_id: 'd1',
        competition_id: 'c1',
        base_fee_cents: 1500,
        late_fee_cents: 0,
        counts_toward_family_cap: true
      }
    ],
    ...overrides
  })

  it('freezes prior as null on a first order', () => {
    expect(priceOrder(input()).snapshot.pricing.prior).toBeNull()
    expect(priceOrder(input({ paidOrders: [] })).snapshot.pricing.prior).toBeNull()
  })

  it("doesn't charge the family fee again, and freezes the counted orders", () => {
    const first = paid('7d1a0000-0000-4000-8000-000000000001')
    const { breakdown, snapshot } = priceOrder(
      input({ entries: [{ dancerId: 'd1', competitionId: 'c2' }], paidOrders: [first] })
    )
    expect(breakdown.event_fee_cents).toBe(0)
    expect(breakdown.grand_total_cents).toBe(1500)
    expect(snapshot.pricing.prior).toEqual({
      orders: [first],
      event_fee_paid: true,
      cappable_paid_cents: 1500,
      late_fee_dancer_ids: [],
      late_fees_paid_cents: 0
    })
  })

  it('charges only what the family max leaves after the earlier orders', () => {
    const capped = { ...schedule, family_cap_cents: 2000 }
    const { breakdown } = priceOrder(
      input({
        feeSchedule: capped,
        entries: [{ dancerId: 'd1', competitionId: 'c2' }],
        paidOrders: [paid('7d1a0000-0000-4000-8000-000000000001')]
      })
    )
    // 1500 of the 2000 max already paid leaves 500 for a 1500 dance
    expect(breakdown.family_cap_savings_cents).toBe(1000)
    expect(breakdown.grand_total_cents).toBe(500)
  })

  it('charges nothing once the family max is already reached', () => {
    const capped = { ...schedule, family_cap_cents: 1500 }
    const { breakdown } = priceOrder(
      input({
        feeSchedule: capped,
        entries: [{ dancerId: 'd1', competitionId: 'c2' }],
        paidOrders: [paid('7d1a0000-0000-4000-8000-000000000001')]
      })
    )
    expect(breakdown.grand_total_cents).toBe(0)
  })

  it("doesn't charge a dancer a second late fee", () => {
    const late = {
      ...schedule,
      late_fee_tiers: [{ starts_at: '2026-10-15T00:00:00Z', fee_cents: 2500, family_max_cents: null }]
    }
    const first = paid('7d1a0000-0000-4000-8000-000000000001', {
      entries: [
        {
          dancer_id: 'd1',
          competition_id: 'c1',
          base_fee_cents: 1500,
          late_fee_cents: 2500,
          counts_toward_family_cap: true
        }
      ]
    })
    const { snapshot } = priceOrder(
      input({ feeSchedule: late, entries: [{ dancerId: 'd1', competitionId: 'c2' }], paidOrders: [first] })
    )
    expect(snapshot.entries[0].late_fee_cents).toBe(0)
    expect(snapshot.pricing.prior?.late_fee_dancer_ids).toEqual(['d1'])
  })

  it('sorts orders by id, and entries by dancer then competition, with plain comparison', () => {
    const entry = (dancer_id: string, competition_id: string) => ({
      dancer_id,
      competition_id,
      base_fee_cents: 1500,
      late_fee_cents: 0,
      counts_toward_family_cap: true
    })
    const record = countedOrdersRecord([
      paid('b0000000-0000-4000-8000-000000000000', { entries: [entry('d2', 'c1'), entry('d1', 'c2'), entry('d1', 'c1')] }),
      paid('A0000000-0000-4000-8000-000000000000', { confirmation_number: null })
    ])
    expect(record?.orders.map((o) => o.id)).toEqual([
      'a0000000-0000-4000-8000-000000000000',
      'b0000000-0000-4000-8000-000000000000'
    ])
    expect(record?.orders[0].confirmation_number).toBeNull()
    expect(record?.orders[1].entries.map((e) => `${e.dancer_id}:${e.competition_id}`)).toEqual([
      'd1:c1',
      'd1:c2',
      'd2:c1'
    ])
    expect(countedOrdersRecord([])).toBeNull()
  })
})

describe('paidOrdersFrom', () => {
  const row = (purchase_snapshot: PaidOrderRow['purchase_snapshot']): PaidOrderRow => ({
    id: 'o1',
    confirmation_number: 'RF-2026-AAAAA',
    event_fee_cents: 1000,
    purchase_snapshot,
    registration_entries: [
      { dancer_id: 'd1', feis_competition_id: 'c1', base_fee_cents: 1500, late_fee_cents: 0 }
    ]
  })

  it("takes each entry's family-max flag from its own order's snapshot", () => {
    // Excluded when it was bought; the organiser has since counted it toward the max
    const frozen = { competitions: [{ ...comp('c1', '210R', 'reel'), exclude_from_family_cap: true }] }
    const [order] = paidOrdersFrom([row(frozen)], [comp('c1', '210R', 'reel')])
    expect(order.entries[0].counts_toward_family_cap).toBe(false)
  })

  it("uses the competition's current flag for an order made before snapshots", () => {
    const now = [{ ...comp('c1', '210R', 'reel'), exclude_from_family_cap: true }]
    const [order] = paidOrdersFrom([row(null)], now)
    expect(order).toEqual({
      id: 'o1',
      confirmation_number: 'RF-2026-AAAAA',
      event_fee_cents: 1000,
      entries: [
        {
          dancer_id: 'd1',
          competition_id: 'c1',
          base_fee_cents: 1500,
          late_fee_cents: 0,
          counts_toward_family_cap: false
        }
      ]
    })
  })
})

```

In `tests/engine/order-validation.test.ts`:

(a) Replace:
```ts
  ageCutoffDateFor,
  toDancerProfile,
```
with:
```ts
  ageCutoffDateFor,
  canStartOrder,
  toDancerProfile,
```

(b) Replace:
```ts
      danceLevels: { reel: 'NOV', treble_jig: 'PW' }
    })
  })
})

```
with:
```ts
      danceLevels: { reel: 'NOV', treble_jig: 'PW' }
    })
  })
})

// Spec §4: an add-on only adds. A dance already in one of the family's paid orders is refused
describe('validateOrderRequest with paid orders', () => {
  const paidOrders = [
    {
      id: 'o1',
      confirmation_number: 'RF-2026-AAAAA',
      event_fee_cents: 1000,
      entries: [
        {
          dancer_id: 'd1',
          competition_id: 'c1',
          base_fee_cents: 1500,
          late_fee_cents: 0,
          counts_toward_family_cap: true
        }
      ]
    }
  ]

  it('refuses a dance already entered and paid for, naming the dancer and the dance', () => {
    expect(validateOrderRequest(request({ paidOrders }))).toEqual({
      ok: false,
      error: 'Aoife is already entered in Novice Reel U10. Reload this page to see your entries.'
    })
  })

  it('accepts another dance for the same dancer', () => {
    const slipJig = competition({
      id: 'c2',
      dance_key: 'reel',
      display_name: 'Novice Reel U10 (second)',
      display_code: '210R2'
    })
    const result = validateOrderRequest(
      request({
        paidOrders,
        competitions: [competition(), slipJig],
        entries: [{ dancerId: 'd1', competitionId: 'c2' }]
      })
    )
    expect(result.ok).toBe(true)
  })
})

describe('canStartOrder', () => {
  const listing = {
    status: 'open' as const,
    reg_opens_at: '2026-10-01T00:00:00Z',
    reg_closes_at: '2026-12-01T00:00:00Z',
    late_reg_closes_at: null
  }
  const start = (overrides: Partial<Parameters<typeof canStartOrder>[0]> = {}) =>
    canStartOrder({ listing, now: NOW, hasUnpaidOrder: false, hasOpenMessageA: false, ...overrides })

  it('lets a new order start while registration is open', () => {
    expect(start()).toBe(true)
  })

  it("is false when the listing isn't open, before it opens and after the close date", () => {
    expect(start({ listing: { ...listing, status: 'closed' } })).toBe(false)
    expect(start({ listing: { ...listing, reg_opens_at: '2026-11-02T00:00:00Z' } })).toBe(false)
    expect(start({ listing: { ...listing, reg_closes_at: '2026-10-31T00:00:00Z' } })).toBe(false)
    // The late deadline is the close date when there is one
    expect(
      start({
        listing: {
          ...listing,
          reg_closes_at: '2026-10-31T00:00:00Z',
          late_reg_closes_at: '2026-11-15T00:00:00Z'
        }
      })
    ).toBe(true)
  })

  it('is false while the family holds an unpaid order', () => {
    expect(start({ hasUnpaidOrder: true })).toBe(false)
  })

  it('is false while message A is open, for a first order as much as an add-on', () => {
    expect(start({ hasOpenMessageA: true })).toBe(false)
  })
})

```

In `tests/engine/checkout-policy.test.ts`:

(a) Replace:
```ts
  checkoutBlockReason,
  MIN_CHARGE_CENTS
} from '@/lib/engine/checkout-policy'
```
with:
```ts
  checkoutBlockReason,
  MIN_CHARGE_CENTS,
  tooSmallToCharge
} from '@/lib/engine/checkout-policy'
```

(b) Replace:
```ts

  it('blocks Pay exactly where Submit refuses, with one message for both', () => {
    for (const totalCents of [0, 49, 50, 51]) {
```
with:
```ts

  it("blocks a card checkout below the minimum, with Submit's message", () => {
    for (const totalCents of [0, 49, 50, 51]) {
```

(c) Replace:
```ts
    )
  })
})

```
with:
```ts
    )
  })
})

// Decision 10: Submit refuses 1 to 49 cents. A $0 order is confirmed without Stripe instead
describe('tooSmallToCharge', () => {
  it('is true from 1 to 49 cents, and false for 0 and from 50 cents up', () => {
    expect(tooSmallToCharge(0)).toBe(false)
    expect(tooSmallToCharge(1)).toBe(true)
    expect(tooSmallToCharge(49)).toBe(true)
    expect(tooSmallToCharge(50)).toBe(false)
  })
})

```

`PurchaseSnapshot.pricing` gains a required `prior`, so the typed snapshot in the checkout-config tests needs it too.

In `tests/engine/checkout-config.test.ts`, replace:
```ts
      base_fee_cents: fee, late_fee_cents: 0, day_of_surcharge_cents: 0 })),
    pricing: { fee_schedule: {} as never, breakdown: {} as never, priced_at: '2026-11-01T12:00:00.000Z' },
    rules: { age_cutoff_date: '2027-01-01', levels: [], consent_version: 'x', platform_terms_version: 'y',
```
with:
```ts
      base_fee_cents: fee, late_fee_cents: 0, day_of_surcharge_cents: 0 })),
    pricing: { fee_schedule: {} as never, breakdown: {} as never, priced_at: '2026-11-01T12:00:00.000Z', prior: null },
    rules: { age_cutoff_date: '2027-01-01', levels: [], consent_version: 'x', platform_terms_version: 'y',
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/engine`
Expected: FAIL. `countedOrdersRecord`, `paidOrdersFrom`, `canStartOrder` and `tooSmallToCharge` aren't exported yet, `summarisePaidOrders` still takes three arguments, and `PRICING_VERSION` is still `pricing-2026-10-16`.

- [ ] **Step 3: Add the paid-order types**

In `src/lib/types/feis-listing.ts`, replace:
```ts
  late_fees_paid_cents: number
}
```
with:
```ts
  late_fees_paid_cents: number
}

/** An entry of one of the family's paid orders, as a later order counts it */
export interface PaidOrderEntry {
  dancer_id: string
  competition_id: string
  base_fee_cents: number
  late_fee_cents: number
  /** Whether it counted toward the family max when it was bought */
  counts_toward_family_cap: boolean
}

/** One of the family's paid orders for a feis, as a later order counts it (spec §4) */
export interface PaidOrder {
  id: string
  confirmation_number: string | null
  event_fee_cents: number
  entries: PaidOrderEntry[]
}

/**
 * What an order's price counted: the family's paid orders for the feis and what they covered. Frozen
 * as purchase_snapshot.pricing.prior, which create_order rebuilds and compares exactly (spec §4).
 */
export interface CountedOrders extends PriorPaidFees {
  orders: PaidOrder[]
}
```

- [ ] **Step 4: Count earlier orders entry by entry**

In `src/lib/engine/fee-calculator.ts`:

(a) Replace:
```ts
  LateFeeTier,
  PriorPaidFees
```
with:
```ts
  LateFeeTier,
  PaidOrder,
  PriorPaidFees
```

(b) Replace:
```ts

/**
 * What a family has already paid for one feis, from the entries of its paid orders.
 * `excludedFromCap` holds the competitions that don't count toward the family max.
 */
export function summarisePaidOrders(
  orders: { event_fee_cents: number }[],
  entries: {
    dancer_id: string
    feis_competition_id: string
    base_fee_cents: number
    late_fee_cents: number
  }[],
  excludedFromCap: Set<string>
): PriorPaidFees | null {
  if (orders.length === 0) return null
  return {
    event_fee_paid: orders.some((o) => o.event_fee_cents > 0),
    cappable_paid_cents: entries
      .filter((e) => !excludedFromCap.has(e.feis_competition_id))
      .reduce((sum, e) => sum + e.base_fee_cents, 0),
    late_fee_dancer_ids: [
      ...new Set(entries.filter((e) => e.late_fee_cents > 0).map((e) => e.dancer_id))
    ],
    late_fees_paid_cents: entries.reduce((sum, e) => sum + e.late_fee_cents, 0)
  }
```
with:
```ts

/** Plain code-unit order, the order Postgres gives uuids. Never localeCompare (spec §4). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * What a family has already paid for one feis, from its paid orders. Each entry says itself whether
 * it counted toward the family max when it was bought (spec §4), so a competition's flag changing
 * later doesn't change what an earlier order covered.
 */
export function summarisePaidOrders(orders: PaidOrder[]): PriorPaidFees | null {
  if (orders.length === 0) return null
  const entries = orders.flatMap((order) => order.entries)
  return {
    event_fee_paid: orders.some((order) => order.event_fee_cents > 0),
    cappable_paid_cents: entries
      .filter((entry) => entry.counts_toward_family_cap)
      .reduce((sum, entry) => sum + entry.base_fee_cents, 0),
    late_fee_dancer_ids: [
      ...new Set(entries.filter((entry) => entry.late_fee_cents > 0).map((entry) => entry.dancer_id))
    ].sort(compareIds),
    late_fees_paid_cents: entries.reduce((sum, entry) => sum + entry.late_fee_cents, 0)
  }
```

- [ ] **Step 5: Price on top of the paid orders, and freeze what was counted**

In `src/lib/engine/purchase-snapshot.ts`:

(a) Replace:
```ts
import { calculateAgeOnDate } from '@/lib/engine/eligibility'
import { calculateFees } from '@/lib/engine/fee-calculator'
import {
```
with:
```ts
import { calculateAgeOnDate } from '@/lib/engine/eligibility'
import { calculateFees, compareIds, summarisePaidOrders } from '@/lib/engine/fee-calculator'
import {
```

(b) Replace:
```ts
  ChampionshipStatus,
  FeeBreakdown,
  FeeCategoryType,
  FeeEntry,
  FeeSchedule,
  FeisCompetition,
  Level
} from '@/lib/types/feis-listing'

export const PRICING_VERSION = 'pricing-2026-10-16'
export const ELIGIBILITY_VERSION = 'eligibility-2026-10-16'
```
with:
```ts
  ChampionshipStatus,
  CountedOrders,
  FeeBreakdown,
  FeeCategoryType,
  FeeEntry,
  FeeSchedule,
  FeisCompetition,
  Level,
  PaidOrder
} from '@/lib/types/feis-listing'

/** pricing-2026-10-17: prices count the family's earlier paid orders for the feis (spec §4) */
export const PRICING_VERSION = 'pricing-2026-10-17'
export const ELIGIBILITY_VERSION = 'eligibility-2026-10-16'
```

(c) Replace:
```ts
  entries: SnapshotEntry[]
  pricing: { fee_schedule: FeeSchedule; breakdown: FeeBreakdown; priced_at: string }
  rules: {
```
with:
```ts
  entries: SnapshotEntry[]
  pricing: {
    fee_schedule: FeeSchedule
    breakdown: FeeBreakdown
    priced_at: string
    /** The paid orders this price counted, and what they covered; null on a family's first order */
    prior: CountedOrders | null
  }
  rules: {
```

(d) Replace:
```ts
  feeSchedule: FeeSchedule
}
```
with:
```ts
  feeSchedule: FeeSchedule
  /** The family's paid orders for this feis, from paidOrdersFrom(); none for a first order */
  paidOrders?: PaidOrder[]
}
```

(e) Replace:
```ts
  purchase_snapshot: PurchaseSnapshot
}
```
with:
```ts
  purchase_snapshot: PurchaseSnapshot
}

/** A paid order as Submit and the entry page read it: the row, its entries and its purchase snapshot */
export interface PaidOrderRow {
  id: string
  confirmation_number: string | null
  event_fee_cents: number
  purchase_snapshot: Pick<PurchaseSnapshot, 'competitions'> | null
  registration_entries: {
    dancer_id: string
    feis_competition_id: string
    base_fee_cents: number
    late_fee_cents: number
  }[]
}

/**
 * The family's paid orders as later orders count them. Whether an entry counted toward the family max
 * comes from its own order's purchase snapshot; an older order without one (made before snapshots)
 * uses the competition's current setting. create_order reads the rows by the same rule.
 */
export function paidOrdersFrom(
  rows: PaidOrderRow[],
  competitions: Pick<FeisCompetition, 'id' | 'exclude_from_family_cap'>[]
): PaidOrder[] {
  const current = new Map(competitions.map((c) => [c.id, c.exclude_from_family_cap]))
  return rows.map((row) => {
    const frozen = new Map(
      (row.purchase_snapshot?.competitions ?? []).map((c) => [c.id, c.exclude_from_family_cap])
    )
    return {
      id: row.id,
      confirmation_number: row.confirmation_number,
      event_fee_cents: row.event_fee_cents,
      entries: row.registration_entries.map((entry) => ({
        dancer_id: entry.dancer_id,
        competition_id: entry.feis_competition_id,
        base_fee_cents: entry.base_fee_cents,
        late_fee_cents: entry.late_fee_cents,
        counts_toward_family_cap: !(
          frozen.get(entry.feis_competition_id) ??
          current.get(entry.feis_competition_id) ??
          false
        )
      }))
    }
  })
}

/**
 * The counted-orders record exactly as create_order rebuilds it in SQL (spec §4): orders sorted by
 * id, each order's entries by dancer then competition, ids in lower case, every key present, and
 * null for a family with no paid orders. The two are compared as jsonb, so any difference refuses.
 */
export function countedOrdersRecord(orders: PaidOrder[]): CountedOrders | null {
  if (orders.length === 0) return null
  const sorted: PaidOrder[] = orders
    .map((order) => ({
      id: order.id.toLowerCase(),
      confirmation_number: order.confirmation_number ?? null,
      event_fee_cents: order.event_fee_cents,
      entries: order.entries
        .map((entry) => ({
          dancer_id: entry.dancer_id.toLowerCase(),
          competition_id: entry.competition_id.toLowerCase(),
          base_fee_cents: entry.base_fee_cents,
          late_fee_cents: entry.late_fee_cents,
          counts_toward_family_cap: entry.counts_toward_family_cap
        }))
        .sort(
          (a, b) =>
            compareIds(a.dancer_id, b.dancer_id) || compareIds(a.competition_id, b.competition_id)
        )
    }))
    .sort((a, b) => compareIds(a.id, b.id))
  return { orders: sorted, ...summarisePaidOrders(sorted)! }
}
```

(f) Replace:
```ts
  const feeEntries = feeEntriesFor(input.entries, competitions)
  const breakdown = calculateFees(input.feeSchedule, feeEntries, input.now)

```
with:
```ts
  const feeEntries = feeEntriesFor(input.entries, competitions)
  // An add-on is priced on top of what the family's paid orders already covered
  const prior = countedOrdersRecord(input.paidOrders ?? [])
  const breakdown = calculateFees(input.feeSchedule, feeEntries, input.now, prior)

```

(g) Replace:
```ts
    })),
    pricing: { fee_schedule: input.feeSchedule, breakdown, priced_at: input.now.toISOString() },
    rules: {
```
with:
```ts
    })),
    pricing: {
      fee_schedule: input.feeSchedule,
      breakdown,
      priced_at: input.now.toISOString(),
      prior
    },
    rules: {
```

- [ ] **Step 6: Refuse a dance already paid for, and add `canStartOrder`**

In `src/lib/engine/order-validation.ts`:

(a) Replace:
```ts
  FeisListing,
  Level
} from '@/lib/types/feis-listing'
```
with:
```ts
  FeisListing,
  Level,
  PaidOrder
} from '@/lib/types/feis-listing'
```

(b) Replace:
```ts
  entries: RequestedEntry[]
}
```
with:
```ts
  entries: RequestedEntry[]
  /** The family's paid orders for this feis: their dances can't be entered again */
  paidOrders?: PaidOrder[]
}
```

(c) Replace:
```ts
  }
}
```
with:
```ts
  }
}

/** Whether a new order can start: a family's first order or an add-on (spec §14, Decision 13) */
export interface OrderStartInput {
  listing: Pick<FeisListing, 'status' | 'reg_opens_at' | 'reg_closes_at' | 'late_reg_closes_at'>
  now: Date
  /** The family holds a draft or pending_payment order for this feis */
  hasUnpaidOrder: boolean
  /** The family has an open message-A case for this feis: message A says not to pay again */
  hasOpenMessageA: boolean
}

/**
 * The one gate for starting a new order, used for choosing dances and Pay on the entry page and for
 * Add dances on My entries and the paid receipt. False while registration isn't open, before it
 * opens, after it closes, while the family holds an unpaid order, or while message A is open.
 */
export function canStartOrder(input: OrderStartInput): boolean {
  const { listing, now } = input
  if (listing.status !== 'open') return false
  if (listing.reg_opens_at && now < new Date(listing.reg_opens_at)) return false
  const close = registrationCloseTime(listing)
  if (close && now > close) return false
  return !input.hasUnpaidOrder && !input.hasOpenMessageA
}
```

(d) Replace:
```ts

  const ageCutoffDate = ageCutoffDateFor(listing, now)
```
with:
```ts

  // An add-on only adds: a dance already in one of the family's paid orders is never bought twice
  const entered = new Set(
    (request.paidOrders ?? []).flatMap((order) =>
      order.entries.map((entry) => `${entry.dancer_id}:${entry.competition_id}`)
    )
  )
  for (const entry of request.entries) {
    if (entered.has(`${entry.dancerId}:${entry.competitionId}`)) {
      const dancer = dancers.get(entry.dancerId)!
      const competition = competitions.get(entry.competitionId)!
      return fail(
        `${dancer.first_name} is already entered in ${competition.display_name}. Reload this page to see your entries.`
      )
    }
  }

  const ageCutoffDate = ageCutoffDateFor(listing, now)
```

- [ ] **Step 7: Add `tooSmallToCharge`**

In `src/lib/engine/checkout-policy.ts`, replace:
```ts
/**
 * Whether an order's total is too small to pay by card. Submit refuses to create such an order;
 * claim_checkout's amount_too_small block is the database's backstop.
 */
export function belowCardMinimum(totalCents: number): boolean {
  return totalCents < MIN_CHARGE_CENTS
}
```
with:
```ts
/**
 * Whether an order's total is too small to pay by card. claim_checkout blocks such an order
 * (amount_too_small); a $0 order never claims a checkout, because Pay confirms it without Stripe.
 */
export function belowCardMinimum(totalCents: number): boolean {
  return totalCents < MIN_CHARGE_CENTS
}

/**
 * Whether Submit refuses a total (Decision 10): 1 to 49 cents is more than nothing but less than a card
 * can be charged, so no order is made that could never be paid. create_order refuses it too. A total
 * of 0 is allowed: Pay confirms it without Stripe (spec §6).
 */
export function tooSmallToCharge(totalCents: number): boolean {
  return totalCents > 0 && belowCardMinimum(totalCents)
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/engine`
Expected: PASS (11 files, 187 tests).

Run: `npx tsc --noEmit && npm test && npm run test:db`
Expected: all pass: 24 files and 304 tests, then 9 files and 211 tests. The database still ignores `pricing.prior` until Task 19, and every fixture order is a first order, priced with `prior: null`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types/feis-listing.ts src/lib/engine/fee-calculator.ts src/lib/engine/purchase-snapshot.ts \
  src/lib/engine/order-validation.ts src/lib/engine/checkout-policy.ts tests/engine/fee-calculator.test.ts \
  tests/engine/purchase-snapshot.test.ts tests/engine/order-validation.test.ts tests/engine/checkout-policy.test.ts \
  tests/engine/checkout-config.test.ts
git commit -q -m "feat: prices count the family's paid orders and freeze what they counted"
```

---

### Task 19: Add-on and $0 orders in the order functions (migrations 012, 013, 015, 017 and 020)

Spec §2, §3, §4, §6 step 3a, §9, §11 and Testing. 012–017 aren't live yet, so they're edited in place. They never create or drop 019's index, and the new last migration, 020, refuses to apply unless the index is exactly 019's.

**Files:**
- Modify: `supabase/migrations/012_order_integrity.sql`, `supabase/migrations/013_create_order.sql`, `supabase/migrations/015_payment_confirmation.sql`, `supabase/migrations/017_payments_admin.sql`
- Create: `supabase/migrations/020_assert_unpaid_index.sql`
- Modify: `src/app/_payments/order-store.ts`, `src/lib/engine/checkout-policy.ts`, `src/app/feiseanna/[id]/register/actions.ts`
- Test: `tests/db/helpers/fixtures.ts`, `tests/db/add-on-orders.test.ts` (new), `tests/db/create-order.test.ts`, `tests/db/payment-confirmation.test.ts`, `tests/db/payments-admin.test.ts`, `tests/db/order-integrity.test.ts`, `tests/db/checkout-claims.test.ts`

**Interfaces:**
- Consumes: 019's index (Task 17); `paidOrdersFrom`, `priceOrder({ paidOrders })` and the counted-orders record (Task 18).
- Produces:
  - **012:** a move into `paid` needs the marker `pre_registration.fulfilling_order` to name the order, checked after the status table and the evidence. The evidence is the claim and session for an order above 0, or, for a $0 order, a move from `draft` with no claim, session, payment intent or charge.
  - **013:** `_counted_orders(p_household_id uuid, p_feis_listing_id uuid) → jsonb` (internal: no API role may run it). `create_order` refuses `amount_too_small` (1 to 49 cents), `unpaid_order_exists` (renamed from `active_order_exists`), `paid_orders_changed` and `already_entered`, and checks the once-per-family rules against the counted orders.
  - **015:**
    - `_uncounted_paid_orders(p_registration_id uuid) → uuid[]` (internal)
    - `_fulfil_order` sets the marker before its paid update
    - `confirm_order_payment` applies rules (a) and (b) with `details.why`, and the relabel branch is gone
    - `confirm_free_order(p_registration_id uuid, p_household_id uuid) → jsonb`, for the service role
  - **017:** `confirm_late_payment` follows Decision 12, and its audit row names the counted orders.
  - **020:** the index check.
  - **`order-store.ts`:** the new `CreateOrderResult` reasons, `FreeOrderResult` and `confirmFreeOrder(registrationId, householdId)`.
  - **`checkout-policy.ts`:** `PAID_ORDERS_CHANGED_MESSAGE`, which `REFUSAL_MESSAGES` and Pay's $0 path (Task 20) share.
  - **Fixtures:**
    - `insertOrderDirect(…, { totalCents })`, which also sets the paid marker first now
    - `insertLegacyPaidOrder`, for a paid order as main's live code made them
    - `paidOrdersOf(pool, householdId, listing)`, the paid orders as Submit reads them
    - `buildPayload({ paidOrders })`, `createAddOnOrder(pool, base, entries)` and `payOrder(pool, order)`

**Notes:**
- **The paid marker** reuses the snapshot marker. `_fulfil_order` names the order before its one paid update and clears it after the snapshot, so `confirm_order_payment`, `confirm_free_order` and `payments_admin.confirm_late_payment` all mark orders paid through it. The trigger checks the marker last, so a move the status table or the evidence refuses still gets that message, and the evidence tests from Task 3 pass unchanged.
- **Rule (a) and rule (b)** (spec §9 step 4). Before them, `confirm_order_payment` expires the family's other lapsed unpaid orders for the feis, as `create_order` does. A conflict's `details.why` is an array with one item per failed rule, in this order: `{"rule": "unpaid_order_exists", "orders": [...]}` and `{"rule": "paid_orders_changed", "orders": [...]}`, each list sorted. (a) applies only to an expired order; (b) is checked for every status.
- **`confirm_free_order`** takes the household-and-feis lock, then the order row, then the listing `FOR UPDATE`. `FOR SHARE`, as in `claim_checkout`, would deadlock two $0 confirmations at one feis, because `_fulfil_order` then locks the listing `FOR UPDATE` for numbering. A test runs two families at once to prove it.
- **The once-per-family checks in `create_order`** read the frozen schedule in `pricing.fee_schedule` and the counted record. A payload without `pricing.fee_schedule.event_fee_cents` is refused: Task 16's live script now sends one.
- **020's expected text** is what `pg_get_indexdef` prints for 019's index, schema-qualified whatever the `search_path`.
- **`active_order_exists` is renamed `unpaid_order_exists`** in the SQL, `order-store.ts` and `REFUSAL_MESSAGES`, with the spec's four new messages. Submit still refuses every total under 50 cents until Task 20 switches it to `tooSmallToCharge`.
- **Fixtures the marker changes:** `insertOrderDirect` (the marker before its paid update), `FULFIL_SQL` in `order-integrity.test.ts` (a `fulfil` helper sets the marker first), and the direct paid update in `payment-confirmation.test.ts`. The relabel assertions (`not.toHaveProperty('caught')`) become assertions on `details.why`. `checkout-claims.test.ts`'s 20-cent order, which `create_order` now refuses, becomes a $0 order that `claim_checkout` still won't claim.

- [ ] **Step 1: Extend the fixtures**

In `tests/db/helpers/fixtures.ts`:

(a) Replace:
```ts
import type { Pool } from 'pg'
import type { Dancer, FeeSchedule, FeisCompetition, FeisListing, Level } from '@/lib/types/feis-listing'
import { createOrderStore } from '@/app/_payments/order-store'
import { buildCheckoutConfig, type CheckoutConfig } from '@/lib/engine/checkout-config'
import { ageCutoffDateFor, type RequestedEntry } from '@/lib/engine/order-validation'
import {
  buildCreateOrderPayload,
  priceOrder,
  type CreateOrderPayload
} from '@/lib/engine/purchase-snapshot'
```
with:
```ts
import type { Pool } from 'pg'
import type {
  Dancer,
  FeeSchedule,
  FeisCompetition,
  FeisListing,
  Level,
  PaidOrder
} from '@/lib/types/feis-listing'
import { createOrderStore } from '@/app/_payments/order-store'
import { buildCheckoutConfig, type CheckoutConfig } from '@/lib/engine/checkout-config'
import { ageCutoffDateFor, type RequestedEntry } from '@/lib/engine/order-validation'
import {
  buildCreateOrderPayload,
  paidOrdersFrom,
  priceOrder,
  type CreateOrderPayload,
  type PaidOrderRow
} from '@/lib/engine/purchase-snapshot'
```

(b) Replace:
```ts
 * attach_checkout_session and _fulfil_order will (Tasks 8 and 9). The real app never does this.
 */
export async function insertOrderDirect(
  pool: Pool,
  householdId: string,
  listingId: string,
  entries: { dancerId: string; competitionId: string }[],
  opts: { status?: 'draft' | 'paid' } = {}
): Promise<string> {
  const client = await pool.connect()
```
with:
```ts
 * attach_checkout_session and _fulfil_order will (Tasks 8 and 9). The real app never does this.
 * `totalCents: 0` makes a $0 draft, with no event or application fee.
 */
export async function insertOrderDirect(
  pool: Pool,
  householdId: string,
  listingId: string,
  entries: { dancerId: string; competitionId: string }[],
  opts: { status?: 'draft' | 'paid'; totalCents?: number } = {}
): Promise<string> {
  const total = opts.totalCents ?? 4000
  const client = await pool.connect()
```

(c) Replace:
```ts
         event_fee_cents, hold_expires_at, purchase_snapshot)
       VALUES ($1, $2, $3, 'draft', 4000, 200, 1000, now() + interval '30 minutes', '{"version": 1}')`,
      [id, listingId, householdId]
    )
```
with:
```ts
         event_fee_cents, hold_expires_at, purchase_snapshot)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, now() + interval '30 minutes', '{"version": 1}')`,
      [id, listingId, householdId, total, total === 0 ? 0 : 200, total === 0 ? 0 : 1000]
    )
```

(d) Replace:
```ts
      )
      await client.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-' || substr($1::text, 1, 5),
           stripe_payment_intent_id = 'pi_' || replace($1::text, '-', ''), hold_expires_at = NULL
         WHERE id = $1`,
        [id]
      )
      await client.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
      await client.query(
```
with:
```ts
      )
      // _fulfil_order's order of steps: the paid marker first (012 refuses a move into paid without it)
      await client.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
      await client.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-' || substr($1::text, 1, 5),
           stripe_payment_intent_id = 'pi_' || replace($1::text, '-', ''), hold_expires_at = NULL
         WHERE id = $1`,
        [id]
      )
      await client.query(
```

(e) Replace:
```ts

export function buildPayload(input: {
  listing: ListingFixture
  dancers: FixtureDancer[]
  entries: RequestedEntry[]
  now?: Date
}): CreateOrderPayload {
```
with:
```ts

/**
 * Test-only: a paid order as main's live code made them before payment hardening: no purchase snapshot, no
 * snapshot row, and for a $0 one no claim or session. Written as the superuser with the order triggers off for
 * this one transaction (session_replication_role = replica), since no function makes such an order any more.
 */
export async function insertLegacyPaidOrder(
  pool: Pool,
  householdId: string,
  listingId: string,
  entries: { dancerId: string; competitionId: string; baseFeeCents?: number; lateFeeCents?: number }[],
  opts: { eventFeeCents?: number } = {}
): Promise<string> {
  const id = randomUUID()
  const eventFee = opts.eventFeeCents ?? 1000
  const total = eventFee + entries.reduce((sum, e) => sum + (e.baseFeeCents ?? 1500) + (e.lateFeeCents ?? 0), 0)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    await client.query(
      `INSERT INTO registrations (id, feis_listing_id, household_id, status, total_cents, application_fee_cents,
         event_fee_cents, confirmation_number, paid_at)
       VALUES ($1, $2, $3, 'paid', $4, 0, $5, $6, now())`,
      [id, listingId, householdId, total, eventFee, `FT-2026-${id.slice(0, 4).toUpperCase()}`]
    )
    for (const entry of entries) {
      await client.query(
        `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category,
           base_fee_cents, late_fee_cents)
         VALUES ($1, $2, $3, 'solo', $4, $5)`,
        [id, entry.dancerId, entry.competitionId, entry.baseFeeCents ?? 1500, entry.lateFeeCents ?? 0]
      )
    }
    await client.query('COMMIT')
    return id
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** The family's paid orders for a feis as Submit reads them, counted by the engine's paidOrdersFrom */
export async function paidOrdersOf(
  pool: Pool,
  householdId: string,
  listing: ListingFixture
): Promise<PaidOrder[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.confirmation_number, r.event_fee_cents, r.purchase_snapshot,
       coalesce((SELECT jsonb_agg(jsonb_build_object('dancer_id', e.dancer_id,
           'feis_competition_id', e.feis_competition_id, 'base_fee_cents', e.base_fee_cents,
           'late_fee_cents', e.late_fee_cents))
         FROM registration_entries e WHERE e.registration_id = r.id), '[]') AS registration_entries
     FROM registrations r
     WHERE r.household_id = $1 AND r.feis_listing_id = $2 AND r.status = 'paid'`,
    [householdId, listing.listing.id]
  )
  const { rows: competitions } = await pool.query(
    'SELECT id, exclude_from_family_cap FROM feis_competitions WHERE feis_listing_id = $1',
    [listing.listing.id]
  )
  return paidOrdersFrom(rows as PaidOrderRow[], competitions)
}

export function buildPayload(input: {
  listing: ListingFixture
  dancers: FixtureDancer[]
  entries: RequestedEntry[]
  now?: Date
  /** The family's paid orders for the feis, for an add-on */
  paidOrders?: PaidOrder[]
}): CreateOrderPayload {
```

(f) Replace:
```ts
    entries: input.entries,
    feeSchedule: input.listing.feeSchedule
  })
```
with:
```ts
    entries: input.entries,
    feeSchedule: input.listing.feeSchedule,
    paidOrders: input.paidOrders
  })
```

(g) Replace:
```ts
  registrationId: string
}
```
with:
```ts
  registrationId: string
}

/**
 * A family's next order for a feis, priced on top of its paid orders as Submit prices it, and made through
 * create_order. The family and its dancers come from an earlier fixture.
 */
export async function createAddOnOrder(
  pool: Pool,
  base: { family: Family; listing: ListingFixture; dancers: FixtureDancer[] },
  entries: RequestedEntry[]
): Promise<DraftOrderFixture> {
  const paidOrders = await paidOrdersOf(pool, base.family.householdId, base.listing)
  const payload = buildPayload({ listing: base.listing, dancers: base.dancers, entries, paidOrders })
  const result = await createOrderStore(pgRpc(pool)).createOrder(
    base.family.householdId,
    base.listing.listing.id,
    payload
  )
  if (result.status !== 'created') throw new Error(`Add-on order was refused: ${result.reason}`)
  return { ...base, entries, payload, registrationId: result.registration_id }
}
```

(h) Replace:
```ts
  return { claimId, config, sessionId }
}

```
with:
```ts
  return { claimId, config, sessionId }
}

/** Pays an order the way Pay and the webhook do: claim, attach, then confirm_order_payment */
export async function payOrder(pool: Pool, order: DraftOrderFixture): Promise<string> {
  const ready = await readyToPay(pool, order)
  const result = await createOrderStore(pgRpc(pool)).confirmOrderPayment({
    registrationId: order.registrationId,
    claimId: ready.claimId,
    sessionId: ready.sessionId,
    account: ready.config.account,
    amountCents: order.payload.total_cents,
    currency: 'usd',
    paymentStatus: 'paid',
    paymentIntentId: `pi_${ready.sessionId}`,
    chargeId: null,
    eventId: `evt_${randomUUID()}`,
    source: 'webhook'
  })
  if (result.result !== 'confirmed') throw new Error(`expected a confirmation, got ${result.result}`)
  return result.confirmation_number!
}

```

- [ ] **Step 2: Write the failing tests**

Create `tests/db/add-on-orders.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createOrderStore,
  type ConfirmPaymentInput,
  type OrderStore
} from '@/app/_payments/order-store'
import type { PaidOrder } from '@/lib/types/feis-listing'
import { createTestDatabase, refused, type TestDatabase } from './helpers/db'
import {
  buildPayload,
  createAddOnOrder,
  createDancer,
  createDraftOrder,
  createFamily,
  createListing,
  insertLegacyPaidOrder,
  paidOrdersOf,
  payOrder,
  readyToPay,
  type DraftOrderFixture,
  type ListingFixture
} from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: OrderStore

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

/** 019's index, as pg_get_indexdef prints it */
const UNPAID_INDEX =
  'CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree ' +
  "(feis_listing_id, household_id) WHERE (status = ANY (ARRAY['draft'::text, 'pending_payment'::text]))"

type Ready = Awaited<ReturnType<typeof readyToPay>>

function payment(order: DraftOrderFixture, ready: Ready): ConfirmPaymentInput {
  return {
    registrationId: order.registrationId,
    claimId: ready.claimId,
    sessionId: ready.sessionId,
    account: ready.config.account,
    amountCents: order.payload.total_cents,
    currency: 'usd',
    paymentStatus: 'paid',
    paymentIntentId: `pi_${ready.sessionId}`,
    chargeId: null,
    eventId: `evt_${randomUUID()}`,
    source: 'webhook'
  }
}

/** Takes an order to checkout, then lets its checkout expire, so a payment for it arrives late */
async function lateOrder(order: DraftOrderFixture): Promise<Ready> {
  const ready = await readyToPay(db.pool, order)
  await store.expireCheckout({
    registrationId: order.registrationId,
    claimId: ready.claimId,
    sessionId: ready.sessionId,
    account: ready.config.account
  })
  return ready
}

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

async function ordersOf(householdId: string): Promise<number> {
  const { rows } = await db.pool.query(
    'SELECT count(*)::int AS n FROM registrations WHERE household_id = $1',
    [householdId]
  )
  return rows[0].n
}

async function counts(registrationId: string) {
  const { rows } = await db.pool.query(
    `SELECT
       (SELECT count(*)::int FROM registration_snapshots WHERE registration_id = $1) AS snapshots,
       (SELECT count(*)::int FROM notifications WHERE registration_id = $1 AND kind = 'registration_confirmation') AS emails,
       (SELECT count(*)::int FROM competitor_numbers WHERE registration_id = $1) AS numbers,
       (SELECT count(*)::int FROM payment_exceptions WHERE registration_id = $1) AS cases`,
    [registrationId]
  )
  return rows[0]
}

/** The details of the one late_payment_conflict case on an order */
async function conflictWhy(registrationId: string) {
  const { rows } = await db.pool.query(
    `SELECT details FROM payment_exceptions WHERE registration_id = $1 AND reason = 'late_payment_conflict'`,
    [registrationId]
  )
  expect(rows).toHaveLength(1)
  return rows[0].details.why
}

/** A paid first order (Aoife: Novice Reel and Slip Jig, $40.00), and a second dancer, Niamh, with no entries yet */
async function familyWithPaidOrder(listing?: ListingFixture) {
  const first = await createDraftOrder(db.pool, { listing })
  await payOrder(db.pool, first)
  const niamh = await createDancer(db.pool, first.family.householdId, { firstName: 'Niamh' })
  const base = { family: first.family, listing: first.listing, dancers: [...first.dancers, niamh] }
  const [aoife] = first.dancers
  const [reel, slipJig, trebleJig] = first.listing.competitions
  return { first, base, aoife, niamh, reel, slipJig, trebleJig }
}

/** A listing whose family max is `cents`, in the database and in the fixture */
async function cappedListing(cents: number): Promise<ListingFixture> {
  return createListing(db.pool, { familyCapCents: cents })
}

/** A feis where every dance and the family fee cost nothing, so every order is $0 */
async function freeListing(): Promise<ListingFixture> {
  const created = await createListing(db.pool)
  await db.pool.query(
    'UPDATE fee_schedules SET event_fee_cents = 0, solo_fee_cents = 0 WHERE feis_listing_id = $1',
    [created.listing.id]
  )
  return {
    ...created,
    feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: 0 }
  }
}

/** Marks a competition as outside the family max, in the database and in the fixture */
async function excludeFromFamilyMax(
  listing: ListingFixture,
  competitionId: string
): Promise<ListingFixture> {
  await db.pool.query('UPDATE feis_competitions SET exclude_from_family_cap = true WHERE id = $1', [
    competitionId
  ])
  return {
    ...listing,
    competitions: listing.competitions.map((c) =>
      c.id === competitionId ? { ...c, exclude_from_family_cap: true } : c
    )
  }
}

describe('the unpaid-order index (019) and its check (020)', () => {
  it('covers only draft and pending_payment, and re-applying 012–017 leaves it so', async () => {
    const client = await db.pool.connect()
    const indexDef = async () =>
      (
        await client.query(
          `SELECT pg_get_indexdef('pre_registration.idx_registrations_active_unique'::regclass) AS def`
        )
      ).rows[0].def
    try {
      expect(await indexDef()).toBe(UNPAID_INDEX)
      await client.query('BEGIN')
      for (const file of [
        '012_order_integrity',
        '013_create_order',
        '014_checkout_claims',
        '015_payment_confirmation',
        '016_notification_delivery',
        '017_payments_admin'
      ]) {
        await client.query(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'))
      }
      expect(await indexDef()).toBe(UNPAID_INDEX)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('020 refuses to apply unless the index is exactly 019’s', async () => {
    const check = readFileSync('supabase/migrations/020_assert_unpaid_index.sql', 'utf8')
    const client = await db.pool.connect()
    try {
      // 019's index passes
      await client.query(check)
      for (const replacement of [
        // 002's predicate: paid orders would count as active again
        `CREATE UNIQUE INDEX idx_registrations_active_unique ON registrations (feis_listing_id, household_id)
           WHERE status NOT IN ('expired', 'cancelled')`,
        // No index at all
        null
      ]) {
        await client.query('BEGIN')
        await client.query('DROP INDEX idx_registrations_active_unique')
        if (replacement) await client.query(replacement)
        expect(await refused(client.query(check))).toMatch(/must be 019's one-unpaid-order index/)
        await client.query('ROLLBACK')
      }
    } finally {
      client.release()
    }
  })
})

describe('create_order with paid orders (add-on orders)', () => {
  it('creates an add-on that counts the paid order, and leaves the paid order as it was', async () => {
    const { first, base, aoife, trebleJig } = await familyWithPaidOrder()
    const paidBefore = await orderRow(first.registrationId)
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])

    // No second family fee: just the one dance
    expect(addOn.payload.total_cents).toBe(1500)
    expect(addOn.payload.event_fee_cents).toBe(0)
    const row = await orderRow(addOn.registrationId)
    expect(row).toMatchObject({ status: 'draft', total_cents: 1500, event_fee_cents: 0 })
    expect(row.purchase_snapshot.pricing.prior).toMatchObject({
      orders: [
        {
          id: first.registrationId,
          confirmation_number: paidBefore.confirmation_number,
          event_fee_cents: 1000
        }
      ],
      event_fee_paid: true,
      cappable_paid_cents: 3000,
      late_fee_dancer_ids: [],
      late_fees_paid_cents: 0
    })
    expect(row.purchase_snapshot.pricing.prior.orders[0].entries).toHaveLength(2)
    expect(await orderRow(first.registrationId)).toEqual(paidBefore)
  })

  it('refuses a dance already in a paid order (already_entered), and creates nothing', async () => {
    const { base, aoife, reel } = await familyWithPaidOrder()
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const payload = buildPayload({
      ...base,
      entries: [{ dancerId: aoife.id, competitionId: reel.id }],
      paidOrders
    })
    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, payload)
    ).toEqual({ status: 'refused', reason: 'already_entered' })
    expect(await ordersOf(base.family.householdId)).toBe(1)
  })

  it('refuses an add-on while the family holds an unpaid order (unpaid_order_exists)', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const held = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const payload = buildPayload({
      ...base,
      entries: [{ dancerId: niamh.id, competitionId: reel.id }],
      paidOrders
    })
    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, payload)
    ).toEqual({
      status: 'refused',
      reason: 'unpaid_order_exists',
      registration_id: held.registrationId
    })
    expect(await ordersOf(base.family.householdId)).toBe(2)
  })

  it("refuses a price whose counted orders aren't the family's paid orders now (paid_orders_changed)", async () => {
    const { base, niamh, reel } = await familyWithPaidOrder()
    const entries = [{ dancerId: niamh.id, competitionId: reel.id }]
    const real = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const madeUp: PaidOrder = { ...real[0], id: randomUUID() }
    const altered: PaidOrder[] = [
      {
        ...real[0],
        entries: real[0].entries.map((e, i) => (i === 0 ? { ...e, base_fee_cents: 1 } : e))
      }
    ]
    for (const [label, paidOrders] of [
      ['stale: priced as a first order', []],
      ['made up: an order that was never paid', [...real, madeUp]],
      ['wrong figures for the paid order', altered]
    ] as [string, PaidOrder[]][]) {
      const payload = buildPayload({ ...base, entries, paidOrders })
      expect(
        await store.createOrder(base.family.householdId, base.listing.listing.id, payload),
        label
      ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })
    }
    expect(await ordersOf(base.family.householdId)).toBe(1)
  })

  it("takes each paid entry's family-max flag from its own order's snapshot, not the competition now", async () => {
    const listing = await cappedListing(3500)
    const { base, aoife, slipJig, trebleJig } = await familyWithPaidOrder(listing)
    // After the family paid, the organiser takes Slip Jig out of the family max
    const changed = await excludeFromFamilyMax(base.listing, slipJig.id)
    const entries = [{ dancerId: aoife.id, competitionId: trebleJig.id }]

    // Priced with today's flag: the paid order's Slip Jig no longer counts, which isn't what it covered
    const wrong = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const todaysFlags = wrong.map((o) => ({
      ...o,
      entries: o.entries.map((e) =>
        e.competition_id === slipJig.id ? { ...e, counts_toward_family_cap: false } : e
      )
    }))
    const refusedPayload = buildPayload({
      ...base,
      listing: changed,
      entries,
      paidOrders: todaysFlags
    })
    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, refusedPayload)
    ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })

    // Priced with the paid order's own flags: $30.00 of the $35.00 max is used, so $5.00 is left
    const addOn = await createAddOnOrder(db.pool, { ...base, listing: changed }, entries)
    expect(addOn.payload.purchase_snapshot.pricing.prior?.cappable_paid_cents).toBe(3000)
    expect(addOn.payload.total_cents).toBe(500)
  })

  it("counts a legacy paid order (no snapshot) from its rows, with the competition's current family-max flag", async () => {
    const created = await createListing(db.pool, { familyCapCents: 3500 })
    const listing = await excludeFromFamilyMax(created, created.competitions[1].id)
    const family = await createFamily(db.pool)
    const aoife = await createDancer(db.pool, family.householdId)
    const [reel, slipJig, trebleJig] = listing.competitions
    const legacyId = await insertLegacyPaidOrder(db.pool, family.householdId, listing.listing.id, [
      { dancerId: aoife.id, competitionId: reel.id },
      { dancerId: aoife.id, competitionId: slipJig.id }
    ])
    expect((await orderRow(legacyId)).purchase_snapshot).toBeNull()
    const base = { family, listing, dancers: [aoife] }
    const entries = [{ dancerId: aoife.id, competitionId: trebleJig.id }]

    // A payload that counts the legacy Slip Jig toward the max, though the competition is excluded now
    const counted = await paidOrdersOf(db.pool, family.householdId, listing)
    const otherFlag = counted.map((o) => ({
      ...o,
      entries: o.entries.map((e) => ({ ...e, counts_toward_family_cap: true }))
    }))
    expect(
      await store.createOrder(
        family.householdId,
        listing.listing.id,
        buildPayload({ ...base, entries, paidOrders: otherFlag })
      )
    ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })

    // Counted from its rows: the family fee was paid, and only the Reel counts toward the max
    const addOn = await createAddOnOrder(db.pool, base, entries)
    expect(addOn.payload.purchase_snapshot.pricing.prior).toMatchObject({
      orders: [{ id: legacyId, event_fee_cents: 1000 }],
      event_fee_paid: true,
      cappable_paid_cents: 1500
    })
    expect(addOn.payload.total_cents).toBe(1500)
  })

  it('refuses a payload that breaks the once-per-family rules, whose totals still add up', async () => {
    // The family fee charged a second time
    const fee = await familyWithPaidOrder()
    const feeAddOn = buildPayload({
      ...fee.base,
      entries: [{ dancerId: fee.aoife.id, competitionId: fee.trebleJig.id }],
      paidOrders: await paidOrdersOf(db.pool, fee.base.family.householdId, fee.base.listing)
    })
    feeAddOn.event_fee_cents = 1000
    feeAddOn.total_cents += 1000
    feeAddOn.purchase_snapshot.pricing.breakdown.event_fee_cents = 1000
    feeAddOn.purchase_snapshot.pricing.breakdown.grand_total_cents += 1000
    expect(
      await refused(
        store.createOrder(fee.base.family.householdId, fee.base.listing.listing.id, feeAddOn)
      )
    ).toMatch(/order event fee does not match the counted orders/)

    // Less saved than the family max leaves: $30.00 of $35.00 used, so a $15.00 dance costs $5.00
    const max = await familyWithPaidOrder(await cappedListing(3500))
    const maxAddOn = buildPayload({
      ...max.base,
      entries: [{ dancerId: max.aoife.id, competitionId: max.trebleJig.id }],
      paidOrders: await paidOrdersOf(db.pool, max.base.family.householdId, max.base.listing)
    })
    expect(maxAddOn.total_cents).toBe(500)
    maxAddOn.total_cents = 1500
    maxAddOn.purchase_snapshot.pricing.breakdown.family_cap_savings_cents = 0
    maxAddOn.purchase_snapshot.pricing.breakdown.grand_total_cents = 1500
    expect(
      await refused(
        store.createOrder(max.base.family.householdId, max.base.listing.listing.id, maxAddOn)
      )
    ).toMatch(/order family max saving does not match the counted orders/)

    // A second late fee for a dancer the paid order already charged one
    const created = await createListing(db.pool)
    const lateListing = {
      ...created,
      feeSchedule: {
        ...created.feeSchedule,
        late_fee_tiers: [
          {
            starts_at: new Date(Date.now() - 86_400_000).toISOString(),
            fee_cents: 2500,
            family_max_cents: null
          }
        ]
      }
    }
    const late = await familyWithPaidOrder(lateListing)
    const lateAddOn = buildPayload({
      ...late.base,
      entries: [{ dancerId: late.aoife.id, competitionId: late.trebleJig.id }],
      paidOrders: await paidOrdersOf(db.pool, late.base.family.householdId, late.base.listing)
    })
    expect(lateAddOn.purchase_snapshot.entries[0].late_fee_cents).toBe(0)
    lateAddOn.entries[0].late_fee_cents = 2500
    lateAddOn.purchase_snapshot.entries[0].late_fee_cents = 2500
    lateAddOn.total_cents += 2500
    lateAddOn.purchase_snapshot.pricing.breakdown.grand_total_cents += 2500
    expect(
      await refused(
        store.createOrder(late.base.family.householdId, late.base.listing.listing.id, lateAddOn)
      )
    ).toMatch(/order late fees do not match the counted orders/)

    for (const family of [fee, max, late])
      expect(await ordersOf(family.base.family.householdId)).toBe(1)
  })

  it('refuses a Submit priced before a late payment was confirmed (paid_orders_changed)', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(addOn)

    // Submit reads the paid orders, then the late payment for the add-on is confirmed
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const payload = buildPayload({
      ...base,
      entries: [{ dancerId: niamh.id, competitionId: reel.id }],
      paidOrders
    })
    expect((await store.confirmOrderPayment(payment(addOn, ready))).result).toBe('confirmed')

    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, payload)
    ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })
    expect(await ordersOf(base.family.householdId)).toBe(2)
  })

  it('gives two add-on Submits at once one draft, and refuses the other', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const results = await Promise.all([
      store.createOrder(
        base.family.householdId,
        base.listing.listing.id,
        buildPayload({
          ...base,
          entries: [{ dancerId: aoife.id, competitionId: trebleJig.id }],
          paidOrders
        })
      ),
      store.createOrder(
        base.family.householdId,
        base.listing.listing.id,
        buildPayload({
          ...base,
          entries: [{ dancerId: niamh.id, competitionId: reel.id }],
          paidOrders
        })
      )
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'refused'])
    expect(results.find((r) => r.status === 'refused')).toMatchObject({
      reason: 'unpaid_order_exists'
    })
    expect(await ordersOf(base.family.householdId)).toBe(2)
  })
})

describe('confirm_free_order', () => {
  it('confirms a $0 add-on without Stripe: paid, numbered where needed, one snapshot and one email', async () => {
    // The first order uses the whole $30.00 family max, so more dances cost nothing
    const { first, base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder(
      await cappedListing(3000)
    )
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id },
      { dancerId: niamh.id, competitionId: reel.id }
    ])
    expect(addOn.payload.total_cents).toBe(0)

    const result = await store.confirmFreeOrder(addOn.registrationId, base.family.householdId)
    if (result.result !== 'confirmed')
      throw new Error(`expected a confirmation, got ${result.result}`)
    expect(result.confirmation_number).toMatch(/^RF-\d{4}-[A-HJKMNP-Z2-9]{5}$/)
    expect(await orderRow(addOn.registrationId)).toMatchObject({
      status: 'paid',
      total_cents: 0,
      confirmation_number: result.confirmation_number,
      hold_expires_at: null,
      checkout_claim_id: null,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      stripe_charge_id: null
    })
    // Only Niamh needed a number: Aoife keeps the one from the first order
    expect(await counts(addOn.registrationId)).toEqual({
      snapshots: 1,
      emails: 1,
      numbers: 1,
      cases: 0
    })
    const { rows: numbers } = await db.pool.query(
      'SELECT dancer_id, registration_id FROM competitor_numbers WHERE feis_listing_id = $1 AND dancer_id = ANY($2) ORDER BY competitor_number',
      [base.listing.listing.id, [aoife.id, niamh.id]]
    )
    expect(numbers).toEqual([
      { dancer_id: aoife.id, registration_id: first.registrationId },
      { dancer_id: niamh.id, registration_id: addOn.registrationId }
    ])
    const {
      rows: [snapshot]
    } = await db.pool.query(
      'SELECT snapshot_data FROM registration_snapshots WHERE registration_id = $1',
      [addOn.registrationId]
    )
    expect(snapshot.snapshot_data.payment).toMatchObject({
      confirmation_number: result.confirmation_number,
      amount_cents: 0,
      currency: 'usd',
      checkout_session_id: null,
      payment_intent_id: null,
      charge_id: null,
      account: null
    })
  })

  it('confirms a $0 order at a feis with no Stripe account', async () => {
    const listing = await freeListing()
    await db.pool.query('UPDATE feis_listings SET stripe_account_id = NULL WHERE id = $1', [
      listing.listing.id
    ])
    const order = await createDraftOrder(db.pool, { listing })
    expect(
      await store.confirmFreeOrder(order.registrationId, order.family.householdId)
    ).toMatchObject({ result: 'confirmed' })
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })

  it('confirms once when Pay is clicked twice; the second click hears it is already confirmed', async () => {
    const order = await createDraftOrder(db.pool, { listing: await freeListing() })
    const results = await Promise.all([
      store.confirmFreeOrder(order.registrationId, order.family.householdId),
      store.confirmFreeOrder(order.registrationId, order.family.householdId)
    ])
    expect(results.map((r) => r.result).sort()).toEqual(['already_confirmed', 'confirmed'])
    expect(await counts(order.registrationId)).toEqual({
      snapshots: 1,
      emails: 1,
      numbers: 1,
      cases: 0
    })
  })

  it('confirms two families at one feis at the same time, with distinct numbers and no deadlock', async () => {
    for (let round = 0; round < 3; round++) {
      const listing = await freeListing()
      const [a, b] = [
        await createDraftOrder(db.pool, { listing }),
        await createDraftOrder(db.pool, { listing })
      ]
      const results = await Promise.all([
        store.confirmFreeOrder(a.registrationId, a.family.householdId),
        store.confirmFreeOrder(b.registrationId, b.family.householdId)
      ])
      expect(results.map((r) => r.result)).toEqual(['confirmed', 'confirmed'])
      const { rows } = await db.pool.query(
        'SELECT DISTINCT competitor_number FROM competitor_numbers WHERE feis_listing_id = $1',
        [listing.listing.id]
      )
      expect(rows).toHaveLength(2)
    }
  })

  it('changes nothing after the organiser stops registration or turns off a competition, or once the hold has passed', async () => {
    const stopped = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [
      stopped.listing.listing.id
    ])
    const disabled = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query('UPDATE feis_competitions SET enabled = false WHERE id = $1', [
      disabled.entries[0].competitionId
    ])
    const lapsed = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query(
      `UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [lapsed.registrationId]
    )

    for (const [order, expected] of [
      [stopped, { result: 'blocked', reason: 'organiser_stopped' }],
      [disabled, { result: 'blocked', reason: 'competition_unavailable' }],
      [lapsed, { result: 'not_confirmable', status: 'draft', hold_expired: true }]
    ] as const) {
      const before = await orderRow(order.registrationId)
      expect(await store.confirmFreeOrder(order.registrationId, order.family.householdId)).toEqual(
        expected
      )
      expect(await orderRow(order.registrationId)).toEqual(before)
      expect(await counts(order.registrationId)).toEqual({
        snapshots: 0,
        emails: 0,
        numbers: 0,
        cases: 0
      })
    }
  })

  it("answers not_found for another family's order, and changes nothing", async () => {
    const order = await createDraftOrder(db.pool, { listing: await freeListing() })
    const stranger = await createFamily(db.pool)
    const before = await orderRow(order.registrationId)
    expect(await store.confirmFreeOrder(order.registrationId, stranger.householdId)).toEqual({
      result: 'not_found'
    })
    expect(await orderRow(order.registrationId)).toEqual(before)
  })

  it('confirms only a $0 draft: an order above 0 goes to checkout instead', async () => {
    const order = await createDraftOrder(db.pool)
    expect(await store.confirmFreeOrder(order.registrationId, order.family.householdId)).toEqual({
      result: 'not_confirmable',
      status: 'draft',
      hold_expired: false
    })
    expect((await orderRow(order.registrationId)).status).toBe('draft')
  })

  it('cancels a $0 draft whose counted orders no longer hold, with no case: no money moved', async () => {
    const { base, aoife, trebleJig } = await familyWithPaidOrder(await cappedListing(3000))
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    // A paid order the add-on didn't count, which only a hand-made order can be now
    const uncounted = await insertLegacyPaidOrder(
      db.pool,
      base.family.householdId,
      base.listing.listing.id,
      []
    )
    expect(await store.confirmFreeOrder(addOn.registrationId, base.family.householdId)).toEqual({
      result: 'paid_orders_changed',
      orders: [uncounted]
    })
    expect((await orderRow(addOn.registrationId)).status).toBe('cancelled')
    expect(await counts(addOn.registrationId)).toEqual({
      snapshots: 0,
      emails: 0,
      numbers: 0,
      cases: 0
    })
  })
})

describe('late payments with several orders', () => {
  it('confirms a late add-on payment whose only other paid order it counted', async () => {
    const { base, aoife, trebleJig } = await familyWithPaidOrder()
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(addOn)
    expect((await store.confirmOrderPayment(payment(addOn, ready))).result).toBe('confirmed')
    expect((await orderRow(addOn.registrationId)).status).toBe('paid')
  })

  it('confirms a payment for an add-on awaiting payment whose counted orders still hold', async () => {
    const { base, aoife, trebleJig } = await familyWithPaidOrder()
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    await payOrder(db.pool, addOn)
    expect(await counts(addOn.registrationId)).toEqual({
      snapshots: 1,
      emails: 1,
      numbers: 0,
      cases: 0
    })
  })

  it('records a case when another order was paid since this one was priced (paid_orders_changed)', async () => {
    const { first, base, aoife, trebleJig } = await familyWithPaidOrder()
    const late = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(late)
    // The family starts again and pays for the same dance, priced without the late order
    const again = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    await payOrder(db.pool, again)

    const result = await store.confirmOrderPayment(payment(late, ready))
    expect(result).toMatchObject({ result: 'exception', reason: 'late_payment_conflict' })
    expect(await conflictWhy(late.registrationId)).toEqual([
      { rule: 'paid_orders_changed', orders: [again.registrationId] }
    ])
    expect((await orderRow(late.registrationId)).status).toBe('expired')
    expect((await orderRow(again.registrationId)).status).toBe('paid')
    expect((await orderRow(first.registrationId)).status).toBe('paid')
    if (result.result !== 'exception') return
    expect(
      await refused(
        db.pool.query('SELECT payments_admin.confirm_late_payment($1, $2)', [
          result.support_ref,
          'Daniel: checking the rule'
        ])
      )
    ).toMatch(/was paid after this order was priced/)
  })

  it('records one case naming both rules when both fail', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const late = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(late)
    const paidSince = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    await payOrder(db.pool, paidSince)
    const unpaid = await createAddOnOrder(db.pool, base, [
      { dancerId: niamh.id, competitionId: reel.id }
    ])

    expect(await store.confirmOrderPayment(payment(late, ready))).toMatchObject({
      result: 'exception',
      reason: 'late_payment_conflict'
    })
    expect(await conflictWhy(late.registrationId)).toEqual([
      { rule: 'unpaid_order_exists', orders: [unpaid.registrationId] },
      { rule: 'paid_orders_changed', orders: [paidSince.registrationId] }
    ])
    expect((await counts(late.registrationId)).cases).toBe(1)
    expect((await orderRow(unpaid.registrationId)).status).toBe('draft')
  })

  it('expires another unpaid order whose hold has passed, then confirms the late payment', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await lateOrder(order)
    const newer = await store.createOrder(
      order.family.householdId,
      order.listing.listing.id,
      buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries })
    )
    if (newer.status !== 'created') throw new Error('expected a newer order')
    // The newer draft's hold passes before the expiry job runs
    await db.pool.query(
      `UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [newer.registration_id]
    )

    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    expect((await orderRow(newer.registration_id)).status).toBe('expired')
  })

  it('confirm_late_payment cancels an unclaimed draft and confirms, keeping a counted paid order', async () => {
    const { first, base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const late = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(late)
    const draft = await createAddOnOrder(db.pool, base, [
      { dancerId: niamh.id, competitionId: reel.id }
    ])
    const conflict = await store.confirmOrderPayment(payment(late, ready))
    if (conflict.result !== 'exception') throw new Error('expected a case')

    const {
      rows: [confirmed]
    } = await db.pool.query('SELECT payments_admin.confirm_late_payment($1, $2) AS result', [
      conflict.support_ref,
      'Daniel: rang the family; they want the late order'
    ])
    expect(confirmed.result).toMatchObject({
      result: 'confirmed',
      cancelled_orders: [draft.registrationId]
    })
    expect((await orderRow(late.registrationId)).status).toBe('paid')
    expect((await orderRow(draft.registrationId)).status).toBe('cancelled')
    expect((await orderRow(first.registrationId)).status).toBe('paid')
    const {
      rows: [audit]
    } = await db.pool.query('SELECT evidence FROM admin_actions WHERE support_ref = $1', [
      conflict.support_ref
    ])
    expect(audit.evidence.counted_orders).toEqual([first.registrationId])
  })

  it('confirms a $0 order racing a late payment, and the late payment is a case whichever runs first', async () => {
    for (let round = 0; round < 3; round++) {
      // The first order uses the whole family max. Treble Jig is outside the max, so adding it costs $15.00
      const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder(
        await cappedListing(3000)
      )
      const outside = await excludeFromFamilyMax(base.listing, trebleJig.id)
      const late = await createAddOnOrder(db.pool, { ...base, listing: outside }, [
        { dancerId: aoife.id, competitionId: trebleJig.id }
      ])
      expect(late.payload.total_cents).toBe(1500)
      const ready = await lateOrder(late)
      const free = await createAddOnOrder(db.pool, { ...base, listing: outside }, [
        { dancerId: niamh.id, competitionId: reel.id }
      ])
      expect(free.payload.total_cents).toBe(0)

      const [freeResult, lateResult] = await Promise.all([
        store.confirmFreeOrder(free.registrationId, base.family.householdId),
        store.confirmOrderPayment(payment(late, ready))
      ])
      expect(freeResult.result).toBe('confirmed')
      expect(lateResult).toMatchObject({ result: 'exception', reason: 'late_payment_conflict' })
      const why = await conflictWhy(late.registrationId)
      expect([
        JSON.stringify([{ rule: 'unpaid_order_exists', orders: [free.registrationId] }]),
        JSON.stringify([{ rule: 'paid_orders_changed', orders: [free.registrationId] }])
      ]).toContain(JSON.stringify(why))
      expect((await orderRow(late.registrationId)).status).toBe('expired')
    }
  })
})
```

In `tests/db/create-order.test.ts`:

(a) Replace:
```ts

  it('refuses a second active order for the same family and feis', async () => {
    const first = await createDraftOrder(db.pool)
```
with:
```ts

  it('refuses a second unpaid order for the same family and feis', async () => {
    const first = await createDraftOrder(db.pool)
```

(b) Replace:
```ts
      status: 'refused',
      reason: 'active_order_exists',
      registration_id: first.registrationId
    })
  })
```
with:
```ts
      status: 'refused',
      reason: 'unpaid_order_exists',
      registration_id: first.registrationId
    })
  })

  it('refuses a total of 1 to 49 cents, and creates totals of 0 and 50 cents', async () => {
    /** A one-dance order whose total is exactly `cents`: no family fee, and a dance at that price */
    async function orderCosting(cents: number) {
      const family = await createFamily(db.pool)
      const created = await createListing(db.pool)
      const listing = {
        ...created,
        feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: cents }
      }
      const dancer = await createDancer(db.pool, family.householdId)
      const payload = buildPayload({
        listing,
        dancers: [dancer],
        entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
      })
      expect(payload.total_cents).toBe(cents)
      return {
        family,
        result: await store.createOrder(family.householdId, listing.listing.id, payload)
      }
    }

    for (const cents of [1, 20, 49]) {
      const { family, result } = await orderCosting(cents)
      expect(result, `${cents} cents`).toEqual({ status: 'refused', reason: 'amount_too_small' })
      expect(await createdFor(family.householdId)).toEqual({ orders: 0, entries: 0 })
    }
    for (const cents of [0, 50]) {
      const { family, result } = await orderCosting(cents)
      expect(result.status, `${cents} cents`).toBe('created')
      expect(await createdFor(family.householdId)).toEqual({ orders: 1, entries: 1 })
    }
  })
```

(c) Replace:
```ts

  it('refuses while a 011 confirmed order is active, as the unique index does', async () => {
    const order = await createDraftOrder(db.pool)
```
with:
```ts

  it('refuses while a 011 confirmed order is held, rather than pricing around it', async () => {
    const order = await createDraftOrder(db.pool)
```

(d) Replace:
```ts
        status: 'refused',
        reason: 'active_order_exists',
        registration_id: order.registrationId
```
with:
```ts
        status: 'refused',
        reason: 'unpaid_order_exists',
        registration_id: order.registrationId
```

In `tests/db/payment-confirmation.test.ts`:

(a) Replace:
```ts

/** The late payment conflict case on an order, found by the explicit check or by the relabel */
async function conflictDetails(registrationId: string) {
```
with:
```ts

/** The details of the one late payment conflict case on an order: why it is a conflict, rule by rule */
async function conflictDetails(registrationId: string) {
```

(b) Replace:
```ts
    expect((await orderRow(order.registrationId)).status).toBe('expired')
    if (newer.status === 'created') expect((await orderRow(newer.registration_id)).status).toBe('draft')
    // The explicit check found it: only the unique index's relabel adds `caught`
    expect(await conflictDetails(order.registrationId)).not.toHaveProperty('caught')
  })
```
with:
```ts
    expect((await orderRow(order.registrationId)).status).toBe('expired')
    if (newer.status !== 'created') return
    expect((await orderRow(newer.registration_id)).status).toBe('draft')
    expect((await conflictDetails(order.registrationId)).why).toEqual([
      { rule: 'unpaid_order_exists', orders: [newer.registration_id] }
    ])
  })
```

(c) Replace:
```ts
    expect(result.reason).toBe('late_payment_conflict')
    // The explicit check found it: only the unique index's relabel adds `caught`
    expect(await conflictDetails(order.registrationId)).not.toHaveProperty('caught')

```
with:
```ts
    expect(result.reason).toBe('late_payment_conflict')
    expect((await conflictDetails(order.registrationId)).why).toEqual([
      { rule: 'unpaid_order_exists', orders: [newer.registration_id] }
    ])

```

(d) Replace:
```ts
      ])
      const confirmedWins = confirmed.result === 'confirmed' && created.status === 'refused'
      const submitWins = created.status === 'created' && confirmed.result === 'exception' && confirmed.reason === 'late_payment_conflict'
      expect(confirmedWins || submitWins).toBe(true)
      // Both take the household-and-feis lock, so the explicit check sees a Submit that won
      if (submitWins) {
        expect(await conflictDetails(order.registrationId)).not.toHaveProperty('caught')
      }
```
with:
```ts
      ])
      // Submit read no paid order, so once the late payment is confirmed its price no longer holds
      const confirmedWins = confirmed.result === 'confirmed' && created.status === 'refused' &&
        created.reason === 'paid_orders_changed'
      const submitWins = created.status === 'created' && confirmed.result === 'exception' && confirmed.reason === 'late_payment_conflict'
      expect(confirmedWins || submitWins).toBe(true)
      // Both take the household-and-feis lock, so the late payment sees a Submit that won
      if (submitWins && created.status === 'created') {
        expect((await conflictDetails(order.registrationId)).why).toEqual([
          { rule: 'unpaid_order_exists', orders: [created.registration_id] }
        ])
      }
```

(e) Replace:
```ts
    const message = await refused(asService(db.pool, async (c) => {
      await c.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-TWICE',
           stripe_payment_intent_id = 'pi_twice'
         WHERE id = $1`, [order.registrationId])
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [order.registrationId])
      await c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [order.registrationId])
```
with:
```ts
    const message = await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [order.registrationId])
      await c.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-TWICE',
           stripe_payment_intent_id = 'pi_twice'
         WHERE id = $1`, [order.registrationId])
      await c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [order.registrationId])
```

In `tests/db/payments-admin.test.ts`:

(a) Replace:
```ts
/** A late payment on an expired order, after the family started a newer one */
async function lateConflict(newer: 'unclaimed' | 'claimed' | 'paid' = 'unclaimed') {
  const order = await createDraftOrder(db.pool)
```
with:
```ts
/** A late payment on an expired order, after the family started a newer one */
async function lateConflict(newer: 'unclaimed' | 'claimed_draft' | 'claimed' | 'paid' = 'unclaimed') {
  const order = await createDraftOrder(db.pool)
```

(b) Replace:
```ts
  const newerOrder: DraftOrderFixture = { ...order, payload, registrationId: created.registration_id }
  if (newer !== 'unclaimed') {
    const newerReady = await readyToPay(db.pool, newerOrder)
    if (newer === 'paid') await store.confirmOrderPayment(payment(newerOrder, newerReady))
  }

  const result = await store.confirmOrderPayment(payment(order, ready))
  if (result.result !== 'exception') throw new Error('expected a late-payment case')
  return { order, newerId: created.registration_id, supportRef: result.support_ref }
}
```
with:
```ts
  const newerOrder: DraftOrderFixture = { ...order, payload, registrationId: created.registration_id }
  let newerReady: Ready | null = null
  if (newer !== 'unclaimed') {
    newerReady = await readyToPay(db.pool, newerOrder, { attach: newer !== 'claimed_draft' })
    if (newer === 'paid') await store.confirmOrderPayment(payment(newerOrder, newerReady))
  }

  const result = await store.confirmOrderPayment(payment(order, ready))
  if (result.result !== 'exception') throw new Error('expected a late-payment case')
  return { order, newerOrder, newerReady, newerId: created.registration_id, supportRef: result.support_ref }
}
```

(c) Replace:
```ts
    expect(audit.evidence.cancelled_orders).toEqual([newerId])

```
with:
```ts
    expect(audit.evidence.cancelled_orders).toEqual([newerId])
    // A first order counted no earlier orders
    expect(audit.evidence.counted_orders).toEqual([])

```

(d) Replace:
```ts

  it('refuses when another order was taken to checkout, even once that checkout has expired', async () => {
    const { supportRef, newerId } = await lateConflict('claimed')
    expect(await refused(confirmLate(supportRef))).toMatch(/was taken to checkout/)

    // The newer order's checkout runs out, but a delayed payment for it could still arrive
    const { rows: [newer] } = await db.pool.query(
      'SELECT checkout_claim_id, stripe_checkout_session_id, checkout_config FROM registrations WHERE id = $1', [newerId])
    await store.expireCheckout({
      registrationId: newerId, claimId: newer.checkout_claim_id, sessionId: newer.stripe_checkout_session_id,
      account: newer.checkout_config.account,
    })
    expect(await refused(confirmLate(supportRef))).toMatch(/was taken to checkout/)
  })

  it('refuses when the family paid twice; that case is closed with a refund', async () => {
    const { supportRef } = await lateConflict('paid')
    expect(await refused(confirmLate(supportRef))).toMatch(/refund one payment instead/)
  })
```
with:
```ts

  it('refuses while another order is at checkout: a claimed draft, or one awaiting payment', async () => {
    for (const newer of ['claimed_draft', 'claimed'] as const) {
      const { order, newerId, supportRef } = await lateConflict(newer)
      const before = await stateOf([order.registrationId, newerId], supportRef)
      expect(await refused(confirmLate(supportRef)), newer).toMatch(/is at checkout, so a payment for it may still arrive/)
      expect(await stateOf([order.registrationId, newerId], supportRef)).toEqual(before)
    }
  })

  it('confirms once the newer checkout expired unpaid, and a later payment for it becomes a case (Decision 12)', async () => {
    const { order, newerOrder, newerReady, newerId, supportRef } = await lateConflict('claimed')
    if (!newerReady) throw new Error('expected the newer order at checkout')
    await store.expireCheckout({
      registrationId: newerId, claimId: newerReady.claimId, sessionId: newerReady.sessionId,
      account: newerReady.config.account,
    })
    const { rows } = await confirmLate(supportRef)
    expect(rows[0].result).toMatchObject({ result: 'confirmed', cancelled_orders: [] })
    expect(await statusOf(order.registrationId)).toBe('paid')
    expect(await statusOf(newerId)).toBe('expired')

    // The newer order was priced without the late one, so its own late payment can't be confirmed by itself
    const late = await store.confirmOrderPayment(payment(newerOrder, newerReady))
    expect(late).toMatchObject({ result: 'exception', reason: 'late_payment_conflict' })
    expect(await statusOf(newerId)).toBe('expired')
    const { rows: [newerCase] } = await db.pool.query(
      `SELECT details FROM payment_exceptions WHERE registration_id = $1 AND reason = 'late_payment_conflict'`, [newerId])
    expect(newerCase.details.why).toEqual([{ rule: 'paid_orders_changed', orders: [order.registrationId] }])
  })

  it("refuses when another order was paid that this one didn't count; that case is closed with a refund", async () => {
    const { order, newerId, supportRef } = await lateConflict('paid')
    expect(await refused(confirmLate(supportRef))).toMatch(/was paid after this order was priced/)
    expect(await statusOf(order.registrationId)).toBe('expired')
    expect(await statusOf(newerId)).toBe('paid')
    await closeCase(supportRef, 'refunded', 're_3QpaidTWICE', 'Daniel: refunded the late payment; the newer order stands')
    expect((await stateOf([order.registrationId], supportRef)).caseRow)
      .toMatchObject({ status: 'resolved', resolution: 'refunded' })
  })
```

In `tests/db/order-integrity.test.ts`:

(a) Replace:
```ts
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
```
with:
```ts
import path from 'node:path'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
```

(b) Replace:
```ts
    confirmation_number = 'RF-TEST-' || substr($1::text, 1, 8), paid_at = now(), hold_expires_at = NULL
  WHERE id = $1`

function newSessionId(): string {
```
with:
```ts
    confirmation_number = 'RF-TEST-' || substr($1::text, 1, 8), paid_at = now(), hold_expires_at = NULL
  WHERE id = $1`

/** _fulfil_order's own order of steps: it names the order in the paid marker, then makes its one paid update */
async function fulfil(c: PoolClient, id: string, sessionId: string | null): Promise<void> {
  await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
  await c.query(FULFIL_SQL, [id, sessionId])
}

function newSessionId(): string {
```

(c) Replace:
```ts
    await claimDraft(draftId)
    // The order is paid in this transaction, but the marker names a different order
    expect(await refused(asService(db.pool, async (c) => {
      await c.query(
```
with:
```ts
    await claimDraft(draftId)
    // The order is paid in this transaction, but by the snapshot the marker names a different order
    expect(await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [draftId])
      await c.query(
```

(d) Replace:
```ts
    await asService(db.pool, async (c) => {
      await c.query(FULFIL_SQL, [draftId, null])
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [draftId])
      await c.query(
```
with:
```ts
    await asService(db.pool, async (c) => {
      await fulfil(c, draftId, null)
      await c.query(
```

(e) Replace:
```ts
    expect((await orderRow(usual.draftId)).status).toBe('pending_payment')
    await asService(db.pool, (c) => c.query(FULFIL_SQL, [usual.draftId, usualSession]))
    await expectPaid(usual.draftId, usualSession)

    // Paid through the order's own claim before Pay attached the session: draft → paid
    const early = await familyWithDraft()
    await claimDraft(early.draftId)
    const earlySession = newSessionId()
    await asService(db.pool, (c) => c.query(FULFIL_SQL, [early.draftId, earlySession]))
    await expectPaid(early.draftId, earlySession)
```
with:
```ts
    expect((await orderRow(usual.draftId)).status).toBe('pending_payment')
    await asService(db.pool, (c) => fulfil(c, usual.draftId, usualSession))
    await expectPaid(usual.draftId, usualSession)

    // Paid through the order's own claim before Pay attached the session: draft → paid
    const early = await familyWithDraft()
    await claimDraft(early.draftId)
    const earlySession = newSessionId()
    await asService(db.pool, (c) => fulfil(c, early.draftId, earlySession))
    await expectPaid(early.draftId, earlySession)
```

(f) Replace:
```ts
    expect((await orderRow(late.draftId)).status).toBe('expired')
    await asService(db.pool, (c) => c.query(FULFIL_SQL, [late.draftId, lateSession]))
    await expectPaid(late.draftId, lateSession)
```
with:
```ts
    expect((await orderRow(late.draftId)).status).toBe('expired')
    await asService(db.pool, (c) => fulfil(c, late.draftId, lateSession))
    await expectPaid(late.draftId, lateSession)
```

(g) Replace:
```ts
        .toMatch(/a paid order needs its checkout claim, checkout session, payment time and confirmation number/)
      expect(await orderRow(id)).toEqual(before)
    }
  })
```
with:
```ts
        .toMatch(/a paid order needs its checkout claim, checkout session, payment time and confirmation number/)
      expect(await orderRow(id)).toEqual(before)
    }
  })

  it('marks an order paid only while the paid marker names it, after the status table and the evidence', async () => {
    const pending = await familyWithDraft()
    const sessionId = await awaitingPayment(pending.draftId)
    const before = await orderRow(pending.draftId)
    // Full payment evidence, but no marker, or a marker naming another order
    for (const marker of [null, randomUUID()]) {
      expect(await refused(asService(db.pool, async (c) => {
        if (marker) await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [marker])
        return c.query(FULFIL_SQL, [pending.draftId, sessionId])
      }))).toMatch(/an order is marked paid only by its confirmation/)
      expect(await orderRow(pending.draftId)).toEqual(before)
    }

    // The marker never lets an illegal move through: cancelled to paid still gets the status table's message
    const cancelled = await familyWithDraft()
    await awaitingPayment(cancelled.draftId)
    await asService(db.pool, (c) => c.query(`UPDATE registrations SET status = 'cancelled' WHERE id = $1`, [cancelled.draftId]))
    expect(await refused(asService(db.pool, (c) => fulfil(c, cancelled.draftId, null))))
      .toMatch(/cannot move from cancelled to paid/)
    expect((await orderRow(cancelled.draftId)).status).toBe('cancelled')
  })

  it('pays a $0 draft with no claim, session, payment intent or charge, and nothing else at $0', async () => {
    const listing = await createListing(db.pool)
    /** A $0 draft, for a family of its own: a family holds one unpaid order per feis */
    const freeDraft = async () => {
      const family = await createFamily(db.pool)
      const dancer = await createDancer(db.pool, family.householdId)
      return insertOrderDirect(db.pool, family.householdId, listing.listing.id,
        [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }], { totalCents: 0 })
    }
    // What _fulfil_order sends for a $0 order: no Stripe details at all
    const FREE_SQL = `UPDATE registrations SET status = 'paid', paid_at = now(),
        confirmation_number = 'RF-FREE-' || substr($1::text, 1, 8), hold_expires_at = NULL
      WHERE id = $1`
    const payFree = (id: string, extra = '') => asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
      if (extra) await c.query(extra, [id])
      return c.query(FREE_SQL, [id])
    })

    const ok = await freeDraft()
    await payFree(ok)
    expect(await orderRow(ok)).toMatchObject({
      status: 'paid', total_cents: 0, checkout_claim_id: null, stripe_checkout_session_id: null,
      stripe_payment_intent_id: null, stripe_charge_id: null
    })

    const refusals: [string, (id: string) => Promise<unknown>][] = [
      // With a claim (claim_checkout never claims under 50 cents, but the guard holds anyway)
      ['a claim', (id) => payFree(id, CLAIM_SQL)],
      // With a payment intent or a charge
      ['a payment intent', (id) => payFree(id, `UPDATE registrations SET stripe_payment_intent_id = 'pi_x' WHERE id = $1`)],
      ['a charge', (id) => payFree(id, `UPDATE registrations SET stripe_charge_id = 'ch_x' WHERE id = $1`)],
      // From expired rather than draft
      ['expired first', (id) => payFree(id, `UPDATE registrations SET status = 'expired' WHERE id = $1`)],
      // Without a confirmation number
      ['no confirmation number', (id) => asService(db.pool, async (c) => {
        await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
        return c.query(`UPDATE registrations SET status = 'paid', paid_at = now() WHERE id = $1`, [id])
      })]
    ]
    for (const [label, attempt] of refusals) {
      const id = await freeDraft()
      const before = await orderRow(id)
      expect(await refused(attempt(id)), label)
        .toMatch(/a free order is paid from a draft, with its payment time and confirmation number and no checkout or payment details/)
      expect(await orderRow(id), label).toEqual(before)
    }
  })
```

In `tests/db/checkout-claims.test.ts`:

(a) Replace:
```ts

/** An order of one 20-cent dance: create_order takes it, but no card payment can be that small */
async function createTinyOrder(): Promise<DraftOrderFixture> {
  const created = await createListing(db.pool)
  await db.pool.query(
    'UPDATE fee_schedules SET event_fee_cents = 0, solo_fee_cents = 20 WHERE feis_listing_id = $1',
    [created.listing.id]
  )
  const listing = {
    ...created,
    feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: 20 }
  }
  const family = await createFamily(db.pool)
  const dancer = await createDancer(db.pool, family.householdId)
  const entries = [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
  const payload = buildPayload({ listing, dancers: [dancer], entries })
  const result = await store.createOrder(family.householdId, listing.listing.id, payload)
  if (result.status !== 'created') throw new Error(`Tiny order was refused: ${result.reason}`)
  const registrationId = result.registration_id
```
with:
```ts

/** An order of one free dance: create_order takes it, and Pay confirms it without a card checkout */
async function createFreeOrder(): Promise<DraftOrderFixture> {
  const created = await createListing(db.pool)
  await db.pool.query(
    'UPDATE fee_schedules SET event_fee_cents = 0, solo_fee_cents = 0 WHERE feis_listing_id = $1',
    [created.listing.id]
  )
  const listing = {
    ...created,
    feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: 0 }
  }
  const family = await createFamily(db.pool)
  const dancer = await createDancer(db.pool, family.householdId)
  const entries = [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
  const payload = buildPayload({ listing, dancers: [dancer], entries })
  const result = await store.createOrder(family.householdId, listing.listing.id, payload)
  if (result.status !== 'created') throw new Error(`Free order was refused: ${result.reason}`)
  const registrationId = result.registration_id
```

(b) Replace:
```ts

  it('starts no checkout for an order below the 50-cent card minimum', async () => {
    const order = await createTinyOrder()
    expect(order.payload.total_cents).toBeLessThan(50)
    expect(await claim(order)).toEqual({ result: 'blocked', reason: 'amount_too_small' })
```
with:
```ts

  it('starts no checkout for a $0 order, which is confirmed without a card', async () => {
    const order = await createFreeOrder()
    expect(order.payload.total_cents).toBe(0)
    expect(await claim(order)).toEqual({ result: 'blocked', reason: 'amount_too_small' })
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm run test:db`
Expected: FAIL. Among the failures: every add-on is refused as `active_order_exists`, `confirm_free_order` and 020 don't exist, `create_order` still takes 1 to 49 cents, `confirm_late_payment` still refuses an order whose checkout expired, and a move into `paid` without the marker still succeeds.

- [ ] **Step 4: Migration 012: the paid marker and the $0 evidence**

In `supabase/migrations/012_order_integrity.sql`:

(a) Replace:
```sql
-- ─── Uniqueness that confirmation relies on ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_checkout_session_unique
```
with:
```sql
-- ─── Uniqueness that confirmation relies on ───
-- One unpaid order per family per feis is 019's idx_registrations_active_unique (draft and pending_payment
-- only). 012–017 never create or drop it, so they apply the same before 019 (live) or after it (the tests);
-- 020 checks it is 019's.
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_checkout_session_unique
```

(b) Replace:
```sql

  -- Payment evidence, checked after the status table so an illegal move still says so
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid'
     AND (NEW.checkout_claim_id IS NULL OR NEW.stripe_checkout_session_id IS NULL
          OR NEW.paid_at IS NULL OR NEW.confirmation_number IS NULL) THEN
    RAISE EXCEPTION 'a paid order needs its checkout claim, checkout session, payment time and confirmation number'
      USING ERRCODE = '42501';
  END IF;
```
with:
```sql

  -- Payment evidence, checked after the status table so an illegal move still says so. An order above 0 is
  -- paid through its own checkout claim and session. An order that costs nothing is confirmed without Stripe
  -- (confirm_free_order, migration 015): straight from draft, with no claim, session, payment intent or charge.
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    IF NEW.total_cents > 0
       AND (NEW.checkout_claim_id IS NULL OR NEW.stripe_checkout_session_id IS NULL
            OR NEW.paid_at IS NULL OR NEW.confirmation_number IS NULL) THEN
      RAISE EXCEPTION 'a paid order needs its checkout claim, checkout session, payment time and confirmation number'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.total_cents = 0
       AND (OLD.status <> 'draft' OR NEW.paid_at IS NULL OR NEW.confirmation_number IS NULL
            OR NEW.checkout_claim_id IS NOT NULL OR NEW.stripe_checkout_session_id IS NOT NULL
            OR NEW.stripe_payment_intent_id IS NOT NULL OR NEW.stripe_charge_id IS NOT NULL) THEN
      RAISE EXCEPTION 'a free order is paid from a draft, with its payment time and confirmation number and no checkout or payment details'
        USING ERRCODE = '42501';
    END IF;
    -- Every move into paid happens inside _fulfil_order (015), which names the order in this marker before its
    -- paid update. Checked last, so a move the status table or the evidence refuses still says why.
    IF current_setting('pre_registration.fulfilling_order', true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'an order is marked paid only by its confirmation' USING ERRCODE = '42501';
    END IF;
  END IF;
```

- [ ] **Step 5: Migration 013: count the paid orders in `create_order`**

In `supabase/migrations/013_create_order.sql`:

(a) Replace:
```sql
-- Payment hardening, part 2: an order, its entries, consent and frozen details are created
-- in one transaction, or not at all. Spec §1, §4.

SET search_path TO pre_registration, public;

-- Serialises everything that can create or revive an active order for one family at one feis
CREATE OR REPLACE FUNCTION lock_household_feis(p_household_id uuid, p_feis_listing_id uuid)
```
with:
```sql
-- Payment hardening, part 2: an order, its entries, consent and frozen details are created
-- in one transaction, or not at all. A family may hold one unpaid order per feis and any number
-- of paid ones; each new order's price counts the paid ones (add-on orders). Spec §1, §4, §14.

SET search_path TO pre_registration, public;

-- Serialises everything that creates an order or makes one paid for one family at one feis
CREATE OR REPLACE FUNCTION lock_household_feis(p_household_id uuid, p_feis_listing_id uuid)
```

(b) Replace:
```sql

CREATE OR REPLACE FUNCTION create_order(p_household_id uuid, p_feis_listing_id uuid, p_order jsonb)
```
with:
```sql

-- The family's paid orders for this feis as a later order counts them (spec §4): the record a price freezes as
-- purchase_snapshot.pricing.prior, rebuilt here from the rows so create_order can compare the two as jsonb.
-- Orders by id, each order's entries by dancer then competition, every key present, and null when the family
-- has no paid order. Whether an entry counted toward the family max is its own order's frozen flag, or for an
-- older order with no purchase snapshot, the competition's flag now.
CREATE OR REPLACE FUNCTION _counted_orders(p_household_id uuid, p_feis_listing_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pre_registration, pg_temp
AS $$
  WITH paid AS (
    SELECT r.id, r.confirmation_number, r.event_fee_cents, r.purchase_snapshot
    FROM registrations r
    WHERE r.household_id = p_household_id AND r.feis_listing_id = p_feis_listing_id AND r.status = 'paid'
  ), entries AS (
    SELECT e.registration_id, e.dancer_id, e.feis_competition_id AS competition_id,
      e.base_fee_cents, e.late_fee_cents,
      NOT coalesce(
        (SELECT (frozen ->> 'exclude_from_family_cap')::boolean
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.purchase_snapshot -> 'competitions') = 'array'
                                        THEN p.purchase_snapshot -> 'competitions' ELSE '[]'::jsonb END) AS frozen
         WHERE frozen ->> 'id' = e.feis_competition_id::text
         LIMIT 1),
        c.exclude_from_family_cap,
        false) AS counts_toward_family_cap
    FROM paid p
    JOIN registration_entries e ON e.registration_id = p.id
    LEFT JOIN feis_competitions c ON c.id = e.feis_competition_id
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM paid) THEN NULL ELSE jsonb_build_object(
    'orders', (
      SELECT jsonb_agg(jsonb_build_object(
          'id', p.id,
          'confirmation_number', p.confirmation_number,
          'event_fee_cents', p.event_fee_cents,
          'entries', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'dancer_id', x.dancer_id,
                'competition_id', x.competition_id,
                'base_fee_cents', x.base_fee_cents,
                'late_fee_cents', x.late_fee_cents,
                'counts_toward_family_cap', x.counts_toward_family_cap)
              ORDER BY x.dancer_id, x.competition_id)
            FROM entries x WHERE x.registration_id = p.id), '[]'::jsonb))
        ORDER BY p.id)
      FROM paid p),
    'event_fee_paid', EXISTS (SELECT 1 FROM paid WHERE event_fee_cents > 0),
    'cappable_paid_cents',
      (SELECT coalesce(sum(base_fee_cents) FILTER (WHERE counts_toward_family_cap), 0) FROM entries),
    'late_fee_dancer_ids', coalesce(
      (SELECT jsonb_agg(d.dancer_id ORDER BY d.dancer_id)
       FROM (SELECT DISTINCT dancer_id FROM entries WHERE late_fee_cents > 0) AS d),
      '[]'::jsonb),
    'late_fees_paid_cents', (SELECT coalesce(sum(late_fee_cents), 0) FROM entries)
  ) END
$$;

REVOKE ALL ON FUNCTION _counted_orders(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION create_order(p_household_id uuid, p_feis_listing_id uuid, p_order jsonb)
```

(c) Replace:
```sql
  v_existing uuid;
  v_id uuid := gen_random_uuid();
  v_hold timestamptz := now() + interval '30 minutes';
  v_snapshot jsonb := p_order -> 'purchase_snapshot';
  v_breakdown jsonb := p_order -> 'purchase_snapshot' -> 'pricing' -> 'breakdown';
  v_mismatches integer;
  v_entry_total integer;
BEGIN
```
with:
```sql
  v_existing uuid;
  v_counted jsonb;
  v_id uuid := gen_random_uuid();
  v_hold timestamptz := now() + interval '30 minutes';
  v_snapshot jsonb := p_order -> 'purchase_snapshot';
  v_breakdown jsonb := p_order -> 'purchase_snapshot' -> 'pricing' -> 'breakdown';
  v_schedule jsonb := p_order -> 'purchase_snapshot' -> 'pricing' -> 'fee_schedule';
  v_mismatches integer;
  v_entry_total integer;
  v_capped integer;
  v_cap integer;
BEGIN
```

(d) Replace:
```sql

  -- A family whose hold has just run out is not blocked by it until the expiry job next runs:
```
with:
```sql

  -- Stripe can't take a card payment of 1 to 49 cents, so no order is made that could never be paid
  -- (Decision 10). A total of 0 is allowed: Pay confirms it without Stripe (confirm_free_order, 015).
  IF (p_order ->> 'total_cents')::integer BETWEEN 1 AND 49 THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'amount_too_small');
  END IF;

  -- A family whose hold has just run out is not blocked by it until the expiry job next runs:
```

(e) Replace:
```sql

  -- Active means what idx_registrations_active_unique (002) means: neither expired nor cancelled. A live
  -- database still holding 011's confirmed orders then refuses here, not with a unique-index error.
  SELECT id INTO v_existing FROM registrations
  WHERE household_id = p_household_id AND feis_listing_id = p_feis_listing_id
    AND status NOT IN ('expired', 'cancelled')
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'active_order_exists', 'registration_id', v_existing);
  END IF;
```
with:
```sql

  -- One unpaid order at a time: in practice the draft or pending_payment order 019's index allows one of. A
  -- live database still holding 011's confirmed orders refuses here too, rather than pricing around one.
  -- Paid orders don't refuse: they're counted below.
  SELECT id INTO v_existing FROM registrations
  WHERE household_id = p_household_id AND feis_listing_id = p_feis_listing_id
    AND status NOT IN ('paid', 'expired', 'cancelled')
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'unpaid_order_exists', 'registration_id', v_existing);
  END IF;

  -- The price must have counted exactly the family's paid orders as they are now. This catches an order paid
  -- between Submit's read and here, such as a late payment, and any record built wrongly. A first order's
  -- prior is null (a missing key counts as null too).
  v_counted := _counted_orders(p_household_id, p_feis_listing_id);
  IF v_counted IS DISTINCT FROM nullif(v_snapshot -> 'pricing' -> 'prior', 'null'::jsonb) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'paid_orders_changed');
  END IF;

  -- An add-on only adds: a dance already in one of the family's paid orders is never bought twice
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_order -> 'entries') AS e(dancer_id uuid, feis_competition_id uuid)
    JOIN registration_entries pe ON pe.dancer_id = e.dancer_id AND pe.feis_competition_id = e.feis_competition_id
    JOIN registrations r ON r.id = pe.registration_id
    WHERE r.household_id = p_household_id AND r.feis_listing_id = p_feis_listing_id AND r.status = 'paid'
  ) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'already_entered');
  END IF;
```

(f) Replace:
```sql
    RAISE EXCEPTION 'order totals do not match the purchase snapshot';
  END IF;
```
with:
```sql
    RAISE EXCEPTION 'order totals do not match the purchase snapshot';
  END IF;

  -- The once-per-family rules hold against the counted orders. The family fee is charged once: 0 when a
  -- counted order paid it, otherwise the frozen schedule's fee
  IF (p_order ->> 'event_fee_cents')::integer IS DISTINCT FROM
     (CASE WHEN coalesce((v_counted ->> 'event_fee_paid')::boolean, false) THEN 0
           ELSE (v_schedule ->> 'event_fee_cents')::integer END) THEN
    RAISE EXCEPTION 'order event fee does not match the counted orders';
  END IF;
  -- No dancer the counted orders charged a late fee is charged one here, and no dancer more than one here
  IF EXISTS (
       SELECT 1 FROM registration_entries e
       WHERE e.registration_id = v_id AND e.late_fee_cents > 0
         AND e.dancer_id::text IN (
           SELECT jsonb_array_elements_text(coalesce(v_counted -> 'late_fee_dancer_ids', '[]'::jsonb))))
     OR EXISTS (
       SELECT 1 FROM registration_entries e
       WHERE e.registration_id = v_id AND e.late_fee_cents > 0
       GROUP BY e.dancer_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'order late fees do not match the counted orders';
  END IF;
  -- The family-max saving is what the frozen family max leaves after the counted orders. Whether this order's
  -- entries count toward it is the snapshot's flag for each competition (the late tier's own max is left to
  -- calculateFees, which is unit-tested)
  v_cap := (v_schedule ->> 'family_cap_cents')::integer;
  SELECT coalesce(sum(e.base_fee_cents), 0)::integer INTO v_capped
  FROM registration_entries e
  LEFT JOIN feis_competitions c ON c.id = e.feis_competition_id
  WHERE e.registration_id = v_id
    AND NOT coalesce(
      (SELECT (frozen ->> 'exclude_from_family_cap')::boolean
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_snapshot -> 'competitions') = 'array'
                                      THEN v_snapshot -> 'competitions' ELSE '[]'::jsonb END) AS frozen
       WHERE frozen ->> 'id' = e.feis_competition_id::text
       LIMIT 1),
      c.exclude_from_family_cap,
      false);
  IF (v_breakdown ->> 'family_cap_savings_cents')::integer IS DISTINCT FROM
     (CASE WHEN v_cap IS NULL THEN 0
           ELSE greatest(0, v_capped - greatest(0, v_cap - coalesce((v_counted ->> 'cappable_paid_cents')::integer, 0)))
      END) THEN
    RAISE EXCEPTION 'order family max saving does not match the counted orders';
  END IF;
```

- [ ] **Step 6: Migration 015: rules (a) and (b), the marker in `_fulfil_order`, and `confirm_free_order`**

In `supabase/migrations/015_payment_confirmation.sql`:

(a) Replace:
```sql
-- Payment hardening, part 4: confirmation is one transaction; anything that doesn't add up becomes
-- a durable case with a reference, an alert and a restricted parent view. Spec §9, §10, §12.

```
with:
```sql
-- Payment hardening, part 4: confirmation is one transaction; anything that doesn't add up becomes
-- a durable case with a reference, an alert and a restricted parent view. An order that costs nothing
-- is confirmed through the same steps without Stripe. Spec §6, §9, §10, §12.

```

(b) Replace:
```sql
BEGIN
  -- One UPDATE sets every payment field with the status: 012 needs the claim, session, payment time and
  -- confirmation number to arrive with 'paid', and freezes them from then on. The snapshot below is
  -- written in this same transaction, as 012's snapshot guard requires (paid_at = now()).
  UPDATE registrations
```
with:
```sql
BEGIN
  -- Every move into paid happens here: 012 lets an order become paid only while this marker names it, and lets
  -- its snapshot in only in the same transaction. Set before the paid update, cleared after the snapshot.
  PERFORM set_config('pre_registration.fulfilling_order', p_registration_id::text, true);

  -- One UPDATE sets every payment field with the status: 012 needs the claim, session, payment time and
  -- confirmation number to arrive with 'paid' (for a $0 order, no claim or session at all), and freezes them
  -- from then on. The snapshot below is written in this same transaction, as 012's snapshot guard requires
  -- (paid_at = now()).
  UPDATE registrations
```

(c) Replace:
```sql

  PERFORM set_config('pre_registration.fulfilling_order', p_registration_id::text, true);
  INSERT INTO registration_snapshots (registration_id, snapshot_data)
```
with:
```sql

  INSERT INTO registration_snapshots (registration_id, snapshot_data)
```

(d) Replace:
```sql

-- ─── Confirmation ───
```
with:
```sql

-- Rule (b) of spec §9, "the price still holds": every other paid order of the family for this feis is one this
-- order's price counted (purchase_snapshot.pricing.prior.orders). Returns the ones it didn't, sorted, so an empty
-- array means the price holds. An order without a purchase snapshot, or with no prior, counted none.
CREATE OR REPLACE FUNCTION _uncounted_paid_orders(p_registration_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = pre_registration, pg_temp
AS $$
  SELECT coalesce(array_agg(other.id ORDER BY other.id), '{}')
  FROM registrations o
  JOIN registrations other
    ON other.household_id = o.household_id AND other.feis_listing_id = o.feis_listing_id
   AND other.id <> o.id AND other.status = 'paid'
  WHERE o.id = p_registration_id
    AND other.id::text NOT IN (
      SELECT counted ->> 'id'
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.purchase_snapshot -> 'pricing' -> 'prior' -> 'orders') = 'array'
             THEN o.purchase_snapshot -> 'pricing' -> 'prior' -> 'orders' ELSE '[]'::jsonb END) AS counted
      WHERE counted ->> 'id' IS NOT NULL)
$$;

-- ─── Confirmation ───
```

(e) Replace:
```sql
  v_number text;
  v_constraint text;
  v_details jsonb := jsonb_build_object('source', p_source, 'claimed_registration_id', p_registration_id);
```
with:
```sql
  v_number text;
  v_unpaid uuid[];
  v_uncounted uuid[];
  v_why jsonb := '[]'::jsonb;
  v_details jsonb := jsonb_build_object('source', p_source, 'claimed_registration_id', p_registration_id);
```

(f) Replace:
```sql

  -- Every check is against the order's own claim, never the listing's current settings
  v_reason := CASE
```
with:
```sql

  -- Payment checks: every check is against the order's own claim, never the listing's current settings
  v_reason := CASE
```

(g) Replace:
```sql
    WHEN v_order.status IN ('cancelled', 'paid') THEN 'order_not_payable'
    -- Active means what idx_registrations_active_unique (002) means, as in create_order (013): neither
    -- expired nor cancelled. A live database may still hold 011's confirmed orders, which count too.
    WHEN v_order.status = 'expired' AND EXISTS (
      SELECT 1 FROM registrations
      WHERE household_id = v_household AND feis_listing_id = v_listing AND id <> p_registration_id
        AND status NOT IN ('expired', 'cancelled'))
      THEN 'late_payment_conflict'
    ELSE NULL
  END;

```
with:
```sql
    WHEN v_order.status IN ('cancelled', 'paid') THEN 'order_not_payable'
    ELSE NULL
  END;

  -- State checks (spec §9 step 4)
  IF v_reason IS NULL THEN
    -- A family who started again isn't held up by a hold the expiry job hasn't ended yet: their other unpaid
    -- orders for this feis whose hold has passed expire first, by the same rule as that job and create_order
    UPDATE registrations
    SET status = 'expired', updated_at = now()
    WHERE household_id = v_household AND feis_listing_id = v_listing AND id <> p_registration_id
      AND status IN ('draft', 'pending_payment') AND hold_expires_at < now();

    -- (a) No other unpaid order. It was priced without this payment, may repeat its dances, and can be paid at any
    -- moment. Only a late payment is judged by it: an unpaid order is itself the family's one unpaid order.
    -- Unpaid means neither paid, expired nor cancelled, so a live database's leftover 011 confirmed order counts.
    IF v_order.status = 'expired' THEN
      SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_unpaid FROM registrations
      WHERE household_id = v_household AND feis_listing_id = v_listing AND id <> p_registration_id
        AND status NOT IN ('paid', 'expired', 'cancelled');
      IF cardinality(v_unpaid) > 0 THEN
        v_why := v_why || jsonb_build_array(jsonb_build_object('rule', 'unpaid_order_exists', 'orders', to_jsonb(v_unpaid)));
      END IF;
    END IF;

    -- (b) The price still holds: every other paid order is one this order counted. Paid orders never change, and
    -- create_order checked the counted orders under this same lock, so this means none was paid since this order
    -- was priced. It can't fail while the order is unpaid, but it is checked whatever the status.
    v_uncounted := _uncounted_paid_orders(p_registration_id);
    IF cardinality(v_uncounted) > 0 THEN
      v_why := v_why || jsonb_build_array(jsonb_build_object('rule', 'paid_orders_changed', 'orders', to_jsonb(v_uncounted)));
    END IF;

    IF jsonb_array_length(v_why) > 0 THEN
      v_reason := 'late_payment_conflict';
      v_details := v_details || jsonb_build_object('why', v_why);
    END IF;
  END IF;

```

(h) Replace:
```sql

  BEGIN
    v_number := _fulfil_order(p_registration_id, p_session_id, p_payment_intent_id, p_charge_id,
      p_amount_cents, lower(p_currency));
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    -- Only the one-active-order rule means "a newer order got there first". Any other uniqueness
    -- failure (numbers, payment reuse) rolls the whole transaction back so Stripe retries it.
    IF v_constraint IS DISTINCT FROM 'idx_registrations_active_unique' THEN
      RAISE;
    END IF;
    v_ref := _record_payment_exception('blocking', 'late_payment_conflict', p_registration_id, p_claim_id,
      p_event_id, p_account, p_session_id, p_payment_intent_id, p_amount_cents, p_currency,
      v_details || jsonb_build_object('caught', v_constraint));
    RETURN jsonb_build_object('result', 'exception', 'reason', 'late_payment_conflict', 'support_ref', v_ref);
  END;

```
with:
```sql

  -- Conflicts are decided only by the checks above, under the lock: since 019 the unpaid-order index covers only
  -- draft and pending_payment, so moving an order into paid can't hit it. Any uniqueness failure here (numbers,
  -- payment reuse) rolls the whole transaction back so Stripe retries it.
  v_number := _fulfil_order(p_registration_id, p_session_id, p_payment_intent_id, p_charge_id,
    p_amount_cents, lower(p_currency));

```

(i) Replace:
```sql

  RETURN jsonb_build_object('result', 'confirmed', 'confirmation_number', v_number);
```
with:
```sql

  RETURN jsonb_build_object('result', 'confirmed', 'confirmation_number', v_number);
END;
$$;

-- A $0 order (typically an add-on once the family max is reached) is confirmed by the database through the same
-- all-or-nothing steps as a payment, with no Stripe (spec §6 step 3a). It never claims a checkout: claim_checkout
-- refuses any total under 50 cents.
CREATE OR REPLACE FUNCTION confirm_free_order(p_registration_id uuid, p_household_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_listing uuid;
  v_order registrations%ROWTYPE;
  v_listing_row feis_listings%ROWTYPE;
  v_uncounted uuid[];
  v_number text;
BEGIN
  SELECT feis_listing_id INTO v_listing FROM registrations
  WHERE id = p_registration_id AND household_id = p_household_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  PERFORM lock_household_feis(p_household_id, v_listing);
  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('result', 'already_confirmed', 'confirmation_number', v_order.confirmation_number);
  END IF;
  IF v_order.status <> 'draft' OR v_order.total_cents <> 0 OR v_order.checkout_claim_id IS NOT NULL
     OR v_order.hold_expires_at IS NULL OR v_order.hold_expires_at <= now() THEN
    RETURN jsonb_build_object('result', 'not_confirmable', 'status', v_order.status,
      'hold_expired', v_order.hold_expires_at IS NOT NULL AND v_order.hold_expires_at <= now());
  END IF;

  -- The organiser can stop new entries right up to this moment, which is a free order's boundary in place of a
  -- claim (spec §5). No Stripe account and no card minimum: nothing is charged. FOR UPDATE, not FOR SHARE as in
  -- claim_checkout: _fulfil_order then locks the listing FOR UPDATE for numbering, and upgrading from a share
  -- lock would deadlock two $0 confirmations at one feis.
  SELECT * INTO v_listing_row FROM feis_listings WHERE id = v_listing FOR UPDATE;
  IF v_listing_row.status <> 'open' THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'organiser_stopped');
  END IF;
  IF EXISTS (
    SELECT 1 FROM registration_entries e
    JOIN feis_competitions c ON c.id = e.feis_competition_id
    WHERE e.registration_id = p_registration_id AND NOT c.enabled
  ) THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'competition_unavailable');
  END IF;

  -- Rule (b) of §9. It can't fail while the order is the family's one unpaid order, but it is checked anyway. No
  -- money moved, so there is no case: the draft is cancelled and the family starts again
  v_uncounted := _uncounted_paid_orders(p_registration_id);
  IF cardinality(v_uncounted) > 0 THEN
    UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
    RETURN jsonb_build_object('result', 'paid_orders_changed', 'orders', to_jsonb(v_uncounted));
  END IF;

  v_number := _fulfil_order(p_registration_id, NULL, NULL, NULL, 0, 'usd');
  RETURN jsonb_build_object('result', 'confirmed', 'confirmation_number', v_number);
```

(j) Replace:
```sql
REVOKE ALL ON FUNCTION _fulfil_order(uuid, text, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_my_payment_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION get_my_payment_reviews(uuid) TO authenticated;
```
with:
```sql
REVOKE ALL ON FUNCTION _fulfil_order(uuid, text, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION _uncounted_paid_orders(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION confirm_free_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_my_payment_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_free_order(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_my_payment_reviews(uuid) TO authenticated;
```

- [ ] **Step 7: Migration 017: the admin rule for several orders (Decision 12)**

In `supabase/migrations/017_payments_admin.sql`:

(a) Replace:
```sql

-- A late payment that conflicts with a newer order: confirm it only if the recorded payment passes
-- every confirmation check, no other order for the family and feis can have a payment on the way,
-- and the payment isn't already on another order. Cancels the newer unpaid order and fulfils the late
-- one, atomically, and closes the case as confirmed_late_payment in the same transaction.
CREATE OR REPLACE FUNCTION payments_admin.confirm_late_payment(p_support_ref text, p_note text)
```
with:
```sql

-- A late payment recorded as a late_payment_conflict case: confirm it only if the recorded payment passes every
-- confirmation check and isn't already on another order, the order is expired, its price still holds (every
-- other paid order of the family for this feis is one it counted), and every other order is paid and counted,
-- cancelled, expired, or an unclaimed draft. The unclaimed drafts are cancelled, since they were priced without
-- the late payment; the late order is fulfilled and the case closed as confirmed_late_payment, all in one
-- transaction (spec §11, Decision 12).
CREATE OR REPLACE FUNCTION payments_admin.confirm_late_payment(p_support_ref text, p_note text)
```

(b) Replace:
```sql
  v_other registrations%ROWTYPE;
  v_cancelled uuid[] := '{}';
```
with:
```sql
  v_other registrations%ROWTYPE;
  v_uncounted uuid[];
  v_counted jsonb;
  v_cancelled uuid[] := '{}';
```

(c) Replace:
```sql

  -- Another order may only be replaced when no payment for it can exist. An order that never had a
  -- checkout claim can't have been paid; one cancelled through Cancel had its checkout settled first.
  -- Anything else that reached checkout, even if it has since expired, could still have a delayed
  -- payment on the way, so the case is resolved by refund instead (spec §11).
  FOR v_other IN
```
with:
```sql

  -- Rule (b) of §9: a paid order this order didn't count was paid after it was priced, so it may repeat this
  -- order's dances, or have made its event fee, family max or late fees wrong. Only a refund is allowed
  v_uncounted := _uncounted_paid_orders(v_order.id);
  IF cardinality(v_uncounted) > 0 THEN
    RAISE EXCEPTION 'order % was paid after this order was priced, so its price no longer holds; refund the late payment instead',
      v_uncounted[1];
  END IF;

  -- Every other order must be paid (and counted, above), cancelled, expired, or an unclaimed draft. A draft with
  -- a claim, or an order awaiting payment, may be paid at any moment and was priced without the late payment, so
  -- only a refund is allowed. A newer order that reached checkout and expired unpaid doesn't block (Decision 12):
  -- if a payment for it arrives later, rule (b) turns it into a case, because it didn't count this order.
  FOR v_other IN
```

(d) Replace:
```sql
  LOOP
    IF v_other.status = 'paid' THEN
      RAISE EXCEPTION 'the family also paid order %; refund one payment instead', v_other.id;
    END IF;
    IF v_other.checkout_claim_id IS NOT NULL AND v_other.status <> 'cancelled' THEN
      RAISE EXCEPTION 'order % was taken to checkout, so a payment for it may still arrive; refund the late payment instead',
        v_other.id;
    END IF;
    IF v_other.status = 'draft' THEN
      UPDATE registrations SET status = 'cancelled' WHERE id = v_other.id;
      v_cancelled := v_cancelled || v_other.id;
    END IF;
  END LOOP;

```
with:
```sql
  LOOP
    IF v_other.status = 'pending_payment' OR (v_other.status = 'draft' AND v_other.checkout_claim_id IS NOT NULL) THEN
      RAISE EXCEPTION 'order % is at checkout, so a payment for it may still arrive; refund the late payment instead',
        v_other.id;
    END IF;
    IF v_other.status NOT IN ('draft', 'paid', 'cancelled', 'expired') THEN
      RAISE EXCEPTION 'order % is %; refund the late payment instead', v_other.id, v_other.status;
    END IF;
    IF v_other.status = 'draft' THEN
      UPDATE registrations SET status = 'cancelled' WHERE id = v_other.id;
      v_cancelled := v_cancelled || v_other.id;
    END IF;
  END LOOP;

  -- The paid orders this order's price counted, for the audit row
  SELECT coalesce(jsonb_agg(counted -> 'id' ORDER BY counted ->> 'id'), '[]'::jsonb) INTO v_counted
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(v_order.purchase_snapshot -> 'pricing' -> 'prior' -> 'orders') = 'array'
         THEN v_order.purchase_snapshot -> 'pricing' -> 'prior' -> 'orders' ELSE '[]'::jsonb END) AS counted;

```

(e) Replace:
```sql
    'cancelled_orders', to_jsonb(v_cancelled),
    'confirmation_number', v_number));
```
with:
```sql
    'cancelled_orders', to_jsonb(v_cancelled),
    'counted_orders', v_counted,
    'confirmation_number', v_number));
```

- [ ] **Step 8: Migration 020: refuse to apply without 019's index**

Create `supabase/migrations/020_assert_unpaid_index.sql`:
```sql
-- 020_assert_unpaid_index.sql
-- Payment hardening, last step: refuse to apply unless one unpaid order per family per feis is enforced by
-- exactly 019's index. 012–017 rely on it and never create or drop it: create_order refuses a second unpaid
-- order with a clear message before the index would, and confirmation decides conflicts by explicit checks,
-- since a move into paid can't touch an index that covers only draft and pending_payment. This file runs last
-- either way: live after 012–017 (019 is already there), and in the tests after 019. Spec §2, Rollout.

DO $$
DECLARE
  v_def text := pg_get_indexdef(to_regclass('pre_registration.idx_registrations_active_unique'));
  v_expected constant text :=
    'CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree '
    '(feis_listing_id, household_id) WHERE (status = ANY (ARRAY[''draft''::text, ''pending_payment''::text]))';
BEGIN
  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'idx_registrations_active_unique must be 019''s one-unpaid-order index, but is: %',
      coalesce(v_def, 'missing');
  END IF;
END $$;
```

- [ ] **Step 9: The order store, the shared message and the refusal messages**

In `src/app/_payments/order-store.ts`:

(a) Replace:
```ts
      status: 'refused'
      reason: 'listing_closed' | 'outside_window' | 'active_order_exists'
      registration_id?: string
    }

```
with:
```ts
      status: 'refused'
      reason:
        | 'listing_closed'
        | 'outside_window'
        | 'amount_too_small'
        | 'unpaid_order_exists'
        | 'paid_orders_changed'
        | 'already_entered'
      registration_id?: string
    }

/** confirm_free_order: a $0 draft confirmed without Stripe (spec §6 step 3a) */
export type FreeOrderResult =
  | { result: 'confirmed' | 'already_confirmed'; confirmation_number: string }
  | { result: 'blocked'; reason: 'organiser_stopped' | 'competition_unavailable' }
  | { result: 'paid_orders_changed'; orders: string[] }
  | { result: 'not_confirmable'; status: RegistrationStatus; hold_expired: boolean }
  | { result: 'not_found' }

```

(b) Replace:
```ts

    async attachCheckoutSession(
```
with:
```ts

    async confirmFreeOrder(registrationId: string, householdId: string): Promise<FreeOrderResult> {
      return (await rpc('confirm_free_order', {
        p_registration_id: registrationId,
        p_household_id: householdId
      })) as FreeOrderResult
    },

    async attachCheckoutSession(
```

In `src/lib/engine/checkout-policy.ts`, replace:
```ts
  return totalCents > 0 && belowCardMinimum(totalCents)
}

export type CheckoutBlock =
```
with:
```ts
  return totalCents > 0 && belowCardMinimum(totalCents)
}

/**
 * create_order's paid_orders_changed: a paid order appeared, or changed what this one should count, after Submit
 * read them. Pay says the same when a $0 order's counted orders no longer hold.
 */
export const PAID_ORDERS_CHANGED_MESSAGE =
  'Your entries for this feis changed while you were choosing. Reload this page and check the total.'

export type CheckoutBlock =
```

In `src/app/feiseanna/[id]/register/actions.ts`:

(a) Replace:
```ts
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { belowCardMinimum, CHECKOUT_BLOCK_MESSAGES } from '@/lib/engine/checkout-policy'
import { clientIpFrom } from '@/lib/engine/consent'
```
with:
```ts
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import {
  belowCardMinimum,
  CHECKOUT_BLOCK_MESSAGES,
  PAID_ORDERS_CHANGED_MESSAGE
} from '@/lib/engine/checkout-policy'
import { clientIpFrom } from '@/lib/engine/consent'
```

(b) Replace:
```ts
  outside_window: 'Registration for this feis has closed.',
  active_order_exists: 'You already have entries for this feis. Reload this page to see them.'
}
```
with:
```ts
  outside_window: 'Registration for this feis has closed.',
  amount_too_small: CHECKOUT_BLOCK_MESSAGES.amount_too_small,
  unpaid_order_exists:
    'You already have entries waiting for payment at this feis. Reload this page to see them.',
  already_entered:
    'One of these dances is already entered and paid for. Reload this page to see your entries.',
  paid_orders_changed: PAID_ORDERS_CHANGED_MESSAGE
}
```

- [ ] **Step 10: Run the tests**

Run: `npm run test:db`
Expected: PASS (10 files, 241 tests). The test database applies every migration in name order, 019 and 020 included, as live will have them.

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass, with no lint errors (24 files, 304 tests).

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/012_order_integrity.sql supabase/migrations/013_create_order.sql \
  supabase/migrations/015_payment_confirmation.sql supabase/migrations/017_payments_admin.sql \
  supabase/migrations/020_assert_unpaid_index.sql src/app/_payments/order-store.ts src/lib/engine/checkout-policy.ts \
  'src/app/feiseanna/[id]/register/actions.ts' tests/db/helpers/fixtures.ts tests/db/add-on-orders.test.ts \
  tests/db/create-order.test.ts tests/db/payment-confirmation.test.ts tests/db/payments-admin.test.ts \
  tests/db/order-integrity.test.ts tests/db/checkout-claims.test.ts
git commit -q -m "feat: add-on and \$0 orders in the order functions; 020 checks the unpaid-order index"
```

---

### Task 20: Add dances after paying, and $0 orders, in the app

Spec §4, §6, §12 and §14, and Decision 13. This ports main's add-on screens onto this branch's order model and keeps the redesigned look. One gate, `canStartOrder`, decides everywhere when a new order can start.

**Files:**
- Modify: `src/lib/payment-review-messages.ts`, `src/lib/entry-display.ts`, `src/lib/email/templates.ts`
- Modify: `src/app/_payments/checkout-workflow.ts`, `src/app/feiseanna/[id]/register/actions.ts`, `src/app/feiseanna/[id]/register/page.tsx`, `src/app/feiseanna/[id]/register/success/page.tsx`, `src/app/dashboard/page.tsx`
- Modify: `src/components/registration/entry-page.tsx`, `src/components/registration/family-receipt.tsx`
- Test: `tests/payment-review-messages.test.ts`, `tests/entry-display.test.ts`, `tests/email-templates.test.ts`, `tests/db/checkout-workflow.test.ts`

**Interfaces:**
- Consumes:
  - from Task 18: `canStartOrder`, `paidOrdersFrom`, `summarisePaidOrders` and `tooSmallToCharge`
  - from Task 19: `confirmFreeOrder`, `PAID_ORDERS_CHANGED_MESSAGE` and the new refusals
  - from Task 17: `DancerEntry`'s `entered`, `FamilyReceipt`'s `title` and `note`, and `PaidReceipt`'s `canAdd`
- Produces:
  - `openMessageAFor(reviews, registrationIds): PaymentReview | null` (`payment-review-messages.ts`)
  - `isAddOnOrder(order): boolean` (`entry-display.ts`): an order whose price counted earlier paid orders
  - `ConfirmationEmailData.addedToEntry`
  - Pay's $0 path in `checkout-workflow.ts`
  - `EntryPageData.paidRegistrations` and `EntryPageData.openMessageA`
  - the success page's `?order=<registration id>`

**Notes:**
- **Submit** reads the family's paid orders with the service role, together with the feis, and passes them to `validateOrderRequest` and `priceOrder` through `paidOrdersFrom`. It refuses only 1 to 49 cents now.
- **Pay** confirms a $0 draft through `confirm_free_order` before any claim. It maps `confirmed` and `already_confirmed` to `paid`, `blocked` to `blocked` with the claim's message, `paid_orders_changed` to `start_again` with the shared message, `not_confirmable` to `start_again`, and `not_found` to an error. After any `paid`, the action sends the queued email as a best effort with `after()`, as the webhook does: a $0 order has no webhook.
- **The entry page:**
  - Paid dances show ticked and locked, as "Entered"; new choices are marked "Adding".
  - The receipt for an add-on is "Adding to your entry", and its estimate counts the paid orders the way Submit does. Submit's own total still wins when they differ.
  - At $0 the button reads "Confirm entries", and the receipt says there's nothing to pay.
  - While a message-A case is open for the feis, message A with its reference replaces choosing and Pay, including Pay for a held order.
  - Every route to the success page names the order (`?order=`).
- **My entries:** each order is its own row, and an add-on is tagged "Added". The feis's newest paid order offers "Add dances" when `canStartOrder` allows it, and receipt links name their order.
- **The email:** an add-on's email says its dances were added to the family's entry (`isAddOnOrder` on its frozen purchase) and lists only its own dances. Numbers were already looked up by feis and dancer (016). A $0 order shows $0.00.
- **No TypeScript writes the order tables:** Task 17 left out `confirmFreeOrder` and `confirmation-number.ts`. Step 11 checks that nothing writes them.

- [ ] **Step 1: Write the failing tests**

In `tests/payment-review-messages.test.ts`:

(a) Replace:
```ts
  messageAWasResolved,
  openReviewsByOrder,
```
with:
```ts
  messageAWasResolved,
  openMessageAFor,
  openReviewsByOrder,
```

(b) Replace:
```ts
    expect(messageAWasResolved([], 'r1')).toBe(false)
  })
})

```
with:
```ts
    expect(messageAWasResolved([], 'r1')).toBe(false)
  })
})

// Decision 13: while the family has an open message-A case for a feis, no new order for it starts
describe('openMessageAFor', () => {
  it("finds the newest open message-A case on one of the feis's orders", () => {
    const newer = review({ registration_id: 'r2', support_ref: 'PAY-NEWER', created_at: '2026-10-16T13:00:00+00:00' })
    expect(openMessageAFor([review(), newer], ['r1', 'r2'])).toEqual(newer)
  })

  it("ignores message B, resolved cases and other feiseanna's orders", () => {
    expect(openMessageAFor([review({ message_code: 'B' })], ['r1'])).toBeNull()
    expect(openMessageAFor([review({ resolved: true })], ['r1'])).toBeNull()
    expect(openMessageAFor([review()], ['r9'])).toBeNull()
  })

  it('finds an open message-A case even when a newer open case on the same order is message B', () => {
    const newerB = review({ message_code: 'B', support_ref: 'PAY-B', created_at: '2026-10-16T13:00:00+00:00' })
    expect(openMessageAFor([review(), newerB], ['r1'])).toEqual(review())
  })
})

```

In `tests/entry-display.test.ts`:

(a) Replace:
```ts
  entryDeadline,
  formatDeadline
} from '@/lib/entry-display'
```
with:
```ts
  entryDeadline,
  formatDeadline,
  isAddOnOrder
} from '@/lib/entry-display'
```

(b) Replace:
```ts
    expect(formatDeadline('2027-02-27T04:59:00Z', 'America/New_York')).toBe('Fri 26 Feb, 11:59 pm')
  })
})

```
with:
```ts
    expect(formatDeadline('2027-02-27T04:59:00Z', 'America/New_York')).toBe('Fri 26 Feb, 11:59 pm')
  })
})

describe('isAddOnOrder', () => {
  it('is an add-on when its price counted earlier paid orders', () => {
    expect(isAddOnOrder({ purchase_snapshot: { pricing: { prior: { orders: [] } } } })).toBe(true)
  })

  it("isn't for a first order, or an order made before purchase snapshots or add-ons", () => {
    expect(isAddOnOrder({ purchase_snapshot: { pricing: { prior: null } } })).toBe(false)
    expect(isAddOnOrder({ purchase_snapshot: { pricing: {} } })).toBe(false)
    expect(isAddOnOrder({ purchase_snapshot: null })).toBe(false)
  })
})

```

In `tests/email-templates.test.ts`, replace:
```ts
    expect(email.html).toContain('https://runfeis.test/dashboard')
  })
```
with:
```ts
    expect(email.html).toContain('https://runfeis.test/dashboard')
  })

  it("says an add-on's dances were added to the family's entry, and lists only its own dances", () => {
    const addOn = {
      ...purchase,
      pricing: { prior: { orders: [{ id: 'o1' }] } }
    } as unknown as PurchaseSnapshot
    const email = confirmationEmail({
      order: { confirmation_number: 'RF-2026-ADD22', total_cents: 0 },
      listing,
      purchase: addOn,
      numbers: [{ dancer_id: 'd1', competitor_number: 214 }],
      baseUrl: 'https://runfeis.test'
    })
    expect(email.subject).toBe('Dances added: Newport Feis')
    expect(email.html).toContain('These dances were added to your entry')
    expect(email.html).toContain('>214<')
    expect(email.html.match(/>210R</g)).toHaveLength(1)
    // A $0 add-on shows what was paid: nothing
    expect(email.html).toContain('$0.00')
  })

  it("keeps a first order's wording", () => {
    const email = confirmationEmail({ order, listing, purchase, numbers: [], baseUrl: 'https://runfeis.test' })
    expect(email.html).not.toContain('added to your entry')
    expect(email.html).toContain('Here are your competitor numbers and dances')
  })
```

In `tests/db/checkout-workflow.test.ts`:

(a) Replace:
```ts
import { createOrderStore, type OrderStore } from '@/app/_payments/order-store'
import { reviewMessage } from '@/lib/payment-review-messages'
```
with:
```ts
import { createOrderStore, type OrderStore } from '@/app/_payments/order-store'
import { CHECKOUT_BLOCK_MESSAGES } from '@/lib/engine/checkout-policy'
import { reviewMessage } from '@/lib/payment-review-messages'
```

(b) Replace:
```ts
  createDraftOrder,
  type DraftOrderFixture
```
with:
```ts
  createDraftOrder,
  createListing,
  type DraftOrderFixture
```

(c) Replace:
```ts

describe('cancel', () => {
```
with:
```ts

// Spec §6 step 3a: a $0 order is confirmed by the database, with no Stripe call and no claim
describe('pay for a $0 order', () => {
  /** A draft order at a feis where the family fee and every dance cost nothing */
  async function freeOrder(): Promise<DraftOrderFixture> {
    const created = await createListing(db.pool)
    await db.pool.query(
      'UPDATE fee_schedules SET event_fee_cents = 0, solo_fee_cents = 0 WHERE feis_listing_id = $1',
      [created.listing.id]
    )
    const listing = { ...created, feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: 0 } }
    const order = await createDraftOrder(db.pool, { listing })
    expect(order.payload.total_cents).toBe(0)
    return order
  }

  it('confirms it without Stripe, and a second click hears it is paid', async () => {
    const stripe = new FakeStripe()
    const order = await freeOrder()
    const first = await pay(deps(stripe), ids(order))
    if (first.kind !== 'paid') throw new Error(`expected paid, got ${first.kind}`)
    expect(first.confirmationNumber).toMatch(/^RF-\d{4}-[A-HJKMNP-Z2-9]{5}$/)
    expect(await pay(deps(stripe), ids(order))).toEqual(first)
    expect(stripe.createCalls).toBe(0)
    expect(await orderRow(order.registrationId)).toMatchObject({
      status: 'paid', checkout_claim_id: null, stripe_checkout_session_id: null
    })
  })

  it('is blocked once the organiser stops registration, and starts again once its hold has passed', async () => {
    const stripe = new FakeStripe()
    const stopped = await freeOrder()
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [stopped.listing.listing.id])
    expect(await pay(deps(stripe), ids(stopped)))
      .toEqual({ kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES.organiser_stopped })

    const lapsed = await freeOrder()
    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [lapsed.registrationId])
    expect(await pay(deps(stripe), ids(lapsed)))
      .toEqual({ kind: 'start_again', message: CHECKOUT_MESSAGES.expired })
    expect(stripe.createCalls).toBe(0)
    for (const order of [stopped, lapsed]) expect((await orderRow(order.registrationId)).status).toBe('draft')
  })
})

describe('cancel', () => {
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test && npm run test:db -- tests/db/checkout-workflow.test.ts`
Expected: FAIL. `openMessageAFor` and `isAddOnOrder` aren't exported, an add-on's email still says "You're entered", and Pay sends a $0 order to the claim, which blocks it.

- [ ] **Step 3: The message-A gate and the add-on test**

In `src/lib/payment-review-messages.ts`, replace:
```ts

/** What the family sees in place of message A once the payments contacts have closed that case */
```
with:
```ts

/**
 * The family's open message-A case for a feis: the newest unresolved case with message A on any of the feis's
 * orders (`registrationIds`). While one is open, no new order for the feis can start (Decision 13).
 */
export function openMessageAFor(
  reviews: PaymentReview[],
  registrationIds: string[]
): PaymentReview | null {
  const ids = new Set(registrationIds)
  let newest: PaymentReview | null = null
  for (const review of reviews) {
    if (review.resolved || review.message_code !== 'A' || !ids.has(review.registration_id)) continue
    if (!newest || Date.parse(review.created_at) > Date.parse(newest.created_at)) newest = review
  }
  return newest
}

/** What the family sees in place of message A once the payments contacts have closed that case */
```

In `src/lib/entry-display.ts`, replace:
```ts
  return `${day}, ${time}`
}

```
with:
```ts
  return `${day}, ${time}`
}

/**
 * Whether an order was an add-on: its price counted the family's earlier paid orders (spec §14). Orders made
 * before add-ons, and every family's first order, have no counted orders.
 */
export function isAddOnOrder(order: {
  purchase_snapshot: { pricing?: { prior?: unknown } } | null
}): boolean {
  return order.purchase_snapshot?.pricing?.prior != null
}

```

- [ ] **Step 4: The add-on email**

In `src/lib/email/templates.ts`:

(a) Replace:
```ts
import { formatCents, formatDate } from '@/lib/format'
```
with:
```ts
import { isAddOnOrder } from '@/lib/entry-display'
import { formatCents, formatDate } from '@/lib/format'
```

(b) Replace:
```ts
  contactEmail: string | null
  baseUrl: string
}

```
with:
```ts
  contactEmail: string | null
  baseUrl: string
  /** An add-on: these dances were added to the family's entry, and its dancers keep their numbers */
  addedToEntry?: boolean
}

```

(c) Replace:
```ts
    contactEmail,
    baseUrl
  } = data
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>You're entered</title></head>
<body style="margin:0;padding:0;background-color:#FBF9F4;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your competitor numbers for ${escapeHtml(feisName)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF9F4;">
```
with:
```ts
    contactEmail,
    baseUrl,
    addedToEntry = false
  } = data
  const intro = addedToEntry
    ? "These dances were added to your entry. Each dancer keeps the competitor number they already had. Keep this email with your first one; you'll need the numbers on the day."
    : "Here are your competitor numbers and dances. Keep this email; you'll need the numbers on the day."
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>You're entered</title></head>
<body style="margin:0;padding:0;background-color:#FBF9F4;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${addedToEntry ? 'Dances added to your entry for' : 'Your competitor numbers for'} ${escapeHtml(feisName)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF9F4;">
```

(d) Replace:
```ts
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3F4441;">
          Here are your competitor numbers and dances. Keep this email; you'll need the numbers on the day.
        </p>
```
with:
```ts
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3F4441;">
          ${intro}
        </p>
```

(e) Replace:
```ts
  const feisName = ctx.listing.name ?? 'your feis'
  return {
    subject: `You're entered: ${feisName}`,
    html: renderConfirmationEmail({
```
with:
```ts
  const feisName = ctx.listing.name ?? 'your feis'
  // An add-on's email lists only its own dances (the purchase is this order's), and says they were added
  const addedToEntry = isAddOnOrder({ purchase_snapshot: ctx.purchase })
  return {
    subject: addedToEntry ? `Dances added: ${feisName}` : `You're entered: ${feisName}`,
    html: renderConfirmationEmail({
```

(f) Replace:
```ts
      contactEmail: ctx.listing.contact_email,
      baseUrl: ctx.baseUrl
    })
```
with:
```ts
      contactEmail: ctx.listing.contact_email,
      baseUrl: ctx.baseUrl,
      addedToEntry
    })
```

- [ ] **Step 5: Pay's $0 path**

In `src/app/_payments/checkout-workflow.ts`:

(a) Replace:
```ts
import { buildCheckoutConfig, type CheckoutConfig } from '@/lib/engine/checkout-config'
import { CHECKOUT_BLOCK_MESSAGES, checkoutBlockReason } from '@/lib/engine/checkout-policy'
import { reviewCodeForReason, reviewMessage } from '@/lib/payment-review-messages'
```
with:
```ts
import { buildCheckoutConfig, type CheckoutConfig } from '@/lib/engine/checkout-config'
import {
  CHECKOUT_BLOCK_MESSAGES,
  checkoutBlockReason,
  PAID_ORDERS_CHANGED_MESSAGE
} from '@/lib/engine/checkout-policy'
import { reviewCodeForReason, reviewMessage } from '@/lib/payment-review-messages'
```

(b) Replace:
```ts
  }
  if (isClaimed(order)) return resumeClaim(deps, order)
```
with:
```ts
  }
  // A $0 order is confirmed by the database without Stripe, and never claims a checkout (spec §6 step 3a)
  if (order.status === 'draft' && order.total_cents === 0) return confirmFree(deps, order)
  if (isClaimed(order)) return resumeClaim(deps, order)
```

(c) Replace:
```ts
        : reread(deps, order)
    case 'not_found':
```
with:
```ts
        : reread(deps, order)
    case 'not_found':
      return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
  }
}

/** Pay for an order that costs nothing: confirm_free_order, and what each answer means for the family */
async function confirmFree(deps: CheckoutDeps, order: CheckoutOrder): Promise<PayResult> {
  const result = await deps.store.confirmFreeOrder(order.id, order.household_id)
  switch (result.result) {
    case 'confirmed':
    case 'already_confirmed':
      return { kind: 'paid', confirmationNumber: result.confirmation_number }
    case 'blocked':
      return { kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES[result.reason] }
    case 'paid_orders_changed':
      return { kind: 'start_again', message: PAID_ORDERS_CHANGED_MESSAGE }
    case 'not_confirmable':
      return { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }
    case 'not_found':
```

- [ ] **Step 6: Submit prices on top of the paid orders; Pay sends the email**

In `src/app/feiseanna/[id]/register/actions.ts`:

(a) Replace:
```ts
import { headers } from 'next/headers'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import {
  belowCardMinimum,
  CHECKOUT_BLOCK_MESSAGES,
  PAID_ORDERS_CHANGED_MESSAGE
} from '@/lib/engine/checkout-policy'
```
with:
```ts
import { headers } from 'next/headers'
import { after } from 'next/server'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import {
  CHECKOUT_BLOCK_MESSAGES,
  PAID_ORDERS_CHANGED_MESSAGE,
  tooSmallToCharge
} from '@/lib/engine/checkout-policy'
```

(b) Replace:
```ts
  buildCreateOrderPayload,
  priceOrder,
  type CreateOrderPayload
} from '@/lib/engine/purchase-snapshot'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isHouseholdComplete, REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'
import { checkoutDeps } from '@/app/_payments/checkout-deps'
import { cancel, pay, type CancelResult, type PayResult } from '@/app/_payments/checkout-workflow'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
```
with:
```ts
  buildCreateOrderPayload,
  paidOrdersFrom,
  priceOrder,
  type CreateOrderPayload,
  type PaidOrderRow
} from '@/lib/engine/purchase-snapshot'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isHouseholdComplete, REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'
import { checkoutDeps } from '@/app/_payments/checkout-deps'
import { cancel, pay, type CancelResult, type PayResult } from '@/app/_payments/checkout-workflow'
import { notificationDeps } from '@/app/_payments/notification-deps'
import { processNotifications } from '@/app/_payments/notification-worker'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
```

(c) Replace:
```ts
async function loadOrderInputs(service: ServiceClient, feisListingId: string, householdId: string) {
  const [listing, feeSchedule, dancers, competitions] = await Promise.all([
    service.from('feis_listings').select('*').eq('id', feisListingId).maybeSingle(),
```
with:
```ts
async function loadOrderInputs(service: ServiceClient, feisListingId: string, householdId: string) {
  const [listing, feeSchedule, dancers, competitions, paidOrders] = await Promise.all([
    service.from('feis_listings').select('*').eq('id', feisListingId).maybeSingle(),
```

(d) Replace:
```ts
        .range(from, to)
    )
  ])
  const failed = listing.error ?? feeSchedule.error ?? dancers.error
  if (failed) throw new Error(failed.message)
  return {
    listing: listing.data as FeisListing | null,
    feeSchedule: feeSchedule.data as FeeSchedule | null,
    dancers: (dancers.data ?? []) as OrderDancer[],
    competitions
  }
```
with:
```ts
        .range(from, to)
    ),
    // The family's paid orders for this feis: a new order is priced on top of them (spec §4)
    service
      .from('registrations')
      .select(
        'id, confirmation_number, event_fee_cents, purchase_snapshot, registration_entries(dancer_id, feis_competition_id, base_fee_cents, late_fee_cents)'
      )
      .eq('feis_listing_id', feisListingId)
      .eq('household_id', householdId)
      .eq('status', 'paid')
  ])
  const failed = listing.error ?? feeSchedule.error ?? dancers.error ?? paidOrders.error
  if (failed) throw new Error(failed.message)
  return {
    listing: listing.data as FeisListing | null,
    feeSchedule: feeSchedule.data as FeeSchedule | null,
    dancers: (dancers.data ?? []) as OrderDancer[],
    competitions,
    paidOrderRows: (paidOrders.data ?? []) as unknown as PaidOrderRow[]
  }
```

(e) Replace:
```ts
  if (!loaded) return { error: 'The feis details could not be loaded. Please try again.' }
  const { listing, feeSchedule, dancers, competitions } = loaded
  if (!listing) return { error: 'This feis could not be found.' }
  if (!feeSchedule) return { error: "This feis hasn't set its fees yet, so entries can't be paid." }

  const now = new Date()
  const levels = listing.syllabus_snapshot?.levels ?? []
  const validation = validateOrderRequest({
    now,
    householdId: ctx.household.id,
    listing: { ...listing, levels },
    dancers,
    competitions,
    entries: input.entries
  })
```
with:
```ts
  if (!loaded) return { error: 'The feis details could not be loaded. Please try again.' }
  const { listing, feeSchedule, dancers, competitions, paidOrderRows } = loaded
  if (!listing) return { error: 'This feis could not be found.' }
  if (!feeSchedule) return { error: "This feis hasn't set its fees yet, so entries can't be paid." }

  const now = new Date()
  const levels = listing.syllabus_snapshot?.levels ?? []
  // What the family's paid orders covered, each entry with its own order's family-max flag
  const paidOrders = paidOrdersFrom(paidOrderRows, competitions)
  const validation = validateOrderRequest({
    now,
    householdId: ctx.household.id,
    listing: { ...listing, levels },
    dancers,
    competitions,
    entries: input.entries,
    paidOrders
  })
```

(f) Replace:
```ts
      entries: input.entries,
      feeSchedule
    })
```
with:
```ts
      entries: input.entries,
      feeSchedule,
      paidOrders
    })
```

(g) Replace:
```ts

  // Stripe can't take a card payment this small, so no order is made that could never be paid.
  // Pay's claim blocks such an order too, with the same message.
  if (belowCardMinimum(payload.total_cents)) {
    return { error: CHECKOUT_BLOCK_MESSAGES.amount_too_small }
```
with:
```ts

  // Stripe can't take a card payment of 1 to 49 cents, so no order is made that could never be paid
  // (Decision 10); create_order refuses it too. A $0 order is made: Pay confirms it without Stripe.
  if (tooSmallToCharge(payload.total_cents)) {
    return { error: CHECKOUT_BLOCK_MESSAGES.amount_too_small }
```

(h) Replace:
```ts
  try {
    return await pay(checkoutDeps(), { registrationId, householdId: ctx.household.id })
  } catch (err) {
```
with:
```ts
  try {
    const result = await pay(checkoutDeps(), { registrationId, householdId: ctx.household.id })
    if (result.kind === 'paid') {
      // A confirmation queues its email. Send it now as a best effort, as the webhook does: a $0 order
      // has no webhook, and the 5-minute job retries anything that fails
      after(() =>
        processNotifications(notificationDeps(), { limit: 5 }).catch((err) =>
          console.error('[NOTIFICATIONS] immediate send failed:', err)
        )
      )
    }
    return result
  } catch (err) {
```

- [ ] **Step 7: The register page loads every paid order and the family's open message A**

In `src/app/feiseanna/[id]/register/page.tsx`:

(a) Replace:
```tsx
import { isHouseholdComplete } from '@/lib/household'
import { getExistingRegistration } from './actions'
```
with:
```tsx
import { isHouseholdComplete } from '@/lib/household'
import { openMessageAFor, type PaymentReview } from '@/lib/payment-review-messages'
import { getExistingRegistration } from './actions'
```

(b) Replace:
```tsx

        const [listingResult, feesResult, competitions, dancersResult, heldResult, paidResult] =
          await Promise.all([
            supabase
              .from('feis_listings')
              .select('*')
              .eq('id', feisId)
              .eq('status', 'open')
              .single(),
            supabase.from('fee_schedules').select('*').eq('feis_listing_id', feisId).single(),
            // Every enabled competition, read in pages: PostgREST returns at most 1000 rows per
            // request, and Submit judges eligibility against the feis's whole list
            fetchAllRows<FeisCompetition>((from, to) =>
              supabase
                .from('feis_competitions')
                .select('*', { count: 'exact' })
                .eq('feis_listing_id', feisId)
                .eq('enabled', true)
                .order('sort_order', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to)
            ),
            supabase
              .from('dancers')
              .select('*, dance_levels:dancer_dance_levels(*)')
              .eq('household_id', household.id)
              .eq('is_active', true)
              .order('date_of_birth', { ascending: true }),
            getExistingRegistration(feisId),
            supabase
              .from('registrations')
              .select(`${REGISTRATION_COLUMNS}, registration_entries(*)`)
              .eq('feis_listing_id', feisId)
              .eq('household_id', household.id)
              .eq('status', 'paid')
              .maybeSingle()
          ])

```
with:
```tsx

        const [
          listingResult,
          feesResult,
          competitions,
          dancersResult,
          heldResult,
          paidResult,
          ordersResult,
          reviewsResult
        ] = await Promise.all([
          supabase.from('feis_listings').select('*').eq('id', feisId).eq('status', 'open').single(),
          supabase.from('fee_schedules').select('*').eq('feis_listing_id', feisId).single(),
          // Every enabled competition, read in pages: PostgREST returns at most 1000 rows per
          // request, and Submit judges eligibility against the feis's whole list
          fetchAllRows<FeisCompetition>((from, to) =>
            supabase
              .from('feis_competitions')
              .select('*', { count: 'exact' })
              .eq('feis_listing_id', feisId)
              .eq('enabled', true)
              .order('sort_order', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
          ),
          supabase
            .from('dancers')
            .select('*, dance_levels:dancer_dance_levels(*)')
            .eq('household_id', household.id)
            .eq('is_active', true)
            .order('date_of_birth', { ascending: true }),
          getExistingRegistration(feisId),
          // Every paid order for this feis, oldest first: anything chosen now is added on top
          supabase
            .from('registrations')
            .select(`${REGISTRATION_COLUMNS}, registration_entries(*)`)
            .eq('feis_listing_id', feisId)
            .eq('household_id', household.id)
            .eq('status', 'paid')
            .order('paid_at', { ascending: true }),
          // The family's orders for this feis, and its payment cases: while a message-A case is
          // open on one of them, no new order starts (Decision 13)
          supabase
            .from('registrations')
            .select('id')
            .eq('feis_listing_id', feisId)
            .eq('household_id', household.id),
          supabase.rpc('get_my_payment_reviews', { p_registration_id: null })
        ])

```

(c) Replace:
```tsx
        }
        for (const result of [dancersResult, paidResult]) {
          if (result.error) throw result.error
```
with:
```tsx
        }
        for (const result of [dancersResult, paidResult, ordersResult, reviewsResult]) {
          if (result.error) throw result.error
```

(d) Replace:
```tsx
            heldRegistration: (heldResult.registration as RegistrationWithEntries | null) ?? null,
            paidRegistration: (paidResult.data as RegistrationWithEntries | null) ?? null,
            numbers,
            expiredHold: heldResult.expired === true
          }
```
with:
```tsx
            heldRegistration: (heldResult.registration as RegistrationWithEntries | null) ?? null,
            paidRegistrations: (paidResult.data ?? []) as RegistrationWithEntries[],
            numbers,
            expiredHold: heldResult.expired === true,
            openMessageA: openMessageAFor(
              (reviewsResult.data ?? []) as PaymentReview[],
              (ordersResult.data ?? []).map((order) => order.id)
            )
          }
```

- [ ] **Step 8: The entry page**

In `src/components/registration/entry-page.tsx`:

(a) Replace:
```tsx
import { formatCents, parseLocalDate } from '@/lib/format'
import { calculateFees, getActiveLateTier } from '@/lib/engine/fee-calculator'
import { calculateAgeOnDate, getEligibleCompetitions } from '@/lib/engine/eligibility'
import {
  ageCutoffDateFor,
  toDancerProfile,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import { feeEntriesFor } from '@/lib/engine/purchase-snapshot'
import { dancerLevelSummary, entryDeadline, entryFeesPerDancer } from '@/lib/entry-display'
import {
```
with:
```tsx
import { formatCents, parseLocalDate } from '@/lib/format'
import { calculateFees, getActiveLateTier, summarisePaidOrders } from '@/lib/engine/fee-calculator'
import { calculateAgeOnDate, getEligibleCompetitions } from '@/lib/engine/eligibility'
import {
  ageCutoffDateFor,
  canStartOrder,
  toDancerProfile,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import { feeEntriesFor, paidOrdersFrom } from '@/lib/engine/purchase-snapshot'
import { dancerLevelSummary, entryDeadline, entryFeesPerDancer } from '@/lib/entry-display'
import { reviewMessage, type PaymentReview } from '@/lib/payment-review-messages'
import {
```

(b) Replace:
```tsx
  heldRegistration: RegistrationWithEntries | null
  paidRegistration: RegistrationWithEntries | null
  numbers: Record<string, number>
  expiredHold: boolean
}
```
with:
```tsx
  heldRegistration: RegistrationWithEntries | null
  /** Orders already paid for this feis, oldest first; anything chosen now is added on top */
  paidRegistrations: RegistrationWithEntries[]
  numbers: Record<string, number>
  expiredHold: boolean
  /** An open message-A case on one of the family's orders for this feis: no new order can start */
  openMessageA: PaymentReview | null
}
```

(c) Replace:
```tsx
export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
  const { listing, feeSchedule, competitions, dancers, paidRegistration, numbers } = data
  const levels = listing.syllabus_snapshot?.levels ?? []
  // The cutoff Submit uses: the organiser's date, otherwise January 1 of the feis year
  const ageCutoffDate = useMemo(() => ageCutoffDateFor(listing, new Date()), [listing])
  const deadline = entryDeadline(listing)

  const [cart, setCart] = useState<Cart>(() => cartFrom(paidRegistration ?? data.heldRegistration))
  const [editingId, setEditingId] = useState<string | null>(null)
```
with:
```tsx
export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
  const { listing, feeSchedule, competitions, dancers, paidRegistrations, numbers, openMessageA } =
    data
  const levels = listing.syllabus_snapshot?.levels ?? []
  // The cutoff Submit uses: the organiser's date, otherwise January 1 of the feis year
  const ageCutoffDate = useMemo(() => ageCutoffDateFor(listing, new Date()), [listing])
  const deadline = entryDeadline(listing)

  // Only what's being bought now: dances already paid for show as entered, not in the cart
  const [cart, setCart] = useState<Cart>(() => cartFrom(data.heldRegistration))
  const [editingId, setEditingId] = useState<string | null>(null)
```

(d) Replace:
```tsx

  const paid = paidRegistration !== null
  const held = registrationId !== null
  const canEdit = !paid && !held && !deadline.closed && feeSchedule !== null

  const competitionById = useMemo(() => new Map(competitions.map((c) => [c.id, c])), [competitions])

```
with:
```tsx

  const paid = paidRegistrations.length > 0
  const held = registrationId !== null
  // The one gate for a new order, a first order or an add-on (spec §14): registration is open, the family
  // holds no unpaid order, and no message-A case is open for this feis
  const canStart = canStartOrder({
    listing,
    now: new Date(),
    hasUnpaidOrder: held,
    hasOpenMessageA: openMessageA !== null
  })
  const canEdit = canStart && feeSchedule !== null

  const competitionById = useMemo(() => new Map(competitions.map((c) => [c.id, c])), [competitions])

  // Dances already entered and paid for, per dancer, across every paid order
  const entered: Cart = useMemo(() => {
    const map: Cart = {}
    for (const registration of paidRegistrations) {
      for (const [dancerId, ids] of Object.entries(cartFrom(registration))) {
        map[dancerId] = [...(map[dancerId] ?? []), ...ids]
      }
    }
    return map
  }, [paidRegistrations])
  const paidTotalCents = paidRegistrations.reduce((sum, r) => sum + r.total_cents, 0)
  const latestPaid = paidRegistrations[paidRegistrations.length - 1] ?? null

  // What the paid orders already covered, counted as Submit counts them, so the estimate doesn't charge the
  // family fee twice and the family max runs across orders. Submit's own price is the one that counts.
  const prior = useMemo(
    () => summarisePaidOrders(paidOrdersFrom(paidRegistrations, competitions)),
    [paidRegistrations, competitions]
  )

```

(e) Replace:
```tsx
      feeSchedule && requestedEntries.length > 0
        ? calculateFees(feeSchedule, feeEntriesFor(requestedEntries, competitionById))
        : null,
    [feeSchedule, requestedEntries, competitionById]
  )
```
with:
```tsx
      feeSchedule && requestedEntries.length > 0
        ? calculateFees(
            feeSchedule,
            feeEntriesFor(requestedEntries, competitionById),
            new Date(),
            prior
          )
        : null,
    [feeSchedule, requestedEntries, competitionById, prior]
  )
```

(f) Replace:
```tsx

  // Where a family goes once Stripe has taken a payment for the order: the success page
  // confirms it, or says what happens next
  const successHref = `/feiseanna/${feisId}/register/success`

```
with:
```tsx

  // Where a family goes once an order is paid or confirmed, or Stripe may have taken the payment: the
  // success page for that order confirms it, or says what happens next
  const successHref = (orderId: string) =>
    `/feiseanna/${feisId}/register/success?order=${encodeURIComponent(orderId)}`

```

(g) Replace:
```tsx
        case 'checking':
          // Stripe has, or may have, the money: the success page says what happens next
          leaving = true
          window.location.href = successHref
          return
```
with:
```tsx
        case 'checking':
          // Confirmed (a $0 order is confirmed without Stripe), or Stripe has or may have the money: the
          // success page says what happens next
          leaving = true
          window.location.href = successHref(regId)
          return
```

(h) Replace:
```tsx
          leaving = true
          window.location.href = successHref
          return
```
with:
```tsx
          leaving = true
          window.location.href = successHref(registrationId)
          return
```

(i) Replace:
```tsx
                      .filter((c): c is FeisCompetition => c !== undefined)}
                    feeSchedule={feeSchedule}
                    editing={canEdit && editingId === dancer.id}
                    canEdit={canEdit}
                    lockedNote={
                      held
                        ? 'To add dances, choose Change entries under the family total.'
                        : undefined
                    }
```
with:
```tsx
                      .filter((c): c is FeisCompetition => c !== undefined)}
                    entered={(entered[dancer.id] ?? [])
                      .map((id) => competitionById.get(id))
                      .filter((c): c is FeisCompetition => c !== undefined)}
                    feeSchedule={feeSchedule}
                    editing={canEdit && editingId === dancer.id}
                    canEdit={canEdit}
                    lockedNote={
                      openMessageA
                        ? 'No new entries while we check your payment.'
                        : held
                          ? 'To add dances, choose Change entries under the family total.'
                          : undefined
                    }
```

(j) Replace:
```tsx

        {paid ? (
          <PaidReceipt
            familyName={data.familyName}
            totalCents={paidRegistration.total_cents}
            confirmationNumber={paidRegistration.confirmation_number}
            contactEmail={listing.contact_email}
            cardsHref={`/dashboard/numbers/${feisId}`}
            canAdd={false}
          />
```
with:
```tsx

        {openMessageA ? (
          // Message A says not to pay again: nothing here offers a new order, or Pay for a held one
          <aside className="feis-receipt px-[18px] py-5">
            <h2 className="text-[22px] font-extrabold [font-stretch:75%]">
              We&apos;re checking your registration
            </h2>
            <p role="status" className="mt-2 text-sm">
              {reviewMessage('A', openMessageA.support_ref)}
            </p>
            <Link href="/dashboard" className="feis-btn feis-btn-outline mt-4">
              All my entries
            </Link>
          </aside>
        ) : paid && dancesChosen === 0 && !held ? (
          <PaidReceipt
            familyName={data.familyName}
            totalCents={paidTotalCents}
            confirmationNumber={latestPaid?.confirmation_number ?? null}
            contactEmail={listing.contact_email}
            cardsHref={`/dashboard/numbers/${feisId}`}
            canAdd={canEdit}
          />
```

(k) Replace:
```tsx
              familyName={data.familyName}
              lines={receiptLines}
```
with:
```tsx
              familyName={data.familyName}
              title={paid ? 'Adding to your entry' : undefined}
              note={
                paid
                  ? `You've already paid ${formatCents(paidTotalCents)} for this feis. This is only for what you're adding.`
                  : undefined
              }
              lines={receiptLines}
```

(l) Replace:
```tsx

      {!paid && dancesChosen > 0 && !receiptVisible && (
        <div className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-[var(--color-feis-charcoal)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] text-white lg:hidden">
```
with:
```tsx

      {dancesChosen > 0 && !receiptVisible && !openMessageA && (
        <div className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-[var(--color-feis-charcoal)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] text-white lg:hidden">
```

(m) Replace:
```tsx
          >
            Review and pay
          </a>
```
with:
```tsx
          >
            {totalCents === 0 ? 'Review and confirm' : 'Review and pay'}
          </a>
```

- [ ] **Step 9: The receipt at $0**

In `src/components/registration/family-receipt.tsx`:

(a) Replace:
```tsx
  const nothingChosen = lines.length === 0

```
with:
```tsx
  const nothingChosen = lines.length === 0
  // An order that costs nothing (typically an add-on once the family max is reached) is confirmed, not paid
  const free = !nothingChosen && totalCents === 0

```

(b) Replace:
```tsx

      {held && <HoldCountdown holdExpiresAt={holdExpiresAt} />}
```
with:
```tsx

      {free && (
        <p className="mt-3.5 text-[13px]">
          There&apos;s nothing to pay for these dances. Confirm them to enter.
        </p>
      )}

      {held && <HoldCountdown holdExpiresAt={holdExpiresAt} />}
```

(c) Replace:
```tsx
        {loading
          ? 'Opening payment…'
          : paymentStarted
            ? 'Return to payment'
            : `Pay ${formatCents(totalCents)}`}
      </button>
```
with:
```tsx
        {loading
          ? free
            ? 'Confirming…'
            : 'Opening payment…'
          : paymentStarted
            ? 'Return to payment'
            : free
              ? 'Confirm entries'
              : `Pay ${formatCents(totalCents)}`}
      </button>
```

(d) Replace:
```tsx

      {!held && !nothingChosen && (
        <p className="mt-2.5 text-[12.5px] text-muted-foreground">
```
with:
```tsx

      {!held && !nothingChosen && !free && (
        <p className="mt-2.5 text-[12.5px] text-muted-foreground">
```

- [ ] **Step 10: The success page and My entries, with several orders per feis**

In `src/app/feiseanna/[id]/register/success/page.tsx`:

(a) Replace:
```tsx
import { emailIsConfigured } from '@/lib/email/email-config'
import {
```
with:
```tsx
import { emailIsConfigured } from '@/lib/email/email-config'
import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'
import { isAddOnOrder } from '@/lib/entry-display'
import {
```

(b) Replace:
```tsx
  params: Promise<{ id: string }>
  searchParams: Promise<{ session_id?: string }>
}

type ServerClient = Awaited<ReturnType<typeof createClient>>
type OrderSummary = { id: string; status: RegistrationStatus; confirmation_number: string | null }

/** What the page tells the family, most important first */
type View =
  | { kind: 'paid'; confirmationNumber: string | null }
  | { kind: 'case'; code: PaymentReview['message_code']; message: string }
```
with:
```tsx
  params: Promise<{ id: string }>
  searchParams: Promise<{ session_id?: string; order?: string }>
}

type ServerClient = Awaited<ReturnType<typeof createClient>>
type OrderSummary = {
  id: string
  status: RegistrationStatus
  confirmation_number: string | null
  total_cents: number
  purchase_snapshot: Pick<PurchaseSnapshot, 'pricing'> | null
}

/** What the page tells the family, most important first */
type View =
  | { kind: 'paid'; confirmationNumber: string | null; addedToEntry: boolean; totalCents: number }
  | { kind: 'case'; code: PaymentReview['message_code']; message: string }
```

(c) Replace:
```tsx
/**
 * The order this page is about: the one this checkout belongs to, otherwise the family's latest
 * for this feis. The session id from the URL only picks which of the family's own orders to show
 * (their own client can't read anyone else's); the sync never uses it.
 */
async function findOrder(
  supabase: ServerClient,
  householdId: string,
  feisId: string,
  sessionId: string | null
): Promise<OrderSummary | null | 'error'> {
  const orders = () =>
    supabase
      .from('registrations')
      .select('id, status, confirmation_number')
      .eq('household_id', householdId)
      .eq('feis_listing_id', feisId)

  if (sessionId) {
```
with:
```tsx
/**
 * The order this page is about: the one named by `order` (a registration id, from the entry page and My
 * entries), or on the return from Stripe the one this checkout belongs to, otherwise the family's latest for
 * this feis. Either id only picks which of the family's own orders to show (their own client can't read
 * anyone else's); the sync never uses them.
 */
async function findOrder(
  supabase: ServerClient,
  householdId: string,
  feisId: string,
  picked: { orderId: string | null; sessionId: string | null }
): Promise<OrderSummary | null | 'error'> {
  const orders = () =>
    supabase
      .from('registrations')
      .select('id, status, confirmation_number, total_cents, purchase_snapshot')
      .eq('household_id', householdId)
      .eq('feis_listing_id', feisId)

  // A registration id is a uuid; anything else in the URL picks nothing
  if (picked.orderId && /^[0-9a-f-]{36}$/i.test(picked.orderId)) {
    const { data, error } = await orders().eq('id', picked.orderId).maybeSingle()
    if (error) return 'error'
    if (data) return data as OrderSummary
  }
  const sessionId = picked.sessionId
  if (sessionId) {
```

(d) Replace:
```tsx
  feisId: string,
  sessionId: string | null
): Promise<View> {
```
with:
```tsx
  feisId: string,
  picked: { orderId: string | null; sessionId: string | null }
): Promise<View> {
```

(e) Replace:
```tsx

  const order = await findOrder(supabase, household.id, feisId, sessionId)
  if (order === 'error') {
    console.error('Success page: the order failed to load')
    return { kind: 'unavailable' }
  }
  if (!order) redirect(`/feiseanna/${feisId}`)
  if (order.status === 'paid') {
    return { kind: 'paid', confirmationNumber: order.confirmation_number }
  }

```
with:
```tsx

  const order = await findOrder(supabase, household.id, feisId, picked)
  if (order === 'error') {
    console.error('Success page: the order failed to load')
    return { kind: 'unavailable' }
  }
  if (!order) redirect(`/feiseanna/${feisId}`)
  const paidView = (confirmationNumber: string | null): View => ({
    kind: 'paid',
    confirmationNumber,
    addedToEntry: isAddOnOrder(order),
    totalCents: order.total_cents
  })
  if (order.status === 'paid') return paidView(order.confirmation_number)

```

(f) Replace:
```tsx
  }
  if (synced?.kind === 'paid') {
    return { kind: 'paid', confirmationNumber: synced.confirmationNumber }
  }

```
with:
```tsx
  }
  if (synced?.kind === 'paid') return paidView(synced.confirmationNumber)

```

(g) Replace:
```tsx
  const { id: feisId } = await params
  const { session_id: sessionId } = await searchParams

  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
    const back = `/feiseanna/${feisId}/register/success${query}`
    redirect(`/auth/login?redirect=${encodeURIComponent(back)}`)
  }

  const view = await viewFor(supabase, user.id, feisId, sessionId ?? null)
  const entryHref = `/feiseanna/${feisId}/register`
```
with:
```tsx
  const { id: feisId } = await params
  const { session_id: sessionId, order: orderId } = await searchParams

  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) {
    const query = orderId
      ? `?order=${encodeURIComponent(orderId)}`
      : sessionId
        ? `?session_id=${encodeURIComponent(sessionId)}`
        : ''
    const back = `/feiseanna/${feisId}/register/success${query}`
    redirect(`/auth/login?redirect=${encodeURIComponent(back)}`)
  }

  const view = await viewFor(supabase, user.id, feisId, {
    orderId: orderId ?? null,
    sessionId: sessionId ?? null
  })
  const entryHref = `/feiseanna/${feisId}/register`
```

(h) Replace:
```tsx
            <p className="mt-1.5 max-w-[52ch] opacity-85">
              Payment received. Your dancers&apos; competitor numbers are ready.
            </p>
```
with:
```tsx
            <p className="mt-1.5 max-w-[52ch] opacity-85">
              {view.addedToEntry
                ? 'These dances were added to your entry. Your dancers keep their competitor numbers.'
                : view.totalCents === 0
                  ? 'Your entries are confirmed. There was nothing to pay.'
                  : 'Payment received. Your dancers’ competitor numbers are ready.'}
            </p>
```

(i) Replace:
```tsx
                <span className="rounded-[2px] bg-[var(--color-feis-green-light)] px-1.5 py-0.5 text-xs font-bold text-[var(--color-feis-green-700)]">
                  Paid in full
                </span>
```
with:
```tsx
                <span className="rounded-[2px] bg-[var(--color-feis-green-light)] px-1.5 py-0.5 text-xs font-bold text-[var(--color-feis-green-700)]">
                  {view.totalCents === 0 ? 'Confirmed, nothing to pay' : 'Paid in full'}
                </span>
```

In `src/app/dashboard/page.tsx`:

(a) Replace:
```tsx
import Link from 'next/link'
import { formatDate, formatCents } from '@/lib/format'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import { isHouseholdComplete } from '@/lib/household'
import {
  openReviewsByOrder,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'
import type { Registration, Dancer, RegistrationStatus } from '@/lib/types/feis-listing'
import { PageTitle } from '@/components/page-title'
```
with:
```tsx
import Link from 'next/link'
import { canStartOrder } from '@/lib/engine/order-validation'
import { isAddOnOrder } from '@/lib/entry-display'
import { formatDate, formatCents } from '@/lib/format'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import { isHouseholdComplete } from '@/lib/household'
import {
  openMessageAFor,
  openReviewsByOrder,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'
import type {
  Registration,
  Dancer,
  FeisListing,
  RegistrationStatus
} from '@/lib/types/feis-listing'
import { PageTitle } from '@/components/page-title'
```

(b) Replace:
```tsx
        ${REGISTRATION_COLUMNS},
        feis_listings(name, feis_date, venue_name),
        registration_entries(dancer_id, feis_competitions(display_name))
```
with:
```tsx
        ${REGISTRATION_COLUMNS},
        feis_listings(name, feis_date, venue_name, status, reg_opens_at, reg_closes_at, late_reg_closes_at),
        registration_entries(dancer_id, feis_competitions(display_name))
```

(c) Replace:
```tsx
  const entriesFailed = dancersRead.error !== null || registrationsRead.error !== null
  const openReviews = openReviewsByOrder((reviews.data ?? []) as PaymentReview[])

  // Released and expired holds never became entries, so they stay off the list, unless the order
  // has an open payment case: then it shows, so its message A or B reaches the family
  // `unknown` first: the client types a to-one embed (feis_listings) as an array, but each registration has one feis
  const typedRegistrations = (
    (registrationsRead.data ?? []) as unknown as (Registration & {
      feis_listings: { name: string; feis_date: string; venue_name: string }
      registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
    })[]
  ).filter((reg) => LISTED_STATUSES.includes(reg.status) || openReviews.has(reg.id))

```
with:
```tsx
  const entriesFailed = dancersRead.error !== null || registrationsRead.error !== null
  const reviewRows = (reviews.data ?? []) as PaymentReview[]
  const openReviews = openReviewsByOrder(reviewRows)

  // `unknown` first: the client types a to-one embed (feis_listings) as an array, but each registration has one feis
  const allRegistrations = (registrationsRead.data ?? []) as unknown as (Registration & {
    feis_listings: Pick<
      FeisListing,
      'name' | 'feis_date' | 'venue_name' | 'status' | 'reg_opens_at' | 'reg_closes_at' | 'late_reg_closes_at'
    >
    registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
  })[]

  // Whether each feis can take a new order now (spec §14): the feis's newest paid order offers Add dances
  // then. Newest first, so the first paid order found for a feis is its newest
  const now = new Date()
  const addDancesOn = new Set<string>()
  for (const feisId of new Set(allRegistrations.map((reg) => reg.feis_listing_id))) {
    const forFeis = allRegistrations.filter((reg) => reg.feis_listing_id === feisId)
    const newestPaid = forFeis.find((reg) => reg.status === 'paid')
    if (!newestPaid) continue
    const hasUnpaidOrder = forFeis.some(
      (reg) =>
        (reg.status === 'draft' || reg.status === 'pending_payment') &&
        (reg.hold_expires_at === null || new Date(reg.hold_expires_at) > now)
    )
    const canAdd = canStartOrder({
      listing: newestPaid.feis_listings,
      now,
      hasUnpaidOrder,
      hasOpenMessageA: openMessageAFor(reviewRows, forFeis.map((reg) => reg.id)) !== null
    })
    if (canAdd) addDancesOn.add(newestPaid.id)
  }

  // Released and expired holds never became entries, so they stay off the list, unless the order
  // has an open payment case: then it shows, so its message A or B reaches the family
  const typedRegistrations = allRegistrations.filter(
    (reg) => LISTED_STATUSES.includes(reg.status) || openReviews.has(reg.id)
  )

```

(d) Replace:
```tsx
            const canPayAgain = review?.message_code !== 'A'
            // Name the session only when there is one (never `session_id=null`); the success
            // page finds the family's order without it too
            const receiptHref = `/feiseanna/${reg.feis_listing_id}/register/success${
              reg.stripe_checkout_session_id ? `?session_id=${reg.stripe_checkout_session_id}` : ''
            }`
            const dancerIds = [...new Set(reg.registration_entries.map((e) => e.dancer_id))]
```
with:
```tsx
            const canPayAgain = review?.message_code !== 'A'
            // Each receipt names its own order: a family can have several for one feis
            const receiptHref = `/feiseanna/${reg.feis_listing_id}/register/success?order=${reg.id}`
            const dancerIds = [...new Set(reg.registration_entries.map((e) => e.dancer_id))]
```

(e) Replace:
```tsx
                    </span>
                  </div>
```
with:
```tsx
                    </span>
                    {isAddOnOrder(reg) && (
                      <span className="rounded-[2px] border border-[var(--color-feis-charcoal)] px-1.5 py-0.5 text-xs font-bold">
                        Added
                      </span>
                    )}
                  </div>
```

(f) Replace:
```tsx
                  )}
                  {(reg.status === 'draft' || reg.status === 'pending_payment') && canPayAgain && (
```
with:
```tsx
                  )}
                  {addDancesOn.has(reg.id) && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register`}
                      className="feis-btn feis-btn-outline"
                    >
                      Add dances
                    </Link>
                  )}
                  {(reg.status === 'draft' || reg.status === 'pending_payment') && canPayAgain && (
```

- [ ] **Step 11: Check nothing writes the order tables, and run everything**

```bash
test -z "$(git grep -n -e confirmFreeOrder -e generateConfirmationNumber -e confirmation-number -e send-confirmation -- src ':!src/app/_payments/order-store.ts' ':!src/app/_payments/checkout-workflow.ts')"
test -z "$(git grep -n -A3 -E "from\('registration(s|_entries|_snapshots)'\)" -- src ':!src/lib/bridge.ts' | grep -E '\.(insert|update|upsert|delete)\(')" && echo "no direct order writes"
```
Expected: `no direct order writes`. `order-store.ts` and `checkout-workflow.ts` name `confirmFreeOrder` only as the store wrapper for `confirm_free_order` and its caller. `src/lib/bridge.ts` is left out of the second check: it writes Phase 1's `public.registrations` through its own client, not these tables.

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db && npm run build`
Expected: all pass, with no lint errors: 24 files and 310 tests, then 10 files and 243 tests, then a clean build.

- [ ] **Step 12: Commit**

```bash
git add src/lib/payment-review-messages.ts src/lib/entry-display.ts src/lib/email/templates.ts \
  src/app/_payments/checkout-workflow.ts 'src/app/feiseanna/[id]/register/actions.ts' \
  'src/app/feiseanna/[id]/register/page.tsx' 'src/app/feiseanna/[id]/register/success/page.tsx' \
  src/app/dashboard/page.tsx src/components/registration/entry-page.tsx src/components/registration/family-receipt.tsx \
  tests/payment-review-messages.test.ts tests/entry-display.test.ts tests/email-templates.test.ts \
  tests/db/checkout-workflow.test.ts
git commit -q -m "feat: add dances after paying, and \$0 orders confirmed without Stripe"
```

---

### Task 21: The runbook and the project rules for add-on and $0 orders

Spec §6, §11 and the "Changes in Revision 5" table. The runbook (`docs/runbooks/payment-exceptions.md`) gets four changes:
- its "newer order" wording allows several paid orders
- step 3a's conditions become Decision 12's rule
- it says how to read `details.why`
- it covers $0 orders, which never have a Stripe payment or a case

`CLAUDE.md`'s rule that only `confirm_order_payment` marks an order paid also names `confirm_free_order` and `payments_admin.confirm_late_payment`.

**Files:**
- Modify: `docs/runbooks/payment-exceptions.md`, `CLAUDE.md`, `docs/known-issues.md`

**Interfaces:**
- Consumes: the functions and rules from Tasks 18–20.
- Produces: a runbook and project rules that match add-on and $0 orders.

- [ ] **Step 1: The runbook**

In `docs/runbooks/payment-exceptions.md`:

(a) Replace:
```markdown
Every case has a reference like `PAY-7KQ2M`. The family sees it on the success page and their dashboard when
their charge went through but their registration isn't confirmed. Alerts arrive by email once email is turned on (it's paused for now; see below), and the Vercel
logs always have a `[PAYMENT_EXCEPTION] PAY-…` line.
```
with:
```markdown
Every case has a reference like `PAY-7KQ2M`. The family sees it on the success page and their dashboard when
their charge went through but their registration isn't confirmed.

A family can have several orders for one feis: their first, then an add-on order each time they come back to add
dances or dancers after paying. Any number can be paid, but only one can be unpaid at a time. Each order's price
counted the family's paid orders at the time (no second family fee, the family max across orders, no second late
fee for a dancer), and the order's `purchase_snapshot -> 'pricing' -> 'prior'` records which ones. An order that
costs nothing (typically an add-on once the family max is reached) is confirmed without Stripe: it has no checkout,
no payment and never a case. Alerts arrive by email (to `PAYMENTS_ALERT_EMAIL`, from `entries@runfeis.com`), and the Vercel
logs always have a `[PAYMENT_EXCEPTION] PAY-…` line.
```

(b) Replace:
```markdown

Then find the payment in Stripe: Dashboard → Connect → the account named in the case's `stripe_account_id` →
```
with:
````markdown

The family's orders for the feis, oldest first, with what each one's price counted (put the case's
`household_id` and `feis_listing_id` in):
```sql
SELECT r.id, r.status, r.total_cents, r.event_fee_cents, r.confirmation_number, r.created_at, r.paid_at,
       r.checkout_claim_id IS NOT NULL AS reached_checkout,
       (SELECT coalesce(jsonb_agg(o ->> 'id'), '[]') FROM jsonb_array_elements(
          coalesce(r.purchase_snapshot -> 'pricing' -> 'prior' -> 'orders', '[]')) AS o) AS counted_orders
FROM pre_registration.registrations r
WHERE r.household_id = '<household_id>' AND r.feis_listing_id = '<feis_listing_id>'
ORDER BY r.created_at;
```

Then find the payment in Stripe: Dashboard → Connect → the account named in the case's `stripe_account_id` →
````

(c) Replace:
```markdown
|---|---|---|
| `late_payment_conflict` | The family paid after their order expired, and they have a newer order for the same feis. | Ring or email the family. If they want the paid order and the newer order never reached checkout, confirm it (3a). Otherwise refund the late payment (3b). Once recorded, the system never confirms this payment by itself, even if the newer order later ends: only 3a does. |
| `amount_mismatch` | Stripe charged a different amount from the order total. | Refund it (3b). The family registers again. |
```
with:
```markdown
|---|---|---|
| `late_payment_conflict` | The family paid for an order after it expired (or, rarely, for one awaiting payment), and another of their orders for the feis gets in the way. The case's `details -> 'why'` lists each rule that failed, with the orders involved: `unpaid_order_exists` (they hold another unpaid order, which may repeat these dances) and `paid_orders_changed` (another order was paid after this one was priced, so its price may be wrong). | Ring or email the family. Use the family's-orders query in section 1. If they want the paid order and 3a's conditions hold, confirm it (3a). Otherwise refund the late payment (3b). Once recorded, the system never confirms this payment by itself, even if the other order later ends: only 3a does. |
| `amount_mismatch` | Stripe charged a different amount from the order total. | Refund it (3b). The family registers again. |
```

(d) Replace:
```markdown
| `payment_failed` | A delayed payment failed. No money moved. | Close it with no action (3c). The family can register again. |
| `listing_account_changed` (notice) | The order is confirmed, but the feis has switched Stripe accounts since checkout. | Check the new account is right, then acknowledge it (3d). |
```
with:
```markdown
| `payment_failed` | A delayed payment failed. No money moved. | Close it with no action (3c). The family can register again. |
| (none: a $0 order) | An order that cost nothing was confirmed without Stripe. It has no checkout session or payment intent, and the snapshot's payment shows an amount of 0. | Nothing. It never raises a case. |
| `listing_account_changed` (notice) | The order is confirmed, but the feis has switched Stripe accounts since checkout. | Check the new account is right, then acknowledge it (3d). |
```

(e) Replace:
```markdown

**3a. Confirm a late payment** (only `late_payment_conflict`). This cancels the family's newer unpaid order, then
confirms the paid one: confirmation number, snapshot, competitor numbers and confirmation email. The order's
`paid_at` becomes the time of this confirmation, so its competitor numbers come after every family confirmed
before now. It refuses if any other order for the family and feis is paid, or reached checkout and isn't
cancelled: a delayed payment for it could still arrive. Refund instead (3b).

```
with:
```markdown

**3a. Confirm a late payment** (only `late_payment_conflict`). This cancels the family's unpaid drafts for the feis
that never reached checkout (they were priced without the late payment), then confirms the paid order: confirmation
number, snapshot, competitor numbers and confirmation email. The order's `paid_at` becomes the time of this
confirmation, so its competitor numbers come after every family confirmed before now.

It confirms only when every other order of the family for the feis is one of these:
- paid, and counted by this order's price (it's in this order's `counted_orders` in the family's-orders query)
- cancelled or expired, including a newer order that reached checkout and then expired unpaid: if a payment for that
  one arrives later, it becomes a case of its own
- an unpaid draft that never reached checkout, which it cancels

It refuses, and you refund instead (3b), when another order was paid that this one didn't count (`why` says
`paid_orders_changed`: its price no longer holds), or when another order is at checkout right now (a draft that
reached checkout, or one awaiting payment), since a payment for it may arrive at any moment.

```

- [ ] **Step 2: Check the new query against real orders**

The runbook's new family's-orders query is the only new SQL. Check it on the test database with a temporary test, then delete the test.

Create `tests/db/runbook-r5.test.ts`:
```ts
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { createAddOnOrder, createDancer, createDraftOrder, payOrder } from './helpers/fixtures'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db?.drop()
})

// The runbook's family's-orders query (section 1), with the placeholders filled in
const FAMILY_ORDERS = `
SELECT r.id, r.status, r.total_cents, r.event_fee_cents, r.confirmation_number, r.created_at, r.paid_at,
       r.checkout_claim_id IS NOT NULL AS reached_checkout,
       (SELECT coalesce(jsonb_agg(o ->> 'id'), '[]') FROM jsonb_array_elements(
          coalesce(r.purchase_snapshot -> 'pricing' -> 'prior' -> 'orders', '[]')) AS o) AS counted_orders
FROM pre_registration.registrations r
WHERE r.household_id = '<household_id>' AND r.feis_listing_id = '<feis_listing_id>'
ORDER BY r.created_at;`

it("lists the family's orders for the feis with what each one counted", async () => {
  const first = await createDraftOrder(db.pool)
  await payOrder(db.pool, first)
  const niamh = await createDancer(db.pool, first.family.householdId, { firstName: 'Niamh' })
  const addOn = await createAddOnOrder(
    db.pool,
    { family: first.family, listing: first.listing, dancers: [...first.dancers, niamh] },
    [{ dancerId: niamh.id, competitionId: first.listing.competitions[0].id }]
  )
  const sql = FAMILY_ORDERS.replace('<household_id>', first.family.householdId).replace(
    '<feis_listing_id>',
    first.listing.listing.id
  )
  const { rows } = await db.pool.query(sql)
  expect(rows.map((r) => [r.id, r.status, r.reached_checkout, r.counted_orders])).toEqual([
    [first.registrationId, 'paid', true, []],
    [addOn.registrationId, 'draft', false, [first.registrationId]]
  ])
})
```
```bash
npm run test:db -- tests/db/runbook-r5.test.ts
rm tests/db/runbook-r5.test.ts
```
Expected: PASS (1 test). If it fails, fix the query in the runbook, and make the test's copy of it match.

- [ ] **Step 3: The project rules**

In `CLAUDE.md`, replace:
```markdown
- Don't let template edits mutate existing listings — frozen snapshots are immutable
- Only `confirm_order_payment` marks an order paid or, for a late-payment case, a person running `payments_admin.confirm_late_payment`. The webhook and the success-page sync both call `confirm_order_payment` with data they fetched from Stripe themselves; never trust payment data from a URL
- Order state changes go through the Postgres functions in migrations 012–017 (via `src/app/_payments/`). Never write `registrations`, `registration_entries` or `registration_snapshots` directly
- A submitted order never changes. To change entries, cancel it and create a new one
- Reads of `registrations` with a user's client select `REGISTRATION_COLUMNS` (`src/lib/registration-columns.ts`) or a subset of it, never `*`. `consent_ip` and `checkout_config` are private: the database refuses them to a user's client, so a new `registrations` column stays private until a migration grants it and it is added to that list
- Submit refuses an order under Stripe's 50-cent card minimum (`belowCardMinimum()` in `src/lib/engine/checkout-policy.ts`), so no order is made that could never be paid
- Eligibility engine is pure — no Supabase, no side effects
```
with:
```markdown
- Don't let template edits mutate existing listings — frozen snapshots are immutable
- Only three functions mark an order paid, all through `_fulfil_order` (migration 012 refuses any other move into `paid`): `confirm_order_payment` for a Stripe payment, `confirm_free_order` for a $0 order (Pay calls it; no Stripe), and, for a late-payment case, a person running `payments_admin.confirm_late_payment`. The webhook and the success-page sync both call `confirm_order_payment` with data they fetched from Stripe themselves; never trust payment data from a URL
- Order state changes go through the Postgres functions in migrations 012–017 (via `src/app/_payments/`); 020 checks 019's unpaid-order index. Never write `registrations`, `registration_entries` or `registration_snapshots` directly
- A submitted order never changes. To change entries, cancel it and create a new one. A paid order never changes either: adding dances or dancers after paying is a new add-on order for just what's added
- A family holds at most one unpaid order per feis and any number of paid ones. Every new order is priced on top of the family's paid orders for the feis (`paidOrdersFrom()` and `priceOrder({ paidOrders })` in `src/lib/engine/purchase-snapshot.ts`), and `create_order` refuses a price whose counted orders aren't exactly the paid orders now. Whether a new order may start is `canStartOrder()` (`src/lib/engine/order-validation.ts`), everywhere
- Reads of `registrations` with a user's client select `REGISTRATION_COLUMNS` (`src/lib/registration-columns.ts`) or a subset of it, never `*`. `consent_ip` and `checkout_config` are private: the database refuses them to a user's client, so a new `registrations` column stays private until a migration grants it and it is added to that list
- Submit refuses an order of 1 to 49 cents (`tooSmallToCharge()` in `src/lib/engine/checkout-policy.ts`), below Stripe's card minimum, and `create_order` refuses it too, so no order is made that could never be paid. A $0 order is allowed: Pay confirms it without Stripe
- Eligibility engine is pure — no Supabase, no side effects
```

- [ ] **Step 4: Known issues**

In `docs/known-issues.md`:

(a) Replace:
```markdown
## Already tracked elsewhere
Payment and Stripe webhook problems, and changing entries after paying, are being handled on the `payment-hardening` branch.

```
with:
```markdown
## Already tracked elsewhere
Payment and Stripe webhook problems are handled by the payment hardening work (`docs/2026-10-16-payment-hardening-design.md`). Dropping or swapping a dance after paying waits on Steve's refund and withdrawal policy.

```

(b) Replace:
```markdown
- **Organiser late entries and changes after paying** wait on the payment-hardening order step (its Task 6), so they're built once on the new model.
- **Adding to a feis after paying** works (add-on orders, migration 019): parents add dances or dancers and pay only for what's new. Dropping a dance after paying still goes through the organiser. When payment hardening lands, its add-on model replaces this one.

```
with:
```markdown
- **Organiser late entries and changes after paying** wait on the payment-hardening order step (its Task 6), so they're built once on the new model.
- **Adding to a feis after paying** works: each visit after paying is a new order for just what's added, priced on top of what the family already paid (payment hardening's add-on orders, spec §14). Dropping or swapping a dance after paying still goes through the organiser.

```

- [ ] **Step 4b: The runbook says email is on**

Email is live (Daniel, 2026-10-17): the sending domain is verified, `EMAIL_FROM` is `RunFeis <entries@runfeis.com>`, and `PAYMENTS_ALERT_EMAIL` holds Daniel's and Steve's addresses. Step 1(a) already rewrote the opening paragraph. Make these replacements in `docs/runbooks/payment-exceptions.md`.

(a) Replace:
```markdown
Who: the payments contacts, Daniel and Steve to start (their addresses go in `PAYMENTS_ALERT_EMAIL` once email is on).
```
with:
```markdown
Who: the payments contacts, Daniel and Steve to start (their addresses are in `PAYMENTS_ALERT_EMAIL`).
```

(b) Replace the whole paragraph that starts `**Email is paused for now.**` and ends `Turning email on is in section 5.` with:
```markdown
**Email.** RunFeis sends from `entries@runfeis.com`: confirmations to families, and payment-case alerts to
`PAYMENTS_ALERT_EMAIL`. An alert that fails to send is found only by the stuck-emails query (section 4), so keep
running both queries every day during registration: Vercel keeps its logs only for a short time, so the queries are
the record. If email stops, see "If email stops" in section 5.
```

(c) Replace:
```markdown
emails about a closed case, and while email is paused it sends nothing at all, not even the confirmation after 3a, so
all contact with the family is by hand.
```
with:
```markdown
emails about a closed case. After 3a the family also gets the usual confirmation email, but it doesn't explain the
case, so write to them anyway.
```

(d) Replace:
```markdown
- `PAYMENTS_ALERT_EMAIL` (comma-separated; leave it unset while email is paused, below)
```
with:
```markdown
- `PAYMENTS_ALERT_EMAIL` (the payments contacts, comma-separated: Daniel and Steve)
```

(e) Replace the whole paragraph that starts `**Turning email on.**` (it ends `then run the stuck-emails query (section 4).`) with:
```markdown
**If email stops.** The email job's answer (below) says `"paused":true` when `RESEND_API_KEY`, `EMAIL_FROM` or
`PAYMENTS_ALERT_EMAIL` is missing: set them on Vercel and redeploy. Queued emails then send, up to 20 each time the
job runs (every 5 minutes). If the job isn't paused but emails stay `pending` with attempts used, check the domain is
still verified in Resend (Resend dashboard → Domains) and look for `[NOTIFICATION_FAILED]` in the Vercel logs.
```

(f) Replace:
```markdown
`"paused":true` until email is set up):
```
with:
```markdown
`"paused":false`; `"paused":true` means an email setting is missing, see "If email stops" above):
```

Then run `grep -n -i 'paused\|turned on\|once email' docs/runbooks/payment-exceptions.md`. Only the line from (f) and "If email stops" may remain.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/payment-exceptions.md CLAUDE.md docs/known-issues.md
git commit -q -m "docs: runbook and project rules for add-on orders, \$0 orders and the late-payment rule"
```

---

### Task 16: Live check, rehearsal, live verification and rollout

**Runs after Tasks 17–21.** Spec revision 5 brought add-on orders and $0 orders into this work before go-live. Tasks 17–21 build them, starting from a merge of `main`, so this branch has 019 as live does. This task then rolls out 012–017 and 020 together; live already has 019.

This task touches the live project. Steps 3, 4, 7 and 8 need Daniel's go-ahead at the time: Step 3 copies the live data to this machine, Step 4 sets Vercel settings, Step 7 applies the migrations, pushes to `main` (which deploys) and adds the new Stripe webhook events, and Step 8 is now a read-only dry-read (the email job is deferred). Ask before each one. Don't treat approval of this plan as approval for them.

**Email is on at go-live (Daniel, 2026-10-17: "emails are live now").** RunFeis's sending domain is verified in Resend, and Vercel already has `EMAIL_FROM` = `RunFeis <entries@runfeis.com>`, `RESEND_API_KEY` and `NEXT_PUBLIC_BASE_URL` = `https://www.runfeis.com`. Step 4 sets `PAYMENTS_ALERT_EMAIL` to Daniel's address only for now, with Steve added later (Daniel, 2026-10-18), so confirmations and payment-case alerts go out from the first order. The email job (`process-notifications`) stays off until several families are signing up (Daniel, 2026-10-19): emails send straight away after Pay and after Stripe's notice, and leftovers wait for the next payment (runbook §4 and §5). Step 12 confirms the first real email arrives.

**Files:**
- Create: `supabase/checks/payment-hardening-live-check.sql`
- Create: `supabase/checks/rehearse-on-live-copy.sh`
- Create: `supabase/tests/payment_hardening_live_tests.sql`
- Test: `tests/db/live-script.test.ts` (runs the live test script against the local database first)
- Modify: `docs/2026-10-16-payment-hardening-design.md` (record the results)

**Interfaces:**
- Consumes: migrations 012–017 and 020 (with 019, which live already has), the add-on and $0 order functions (Task 19), and the Supabase stand-ins in `tests/db/sql/supabase-standins.sql` (Task 1).
- Produces: a read-only live check, a rehearsal of 012–017 and 020 on a copy of the live data, and a live test script that always rolls back.

- [ ] **Step 1: Write the live test script, and prove it locally first**

The script checks the rules the way the local suite does:
- the table ACLs themselves (`aclexplode`), so nothing but `SELECT` for `authenticated` slips through. On `registrations` that `SELECT` is granted column by column, and leaves out `consent_ip` and `checkout_config`.
- column-level write grants (`has_any_column_privilege`)
- row-level security
- the three row guards and the three `TRUNCATE` guards, and that the service role can't `TRUNCATE`
- who can reach `payments_admin` and its audit table (no one but the SQL editor: not parents, `anon` or the service
  role), and who can run 016's email queue functions (not `anon` or `authenticated`)
- that the one-unpaid-order index is `idx_registrations_active_unique` with 019's predicate (`draft` and
  `pending_payment` only), which 012–017 rely on and 020 checks

It also reads a test feis's orders as its organiser, the way the organiser entries view (`getFeisEntries`) does.

Then it runs add-on and $0 orders through the real functions, as the spec's Live verification asks: the family's first order is paid through `claim_checkout`, `attach_checkout_session` and `confirm_order_payment`; an add-on for a dance already paid for is refused; a $0 add-on counts the paid order and is confirmed by `confirm_free_order`; a late payment for an add-on whose counted orders hold is confirmed; a late payment after another order was paid that it didn't count becomes a case; and the organiser reads the family's add-on entries. Its create_order payloads carry `pricing.fee_schedule`, since `create_order` checks the family fee against it (Task 19).

Create `supabase/tests/payment_hardening_live_tests.sql`:
```sql
-- payment_hardening_live_tests.sql
-- Live tests for migrations 012–017 and 020, with throwaway test identities: what parents, anon and
-- organisers can do, and the privileges, row-level security and guards that make it so; then add-on
-- orders and $0 orders through the real order functions (spec, Live verification).
-- Run the whole file as ONE transaction (Supabase MCP apply_migration, or the SQL editor). The last
-- statement always raises, so nothing is kept (and apply_migration records nothing). Read the result
-- from the error: "PAYMENT HARDENING LIVE TESTS: <passed>/<total> passed; FAILED: ...".

CREATE TEMP TABLE t_results (n serial, name text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON t_results TO PUBLIC;
GRANT USAGE ON SEQUENCE t_results_n_seq TO PUBLIC;
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t_ids TO PUBLIC;

CREATE FUNCTION pg_temp.id(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t_ids WHERE k = p_k $$;
CREATE FUNCTION pg_temp.as_user(p_k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM t_ids WHERE k = p_k), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('role', 'anon', true);
END $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END $$;
CREATE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE FUNCTION pg_temp.ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t_results (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail)
$$;

-- A one-dance create_order payload at the test feis: no family fee, a $15.00 family max, and the given dance fee
-- and family-max saving, counting `p_prior` (what _counted_orders returns; null for a first order). create_order
-- checks it against the snapshot exactly as it checks Submit's.
CREATE FUNCTION pg_temp.payload(p_dancer uuid, p_comp uuid, p_fee integer, p_saving integer, p_prior jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'total_cents', p_fee - p_saving, 'application_fee_cents', round((p_fee - p_saving) * 0.05)::integer,
    'event_fee_cents', 0, 'is_late', false,
    'consent_ip', '203.0.113.7', 'consent_version', 'live-test', 'platform_terms_version', 'live-test',
    'entries', jsonb_build_array(e.entry || jsonb_build_object('feis_competition_id', p_comp)),
    'purchase_snapshot', jsonb_build_object(
      'version', 1,
      -- create_order checks the order's consent and terms versions against the snapshot's rules
      'rules', jsonb_build_object('consent_version', 'live-test', 'platform_terms_version', 'live-test'),
      'entries', jsonb_build_array(e.entry || jsonb_build_object('competition_id', p_comp)),
      'competitions', jsonb_build_array(jsonb_build_object('id', c.id, 'exclude_from_family_cap', c.exclude_from_family_cap)),
      'pricing', jsonb_build_object(
        'fee_schedule', jsonb_build_object('event_fee_cents', 0, 'family_cap_cents', 1500),
        'breakdown', jsonb_build_object('grand_total_cents', p_fee - p_saving, 'event_fee_cents', 0,
                                        'family_cap_savings_cents', p_saving),
        'prior', p_prior)))
  FROM pre_registration.feis_competitions c
  CROSS JOIN LATERAL (SELECT jsonb_build_object('dancer_id', p_dancer, 'fee_category', 'solo', 'base_fee_cents', p_fee,
                        'late_fee_cents', 0, 'day_of_surcharge_cents', 0) AS entry) AS e
  WHERE c.id = p_comp
$$;
-- What the test family's paid orders for the test feis count for its next order, as create_order rebuilds it
CREATE FUNCTION pg_temp.counted() RETURNS jsonb LANGUAGE sql AS $$
  SELECT pre_registration._counted_orders(pg_temp.id('household'), pg_temp.id('feis'))
$$;
-- Takes an order to checkout as Pay does: claim_checkout with a frozen request, then attach_checkout_session
CREATE FUNCTION pg_temp.to_checkout(p_order uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_order pre_registration.registrations%ROWTYPE;
  v_claim uuid := gen_random_uuid();
  v_session text := 'cs_live_test_' || replace(gen_random_uuid()::text, '-', '');
  v_account text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_order FROM pre_registration.registrations WHERE id = p_order;
  SELECT stripe_account_id INTO v_account FROM pre_registration.feis_listings WHERE id = v_order.feis_listing_id;
  v_result := pre_registration.claim_checkout(p_order, v_order.household_id, v_claim, jsonb_build_object(
    'account', v_account, 'currency', 'usd', 'total_cents', v_order.total_cents,
    'application_fee_cents', v_order.application_fee_cents,
    'line_items', jsonb_build_array(jsonb_build_object('name', 'Live test entries', 'amount_cents', v_order.total_cents,
                                                       'quantity', 1)),
    'metadata', jsonb_build_object('registration_id', p_order, 'claim_id', v_claim),
    'idempotency_key', 'checkout:' || p_order || ':' || v_claim,
    'payment_method_types', jsonb_build_array('card'),
    'expires_at', extract(epoch FROM now() + interval '60 minutes')::bigint));
  IF v_result ->> 'result' IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'claim_checkout did not claim order %: %', p_order, v_result;
  END IF;
  PERFORM pre_registration.attach_checkout_session(p_order, v_claim, v_session);
  RETURN jsonb_build_object('claim_id', v_claim, 'session_id', v_session, 'account', v_account);
END $$;
-- The payment for a checkout, as the webhook reports it
CREATE FUNCTION pg_temp.pay(p_order uuid, p_checkout jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pre_registration.confirm_order_payment(p_order, (p_checkout ->> 'claim_id')::uuid, p_checkout ->> 'session_id',
    p_checkout ->> 'account', (SELECT total_cents FROM pre_registration.registrations WHERE id = p_order), 'usd', 'paid',
    'pi_' || (p_checkout ->> 'session_id'), NULL, 'evt_live_test', 'webhook')
$$;
-- Stripe's expiry of a checkout, so a payment for it arrives late
CREATE FUNCTION pg_temp.expire(p_order uuid, p_checkout jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pre_registration.expire_checkout(p_order, (p_checkout ->> 'claim_id')::uuid, p_checkout ->> 'session_id',
    p_checkout ->> 'account')
$$;

-- ---------- Fixtures (as admin): two families, one test feis, one order made by create_order ----------
-- The test feis has a $15.00 family max and three dances: Test Reel and Test Slip Jig at $15.00, and Test
-- Special at $10.00, outside the family max. The parent has two dancers.
DO $$
DECLARE
  v_household uuid;
  v_listing uuid;
  v_comp uuid;
  v_comp2 uuid;
  v_special uuid;
  v_dancer uuid;
  v_dancer2 uuid;
  v_result jsonb;
BEGIN
  INSERT INTO t_ids VALUES ('parent', gen_random_uuid()), ('stranger', gen_random_uuid()), ('organiser', gen_random_uuid());
  INSERT INTO auth.users (id, email, aud, role)
  SELECT id, k || '-' || substr(id::text, 1, 8) || '@payment-hardening.test', 'authenticated', 'authenticated' FROM t_ids;

  INSERT INTO pre_registration.households (user_id, first_name, last_name, phone, address_line1, city, state_region, postal_code)
  VALUES (pg_temp.id('parent'), 'Test', 'Parent', '555-0100', '1 Test Rd', 'Boston', 'MA', '02101')
  RETURNING id INTO v_household;
  INSERT INTO pre_registration.households (user_id, first_name, last_name, phone, address_line1, city, state_region, postal_code)
  VALUES (pg_temp.id('stranger'), 'Other', 'Family', '555-0101', '2 Test Rd', 'Boston', 'MA', '02101');

  INSERT INTO pre_registration.feis_listings (name, status, reg_opens_at, reg_closes_at, created_by, stripe_account_id)
  VALUES ('Payment Hardening Test Feis', 'open', now() - interval '1 day', now() + interval '1 day',
          pg_temp.id('organiser'), 'acct_live_test')
  RETURNING id INTO v_listing;
  INSERT INTO pre_registration.feis_competitions (feis_listing_id, competition_type, fee_category, display_name, enabled,
    dance_key)
  VALUES (v_listing, 'solo', 'solo', 'Test Reel', true, 'reel')
  RETURNING id INTO v_comp;
  INSERT INTO pre_registration.feis_competitions (feis_listing_id, competition_type, fee_category, display_name, enabled,
    dance_key)
  VALUES (v_listing, 'solo', 'solo', 'Test Slip Jig', true, 'slip_jig')
  RETURNING id INTO v_comp2;
  INSERT INTO pre_registration.feis_competitions (feis_listing_id, competition_type, fee_category, display_name, enabled,
    fee_cents, exclude_from_family_cap)
  VALUES (v_listing, 'special', 'solo', 'Test Special', true, 1000, true)
  RETURNING id INTO v_special;
  INSERT INTO pre_registration.dancers (household_id, first_name, last_name, date_of_birth, gender)
  VALUES (v_household, 'Test', 'Dancer', '2016-01-01', 'female')
  RETURNING id INTO v_dancer;
  INSERT INTO pre_registration.dancers (household_id, first_name, last_name, date_of_birth, gender)
  VALUES (v_household, 'Second', 'Dancer', '2017-01-01', 'female')
  RETURNING id INTO v_dancer2;

  -- The family's first order: Test Reel, $15.00, which uses the whole family max
  v_result := pre_registration.create_order(v_household, v_listing, pg_temp.payload(v_dancer, v_comp, 1500, 0, NULL));
  INSERT INTO t_ids VALUES ('order', (v_result ->> 'registration_id')::uuid), ('dancer', v_dancer), ('comp', v_comp),
    ('feis', v_listing), ('household', v_household), ('comp2', v_comp2), ('special', v_special), ('dancer2', v_dancer2);
END $$;

-- ---------- Reads ----------
DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('parent');
  SELECT count(*) INTO v_n FROM pre_registration.registrations WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent reads own order', v_n = 1, v_n::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent reads own order', false, SQLERRM); END $$;

DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('parent');
  SELECT count(*) INTO v_n FROM pre_registration.registration_entries WHERE registration_id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent reads own entries', v_n = 1, v_n::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent reads own entries', false, SQLERRM); END $$;

DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('stranger');
  SELECT count(*) INTO v_n FROM pre_registration.registrations WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('another family cannot see the order', v_n = 0, v_n::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('another family cannot see the order', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_anon();
  PERFORM 1 FROM pre_registration.registrations LIMIT 1;
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('anon cannot read orders', false, 'select succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('anon cannot read orders', true, SQLERRM); END $$;

-- What the organiser entries view reads (getFeisEntries): the feis's orders, and each entry with its
-- order, dancer and competition, through 012's organiser policies and 010's dancer policy
DO $$ DECLARE v_orders int; v_entries int; v_named int; v_competitions int; BEGIN
  PERFORM pg_temp.as_user('organiser');
  SELECT count(*) INTO v_orders FROM pre_registration.registrations WHERE feis_listing_id = pg_temp.id('feis');
  SELECT count(*), count(d.first_name), count(c.id) INTO v_entries, v_named, v_competitions
  FROM pre_registration.registration_entries e
  JOIN pre_registration.registrations r ON r.id = e.registration_id
  LEFT JOIN pre_registration.dancers d ON d.id = e.dancer_id
  LEFT JOIN pre_registration.feis_competitions c ON c.id = e.feis_competition_id
  WHERE r.feis_listing_id = pg_temp.id('feis') AND r.status IN ('paid', 'pending_payment', 'draft');
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('the organiser reads the feis''s orders and entries, with dancer names',
    v_orders = 1 AND v_entries = 1 AND v_named = 1 AND v_competitions = 1,
    format('orders %s, entries %s, dancer names %s, competitions %s', v_orders, v_entries, v_named, v_competitions));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the organiser reads the feis''s orders and entries, with dancer names', false, SQLERRM);
END $$;

-- ---------- Refused writes ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  UPDATE pre_registration.registrations SET status = 'paid' WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot mark an order paid', false, 'update succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot mark an order paid', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  UPDATE pre_registration.registrations SET total_cents = 1 WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot change a total', false, 'update succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot change a total', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  INSERT INTO pre_registration.registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
  VALUES (pg_temp.id('order'), pg_temp.id('dancer'), pg_temp.id('comp'), 'solo', 0);
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot add an entry', false, 'insert succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot add an entry', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  DELETE FROM pre_registration.registration_entries WHERE registration_id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot delete entries', false, 'delete succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot delete entries', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  INSERT INTO pre_registration.registration_snapshots (registration_id, snapshot_data) VALUES (pg_temp.id('order'), '{}');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot write a snapshot', false, 'insert succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot write a snapshot', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  PERFORM pre_registration.confirm_order_payment(pg_temp.id('order'), NULL, 'cs_x', 'acct_live_test', 1500, 'usd',
    'paid', 'pi_x', NULL, 'evt_x', 'webhook');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot call confirm_order_payment', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot call confirm_order_payment', true, SQLERRM); END $$;

-- A refusal only counts if the script really was that role: a failed switch would also raise 42501
DO $$ DECLARE v_anon text; v_service text; BEGIN
  PERFORM pg_temp.as_anon(); v_anon := current_user; PERFORM pg_temp.as_admin();
  PERFORM pg_temp.as_service(); v_service := current_user; PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('the script can act as anon and as the service role',
    v_anon = 'anon' AND v_service = 'service_role', concat_ws(', ', v_anon, v_service));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('the script can act as anon and as the service role', false, SQLERRM); END $$;

-- payments_admin is for the SQL editor only. Each call must be refused for lack of permission (42501), not
-- reach the function and fail there ("no payment case")
DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  PERFORM payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'x');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot reach payments_admin', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot reach payments_admin', SQLSTATE = '42501', SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_anon();
  PERFORM payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'x');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('anon cannot reach payments_admin', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('anon cannot reach payments_admin', SQLSTATE = '42501', SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_service();
  PERFORM payments_admin.confirm_late_payment('PAY-XXXXX', 'x');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('the service role cannot reach payments_admin', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the service role cannot reach payments_admin', SQLSTATE = '42501', SQLERRM);
END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_service();
  INSERT INTO pre_registration.admin_actions (action, note) VALUES ('forged', 'not a real decision');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('the service role cannot write the audit trail', false, 'insert succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the service role cannot write the audit trail', SQLSTATE = '42501', SQLERRM);
END $$;

-- ---------- State after the attempts, and the effective rules ----------
DO $$ DECLARE v record; BEGIN
  SELECT r.status, r.total_cents,
         (SELECT count(*) FROM pre_registration.registration_entries e WHERE e.registration_id = r.id) AS entries
  INTO v FROM pre_registration.registrations r WHERE r.id = pg_temp.id('order');
  PERFORM pg_temp.ok('order unchanged after every refused write',
    v.status = 'draft' AND v.total_cents = 1500 AND v.entries = 1, row_to_json(v)::text);
END $$;

DO $$ DECLARE v_policies text; BEGIN
  SELECT string_agg(tablename || ':' || policyname || ':' || cmd, ' | '
                    ORDER BY tablename COLLATE "C", policyname COLLATE "C") INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'pre_registration'
    AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots');
  PERFORM pg_temp.ok('effective policies are exactly the read-only set', v_policies =
    'registration_entries:Organisers read entries for their feiseanna:SELECT | registration_entries:Parents read own entries:SELECT | '
    'registration_snapshots:Organisers read snapshots for their feiseanna:SELECT | registration_snapshots:Parents read own snapshots:SELECT | '
    'registrations:Organisers read registrations for their feiseanna:SELECT | registrations:Parents read own registrations:SELECT',
    v_policies);
END $$;

-- The table ACLs themselves, as the local suite reads them, so a privilege a newer Postgres adds (PG17
-- MAINTAIN) shows up too. REVOKE only removes the runner's own grants, so this is what really holds.
DO $$ DECLARE v_acl text; BEGIN
  SELECT string_agg(c.relname || ':' || CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                    || ':' || a.privilege_type, ', ' ORDER BY c.relname, a.privilege_type) INTO v_acl
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) AS a
  WHERE c.relnamespace = 'pre_registration'::regnamespace
    AND c.relname IN ('registrations', 'registration_entries', 'registration_snapshots')
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole));
  PERFORM pg_temp.ok('PUBLIC and anon hold nothing on the order tables, and authenticated only SELECT', v_acl =
    'registration_entries:authenticated:SELECT, registration_snapshots:authenticated:SELECT',
    v_acl);
END $$;

-- consent_ip and checkout_config are private: authenticated reads registrations column by column
DO $$ DECLARE v_private text; BEGIN
  SELECT string_agg(col, ', ') INTO v_private
  FROM unnest(ARRAY['consent_ip', 'checkout_config']) AS col
  WHERE has_column_privilege('authenticated', 'pre_registration.registrations', col, 'SELECT');
  PERFORM pg_temp.ok('authenticated cannot read consent_ip or checkout_config', v_private IS NULL, v_private);
END $$;

-- has_table_privilege misses column-level grants; has_any_column_privilege sees them
DO $$ DECLARE v_writes text; BEGIN
  SELECT string_agg(r.role || ':' || t.tbl || ':' || p.priv, ', ') INTO v_writes
  FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
  CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
  CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) AS p(priv)
  WHERE has_any_column_privilege(r.role, 'pre_registration.' || t.tbl, p.priv);
  PERFORM pg_temp.ok('no INSERT or UPDATE on any column for anon or authenticated', v_writes IS NULL, v_writes);
END $$;

DO $$ DECLARE v_off text; BEGIN
  SELECT string_agg(relname, ', ') INTO v_off FROM pg_class
  WHERE relnamespace = 'pre_registration'::regnamespace
    AND relname IN ('registrations', 'registration_entries', 'registration_snapshots') AND NOT relrowsecurity;
  PERFORM pg_temp.ok('row-level security is on for the three order tables', v_off IS NULL, v_off);
END $$;

DO $$ DECLARE v_truncate text; BEGIN
  SELECT string_agg(t.tbl, ', ') INTO v_truncate
  FROM unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
  WHERE has_table_privilege('service_role', 'pre_registration.' || t.tbl, 'TRUNCATE');
  PERFORM pg_temp.ok('the service role cannot TRUNCATE the order tables', v_truncate IS NULL, v_truncate);
END $$;

-- The row guards and the TRUNCATE guards, each on its own table and switched on
DO $$ DECLARE v_n int; BEGIN
  SELECT count(*) INTO v_n
  FROM (VALUES ('registrations', 'guard_registrations'),
               ('registration_entries', 'guard_registration_entries'),
               ('registration_snapshots', 'guard_registration_snapshots'),
               ('registrations', 'guard_registrations_truncate'),
               ('registration_entries', 'guard_registration_entries_truncate'),
               ('registration_snapshots', 'guard_registration_snapshots_truncate')) AS g(tbl, trigger_name)
  JOIN pg_trigger t ON t.tgrelid = ('pre_registration.' || g.tbl)::regclass AND t.tgname = g.trigger_name
  WHERE NOT t.tgisinternal AND t.tgenabled IN ('O', 'A');
  PERFORM pg_temp.ok('the three row guards and the three TRUNCATE guards are installed and on', v_n = 6, v_n::text);
END $$;

-- 017: no API role can use the admin schema or its functions, or holds anything on the audit table (an empty ACL
-- is read as the default one, which for a function includes EXECUTE for PUBLIC)
DO $$ DECLARE v_reach text; v_acl text; BEGIN
  SELECT string_agg(r.role || ':' || f.fn, ', ') INTO v_reach
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
  CROSS JOIN unnest(ARRAY['payments_admin.confirm_late_payment(text, text)',
                          'payments_admin.close_exception(text, text, text, text)']) AS f(fn)
  WHERE has_schema_privilege(r.role, 'payments_admin', 'USAGE') OR has_function_privilege(r.role, f.fn, 'EXECUTE');
  SELECT string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type,
                    ', ' ORDER BY a.privilege_type) INTO v_acl
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) AS a
  WHERE c.oid = 'pre_registration.admin_actions'::regclass
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));
  PERFORM pg_temp.ok('no API role can run payments_admin or touch admin_actions', v_reach IS NULL AND v_acl IS NULL,
    concat_ws(' | ', v_reach, v_acl));
END $$;

-- 016's email queue is for the service role (the cron endpoint) only
DO $$ DECLARE v_callable text; BEGIN
  SELECT string_agg(r.role || ':' || f.fn, ', ') INTO v_callable
  FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
  CROSS JOIN unnest(ARRAY['pre_registration.claim_notifications(integer, timestamptz)',
                          'pre_registration.freeze_notification(uuid, uuid, text, jsonb)',
                          'pre_registration.complete_notification(uuid, uuid, text, text, text, timestamptz)',
                          'pre_registration.get_notification_context(uuid)',
                          'pre_registration._queue_delivery_alert(uuid)']) AS f(fn)
  WHERE has_function_privilege(r.role, f.fn, 'EXECUTE');
  PERFORM pg_temp.ok('anon and authenticated cannot run the email queue functions', v_callable IS NULL, v_callable);
END $$;

-- One unpaid order per family per feis is 019's index, which 020 checked when it was applied: draft and
-- pending_payment only, so a family can hold any number of paid orders
DO $$ DECLARE v_def text; BEGIN
  v_def := pg_get_indexdef(to_regclass('pre_registration.idx_registrations_active_unique'));
  PERFORM pg_temp.ok('the one-unpaid-order index is idx_registrations_active_unique, as 019 made it', v_def =
    'CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree '
    '(feis_listing_id, household_id) WHERE (status = ANY (ARRAY[''draft''::text, ''pending_payment''::text]))',
    coalesce(v_def, 'no index by that name'));
END $$;

-- 012's hold-expiry job, naming its schema, and no other (002's, if it was scheduled under another name)
DO $$ DECLARE v_jobs text; v_command text; BEGIN
  SELECT string_agg(coalesce(jobname, jobid::text), ', ' ORDER BY jobid), min(command) INTO v_jobs, v_command
  FROM cron.job WHERE command ILIKE '%hold_expires_at%';
  PERFORM pg_temp.ok('one hold-expiry job, and it names its schema',
    v_jobs = 'expire-registration-holds' AND v_command LIKE '%pre_registration.registrations%', v_jobs);
END $$;

-- ---------- Add-on orders and $0 orders, through the real order functions (as admin) ----------
-- The fixture order is paid; each later order counts the family's paid orders as Submit does (_counted_orders).
-- After the first order, the family max is used up, so more dances inside it cost nothing.

DO $$ DECLARE v_result jsonb; BEGIN
  v_result := pg_temp.pay(pg_temp.id('order'), pg_temp.to_checkout(pg_temp.id('order')));
  PERFORM pg_temp.ok('the first order is paid through claim, attach and confirm_order_payment',
    v_result ->> 'result' = 'confirmed', v_result::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('the first order is paid through claim, attach and confirm_order_payment', false, SQLERRM); END $$;

DO $$ DECLARE v_result jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer'), pg_temp.id('comp'), 1500, 1500, pg_temp.counted()));
  PERFORM pg_temp.ok('an add-on for a dance already paid for is refused',
    v_result = '{"status": "refused", "reason": "already_entered"}'::jsonb, v_result::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('an add-on for a dance already paid for is refused', false, SQLERRM); END $$;

DO $$ DECLARE v_result jsonb; v_free uuid; v_row record; v_payment jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer'), pg_temp.id('comp2'), 1500, 1500, pg_temp.counted()));
  v_free := (v_result ->> 'registration_id')::uuid;
  INSERT INTO t_ids VALUES ('free', v_free);
  v_result := pre_registration.confirm_free_order(v_free, pg_temp.id('household'));
  SELECT status, total_cents, stripe_checkout_session_id, purchase_snapshot -> 'pricing' -> 'prior' -> 'orders' -> 0 ->> 'id' AS counted
  INTO v_row FROM pre_registration.registrations WHERE id = v_free;
  SELECT snapshot_data -> 'payment' INTO v_payment FROM pre_registration.registration_snapshots WHERE registration_id = v_free;
  PERFORM pg_temp.ok('a $0 add-on counts the paid order and is confirmed by confirm_free_order, with no Stripe payment',
    v_result ->> 'result' = 'confirmed' AND v_row.status = 'paid' AND v_row.total_cents = 0
      AND v_row.stripe_checkout_session_id IS NULL AND v_row.counted = pg_temp.id('order')::text
      AND (v_payment ->> 'amount_cents')::int = 0 AND v_payment ->> 'payment_intent_id' IS NULL,
    concat_ws(' | ', v_result::text, row_to_json(v_row)::text, v_payment::text));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('a $0 add-on counts the paid order and is confirmed by confirm_free_order, with no Stripe payment', false, SQLERRM);
END $$;

-- Test Special is outside the family max, so it costs $10.00 and goes through Stripe
DO $$ DECLARE v_result jsonb; v_order uuid; v_checkout jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer'), pg_temp.id('special'), 1000, 0, pg_temp.counted()));
  v_order := (v_result ->> 'registration_id')::uuid;
  v_checkout := pg_temp.to_checkout(v_order);
  PERFORM pg_temp.expire(v_order, v_checkout);
  v_result := pg_temp.pay(v_order, v_checkout);
  PERFORM pg_temp.ok('a late payment for an add-on whose counted orders still hold is confirmed',
    v_result ->> 'result' = 'confirmed', v_result::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('a late payment for an add-on whose counted orders still hold is confirmed', false, SQLERRM);
END $$;

DO $$ DECLARE v_result jsonb; v_late uuid; v_since uuid; v_checkout jsonb; v_why jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer2'), pg_temp.id('special'), 1000, 0, pg_temp.counted()));
  v_late := (v_result ->> 'registration_id')::uuid;
  v_checkout := pg_temp.to_checkout(v_late);
  PERFORM pg_temp.expire(v_late, v_checkout);
  -- The family starts again and another order is paid (here a $0 one), priced without the expired order
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer2'), pg_temp.id('comp'), 1500, 1500, pg_temp.counted()));
  v_since := (v_result ->> 'registration_id')::uuid;
  PERFORM pre_registration.confirm_free_order(v_since, pg_temp.id('household'));
  v_result := pg_temp.pay(v_late, v_checkout);
  SELECT details -> 'why' INTO v_why FROM pre_registration.payment_exceptions
  WHERE registration_id = v_late AND reason = 'late_payment_conflict';
  PERFORM pg_temp.ok('a late payment after another order was paid that it did not count is a case',
    v_result ->> 'reason' = 'late_payment_conflict'
      AND v_why = jsonb_build_array(jsonb_build_object('rule', 'paid_orders_changed', 'orders', jsonb_build_array(v_since)))
      AND (SELECT status FROM pre_registration.registrations WHERE id = v_late) = 'expired',
    concat_ws(' | ', v_result::text, v_why::text));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('a late payment after another order was paid that it did not count is a case', false, SQLERRM);
END $$;

-- The organiser entries view lists the family's add-on entries too: four paid orders, one dance each (the
-- expired order's entry stays off the list)
DO $$ DECLARE v_orders int; v_entries int; v_named int; BEGIN
  PERFORM pg_temp.as_user('organiser');
  SELECT count(*) INTO v_orders FROM pre_registration.registrations
  WHERE feis_listing_id = pg_temp.id('feis') AND status = 'paid';
  SELECT count(*), count(d.first_name) INTO v_entries, v_named
  FROM pre_registration.registration_entries e
  JOIN pre_registration.registrations r ON r.id = e.registration_id
  LEFT JOIN pre_registration.dancers d ON d.id = e.dancer_id
  WHERE r.feis_listing_id = pg_temp.id('feis') AND r.status IN ('paid', 'pending_payment', 'draft');
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('the organiser reads every paid order and entry, add-ons included',
    v_orders = 4 AND v_entries = 4 AND v_named = 4,
    format('paid orders %s, entries %s, dancer names %s', v_orders, v_entries, v_named));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the organiser reads every paid order and entry, add-ons included', false, SQLERRM);
END $$;

-- ---------- Report (always raises, so everything above rolls back) ----------
DO $$
DECLARE v_pass int; v_total int; v_failed text;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) INTO v_pass, v_total FROM t_results;
  SELECT string_agg(name || COALESCE(' [' || detail || ']', ''), ' | ' ORDER BY n) INTO v_failed FROM t_results WHERE NOT ok;
  RAISE EXCEPTION 'PAYMENT HARDENING LIVE TESTS: %/% passed; FAILED: %', v_pass, v_total, COALESCE(v_failed, 'none');
END $$;
```
Create `tests/db/live-script.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from './helpers/db'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db?.drop()
})

describe('the live verification script', () => {
  it('passes every check against the migrated local database, and leaves nothing behind', async () => {
    const script = readFileSync('supabase/tests/payment_hardening_live_tests.sql', 'utf8')
    const client = await db.pool.connect()
    let message = ''
    try {
      await client.query('BEGIN')
      await client.query(script).catch((err: Error) => {
        message = err.message
      })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    expect(message).toMatch(/^PAYMENT HARDENING LIVE TESTS: (\d+)\/\1 passed; FAILED: none$/)
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM feis_listings WHERE name = 'Payment Hardening Test Feis'`)
    expect(rows[0].n).toBe(0)
  })
})
```
Run: `npm run test:db -- tests/db/live-script.test.ts`
Expected: PASS. If a check fails here, fix the script or the migrations before going anywhere near live.

- [ ] **Step 2: Write the read-only live check, and run it**

Create `supabase/checks/payment-hardening-live-check.sql`:
```sql
-- payment-hardening-live-check.sql: READ ONLY. Run before applying 012–017 and 020 (Rollout step 1) and after.

-- 1. Who can do what on the three order tables
SELECT tablename, policyname, cmd, array_to_string(roles, ',') AS roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'pre_registration' AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots')
ORDER BY tablename, policyname;

-- The table ACLs themselves, with who granted each privilege: REVOKE only removes the runner's own grants
SELECT c.relname AS tbl, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.grantor::regrole AS grantor, string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privileges
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) AS a
WHERE c.relnamespace = 'pre_registration'::regnamespace
  AND c.relname IN ('registrations', 'registration_entries', 'registration_snapshots')
  AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- Which registrations columns authenticated can read (consent_ip and checkout_config must be missing after 012)
SELECT column_name FROM information_schema.column_privileges
WHERE table_schema = 'pre_registration' AND table_name = 'registrations'
  AND grantee = 'authenticated' AND privilege_type = 'SELECT'
ORDER BY column_name;

-- Column-level write grants, which the table ACLs above don't show
SELECT r.role, t.tbl, p.priv
FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) AS p(priv)
WHERE has_any_column_privilege(r.role, 'pre_registration.' || t.tbl, p.priv);

-- Row-level security, whether the service role can TRUNCATE, and every trigger on the three tables
-- (after 012: the three guards and the three TRUNCATE guards; before it, maybe 011's guard_parent_registration_write)
SELECT relname, relrowsecurity,
       has_table_privilege('service_role', oid, 'TRUNCATE') AS service_role_can_truncate
FROM pg_class
WHERE relnamespace = 'pre_registration'::regnamespace
  AND relname IN ('registrations', 'registration_entries', 'registration_snapshots')
ORDER BY relname;
SELECT tgrelid::regclass AS tbl, tgname, tgenabled
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgrelid IN ('pre_registration.registrations'::regclass, 'pre_registration.registration_entries'::regclass,
                  'pre_registration.registration_snapshots'::regclass)
ORDER BY 1, 2;

-- 2. Leftovers from the parked pay-at-the-door work (011): its functions, status check, columns and orders
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE pronamespace = 'pre_registration'::regnamespace
  AND proname IN ('confirm_pay_at_door', 'mark_registration_paid', 'guard_parent_registration_write');
SELECT pg_get_constraintdef(oid) AS status_check FROM pg_constraint WHERE conname = 'registrations_status_check';
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'pre_registration'
  AND ((table_name = 'feis_listings' AND column_name = 'allow_pay_at_door')
    OR (table_name = 'registrations' AND column_name = 'payment_method'));
-- Orders in a status outside 012's state table ('confirmed' comes from 011)
SELECT status, count(*) FROM pre_registration.registrations
WHERE status NOT IN ('draft', 'pending_payment', 'paid', 'expired', 'cancelled') GROUP BY status;
-- Only if the query above it listed registrations.payment_method:
-- SELECT payment_method, count(*) FROM pre_registration.registrations GROUP BY payment_method;

-- 3. Cron jobs. 002's hold-expiry job names no schema, so it may have been failing every minute. 012
-- replaces the job called 'expire-registration-holds'; any other job listed in the second query is 002's
-- under another name, and has to be unscheduled when 012 goes live.
SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobid;
SELECT jobid, jobname, command FROM cron.job WHERE command ILIKE '%hold_expires_at%' ORDER BY jobid;
SELECT j.jobname, d.status, d.return_message, d.start_time
FROM cron.job_run_details d JOIN cron.job j USING (jobid)
ORDER BY d.start_time DESC LIMIT 20;

-- 4. Orders by status; unpaid orders that 012 will expire; paid orders with no snapshot row
SELECT status, count(*) FROM pre_registration.registrations GROUP BY status ORDER BY status;
SELECT id, status, created_at, hold_expires_at, stripe_checkout_session_id
FROM pre_registration.registrations WHERE status IN ('draft', 'pending_payment') ORDER BY created_at;
-- 012 keeps these as they are (with purchase_snapshot NULL), and nothing can add a snapshot to them later
SELECT r.id, r.paid_at, r.confirmation_number FROM pre_registration.registrations r
WHERE r.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM pre_registration.registration_snapshots s WHERE s.registration_id = r.id);

-- 5. Duplicates the new unique keys would reject
SELECT registration_id, count(*) FROM pre_registration.registration_snapshots GROUP BY registration_id HAVING count(*) > 1;
SELECT stripe_payment_intent_id, count(*) FROM pre_registration.registrations
WHERE stripe_payment_intent_id IS NOT NULL GROUP BY stripe_payment_intent_id HAVING count(*) > 1;
SELECT stripe_checkout_session_id, count(*) FROM pre_registration.registrations
WHERE stripe_checkout_session_id IS NOT NULL GROUP BY stripe_checkout_session_id HAVING count(*) > 1;

-- 6. Paid orders whose total doesn't match their entries (the old webhook overwrote totals)
SELECT r.id, r.total_cents, r.event_fee_cents,
       sum(e.base_fee_cents + e.late_fee_cents + e.day_of_surcharge_cents) AS entry_fees
FROM pre_registration.registrations r
JOIN pre_registration.registration_entries e ON e.registration_id = r.id
WHERE r.status = 'paid'
GROUP BY r.id
HAVING r.total_cents > sum(e.base_fee_cents + e.late_fee_cents + e.day_of_surcharge_cents) + r.event_fee_cents;

-- 7. Feiseanna open for registration, the Postgres version, and the extensions this work needs
SELECT id, name, status, reg_closes_at, stripe_account_id IS NOT NULL AS has_stripe
FROM pre_registration.feis_listings WHERE status = 'open';
SELECT current_setting('server_version') AS postgres_version;
SELECT extname, extnamespace::regnamespace AS schema FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net', 'uuid-ossp', 'pgcrypto');

-- 8. Order columns that 012's guards and 013–017 read but live lacks (none expected; 012 adds
-- purchase_snapshot and the checkout columns itself)
SELECT c AS missing_column
FROM unnest(ARRAY['id', 'feis_listing_id', 'household_id', 'status', 'confirmation_number',
  'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_charge_id', 'total_cents',
  'application_fee_cents', 'event_fee_cents', 'is_late', 'consent_accepted_at', 'consent_version',
  'platform_terms_version', 'consent_ip', 'hold_expires_at', 'created_at', 'updated_at', 'paid_at']) AS c
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'pre_registration' AND table_name = 'registrations' AND column_name = c);

-- 9. Indexes on orders. One unpaid order per family per feis is 019's idx_registrations_active_unique (draft and
-- pending_payment only). 012–017 rely on it and never create or drop it, and 020 refuses to apply without it
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'pre_registration' AND tablename = 'registrations' ORDER BY indexname;

-- 10. Add-ons made by main's live code (019 lets a family pay for several orders per feis)
-- Families with more than one paid order for a feis
SELECT household_id, feis_listing_id, count(*) AS paid_orders
FROM pre_registration.registrations WHERE status = 'paid'
GROUP BY household_id, feis_listing_id HAVING count(*) > 1;
-- A dancer paid for twice in one competition (main checked this in TypeScript only)
SELECT r.feis_listing_id, e.dancer_id, e.feis_competition_id, array_agg(r.id ORDER BY r.paid_at) AS orders
FROM pre_registration.registration_entries e
JOIN pre_registration.registrations r ON r.id = e.registration_id
WHERE r.status = 'paid'
GROUP BY r.feis_listing_id, e.dancer_id, e.feis_competition_id HAVING count(*) > 1;
-- The family fee paid on more than one order for a feis (main's add-on path took no lock)
SELECT household_id, feis_listing_id, array_agg(id ORDER BY paid_at) AS orders, sum(event_fee_cents) AS event_fees
FROM pre_registration.registrations WHERE status = 'paid' AND event_fee_cents > 0
GROUP BY household_id, feis_listing_id HAVING count(*) > 1;
-- Paid orders with a total of 0 (main's free path: no claim and no session); section 4 lists paid orders with no
-- snapshot row, which these are too
SELECT id, household_id, feis_listing_id, confirmation_number, paid_at, stripe_checkout_session_id
FROM pre_registration.registrations WHERE status = 'paid' AND total_cents = 0;
```
Run it against live. Use the Supabase connector's `execute_sql`, once it's reconnected to the RunFeis organisation, or Daniel pastes it into the SQL editor. Record the answers. **Stop and ask Daniel** if any of these is true:
- an order is `confirmed`, or has a `payment_method` (pay at the door was used)
- any unpaid order belongs to a real family rather than a test account
- there are duplicate snapshots, payment intents or sessions
- a paid order's total doesn't match its entries
- section 8 lists a missing column
- section 3 shows a hold-expiry job other than `expire-registration-holds`. That is 002's job under another name. It would keep running beside 012's, so Step 7 unschedules it.
- section 9 doesn't show `idx_registrations_active_unique` exactly as `CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree (feis_listing_id, household_id) WHERE (status = ANY (ARRAY['draft'::text, 'pending_payment'::text]))` (019's), or shows another unique index on `feis_listing_id` and `household_id`. 012–017 rely on 019's index, and 020 refuses to apply without it.
- section 10 lists a dancer paid for twice in one competition, or the family fee paid on more than one order for a feis. `main`'s add-on code checked for a dance already paid for only in TypeScript, and took no lock. A pair paid for twice goes to the organiser before go-live; an extra family fee is refunded in Stripe (spec Rollout step 2). Decide with Daniel before Step 7.

Section 10's other findings are for information: families with several paid orders, and paid $0 orders (no claim or session, and no snapshot row, so section 4 lists them too). Those orders keep `purchase_snapshot = NULL`, and later orders count them from their rows (spec §4). Record the counts.

Otherwise, carry on. Note whether `cron.job_run_details` shows the old hold-expiry job failing; 012 replaces it either way.

RunFeis's fee needs no setting (Daniel, 2026-10-19): it is a flat $6 in the code, once per family per feis, so there is nothing to read or set in Vercel for it. This step read `STRIPE_APPLICATION_FEE_PERCENT` for Production and Preview (project "project-f06v2" → Settings → Environment Variables) all the same: it was unset on live, so live's Submit used its old default of 5%. Paid orders made under that default carry a 5% application fee, and the flat-fee rule counts them as having carried the fee, so a family with one isn't charged the $6 again on an add-on. Nothing reads the variable any more, so it doesn't matter if it is set or not.

- [ ] **Step 3: Rehearse 012–017 and 020 on a copy of the live data (ask first)**

The spec's Rollout step 1 asks for a rehearsal on a copy of the live data, which has 019 applied, before 012–017 and 020 go live. The script below:
- reads live once (`pg_dump` and two small `\copy` reads) and writes nothing there
- restores the copy into a throwaway local Postgres 17, with the tests' Supabase stand-ins
- applies 012–017 and then 020 the way `apply_migration` will, one transaction per file
- compares the orders before and after, and runs the live test script (Step 1) on the copy

Ask Daniel first: it needs the database password, and the copy holds family data. It only ever lives in a temporary folder, which the script deletes when it ends.

Create `supabase/checks/rehearse-on-live-copy.sh`:
```bash
#!/usr/bin/env bash
# rehearse-on-live-copy.sh: applies migrations 012–017 and then 020 to a copy of the live pre_registration
# data, which already has 019 (spec, Rollout step 1). It reads live once and never writes to it. The copy only ever lives in a
# temporary folder and a throwaway Postgres 17, and both are deleted when the script ends.
# Usage: LIVE_DB_URL='<connection string>' supabase/checks/rehearse-on-live-copy.sh
set -euo pipefail

: "${LIVE_DB_URL:?Set LIVE_DB_URL to the live database connection string}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG="${PG_BIN:-$(brew --prefix postgresql@17)/bin}"
WORK="$(mktemp -d)"
cleanup() {
  "$PG/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

live() { "$PG/psql" "$LIVE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
copy() { PGOPTIONS='-c client_min_messages=warning' "$PG/psql" -h "$WORK" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
value() { copy -At -c "$1"; }

echo '== 1. Copying live (read-only)'
"$PG/pg_dump" "$LIVE_DB_URL" --schema=pre_registration --no-owner --no-privileges --file="$WORK/dump.sql"
live -c "\copy (SELECT id, email, aud, role, coalesce(created_at, now()) FROM auth.users) TO '$WORK/users.csv' CSV"
live -c "\copy (SELECT jobname, schedule, command FROM cron.job) TO '$WORK/cron_jobs.csv' CSV"
live -At -c "SELECT format('CREATE SCHEMA IF NOT EXISTS %I; CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;',
    n.nspname, e.extname, n.nspname)
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname IN ('uuid-ossp', 'pgcrypto')" > "$WORK/extensions.sql"

echo '== 2. Restoring it into a throwaway Postgres'
"$PG/initdb" -D "$WORK/data" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
"$PG/pg_ctl" -D "$WORK/data" -w -l "$WORK/server.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$WORK' -c timezone=UTC -c fsync=off -c wal_level=logical" \
  start >/dev/null
# The tests' Supabase stand-ins: the API roles, auth.users and auth.uid(), pg_cron's job table, and the
# pre_registration schema with Supabase's default grants on everything created in it
copy -f "$ROOT/tests/db/sql/supabase-standins.sql"
copy <<'SQL'
-- More of Supabase that a dump of pre_registration may refer to
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role' $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email' $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE PUBLICATION supabase_realtime;
SQL
copy -f "$WORK/extensions.sql"
copy -c "\copy auth.users (id, email, aud, role, created_at) FROM '$WORK/users.csv' CSV"
# The stand-ins have made the schema already
sed 's/^CREATE SCHEMA pre_registration;$/CREATE SCHEMA IF NOT EXISTS pre_registration;/' "$WORK/dump.sql" > "$WORK/restore.sql"
copy -f "$WORK/restore.sql" >/dev/null
copy -c "\copy cron.job (jobname, schedule, command) FROM '$WORK/cron_jobs.csv' CSV"

PAID="SELECT count(*) || ' paid, fingerprint ' || md5(coalesce(string_agg(concat_ws('|', id, household_id,
    feis_listing_id, total_cents, application_fee_cents, event_fee_cents, confirmation_number,
    stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, paid_at), ',' ORDER BY id), ''))
  FROM pre_registration.registrations WHERE status = 'paid'"
PAID_NO_SNAPSHOT_ROW="SELECT count(*) FROM pre_registration.registrations r WHERE r.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM pre_registration.registration_snapshots s WHERE s.registration_id = r.id)"
UNPAID="SELECT count(*) FROM pre_registration.registrations WHERE status IN ('draft', 'pending_payment')"
EXPIRED="SELECT count(*) FROM pre_registration.registrations WHERE status = 'expired'"
CONFIRMED="SELECT count(*) FROM pre_registration.registrations WHERE status = 'confirmed'"
LEFTOVERS="SELECT coalesce(string_agg(proname, ', ' ORDER BY proname), 'none') FROM pg_proc
  WHERE pronamespace = 'pre_registration'::regnamespace
    AND proname IN ('confirm_pay_at_door', 'mark_registration_paid', 'guard_parent_registration_write')"
HOLD_JOBS="SELECT coalesce(string_agg(coalesce(jobname, jobid::text) || ': ' || regexp_replace(command, '\s+', ' ', 'g'),
    ' | ' ORDER BY jobid), 'none')
  FROM cron.job WHERE command ILIKE '%hold_expires_at%'"
# Add-ons made by main's live code: families with several paid orders for a feis, and paid $0 orders
SEVERAL_PAID="SELECT count(*) FROM (SELECT 1 FROM pre_registration.registrations WHERE status = 'paid'
  GROUP BY household_id, feis_listing_id HAVING count(*) > 1) AS f"
FREE_PAID="SELECT count(*) FROM pre_registration.registrations WHERE status = 'paid' AND total_cents = 0"
UNPAID_INDEX="SELECT coalesce(pg_get_indexdef(to_regclass('pre_registration.idx_registrations_active_unique')), 'none')"
INDEX_019="CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree (feis_listing_id, household_id) WHERE (status = ANY (ARRAY['draft'::text, 'pending_payment'::text]))"

report() {
  echo "   orders by status:       $(value "SELECT coalesce(string_agg(status || ' ' || n, ', ' ORDER BY status), 'none')
    FROM (SELECT status, count(*) AS n FROM pre_registration.registrations GROUP BY status) s")"
  echo "   paid orders:            $(value "$PAID")"
  echo "   paid, no snapshot row:  $(value "$PAID_NO_SNAPSHOT_ROW")"
  echo "   unpaid orders:          $(value "$UNPAID")"
  echo "   'confirmed' orders:     $(value "$CONFIRMED")"
  echo "   status check:           $(value "SELECT coalesce(pg_get_constraintdef(oid), 'none') FROM pg_constraint
    WHERE conname = 'registrations_status_check'")"
  echo "   011 functions:          $(value "$LEFTOVERS")"
  echo "   triggers on orders:     $(value "SELECT coalesce(string_agg(tgname, ', ' ORDER BY tgname), 'none') FROM pg_trigger
    WHERE tgrelid = 'pre_registration.registrations'::regclass AND NOT tgisinternal")"
  echo "   hold-expiry jobs:       $(value "$HOLD_JOBS")"
  echo "   several paid orders:    $(value "$SEVERAL_PAID") families"
  echo "   paid \$0 orders:        $(value "$FREE_PAID")"
  echo "   unpaid-order index:     $(value "$UNPAID_INDEX")"
}

echo '== 3. Before 012–017 and 020'
report
paid_before="$(value "$PAID")"
paid_no_row_before="$(value "$PAID_NO_SNAPSHOT_ROW")"
several_paid_before="$(value "$SEVERAL_PAID")"
free_paid_before="$(value "$FREE_PAID")"
expired_expected=$(( $(value "$EXPIRED") + $(value "$UNPAID") ))

echo '== 4. Applying 012–017, then 020, one transaction per file, as apply_migration does'
for file in "$ROOT"/supabase/migrations/01[2-7]_*.sql "$ROOT"/supabase/migrations/020_*.sql; do
  echo "   $(basename "$file")"
  copy --single-transaction -f "$file" >/dev/null
done

echo '== 5. After'
report
failures=()
[[ "$(value "$PAID")" == "$paid_before" ]] || failures+=('paid orders changed')
[[ "$(value "$PAID_NO_SNAPSHOT_ROW")" == "$paid_no_row_before" ]] || failures+=('paid orders without a snapshot row changed')
[[ "$(value "$SEVERAL_PAID")" == "$several_paid_before" ]] || failures+=('families with several paid orders changed')
[[ "$(value "$FREE_PAID")" == "$free_paid_before" ]] || failures+=('paid $0 orders changed')
[[ "$(value "$UNPAID_INDEX")" == "$INDEX_019" ]] || failures+=("the unpaid-order index is not 019's")
[[ "$(value "$UNPAID")" == 0 ]] || failures+=('unpaid orders remain')
[[ "$(value "$EXPIRED")" == "$expired_expected" ]] || failures+=('not every legacy unpaid order expired')
[[ "$(value "$LEFTOVERS")" == none ]] || failures+=('011 functions remain')
[[ "$(value "$CONFIRMED")" == 0 ]] || failures+=("'confirmed' orders exist: 012 freezes them; ask Daniel")
[[ "$(value "$HOLD_JOBS")" == 'expire-registration-holds: '*'pre_registration.registrations'* &&
   "$(value "SELECT count(*) FROM cron.job WHERE command ILIKE '%hold_expires_at%'")" == 1 ]] ||
  failures+=("the hold-expiry jobs are not exactly 012's one")

echo '== 6. The live test script, on the copy'
if output="$(copy --single-transaction -f "$ROOT/supabase/tests/payment_hardening_live_tests.sql" 2>&1)"; then
  failures+=('the live test script finished without its report')
else
  result="$(printf '%s\n' "$output" | grep -o 'PAYMENT HARDENING LIVE TESTS: .*' || true)"
  echo "${result:-$output}"
  pattern='^PAYMENT HARDENING LIVE TESTS: ([0-9]+)/([0-9]+) passed; FAILED: none$'
  if [[ "$result" =~ $pattern ]] && [[ "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]]; then
    :
  else
    failures+=('the live tests failed')
  fi
fi

if (( ${#failures[@]} > 0 )); then
  printf 'REHEARSAL FAILED: %s\n' "${failures[@]}"
  exit 1
fi
echo 'REHEARSAL PASSED'
```
Run it. Daniel pastes the connection string (Dashboard → Connect → Session pooler, with the database password). `read -s` keeps it off the screen and out of the shell history:
```bash
cd ~/FEISSTAB-PRE-REG && chmod +x supabase/checks/rehearse-on-live-copy.sh
read -rs LIVE_DB_URL && export LIVE_DB_URL && supabase/checks/rehearse-on-live-copy.sh; unset LIVE_DB_URL
```
Expected: the last two lines are `PAYMENT HARDENING LIVE TESTS: N/N passed; FAILED: none` and `REHEARSAL PASSED` (34/34 against a copy that has 019 and `main`'s add-ons). The before and after reports cover each kind of order and leftover that live may hold:
- **Unpaid orders from before purchase snapshots** (`draft` and `pending_payment`): after, none is unpaid, and each one is `expired`.
- **Paid orders, which keep `purchase_snapshot = NULL`:** their fingerprint is the same before and after, and so is the number of paid orders with no `registration_snapshots` row. Nothing can add a snapshot to those later; Launch keeps reading their live data.
- **Leftovers from 011:** after, `confirm_pay_at_door`, `mark_registration_paid` and the `guard_parent_registration_write` trigger and function are gone. A status check that still allows `'confirmed'` does no harm once 012 is on, because its guard never lets an order move into or out of `'confirmed'`. Tidying that check is a later migration (021 or above), not part of this rollout.
- **Hold-expiry jobs:** after, exactly one, `expire-registration-holds`, naming `pre_registration.registrations`.
- **Add-ons from `main`'s live code:** the number of families with several paid orders, and of paid $0 orders, is the same before and after (the paid fingerprint covers those orders too), and the unpaid-order index is 019's before and after: 020 applied over it.
- **An add-on and a $0 add-on on the copy:** the live test script (Step 1) runs them, and late payments against several orders, through the real functions on the migrated copy.

**Stop and ask Daniel** if the script prints `REHEARSAL FAILED`, or the restore or a migration stops with an error.
- A `'confirmed'` order fails the rehearsal on purpose. 012 freezes it: it can never change status again, and `create_order` counts it as unpaid, so that family's next Submit is refused (`unpaid_order_exists`). Decide what to do with it before Step 7.
- If the restore stops on a Supabase object the stand-ins lack (a function in `auth`, say), add a stand-in for it to the script's prelude and run it again. Never edit the copied data.

- [ ] **Step 4: Set and check the Vercel settings (ask first)**

For project "project-f06v2" (team cgds-projects), in Production and Preview (Settings → Environment Variables). Use the Vercel connector once it's reconnected to that team, or Daniel does it in the dashboard. Set or confirm:
- No fee setting is needed: RunFeis's fee is a flat $6 code constant (`RUNFEIS_FEE_CENTS`), once per family per feis, taken from the organiser's payout as Stripe's application fee. The family's total doesn't change. Nothing reads `STRIPE_APPLICATION_FEE_PERCENT` any more, so don't set it, and Step 7 doesn't wait on it.
- `NEXT_PUBLIC_BASE_URL`: the site's real URL, with `https://` and no trailing slash. For Preview, the URL previews are tested on, never `localhost`. It's inlined at build time, and it's frozen into every order's Stripe return URLs (at Pay's claim) and into every email, so check it here, before Step 7. Without it they all point to `http://localhost:3000`. After changing it, redeploy, since a built site keeps the old value.
- `SUPABASE_SERVICE_ROLE_KEY`: Submit, Pay, Cancel, the webhook and the email job use it.
- `NOTIFICATIONS_CRON_SECRET`: not needed now. The email job is deferred (Daniel, 2026-10-19), so no secret exists yet. The runbook's "Turning the email job on" says what to do when it is wanted.
- `PAYMENTS_ALERT_EMAIL`: set it to Daniel's address only for now; Steve is added later by adding his address, comma-separated (Daniel, 2026-10-18). Check that `EMAIL_FROM` is `RunFeis <entries@runfeis.com>` (a verified domain) and `RESEND_API_KEY` is set. With all three set, `emailIsConfigured()` is true: confirmations and alerts send, and the success page promises the email.

`STRIPE_SECRET_KEY` and `STRIPE_CONNECT_WEBHOOK_SECRET` come with the real-Stripe work. Until the Stripe ones are set, Pay reports that payment couldn't start.

Also check how long a function may run. Pay can take about 85 s when Stripe is failing, and it must not be cut off part-way through a claim. Confirm the project runs on Fluid compute (Settings → Functions), where the default limit is 300 s. If it doesn't, turn Fluid compute on, or (ask Daniel) set `export const maxDuration` in the route segment config of the register page (where Pay and Cancel run), the success page and the webhook route, above 85.

- [ ] **Step 5: Run the full local suite one last time**

Run: `npm test && npm run test:db && npm run build`
Expected: all pass.

- [ ] **Step 6: Get a whole-branch review**

Have a fresh reviewer check `git diff main...payment-hardening` against the spec. Fix what it finds, re-run Step 5, and commit.

- [ ] **Step 7: Apply 012–017 and 020 live, then deploy straight away (ask first)**

First, re-run sections 4, 9 and 10 of the live check (Step 2), right before item 1. `main`'s add-on code keeps running until the deploy, so real families may have started or paid orders since Step 2. Stop on any unpaid order (`draft` or `pending_payment`) that belongs to a real family, not a test account: 012 expires unpaid orders, so wait for it to be paid or lapse, or close registration first. Stop if section 9 no longer shows 019's index exactly: 020 would raise only after 012–017 are already live, and by then the old app can't write orders. Keep this output: Step 9 compares against it.

Also run `SELECT current_user;` through the same tool that will apply the files (`apply_migration` or the SQL editor). Expected: `postgres`. If it is anything else, stop and ask: `payments_admin` and its functions would be owned by that role, and the SQL editor couldn't run the runbook's 3a and 3b. Section 3 of the live check now shows each cron job's `username`: pg_cron replaces a job by name only for the same user, so if the old hold-expiry job's owner differs, a second job would be created and the old one would keep failing.

1. Apply `012_order_integrity.sql` through `017_payments_admin.sql`, in order, then `020_assert_unpaid_index.sql`: with `apply_migration` (one call per file) or in the SQL editor. 019 is already live; don't apply it again. If Step 2 found 002's hold-expiry job under another name, unschedule it straight after 012, with `SELECT cron.unschedule(<that job's jobid>);`. If 020 raises, the unpaid-order index isn't 019's: stop and ask before deploying.
2. Make the API load the new functions, so Submit, Pay and the webhook don't fail with "not in the schema cache". In the SQL editor:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
   Then make one harmless call through the API. Put the project's URL and its public anon key (the same values as on Vercel) in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` first:
   ```bash
   curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/get_my_payment_reviews" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
     -H 'Content-Profile: pre_registration' -H 'Content-Type: application/json' -d '{}'
   ```
   After the files are applied, also check the owner of every function in `payments_admin`: `SELECT proname, proowner::regrole FROM pg_proc WHERE pronamespace = 'payments_admin'::regnamespace;`. Expected: `postgres` on every row.

   Expected: code `42501`, "permission denied for function get_my_payment_reviews". That's right: the API has the new function, and `anon` may not run it. Code `PGRST202` ("Could not find the function … in the schema cache") means the reload hasn't happened yet: send the `NOTIFY` again, wait a few seconds, and repeat. Any other answer (for example an API-key or JWT error, which can happen if the project uses the newer publishable keys): stop and ask before going on.
3. Straight after, merge `payment-hardening` into `main` and push. Vercel deploys `main`. Task 17 merged `main` into this branch; if `main` has moved since, merge it in again first the same way (keeping this branch's order flow), re-run Step 5, and only then merge back. The old code can't write under the new permissions, including `main`'s add-on code, which writes the order tables directly, so do these back to back, at a quiet time.
4. Once the deploy is live, and not before (`main`'s old handler doesn't expect them), add three events to the Connect webhook endpoint for `/api/webhooks/stripe` (Stripe dashboard → Developers → Webhooks; the endpoint that listens to connected accounts): `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. It then sends four, with `checkout.session.completed` (runbook §5).
5. Sign in to the deployed site as a test parent and open My entries. It should show no "We couldn't check for messages about your payments" banner, which appears when `get_my_payment_reviews` fails.
6. On the demo feis (Stripe sandbox), as that test parent, press Submit on one entry and stop at the receipt. It must create an order and show the receipt: a pricing failure ("Your entries could not be priced") shows up here, straight away, before any family meets it. Cancel the order afterwards. (The fee is a code constant, so no Vercel setting can make Submit fail to price.)

**Rollback.** There is no down-migration, and before real registrations none is needed:
- `apply_migration` runs each file as one transaction, so a file that fails changes nothing. Fix it and apply it again: 012–017 can all be re-run.
- Once 012 is live, the old app can't write orders, so rolling Vercel back to an older deployment doesn't reopen registration. Roll forward with a fixed deploy instead, and close registration on any open feis until it's out.
- 012's only change to existing data is expiring the unpaid test orders that Step 2 listed. They stay expired.

- [ ] **Step 8: Dry-read the runbook; email job deferred (Daniel, 2026-10-19)**

Read `docs/runbooks/payment-exceptions.md` once with the live Supabase dashboard open, before anyone relies on it. Check that what it points at is where it says: the Vault page (Integrations → Vault, or Database on older dashboards) and the Postgres logs. Run only the read-only queries (the open-cases query and the stuck-emails query). Fix the runbook where the dashboard differs, and commit that.

Do not schedule the email job. It stays off until several families are signing up. There is no `NOTIFICATIONS_CRON_SECRET` yet and `pg_net` isn't installed on live; the runbook's "Turning the email job on" (§5) holds the steps for when it is wanted (hourly, `0 * * * *`). Until then emails send straight away after Pay and after Stripe's notice, anything left waiting sends on the next payment, and the daily stuck-emails query shows it.

- [ ] **Step 9: Verify live**

Run `supabase/tests/payment_hardening_live_tests.sql` as one transaction (`apply_migration` or the SQL editor).
Expected error text: `PAYMENT HARDENING LIVE TESTS: N/N passed; FAILED: none`. Besides the order tables, this covers `payments_admin` and `admin_actions` (refused to parents, `anon` and the service role), 016's email queue functions (refused to `anon` and `authenticated`), the one-unpaid-order index's name and definition (019's), and add-on and $0 orders run through the real functions: a paid first order, a refused repeat of a paid dance, a $0 add-on confirmed by `confirm_free_order`, and late payments judged against several orders.

Re-run the live check (Step 2). Section 1 should now show:
- only the six read-only policies
- `SELECT` for `authenticated`, and nothing for `PUBLIC` or `anon`
- no column-level writes, and row-level security on
- `service_role_can_truncate` false on all three tables
- the three guard triggers and the three `TRUNCATE` guards, all enabled (`O`)

Section 3 should show the schema-qualified hold-expiry job and no other. Section 9 should show `idx_registrations_active_unique` as 019 made it (Step 2), and no other unique index on `feis_listing_id` and `household_id`. Section 10 should show the same findings as the re-run at the start of Step 7: migrations never change a paid order.

Then check the organiser entries view on the deployed site. Sign in as the organiser of a feis that has paid orders, and open its Entries tab: the entries show, with dancer names and competitor numbers, including any family's add-on entries (section 10 of Step 2 lists families with several paid orders). If no feis has paid orders yet, the live test script's organiser checks stand in for this; record which one you used.

- [ ] **Step 10: Record the results in the spec and commit**

Append to the "Rollout" section of `docs/2026-10-16-payment-hardening-design.md`:
```markdown
### Live verification (YYYY-MM-DD)
- Live check before: <summary of anything found and how it was handled>
- Add-ons from main's live code: <families with several paid orders, pairs paid twice, family fees paid twice, paid $0 orders, and what was done about each>
- Rehearsal on a copy of the live data: <REHEARSAL PASSED, and the before and after counts>
- RunFeis fee: a flat $6 in the code, with no Vercel setting; `STRIPE_APPLICATION_FEE_PERCENT` was <unset on live, so live used the old 5% default>
- NEXT_PUBLIC_BASE_URL: <the value in Production and Preview>; Fluid compute: <on, or the maxDuration set>
- Email: on (EMAIL_FROM RunFeis <entries@runfeis.com>, PAYMENTS_ALERT_EMAIL set)
- Schema reload: <the smoke call's answer>
- Stripe webhook events: <the four events, added at <time>>
- Migrations 012–017 and 020 applied: <time>; deployed commit <sha>
- Live tests: <N>/<N> passed
- Organiser entries view: <checked on the site, or covered by the live test script>
- Email job: deferred (Daniel, 2026-10-19)
- Still to do: the Stripe test-mode end-to-end run, together with the real Stripe setup
```
```bash
git add docs/2026-10-16-payment-hardening-design.md supabase/checks/payment-hardening-live-check.sql supabase/checks/rehearse-on-live-copy.sh supabase/tests/payment_hardening_live_tests.sql tests/db/live-script.test.ts
git commit -m "test: live verification for payment hardening, and the results"
```

- [ ] **Step 11: End to end in Stripe test mode (with the real Stripe setup)**

Run each of these on the production site (https://www.runfeis.com) with the demo feis, which is connected to the Stripe sandbox, and check that the order ends in the state shown. (Not on a preview deployment: `NEXT_PUBLIC_BASE_URL` is set for Production only, so a preview would freeze `localhost` return URLs into the checkout.) Pay once with a non-US test card too, to see whether Adaptive Pricing changes `currency` or `amount_total`:

| Case | Expected |
|---|---|
| Pay | Paid, with an `RF-` confirmation number. Stripe shows an application fee of $6.00 on a first test order |
| Back out of Stripe and press Pay again | The same checkout page resumes |
| Double-click Pay | One checkout session in Stripe |
| Cancel mid-checkout | Cancelled; the old Stripe link shows as expired |
| Let the session expire | Expired |
| Resend the same event from the Stripe dashboard | Unchanged |
| Pause the webhook endpoint, pay, wait past the hold, then resume | Confirmed late; a `late_payment_conflict` case only if, meanwhile, the family started another order that is still unpaid, or paid one this order didn't count |
| Send an expiry notice for an old session (Stripe CLI `stripe trigger`, or resend an old event) | Unchanged |
| After paying, add a dance by card (Add dances) | A second paid order with no second family fee, priced with the family max across both orders; the email says the dance was added and shows the dancer's number. Stripe shows no application fee on the add-on |
| After paying, add a dance once the family max is reached | The receipt says there's nothing to pay and the button reads Confirm entries; confirmed without Stripe, with an `RF-` number and a $0.00 email |
| Add a dance already paid for (from a second tab opened before the first add-on was paid) | Refused: "One of these dances is already entered and paid for…" or "…is already entered in…" |
| A family whose late payment is an open message-A case | The entry page shows message A and offers no way to choose dances or pay, and My entries offers no Add dances |
| With an entry page opened before the case existed (a second tab), press Pay, or choose dances and Submit | Refused with message A and its reference; no checkout opens |

Record the results under "Live verification".

- [ ] **Step 12: Confirm email is flowing**

Email is on from go-live, and sends straight away after Pay and after Stripe's notice (the email job is deferred). Don't wait for Step 11: check the first confirmation after the deploy, whether it comes from a real family's order or from Step 11's test orders.
1. Its `registration_confirmation` row in `pre_registration.notifications` is `sent`, and Resend's dashboard (Emails) shows it delivered from `entries@runfeis.com`.
2. Run the runbook's stuck-emails query (§4): no rows expected.
3. Record it under "Live verification": `Email confirmed flowing: <date>, from entries@runfeis.com`.

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §1 (functions, locks, security) | 6, 8, 9, 13, 14 |
  | §2 (permissions) | 3 |
  | §3 (immutability, transitions) | 2, 3 |
  | §4 (Submit) | 4, 6, 7 |
  | §5 (deadline policy, organiser stop at the claim) | 5, 8, 10 |
  | §6 and §6a (Pay; finding and settling a claim's session) | 5, 8, 10 |
  | §7 (Cancel) | 8, 10 |
  | §8 (events) | 11 |
  | §9 (confirmation, sync) | 9, 10 |
  | §10 (cases, messages, parent view) | 9, 10, 12 |
  | §11 (resolutions) | 14, 15 |
  | §12 (notifications) | 13 |
  | §13 (expiry) | 3, 8 |
  | §14 (add-on orders) and the revision 5 changes to §2–§4, §6, §9, §11 and §12 | 17–21 |
  | Testing (all four kinds) | 1–21, 16 |
  | Rollout | 17 (merging `main`), 16 |
- **Where the plan differs from the spec text:**
  - The spec's "migration 012" is delivered as 012–017, split by concern.
  - The notification claim and backoff rules live in SQL (016) rather than TypeScript, so they're atomic. Only error classification is a pure TypeScript function.
  - 012 also re-schedules the hold-expiry job with schema-qualified names, because pg_cron runs jobs with the default `search_path`.
  - The success-page sync finds the order's own session by its claim, rather than taking a session id from the URL.
  - The spec was updated to match all three.

