import { entryDeadline } from '@/lib/entry-display'
import type { FeisListing, ListingStatus } from '@/lib/types/feis-listing'

const TAGS: Record<ListingStatus | 'deadline_passed', { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'bg-[var(--color-feis-cream-dark)] text-muted-foreground'
  },
  open: {
    label: 'Open for entries',
    className: 'bg-[var(--color-feis-green-light)] text-[var(--color-feis-green)]'
  },
  deadline_passed: {
    label: 'Deadline passed',
    className: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]'
  },
  closed: {
    label: 'Entries closed',
    className: 'bg-[var(--color-feis-cream-dark)] text-foreground'
  },
  launched: {
    label: 'Feis day launched',
    className: 'bg-[var(--color-feis-green)] text-white'
  }
}

type TagListing = Pick<FeisListing, 'status'> &
  Partial<Pick<FeisListing, 'reg_closes_at' | 'late_reg_closes_at'>>

/**
 * A feis's status as a small square tag. An open feis whose entry deadline has passed
 * shows "Deadline passed", so the organiser knows to close entries.
 */
export function ListingStatusTag({ listing }: { listing: TagListing }) {
  const pastDeadline =
    listing.status === 'open' &&
    entryDeadline({
      reg_closes_at: listing.reg_closes_at ?? null,
      late_reg_closes_at: listing.late_reg_closes_at ?? null
    }).closed
  const tag = TAGS[pastDeadline ? 'deadline_passed' : listing.status]
  return (
    <span className={`inline-block rounded-[2px] px-1.5 py-0.5 text-xs font-bold ${tag.className}`}>
      {tag.label}
    </span>
  )
}
