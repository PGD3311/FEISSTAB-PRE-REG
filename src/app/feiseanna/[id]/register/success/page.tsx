import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { RegistrationStatus } from '@/lib/types/feis-listing'
import { CoverBand } from '@/components/feis-cover'

export const dynamic = 'force-dynamic'

interface SuccessPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ session_id?: string }>
}

export default async function SuccessPage({ params, searchParams }: SuccessPageProps) {
  const { id: feisId } = await params
  const { session_id: sessionId } = await searchParams

  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(
      `/auth/login?redirect=/feiseanna/${feisId}/register/success${sessionId ? `?session_id=${sessionId}` : ''}`
    )
  }

  // Look up registration by checkout session ID or by household + feis
  let registrationId: string | null = null
  let status: RegistrationStatus | null = null
  let confirmationNumber: string | null = null

  if (sessionId) {
    const { data: reg, error } = await supabase
      .from('registrations')
      .select('id, status, confirmation_number')
      .eq('stripe_checkout_session_id', sessionId)
      .single()

    if (!error && reg) {
      registrationId = reg.id
      status = reg.status as RegistrationStatus
      confirmationNumber = reg.confirmation_number
    }
  }

  // Fallback: look up by household + feis listing
  if (!registrationId) {
    const { data: household } = await supabase
      .from('households')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (household) {
      const { data: reg, error } = await supabase
        .from('registrations')
        .select('id, status, confirmation_number')
        .eq('feis_listing_id', feisId)
        .eq('household_id', household.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!error && reg) {
        registrationId = reg.id
        status = reg.status as RegistrationStatus
        confirmationNumber = reg.confirmation_number
      }
    }
  }

  if (!registrationId || !status) {
    redirect(`/feiseanna/${feisId}`)
  }

  const entryHref = `/feiseanna/${feisId}/register`
  const title: Record<RegistrationStatus, string> = {
    paid: 'You’re entered',
    pending_payment: 'Taking your payment',
    draft: 'Not paid yet',
    expired: 'Your hold ran out',
    cancelled: 'Entries cancelled'
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand
        links={[
          { href: '/dashboard', label: 'My entries' },
          { href: '/', label: 'Feiseanna' }
        ]}
      >
        <div className="min-w-0 pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">{title[status]}</h1>
          {status === 'paid' && (
            <p className="mt-1.5 max-w-[52ch] opacity-85">
              Payment received. Your dancers&apos; competitor numbers are ready.
            </p>
          )}
        </div>
      </CoverBand>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        {status === 'paid' && (
          <>
            <div className="feis-receipt px-[18px] pt-5 pb-[18px]">
              <h2 className="text-[22px] leading-tight font-extrabold [font-stretch:75%]">
                Receipt
              </h2>
              <p className="mb-3 text-[13px] text-muted-foreground">Keep this for your records.</p>
              <div className="flex items-baseline justify-between border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
                <span className="font-bold">Status</span>
                <span className="rounded-[2px] bg-[var(--color-feis-green-light)] px-1.5 py-0.5 text-xs font-bold text-[var(--color-feis-green-700)]">
                  Paid in full
                </span>
              </div>
              {confirmationNumber && (
                <div className="mt-2 flex items-baseline gap-1.5 text-sm">
                  <span>Confirmation number</span>
                  <span className="feis-leader" />
                  <span className="feis-narrow text-[22px] leading-none select-all">
                    {confirmationNumber}
                  </span>
                </div>
              )}
              <p className="mt-4 text-[13px] text-muted-foreground">
                A confirmation email has been sent to your account.
              </p>
            </div>

            <div className="mt-8">
              <p className="text-[15px]">
                Each dancer&apos;s competitor number is on the entry page for this feis. Bring them
                on the day.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={entryHref} className="feis-btn feis-btn-primary">
                  See competitor numbers
                </Link>
                <Link href="/dashboard" className="feis-btn feis-btn-outline">
                  All my entries
                </Link>
              </div>
            </div>
          </>
        )}

        {status === 'pending_payment' && (
          <div role="status" className="feis-card p-6">
            <meta httpEquiv="refresh" content="3" />
            <p className="text-[15px] font-bold">Your payment is going through.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This page checks again every few seconds. Please don&apos;t pay a second time.
            </p>
          </div>
        )}

        {status === 'draft' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">These entries haven&apos;t been paid for</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Go back to the entry page to check the dances and pay.
            </p>
            <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
              Back to the entry page
            </Link>
          </div>
        )}

        {status === 'expired' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">
              Your places were held for a limited time, and that time ran out
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Choose your dances again to enter.</p>
            <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
              Enter again
            </Link>
          </div>
        )}

        {status === 'cancelled' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">These entries were cancelled</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You can enter again while the feis is taking entries.
            </p>
            <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
              Enter again
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}
