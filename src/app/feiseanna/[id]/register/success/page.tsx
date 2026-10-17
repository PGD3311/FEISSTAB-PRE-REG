import { redirect } from 'next/navigation'
import Link from 'next/link'
import { emailIsConfigured } from '@/lib/email/email-config'
import {
  messageAWasResolved,
  openReviewsByOrder,
  REVIEWED_MESSAGE,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import type { RegistrationStatus } from '@/lib/types/feis-listing'
import { checkoutDeps } from '@/app/_payments/checkout-deps'
import { syncConfirmation, type PayResult } from '@/app/_payments/checkout-workflow'
import { CoverBand } from '@/components/feis-cover'

export const dynamic = 'force-dynamic'

interface SuccessPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ session_id?: string }>
}

type ServerClient = Awaited<ReturnType<typeof createClient>>
type OrderSummary = { id: string; status: RegistrationStatus; confirmation_number: string | null }

/** What the page tells the family, most important first */
type View =
  | { kind: 'paid'; confirmationNumber: string | null }
  | { kind: 'case'; code: PaymentReview['message_code']; message: string }
  | { kind: 'checking'; message: string; refresh: boolean }
  | { kind: 'reviewed' | 'paying' | 'unpaid' | 'expired' | 'cancelled' | 'unavailable' }

const TITLES: Record<Exclude<View['kind'], 'case'>, string> = {
  paid: 'You’re entered',
  checking: 'Checking your payment',
  reviewed: 'Payment reviewed',
  paying: 'Taking your payment',
  unpaid: 'Not paid yet',
  expired: 'Your hold ran out',
  cancelled: 'Entries cancelled',
  unavailable: 'Something went wrong'
}

function titleOf(view: View): string {
  if (view.kind !== 'case') return TITLES[view.kind]
  return view.code === 'A' ? 'We’re checking your registration' : 'Payment didn’t go through'
}

/**
 * The order this page is about: the one this checkout belongs to, otherwise the family's latest
 * for this feis. The session id from the URL only picks which of the family's own orders to show
 * (their own client can't read anyone else's); the sync never uses it.
 */
async function findOrder(
  supabase: ServerClient,
  householdId: string,
  feisId: string,
  sessionId: string | null
): Promise<OrderSummary | null | 'error'> {
  const orders = () =>
    supabase
      .from('registrations')
      .select('id, status, confirmation_number')
      .eq('household_id', householdId)
      .eq('feis_listing_id', feisId)

  if (sessionId) {
    const { data, error } = await orders()
      .eq('stripe_checkout_session_id', sessionId)
      .maybeSingle()
    if (error) return 'error'
    if (data) return data as OrderSummary
  }
  const { data, error } = await orders()
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 'error'
  return (data as OrderSummary | null) ?? null
}

async function viewFor(
  supabase: ServerClient,
  userId: string,
  feisId: string,
  sessionId: string | null
): Promise<View> {
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (householdError) {
    console.error('Success page: household failed to load:', householdError)
    return { kind: 'unavailable' }
  }
  if (!household) redirect(`/feiseanna/${feisId}`)

  const order = await findOrder(supabase, household.id, feisId, sessionId)
  if (order === 'error') {
    console.error('Success page: the order failed to load')
    return { kind: 'unavailable' }
  }
  if (!order) redirect(`/feiseanna/${feisId}`)
  if (order.status === 'paid') {
    return { kind: 'paid', confirmationNumber: order.confirmation_number }
  }

  // Don't wait for the webhook: if Stripe says this order's checkout is complete, confirm it now
  // (spec §9). The sync finds the order's own session by its claim; it never reads the URL.
  let synced: PayResult | null = null
  if (order.status !== 'cancelled') {
    try {
      synced = await syncConfirmation(checkoutDeps(), {
        registrationId: order.id,
        householdId: household.id
      })
    } catch (err) {
      console.error('Success page sync failed:', err)
    }
  }
  if (synced?.kind === 'paid') {
    return { kind: 'paid', confirmationNumber: synced.confirmationNumber }
  }

  // A case on this order outranks its status: it tells the family not to pay again, or to retry
  const { data: reviewRows, error: reviewsError } = await supabase.rpc('get_my_payment_reviews', {
    p_registration_id: order.id
  })
  if (reviewsError) {
    console.error('Success page: payment reviews failed to load:', reviewsError)
    return { kind: 'unavailable' }
  }
  const reviews = (reviewRows ?? []) as PaymentReview[]
  const review = openReviewsByOrder(reviews).get(order.id)
  if (review) {
    return {
      kind: 'case',
      code: review.message_code,
      message: reviewMessage(review.message_code, review.support_ref)
    }
  }
  // The payments contacts have closed this order's message-A case (refunded it, for example), so
  // "don't pay again" and "we'll email you" no longer hold. The sync above still returns that same
  // case as message A, so this comes before the sync's answer
  if (messageAWasResolved(reviews, order.id)) return { kind: 'reviewed' }

  // Stripe has the payment, but confirmation isn't finished ('checking'), or it's a case only the
  // payments contacts see: message C. Only an unfinished confirmation is worth checking again.
  if (synced?.kind === 'checking' || synced?.kind === 'review') {
    return { kind: 'checking', message: synced.message, refresh: synced.kind === 'checking' }
  }

  switch (order.status) {
    case 'pending_payment':
      return { kind: 'paying' }
    case 'draft':
      return { kind: 'unpaid' }
    case 'expired':
      return { kind: 'expired' }
    case 'cancelled':
      return { kind: 'cancelled' }
  }
}

