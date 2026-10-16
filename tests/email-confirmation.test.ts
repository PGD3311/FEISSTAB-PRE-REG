import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderConfirmationEmail } from '@/lib/email/send-confirmation'

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
