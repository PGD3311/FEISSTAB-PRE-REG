import { describe, expect, it } from 'vitest'
import {
  confirmationEmail,
  escapeHtml,
  renderDeliveryFailureAlertEmail,
  renderPaymentAlertEmail
} from '@/lib/email/templates'
import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

// The parts of a frozen purchase the confirmation reads, shaped as priceOrder freezes them
const purchase = {
  version: 1,
  dancers: [{ id: 'd1', first_name: 'Aoife <script>', last_name: "O'Brien & Co", school_name: null, tcrg_name: null,
    date_of_birth: '2018-05-01', gender: 'female', championship_status: 'none', dance_levels: {}, competition_age: 8 }],
  competitions: [{ id: 'c1', display_code: '210R', display_name: 'Novice Reel U10', age_group_key: 'U10',
    age_group_label: 'Under 10', age_min_jan1: null, age_max_jan1: 9, level_key: 'NOV', level_label: 'Novice',
    dance_key: 'reel', dance_label: 'Reel', competition_type: 'solo', championship_key: null, grades_only: false,
    fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false }],
  entries: [{ dancer_id: 'd1', competition_id: 'c1', fee_category: 'solo', base_fee_cents: 1500, late_fee_cents: 0, day_of_surcharge_cents: 0 }]
} as unknown as PurchaseSnapshot

const order = { confirmation_number: 'RF-2026-7KQ2M', total_cents: 4000 }
const listing = { name: 'Newport Feis', feis_date: '2027-03-14', venue_name: 'Hall', venue_address: null, contact_email: 'org@runfeis.test' }

describe('email templates', () => {
  it("fills main's confirmation from the frozen purchase: competitor number, code, dance and what was paid", () => {
    const email = confirmationEmail({
      order, listing, purchase, numbers: [{ dancer_id: 'd1', competitor_number: 214 }], baseUrl: 'https://runfeis.test'
    })
    expect(email.subject).toBe("You're entered: Newport Feis")
    expect(email.html).toContain('>214<')
    expect(email.html).toContain('>210R<')
    expect(email.html).toContain('>Reel<')
    expect(email.html).toContain('RF-2026-7KQ2M')
    expect(email.html).toContain('$40.00')
    expect(email.html).toContain('https://runfeis.test/dashboard')
  })

  it('shows a dash for a dancer whose number has not been assigned', () => {
    const email = confirmationEmail({ order, listing, purchase, numbers: [], baseUrl: 'https://runfeis.test' })
    expect(email.html).toContain('&ndash;')
  })

  it('escapes HTML in names in every email', () => {
    const email = confirmationEmail({
      order,
      listing: { name: 'Feis <b>One</b>', feis_date: null, venue_name: null, venue_address: null, contact_email: null },
      purchase,
      numbers: [],
      baseUrl: 'https://runfeis.test'
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('Aoife &lt;script&gt; O&#39;Brien &amp; Co')
    expect(email.html).toContain('Feis &lt;b&gt;One&lt;/b&gt;')

    const alert = renderPaymentAlertEmail({
      exception: { support_ref: 'PAY-7KQ2M', severity: 'blocking', reason: 'amount_mismatch', amount_cents: 1, currency: 'usd',
        stripe_account_id: 'acct_1', stripe_checkout_session_id: 'cs_1', stripe_payment_intent_id: 'pi_1', created_at: '2026-11-01T12:00:00Z' },
      listing: { name: '<img src=x>' },
      family: { first_name: 'A&B', last_name: null, phone: null, email: 'p@runfeis.test' },
      order: { id: 'reg-1', status: 'pending_payment' }
    })
    expect(alert.subject).toBe('[RunFeis] Payment case PAY-7KQ2M: amount_mismatch')
    expect(alert.html).not.toContain('<img src=x>')
    expect(alert.html).toContain('A&amp;B')
  })

  it('escapes HTML in the delivery failure alert too, including the provider error text', () => {
    const alert = renderDeliveryFailureAlertEmail({
      failed: { kind: 'registration_confirmation', dedupe_key: 'confirmation:<x>', status: 'failed',
        last_error: '<b>"boom"</b> & more', attempts: 6 },
      order: { id: 'reg-1', status: 'paid' },
      family: { first_name: null, last_name: null, phone: null, email: '"p"@runfeis.test' }
    })
    expect(alert.subject).toBe('[RunFeis] Email not delivered: confirmation:<x>')
    expect(alert.html).not.toContain('<b>')
    expect(alert.html).not.toContain('<x>')
    expect(alert.html).toContain('&lt;b&gt;&quot;boom&quot;&lt;/b&gt; &amp; more')
    expect(alert.html).toContain('&quot;p&quot;@runfeis.test')
  })

  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
