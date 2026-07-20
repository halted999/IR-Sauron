import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { getAlert, updateAlert, escalateAlert } from '../api/alerts'
import { useAlertStore } from '../store/alert'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { AppLayout } from '../components/Layout/AppLayout'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import type { Alert, AlertStatus, CaseSeverity } from '../types'
import { ALERT_STATUS_LABELS, CASE_SEVERITY_LABELS } from '../types'

const SEVERITY_COLOR: Record<CaseSeverity, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'green',
  informational: 'gray',
}

const STATUS_COLOR: Record<AlertStatus, string> = {
  new: 'blue',
  triaged: 'yellow',
  escalated: 'green',
  dismissed: 'gray',
}

export const AlertDetailPage: React.FC = () => {
  const { alertId } = useParams<{ alertId: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const { user } = useAuthStore()
  const { updateAlertInStore } = useAlertStore()

  const [alert, setAlert] = useState<Alert | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isActing, setIsActing] = useState(false)

  useEffect(() => {
    if (!alertId) return
    setIsLoading(true)
    getAlert(alertId)
      .then(setAlert)
      .catch(() => toast.error('Ошибка загрузки алерта'))
      .finally(() => setIsLoading(false))
  }, [alertId]) // eslint-disable-line react-hooks/exhaustive-deps

  const canWrite =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator' ||
    user?.role === 'threat_hunter'

  const applyUpdate = (updated: Alert) => {
    setAlert(updated)
    updateAlertInStore(updated)
  }

  const handleTriage = async () => {
    if (!alert) return
    setIsActing(true)
    try {
      const updated = await updateAlert(alert.id, { status: 'triaged' })
      applyUpdate(updated)
      toast.success('Алерт взят в работу')
    } catch {
      toast.error('Ошибка обновления алерта')
    } finally {
      setIsActing(false)
    }
  }

  const handleDismiss = async () => {
    if (!alert) return
    if (!confirm(`Отклонить алерт "${alert.title}"?`)) return
    setIsActing(true)
    try {
      const updated = await updateAlert(alert.id, { status: 'dismissed' })
      applyUpdate(updated)
      toast.success('Алерт отклонён')
    } catch {
      toast.error('Ошибка обновления алерта')
    } finally {
      setIsActing(false)
    }
  }

  const handleEscalate = async () => {
    if (!alert) return
    if (!confirm(`Эскалировать алерт "${alert.title}" в новое дело?`)) return
    setIsActing(true)
    try {
      const newCase = await escalateAlert(alert.id, {})
      applyUpdate({ ...alert, status: 'escalated', case_id: newCase.id })
      toast.success(`Дело «${newCase.title}» создано из алерта`)
      navigate(`/cases/${newCase.id}`)
    } catch {
      toast.error('Ошибка эскалации алерта')
    } finally {
      setIsActing(false)
    }
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <Spinner size={32} />
        </div>
      </AppLayout>
    )
  }

  if (!alert) {
    return (
      <AppLayout>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>Алерт не найден</p>
          <Button variant="secondary" onClick={() => navigate('/alerts')}>
            Вернуться к списку
          </Button>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Link to="/alerts" style={{ color: 'var(--accent)' }}>
            Алерты
          </Link>
          <span>/</span>
          <code
            style={{
              fontSize: 12,
              color: 'var(--accent)',
              background: 'rgba(88,166,255,0.1)',
              padding: '1px 6px',
              borderRadius: 4,
            }}
          >
            {alert.id.slice(0, 8)}
          </code>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 20, fontWeight: 700 }}>{alert.title}</h1>
              <Badge
                color={SEVERITY_COLOR[alert.severity] as 'red'}
                label={CASE_SEVERITY_LABELS[alert.severity]}
                size="sm"
              />
              <Badge
                color={STATUS_COLOR[alert.status] as 'blue'}
                label={ALERT_STATUS_LABELS[alert.status]}
                size="sm"
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
              Создан: {format(new Date(alert.created_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
              {alert.updated_at !== alert.created_at && (
                <>
                  {' · Обновлён: '}
                  {format(new Date(alert.updated_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
                </>
              )}
            </p>
          </div>

          {canWrite && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {alert.status === 'escalated' ? (
                alert.case_id && (
                  <Button variant="primary" size="sm" onClick={() => navigate(`/cases/${alert.case_id}`)}>
                    Открыть дело
                  </Button>
                )
              ) : alert.status === 'dismissed' ? null : (
                <>
                  {alert.status === 'new' && (
                    <Button variant="secondary" size="sm" onClick={handleTriage} isLoading={isActing}>
                      В работу
                    </Button>
                  )}
                  <Button variant="primary" size="sm" onClick={handleEscalate} isLoading={isActing}>
                    Эскалировать
                  </Button>
                  <Button variant="danger" size="sm" onClick={handleDismiss} isLoading={isActing}>
                    Отклонить
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <Field label="Источник">{alert.source ?? '—'}</Field>
          <Field label="Описание">
            {alert.description ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{alert.description}</span>
            ) : (
              '—'
            )}
          </Field>
          {alert.case_id && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#d29922',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Дело
              </span>
              <Link to={`/cases/${alert.case_id}`} style={{ color: '#d29922', fontSize: 14 }}>
                {alert.case_id.slice(0, 8)}
              </Link>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

const Field: React.FC<{ label: string; children?: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: 4,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{children}</div>
  </div>
)
