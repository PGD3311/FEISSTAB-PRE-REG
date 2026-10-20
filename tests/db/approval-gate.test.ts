import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createListing, createUser } from './helpers/fixtures'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db?.drop()
})

// ─── Helpers ───

function asUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return asRole(db.pool, 'authenticated', userId, fn)
}

function asAnon<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return asRole(db.pool, 'anon', null, fn)
}

async function createOrganiser(opts: { profile?: boolean } = {}): Promise<string> {
  const user = await createUser(db.pool, 'organiser')
  if (opts.profile !== false) {
    await db.pool.query(
      `INSERT INTO organiser_profiles (user_id, full_name, organisation, region, phone)
       VALUES ($1, 'Steve Test', 'Test Feis Committee', 'Mid-Atlantic', '555-0199')`,
      [user.id]
    )
  }
  return user.id
}

async function createAdmin(): Promise<string> {
  const user = await createUser(db.pool, 'admin')
  await db.pool.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [user.id])
  return user.id
}

/** A listing written as the superuser, so the guard doesn't apply: the starting point for a test */
async function seedListing(
  ownerId: string,
  opts: {
    status?: string
    sanctionRegion?: string | null
    sanctionReference?: string | null
    approved?: boolean
  } = {}
): Promise<string> {
  const { rows } = await db.pool.query(
    `INSERT INTO feis_listings (name, feis_date, venue_name, contact_email, status, sanction_region,
       sanction_reference, approved_at, created_by)
     VALUES ('Gate Feis', '2027-03-14', 'Test Hall', 'organiser@runfeis.test', $1, $2, $3, $4, $5)
     RETURNING id`,
    [
      opts.status ?? 'draft',
      opts.sanctionRegion === undefined ? 'Mid-Atlantic' : opts.sanctionRegion,
      opts.sanctionReference === undefined ? 'MA-2027-014' : opts.sanctionReference,
      opts.approved ? new Date().toISOString() : null,
      ownerId
    ]
  )
  return rows[0].id
}

async function listingRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM feis_listings WHERE id = $1', [id])
  return rows[0]
}

function submit(ownerId: string, id: string) {
  return asUser(ownerId, (c) =>
    c.query(`UPDATE feis_listings SET status = 'pending_review' WHERE id = $1`, [id])
  )
}

/** A draft its owner has submitted for approval */
async function pendingListing(): Promise<{ ownerId: string; id: string }> {
  const ownerId = await createOrganiser()
  const id = await seedListing(ownerId)
  await submit(ownerId, id)
  return { ownerId, id }
}

/** Rows this role and user can see, by id */
function visibleIds(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id)
}

// ─── Tests ───

describe('creating a feis', () => {
  it('lets an organiser create a draft', async () => {
    const ownerId = await createOrganiser()
    const { rows } = await asUser(ownerId, (c) =>
      c.query(
        `INSERT INTO feis_listings (name, status, created_by) VALUES ('New Feis', 'draft', $1) RETURNING id`,
        [ownerId]
      )
    )
    expect((await listingRow(rows[0].id)).status).toBe('draft')
  })

  it('refuses an organiser creating a feis that is already open', async () => {
    const ownerId = await createOrganiser()
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query(
          `INSERT INTO feis_listings (name, status, created_by) VALUES ('Sneaky', 'open', $1)`,
          [ownerId]
        )
      )
    )
    expect(message).toMatch(/a new feis starts as a draft/)
  })

  it('refuses an organiser creating a feis that is waiting for approval', async () => {
    const ownerId = await createOrganiser()
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query(
          `INSERT INTO feis_listings (name, status, created_by) VALUES ('Sneaky', 'pending_review', $1)`,
          [ownerId]
        )
      )
    )
    expect(message).toMatch(/a new feis starts as a draft/)
  })

  it('refuses an organiser creating a draft that carries an approval', async () => {
    const ownerId = await createOrganiser()
    for (const column of ['approved_at', 'submitted_at']) {
      const message = await refused(
        asUser(ownerId, (c) =>
          c.query(
            `INSERT INTO feis_listings (name, status, created_by, ${column}) VALUES ('Sneaky', 'draft', $1, now())`,
            [ownerId]
          )
        )
      )
      expect(message).toMatch(/a new feis starts as a draft/)
    }
    const byMessage = await refused(
      asUser(ownerId, (c) =>
        c.query(
          `INSERT INTO feis_listings (name, status, created_by, approved_by) VALUES ('Sneaky', 'draft', $1, $1)`,
          [ownerId]
        )
      )
    )
    expect(byMessage).toMatch(/a new feis starts as a draft/)
    const noteMessage = await refused(
      asUser(ownerId, (c) =>
        c.query(
          `INSERT INTO feis_listings (name, status, created_by, review_note) VALUES ('Sneaky', 'draft', $1, 'ok')`,
          [ownerId]
        )
      )
    )
    expect(noteMessage).toMatch(/a new feis starts as a draft/)
  })
})

