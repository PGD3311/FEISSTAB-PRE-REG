import Link from 'next/link'
import { formatCents, formatDate } from '@/lib/format'
import { entryDeadline, formatDeadline } from '@/lib/entry-display'
import type { FeisListing } from '@/lib/types/feis-listing'
import { RunFeisLogo } from '@/components/runfeis-logo'

export interface CoverLink {
  href: string
  label: string
}

/** The dark green band with a gold double rule, like the cover of a feis programme. */
export function CoverBand({ links, children }: { links: CoverLink[]; children: React.ReactNode }) {
  return (
    <header className="feis-cover">
      <div className="mx-auto grid max-w-6xl gap-x-6 gap-y-2 px-4 pt-4 pb-6 sm:px-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <nav className="flex items-center justify-between gap-4 text-sm md:col-span-2">
          <Link href="/" aria-label="RunFeis home">
            <RunFeisLogo variant="onGreen" size="sm" />
          </Link>
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="opacity-80 underline-offset-2 hover:underline hover:opacity-100"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
        {children}
      </div>
    </header>
  )
}

interface FeisCoverProps {
  listing: Pick<
    FeisListing,
    'name' | 'feis_date' | 'venue_name' | 'timezone' | 'reg_closes_at' | 'late_reg_closes_at'
  >
  lateFeeCents: number | null
  links: CoverLink[]
}

/** One feis's cover: its name, date and venue, and when entries close. */
export function FeisCover({ listing, lateFeeCents, links }: FeisCoverProps) {
  const deadline = entryDeadline(listing)
  const timeZone = listing.timezone ?? 'America/New_York'

  return (
    <CoverBand links={links}>
      <div className="min-w-0 pt-3">
        <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">{listing.name}</h1>
        <p className="mt-1.5 opacity-85">
          {formatDate(listing.feis_date, {
            weekday: 'long',
            fallback: 'Date to be announced'
          })}
          {listing.venue_name ? `, ${listing.venue_name}` : ''}
        </p>
      </div>
      {deadline.closesAt && (
        <div className="text-sm md:text-right">
          {deadline.closed ? 'Entries' : 'Entries close'}
          <strong className="block text-[22px] leading-tight font-extrabold text-[#E9C77F] [font-stretch:75%]">
            {deadline.closed ? 'Closed' : formatDeadline(deadline.closesAt, timeZone)}
          </strong>
          {lateFeeCents !== null && !deadline.closed && (
            <span className="text-[13px] opacity-85">
              Late fee of {formatCents(lateFeeCents)} per dancer now applies
            </span>
          )}
        </div>
      )}
    </CoverBand>
  )
}
