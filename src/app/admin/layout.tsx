import { notFound } from 'next/navigation'

import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { AppBand } from '@/components/app-band'
import { LogoutButton } from '@/components/logout-button'

export const dynamic = 'force-dynamic'

/** RunFeis's own pages. Anyone who isn't a platform admin gets a plain "not found". */
export default async function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) notFound()

  const { data: isAdmin, error } = await supabase.rpc('is_platform_admin')
  if (error) console.error('Failed to check platform admin:', error.message)
  if (error || isAdmin !== true) notFound()

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <AppBand links={[{ href: '/admin/approvals', label: 'Approvals' }]}>
        <span className="hidden text-white/70 sm:inline">{user.email}</span>
        <LogoutButton />
      </AppBand>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-7">{children}</main>
    </div>
  )
}
