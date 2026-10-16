'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { RunFeisLogo } from '@/components/runfeis-logo'

export interface BandLink {
  href: string
  label: string
  /** Also active on every path under this one; off for links like /dashboard that prefix others */
  matchChildren?: boolean
}

interface AppBandProps {
  links: BandLink[]
  children?: React.ReactNode
}

/** The slim green band with a gold double rule at the top of every signed-in page. */
export function AppBand({ links, children }: AppBandProps) {
  const pathname = usePathname()

  return (
    <header className="feis-cover">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/" aria-label="RunFeis home">
            <RunFeisLogo variant="onGreen" size="sm" />
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {links.map((link) => {
              const active =
                pathname === link.href ||
                (link.matchChildren === true && pathname.startsWith(`${link.href}/`))
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`underline-offset-[6px] decoration-2 ${
                    active
                      ? 'font-bold text-white underline decoration-[#E9C77F]'
                      : 'text-white/75 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>
        {children && <div className="flex items-center gap-4 text-sm">{children}</div>}
      </div>
    </header>
  )
}
