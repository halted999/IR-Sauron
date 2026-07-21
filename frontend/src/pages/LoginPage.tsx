import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const { login, isLoading, error, accessToken, clearError } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (accessToken) navigate('/dashboard', { replace: true })
  }, [accessToken, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    try {
      await login(username, password)
      navigate('/dashboard', { replace: true })
    } catch {
      // error is in store
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo block */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            style={{
              margin: '0 auto',
              display: 'block',
              filter: 'drop-shadow(0 0 10px rgba(255,90,31,0.65))',
            }}
          >
            <defs>
              <radialGradient id="sauronGlowLogin" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ff5a1f" />
                <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="sauronFireLogin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffcf5c" />
                <stop offset="45%" stopColor="#ff5a1f" />
                <stop offset="100%" stopColor="#a81300" />
              </linearGradient>
            </defs>
            <circle cx="12" cy="12" r="11" fill="url(#sauronGlowLogin)" opacity="0.45" />
            <path
              d="M2 12C2 12 7 5 12 5C17 5 22 12 22 12C22 12 17 19 12 19C7 19 2 12 2 12Z"
              fill="url(#sauronFireLogin)"
              stroke="#7a1a00"
              strokeWidth="0.75"
            />
            <ellipse cx="12" cy="12" rx="1.7" ry="6.2" fill="#150402" />
          </svg>
        </div>

        {/* Login form */}
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '28px 28px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, color: 'var(--text-primary)' }}>
            Вход в систему
          </h2>

          {error && (
            <div
              style={{
                background: 'rgba(248,81,73,0.1)',
                border: '1px solid rgba(248,81,73,0.4)',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 16,
                fontSize: 13,
                color: 'var(--danger)',
              }}
            >
              {error.includes('401') || error.includes('Unauthorized')
                ? 'Неверный логин или пароль'
                : error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="username">Имя пользователя</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label htmlFor="password">Пароль</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
              disabled={!username || !password}
              style={{ width: '100%', padding: '10px 16px', fontSize: 15 }}
            >
              Войти
            </Button>
          </form>
        </div>

        <p
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          IR / DFIR Team Portal · v1.0
        </p>
      </div>
    </div>
  )
}
