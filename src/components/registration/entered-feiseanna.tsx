import Link from 'next/link'
import { formatDate } from '@/lib/format'
import { NumberCard } from '@/components/registration/number-card'

export interface DancerFeisEntry {
  dancerId: string
  feisId: string
  feisName: string
  feisDate: string | null
  number: number | null
  competitions: { id: string; code: string | null; name: string }[]
}

/** Small "Feis name 214" tags for a dancer's row in the dancers list. */
export function NumberTags({ entries }: { entries: DancerFeisEntry[] }) {
  if (entries.length === 0) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {entries.map((e) => (
        <li
          key={e.feisId}
          className="inline-flex items-baseline gap-2 rounded-[2px] border border-[var(--color-feis-charcoal)] bg-white px-2 py-0.5 text-[13px]"
        >
          <span>{e.feisName}</span>
          <span className="feis-narrow text-[17px] leading-none">{e.number ?? '–'}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A dancer's competitor numbers, one number card per feis they're entered in, with their dances
 * on the sticker beside it.
 */
export function EnteredFeiseanna({
  dancerName,
  entries
}: {
  dancerName: string
  entries: DancerFeisEntry[]
}) {
  if (entries.length === 0) return null

  return (
    <section className="mb-8 max-w-3xl">
      <h2 className="feis-display mb-3 text-[22px]">Competitor numbers</h2>
      <div className="grid gap-5">
        {entries.map((e) => (
          <div key={e.feisId} className="grid grid-cols-1 sm:grid-cols-[190px_minmax(0,1fr)]">
            <NumberCard
              feisName={e.feisName}
              number={e.number}
              name={dancerName}
              details={[formatDate(e.feisDate, { fallback: 'Date to be announced' })]}
              showPendingNote={false}
            />
            <div className="feis-sticker mx-2.5 grid content-start gap-2.5 self-start rounded-b border-t-0 px-4 py-3.5 sm:mx-0 sm:my-3.5 sm:rounded-r sm:rounded-bl-none sm:border-t sm:border-l-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2.5">
                <b className="text-base [font-stretch:80%]">{e.feisName}</b>
                <Link
                  href={`/feiseanna/${e.feisId}/register`}
                  className="text-sm font-bold text-primary underline underline-offset-[3px]"
                >
                  See entry
                </Link>
              </div>
              {e.competitions.length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {e.competitions.map((c) => (
                    <li key={c.id}>
                      <span className="feis-narrow block text-xl leading-tight">
                        {c.code ?? c.name}
                      </span>
                      {c.code && (
                        <span className="block text-[11.5px] text-muted-foreground">{c.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
