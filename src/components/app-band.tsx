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

function NavLinks({ links, className }: { links: BandLink[]; className: string }) {
  const pathname = usePathname()
  return (
    <nav className={className}>
      {links.map((link) => {
        const active =
          pathname === link.href ||
          (link.matchChildren === true && pathname.startsWith(`${link.href}/`))
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 decoration-2 underline-offset-[6px] ${
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
  )
}

/**
 * The slim green band with a gold double rule at the top of every signed-in page.
 * Phones get the links on their own row under the logo; wider screens keep one row.
 */
export function AppBand({ links, children }: AppBandProps) {
  return (
    <header className="feis-cover">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-7">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Link href="/" aria-label="RunFeis home" className="shrink-0">
              <RunFeisLogo variant="onGreen" size="sm" />
            </Link>
            <NavLinks links={links} className="hidden items-center gap-4 text-sm md:flex" />
          </div>
          {children && <div className="flex shrink-0 items-center gap-4 text-sm">{children}</div>}
        </div>
        <NavLinks
          links={links}
          className="-mx-4 mt-2 flex gap-5 overflow-x-auto px-4 pb-1 text-sm md:hidden"
        />
      </div>
    </header>
  )
}
