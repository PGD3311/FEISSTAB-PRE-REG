import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/** Only same-site paths, so a crafted link can't send someone to another website. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/auth/onboarding'
  }
  return value
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Usually an expired or already-used link; signing in or asking again still works
    console.error('Email link failed:', error.message)
    const retry = next === '/auth/reset' ? '/auth/forgot?expired=1' : '/auth/login'
    return NextResponse.redirect(`${origin}${retry}`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
