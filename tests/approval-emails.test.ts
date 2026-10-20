import { describe, expect, it } from 'vitest'
import {
  listingApprovedEmail,
  listingSentBackEmail,
  listingSubmittedEmail
} from '@/lib/email/templates'

const baseUrl = 'https://runfeis.test'

describe('approval emails', () => {
  it('tells the admins a feis is waiting, with a link to the approvals page', () => {
    const email = listingSubmittedEmail({
      listing: { id: 'l1', name: 'Newport Feis <2027>', feis_date: '2027-03-14' },
      organiser: { full_name: 'Steve', organisation: 'Newport Committee', email: 's@runfeis.test' },
      baseUrl
    })
    expect(email.subject).toBe('New feis waiting for approval: Newport Feis <2027>')
    expect(email.html).toContain('https://runfeis.test/admin/approvals')
    expect(email.html).toContain('Newport Feis &lt;2027&gt;')
    expect(email.html).not.toContain('<2027>')
    expect(email.html).toContain('Newport Committee')
    expect(email.html).toContain('s@runfeis.test')
  })

  it('names an untitled feis', () => {
    const email = listingSubmittedEmail({
      listing: { id: 'l1', name: null, feis_date: null },
      organiser: null,
      baseUrl
    })
    expect(email.subject).toBe('New feis waiting for approval: Untitled feis')
  })

  it('tells the organiser their feis is approved and entries are open', () => {
    const email = listingApprovedEmail({
      listing: { id: 'l1', name: 'Newport Feis', feis_date: '2027-03-14' },
      baseUrl
    })
    expect(email.subject).toBe('Newport Feis approved: entries open')
    expect(email.html).toContain('https://runfeis.test/organiser/feiseanna/l1')
    expect(email.html).toContain('RunFeis')
  })

  it("tells the organiser their feis was sent back, with RunFeis's note escaped", () => {
    const email = listingSentBackEmail({
      listing: { id: 'l1', name: 'Newport Feis', feis_date: '2027-03-14' },
      note: 'Add the permit <number> & resubmit',
      baseUrl
    })
    expect(email.subject).toBe('Newport Feis sent back: Add the permit <number> & resubmit')
    expect(email.html).toContain('Add the permit &lt;number&gt; &amp; resubmit')
    expect(email.html).toContain('https://runfeis.test/organiser/feiseanna/l1/setup')
  })

  it('keeps a long note out of the subject line', () => {
    const note = 'x'.repeat(200)
    const email = listingSentBackEmail({
      listing: { id: 'l1', name: 'Newport Feis', feis_date: null },
      note,
      baseUrl
    })
    expect(email.subject.length).toBeLessThanOrEqual(120)
    expect(email.subject.endsWith('…')).toBe(true)
    expect(email.html).toContain(note)
  })
})
