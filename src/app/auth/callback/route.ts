import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Usually an expired or already-used confirmation link; signing in still works
    console.error('Email confirmation failed:', error.message)
    return NextResponse.redirect(`${origin}/auth/login`)
  }

  return NextResponse.redirect(`${origin}/auth/onboarding`)
}
