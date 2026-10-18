'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CONSENT_VERSION } from '@/lib/engine/purchase-snapshot'
import { formatCents } from '@/lib/format'

export interface ReceiptLine {
  label: string
  cents: number
  quiet?: boolean
}

interface FamilyReceiptProps {
  familyName: string
  /** Heading, "Family total" unless the family is adding to a paid entry */
  title?: string
  /** A line under the family name, e.g. what was already paid */
  note?: string
  lines: ReceiptLine[]
  totalCents: number
  termsUrl: string | null
  holdExpiresAt: string | null
  paymentStarted: boolean
  loading: boolean
  error: string | null
  /** Pay, with whether the agreement is ticked; Submit records that agreement on a new order */
  onPay: (consentAccepted: boolean) => void
  onChangeEntries: () => void
}

function Line({ label, cents, quiet }: ReceiptLine) {
  return (
    <div
      className={`flex items-baseline gap-1.5 py-0.5 ${quiet ? 'text-[13px] text-muted-foreground' : 'text-sm'}`}
    >
      <span>{label}</span>
      <span className="feis-leader" />
      <span className="tabular-nums">{formatCents(cents)}</span>
    </div>
  )
}

function HoldCountdown({ holdExpiresAt }: { holdExpiresAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(holdExpiresAt).getTime() - Date.now())
  )

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Math.max(0, new Date(holdExpiresAt).getTime() - Date.now())
      setRemaining(ms)
      if (ms <= 0) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [holdExpiresAt])

  if (remaining <= 0) {
    return (
      <p className="text-[13px] text-destructive">
        The hold on these entries has run out. Choose Change entries to start again.
      </p>
    )
  }

  const seconds = Math.floor(remaining / 1000)
  return (
    <p
      className={`text-[13px] ${remaining < 5 * 60 * 1000 ? 'text-[var(--color-feis-orange-ink)]' : 'text-muted-foreground'}`}
    >
      Your places are held for{' '}
      <span className="font-semibold tabular-nums">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
      . Pay before then to keep them.
    </p>
  )
}

/** The family's running total, drawn as a printed receipt, with the agreement and Pay. */
export function FamilyReceipt({
  familyName,
  title = 'Family total',
  note,
  lines,
  totalCents,
  termsUrl,
  holdExpiresAt,
  paymentStarted,
  loading,
  error,
  onPay,
  onChangeEntries
}: FamilyReceiptProps) {
  const [agreed, setAgreed] = useState(false)
  const held = holdExpiresAt !== null
  const nothingChosen = lines.length === 0

  return (
    <aside id="family-total" className="feis-receipt scroll-mt-6 px-[18px] pt-5 pb-[18px]">
      <h2 className="text-[22px] leading-tight font-extrabold [font-stretch:75%]">{title}</h2>
      <p className="mb-3 text-[13px] text-muted-foreground">{familyName}</p>
      {note && <p className="mb-3 text-[13px]">{note}</p>}

      {nothingChosen ? (
        <p className="text-sm text-muted-foreground">
          Choose dances for at least one dancer and the total will build up here.
        </p>
      ) : (
        lines.map((line) => <Line key={line.label} {...line} />)
      )}

      <div className="mt-2.5 flex items-baseline justify-between border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
        <span className="font-bold">To pay</span>
        <strong className="text-[40px] leading-none font-black tabular-nums [font-stretch:65%]">
          {formatCents(totalCents)}
        </strong>
      </div>

      {!held && (
        <label
          // This wording is CONSENT_VERSION: change the two in the same commit
          data-consent-version={CONSENT_VERSION}
          className="mt-3.5 mb-3 flex items-start gap-2 text-[12.5px] text-muted-foreground"
        >
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            I&apos;m the parent or guardian of these dancers, or I&apos;m entering them with their
            parent or guardian&apos;s permission. I accept the RunFeis{' '}
            <Link href="/terms" target="_blank" className="font-semibold text-primary underline">
              terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="font-semibold text-primary underline">
              privacy policy
            </Link>
            {termsUrl && (
              <>
                {' '}
                and the{' '}
                <a
                  href={termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary underline"
                >
                  feis terms
                </a>
              </>
            )}
            . Entry fees aren&apos;t refundable.
          </span>
        </label>
      )}

      {held && paymentStarted && (
        <p className="mt-3.5 text-[13px] text-muted-foreground">
          You started paying for these entries. Return to the payment page to finish, or choose
          Change entries to start again.
        </p>
      )}

      {held && <HoldCountdown holdExpiresAt={holdExpiresAt} />}

      <button
        type="button"
        onClick={() => onPay(agreed)}
        // An order in progress already records the agreement, from when it was submitted
        disabled={loading || nothingChosen || (!held && !agreed)}
        className="mt-3 w-full rounded-[3px] bg-primary py-3 text-[17px] font-extrabold text-primary-foreground [font-stretch:85%] hover:bg-[var(--color-feis-green-600)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)] disabled:opacity-50"
      >
        {loading
          ? 'Opening payment…'
          : paymentStarted
            ? 'Return to payment'
            : `Pay ${formatCents(totalCents)}`}
      </button>

      {error && (
        <p className="mt-2.5 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {held && (
        <button
          type="button"
          onClick={onChangeEntries}
          disabled={loading}
          className="mt-3 text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          Change entries
        </button>
      )}

      {!held && !nothingChosen && (
        <p className="mt-2.5 text-[12.5px] text-muted-foreground">
          Payment is by card on a secure Stripe page. Competitor numbers are given out as soon as it
          goes through.
        </p>
      )}
    </aside>
  )
}

interface PaidReceiptProps {
  familyName: string
  totalCents: number
  confirmationNumber: string | null
  contactEmail: string | null
  cardsHref: string
  /** Entries are still open, so the family can add dances or dancers */
  canAdd: boolean
}

/** Shown once the family has paid: what they paid and how to change anything. */
export function PaidReceipt({
  familyName,
  totalCents,
  confirmationNumber,
  contactEmail,
  cardsHref,
  canAdd
}: PaidReceiptProps) {
  return (
    <aside id="family-total" className="feis-receipt px-[18px] pt-5 pb-[18px]">
      <h2 className="text-[22px] leading-tight font-extrabold [font-stretch:75%]">Paid</h2>
      <p className="mb-3 text-[13px] text-muted-foreground">{familyName}</p>
      <div className="flex items-baseline justify-between border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
        <span className="font-bold">Paid in full</span>
        <strong className="text-[40px] leading-none font-black tabular-nums [font-stretch:65%]">
          {formatCents(totalCents)}
        </strong>
      </div>
      {confirmationNumber && (
        <p className="mt-3 text-sm">
          Confirmation <span className="feis-narrow text-lg">{confirmationNumber}</span>
        </p>
      )}
      <Link href={cardsHref} className="feis-btn feis-btn-primary mt-4 w-full py-3">
        Print number cards
      </Link>
      <p className="mt-3 text-[13px] text-muted-foreground">
        {canAdd && (
          <>
            Forgot a dance or a dancer? Choose <span className="font-semibold">Add dances</span>{' '}
            next to a dancer, or <span className="font-semibold">Add another dancer</span>, and pay
            only for what you add.{' '}
          </>
        )}
        To {canAdd ? 'drop' : 'add or drop'} a dance, contact the feis organiser
        {contactEmail ? (
          <>
            {' '}
            at <span className="font-semibold text-foreground select-all">{contactEmail}</span>
          </>
        ) : null}
        .
      </p>
    </aside>
  )
}
