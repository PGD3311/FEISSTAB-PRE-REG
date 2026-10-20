// src/lib/bridge.ts
// Pure bridge logic: maps pre-reg data to Phase 1 format and writes it.
// Uses upsert on external ID columns for idempotent re-runs.
import { createFeisDayClient } from '@/lib/supabase/service'
import { redactWithEnv, safeErrorMessage } from '@/lib/redact-secrets'

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
    display_code: string | null
    age_group_key: string | null
    age_group_label: string | null
    level_key: string | null
    level_label: string | null
  }[]
  competitorNumbers: {
    dancer_id: string
    competitor_number: number
  }[]
  entries: {
    id: string
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
  competitorNumbersAssigned: number
}

export function buildEventRow(listing: PreRegData['listing']) {
  const location = [listing.venue_name, listing.venue_address].filter(Boolean).join(' — ')
  return {
    prereg_feis_listing_id: listing.id,
    name: listing.name,
    start_date: listing.feis_date,
    end_date: listing.end_date,
    location: location || null,
    status: 'draft',
    import_status: 'importing',
    import_error: null
  }
}

export function buildCompetitionRow(eventId: string, comp: PreRegData['competitions'][number]) {
  return {
    event_id: eventId,
    prereg_feis_competition_id: comp.id,
    name: comp.display_name,
    code: comp.display_code ?? comp.display_name,
    age_group: comp.age_group_label ?? comp.age_group_key,
    level: comp.level_label ?? comp.level_key,
    status: 'imported'
  }
}

export function buildDancerRow(entry: PreRegData['entries'][number]) {
  return {
    prereg_dancer_id: entry.dancer_id,
    first_name: entry.dancer_first_name,
    last_name: entry.dancer_last_name,
    date_of_birth: entry.dancer_date_of_birth,
    school_name: entry.dancer_school_name
  }
}

export function buildRegistrationRow(
  eventId: string,
  entry: PreRegData['entries'][number],
  phase1CompId: string,
  phase1DancerId: string,
  competitorNumber: string | null
) {
  return {
    event_id: eventId,
    dancer_id: phase1DancerId,
    competition_id: phase1CompId,
    status: 'registered',
    competitor_number: competitorNumber,
    prereg_registration_entry_id: entry.id
  }
}

export function shouldCreateStage(existingStageCount: number): boolean {
  return existingStageCount === 0
}

// Most feiseanna run at least five stages (Steve); unused ones can be deleted in feis day
export const STARTING_STAGE_COUNT = 5

export function startingStages(
  eventId: string
): { event_id: string; name: string; display_order: number }[] {
  return Array.from({ length: STARTING_STAGE_COUNT }, (_, i) => ({
    event_id: eventId,
    name: `Stage ${i + 1}`,
    display_order: i + 1
  }))
}

const REGISTRATION_CODE_ATTEMPTS = 6

function randomRegistrationCode(): string {
  return Math.random().toString(16).slice(2, 8).padEnd(6, '0').toUpperCase()
}

// Same shape as feis day's create_event: 6 uppercase hex characters, retried on collision.
export async function generateRegistrationCode(
  exists: (code: string) => Promise<boolean>,
  random: () => string = randomRegistrationCode
): Promise<string> {
  for (let attempt = 0; attempt < REGISTRATION_CODE_ATTEMPTS; attempt++) {
    const code = random()
    if (!(await exists(code))) return code
  }
  throw new Error('Failed to generate a unique registration code')
}

type FeisDayClient = ReturnType<typeof createFeisDayClient>

