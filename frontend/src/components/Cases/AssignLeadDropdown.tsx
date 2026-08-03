import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { useAuthStore } from '../../store/auth'
import { getAssignableUsers } from '../../api/users'
import type { AssignableUser } from '../../api/users'

interface AssignLeadDropdownProps {
  currentLeadName?: string
  isLoading?: boolean
  onAssign: (userId: string) => void
}

export const AssignLeadDropdown: React.FC<AssignLeadDropdownProps> = ({
  currentLeadName, isLoading = false, onAssign,
}) => {
  const { user: currentUser } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setIsFetching(true)
    getAssignableUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setIsFetching(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleSelect = (userId: string) => {
    setOpen(false)
    onAssign(userId)
  }

  const others = currentUser ? users.filter((u) => u.id !== currentUser.id) : users

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} isLoading={isLoading}>
        {currentLeadName ? `Назначить: ${currentLeadName}` : 'Назначить'}
      </Button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 240,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 30,
            padding: 4,
          }}
        >
          {currentUser && (
            <button
              onClick={() => handleSelect(currentUser.id)}
              style={rowStyle}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tertiary)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
              }}
            >
              <strong>Назначить на себя</strong>
            </button>
          )}
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          {isFetching ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
              <Spinner size={18} />
            </div>
          ) : (
            <>
              {others.map((u) => (
                <button
                  key={u.id}
                  onClick={() => handleSelect(u.id)}
                  style={rowStyle}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tertiary)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
                  }}
                >
                  {u.full_name || u.username}
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11, marginLeft: 6 }}>
                    @{u.username}
                  </span>
                </button>
              ))}
              {others.length === 0 && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: '8px 10px' }}>
                  Нет других пользователей
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '7px 10px',
  border: 'none',
  background: 'none',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
