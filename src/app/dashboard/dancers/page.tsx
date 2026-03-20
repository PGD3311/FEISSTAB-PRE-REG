import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Dancer } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function calcAge(dob: string): number {
  const today = new Date()
  const birth = new Date(dob)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

const CHAMPIONSHIP_LABELS: Record<string, string> = {
  none: 'Solo',
  prelim: 'Prelim Champ',
  open: 'Open Champ',
}

export default async function DancersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')

  const { data: dancers, error } = await supabase
    .from('dancers')
    .select('*')
    .eq('household_id', household.id)
    .eq('is_active', true)
    .order('first_name', { ascending: true })

  if (error) {
    console.error('Failed to load dancers:', error)
  }

  const activeDancers = (dancers ?? []) as Dancer[]

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dancers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your dancer profiles and competition levels.
          </p>
        </div>
        <Link
          href="/dashboard/dancers/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
        >
          Add Dancer
        </Link>
      </div>

      {activeDancers.length === 0 ? (
        <div className="feis-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No dancers yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Add your first dancer to start registering for feiseanna.
          </p>
          <Link
            href="/dashboard/dancers/new"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
          >
            Add Dancer
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {activeDancers.map((dancer) => (
            <Link
              key={dancer.id}
              href={`/dashboard/dancers/${dancer.id}`}
              className="feis-card block px-5 py-4 hover:border-[var(--color-feis-green)]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">
                    {dancer.first_name} {dancer.last_name}
                  </p>
                  <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
                    <span>Age {calcAge(dancer.date_of_birth)}</span>
                    {dancer.school_name && (
                      <>
                        <span className="text-border">·</span>
                        <span>{dancer.school_name}</span>
                      </>
                    )}
                    <span className="text-border">·</span>
                    <span>{CHAMPIONSHIP_LABELS[dancer.championship_status] ?? dancer.championship_status}</span>
                  </div>
                </div>
                <svg
                  className="h-4 w-4 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