// Does what feis day's create_event RPC does, so the organiser can see the event:
// created_by, registration code, organizer role, first stage, audit entry.
// Safe to re-run: existing owner, code, role and stages are kept.
export async function createOwnedEvent(
  phase1: FeisDayClient,
  listing: PreRegData['listing'],
  organiserId: string
): Promise<{ id: string }> {
  const { data: existing, error: lookupError } = await phase1
    .from('events')
    .select('id, created_by, registration_code')
    .eq('prereg_feis_listing_id', listing.id)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up Phase 1 event: ${redactWithEnv(lookupError.message)}`)
  }

  const row: Record<string, unknown> = { ...buildEventRow(listing) }
  if (!existing?.created_by) row.created_by = organiserId
  if (!existing?.registration_code) {
    row.registration_code = await generateRegistrationCode(async (code) => {
      const { data, error } = await phase1
        .from('events')
        .select('id')
        .eq('registration_code', code)
        .limit(1)
      if (error) throw new Error(`Failed to check registration code: ${redactWithEnv(error.message)}`)
      return (data ?? []).length > 0
    })
  }

  const { data: event, error: eventError } = await phase1
    .from('events')
    .upsert(row, { onConflict: 'prereg_feis_listing_id' })
    .select('id')
    .single()

  if (eventError || !event) {
    throw new Error(`Failed to create Phase 1 event: ${redactWithEnv(eventError?.message ?? 'unknown')}`)
  }

  const { error: roleError } = await phase1
    .from('event_roles')
    .upsert(
      { user_id: organiserId, event_id: event.id, role: 'organizer', created_by: organiserId },
      { onConflict: 'user_id,event_id,role', ignoreDuplicates: true }
    )
  if (roleError) {
    throw new Error(`Failed to give the organiser a role: ${redactWithEnv(roleError.message)}`)
  }

  const { count, error: stageCountError } = await phase1
    .from('stages')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)
  if (stageCountError) {
    throw new Error(`Failed to check stages: ${redactWithEnv(stageCountError.message)}`)
  }
  if (shouldCreateStage(count ?? 0)) {
    const { error: stageError } = await phase1
      .from('stages')
      .insert(startingStages(event.id))
    if (stageError) {
      throw new Error(`Failed to create the first stage: ${redactWithEnv(stageError.message)}`)
    }
  }

  const { error: auditError } = await phase1.from('audit_log').insert({
    user_id: organiserId,
    entity_type: 'event',
    entity_id: event.id,
    action: 'launch_from_registration',
    after_data: { name: listing.name, prereg_feis_listing_id: listing.id }
  })
  if (auditError) {
    throw new Error(`Failed to write the audit entry: ${redactWithEnv(auditError.message)}`)
  }

  return { id: event.id }
}

export async function executeBridge(
  data: PreRegData,
  organiserId: string
): Promise<BridgeResult> {
  const phase1 = createFeisDayClient()

  // 1. Create the event, owned by the organiser who launched it
  const event = await createOwnedEvent(phase1, data.listing, organiserId)

  try {
    // 2. Create competitions with external IDs (upsert for idempotency)
    const competitionRows = data.competitions.map((comp) => buildCompetitionRow(event.id, comp))

    const { data: createdComps, error: compsError } = await phase1
      .from('competitions')
      .upsert(competitionRows, { onConflict: 'prereg_feis_competition_id' })
      .select('id, name, prereg_feis_competition_id')

    if (compsError || !createdComps) {
      throw new Error(`Failed to create Phase 1 competitions: ${compsError?.message ?? 'unknown'}`)
    }

    // Build mapping: pre-reg competition ID -> Phase 1 competition ID
    const compMap = new Map<string, string>()
    for (const phase1Comp of createdComps) {
      if (phase1Comp.prereg_feis_competition_id) {
        compMap.set(phase1Comp.prereg_feis_competition_id, phase1Comp.id)
      }
    }

    // 3. Create/dedup dancers with external IDs
    // Phase 1 dancers table has unique index:
    //   create unique index idx_dancers_name_school
    //     on dancers(first_name, last_name, coalesce(school_name, ''));
    // AND now has prereg_dancer_id UNIQUE column.
    // Prefer upsert on prereg_dancer_id when available.
    // Fall back to name+school matching for dancers that might already exist
    // from CSV imports (before pre-reg existed).
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
      const key = `${entry.dancer_first_name}|${entry.dancer_last_name}|${normalizedSchool}|${entry.dancer_date_of_birth ?? ''}`
      if (!uniqueDancers.has(key)) {
        uniqueDancers.set(key, buildDancerRow(entry))
      }
    }

    // Build dancer mapping: prereg dancer_id -> Phase 1 dancer_id
    const dancerMap = new Map<string, string>()

    for (const [, dancer] of uniqueDancers) {
      // First, try upsert on prereg_dancer_id (idempotent path)
      const { data: upserted, error: upsertErr } = await phase1
        .from('dancers')
        .upsert(
          dancer,
          { onConflict: 'prereg_dancer_id' }
        )
        .select('id')
        .single()

      if (upserted && !upsertErr) {
        dancerMap.set(dancer.prereg_dancer_id, upserted.id)
        continue
      }

      // Upsert failed — likely a dancer that already exists from CSV import
      // (has no prereg_dancer_id but matches on name+school).
      // Fall back to name+school lookup, then update with prereg_dancer_id.
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
        // Check DOB mismatch — could be different people with same name/school
        if (dancer.date_of_birth) {
          const { data: existingDancer } = await phase1
            .from('dancers')
            .select('date_of_birth')
            .eq('id', found.id)
            .single()

          if (existingDancer?.date_of_birth && existingDancer.date_of_birth !== dancer.date_of_birth) {
            console.warn(
              `[BRIDGE] DOB mismatch for dancer ${dancer.first_name} ${dancer.last_name} at ${dancer.school_name ?? 'no school'}: ` +
              `existing=${existingDancer.date_of_birth}, prereg=${dancer.date_of_birth}. Using existing Phase 1 record.`
            )
          }
        }

        // Stamp the prereg_dancer_id on the existing row for future idempotency
        const { error: stampErr } = await phase1
          .from('dancers')
          .update({ prereg_dancer_id: dancer.prereg_dancer_id })
          .eq('id', found.id)

        if (stampErr) {
          throw new Error(
            `Failed to stamp prereg_dancer_id on existing dancer ${found.id}: ${stampErr.message}`
          )
        }
        dancerMap.set(dancer.prereg_dancer_id, found.id)
      } else {
        // Insert new dancer (without upsert — the prereg_dancer_id conflict
        // was already handled above, so this is a true new dancer)
        const { data: inserted, error: insertErr } = await phase1
          .from('dancers')
          .insert({
            first_name: dancer.first_name,
            last_name: dancer.last_name,
            date_of_birth: dancer.date_of_birth,
            school_name: dancer.school_name,
            prereg_dancer_id: dancer.prereg_dancer_id,
          })
          .select('id')
          .single()

        if (insertErr || !inserted) {
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
        const key = `${entry.dancer_first_name}|${entry.dancer_last_name}|${normalizedSchool}|${entry.dancer_date_of_birth ?? ''}`
        const canonical = uniqueDancers.get(key)
        if (canonical && dancerMap.has(canonical.prereg_dancer_id)) {
          dancerMap.set(entry.dancer_id, dancerMap.get(canonical.prereg_dancer_id)!)
        }
      }
    }

    // Competitor numbers were assigned at registration; carry them across so the
    // desk only hands out cards. Keyed by Phase 1 dancer ID.
    const numberByDancer = new Map<string, string>()
    for (const row of data.competitorNumbers) {
      const phase1DancerId = dancerMap.get(row.dancer_id)
      if (!phase1DancerId) continue
      const number = String(row.competitor_number)
      const existing = numberByDancer.get(phase1DancerId)
      if (existing && existing !== number) {
        throw new Error(
          `Dancer ${phase1DancerId} matched two pre-reg dancers with numbers ${existing} and ${number}`
        )
      }
      numberByDancer.set(phase1DancerId, number)
    }

    // 4. Create registrations with external IDs (upsert for idempotency)
    const registrationRows = data.entries
      .map((entry) => {
        const phase1CompId = compMap.get(entry.feis_competition_id)
        const phase1DancerId = dancerMap.get(entry.dancer_id)
        if (!phase1CompId || !phase1DancerId) return null
        return buildRegistrationRow(
          event.id,
          entry,
          phase1CompId,
          phase1DancerId,
          numberByDancer.get(phase1DancerId) ?? null
        )
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (registrationRows.length > 0) {
      const { error: regsError } = await phase1
        .from('registrations')
        .upsert(registrationRows, { onConflict: 'prereg_registration_entry_id' })

      if (regsError) {
        throw new Error(`Failed to create Phase 1 registrations: ${regsError.message}`)
      }
    }

    // Pre-assign numbers on the event: a check-in row with no arrival time is
    // "number assigned, not arrived yet". Rows from an earlier run are left alone.
    const checkInRows = [...numberByDancer].map(([dancerId, number]) => ({
      event_id: event.id,
      dancer_id: dancerId,
      competitor_number: number,
      checked_in_by: 'prereg',
    }))

    if (checkInRows.length > 0) {
      const { error: checkInError } = await phase1
        .from('event_check_ins')
        .upsert(checkInRows, { onConflict: 'event_id,dancer_id', ignoreDuplicates: true })

      if (checkInError) {
        throw new Error(`Failed to assign Phase 1 competitor numbers: ${checkInError.message}`)
      }
    }

    // Mark import as complete
    const { error: readyError } = await phase1
      .from('events')
      .update({ import_status: 'ready', import_error: null })
      .eq('id', event.id)

    if (readyError) {
      throw new Error(`Failed to mark event as ready: ${readyError.message}`)
    }

    return {
      eventId: event.id,
      competitionsCreated: createdComps.length,
      dancersCreated: dancerMap.size,
      registrationsCreated: registrationRows.length,
      competitorNumbersAssigned: checkInRows.length,
    }
  } catch (err) {
    // Mark import as failed on the event (if it was created)
    const errorMessage = safeErrorMessage(err)
    const { error: markError } = await phase1
      .from('events')
      .update({ import_status: 'partial_failed', import_error: errorMessage })
      .eq('id', event.id)

    if (markError) {
      console.error(
        `[BRIDGE] DOUBLE FAULT: original error: ${errorMessage}, ` +
        `AND failed to mark event ${event.id} as partial_failed: ${markError.message}`
      )
    }
    throw new Error(errorMessage)
  }
}
