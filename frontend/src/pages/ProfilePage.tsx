import React, { useState } from 'react'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { useThemeStore } from '../store/theme'
import type { Theme } from '../store/theme'
import { updateUser } from '../api/users'
import { AppLayout } from '../components/Layout/AppLayout'
import { Button } from '../components/ui/Button'
import { ROLE_LABELS } from '../types'

const THEME_OPTIONS: { value: Theme; label: string; swatch: string[] }[] = [
  { value: 'light', label: 'Светлая', swatch: ['#ffffff', '#eaeef2', '#0969da'] },
  { value: 'dark', label: 'Тёмная', swatch: ['#0d1117', '#21262d', '#58a6ff'] },
  { value: 'sauron', label: 'Саурон', swatch: ['#0a0402', '#22100a', '#ff5a1f'] },
]

export const ProfilePage: React.FC = () => {
  const { user } = useAuthStore()
  const toast = useToastStore()
  const { theme, setTheme } = useThemeStore()

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  if (!user) return null

  const initials = (user.full_name ?? user.username)
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updated = await updateUser(user.id, {
        full_name: fullName.trim() || undefined,
        email: email.trim() || undefined,
        password: password.trim() || undefined,
      })
      useAuthStore.setState({ user: updated })
      setPassword('')
      toast.success('Профиль обновлён')
    } catch {
      toast.error('Ошибка обновления профиля')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px', maxWidth: 560, margin: '0 auto', width: '100%' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Профиль</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Личные данные и настройки учётной записи
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--accent-hover)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
              {user.full_name ?? user.username}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              @{user.username} · {ROLE_LABELS[user.role]}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div>
            <label htmlFor="profile-fullname">Полное имя</label>
            <input
              id="profile-fullname"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Имя Фамилия"
            />
          </div>

          <div>
            <label htmlFor="profile-email">Email</label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label htmlFor="profile-password">Новый пароль</label>
            <input
              id="profile-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Оставьте пустым, чтобы не менять"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
              Сохранить
            </Button>
          </div>
        </div>

        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginTop: 28,
            marginBottom: 12,
          }}
        >
          Оформление
        </h2>
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            gap: 12,
          }}
        >
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: '14px 10px',
                borderRadius: 10,
                border:
                  theme === opt.value ? '2px solid var(--accent)' : '2px solid var(--border)',
                background: 'var(--bg-tertiary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', gap: 4 }}>
                {opt.swatch.map((color, i) => (
                  <div
                    key={i}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: color,
                      border: '1px solid rgba(0,0,0,0.2)',
                    }}
                  />
                ))}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: theme === opt.value ? 'var(--accent)' : 'var(--text-primary)',
                }}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
