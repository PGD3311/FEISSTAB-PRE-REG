import Link from 'next/link'
import { RunFeisLogo } from '@/components/runfeis-logo'
import { NumberCard } from '@/components/registration/number-card'

interface AuthLayoutProps {
  /** The large line on the green cover */
  headline: string
  title: string
  intro?: React.ReactNode
  /** The link at the top right, e.g. to the other auth page */
  switchLink: { href: string; label: string; prompt: string }
  children: React.ReactNode
}

/** A sample number card with its sticker, showing what a family gets once entries are paid. */
function SampleCard() {
  return (
    <figure className="max-w-[300px]">
      <div className="relative">
        <div className="feis-sticker absolute top-[150px] left-[34px] w-[250px] rotate-[2deg] rounded-[3px] px-4 pt-12 pb-3 text-[var(--color-feis-charcoal)] shadow-[0_8px_18px_-10px_rgba(0,0,0,0.6)]">
          <div className="flex gap-3">
            {['312R', '312LJ', '312SJ', '312HP'].map((code) => (
              <span key={code} className="feis-narrow text-lg">
                {code}
              </span>
            ))}
          </div>
        </div>
        <div className="relative w-[190px] -rotate-[4deg] text-[var(--color-feis-charcoal)] shadow-[0_10px_24px_-12px_rgba(0,0,0,0.7)]">
          <NumberCard
            feisName="Newport Feis 2027"
            number={214}
            name="Mary Young"
            details={['Novice, age 11', 'Murphy Academy']}
            showPendingNote={false}
          />
        </div>
      </div>
      <figcaption className="mt-28 max-w-[30ch] text-sm text-white/75">
        Competitor numbers and dances are ready as soon as you&apos;ve paid. No queue at the desk.
      </figcaption>
    </figure>
  )
}

/** Sign-in and sign-up: the green programme cover on one side, the form on the other. */
export function AuthLayout({ headline, title, intro, switchLink, children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen bg-[var(--color-feis-cream)] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="feis-cover flex flex-col gap-6 lg:justify-between lg:gap-8 border-b-[6px] px-5 pt-5 pb-7 sm:px-8 lg:border-r-[6px] lg:border-b-0 lg:border-double lg:border-r-[var(--color-feis-gold)] lg:px-12 lg:py-10">
        <Link href="/" aria-label="RunFeis home" className="w-fit">
          <RunFeisLogo variant="onGreen" size="sm" />
        </Link>
        <div className="grid gap-14">
          <p className="feis-cover-title max-w-[14ch] text-[clamp(32px,4.4vw,56px)]">{headline}</p>
          <div className="hidden lg:block">
            <SampleCard />
          </div>
        </div>
        <Link
          href="/"
          className="hidden w-fit text-sm text-white/75 hover:text-white hover:underline lg:block"
        >
          See upcoming feiseanna
        </Link>
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-8 lg:px-16 lg:py-10">
        <p className="text-right text-sm text-muted-foreground">
          {switchLink.prompt}{' '}
          <Link href={switchLink.href} className="feis-link">
            {switchLink.label}
          </Link>
        </p>
        <div className="flex flex-1 pt-6 pb-8 lg:items-center lg:py-0">
          <div className="w-full max-w-[400px]">
            <h1 className="feis-display text-[40px]">{title}</h1>
            {intro && <p className="mt-2 text-[15px] text-muted-foreground">{intro}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}

/** Shared field styling for the auth forms: taller inputs, 16px so phones don't zoom. */
export const AUTH_INPUT = 'feis-input py-3 text-base'
export const AUTH_BUTTON = 'feis-btn feis-btn-primary w-full py-3.5 text-base'