export default async function SuccessPage({ params, searchParams }: SuccessPageProps) {
  const { id: feisId } = await params
  const { session_id: sessionId } = await searchParams

  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
    const back = `/feiseanna/${feisId}/register/success${query}`
    redirect(`/auth/login?redirect=${encodeURIComponent(back)}`)
  }

  const view = await viewFor(supabase, user.id, feisId, sessionId ?? null)
  const entryHref = `/feiseanna/${feisId}/register`
  // Confirmation emails wait unsent until email is set up, so only promise one when it is
  const emailOn = emailIsConfigured(process.env)

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand
        links={[
          { href: '/dashboard', label: 'My entries' },
          { href: '/', label: 'Feiseanna' }
        ]}
      >
        <div className="min-w-0 pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">{titleOf(view)}</h1>
          {view.kind === 'paid' && (
            <p className="mt-1.5 max-w-[52ch] opacity-85">
              Payment received. Your dancers&apos; competitor numbers are ready.
            </p>
          )}
        </div>
      </CoverBand>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        {view.kind === 'paid' && (
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
              {view.confirmationNumber && (
                <div className="mt-2 flex items-baseline gap-1.5 text-sm">
                  <span>Confirmation number</span>
                  <span className="feis-leader" />
                  <span className="feis-narrow text-[22px] leading-none select-all">
                    {view.confirmationNumber}
                  </span>
                </div>
              )}
              {emailOn && (
                <p className="mt-4 text-[13px] text-muted-foreground">
                  We&apos;ll also email this confirmation to the address you sign in with.
                </p>
              )}
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

        {view.kind === 'case' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p role="status" className="text-[15px]">
              {view.message}
            </p>
            {view.code === 'A' ? (
              <Link href="/dashboard" className="feis-btn feis-btn-outline mt-4">
                All my entries
              </Link>
            ) : (
              <Link href={entryHref} className="feis-btn feis-btn-ink mt-4">
                Try again
              </Link>
            )}
          </div>
        )}

        {view.kind === 'reviewed' && (
          <div className="feis-sticker rounded px-5 py-5">
            <p role="status" className="text-[15px]">
              {REVIEWED_MESSAGE}
            </p>
            <Link href="/dashboard" className="feis-btn feis-btn-outline mt-4">
              All my entries
            </Link>
          </div>
        )}

        {view.kind === 'checking' && (
          <div role="status" className="feis-card p-6">
            {view.refresh && <meta httpEquiv="refresh" content="5" />}
            <p className="text-[15px] font-bold">{view.message}</p>
          </div>
        )}

        {view.kind === 'paying' && (
          <div role="status" className="feis-card p-6">
            <meta httpEquiv="refresh" content="5" />
            <p className="text-[15px] font-bold">Your payment is going through.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This page checks again every few seconds. Please don&apos;t pay a second time.
            </p>
          </div>
        )}

        {view.kind === 'unpaid' && (
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

        {view.kind === 'expired' && (
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

        {view.kind === 'cancelled' && (
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

        {view.kind === 'unavailable' && (
          <div role="alert" className="feis-sticker rounded px-5 py-5">
            <p className="font-bold">We couldn&apos;t load your entries just now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Refresh this page in a moment. If you&apos;ve just paid, please don&apos;t pay a
              second time.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
