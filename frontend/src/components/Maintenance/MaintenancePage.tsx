import React, { useEffect } from 'react'
import apiClient from '../../api/client'
import { useMaintenanceStore } from '../../store/maintenance'

interface PingResponse {
  status: string
  maintenance: boolean
  reason: string | null
  progress: { processed: number; total: number } | null
  last_error: string | null
}

export const MaintenancePage: React.FC = () => {
  const reason = useMaintenanceStore((s) => s.reason)
  const progress = useMaintenanceStore((s) => s.progress)
  const error = useMaintenanceStore((s) => s.error)
  const setActive = useMaintenanceStore((s) => s.setActive)
  const setProgress = useMaintenanceStore((s) => s.setProgress)
  const setError = useMaintenanceStore((s) => s.setError)

  useEffect(() => {
    if (error) return undefined
    const id = window.setInterval(async () => {
      try {
        const response = await apiClient.get<PingResponse>('/ping')
        const data = response.data
        if (!data.maintenance) {
          if (data.last_error) {
            setError(data.last_error)
            return
          }
          setActive(false)
          setProgress(null)
          window.location.reload()
          return
        }
        setProgress(data.progress)
      } catch {
        // still down — keep waiting
      }
    }, 2000)
    return () => window.clearInterval(id)
  }, [error, setActive, setProgress, setError])

  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : null

  const handleClose = () => {
    setActive(false)
    setProgress(null)
    setError(null)
    window.location.reload()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 16 }}>{error ? '⚠️' : '🛠️'}</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
        {error ? 'Восстановление завершилось с ошибкой' : 'Система находится на техническом обслуживании'}
      </h1>
      <p
        style={{
          fontSize: 14,
          color: error ? 'var(--danger)' : 'var(--text-secondary)',
          maxWidth: 480,
          marginBottom: 20,
          whiteSpace: 'pre-wrap',
        }}
      >
        {error || `${reason || 'Идёт восстановление базы данных'}. Страница обновится автоматически, как только обслуживание завершится.`}
      </p>

      {!error && (
        <div style={{ width: 320, maxWidth: '80vw' }}>
          <div
            style={{
              height: 10,
              borderRadius: 6,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: percent !== null ? `${percent}%` : '30%',
                background: 'var(--accent)',
                borderRadius: 6,
                transition: 'width 0.4s ease',
                animation: percent === null ? 'irsauron-indeterminate 1.4s ease-in-out infinite' : undefined,
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            {percent !== null && progress
              ? `${percent}% (${progress.processed} из ${progress.total})`
              : 'Подготовка…'}
          </div>
        </div>
      )}

      {error && (
        <button
          onClick={handleClose}
          style={{
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-primary)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Обновить страницу
        </button>
      )}

      <style>
        {`@keyframes irsauron-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(320%); }
        }`}
      </style>
    </div>
  )
}
