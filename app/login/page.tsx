'use client'

import { useState } from 'react'
import { createClient } from '../../utils/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMessage(error.message)
    } else {
      router.push('/')
      router.refresh()
    }
    setLoading(false)
  }

  const handleSignup = async () => {
    setLoading(true)
    setMessage('')

    const { error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setMessage(error.message)
    } else {
      setMessage('Registration successful! Check your email to confirm or try signing in.')
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
      <div className="w-full max-w-md rounded-xl bg-gray-800 p-8 shadow-md">
        <h1 className="mb-6 text-[24px] font-semibold text-center">Sign in to AI Video Automation</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
               className="h-9 w-full rounded-md border border-gray-600 bg-gray-700 px-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
               className="h-9 w-full rounded-md border border-gray-600 bg-gray-700 px-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          {message && <p className="text-sm text-yellow-400">{message}</p>}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={loading}
               className="flex-1 rounded-md bg-blue-600 px-4 h-9 font-semibold transition hover:bg-blue-700"
            >
              {loading ? 'Loading...' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={handleSignup}
              disabled={loading}
               className="flex-1 rounded-md bg-gray-600 px-4 h-9 font-semibold transition hover:bg-gray-500"
            >
              Sign up
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
