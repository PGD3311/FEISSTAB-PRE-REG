'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type {
  FeisListing,
  Dancer,
  FeisCompetition,
  FeeBreakdown
} from '@/lib/types/feis-listing'

interface Step3ReviewProps {
  feis: FeisListing
  dancers: Dancer[]
  cart: Record<string, string[]>
  competitions: FeisCompetition[]
  feeBreakdown: FeeBreakdown
  registrationId: string | null
  holdExpiresAt: string | null
  onCreateDraft: () => Promise<void>
  onPay: () => Promise<void>
  onCancel: () => void
  onBack: () => void
  loading: boolean
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function CountdownTimer({ holdExpiresAt }: { holdExpiresAt: string }) {
  const [remaining, setRemaining] = useState<number>(() => {
    return Math.max(0, new Date(holdExpiresAt).getTime() - Date.now())
  })

  useEffect(() => {
    if (remaining <= 0) return

    const interval = setInterval(() => {
      const ms = Math.max(0, new Date(holdExpiresAt).getTime() - Date.now())
      setRemaining(ms)
      if (ms <= 0) clearInterval(interval)
    }, 1000)

    return () => clearInterval(interval)
  }, [holdExpiresAt, remaining])

  if (remaining <= 0) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Your hold has expired. Please go back and start over.
      </div>
    )
  }

  const totalSeconds = Math.floor(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const isUrgent = remaining < 5 * 60 * 1000

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm ${
        isUrgent
          ? 'border-orange-200 bg-orange-50 text-orange-800'
          : 'border-border bg-muted/30 text-muted-foreground'
      }`}
    >
      Hold expires in{' '}
      <span className="font-mono font-semibold">
        {minutes}:{seconds.toString().padStart(2, '0')}
      </span>
      {' '}— complete payment before time runs out.
    </div>
  )
}

export function Step3Review({
  feis,
  dancers,
  cart,
  competitions,
  feeBreakdown,
  registrationId,
  holdExpiresAt,
  onCreateDraft,
  onPay,
  onCancel,
  onBack,
  loading
}: Step3ReviewProps) {
  const [consentAccepted, setConsentAccepted] = useState(false)

  const dancerMap = new Map(dancers.map(d => [d.id, d]))
  const competitionMap = new Map(competitions.map(c => [c.id, c]))

  const totalEntries = Object.values(cart).reduce((sum, ids) => sum + ids.length, 0)

  const dancersWithEntries = Object.entries(cart)
    .filter(([, compIds]) => compIds.length > 0)
    .map(([dancerId, compIds]) => ({
      dancer: dancerMap.get(dancerId),
      competitions: compIds
        .map(id => competitionMap.get(id))
        .filter((c): c is FeisCompetition => c !== undefined)
    }))
    .filter(entry => entry.dancer !== undefined)

  async function handlePay() {
    if (!registrationId) {
      await onCreateDraft()
    } else {
      await onPay()
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Review &amp; Pay</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Review your selections before proceeding to payment.
      </p>

      {/* Hold countdown */}
      {holdExpiresAt && (
        <div className="mb-6">
          <CountdownTimer holdExpiresAt={holdExpiresAt} />
        </div>
      )}

      {/* Feis info */}
      <div className="mb-6 rounded-md border border-border bg-white px-4 py-4">
        <div className="text-sm font-semibold">{feis.name}</div>
        {feis.feis_date && (
          <div className="mt-0.5 text-sm text-muted-foreground">
            {new Date(feis.feis_date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </div>
        )}
        {feis.venue_name && (
          <div className="mt-0.5 text-sm text-muted-foreground">{feis.venue_name}</div>
        )}
      </div>

      {/* Per-dancer competition list */}
      <div className="mb-6 space-y-4">
        {dancersWithEntries.map(({ dancer, competitions: comps }) => {
          if (!dancer) return null
          return (
            <div key={dancer.id} className="rounded-md border border-border bg-white">
              <div className="border-b border-border px-4 py-3">
                <span className="text-sm font-semibold">
                  {dancer.first_name} {dancer.last_name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {comps.length} {comps.length === 1 ? 'competition' : 'competitions'}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {comps.map(comp => {
                  const feeCents =
                    comp.fee_category === 'prelim_champ'
                      ? feeBreakdown.line_items.find(li => li.dancer_id === dancer.id)?.base_fee_cents ?? 0
                      : comp.fee_category === 'open_champ'
                        ? feeBreakdown.line_items.find(li => li.dancer_id === dancer.id)?.base_fee_cents ?? 0
                        : feeBreakdown.line_items.find(li => li.dancer_id === dancer.id)?.base_fee_cents ?? 0

                  // Find the line item for this specific entry
                  const lineItem = feeBreakdown.line_items.find(
                    li => li.dancer_id === dancer.id
                  )

                  return (
                    <li key={comp.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span>{comp.display_name}</span>
                      <span className="font-mono text-muted-foreground">
                        {formatCents(
                          comp.fee_category === 'prelim_champ'
                            ? lineItem?.base_fee_cents ?? feeCents
                            : lineItem?.base_fee_cents ?? feeCents
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      {/* Fee breakdown */}
      <div className="mb-6 rounded-md border border-border bg-[var(--color-feis-green-light)] p-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {totalEntries} {totalEntries === 1 ? 'competition entry' : 'competition entries'}
            </span>
            <span>{formatCents(feeBreakdown.subtotal_before_cap_cents - feeBreakdown.event_fee_cents)}</span>
          </div>
          {feeBreakdown.event_fee_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Event fee (per family)</span>
              <span>{formatCents(feeBreakdown.event_fee_cents)}</span>
            </div>
          )}
          {feeBreakdown.family_cap_applied && (
            <div className="flex justify-between text-[var(--color-feis-green)]">
              <span>Family cap discount</span>
              <span>-{formatCents(feeBreakdown.subtotal_before_cap_cents - feeBreakdown.grand_total_cents)}</span>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-semibold">Total due</span>
          <span className="font-mono text-xl font-bold">{formatCents(feeBreakdown.grand_total_cents)}</span>
        </div>
        {feeBreakdown.family_cap_applied && (
          <div className="mt-1.5 text-xs text-[var(--color-feis-green)]">
            Family cap applied — you saved{' '}
            {formatCents(feeBreakdown.subtotal_before_cap_cents - feeBreakdown.grand_total_cents)}
          </div>
        )}
      </div>

      {/* Consent checkbox */}
      <div className="mb-6 rounded-md border border-border bg-white p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={e => setConsentAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
          />
          <span className="text-sm text-muted-foreground">
            I agree to FeisTab&apos;s{' '}
            <Link href="/terms" className="font-medium text-primary hover:underline" target="_blank">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="font-medium text-primary hover:underline" target="_blank">
              Privacy Policy
            </Link>
            {feis.terms_url && (
              <>
                {' '}and the organiser&apos;s{' '}
                <a
                  href={feis.terms_url}
                  className="font-medium text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Event Terms
                </a>
              </>
            )}
            . I confirm that I am the parent or guardian of the dancers being registered.
          </span>
        </label>
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-3">
        <button
          onClick={handlePay}
          disabled={!consentAccepted || loading || totalEntries === 0}
          className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)] disabled:opacity-50"
        >
          {loading ? 'Processing…' : `Pay ${formatCents(feeBreakdown.grand_total_cents)}`}
        </button>

        <div className="flex justify-between">
          <button
            onClick={onBack}
            disabled={loading}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-sm font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        You will be redirected to Stripe&apos;s secure checkout to complete payment.
      </p>
    </div>
  )
}
