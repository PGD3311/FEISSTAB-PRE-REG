'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface ViewToggleProps {
  hasHousehold: boolean
  hasListings: boolean
}

export function ViewToggle({ hasHousehold, hasListings }: ViewToggleProps) {
  const pathname = usePathname()
  const isParent = pathname.startsWith('/dashboard') || pathname.startsWith('/feiseanna')
  const isOrganiser = pathname.startsWith('/organiser')

  // Only show if user has both capabilities
  if (!hasHousehold || !hasListings) return null

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted p-1 text-sm">
      <Link
        href="/dashboard"
        className={`rounded px-3 py-1.5 font-medium transition-colors ${
          isParent ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Parent
      </Link>
      <Link
        href="/organiser/feiseanna"
        className={`rounded px-3 py-1.5 font-medium transition-colors ${
          isOrganiser ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Organiser
      </Link>
    </div>
  )
}
