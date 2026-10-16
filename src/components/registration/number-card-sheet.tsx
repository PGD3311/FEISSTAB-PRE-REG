import { formatDate } from '@/lib/format'

interface NumberCardSheetProps {
  feisName: string
  feisDate: string | null
  number: number | null
  dancerName: string
  schoolName: string | null
  competitions: { id: string; code: string | null; name: string }[]
}

/**
 * One printed sheet: the competitor number card, and under it the competition sticker to cut
 * out and stick on the back of the card.
 */
export function NumberCardSheet({
  feisName,
  feisDate,
  number,
  dancerName,
  schoolName,
  competitions
}: NumberCardSheetProps) {
  return (
    <article className="feis-print-sheet mx-auto grid w-full max-w-[640px] gap-6 print:max-w-none">
      <div className="feis-number-card px-8 pt-10 pb-8 text-center">
        <p className="text-sm font-bold">{feisName}</p>
        <p className="text-[13px] text-muted-foreground">
          {formatDate(feisDate, { weekday: 'long', fallback: '' })}
        </p>
        <p className="feis-card-number my-4 text-[clamp(120px,30vw,220px)]">{number ?? '–'}</p>
        <p className="text-[28px] leading-tight font-extrabold [font-stretch:80%]">{dancerName}</p>
        {schoolName && <p className="mt-1 text-base text-muted-foreground">{schoolName}</p>}
      </div>

      <div className="border-2 border-dashed border-[var(--color-feis-charcoal)] p-1">
        <div className="feis-sticker px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-bold">{dancerName}</p>
            <p className="feis-narrow text-2xl">{number ?? '–'}</p>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {competitions.map((c) => (
              <li key={c.id}>
                <span className="feis-narrow block text-[22px] leading-tight">
                  {c.code ?? c.name}
                </span>
                {c.code && <span className="block text-xs">{c.name}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Cut along the dashed line and stick on the back of the card.
      </p>
    </article>
  )
}
