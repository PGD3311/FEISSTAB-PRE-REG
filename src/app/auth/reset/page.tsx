'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { AuthLayout, AUTH_BUTTON, AUTH_INPUT } from '@/components/auth/auth-layout'

export default function ResetPasswordPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
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
      const { error: authError } = await supabase.auth.updateUser({ password })
      if (authError) {
        setError(
          authError.message.toLowerCase().includes('session')
            ? 'This reset link has expired. Ask for a new one from the sign-in page.'
            : authError.message
        )
        return
      }
      router.push('/auth/onboarding')
      router.refresh()
    } catch {
      setError('Something went wrong saving your password. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      switchLink={{ href: '/auth/forgot', label: 'Send a new link', prompt: 'Link not working?' }}
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
          <label htmlFor="password" className="feis-label">
            New password
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
            Type it again
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
          {loading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </AuthLayout>
  )
}
