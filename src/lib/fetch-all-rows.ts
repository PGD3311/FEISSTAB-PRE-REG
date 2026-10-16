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