describe('submitting for approval', () => {
  it('refuses an organiser opening a draft directly', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId)
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query(`UPDATE feis_listings SET status = 'open' WHERE id = $1`, [id])
      )
    )
    expect(message).toMatch(/a feis cannot move from draft to open/)
    expect((await listingRow(id)).status).toBe('draft')
  })

  it('refuses a submit without a sanction region', async () => {
    const ownerId = await createOrganiser()
    for (const region of [null, '  ']) {
      const id = await seedListing(ownerId, { sanctionRegion: region })
      const message = await refused(submit(ownerId, id))
      expect(message).toMatch(/sanction region and reference/)
    }
  })

  it('refuses a submit without a sanction reference', async () => {
    const ownerId = await createOrganiser()
    for (const reference of [null, '']) {
      const id = await seedListing(ownerId, { sanctionReference: reference })
      const message = await refused(submit(ownerId, id))
      expect(message).toMatch(/sanction region and reference/)
    }
  })

  it('refuses a submit from an organiser without organiser details', async () => {
    const ownerId = await createOrganiser({ profile: false })
    const id = await seedListing(ownerId)
    const message = await refused(submit(ownerId, id))
    expect(message).toMatch(/organiser details/)
    expect((await listingRow(id)).status).toBe('draft')
  })

  it('a good submit waits for review and records when it was submitted', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId)
    await submit(ownerId, id)
    const row = await listingRow(id)
    expect(row.status).toBe('pending_review')
    expect(row.submitted_at).not.toBeNull()
    expect(row.approved_at).toBeNull()
  })

  it('lets the organiser add the sanction details in the same update as the submit', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId, { sanctionRegion: null, sanctionReference: null })
    await asUser(ownerId, (c) =>
      c.query(
        `UPDATE feis_listings SET status = 'pending_review', sanction_region = 'New England',
           sanction_reference = 'NE-1' WHERE id = $1`,
        [id]
      )
    )
    expect((await listingRow(id)).status).toBe('pending_review')
  })

  it('refuses an organiser setting submitted_at themselves', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId)
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query(`UPDATE feis_listings SET submitted_at = now() - interval '9 days' WHERE id = $1`, [
          id
        ])
      )
    )
    expect(message).toMatch(/only RunFeis/)
  })
})

