import type { Metadata } from 'next'
import { LegalPage, RUNFEIS_CONTACT_EMAIL } from '@/components/legal/legal-page'

export const metadata: Metadata = { title: 'Terms · RunFeis' }

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="October 16, 2026">
      <section>
        <h2>Who does what</h2>
        <p>
          RunFeis is the website families use to enter feiseanna. Each feis is run by its own
          organiser, who sets the syllabus, the fees, the deadlines and the rules on the day. When
          you enter a feis, you’re entering the organiser’s event, and their rules apply.
        </p>
      </section>

      <section>
        <h2>Entering your dancers</h2>
        <ul>
          <li>
            You must be the parent or guardian of the dancers you enter, or have their permission.
          </li>
          <li>
            Keep each dancer’s date of birth and levels correct. RunFeis uses them to show which
            competitions a dancer can enter, but you’re responsible for entering the right ones
            under the feis rules.
          </li>
          <li>
            Places are held for 30 minutes while you pay. If payment isn’t finished in that time,
            the entries are released.
          </li>
        </ul>
      </section>

      <section>
        <h2>Fees and refunds</h2>
        <ul>
          <li>Fees are set by the organiser and shown before you pay.</li>
          <li>
            Payments are made by card through Stripe and go to the organiser. RunFeis may add a
            small service fee, shown before you pay.
          </li>
          <li>
            Entry fees aren’t refundable unless the organiser decides otherwise. For changes or
            refunds, contact the organiser of that feis.
          </li>
        </ul>
      </section>

      <section>
        <h2>Your account</h2>
        <p>
          Keep your password to yourself. You’re responsible for entries made from your account. We
          may close accounts that are used to abuse the service.
        </p>
      </section>

      <section>
        <h2>Questions</h2>
        <p>
          For anything about a specific feis, contact its organiser; their contact details are on
          the feis page. For anything about RunFeis itself, email{' '}
          <span className="font-semibold select-all">{RUNFEIS_CONTACT_EMAIL}</span>.
        </p>
      </section>
    </LegalPage>
  )
}
