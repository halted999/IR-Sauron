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
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #1f6feb 0%, #58a6ff 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px rgba(88,166,255,0.3)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path
                d="M4 14h6l3-6 3 12 3-7 2 1h3"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 4,
            }}
          >
            IR Timeline Constructor
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Конструктор тайлайна инцидентов ИБ
          </p>
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