describe('while waiting for approval', () => {
  it('refuses the organiser editing the feis', async () => {
    const { ownerId, id } = await pendingListing()
    for (const sql of [
      `UPDATE feis_listings SET name = 'Changed after submit' WHERE id = $1`,
      `UPDATE feis_listings SET sanction_reference = 'OTHER' WHERE id = $1`,
      `UPDATE feis_listings SET status = 'draft', name = 'Changed on withdraw' WHERE id = $1`
    ]) {
      const message = await refused(asUser(ownerId, (c) => c.query(sql, [id])))
      expect(message).toMatch(/waiting for approval cannot be changed/)
    }
    expect((await listingRow(id)).name).toBe('Gate Feis')
  })

  it('refuses the organiser approving their own feis', async () => {
    const { ownerId, id } = await pendingListing()
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query(`UPDATE feis_listings SET status = 'open', approved_at = now() WHERE id = $1`, [id])
      )
    )
    expect(message).toMatch(/only RunFeis|cannot move from pending_review to open/)
    const statusOnly = await refused(
      asUser(ownerId, (c) =>
        c.query(`UPDATE feis_listings SET status = 'open' WHERE id = $1`, [id])
      )
    )
    expect(statusOnly).toMatch(/a feis cannot move from pending_review to open/)
  })

  it('lets the organiser withdraw it back to a draft', async () => {
    const { ownerId, id } = await pendingListing()
    await asUser(ownerId, (c) =>
      c.query(`UPDATE feis_listings SET status = 'draft' WHERE id = $1`, [id])
    )
    expect((await listingRow(id)).status).toBe('draft')
  })
})

describe('approve_listing and send_back_listing', () => {
  it('refuses an organiser who is not an admin', async () => {
    const { ownerId, id } = await pendingListing()
    const approve = await refused(
      asUser(ownerId, (c) => c.query('SELECT approve_listing($1)', [id]))
    )
    expect(approve).toMatch(/only RunFeis admins/)
    const sendBack = await refused(
      asUser(ownerId, (c) => c.query(`SELECT send_back_listing($1, 'please fix')`, [id]))
    )
    expect(sendBack).toMatch(/only RunFeis admins/)
    expect((await listingRow(id)).status).toBe('pending_review')
  })

  it('refuses anon outright', async () => {
    const { id } = await pendingListing()
    const approve = await refused(asAnon((c) => c.query('SELECT approve_listing($1)', [id])))
    expect(approve).toMatch(/permission denied/)
    const sendBack = await refused(
      asAnon((c) => c.query(`SELECT send_back_listing($1, 'please fix')`, [id]))
    )
    expect(sendBack).toMatch(/permission denied/)
  })

  it('an admin approves: the feis opens, with when and by whom', async () => {
    const adminId = await createAdmin()
    const { id } = await pendingListing()
    const { rows } = await asUser(adminId, (c) => c.query('SELECT approve_listing($1) AS id', [id]))
    expect(rows[0].id).toBe(id)
    const row = await listingRow(id)
    expect(row.status).toBe('open')
    expect(row.approved_at).not.toBeNull()
    expect(row.approved_by).toBe(adminId)
    expect(row.review_note).toBeNull()
  })

  it('an admin approves only a feis waiting for approval', async () => {
    const adminId = await createAdmin()
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId)
    const message = await refused(
      asUser(adminId, (c) => c.query('SELECT approve_listing($1)', [id]))
    )
    expect(message).toMatch(/not waiting for approval/)
    expect((await listingRow(id)).status).toBe('draft')
  })

  it('send back needs a note with words in it', async () => {
    const adminId = await createAdmin()
    const { id } = await pendingListing()
    for (const note of [null, '', '   ']) {
      const message = await refused(
        asUser(adminId, (c) => c.query('SELECT send_back_listing($1, $2)', [id, note]))
      )
      expect(message).toMatch(/a note saying what to fix is required/)
    }
    expect((await listingRow(id)).status).toBe('pending_review')
  })

  it('send back returns the feis to a draft with the note', async () => {
    const adminId = await createAdmin()
    const { id } = await pendingListing()
    await asUser(adminId, (c) =>
      c.query('SELECT send_back_listing($1, $2)', [id, 'The sanction number does not match'])
    )
    const row = await listingRow(id)
    expect(row.status).toBe('draft')
    expect(row.review_note).toBe('The sanction number does not match')
    expect(row.approved_at).toBeNull()
  })

  it('the organiser can edit a sent-back draft but not its note, and resubmitting clears the note', async () => {
    const adminId = await createAdmin()
    const { ownerId, id } = await pendingListing()
    await asUser(adminId, (c) => c.query('SELECT send_back_listing($1, $2)', [id, 'Fix the venue']))

    const noteChange = await refused(
      asUser(ownerId, (c) =>
        c.query(`UPDATE feis_listings SET review_note = NULL WHERE id = $1`, [id])
      )
    )
    expect(noteChange).toMatch(/only RunFeis/)

    await asUser(ownerId, (c) =>
      c.query(`UPDATE feis_listings SET venue_name = 'Better Hall' WHERE id = $1`, [id])
    )
    const before = await listingRow(id)
    await submit(ownerId, id)
    const row = await listingRow(id)
    expect(row.status).toBe('pending_review')
    expect(row.review_note).toBeNull()
    expect(row.venue_name).toBe('Better Hall')
    expect(new Date(row.submitted_at).getTime()).toBeGreaterThan(
      new Date(before.submitted_at).getTime()
    )
  })
})

