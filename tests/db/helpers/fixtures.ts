import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Dancer, FeeSchedule, FeisCompetition, FeisListing, Level } from '@/lib/types/feis-listing'
import { createOrderStore } from '@/app/_payments/order-store'
import { ageCutoffDateFor, type RequestedEntry } from '@/lib/engine/order-validation'
import {
  buildCreateOrderPayload,
  priceOrder,
  type CreateOrderPayload
} from '@/lib/engine/purchase-snapshot'
import { pgRpc } from './pg-rpc'

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
 * Test-only: writes an order the way create_order will (Task 6), using the same trigger markers.
 * A paid order is then claimed, given a session and paid the way claim_checkout,
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
        `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}',
           checkout_claimed_at = now(), checkout_expires_at = now() + interval '60 minutes',
           hold_expires_at = now() + interval '75 minutes'
         WHERE id = $1`,
        [id]
      )
      await client.query(
        `UPDATE registrations SET status = 'pending_payment',
           stripe_checkout_session_id = 'cs_' || replace($1::text, '-', '')
         WHERE id = $1`,
        [id]
      )
      await client.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-' || substr($1::text, 1, 5),
           stripe_payment_intent_id = 'pi_' || replace($1::text, '-', ''), hold_expires_at = NULL
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
    feeSchedule: input.listing.feeSchedule
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

/** A real draft order made through create_order: Novice Reel and Slip Jig, one dancer, $40.00. */
export async function createDraftOrder(
  pool: Pool,
  opts: { family?: Family; listing?: ListingFixture } = {}
): Promise<DraftOrderFixture> {
  const listing = opts.listing ?? (await createListing(pool))
  const family = opts.family ?? (await createFamily(pool))
  const dancer = await createDancer(pool, family.householdId)
  const entries = [
    { dancerId: dancer.id, competitionId: listing.competitions[0].id },
    { dancerId: dancer.id, competitionId: listing.competitions[1].id }
  ]
  const payload = buildPayload({ listing, dancers: [dancer], entries })
  const result = await createOrderStore(pgRpc(pool)).createOrder(
    family.householdId,
    listing.listing.id,
    payload
  )
  if (result.status !== 'created') throw new Error(`Fixture order was refused: ${result.reason}`)
  return {
    family,
    listing,
    dancers: [dancer],
    entries,
    payload,
    registrationId: result.registration_id
  }
}
