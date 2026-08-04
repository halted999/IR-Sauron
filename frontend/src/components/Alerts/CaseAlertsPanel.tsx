import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { getAlerts, detachAlert } from '../../api/alerts'
import { useAuthStore } from '../../store/auth'
import { useToastStore } from '../../store/toast'
import type { Alert, AlertStatus, CaseSeverity, CaseSummary } from '../../types'
import { ALERT_STATUS_LABELS, CASE_SEVERITY_LABELS } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { AnalyzeDropdownButton } from '../Analysis/AnalyzeDropdownButton'

interface CaseAlertsPanelProps {
  caseId: string
  attachedCases?: CaseSummary[]
}

const SEVERITY_COLOR: Record<CaseSeverity, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'green',
}

const STATUS_COLOR: Record<AlertStatus, string> = {
  new: 'blue',
  triaged: 'yellow',
  escalated: 'green',
  dismissed: 'gray',
  archived: 'gray',
}

export const CaseAlertsPanel: React.FC<CaseAlertsPanelProps> = ({ caseId, attachedCases = [] }) => {
  const toast = useToastStore()
  const { user } = useAuthStore()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDetaching, setIsDetaching] = useState(false)

  const canWrite =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator'

  const attachedCaseTitleById = new Map(attachedCases.map((c) => [c.id, c.title]))
  const attachedCaseIds = attachedCases.map((c) => c.id)

  useEffect(() => {
    setIsLoading(true)
    Promise.all([caseId, ...attachedCaseIds].map((id) => getAlerts({ case_id: id, limit: 500 })))
      .then((results) => {
        const merged = results.flat()
        merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setAlerts(merged)
      })
      .catch(() => toast.error('Ошибка загрузки алертов инцидента'))
      .finally(() => setIsLoading(false))
    setSelectedIds(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, JSON.stringify(attachedCaseIds)])

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
    setSelectedIds(allSelected ? new Set() : new Set(alerts.map((a) => a.id)))
  }

  const handleDetach = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Отсоединить ${selectedIds.size} алертов от инцидента?`)) return
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
        Алерты не добавлены в этот инцидент.
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
            {attachedCases.length > 0 && <Th>Присоединён</Th>}
            <Th>Создан</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a, idx) => (
            <tr
              key={a.id}
              style={{
                borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                background: selectedIds.has(a.id) ? 'var(--bg-tertiary)' : 'transparent',
              }}
            >
              {canWrite && (
                <Td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(a.id)}
                    onChange={() => toggleSelected(a.id)}
                    style={{ cursor: 'pointer' }}
                  />
                </Td>
              )}
              <Td>
                <Link to={`/alerts/${a.id}`} style={{ display: 'block', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {a.title}
                </Link>
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
              {attachedCases.length > 0 && (
                <Td>
                  {a.case_id && a.case_id !== caseId && attachedCaseTitleById.has(a.case_id) ? (
                    <Link
                      to={`/cases/${a.case_id}`}
                      title="Перейти к присоединённому инциденту"
                      style={{
                        color: 'var(--accent)', fontSize: 12, textDecoration: 'none',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      → {attachedCaseTitleById.get(a.case_id)}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                  )}
                </Td>
              )}
              <Td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                {format(new Date(a.created_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
              </Td>
              <Td onClick={(e) => e.stopPropagation()}>
                <AnalyzeDropdownButton
                  size="sm"
                  ips={[...a.parsed_internal_ips, ...a.parsed_external_ips]}
                  accounts={a.parsed_accounts}
                  files={a.parsed_files}
                />
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
