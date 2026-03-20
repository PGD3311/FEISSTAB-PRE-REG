import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check existing capabilities
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

  // If user already has data, route them
  if (household && listings && listings.length > 0) {
    redirect('/dashboard')
  }
  if (household) {
    redirect('/dashboard')
  }
  if (listings && listings.length > 0) {
    redirect('/organiser/feiseanna')
  }

  // New user — create household automatically and send to add dancer
  const { data: newHousehold, error } = await supabase
    .from('households')
    .insert({ user_id: user.id })
    .select('id')
    .single()

  if (error || !newHousehold) {
    // Household might already exist (race condition) — just redirect
    redirect('/dashboard')
  }

  redirect('/dashboard/dancers/new')
}
