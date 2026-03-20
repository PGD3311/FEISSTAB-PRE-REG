import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/logout-button'

export const dynamic = 'force-dynamic'

export default async function OrganiserLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <>
      <nav className="feis-nav-accent bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <span className="text-xl font-bold">FeisTab</span>
          <div className="flex items-center gap-4">
            <span className="text-sm opacity-80">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </>
  )
}
