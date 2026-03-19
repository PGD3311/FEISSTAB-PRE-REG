import Link from 'next/link'
import { Plus, Copy } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { createEmptyDraftAndRedirect } from '@/app/organiser/feiseanna/actions'
import { ClonePicker } from '@/components/organiser/clone-picker'

export const dynamic = 'force-dynamic'

export default async function NewFeisPage() {
  const supabase = await createClient()
  const { data: listings, error } = await supabase
    .from('feis_listings')
    .select('id, name, feis_date, status')
    .order('feis_date', { ascending: false })

  const hasExisting = !error && listings && listings.length > 0

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/organiser/feiseanna"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Feiseanna
        </Link>
        <h1 className="mt-3 text-2xl">Create New Feis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start fresh or clone a previous feis to get a head start.
        </p>
      </div>

      <div
        className={`grid gap-6 ${hasExisting ? 'md:grid-cols-2' : 'max-w-md'}`}
      >
        {/* Start Fresh Card */}
        <form action={createEmptyDraftAndRedirect}>
          <button
            type="submit"
            className="feis-card flex w-full cursor-pointer flex-col items-center justify-center px-6 py-12 text-center"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-secondary">
              <Plus className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Start Fresh</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a new feis from scratch. Fill in details, syllabus,
              and fees step by step.
            </p>
          </button>
        </form>

        {/* Clone Previous Card */}
        {hasExisting && (
          <div className="feis-card flex flex-col px-6 py-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-secondary">
                <Copy className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">Clone Previous Feis</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Copy structure, fees, and competitions from an existing feis.
                Dates will be cleared.
              </p>
            </div>
            <ClonePicker listings={listings} />
          </div>
        )}
      </div>
    </div>
  )
}
