import { isRegion, type Region } from '@/lib/regions'
import type { FeisListing, ListingStatus } from '@/lib/types/feis-listing'

/** The publish check that needs the organiser's details (getListingTransitionBlockReasons) */
export const ORGANISER_DETAILS_BLOCK = 'Your organiser details are required'

/**
 * While a feis waits for RunFeis, the database refuses every change by its organiser except
 * withdrawing it (migration 021), so the pages offer none.
 */
export function isAwaitingApproval(status: ListingStatus): boolean {
  return status === 'pending_review'
}

/** The banner on a draft RunFeis sent back, or null when there is nothing to say */
export function sentBackMessage(
  listing: Pick<FeisListing, 'status' | 'review_note'>
): string | null {
  if (listing.status !== 'draft') return null
  const note = (listing.review_note ?? '').trim()
  if (note === '') return null
  const sentence = /[.!?]$/.test(note) ? note : `${note}.`
  return `Sent back by RunFeis: ${sentence} Fix what's needed and submit again.`
}

/** A link beside a failed check on the review step, for the checks fixed on another page */
export function checklistLinkFor(
  block: string,
  listingId: string
): { href: string; label: string } | null {
  if (block !== ORGANISER_DETAILS_BLOCK) return null
  const next = encodeURIComponent(`/organiser/feiseanna/${listingId}/setup`)
  return { href: `/organiser/profile?next=${next}`, label: 'Add your details' }
}

export interface OrganiserProfileValues {
  full_name: string
  organisation: string
  region: Region
  phone: string | null
}

/** Reads the organiser details form. `form` is the FormData the page posts. */
export function parseOrganiserProfile(form: {
  get(name: string): FormDataEntryValue | null
}): { values: OrganiserProfileValues } | { error: string } {
  const read = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }
  const full_name = read('full_name')
  const organisation = read('organisation')
  const region = read('region')
  const phone = read('phone')

  if (!full_name || !organisation || !region) {
    return { error: 'Please fill in your name, school or committee, and region.' }
  }
  if (!isRegion(region)) return { error: 'Choose your region from the list.' }
  return { values: { full_name, organisation, region, phone: phone === '' ? null : phone } }
}

function addresses(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
}

/** Who hears that a feis is waiting: ADMIN_ALERT_EMAIL, or else the payments contacts */
export function adminAlertRecipients(env: Record<string, string | undefined>): string[] {
  const admins = addresses(env.ADMIN_ALERT_EMAIL)
  return admins.length > 0 ? admins : addresses(env.PAYMENTS_ALERT_EMAIL)
}

/** What the admin sees when approve_listing or send_back_listing refuses (SQLSTATEs from 021) */
export function adminDecisionError(
  code: string | undefined,
  action: 'approve' | 'send_back'
): string {
  switch (code) {
    case '42501':
      return 'Only RunFeis admins can do this.'
    case '55000':
      return 'This feis is no longer waiting for approval. Refresh the page to see where it is.'
    case 'P0002':
      return 'That feis no longer exists.'
    case '22023':
      return 'Write a note saying what the organiser needs to fix.'
    default:
      return action === 'approve'
        ? 'The feis could not be approved. Please try again.'
        : 'The feis could not be sent back. Please try again.'
  }
}
