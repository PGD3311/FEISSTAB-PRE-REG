'use client'

import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'

export function LogoutButton() {
  const supabase = useSupabase()
  const router = useRouter()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground opacity-80 transition-opacity hover:opacity-100"
    >
      Log Out
    </button>
  )
}
