import React, { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  title: string
  message: string
  requireReason?: boolean
  reasonLabel?: string
  confirmLabel?: string
  isDanger?: boolean
  isLoading?: boolean
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  requireReason = false,
  reasonLabel = 'Причина',
  confirmLabel = 'Подтвердить',
  isDanger = false,
  isLoading = false,
}) => {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const handleConfirm = () => {
    if (requireReason && !reason.trim()) {
      setError('Укажите причину')
      return
    }
    setError('')
    onConfirm(reason.trim())
  }

  const handleClose = () => {
    setReason('')
    setError('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Отмена
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            onClick={handleConfirm}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', marginBottom: requireReason ? 16 : 0 }}>
        {message}
      </p>

      {requireReason && (
        <div>
          <label htmlFor="confirm-reason">{reasonLabel}</label>
          <textarea
            id="confirm-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Опишите причину..."
            style={{ resize: 'vertical' }}
          />
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{error}</p>
          )}
        </div>
      )}
    </Modal>
  )
}
