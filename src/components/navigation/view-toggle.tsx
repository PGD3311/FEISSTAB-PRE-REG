'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface ViewToggleProps {
  hasHousehold: boolean
  hasListings: boolean
}

/** Switch between the parent and organiser sides, for people who are both. */
export function ViewToggle({ hasHousehold, hasListings }: ViewToggleProps) {
  const pathname = usePathname()
  const isParent = pathname.startsWith('/dashboard') || pathname.startsWith('/feiseanna')
  const isOrganiser = pathname.startsWith('/organiser')

  // Only show if user has both capabilities
  if (!hasHousehold || !hasListings) return null

  const base = 'rounded-[2px] px-3 py-1 text-sm font-bold'
  return (
    <div className="flex items-center gap-0.5 rounded-[3px] border border-white/30 p-0.5">
      <Link
        href="/dashboard"
        aria-current={isParent ? 'page' : undefined}
        className={`${base} ${isParent ? 'bg-[#E9C77F] text-[var(--color-feis-charcoal)]' : 'text-white/75 hover:text-white'}`}
      >
        Parent
      </Link>
      <Link
        href="/organiser/feiseanna"
        aria-current={isOrganiser ? 'page' : undefined}
        className={`${base} ${isOrganiser ? 'bg-[#E9C77F] text-[var(--color-feis-charcoal)]' : 'text-white/75 hover:text-white'}`}
      >
        Organiser
      </Link>
    </div>
  )
}
