import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppBand } from '@/components/app-band'
import { LogoutButton } from '@/components/logout-button'
import { ViewToggle } from '@/components/navigation/view-toggle'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check capabilities for view toggle
  const [{ data: household }, { data: listings }, { data: isAdmin, error: adminError }] =
    await Promise.all([
      supabase.from('households').select('id').eq('user_id', user.id).single(),
      supabase.from('feis_listings').select('id').eq('created_by', user.id).limit(1),
      supabase.rpc('is_platform_admin')
    ])
  if (adminError) console.error('Failed to check admin role:', adminError.message)

  const hasHousehold = !!household
  const hasListings = !!(listings && listings.length > 0)

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)] print:bg-white">
      <AppBand
        links={[
          { href: '/dashboard', label: 'My entries' },
          { href: '/dashboard/dancers', label: 'Dancers', matchChildren: true },
          { href: '/dashboard/account', label: 'Family details' },
          { href: '/', label: 'Feiseanna' },
          ...(isAdmin === true ? [{ href: '/admin/approvals', label: 'Approvals' }] : [])
        ]}
      >
        <ViewToggle hasHousehold={hasHousehold} hasListings={hasListings} />
        <LogoutButton />
      </AppBand>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-7">{children}</main>
    </div>
  )
}
