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
      setMessage('Реєстрація успішна! Перевірте пошту для підтвердження або спробуйте увійти.')
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
      <div className="w-full max-w-md p-8 bg-gray-800 rounded-lg shadow-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Авторизація в AI Video Automation</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          {message && <p className="text-sm text-yellow-400">{message}</p>}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 p-2 rounded font-semibold transition"
            >
              {loading ? 'Завантаження...' : 'Увійти'}
            </button>
            <button
              type="button"
              onClick={handleSignup}
              disabled={loading}
              className="flex-1 bg-gray-600 hover:bg-gray-500 p-2 rounded font-semibold transition"
            >
              Зареєструватись
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
