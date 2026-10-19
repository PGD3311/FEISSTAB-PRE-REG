import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderConfirmationEmail } from '@/lib/email/templates'

const sample = {
  feisName: 'Newport Feis 2027 (Demo)',
  feisDate: 'Saturday, March 13, 2027',
  venue: 'Rogers High School, Newport, RI',
  dancers: [
    {
      name: 'Mary Young',
      number: 214,
      competitions: [
        { code: '312R', name: 'Reel' },
        { code: '312LJ', name: 'Light Jig' },
        { code: '312HP', name: 'Hornpipe' }
      ]
    },
    { name: 'Seamus Young', number: 215, competitions: [{ code: '107R', name: 'Reel' }] }
  ],
  totalCents: 9000,
  confirmationNumber: 'NF27-0042',
  contactEmail: 'feis@example.com',
  baseUrl: 'https://project-f06v2.vercel.app'
}

describe('renderConfirmationEmail', () => {
  it('shows each dancer with their competitor number and competition codes', () => {
    const html = renderConfirmationEmail(sample)
    if (process.env.EMAIL_PREVIEW) writeFileSync(process.env.EMAIL_PREVIEW, html)
    expect(html).toContain('Mary Young')
    expect(html).toContain('>214<')
    expect(html).toContain('312LJ')
    expect(html).toContain('>215<')
    expect(html).toContain('$90.00')
    expect(html).toContain('NF27-0042')
    expect(html).toContain('https://project-f06v2.vercel.app/dashboard')
  })

  it('shows what was paid for an order that cost money', () => {
    const html = renderConfirmationEmail(sample)
    expect(html).toContain('>Paid<')
    expect(html).toContain('>$90.00<')
    expect(html).not.toContain('Nothing to pay')
  })

  it('says there was nothing to pay, not "Paid $0.00", for an order that cost nothing', () => {
    const html = renderConfirmationEmail({ ...sample, totalCents: 0, addedToEntry: true })
    expect(html).toContain('>Total<')
    expect(html).toContain('>Nothing to pay<')
    expect(html).not.toContain('>Paid<')
    expect(html).not.toContain('$0.00')
    // The confirmation number still shows
    expect(html).toContain('NF27-0042')
  })

  it('sends drop and swap to the organiser, and add to My entries', () => {
    const html = renderConfirmationEmail(sample)
    expect(html).toContain('To drop or swap a dance, contact the organiser at')
    expect(html).toContain('mailto:feis@example.com')
    expect(html).toContain('While entries are open, you can add dances yourself from My entries.')
    expect(html).toContain("Entry fees aren't refundable.")
    expect(html).not.toContain('add or drop')
  })

  it('keeps the add and drop wording when the organiser has no contact email', () => {
    const html = renderConfirmationEmail({ ...sample, contactEmail: null })
    expect(html).toContain('To drop or swap a dance, contact the organiser. While entries are open')
    expect(html).not.toContain('mailto:')
  })

  it('shows a dash when a number has not been assigned', () => {
    const html = renderConfirmationEmail({
      ...sample,
      dancers: [{ name: 'Aoife Young', number: null, competitions: [] }]
    })
    expect(html).toContain('&ndash;')
  })

  it('escapes names so they cannot inject HTML', () => {
    const html = renderConfirmationEmail({
      ...sample,
      dancers: [{ name: '<script>x</script>', number: 1, competitions: [] }]
    })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
