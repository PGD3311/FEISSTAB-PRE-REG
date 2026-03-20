// src/lib/bridge.ts
// Pure bridge logic: maps pre-reg data to Phase 1 format and writes it.
import { createClient } from '@supabase/supabase-js'

// Phase 1 Supabase client (separate project)
function createPhase1Client() {
  const url = process.env.PHASE1_SUPABASE_URL
  const key = process.env.PHASE1_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('PHASE1_SUPABASE_URL and PHASE1_SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(url, key)
}

interface PreRegData {
  listing: {
    id: string
    name: string
    feis_date: string
    end_date: string | null
    venue_name: string | null
    venue_address: string | null
  }
  competitions: {
    id: string
    display_name: string
    age_group_key: string | null
    age_group_label: string | null
    level_key: string | null
    level_label: string | null
  }[]
  entries: {
    dancer_id: string
    feis_competition_id: string
    dancer_first_name: string
    dancer_last_name: string
    dancer_date_of_birth: string | null
    dancer_school_name: string | null
  }[]
}

export interface BridgeResult {
  eventId: string
  competitionsCreated: number
  dancersCreated: number
  registrationsCreated: number
}

export async function executeBridge(data: PreRegData): Promise<BridgeResult> {
  const phase1 = createPhase1Client()

  // 1. Create event
  const location = [data.listing.venue_name, data.listing.venue_address]
    .filter(Boolean)
    .join(' — ')

  const { data: event, error: eventError } = await phase1
    .from('events')
    .insert({
      name: data.listing.name,
      start_date: data.listing.feis_date,
      end_date: data.listing.end_date,
      location: location || null,
      status: 'draft',
    })
    .select('id')
    .single()

  if (eventError || !event) {
    throw new Error(`Failed to create Phase 1 event: ${eventError?.message ?? 'unknown'}`)
  }

  // 2. Create competitions
  const competitionRows = data.competitions.map((comp) => ({
    event_id: event.id,
    name: comp.display_name,
    code: comp.display_name,
    age_group: comp.age_group_label ?? comp.age_group_key,
    level: comp.level_label ?? comp.level_key,
    status: 'imported',
  }))

  const { data: createdComps, error: compsError } = await phase1
    .from('competitions')
    .insert(competitionRows)
    .select('id, name')

  if (compsError || !createdComps) {
    // Cleanup: delete the event
    await phase1.from('events').delete().eq('id', event.id)
    throw new Error(`Failed to create Phase 1 competitions: ${compsError?.message ?? 'unknown'}`)
  }

  // Build mapping: pre-reg competition ID -> Phase 1 competition ID
  // Match by name (display_name)
  const compMap = new Map<string, string>()
  for (const preRegComp of data.competitions) {
    const phase1Comp = createdComps.find((c) => c.name === preRegComp.display_name)
    if (phase1Comp) {
      compMap.set(preRegComp.id, phase1Comp.id)
    }
  }

  // 3. Create/dedup dancers
  // Phase 1 dancers table has unique index:
  //   create unique index idx_dancers_name_school
  //     on dancers(first_name, last_name, coalesce(school_name, ''));
  // This means school_name = null is treated the same as school_name = ''
  // in the unique constraint.
  const uniqueDancers = new Map<string, {
    first_name: string
    last_name: string
    date_of_birth: string | null
    school_name: string | null
    prereg_dancer_id: string
  }>()

  for (const entry of data.entries) {
    // Normalize: null school_name and '' school_name are equivalent
    const normalizedSchool = entry.dancer_school_name || ''
    const key = `${entry.dancer_first_name}|${entry.dancer_last_name}|${normalizedSchool}`
    if (!uniqueDancers.has(key)) {
      uniqueDancers.set(key, {
        first_name: entry.dancer_first_name,
        last_name: entry.dancer_last_name,
        date_of_birth: entry.dancer_date_of_birth,
        school_name: entry.dancer_school_name,
        prereg_dancer_id: entry.dancer_id,
      })
    }
  }

  // Build dancer mapping: prereg dancer_id -> Phase 1 dancer_id
  const dancerMap = new Map<string, string>()

  for (const [, dancer] of uniqueDancers) {
    // Try to find existing dancer by name + school
    // Because of the coalesce index, we need to handle null/empty carefully
    const schoolValue = dancer.school_name || ''

    let found: { id: string } | null = null

    if (schoolValue === '') {
      // school_name could be null or '' in Phase 1 — both match the index
      const { data: foundByNull } = await phase1
        .from('dancers')
        .select('id')
        .eq('first_name', dancer.first_name)
        .eq('last_name', dancer.last_name)
        .is('school_name', null)
        .single()

      if (foundByNull) {
        found = foundByNull
      } else {
        const { data: foundByEmpty } = await phase1
          .from('dancers')
          .select('id')
          .eq('first_name', dancer.first_name)
          .eq('last_name', dancer.last_name)
          .eq('school_name', '')
          .single()
        if (foundByEmpty) {
          found = foundByEmpty
        }
      }
    } else {
      const { data: foundBySchool } = await phase1
        .from('dancers')
        .select('id')
        .eq('first_name', dancer.first_name)
        .eq('last_name', dancer.last_name)
        .eq('school_name', schoolValue)
        .single()
      if (foundBySchool) {
        found = foundBySchool
      }
    }

    if (found) {
      dancerMap.set(dancer.prereg_dancer_id, found.id)
    } else {
      // Insert new dancer
      const { data: inserted, error: insertErr } = await phase1
        .from('dancers')
        .insert({
          first_name: dancer.first_name,
          last_name: dancer.last_name,
          date_of_birth: dancer.date_of_birth,
          school_name: dancer.school_name,
        })
        .select('id')
        .single()

      if (insertErr || !inserted) {
        // Cleanup
        await phase1.from('competitions').delete().eq('event_id', event.id)
        await phase1.from('events').delete().eq('id', event.id)
        throw new Error(
          `Failed to create dancer ${dancer.first_name} ${dancer.last_name}: ${insertErr?.message ?? 'unknown'}`
        )
      }
      dancerMap.set(dancer.prereg_dancer_id, inserted.id)
    }
  }

  // Also map any duplicate dancer entries (same dancer in multiple competitions)
  // to the same Phase 1 dancer ID
  for (const entry of data.entries) {
    if (!dancerMap.has(entry.dancer_id)) {
      const normalizedSchool = entry.dancer_school_name || ''
      const key = `${entry.dancer_first_name}|${entry.dancer_last_name}|${normalizedSchool}`
      const canonical = uniqueDancers.get(key)
      if (canonical && dancerMap.has(canonical.prereg_dancer_id)) {
        dancerMap.set(entry.dancer_id, dancerMap.get(canonical.prereg_dancer_id)!)
      }
    }
  }

  // 4. Create registrations (entries)
  const registrationRows = data.entries
    .map((entry) => {
      const phase1CompId = compMap.get(entry.feis_competition_id)
      const phase1DancerId = dancerMap.get(entry.dancer_id)
      if (!phase1CompId || !phase1DancerId) return null
      return {
        event_id: event.id,
        dancer_id: phase1DancerId,
        competition_id: phase1CompId,
        status: 'registered',
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (registrationRows.length > 0) {
    const { error: regsError } = await phase1
      .from('registrations')
      .insert(registrationRows)

    if (regsError) {
      // Cleanup
      await phase1.from('registrations').delete().eq('event_id', event.id)
      await phase1.from('competitions').delete().eq('event_id', event.id)
      await phase1.from('events').delete().eq('id', event.id)
      throw new Error(`Failed to create Phase 1 registrations: ${regsError.message}`)
    }
  }

  return {
    eventId: event.id,
    competitionsCreated: createdComps.length,
    dancersCreated: dancerMap.size,
    registrationsCreated: registrationRows.length,
  }
}
