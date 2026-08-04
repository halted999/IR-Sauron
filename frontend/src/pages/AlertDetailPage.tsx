import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { getAlert, updateAlert, escalateAlert, assignAlertsBulk, detachAlert } from '../api/alerts'
import { getAssignableUsers } from '../api/users'
import type { AssignableUser } from '../api/users'
import { useAlertStore } from '../store/alert'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { AppLayout } from '../components/Layout/AppLayout'
import { AssignUserModal } from '../components/Alerts/AssignUserModal'
import { AlertRuleFormModal } from '../components/Alerts/AlertRuleFormModal'
import { AttachAlertsToCaseModal } from '../components/Alerts/AttachAlertsToCaseModal'
import { SimilarAlertsPanel } from '../components/Alerts/SimilarAlertsPanel'
import { AnalyzeDropdownButton } from '../components/Analysis/AnalyzeDropdownButton'
import type { AlertRuleFromSelectionResult } from '../api/alertRules'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import type { Alert, AlertStatus, Case, CaseSeverity } from '../types'
import { ALERT_STATUS_LABELS, CASE_SEVERITY_LABELS } from '../types'

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

// log.level severity scale, anchored exactly as requested: informational is
// pure green, critical is pure red. Anything milder than informational
// (trace/debug) is grouped into the same green rung, and anything worse than
// critical (alert/emergency) into the same red rung, rather than stretching
// the gradient past those two anchors.
const LOG_LEVEL_SCALE: string[][] = [
  ['trace', 'debug', 'informational', 'information', 'info'],
  ['notice'],
  ['warning', 'warn'],
  ['error', 'err'],
  ['critical', 'crit', 'alert', 'emergency', 'emerg', 'fatal'],
]
const LOG_LEVEL_GRADIENT: [number, [number, number, number]][] = [
  [0, [63, 185, 80]], // green
  [0.5, [210, 153, 34]], // yellow
  [1, [248, 81, 73]], // red
]

function logLevelColor(rawValue: string): [number, number, number] | null {
  const normalized = rawValue.trim().toLowerCase()
  const rung = LOG_LEVEL_SCALE.findIndex((names) => names.includes(normalized))
  if (rung === -1) return null
  const t = rung / (LOG_LEVEL_SCALE.length - 1)

  let [t0, c0] = LOG_LEVEL_GRADIENT[0]
  let [t1, c1] = LOG_LEVEL_GRADIENT[LOG_LEVEL_GRADIENT.length - 1]
  for (let i = 0; i < LOG_LEVEL_GRADIENT.length - 1; i++) {
    if (t >= LOG_LEVEL_GRADIENT[i][0] && t <= LOG_LEVEL_GRADIENT[i + 1][0]) {
      ;[t0, c0] = LOG_LEVEL_GRADIENT[i]
      ;[t1, c1] = LOG_LEVEL_GRADIENT[i + 1]
      break
    }
  }
  const localT = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * localT),
    Math.round(c0[1] + (c1[1] - c0[1]) * localT),
    Math.round(c0[2] + (c1[2] - c0[2]) * localT),
  ]
}

