import { CoverBand } from '@/components/feis-cover'

/** Where people write about their data or their account. Change it here when RunFeis has its own address. */
export const RUNFEIS_CONTACT_EMAIL = 'hello@runfeis.com'

/** Shared frame for the terms and privacy pages: cover band, draft note, readable column. */
export function LegalPage({
  title,
  updated,
  children
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand links={[{ href: '/', label: 'Feiseanna' }]}>
        <div className="pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">{title}</h1>
          <p className="mt-1.5 opacity-85">Last updated {updated}</p>
        </div>
      </CoverBand>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-7">
        <div className="max-w-[68ch]">
          <p className="mb-8 border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-3 text-sm text-[var(--color-feis-orange-ink)]">
            This is a draft while RunFeis is being tested. It will be reviewed before RunFeis takes
            real payments.
          </p>
          <div className="feis-prose grid gap-7 text-[15px] leading-relaxed">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
