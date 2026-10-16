import Link from 'next/link'
import { CoverBand } from '@/components/feis-cover'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand links={[{ href: '/', label: 'Feiseanna' }]}>
        <div className="pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">Page not found</h1>
        </div>
      </CoverBand>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-7">
        <div className="feis-sticker max-w-xl rounded px-5 py-5">
          <p className="font-bold">There&apos;s nothing at this address</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The link may be old, or the feis may no longer be listed.
          </p>
          <Link href="/" className="feis-btn feis-btn-ink mt-4">
            See upcoming feiseanna
          </Link>
        </div>
      </main>
    </div>
  )
}