const LogLevelValue: React.FC<{ value: string }> = ({ value }) => {
  const rgb = logLevelColor(value)
  if (!rgb) return <>{value}</>
  const [r, g, b] = rgb
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: `rgba(${r}, ${g}, ${b}, 0.15)`,
        color: `rgb(${r}, ${g}, ${b})`,
        border: `1px solid rgba(${r}, ${g}, ${b}, 0.4)`,
      }}
    >
      {value}
    </span>
  )
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
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [showAttachModal, setShowAttachModal] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [isSavingTags, setIsSavingTags] = useState(false)

  useEffect(() => {
    if (!alertId) return
    setIsLoading(true)
    getAlert(alertId)
      .then(setAlert)
      .catch(() => toast.error('Ошибка загрузки алерта'))
      .finally(() => setIsLoading(false))
  }, [alertId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getAssignableUsers()
      .then(setAssignableUsers)
      .catch(() => setAssignableUsers([]))
  }, [])

  const assigneeLabel = (userId?: string): string => {
    if (!userId) return '—'
    const u = assignableUsers.find((au) => au.id === userId)
    return u ? u.full_name || u.username : '—'
  }

  const canWrite =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator'

  const applyUpdate = (updated: Alert) => {
    setAlert(updated)
    updateAlertInStore(updated)
  }

  const handleAddTag = async () => {
    const value = tagInput.trim()
    if (!alert || !value || alert.tags.includes(value)) {
      setTagInput('')
      return
    }
    setIsSavingTags(true)
    try {
      const updated = await updateAlert(alert.id, { tags: [...alert.tags, value] })
      applyUpdate(updated)
      setTagInput('')
    } catch {
      toast.error('Ошибка добавления тега')
    } finally {
      setIsSavingTags(false)
    }
  }

  const handleRemoveTag = async (tag: string) => {
    if (!alert) return
    setIsSavingTags(true)
    try {
      const updated = await updateAlert(alert.id, { tags: alert.tags.filter((t) => t !== tag) })
      applyUpdate(updated)
    } catch {
      toast.error('Ошибка удаления тега')
    } finally {
      setIsSavingTags(false)
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
    if (!confirm(`Эскалировать алерт "${alert.title}" в новый инцидент?`)) return
    setIsActing(true)
    try {
      const newCase = await escalateAlert(alert.id, {})
      applyUpdate({ ...alert, status: 'escalated', case_id: newCase.id })
      toast.success(`Инцидент «${newCase.title}» создан из алерта`)
      navigate(`/cases/${newCase.id}`)
    } catch {
      toast.error('Ошибка эскалации алерта')
    } finally {
      setIsActing(false)
    }
  }

  const handleAttached = (updatedCase: Case) => {
    if (!alert) return
    applyUpdate({ ...alert, status: 'escalated', case_id: updatedCase.id })
    toast.success(`Присоединено к инциденту «${updatedCase.title}»`)
    setShowAttachModal(false)
    navigate(`/cases/${updatedCase.id}`)
  }

  const handleDetach = async () => {
    if (!alert) return
    if (!confirm(`Отсоединить алерт "${alert.title}" от инцидента?`)) return
    setIsActing(true)
    try {
      const updated = await detachAlert(alert.id)
      applyUpdate(updated)
      toast.success('Алерт отсоединён от инцидента')
    } catch {
      toast.error('Ошибка отсоединения алерта')
    } finally {
      setIsActing(false)
    }
  }

  const handleAssign = async (userId: string) => {
    if (!alert) return
    setIsAssigning(true)
    try {
      const [updated] = await assignAlertsBulk([alert.id], userId)
      applyUpdate(updated)
      toast.success('Алерт назначен')
      setShowAssignModal(false)
    } catch {
      toast.error('Ошибка назначения')
    } finally {
      setIsAssigning(false)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    toast.success('Ссылка на алерт скопирована в буфер обмена')
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

  // ECS event.type (e.g. "creation", "start", "access") when present, else
  // fall back to a plain top-level "type" field — many of this app's real
  // source documents (DNS/AD/Citrix/etc. logs) aren't strictly ECS-shaped
  // and use a flat "type" instead of "event.type". Shown alongside the
  // source index.
  const eventType = alert.description_table?.find((row) => row.key === 'event.type')?.value
    ?? alert.description_table?.find((row) => row.key === 'type')?.value

  return (
    <AppLayout>
      <div
        style={{
          padding: '24px 32px',
          maxWidth: 1300,
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
      <div style={{ flex: '1 1 600px', maxWidth: 900, minWidth: 0 }}>
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
          <span>Номер</span>
          <code
            onClick={handleCopyLink}
            title="Скопировать ссылку на алерт"
            style={{
              fontSize: 12,
              color: 'var(--accent)',
              background: 'rgba(88,166,255,0.1)',
              padding: '1px 6px',
              borderRadius: 4,
              cursor: 'pointer',
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
              <Badge color="purple" label={alert.threat_type} size="sm" />
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

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <AnalyzeDropdownButton
              ips={[...alert.parsed_internal_ips, ...alert.parsed_external_ips]}
              accounts={alert.parsed_accounts}
              files={alert.parsed_files}
            />
            {canWrite && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setShowAssignModal(true)}>
                  Назначить
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowRuleModal(true)}>
                  В правило
                </Button>
                {alert.status === 'escalated' ? (
                  alert.case_id && (
                    <>
                      <Button variant="primary" size="sm" onClick={() => navigate(`/cases/${alert.case_id}`)}>
                        Открыть инцидент
                      </Button>
                      <Button variant="secondary" size="sm" onClick={handleDetach} isLoading={isActing}>
                        Отсоединить
                      </Button>
                    </>
                  )
                ) : alert.status === 'dismissed' || alert.status === 'archived' ? null : (
                  <>
                    <Button variant="primary" size="sm" onClick={handleEscalate} isLoading={isActing}>
                      Эскалировать
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setShowAttachModal(true)}>
                      Присоединить
                    </Button>
                    <Button variant="danger" size="sm" onClick={handleDismiss} isLoading={isActing}>
                      Отклонить
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
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
          <Field label="Индекс">
            {alert.source_index ? (
              <code
                style={{
                  fontSize: 12,
                  background: 'var(--bg-tertiary)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                }}
              >
                {alert.source_index}
              </code>
            ) : (
              '—'
            )}
            {eventType && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                Type:{' '}
                <code
                  style={{
                    fontSize: 12,
                    background: 'var(--bg-tertiary)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                  }}
                >
                  {eventType}
                </code>
              </div>
            )}
          </Field>
          <Field label="Назначен">{assigneeLabel(alert.assigned_to)}</Field>
          <Field label="URL">
            {alert.parsed_urls.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {alert.parsed_urls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)', wordBreak: 'break-all', fontSize: 13 }}
                  >
                    {url}
                  </a>
                ))}
              </div>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Внешние IP-адреса">
            {alert.parsed_external_ips.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {alert.parsed_external_ips.map((ip) => (
                  <Badge key={ip} color="red" label={ip} size="sm" />
                ))}
              </div>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Внутренние IP-адреса">
            {alert.parsed_internal_ips.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {alert.parsed_internal_ips.map((ip) => (
                  <Badge key={ip} color="blue" label={ip} size="sm" />
                ))}
              </div>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Учётные записи">
            {alert.parsed_accounts.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {alert.parsed_accounts.map((account) => (
                  <Badge key={account} color="purple" label={account} size="sm" />
                ))}
              </div>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Файлы">
            {alert.parsed_files.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {alert.parsed_files.map((file) => (
                  <Badge key={file} color="teal" label={file} size="sm" />
                ))}
              </div>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Тэги">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {alert.tags.length > 0 ? (
                alert.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 4px 2px 10px',
                      borderRadius: 12,
                      fontSize: 12,
                      background: 'rgba(88,166,255,0.15)',
                      color: 'var(--accent)',
                      border: '1px solid rgba(88,166,255,0.4)',
                    }}
                  >
                    {tag}
                    {canWrite && (
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        disabled={isSavingTags}
                        title="Удалить тег"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          fontSize: 13,
                          lineHeight: 1,
                          padding: '2px 4px',
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>—</span>
              )}
            </div>
            {canWrite && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddTag()
                    }
                  }}
                  placeholder="Новый тег"
                  disabled={isSavingTags}
                  style={{ maxWidth: 220, fontSize: 13 }}
                />
                <Button variant="secondary" size="sm" onClick={handleAddTag} isLoading={isSavingTags}>
                  Добавить
                </Button>
              </div>
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
                Инцидент
              </span>
              <Link to={`/cases/${alert.case_id}`} style={{ color: '#d29922', fontSize: 14 }}>
                {alert.case_id.slice(0, 8)}
              </Link>
            </div>
          )}
          <Field label="Описание">
            {alert.description_table && alert.description_table.length > 0 ? (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  maxHeight: 420,
                  overflowY: 'auto',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-tertiary)' }}>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '6px 10px',
                          color: 'var(--text-secondary)',
                          fontWeight: 500,
                          borderBottom: '1px solid var(--border)',
                          width: '38%',
                        }}
                      >
                        Поле
                      </th>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '6px 10px',
                          color: 'var(--text-secondary)',
                          fontWeight: 500,
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        Значение
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {alert.description_table.map((row) => (
                      <tr key={row.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td
                          style={{
                            padding: '5px 10px',
                            color: 'var(--text-secondary)',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                            fontSize: 11.5,
                            wordBreak: 'break-word',
                            verticalAlign: 'top',
                          }}
                        >
                          {row.key}
                        </td>
                        <td style={{ padding: '5px 10px', wordBreak: 'break-word', verticalAlign: 'top' }}>
                          {row.key.toLowerCase() === 'log.level' ? (
                            <LogLevelValue value={row.value} />
                          ) : (
                            row.value
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : alert.description ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{alert.description}</span>
            ) : (
              '—'
            )}
          </Field>
        </div>
      </div>

        <div style={{ flex: '1 1 320px', maxWidth: 380, minWidth: 280 }}>
          <SimilarAlertsPanel alertId={alert.id} />
        </div>
      </div>

      <AssignUserModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        onAssign={handleAssign}
        isLoading={isAssigning}
      />

      <AttachAlertsToCaseModal
        isOpen={showAttachModal}
        onClose={() => setShowAttachModal(false)}
        alertIds={alert ? [alert.id] : []}
        onAttached={handleAttached}
      />

      <AlertRuleFormModal
        isOpen={showRuleModal}
        onClose={() => setShowRuleModal(false)}
        selectedAlerts={alert ? [alert] : []}
        onSaved={(result: AlertRuleFromSelectionResult | undefined) => {
          toast.success(
            result ? `Правило создано, применено к ${result.applied_count} алертам` : 'Правило создано',
          )
          if (alertId) {
            getAlert(alertId).then(applyUpdate).catch(() => undefined)
          }
        }}
      />
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
