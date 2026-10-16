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
