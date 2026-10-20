import { describe, expect, it } from 'vitest'
import { REGIONS, isRegion } from '@/lib/regions'
import {
  ORGANISER_DETAILS_BLOCK,
  adminAlertRecipients,
  adminDecisionError,
  checklistLinkFor,
  isAwaitingApproval,
  parseOrganiserProfile,
  sentBackMessage
} from '@/lib/approval-gate'

describe('regions', () => {
  it('lists the IDTANA regions with Mid-Atlantic and New England first, then Other', () => {
    expect(REGIONS).toEqual([
      'Mid-Atlantic',
      'New England',
      'Southern',
      'Mid-America',
      'Western',
      'Eastern Canada',
      'Western Canada',
      'Other (non-IDTANA)'
    ])
  })

  it('knows a listed region and refuses anything else', () => {
    expect(isRegion('New England')).toBe(true)
    expect(isRegion('Other (non-IDTANA)')).toBe(true)
    expect(isRegion('new england')).toBe(false)
    expect(isRegion('')).toBe(false)
    expect(isRegion(null)).toBe(false)
  })
})

describe('isAwaitingApproval', () => {
  it('is true only while the feis waits for RunFeis', () => {
    expect(isAwaitingApproval('pending_review')).toBe(true)
    expect(isAwaitingApproval('draft')).toBe(false)
    expect(isAwaitingApproval('open')).toBe(false)
    expect(isAwaitingApproval('closed')).toBe(false)
    expect(isAwaitingApproval('launched')).toBe(false)
  })
})

describe('sentBackMessage', () => {
  it("shows RunFeis's note on a draft that was sent back", () => {
    expect(sentBackMessage({ status: 'draft', review_note: 'Add your permit number.' })).toBe(
      "Sent back by RunFeis: Add your permit number. Fix what's needed and submit again."
    )
  })

  it('adds a full stop when the note has none', () => {
    expect(sentBackMessage({ status: 'draft', review_note: '  Wrong venue  ' })).toBe(
      "Sent back by RunFeis: Wrong venue. Fix what's needed and submit again."
    )
  })

  it('shows nothing without a note, or once the feis is no longer a draft', () => {
    expect(sentBackMessage({ status: 'draft', review_note: null })).toBeNull()
    expect(sentBackMessage({ status: 'draft', review_note: '   ' })).toBeNull()
    expect(sentBackMessage({ status: 'pending_review', review_note: 'old' })).toBeNull()
    expect(sentBackMessage({ status: 'open', review_note: 'old' })).toBeNull()
  })
})

describe('checklistLinkFor', () => {
  it('links the missing organiser details to the details page, coming back to the setup', () => {
    expect(ORGANISER_DETAILS_BLOCK).toBe('Your organiser details are required')
    expect(checklistLinkFor(ORGANISER_DETAILS_BLOCK, 'abc')).toEqual({
      href: '/organiser/profile?next=%2Forganiser%2Ffeiseanna%2Fabc%2Fsetup',
      label: 'Add your details'
    })
  })

  it('gives no link for other checks', () => {
    expect(checklistLinkFor('Feis name is required', 'abc')).toBeNull()
  })
})

describe('parseOrganiserProfile', () => {
  const form = (values: Record<string, string>) => ({
    get: (key: string) => values[key] ?? null
  })

  it('trims the details and keeps a blank phone as none', () => {
    expect(
      parseOrganiserProfile(
        form({
          full_name: ' Steve Walsh ',
          organisation: ' Newport Feis Committee ',
          region: 'New England',
          phone: '  '
        })
      )
    ).toEqual({
      values: {
        full_name: 'Steve Walsh',
        organisation: 'Newport Feis Committee',
        region: 'New England',
        phone: null
      }
    })
  })

  it('keeps a phone number', () => {
    const result = parseOrganiserProfile(
      form({ full_name: 'A', organisation: 'B', region: 'Southern', phone: ' 555 0100 ' })
    )
    expect(result).toEqual({
      values: { full_name: 'A', organisation: 'B', region: 'Southern', phone: '555 0100' }
    })
  })

  it('refuses missing name, school or committee, or region', () => {
    expect(parseOrganiserProfile(form({ organisation: 'B', region: 'Southern' }))).toEqual({
      error: 'Please fill in your name, school or committee, and region.'
    })
    expect(
      parseOrganiserProfile(form({ full_name: 'A', organisation: ' ', region: 'Southern' }))
    ).toEqual({ error: 'Please fill in your name, school or committee, and region.' })
    expect(parseOrganiserProfile(form({ full_name: 'A', organisation: 'B' }))).toEqual({
      error: 'Please fill in your name, school or committee, and region.'
    })
  })

  it('refuses a region that is not on the list', () => {
    expect(
      parseOrganiserProfile(form({ full_name: 'A', organisation: 'B', region: 'Atlantis' }))
    ).toEqual({ error: 'Choose your region from the list.' })
  })
})

describe('adminAlertRecipients', () => {
  it('uses ADMIN_ALERT_EMAIL when it is set', () => {
    expect(
      adminAlertRecipients({
        ADMIN_ALERT_EMAIL: 'a@runfeis.test, b@runfeis.test',
        PAYMENTS_ALERT_EMAIL: 'p@runfeis.test'
      })
    ).toEqual(['a@runfeis.test', 'b@runfeis.test'])
  })

  it('falls back to PAYMENTS_ALERT_EMAIL when ADMIN_ALERT_EMAIL is missing or blank', () => {
    expect(adminAlertRecipients({ PAYMENTS_ALERT_EMAIL: 'p@runfeis.test' })).toEqual([
      'p@runfeis.test'
    ])
    expect(
      adminAlertRecipients({ ADMIN_ALERT_EMAIL: ' , ', PAYMENTS_ALERT_EMAIL: 'p@runfeis.test' })
    ).toEqual(['p@runfeis.test'])
  })

  it('is empty when neither is set', () => {
    expect(adminAlertRecipients({})).toEqual([])
  })
})

describe('adminDecisionError', () => {
  it('explains each refusal from approve_listing and send_back_listing', () => {
    expect(adminDecisionError('42501', 'approve')).toBe('Only RunFeis admins can do this.')
    expect(adminDecisionError('55000', 'approve')).toBe(
      'This feis is no longer waiting for approval. Refresh the page to see where it is.'
    )
    expect(adminDecisionError('P0002', 'send_back')).toBe('That feis no longer exists.')
    expect(adminDecisionError('22023', 'send_back')).toBe(
      'Write a note saying what the organiser needs to fix.'
    )
  })

  it('falls back to a plain message for anything else', () => {
    expect(adminDecisionError(undefined, 'approve')).toBe(
      'The feis could not be approved. Please try again.'
    )
    expect(adminDecisionError('XX000', 'send_back')).toBe(
      'The feis could not be sent back. Please try again.'
    )
  })
})
