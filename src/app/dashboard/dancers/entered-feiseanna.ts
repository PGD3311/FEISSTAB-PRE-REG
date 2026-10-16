import type { createClient } from '@/lib/supabase/server'
import type { DancerFeisEntry } from '@/components/registration/entered-feiseanna'

type ServerClient = Awaited<ReturnType<typeof createClient>>

interface NumberRow {
  dancer_id: string
  competitor_number: number
  feis_listing_id: string
  feis_listings: { id: string; name: string | null; feis_date: string | null } | null
}

interface EntryRow {
  dancer_id: string
  registrations: { status: string; feis_listing_id: string } | null
  feis_competitions: {
    id: string
    display_code: string | null
    display_name: string
    dance_label: string | null
    competition_type: string
  } | null
}

/**
 * For each dancer, the feiseanna they're entered in (paid), with their competitor number and
 * dances. Newest feis first. Used by the dancers list and each dancer's page.
 */
export async function loadEnteredFeiseanna(
  supabase: ServerClient,
  dancerIds: string[]
): Promise<Record<string, DancerFeisEntry[]>> {
  const result: Record<string, DancerFeisEntry[]> = {}
  if (dancerIds.length === 0) return result

  const [numbersResult, entriesResult] = await Promise.all([
    supabase
      .from('competitor_numbers')
      .select('dancer_id, competitor_number, feis_listing_id, feis_listings(id, name, feis_date)')
      .in('dancer_id', dancerIds),
    supabase
      .from('registration_entries')
      .select(
        'dancer_id, registrations!inner(status, feis_listing_id), feis_competitions(id, display_code, display_name, dance_label, competition_type)'
      )
      .in('dancer_id', dancerIds)
      .eq('registrations.status', 'paid')
  ])

  if (numbersResult.error) console.error('Failed to load competitor numbers:', numbersResult.error)
  if (entriesResult.error) console.error('Failed to load paid entries:', entriesResult.error)

  const byKey = new Map<string, DancerFeisEntry>()
  const keyOf = (dancerId: string, feisId: string) => `${dancerId}|${feisId}`

  for (const row of (numbersResult.data ?? []) as unknown as NumberRow[]) {
    byKey.set(keyOf(row.dancer_id, row.feis_listing_id), {
      dancerId: row.dancer_id,
      feisId: row.feis_listing_id,
      feisName: row.feis_listings?.name ?? 'Feis',
      feisDate: row.feis_listings?.feis_date ?? null,
      number: row.competitor_number,
      competitions: []
    })
  }

  for (const row of (entriesResult.data ?? []) as unknown as EntryRow[]) {
    const comp = row.feis_competitions
    const feisId = row.registrations?.feis_listing_id
    if (!comp || !feisId) continue
    const entry = byKey.get(keyOf(row.dancer_id, feisId))
    // Paid entries without a number yet are skipped; numbers are assigned when payment completes
    if (!entry) continue
    entry.competitions.push({
      id: comp.id,
      code: comp.display_code,
      name:
        comp.competition_type === 'solo' && comp.dance_label ? comp.dance_label : comp.display_name
    })
  }

  for (const entry of byKey.values()) {
    ;(result[entry.dancerId] ??= []).push(entry)
  }
  for (const list of Object.values(result)) {
    list.sort((a, b) => (b.feisDate ?? '').localeCompare(a.feisDate ?? ''))
  }
  return result
}
