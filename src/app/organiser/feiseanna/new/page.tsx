import { redirect } from 'next/navigation'
import Link from 'next/link'

import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { createEmptyDraftAndRedirect } from '@/app/organiser/feiseanna/actions'
import { StartBlankButton } from '@/components/organiser/start-blank-button'
import { ClonePicker } from '@/components/organiser/clone-picker'
import { PageTitle } from '@/components/page-title'

export const dynamic = 'force-dynamic'

export default async function NewFeisPage() {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) redirect('/auth/login')
  const { data: listings, error } = await supabase
    .from('feis_listings')
    .select('id, name, feis_date, status, reg_closes_at, late_reg_closes_at')
    .eq('created_by', user.id)
    .order('feis_date', { ascending: false })

  if (error) console.error('Failed to fetch listings to copy:', error)
  const hasExisting = !error && listings && listings.length > 0

  return (
    <div>
      <Link
        href="/organiser/feiseanna"
        className="mb-3 inline-block text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Back to your feiseanna
      </Link>
      <PageTitle
        title="Set up a new feis"
        intro="Start with a blank feis, or copy one you've run before to reuse its syllabus and fees."
      />

      <div className={`grid items-start gap-6 ${hasExisting ? 'md:grid-cols-2' : 'max-w-xl'}`}>
        <section className="feis-card px-5 pt-5 pb-6">
          <h2 className="feis-display text-[22px]">Start a blank feis</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fill in the details, syllabus and fees step by step. You can save and come back at any
            point.
          </p>
          <form action={createEmptyDraftAndRedirect} className="mt-5">
            <StartBlankButton />
          </form>
        </section>

        {hasExisting && (
          <section className="feis-card px-5 pt-5 pb-5">
            <h2 className="feis-display text-[22px]">Copy a feis you&apos;ve run</h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              Copies its set-up, competitions and fees into a new draft. The dates are left blank
              for you to set.
            </p>
            <ClonePicker listings={listings} />
          </section>
        )}
      </div>
    </div>
  )
}
