import React, { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useAuthStore } from '../../store/auth'
import type { AssignableUser } from '../../api/users'

interface ProcessAlertsModalProps {
  isOpen: boolean
  onClose: () => void
  count: number
  assignableUsers: AssignableUser[]
  onAttach: () => void
  onDismiss: () => void
  onArchive: () => void
  onAssign: (userId: string) => void
  isAssigning?: boolean
}

export const ProcessAlertsModal: React.FC<ProcessAlertsModalProps> = ({
  isOpen, onClose, count, assignableUsers, onAttach, onDismiss, onArchive, onAssign, isAssigning,
}) => {
  const { user: currentUser } = useAuthStore()
  const others = assignableUsers.filter((u) => u.id !== currentUser?.id)
  const [assigneeId, setAssigneeId] = useState('')

  useEffect(() => {
    if (isOpen) setAssigneeId(currentUser?.id ?? '')
  }, [isOpen, currentUser?.id])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Обработать (${count})`}
      width={440}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Действие
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={onAttach}>
              Присоединить к инциденту
            </Button>
            <Button variant="secondary" size="sm" onClick={onDismiss}>
              Отклонить
            </Button>
            <Button variant="danger" size="sm" onClick={onArchive}>
              В архив
            </Button>
          </div>
        </div>

        <div>
          <label htmlFor="process-assignee" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Назначить
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <select
              id="process-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              style={{ flex: 1 }}
            >
              {currentUser && <option value={currentUser.id}>Взять себе</option>}
              {others.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.username}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onAssign(assigneeId)}
              isLoading={isAssigning}
              disabled={!assigneeId}
            >
              Назначить
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
