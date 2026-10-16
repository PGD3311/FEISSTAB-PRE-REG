'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { AuthLayout, AUTH_BUTTON, AUTH_INPUT } from '@/components/auth/auth-layout'

function SignupForm() {
  const supabase = useSupabase()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('Use a password of at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('The two passwords don’t match. Type them again.')
      return
    }

    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        // The confirmation link must come back to this site; the shared Supabase project's
        // default address is the feis-day app
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
      })

      if (authError) {
        // Supabase returns misleading messages on rate limits
        if (authError.status === 429 || authError.message.toLowerCase().includes('rate limit')) {
          setError('Too many sign-up attempts. Wait a few minutes and try again.')
        } else if (authError.message.toLowerCase().includes('already registered')) {
          setError('There is already an account with this email. Sign in instead.')
        } else {
          setError(authError.message)
        }
        return
      }

      // Don't auto-redirect — user needs to verify email first.
      // For dev: disable "Confirm email" in Supabase dashboard
      // (Auth → Settings → Email Auth) to skip verification.
      setSuccess(true)
    } catch {
      setError('Something went wrong creating your account. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const loginHref = redirectTo
    ? `/auth/login?redirect=${encodeURIComponent(redirectTo)}`
    : '/auth/login'

  if (success) {
    return (
      <AuthShell title="Check your email" loginHref={loginHref}>
        <p className="text-[15px]">
          We sent a confirmation link to <span className="font-bold break-all">{email}</span>. Open
          it to activate your account, then sign in.
        </p>
        <Link href={loginHref} className="feis-btn feis-btn-outline mt-6">
          Back to sign in
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create an account"
      intro="One account for your whole family. Organisers sign up here too."
      loginHref={loginHref}
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
          <label htmlFor="password" className="feis-label">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT}
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="mt-1.5 text-[13px] text-muted-foreground">
            At least 6 characters.
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="feis-label">
            Type the password again
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={AUTH_INPUT}
          />
        </div>

        <button type="submit" disabled={loading} className={`${AUTH_BUTTON} mt-1`}>
          {loading ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  )
}

function AuthShell({
  title,
  intro,
  loginHref,
  children
}: {
  title: string
  intro?: string
  loginHref: string
  children: React.ReactNode
}) {
  return (
    <AuthLayout
      title={title}
      intro={intro}
      switchLink={{ href: loginHref, label: 'Sign in', prompt: 'Already have an account?' }}
    >
      {children}
    </AuthLayout>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-feis-cream)]" />}>
      <SignupForm />
    </Suspense>
  )
}
