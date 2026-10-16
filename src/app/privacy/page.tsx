import type { Metadata } from 'next'
import { LegalPage, RUNFEIS_CONTACT_EMAIL } from '@/components/legal/legal-page'

export const metadata: Metadata = { title: 'Privacy policy · RunFeis' }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="October 16, 2026">
      <section>
        <h2>What RunFeis does</h2>
        <p>
          RunFeis lets families enter their dancers in Irish dance feiseanna and lets organisers run
          them. To do that we keep some information about you and your dancers. This page says what,
          why, and who else sees it.
        </p>
      </section>

      <section>
        <h2>What we keep</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your email address. Your password is stored by our
            sign-in provider and we never see it.
          </li>
          <li>
            <strong>Family details:</strong> the parent or guardian’s name, phone number and
            address.
          </li>
          <li>
            <strong>Each dancer:</strong> name, date of birth, gender, dance school, teacher, and
            level in each dance. Date of birth and levels decide which competitions a dancer can
            enter.
          </li>
          <li>
            <strong>Entries:</strong> which competitions each dancer is entered in, what was paid,
            confirmation numbers and competitor numbers.
          </li>
        </ul>
        <p className="mt-2">
          A parent or guardian gives us their children’s details. We don’t collect information from
          children directly.
        </p>
      </section>

      <section>
        <h2>Who sees it</h2>
        <ul>
          <li>
            <strong>The organiser of each feis you enter</strong> sees your family details, the
            dancers you entered and their competitions, so they can run the day. They don’t see
            dancers you didn’t enter in their feis.
          </li>
          <li>
            <strong>Stripe</strong> handles card payments. Your card number goes to Stripe, not to
            RunFeis or the organiser.
          </li>
          <li>
            <strong>Our service providers</strong> store and send it for us: Supabase (database and
            sign-in), Vercel (hosting) and Resend (email).
          </li>
        </ul>
        <p className="mt-2">We don’t sell your information or use it for advertising.</p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          We keep your account and dancers until you ask us to delete them. Feis results and entry
          records may be kept by the organiser for their own records.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can change your family details and dancers at any time in your account. To see
          everything we hold about you, correct it, or delete your account, email{' '}
          <span className="font-semibold select-all">{RUNFEIS_CONTACT_EMAIL}</span>.
        </p>
      </section>
    </LegalPage>
  )
}
