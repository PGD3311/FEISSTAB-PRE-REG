import { CoverBand } from '@/components/feis-cover'

export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <CoverBand links={[{ href: '/', label: 'All feiseanna' }]}>
        <div className="pt-3">
          <div className="h-12 w-2/3 max-w-md rounded-sm bg-white/15" />
          <div className="mt-3 h-4 w-1/2 max-w-xs rounded-sm bg-white/10" />
        </div>
      </CoverBand>
      <p className="mx-auto max-w-6xl px-4 py-7 text-muted-foreground sm:px-7">Loading the feis…</p>
    </div>
  )
}
