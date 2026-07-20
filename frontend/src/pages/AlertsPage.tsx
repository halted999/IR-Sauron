import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useAlertStore } from '../store/alert'
import { useToastStore } from '../store/toast'
import { useAuthStore } from '../store/auth'
import { createAlert, updateAlert, escalateAlert, escalateAlertsBulk } from '../api/alerts'
import { AppLayout } from '../components/Layout/AppLayout'
import { AlertModal } from '../components/Alerts/AlertModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import type { Alert, AlertStatus, CaseSeverity, CreateAlertData } from '../types'
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

export const AlertsPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toast = useToastStore()
  const { alerts, isLoading, fetchAlerts, addAlert, updateAlertInStore } = useAlertStore()

  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)
  const [escalatingId, setEscalatingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkEscalating, setIsBulkEscalating] = useState(false)

  useEffect(() => {
    const params: { status?: AlertStatus; severity?: CaseSeverity } = {}
    if (filterStatus !== 'all') params.status = filterStatus as AlertStatus
    if (filterSeverity !== 'all') params.severity = filterSeverity as CaseSeverity
    fetchAlerts(params).catch(() => toast.error('Ошибка загрузки алертов'))
    setSelectedIds(new Set())
  }, [filterStatus, filterSeverity]) // eslint-disable-line react-hooks/exhaustive-deps

  const canWrite =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator' ||
    user?.role === 'threat_hunter'

  const handleSaveAlert = async (data: CreateAlertData) => {
    try {
      const newAlert = await createAlert(data)
      addAlert(newAlert)
      toast.success('Алерт создан')
      setShowModal(false)
    } catch {
      toast.error('Ошибка создания алерта')
      throw new Error('save failed')
    }
  }

  const handleTriage = async (alert: Alert) => {
    try {
      const updated = await updateAlert(alert.id, { status: 'triaged' })
      updateAlertInStore(updated)
      toast.success('Алерт взят в работу')
    } catch {
      toast.error('Ошибка обновления алерта')
    }
  }

  const handleDismiss = async (alert: Alert) => {
    if (!confirm(`Отклонить алерт "${alert.title}"?`)) return
    try {
      const updated = await updateAlert(alert.id, { status: 'dismissed' })
      updateAlertInStore(updated)
      toast.success('Алерт отклонён')
    } catch {
      toast.error('Ошибка обновления алерта')
    }
  }

  const handleEscalate = async (alert: Alert) => {
    if (!confirm(`Эскалировать алерт "${alert.title}" в новое дело?`)) return
    setEscalatingId(alert.id)
    try {
      const newCase = await escalateAlert(alert.id, {})
      updateAlertInStore({ ...alert, status: 'escalated', case_id: newCase.id })
      toast.success(`Дело «${newCase.title}» создано из алерта`)
      navigate(`/cases/${newCase.id}`)
    } catch {
      toast.error('Ошибка эскалации алерта')
    } finally {
      setEscalatingId(null)
    }
  }

  const filteredAlerts = alerts.filter((a) => {
    if (filterStatus !== 'all' && a.status !== filterStatus) return false
    if (filterSeverity !== 'all' && a.severity !== filterSeverity) return false
    return true
  })

  const isSelectable = (a: Alert) => a.status !== 'escalated'
  const selectableAlerts = filteredAlerts.filter(isSelectable)
  const allSelected =
    selectableAlerts.length > 0 && selectableAlerts.every((a) => selectedIds.has(a.id))

  const toggleSelected = (alertId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(alertId)) next.delete(alertId)
      else next.add(alertId)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set()
      return new Set(selectableAlerts.map((a) => a.id))
    })
  }

  const handleBulkEscalate = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Создать одно дело из ${selectedIds.size} выбранных алертов?`)) return
    setIsBulkEscalating(true)
    try {
      const newCase = await escalateAlertsBulk({ alert_ids: Array.from(selectedIds) })
      alerts
        .filter((a) => selectedIds.has(a.id))
        .forEach((a) => updateAlertInStore({ ...a, status: 'escalated', case_id: newCase.id }))
      toast.success(`Дело «${newCase.title}» создано из ${selectedIds.size} алертов`)
      setSelectedIds(new Set())
      navigate(`/cases/${newCase.id}`)
    } catch {
      toast.error('Ошибка создания дела из алертов')
    } finally {
      setIsBulkEscalating(false)
    }
  }

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        {/* Page header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Алерты</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Очередь триажа алертов до заведения дела
            </p>
          </div>
          {canWrite && (
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedIds.size > 0 && (
                <Button
                  variant="primary"
                  onClick={handleBulkEscalate}
                  isLoading={isBulkEscalating}
                >
                  Создать дело ({selectedIds.size})
                </Button>
              )}
              <Button variant="primary" onClick={() => setShowModal(true)}>
                + Добавить алерт
              </Button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 20,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', margin: 0 }}>
              Статус:
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ width: 150 }}
            >
              <option value="all">Все статусы</option>
              {Object.entries(ALERT_STATUS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', margin: 0 }}>
              Критичность:
            </label>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              style={{ width: 160 }}
            >
              <option value="all">Все</option>
              {Object.entries(CASE_SEVERITY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            Найдено: {filteredAlerts.length}
          </span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spinner size={32} />
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 0',
              color: 'var(--text-secondary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔔</div>
            <p style={{ fontSize: 15, marginBottom: 8 }}>
              {alerts.length === 0 ? 'Алертов нет' : 'Нет алертов по заданному фильтру'}
            </p>
          </div>
        ) : (
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  {canWrite && (
                    <Th>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        disabled={selectableAlerts.length === 0}
                        style={{ cursor: 'pointer' }}
                      />
                    </Th>
                  )}
                  <Th>Номер</Th>
                  <Th>Заголовок</Th>
                  <Th>Источник</Th>
                  <Th>Критичность</Th>
                  <Th>Статус</Th>
                  <Th>Создан</Th>
                  {canWrite && <Th>Действия</Th>}
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((a, idx) => (
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
                          disabled={!isSelectable(a)}
                          onChange={() => toggleSelected(a.id)}
                          title={isSelectable(a) ? undefined : 'Алерт уже эскалирован в дело'}
                          style={{
                            cursor: isSelectable(a) ? 'pointer' : 'not-allowed',
                            opacity: isSelectable(a) ? 1 : 0.4,
                          }}
                        />
                      </Td>
                    )}
                    <Td>
                      <code
                        onClick={() => navigate(`/alerts/${a.id}`)}
                        style={{
                          fontSize: 12,
                          color: 'var(--accent)',
                          background: 'rgba(88,166,255,0.1)',
                          padding: '2px 6px',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        {a.id.slice(0, 8)}
                      </code>
                    </Td>
                    <Td>
                      <div
                        onClick={() => navigate(`/alerts/${a.id}`)}
                        style={{
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                          maxWidth: 400,
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          ;(e.currentTarget as HTMLDivElement).style.textDecoration = 'underline'
                        }}
                        onMouseLeave={(e) => {
                          ;(e.currentTarget as HTMLDivElement).style.textDecoration = 'none'
                        }}
                      >
                        {a.title}
                      </div>
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
                    {canWrite && (
                      <Td>
                        {a.status === 'escalated' ? (
                          a.case_id ? (
                            <button
                              onClick={() => navigate(`/cases/${a.case_id}`)}
                              style={linkBtnStyle}
                            >
                              Открыть дело
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                          )
                        ) : a.status === 'dismissed' ? (
                          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {a.status === 'new' && (
                              <button onClick={() => handleTriage(a)} style={linkBtnStyle}>
                                В работу
                              </button>
                            )}
                            <button
                              onClick={() => handleEscalate(a)}
                              style={linkBtnStyle}
                              disabled={escalatingId === a.id}
                            >
                              {escalatingId === a.id ? 'Эскалация…' : 'Эскалировать'}
                            </button>
                            <button
                              onClick={() => handleDismiss(a)}
                              style={{ ...linkBtnStyle, color: 'var(--danger)' }}
                            >
                              Отклонить
                            </button>
                          </div>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertModal isOpen={showModal} onClose={() => setShowModal(false)} onSave={handleSaveAlert} />
    </AppLayout>
  )
}

const linkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th
    style={{
      padding: '10px 16px',
      textAlign: 'left',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </th>
)

const Td: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
  <td
    style={{
      padding: '12px 16px',
      fontSize: 13,
      color: 'var(--text-primary)',
      verticalAlign: 'middle',
      ...style,
    }}
  >
    {children}
  </td>
)
