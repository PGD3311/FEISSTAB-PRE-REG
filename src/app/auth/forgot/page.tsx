'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { AuthLayout, AUTH_BUTTON, AUTH_INPUT } from '@/components/auth/auth-layout'

function ForgotForm() {
  const supabase = useSupabase()
  const expired = useSearchParams().get('expired') === '1'
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`
      })
      if (authError) {
        if (authError.status === 429 || authError.message.toLowerCase().includes('rate limit')) {
          setError('Too many requests. Wait a few minutes and try again.')
        } else {
          setError(authError.message)
        }
        return
      }
      setSent(true)
    } catch {
      setError('Something went wrong sending the email. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const switchLink = { href: '/auth/login', label: 'Sign in', prompt: 'Remembered it?' }

  if (sent) {
    return (
      <AuthLayout title="Check your email" switchLink={switchLink}>
        <p className="text-[15px]">
          If there&apos;s a RunFeis account for <span className="font-bold break-all">{email}</span>
          , we&apos;ve sent it a link to choose a new password. The link works for one hour.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      intro="Enter the email you signed up with and we'll send you a link to choose a new password."
      switchLink={switchLink}
    >
      <form onSubmit={handleSubmit} className="grid gap-5">
        {expired && (
          <p className="border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-3 text-sm text-[var(--color-feis-orange-ink)]">
            That reset link has expired or was already used. Ask for a new one below.
          </p>
        )}
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
        <button type="submit" disabled={loading} className={`${AUTH_BUTTON} mt-1`}>
          {loading ? 'Sending…' : 'Send the reset link'}
        </button>
      </form>
    </AuthLayout>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-feis-cream)]" />}>
      <ForgotForm />
    </Suspense>
  )
}
