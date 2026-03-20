import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ViewToggle } from '@/components/navigation/view-toggle'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check capabilities for view toggle
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  const { data: listings } = await supabase
    .from('feis_listings')
    .select('id')
    .eq('created_by', user.id)
    .limit(1)

  const hasHousehold = !!household
  const hasListings = !!(listings && listings.length > 0)

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-bold text-primary">
              FeisTab
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="font-medium text-foreground hover:text-primary">
                Dashboard
              </Link>
              <Link href="/dashboard/dancers" className="text-muted-foreground hover:text-foreground">
                Dancers
              </Link>
              <Link href="/feiseanna" className="text-muted-foreground hover:text-foreground">
                Browse Feiseanna
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ViewToggle hasHousehold={hasHousehold} hasListings={hasListings} />
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