describe('after approval', () => {
  it('lets the organiser close entries and reopen them', async () => {
    const adminId = await createAdmin()
    const { ownerId, id } = await pendingListing()
    await asUser(adminId, (c) => c.query('SELECT approve_listing($1)', [id]))
    await asUser(ownerId, (c) =>
      c.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [id])
    )
    await asUser(ownerId, (c) =>
      c.query(`UPDATE feis_listings SET status = 'open' WHERE id = $1`, [id])
    )
    expect((await listingRow(id)).status).toBe('open')
  })

  it('refuses reopening a closed feis that was never approved', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId, { status: 'closed', approved: false })
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query(`UPDATE feis_listings SET status = 'open' WHERE id = $1`, [id])
      )
    )
    expect(message).toMatch(/only a feis RunFeis approved/)
    expect((await listingRow(id)).status).toBe('closed')
  })

  it('lets the organiser launch a closed feis', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId, { status: 'closed', approved: true })
    await asUser(ownerId, (c) =>
      c.query(`UPDATE feis_listings SET status = 'launched', launched_at = now() WHERE id = $1`, [
        id
      ])
    )
    expect((await listingRow(id)).status).toBe('launched')
  })

  it('refuses the organiser changing or clearing the approval', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId, { status: 'open', approved: true })
    for (const sql of [
      `UPDATE feis_listings SET approved_at = NULL WHERE id = $1`,
      `UPDATE feis_listings SET approved_by = created_by WHERE id = $1`,
      `UPDATE feis_listings SET review_note = 'self note' WHERE id = $1`
    ]) {
      const message = await refused(asUser(ownerId, (c) => c.query(sql, [id])))
      expect(message).toMatch(/only RunFeis/)
    }
  })

  it('still lets the organiser edit an open feis, as before', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId, { status: 'open', approved: true })
    await asUser(ownerId, (c) =>
      c.query(`UPDATE feis_listings SET description = 'Now with a ceili' WHERE id = $1`, [id])
    )
    expect((await listingRow(id)).description).toBe('Now with a ceili')
  })

  it('refuses moves outside the table, such as open back to a draft', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId, { status: 'open', approved: true })
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query(`UPDATE feis_listings SET status = 'draft' WHERE id = $1`, [id])
      )
    )
    expect(message).toMatch(/a feis cannot move from open to draft/)
  })
})

