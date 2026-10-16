import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppBand } from '@/components/app-band'
import { LogoutButton } from '@/components/logout-button'

export const dynamic = 'force-dynamic'

export default async function OrganiserLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <AppBand
        links={[{ href: '/organiser/feiseanna', label: 'Your feiseanna', matchChildren: true }]}
      >
        <span className="hidden text-white/70 sm:inline">{user.email}</span>
        <LogoutButton />
      </AppBand>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-7">{children}</main>
    </div>
  )
}
