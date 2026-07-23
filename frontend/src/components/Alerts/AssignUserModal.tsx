import React, { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { useAuthStore } from '../../store/auth'
import { getAssignableUsers } from '../../api/users'
import type { AssignableUser } from '../../api/users'

interface AssignUserModalProps {
  isOpen: boolean
  onClose: () => void
  onAssign: (userId: string) => void
  isLoading?: boolean
  title?: string
}

export const AssignUserModal: React.FC<AssignUserModalProps> = ({
  isOpen,
  onClose,
  onAssign,
  isLoading = false,
  title = 'Назначить на',
}) => {
  const { user: currentUser } = useAuthStore()
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    if (!isOpen) return
    setIsFetching(true)
    getAssignableUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setIsFetching(false))
  }, [isOpen])

  const others = users.filter((u) => u.id !== currentUser?.id)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width={400}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
      }
    >
      {isFetching ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
          <Spinner size={22} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {currentUser && (
            <button
              onClick={() => onAssign(currentUser.id)}
              disabled={isLoading}
              style={userRowStyle}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tertiary)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
              }}
            >
              <strong>Взять себе</strong>
            </button>
          )}
          {others.map((u) => (
            <button
              key={u.id}
              onClick={() => onAssign(u.id)}
              disabled={isLoading}
              style={userRowStyle}
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
          {others.length === 0 && !currentUser && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '10px 0' }}>
              Нет доступных пользователей
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

const userRowStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '9px 10px',
  border: 'none',
  background: 'none',
  borderRadius: 6,
  fontSize: 13,
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