describe('who can read what', () => {
  it('anon cannot read a feis waiting for approval; an admin can, with its fees and syllabus', async () => {
    const adminId = await createAdmin()
    const { id } = await pendingListing()
    await db.pool.query(`INSERT INTO fee_schedules (feis_listing_id) VALUES ($1)`, [id])
    await db.pool.query(
      `INSERT INTO feis_competitions (feis_listing_id, age_group_key, age_group_label, level_key, level_label,
         dance_key, dance_label, competition_type, fee_category, display_name, enabled)
       VALUES ($1, 'U10', 'Under 10', 'NOV', 'Novice', 'reel', 'Reel', 'solo', 'solo', 'Novice Reel U10', true)`,
      [id]
    )

    const anonRows = await asAnon((c) =>
      c.query('SELECT id FROM feis_listings WHERE id = $1', [id])
    )
    expect(anonRows.rows).toEqual([])

    const otherOrganiser = await createOrganiser()
    const otherRows = await asUser(otherOrganiser, (c) =>
      c.query('SELECT id FROM feis_listings WHERE id = $1', [id])
    )
    expect(otherRows.rows).toEqual([])

    const adminView = await asUser(adminId, async (c) => ({
      listings: (await c.query('SELECT id FROM feis_listings WHERE id = $1', [id])).rows,
      fees: (await c.query('SELECT id FROM fee_schedules WHERE feis_listing_id = $1', [id])).rows,
      competitions: (
        await c.query('SELECT id FROM feis_competitions WHERE feis_listing_id = $1', [id])
      ).rows
    }))
    expect(visibleIds(adminView.listings)).toEqual([id])
    expect(adminView.fees).toHaveLength(1)
    expect(adminView.competitions).toHaveLength(1)
  })

  it('an admin can read but not edit someone else’s feis', async () => {
    const adminId = await createAdmin()
    const { id } = await pendingListing()
    const { rowCount } = await asUser(adminId, (c) =>
      c.query(`UPDATE feis_listings SET name = 'Admin edit' WHERE id = $1`, [id])
    )
    expect(rowCount).toBe(0)
    expect((await listingRow(id)).name).toBe('Gate Feis')
  })

  it('existing open listings stay readable to the public', async () => {
    const { listing } = await createListing(db.pool)
    const { rows } = await asAnon((c) =>
      c.query('SELECT id FROM feis_listings WHERE id = $1', [listing.id])
    )
    expect(visibleIds(rows)).toEqual([listing.id])
    const fees = await asAnon((c) =>
      c.query('SELECT id FROM fee_schedules WHERE feis_listing_id = $1', [listing.id])
    )
    expect(fees.rows).toHaveLength(1)
  })

  it('platform_admins cannot be read or written by authenticated or anon', async () => {
    const adminId = await createAdmin()
    const someone = await createOrganiser()
    for (const run of [
      (fn: (c: PoolClient) => Promise<unknown>) => asUser(adminId, fn),
      (fn: (c: PoolClient) => Promise<unknown>) => asUser(someone, fn),
      (fn: (c: PoolClient) => Promise<unknown>) => asAnon(fn)
    ]) {
      expect(await refused(run((c) => c.query('SELECT * FROM platform_admins')))).toMatch(
        /permission denied/
      )
      expect(
        await refused(
          run((c) => c.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [someone]))
        )
      ).toMatch(/permission denied/)
      expect(await refused(run((c) => c.query('DELETE FROM platform_admins')))).toMatch(
        /permission denied/
      )
    }
  })

  it('is_platform_admin is true only for an admin, and anon cannot call it', async () => {
    const adminId = await createAdmin()
    const someone = await createOrganiser()
    const forAdmin = await asUser(adminId, (c) => c.query('SELECT is_platform_admin() AS yes'))
    expect(forAdmin.rows[0].yes).toBe(true)
    const forOther = await asUser(someone, (c) => c.query('SELECT is_platform_admin() AS yes'))
    expect(forOther.rows[0].yes).toBe(false)
    expect(await refused(asAnon((c) => c.query('SELECT is_platform_admin()')))).toMatch(
      /permission denied/
    )
  })
})

