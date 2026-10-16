import Link from 'next/link'
import { RunFeisLogo } from '@/components/runfeis-logo'

interface AuthLayoutProps {
  title: string
  intro?: React.ReactNode
  /** The line under the card, linking to the other auth page */
  switchLink: { href: string; label: string; prompt: string }
  children: React.ReactNode
}

/**
 * Sign-in and sign-up: the slim green band, then one centred column with the form on a
 * card punched like a competitor number card.
 */
export function AuthLayout({ title, intro, switchLink, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <header className="feis-cover">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-7">
          <Link href="/" aria-label="RunFeis home">
            <RunFeisLogo variant="onGreen" size="sm" />
          </Link>
          <Link href="/" className="text-sm text-white/75 hover:text-white hover:underline">
            Feiseanna
          </Link>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 pt-12 pb-16 sm:pt-16">
        <div className="w-full max-w-[440px]">
          <h1 className="feis-display text-[40px]">{title}</h1>
          {intro && <p className="mt-2 text-[15px] text-muted-foreground">{intro}</p>}
          <div className="feis-number-card mt-6 p-6 pt-9 sm:p-8 sm:pt-10">{children}</div>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {switchLink.prompt}{' '}
            <Link href={switchLink.href} className="feis-link">
              {switchLink.label}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

/** Shared field styling for the auth forms: taller inputs, 16px so phones don't zoom. */
export const AUTH_INPUT = 'feis-input py-3 text-base'
export const AUTH_BUTTON = 'feis-btn feis-btn-primary w-full py-3.5 text-base'
