import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { getAlerts, detachAlert } from '../../api/alerts'
import { useAuthStore } from '../../store/auth'
import { useToastStore } from '../../store/toast'
import type { Alert, AlertStatus, CaseSeverity } from '../../types'
import { ALERT_STATUS_LABELS, CASE_SEVERITY_LABELS } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

interface CaseAlertsPanelProps {
  caseId: string
}

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

export const CaseAlertsPanel: React.FC<CaseAlertsPanelProps> = ({ caseId }) => {
  const navigate = useNavigate()
  const toast = useToastStore()
  const { user } = useAuthStore()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDetaching, setIsDetaching] = useState(false)

  const canWrite =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator' ||
    user?.role === 'threat_hunter'

  useEffect(() => {
    setIsLoading(true)
    getAlerts({ case_id: caseId })
      .then(setAlerts)
      .catch(() => toast.error('Ошибка загрузки алертов дела'))
      .finally(() => setIsLoading(false))
    setSelectedIds(new Set())
  }, [caseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const allSelected = alerts.length > 0 && alerts.every((a) => selectedIds.has(a.id))

  const toggleSelected = (alertId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(alertId)) next.delete(alertId)
      else next.add(alertId)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (allSelected ? new Set() : new Set(alerts.map((a) => a.id))))
  }

  const handleDetach = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Отсоединить ${selectedIds.size} алертов от дела?`)) return
    setIsDetaching(true)
    try {
      await Promise.all(Array.from(selectedIds).map((id) => detachAlert(id)))
      setAlerts((prev) => prev.filter((a) => !selectedIds.has(a.id)))
      toast.success(`Отсоединено алертов: ${selectedIds.size}`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Ошибка отсоединения алертов')
    } finally {
      setIsDetaching(false)
    }
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <Spinner size={28} />
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: 14,
        }}
      >
        Алерты не добавлены в это дело.
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {canWrite && selectedIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Выбрано: {selectedIds.size}
          </span>
          <Button variant="danger" size="sm" onClick={handleDetach} isLoading={isDetaching}>
            Отсоединить
          </Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              background: 'var(--bg-secondary)',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            {canWrite && (
              <Th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </Th>
            )}
            <Th>Заголовок</Th>
            <Th>Источник</Th>
            <Th>Критичность</Th>
            <Th>Статус</Th>
            <Th>Создан</Th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a, idx) => (
            <tr
              key={a.id}
              onClick={() => navigate(`/alerts/${a.id}`)}
              style={{
                borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
                background: selectedIds.has(a.id) ? 'var(--bg-tertiary)' : 'transparent',
              }}
              title="Открыть алерт"
            >
              {canWrite && (
                <Td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(a.id)}
                    onChange={() => toggleSelected(a.id)}
                    style={{ cursor: 'pointer' }}
                  />
                </Td>
              )}
              <Td>
                <div style={{ fontWeight: 500 }}>{a.title}</div>
                {a.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      marginTop: 2,
                      maxWidth: 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.description}
                  </div>
                )}
              </Td>
              <Td>{a.source ?? '—'}</Td>
              <Td>
                <Badge
                  color={SEVERITY_COLOR[a.severity] as 'red'}
                  label={CASE_SEVERITY_LABELS[a.severity]}
                  size="sm"
                />
              </Td>
              <Td>
                <Badge
                  color={STATUS_COLOR[a.status] as 'blue'}
                  label={ALERT_STATUS_LABELS[a.status]}
                  size="sm"
                />
              </Td>
              <Td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                {format(new Date(a.created_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th
    style={{
      padding: '8px 14px',
      textAlign: 'left',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: '1px solid var(--border)',
    }}
  >
    {children}
  </th>
)

const Td: React.FC<{
  children?: React.ReactNode
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void
}> = ({ children, style, onClick }) => (
  <td
    onClick={onClick}
    style={{
      padding: '10px 14px',
      fontSize: 13,
      color: 'var(--text-primary)',
      verticalAlign: 'middle',
      ...style,
    }}
  >
    {children}
  </td>
)
