import React from 'react'
import { useToastStore } from '../../store/toast'

const ICONS: Record<string, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.type}`}>
          <span
            style={{
              fontSize: 16,
              flexShrink: 0,
              color:
                toast.type === 'success'
                  ? 'var(--success)'
                  : toast.type === 'error'
                    ? 'var(--danger)'
                    : toast.type === 'warning'
                      ? 'var(--warning)'
                      : 'var(--accent)',
            }}
          >
            {ICONS[toast.type]}
          </span>
          <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}>
            {toast.message}
          </span>
          <button
            onClick={() => removeToast(toast.id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 16,
              padding: 0,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
