'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { AuthLayout, AUTH_BUTTON, AUTH_INPUT } from '@/components/auth/auth-layout'

function LoginForm() {
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (authError) {
        if (authError.status === 429 || authError.message.toLowerCase().includes('rate limit')) {
          setError('Too many sign-in attempts. Wait a few minutes and try again.')
        } else {
          setError(authError.message)
        }
        return
      }

      router.push(redirectTo || '/auth/onboarding')
      router.refresh()
    } catch {
      setError('Something went wrong signing you in. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const signupHref = redirectTo
    ? `/auth/signup?redirect=${encodeURIComponent(redirectTo)}`
    : '/auth/signup'

  return (
    <AuthLayout
      title="Sign in"
      intro="Families and organisers use the same RunFeis account."
      switchLink={{ href: signupHref, label: 'Create an account', prompt: 'New to RunFeis?' }}
    >
      <form onSubmit={handleSubmit} className="grid gap-5">
        {error && (
          <p
            role="alert"
            className="border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div>
          <label htmlFor="email" className="feis-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={AUTH_INPUT}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="feis-label">
              Password
            </label>
            <Link href="/auth/forgot" className="text-[13px] font-semibold text-primary underline">
              Forgot your password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT}
          />
        </div>

        <button type="submit" disabled={loading} className={`${AUTH_BUTTON} mt-1`}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-feis-cream)]" />}>
      <LoginForm />
    </Suspense>
  )
}
