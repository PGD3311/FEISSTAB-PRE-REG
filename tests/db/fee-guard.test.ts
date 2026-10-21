import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createListing } from './helpers/fixtures'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db?.drop()
})

function asOwner<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return asRole(db.pool, 'authenticated', userId, fn)
}

function setSoloFee(ownerId: string, listingId: string, cents: number) {
  return asOwner(ownerId, (c) =>
    c.query('UPDATE fee_schedules SET solo_fee_cents = $1 WHERE feis_listing_id = $2', [
      cents,
      listingId
    ])
  )
}

async function soloFee(listingId: string): Promise<number> {
  const { rows } = await db.pool.query(
    'SELECT solo_fee_cents FROM fee_schedules WHERE feis_listing_id = $1',
    [listingId]
  )
  return rows[0].solo_fee_cents
}

describe('fee guard: a feis past draft keeps a fee for every kind of competition it offers', () => {
  it.each(['open', 'closed', 'launched'])('refuses a $0 solo fee on a %s feis', async (status) => {
    const { listing, organiserId } = await createListing(db.pool, { status })
    const message = await refused(setSoloFee(organiserId, listing.id, 0))
    expect(message).toMatch(/Solo fee must be greater than \$0/)
    expect(await soloFee(listing.id)).toBe(1500)
  })

  it('refuses a $0 championship fee when the feis offers that championship', async () => {
    const { listing, organiserId } = await createListing(db.pool)
    await db.pool.query(
      `INSERT INTO feis_competitions (feis_listing_id, competition_type, championship_key, fee_category,
         display_name) VALUES ($1, 'championship', 'open', 'open_champ', 'Open Championship')`,
      [listing.id]
    )
    const message = await refused(
      asOwner(organiserId, (c) =>
        c.query('UPDATE fee_schedules SET open_champ_fee_cents = 0 WHERE feis_listing_id = $1', [
          listing.id
        ])
      )
    )
    expect(message).toMatch(/Championship fee must be greater than \$0/)
  })

  it('allows a non-zero fee change on an open feis', async () => {
    const { listing, organiserId } = await createListing(db.pool)
    await setSoloFee(organiserId, listing.id, 1600)
    expect(await soloFee(listing.id)).toBe(1600)
  })

  it('allows $0 on a draft, which Review blocks at submit', async () => {
    const { listing, organiserId } = await createListing(db.pool, { status: 'draft' })
    await setSoloFee(organiserId, listing.id, 0)
    expect(await soloFee(listing.id)).toBe(0)
  })

  it('allows $0 for a category the feis does not offer', async () => {
    const { listing, organiserId } = await createListing(db.pool)
    await asOwner(organiserId, (c) =>
      c.query('UPDATE fee_schedules SET prelim_champ_fee_cents = 0 WHERE feis_listing_id = $1', [
        listing.id
      ])
    )
    const { rows } = await db.pool.query(
      'SELECT prelim_champ_fee_cents FROM fee_schedules WHERE feis_listing_id = $1',
      [listing.id]
    )
    expect(rows[0].prelim_champ_fee_cents).toBe(0)
  })

  it('does not bind migrations and service-role code', async () => {
    const { listing } = await createListing(db.pool)
    await db.pool.query('UPDATE fee_schedules SET solo_fee_cents = 0 WHERE feis_listing_id = $1', [
      listing.id
    ])
    expect(await soloFee(listing.id)).toBe(0)
  })
})
