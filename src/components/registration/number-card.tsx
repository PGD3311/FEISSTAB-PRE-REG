interface NumberCardProps {
  feisName: string
  number: number | null
  name: string
  details: string[]
  showPendingNote: boolean
}

/** A dancer drawn as their competitor number card. The number stays an outline until it's assigned. */
export function NumberCard({ feisName, number, name, details, showPendingNote }: NumberCardProps) {
  return (
    <div className="feis-number-card grid content-start self-start gap-0.5 text-center max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-x-4 max-sm:text-left">
      <div className="truncate text-[11px] font-bold text-muted-foreground max-sm:hidden">
        {feisName}
      </div>
      {number === null ? (
        <div
          className="feis-card-number feis-card-number-pending my-1 text-[72px] max-sm:row-span-4 max-sm:my-0 max-sm:text-[56px]"
          aria-hidden="true"
        >
          000
        </div>
      ) : (
        <div
          className="feis-card-number my-1 text-[72px] max-sm:row-span-4 max-sm:my-0 max-sm:text-[56px]"
          aria-label={`Competitor number ${number}`}
        >
          {number}
        </div>
      )}
      <div className="text-[17px] leading-tight font-extrabold [font-stretch:80%]">{name}</div>
      {details.map((line) => (
        <div key={line} className="text-[12.5px] text-muted-foreground">
          {line}
        </div>
      ))}
      {number === null && showPendingNote && (
        <div className="mt-1.5 text-[11.5px] text-muted-foreground">Number given when you pay</div>
      )}
    </div>
  )
}
