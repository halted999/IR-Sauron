import React from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { useThemeStore } from '../../store/theme'
import { ROLE_LABELS } from '../../types'

const navLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  padding: '4px 12px',
  borderRadius: 6,
  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
  background: isActive ? 'var(--bg-tertiary)' : 'transparent',
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
  transition: 'background 0.15s',
})

interface AppLayoutProps {
  children: React.ReactNode
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user, logout } = useAuthStore()
  const { theme } = useThemeStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const initials = user
    ? (user.full_name ?? user.username)
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '??'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <header
        style={{
          height: 56,
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          zIndex: 100,
          position: 'sticky',
          top: 0,
          overflow: 'hidden',
        }}
      >
        {/* Sauron theme: full-width background watermark */}
        {theme === 'sauron' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 0,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: '0.4em',
                textTransform: 'uppercase',
                color: 'rgba(255,90,31,0.14)',
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}
            >
              find the hobbits
            </span>
          </div>
        )}

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            gap: 24,
          }}
        >
        {/* Logo */}
        <Link
          to="/dashboard"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-primary)',
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            style={{ filter: 'drop-shadow(0 0 4px rgba(255,90,31,0.65))' }}
          >
            <defs>
              <radialGradient id="sauronGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ff5a1f" />
                <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="sauronFire" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffcf5c" />
                <stop offset="45%" stopColor="#ff5a1f" />
                <stop offset="100%" stopColor="#a81300" />
              </linearGradient>
            </defs>
            <circle cx="12" cy="12" r="11" fill="url(#sauronGlow)" opacity="0.45" />
            <path
              d="M2 12C2 12 7 5 12 5C17 5 22 12 22 12C22 12 17 19 12 19C7 19 2 12 2 12Z"
              fill="url(#sauronFire)"
              stroke="#7a1a00"
              strokeWidth="0.75"
            />
            <ellipse cx="12" cy="12" rx="1.7" ry="6.2" fill="#150402" />
          </svg>
          IR-Sauron
        </Link>

        {/* Nav */}
        <nav style={{ display: 'flex', gap: 4 }}>
          <NavLink to="/alerts" style={navLinkStyle}>
            Алерты
          </NavLink>
          <NavLink to="/dashboard" style={navLinkStyle}>
            Дела
          </NavLink>
          <NavLink to="/statistics" style={navLinkStyle}>
            Статистика
          </NavLink>
        </nav>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Admin panel button */}
        {user?.role === 'admin' && (
          <Link
            to="/admin"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Панель администрирования
          </Link>
        )}

        {/* User info */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              to="/profile"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                textDecoration: 'none',
                color: 'inherit',
              }}
              title="Открыть профиль"
            >
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {user.full_name ?? user.username}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {ROLE_LABELS[user.role]}
                </div>
              </div>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--accent-hover)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {initials}
              </div>
            </Link>
            <button
              onClick={handleLogout}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Выйти
            </button>
          </div>
        )}
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</main>
    </div>
  )
}
