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
      type="button"
      onClick={handleLogout}
      className="text-sm text-white/75 underline-offset-[6px] hover:text-white hover:underline"
    >
      Sign out
    </button>
  )
}
