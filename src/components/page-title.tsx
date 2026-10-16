interface PageTitleProps {
  title: string
  intro?: React.ReactNode
  action?: React.ReactNode
}

/** A page's heading in the narrow display type, with an optional line of help and an action. */
export function PageTitle({ title, intro, action }: PageTitleProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="feis-display text-[clamp(28px,4.5vw,38px)]">{title}</h1>
        {intro && <p className="mt-1 max-w-[62ch] text-[15px] text-muted-foreground">{intro}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