describe('organiser_profiles', () => {
  it('a user reads and writes only their own row; an admin reads every row', async () => {
    const adminId = await createAdmin()
    const alice = await createOrganiser({ profile: false })
    const bob = await createOrganiser()

    await asUser(alice, (c) =>
      c.query(
        `INSERT INTO organiser_profiles (user_id, full_name, organisation, region)
         VALUES ($1, 'Alice', 'Scoil Alice', 'New England')`,
        [alice]
      )
    )
    await asUser(alice, (c) =>
      c.query(`UPDATE organiser_profiles SET phone = '555-0111' WHERE user_id = $1`, [alice])
    )

    const aliceSees = await asUser(alice, (c) => c.query('SELECT user_id FROM organiser_profiles'))
    expect(aliceSees.rows.map((r) => r.user_id)).toEqual([alice])

    const forBob = await refused(
      asUser(alice, (c) =>
        c.query(
          `INSERT INTO organiser_profiles (user_id, full_name, organisation, region)
           VALUES (gen_random_uuid(), 'Fake', 'Fake', 'Western')`
        )
      )
    )
    expect(forBob).toMatch(/row-level security|violates foreign key/)
    const bobEdit = await asUser(alice, (c) =>
      c.query(`UPDATE organiser_profiles SET full_name = 'Hijacked' WHERE user_id = $1`, [bob])
    )
    expect(bobEdit.rowCount).toBe(0)

    const adminSees = await asUser(adminId, (c) =>
      c.query('SELECT user_id FROM organiser_profiles WHERE user_id = ANY($1)', [[alice, bob]])
    )
    expect(adminSees.rows.map((r) => r.user_id).sort()).toEqual([alice, bob].sort())

    expect(await refused(asAnon((c) => c.query('SELECT * FROM organiser_profiles')))).toMatch(
      /permission denied/
    )
  })
})

describe('every move outside the table', () => {
  const STATUSES = ['draft', 'pending_review', 'open', 'closed', 'launched']
  const ALLOWED = [
    'draft>pending_review',
    'pending_review>draft',
    'open>closed',
    'closed>open',
    'closed>launched'
  ]
  const refusedMoves = STATUSES.flatMap((from) =>
    STATUSES.filter((to) => to !== from && !ALLOWED.includes(`${from}>${to}`)).map((to) => [
      from,
      to
    ])
  )

  it.each(refusedMoves)('refuses an organiser moving a feis from %s to %s', async (from, to) => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId, { status: from, approved: true })
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query('UPDATE feis_listings SET status = $2 WHERE id = $1', [id, to])
      )
    )
    expect(message).toMatch(new RegExp(`a feis cannot move from ${from} to ${to}`))
    expect((await listingRow(id)).status).toBe(from)
  })
})

