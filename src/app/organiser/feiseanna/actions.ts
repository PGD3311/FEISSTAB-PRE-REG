'use server'

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { expandSyllabus } from '@/lib/engine/syllabus-expander'
import type { TemplateData, SyllabusSelection } from '@/lib/types/feis-listing'

export async function createDraftListing(formData: FormData) {
  const supabase = await createClient()

  const name = formData.get('name') as string | null
  const feis_date = formData.get('feis_date') as string | null
  const end_date = (formData.get('end_date') as string | null) || null
  const venue_name = formData.get('venue_name') as string | null
  const venue_address =
    (formData.get('venue_address') as string | null) || null
  const contact_email = formData.get('contact_email') as string | null
  const contact_phone =
    (formData.get('contact_phone') as string | null) || null
  const description =
    (formData.get('description') as string | null) || null
  const timezone = formData.get('timezone') as string | null

  if (!name || !feis_date || !venue_name || !contact_email || !timezone) {
    return { error: 'Missing required fields' }
  }

  const feisYear = new Date(feis_date + 'T00:00:00').getFullYear()
  const age_cutoff_date = `${feisYear}-01-01`
  const season_year = feisYear

  const { data, error } = await supabase
    .from('feis_listings')
    .insert({
      name,
      feis_date,
      end_date,
      venue_name,
      venue_address,
      contact_email,
      contact_phone,
      description,
      timezone,
      age_cutoff_date,
      season_year,
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to create listing:', error)
    return { error: 'Failed to create listing' }
  }

  return { id: data.id }
}

export async function updateListingDetails(
  listingId: string,
  formData: FormData
) {
  const supabase = await createClient()

  const name = formData.get('name') as string | null
  const feis_date = formData.get('feis_date') as string | null
  const end_date = (formData.get('end_date') as string | null) || null
  const venue_name = formData.get('venue_name') as string | null
  const venue_address =
    (formData.get('venue_address') as string | null) || null
  const contact_email = formData.get('contact_email') as string | null
  const contact_phone =
    (formData.get('contact_phone') as string | null) || null
  const description =
    (formData.get('description') as string | null) || null
  const timezone = formData.get('timezone') as string | null

  if (!name || !feis_date || !venue_name || !contact_email || !timezone) {
    return { error: 'Missing required fields' }
  }

  const feisYear = new Date(feis_date + 'T00:00:00').getFullYear()
  const age_cutoff_date = `${feisYear}-01-01`
  const season_year = feisYear

  const { error } = await supabase
    .from('feis_listings')
    .update({
      name,
      feis_date,
      end_date,
      venue_name,
      venue_address,
      contact_email,
      contact_phone,
      description,
      timezone,
      age_cutoff_date,
      season_year,
    })
    .eq('id', listingId)

  if (error) {
    console.error('Failed to update listing:', error)
    return { error: 'Failed to update listing' }
  }

  return { success: true as const }
}

export async function cloneFeis(sourceId: string) {
  const supabase = await createClient()

  // Fetch the source listing
  const { data: source, error: sourceError } = await supabase
    .from('feis_listings')
    .select('*')
    .eq('id', sourceId)
    .single()

  if (sourceError || !source) {
    console.error('Failed to fetch source listing:', sourceError)
    return { error: 'Failed to fetch source listing' }
  }

  // Year-bump the name: replace any 4-digit year with next year
  const nextYear = new Date().getFullYear() + 1
  const clonedName = source.name
    ? source.name.replace(/\b\d{4}\b/, String(nextYear))
    : source.name

  // Create the cloned listing — clear dates, set as draft
  const { data: cloned, error: cloneError } = await supabase
    .from('feis_listings')
    .insert({
      name: clonedName,
      feis_date: null,
      end_date: null,
      venue_name: source.venue_name,
      venue_address: source.venue_address,
      contact_email: source.contact_email,
      contact_phone: source.contact_phone,
      description: source.description,
      timezone: source.timezone,
      age_cutoff_date: null,
      season_year: null,
      sanctioning_body: source.sanctioning_body,
      syllabus_template_id: source.syllabus_template_id,
      syllabus_snapshot: source.syllabus_snapshot,
      dancer_cap: source.dancer_cap,
      privacy_policy_url: source.privacy_policy_url,
      terms_url: source.terms_url,
      show_contact_publicly: source.show_contact_publicly,
      reg_opens_at: null,
      reg_closes_at: null,
      late_reg_closes_at: null,
      cloned_from: sourceId,
      status: 'draft',
    })
    .select('id')
    .single()

  if (cloneError || !cloned) {
    console.error('Failed to clone listing:', cloneError)
    return { error: 'Failed to clone listing' }
  }

  // Clone fee schedule
  const { data: feeSchedule, error: feeError } = await supabase
    .from('fee_schedules')
    .select('*')
    .eq('feis_listing_id', sourceId)
    .single()

  if (feeSchedule && !feeError) {
    const { error: feeInsertError } = await supabase
      .from('fee_schedules')
      .insert({
        feis_listing_id: cloned.id,
        event_fee_cents: feeSchedule.event_fee_cents,
        solo_fee_cents: feeSchedule.solo_fee_cents,
        prelim_champ_fee_cents: feeSchedule.prelim_champ_fee_cents,
        open_champ_fee_cents: feeSchedule.open_champ_fee_cents,
        family_cap_cents: feeSchedule.family_cap_cents,
        late_fee_cents: feeSchedule.late_fee_cents,
        day_of_surcharge_cents: feeSchedule.day_of_surcharge_cents,
      })

    if (feeInsertError) {
      console.error('Failed to clone fee schedule:', feeInsertError)
    }
  }

  // Clone feis competitions
  const { data: competitions, error: compError } = await supabase
    .from('feis_competitions')
    .select('*')
    .eq('feis_listing_id', sourceId)

  if (competitions && competitions.length > 0 && !compError) {
    const clonedCompetitions = competitions.map(
      ({
        id: _id,
        feis_listing_id: _flis,
        created_at: _ca,
        ...rest
      }) => ({
        ...rest,
        feis_listing_id: cloned.id,
      })
    )

    const { error: compInsertError } = await supabase
      .from('feis_competitions')
      .insert(clonedCompetitions)

    if (compInsertError) {
      console.error('Failed to clone competitions:', compInsertError)
    }
  }

  return { id: cloned.id }
}

export async function cloneFeisAndRedirect(sourceId: string) {
  const result = await cloneFeis(sourceId)
  if ('error' in result) {
    return result
  }
  redirect(`/organiser/feiseanna/${result.id}/setup`)
}

export async function createEmptyDraftAndRedirect(): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('feis_listings')
    .insert({ status: 'draft' })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to create empty draft:', error)
    // redirect to the new page with an error flag rather than returning
    redirect('/organiser/feiseanna/new?error=create_failed')
  }

  redirect(`/organiser/feiseanna/${data.id}/setup`)
}

export async function expandAndSaveSyllabus(
  listingId: string,
  templateId: string,
  templateData: TemplateData,
  selection: SyllabusSelection,
  syllabusSnapshot: TemplateData
) {
  const supabase = await createClient()

  // 1. Update listing with template reference and frozen snapshot
  const { error: listingError } = await supabase
    .from('feis_listings')
    .update({
      syllabus_template_id: templateId,
      syllabus_snapshot: syllabusSnapshot,
    })
    .eq('id', listingId)

  if (listingError) return { error: listingError.message }

  // 2. Delete existing competitions for this listing (delete-and-reinsert pattern)
  const { error: deleteError } = await supabase
    .from('feis_competitions')
    .delete()
    .eq('feis_listing_id', listingId)

  if (deleteError) return { error: deleteError.message }

  // 3. Expand and insert new competitions
  const expanded = expandSyllabus(templateData, selection)
  if (expanded.length === 0) return { success: true as const, count: 0 }

  const rows = expanded.map((comp) => ({
    feis_listing_id: listingId,
    ...comp,
  }))

  const { error: insertError } = await supabase
    .from('feis_competitions')
    .insert(rows)

  if (insertError) return { error: insertError.message }
  return { success: true as const, count: expanded.length }
}
