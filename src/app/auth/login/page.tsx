'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { CoverBand } from '@/components/feis-cover'

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
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand
        links={[
          { href: '/', label: 'Feiseanna' },
          { href: signupHref, label: 'Create an account' }
        ]}
      >
        <div className="min-w-0 pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">Sign in</h1>
          <p className="mt-1.5 max-w-[52ch] opacity-85">
            Families and organisers use the same RunFeis account.
          </p>
        </div>
      </CoverBand>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <div className="feis-card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
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
                className="feis-input"
                placeholder="you@example.com"
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="feis-input"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="feis-btn feis-btn-primary w-full py-2.5"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 border-t border-[#E2DCCD] pt-4 text-sm text-muted-foreground">
            New to RunFeis?{' '}
            <Link href={signupHref} className="feis-link">
              Create an account
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