describe('fees and syllabus while waiting for approval', () => {
  const FROZEN = /This feis is waiting for RunFeis approval\. Withdraw it first to make changes\./

  async function pendingWithFeesAndSyllabus() {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId)
    await db.pool.query('INSERT INTO fee_schedules (feis_listing_id) VALUES ($1)', [id])
    const {
      rows: [comp]
    } = await db.pool.query(
      `INSERT INTO feis_competitions (feis_listing_id, age_group_key, age_group_label, level_key, level_label,
         dance_key, dance_label, competition_type, fee_category, display_name, enabled)
       VALUES ($1, 'U10', 'Under 10', 'NOV', 'Novice', 'reel', 'Reel', 'solo', 'solo', 'Novice Reel U10', true)
       RETURNING id`,
      [id]
    )
    await submit(ownerId, id)
    return { ownerId, id, competitionId: comp.id as string }
  }

  const NEW_COMPETITION = `INSERT INTO feis_competitions (feis_listing_id, age_group_key, age_group_label,
      level_key, level_label, dance_key, dance_label, competition_type, fee_category, display_name, enabled)
    VALUES ($1, 'U12', 'Under 12', 'NOV', 'Novice', 'reel', 'Reel', 'solo', 'solo', 'Novice Reel U12', true)`

  it('refuses the organiser changing the fee schedule or a competition, then allows it after a withdraw', async () => {
    const { ownerId, id, competitionId } = await pendingWithFeesAndSyllabus()

    for (const [sql, param] of [
      ['UPDATE fee_schedules SET solo_fee_cents = 1 WHERE feis_listing_id = $1', id],
      ['DELETE FROM fee_schedules WHERE feis_listing_id = $1', id],
      ['UPDATE feis_competitions SET enabled = false WHERE id = $1', competitionId],
      ['DELETE FROM feis_competitions WHERE id = $1', competitionId],
      [NEW_COMPETITION, id]
    ]) {
      const message = await refused(asUser(ownerId, (c) => c.query(sql, [param])))
      expect(message).toMatch(FROZEN)
    }

    await asUser(ownerId, (c) =>
      c.query(`UPDATE feis_listings SET status = 'draft' WHERE id = $1`, [id])
    )
    await asUser(ownerId, (c) =>
      c.query('UPDATE fee_schedules SET solo_fee_cents = 1600 WHERE feis_listing_id = $1', [id])
    )
    await asUser(ownerId, (c) =>
      c.query('UPDATE feis_competitions SET enabled = false WHERE id = $1', [competitionId])
    )
    await asUser(ownerId, (c) => c.query(NEW_COMPETITION, [id]))

    const fee = await db.pool.query(
      'SELECT solo_fee_cents FROM fee_schedules WHERE feis_listing_id = $1',
      [id]
    )
    expect(fee.rows[0].solo_fee_cents).toBe(1600)
    const comps = await db.pool.query(
      'SELECT enabled FROM feis_competitions WHERE feis_listing_id = $1 ORDER BY display_name',
      [id]
    )
    expect(comps.rows.map((r) => r.enabled)).toEqual([false, true]) // U10 disabled, U12 added
  })

  it('refuses adding a fee schedule to a feis waiting for approval', async () => {
    const ownerId = await createOrganiser()
    const id = await seedListing(ownerId)
    await submit(ownerId, id)
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query('INSERT INTO fee_schedules (feis_listing_id) VALUES ($1)', [id])
      )
    )
    expect(message).toMatch(FROZEN)
  })

  it('refuses moving a competition into a feis waiting for approval', async () => {
    const ownerId = await createOrganiser()
    const pendingId = await seedListing(ownerId)
    await submit(ownerId, pendingId)
    const draftId = await seedListing(ownerId)
    const {
      rows: [comp]
    } = await db.pool.query(
      `INSERT INTO feis_competitions (feis_listing_id, age_group_key, age_group_label, level_key, level_label,
         dance_key, dance_label, competition_type, fee_category, display_name, enabled)
       VALUES ($1, 'U10', 'Under 10', 'NOV', 'Novice', 'reel', 'Reel', 'solo', 'solo', 'Novice Reel U10', true)
       RETURNING id`,
      [draftId]
    )
    const message = await refused(
      asUser(ownerId, (c) =>
        c.query('UPDATE feis_competitions SET feis_listing_id = $2 WHERE id = $1', [
          comp.id,
          pendingId
        ])
      )
    )
    expect(message).toMatch(FROZEN)
  })

  it('still lets an admin approve and the database apply its own changes', async () => {
    const adminId = await createAdmin()
    const { id } = await pendingWithFeesAndSyllabus()
    await db.pool.query(
      'UPDATE fee_schedules SET event_fee_cents = 900 WHERE feis_listing_id = $1',
      [id]
    )
    await asUser(adminId, (c) => c.query('SELECT approve_listing($1)', [id]))
    expect((await listingRow(id)).status).toBe('open')
  })
})

describe('the migration', () => {
  it('approves existing open, closed and launched listings, and runs again cleanly', async () => {
    const ownerId = await createOrganiser()
    const ids: Record<string, string> = {}
    for (const status of ['draft', 'open', 'closed', 'launched']) {
      ids[status] = await seedListing(ownerId, { status })
    }
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/021_approval_gate.sql'),
      'utf8'
    )
    await db.pool.query(sql)
    await db.pool.query(sql)

    expect((await listingRow(ids.draft)).approved_at).toBeNull()
    for (const status of ['open', 'closed', 'launched']) {
      expect((await listingRow(ids[status])).approved_at).not.toBeNull()
    }
  })
})
