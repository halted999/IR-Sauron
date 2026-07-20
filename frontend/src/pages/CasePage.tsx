import React, { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useCaseStore } from '../store/case'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { useTimelineWS } from '../hooks/useTimelineWS'
import { exportCase, updateCase } from '../api/cases'
import { createEvent, updateEvent } from '../api/events'
import { getBranchComments, createBranchComment } from '../api/branches'
import { CommentList } from '../components/Comments/CommentList'
import { AppLayout } from '../components/Layout/AppLayout'
import { Timeline } from '../components/Timeline/Timeline'
import { EventModal } from '../components/Events/EventModal'
import { EventDetail } from '../components/Events/EventDetail'
import { BranchPanel } from '../components/Branches/BranchPanel'
import { IOCPanel } from '../components/Cases/IOCPanel'
import { CaseAlertsPanel } from '../components/Alerts/CaseAlertsPanel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import type { Event, CaseStatus, CaseSeverity, CreateEventData, VerificationStatus } from '../types'
import {
  CASE_STATUS_LABELS, CASE_SEVERITY_LABELS, EVENT_TYPE_LABELS, CONFIDENCE_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '../types'

type ActiveTab = 'timeline' | 'table' | 'iocs' | 'alerts'

const SEVERITY_COLOR: Record<CaseSeverity, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'green',
  informational: 'gray',
}

const STATUS_COLOR: Record<CaseStatus, string> = {
  open: 'blue',
  active: 'green',
  review: 'yellow',
  closed: 'gray',
}

const VERIFICATION_COLOR: Record<VerificationStatus, string> = {
  in_progress: 'yellow',
  confirmed: 'green',
  rejected: 'red',
}

const CLASSIFICATION_COLOR: Record<string, string> = {
  '1': 'green',
  '2': 'yellow',
  '3': 'orange',
  '4': 'red',
}

const VERIFICATION_BG: Record<VerificationStatus, string> = {
  in_progress: 'rgba(210,153,34,0.15)',
  confirmed: 'rgba(63,185,80,0.15)',
  rejected: 'rgba(248,81,73,0.15)',
}

const VERIFICATION_TEXT: Record<VerificationStatus, string> = {
  in_progress: '#d29922',
  confirmed: '#3fb950',
  rejected: '#f85149',
}

const VERIFICATION_BORDER: Record<VerificationStatus, string> = {
  in_progress: 'rgba(210,153,34,0.4)',
  confirmed: 'rgba(63,185,80,0.4)',
  rejected: 'rgba(248,81,73,0.4)',
}

export const CasePage: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const { user } = useAuthStore()
  const {
    currentCase,
    branches,
    currentBranch,
    events,
    iocs,
    isLoading,
    fetchCase,
    fetchBranches,
    fetchEvents,
    fetchIOCs,
    setCurrentBranch,
    setCurrentCase,
    addEvent,
    updateEventInStore,
    removeEvent,
    clearCaseData,
  } = useCaseStore()

  const [activeTab, setActiveTab] = useState<ActiveTab>('timeline')
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const rightPanelWidth = 320
  const [rightPanelOpen, setRightPanelOpen] = useState(false)

  const { connectedUsers } = useTimelineWS(caseId ?? '')

  useEffect(() => {
    if (!caseId) return
    clearCaseData()
    Promise.all([fetchCase(caseId), fetchBranches(caseId), fetchIOCs(caseId)]).catch(() => {
      toast.error('Ошибка загрузки данных дела')
    })

    return () => {
      clearCaseData()
    }
  }, [caseId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentBranch) {
      fetchEvents(currentBranch.id).catch(() => toast.error('Ошибка загрузки событий'))
    }
  }, [currentBranch?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleEventClick = useCallback((event: Event) => {
    setSelectedEvent(event)
    setRightPanelOpen(true)
  }, [])

  const handleAddEvent = () => {
    setEditingEvent(null)
    setShowEventModal(true)
  }

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event)
    setShowEventModal(true)
  }

  const handleDeleteEvent = (eventId: string) => {
    removeEvent(eventId)
    setSelectedEvent(null)
    setRightPanelOpen(false)
  }

  const handleVerificationChange = async (verification_status: VerificationStatus) => {
    if (!currentCase) return
    try {
      const updated = await updateCase(currentCase.id, { verification_status })
      setCurrentCase(updated)
      toast.success('Статус подтверждения обновлён')
    } catch {
      toast.error('Ошибка обновления статуса')
    }
  }

  const handleTitleStartEdit = () => {
    if (!currentCase) return
    setTitleDraft(currentCase.title)
    setIsEditingTitle(true)
  }

  const handleTitleSave = async () => {
    if (!currentCase) return
    const title = titleDraft.trim()
    if (!title || title === currentCase.title) {
      setIsEditingTitle(false)
      return
    }
    try {
      const updated = await updateCase(currentCase.id, { title })
      setCurrentCase(updated)
      toast.success('Название дела обновлено')
    } catch {
      toast.error('Ошибка обновления названия')
    } finally {
      setIsEditingTitle(false)
    }
  }

  const handleSaveEvent = async (data: CreateEventData) => {
    if (!currentBranch) {
      toast.error('Выберите ветку')
      throw new Error('No branch')
    }
    if (editingEvent) {
      const updated = await updateEvent(editingEvent.id, data)
      updateEventInStore(updated)
      if (selectedEvent?.id === updated.id) setSelectedEvent(updated)
      toast.success('Событие обновлено')
    } else {
      const branchId = data.branch_id ?? currentBranch.id
      const newEvent = await createEvent(branchId, data)
      addEvent(newEvent)
      toast.success('Событие добавлено')
    }
  }

  const handleExport = async () => {
    if (!caseId) return
    setIsExporting(true)
    try {
      const blob = await exportCase(caseId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `case-${caseId}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Экспорт завершён')
    } catch {
      toast.error('Ошибка экспорта')
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading && !currentCase) {
    return (
      <AppLayout>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px)',
          }}
        >
          <Spinner size={36} />
        </div>
      </AppLayout>
    )
  }

  if (!currentCase) {
    return (
      <AppLayout>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>Дело не найдено</p>
          <Button variant="secondary" onClick={() => navigate('/dashboard')}>
            Вернуться к списку
          </Button>
        </div>
      </AppLayout>
    )
  }

  const canEdit =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator' ||
    user?.role === 'threat_hunter'

  return (
    <AppLayout>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 56px)',
          overflow: 'hidden',
        }}
      >
        {/* Top panel */}
        <div
          style={{
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border)',
            padding: '10px 20px',
            flexShrink: 0,
          }}
        >
          {/* Breadcrumb */}
          <div
            style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Link to="/dashboard" style={{ color: 'var(--accent)' }}>
              Дела
            </Link>
            <span>/</span>
            <span>{currentCase.id.slice(0, 8)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Title + badges */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {isEditingTitle ? (
                  <input
                    type="text"
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      } else if (e.key === 'Escape') {
                        setIsEditingTitle(false)
                      }
                    }}
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      width: 'auto',
                      minWidth: 240,
                      maxWidth: 500,
                    }}
                  />
                ) : (
                  <h2
                    onClick={canEdit ? handleTitleStartEdit : undefined}
                    title={canEdit ? 'Нажмите, чтобы изменить название' : undefined}
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 500,
                      cursor: canEdit ? 'pointer' : 'default',
                    }}
                  >
                    {currentCase.title}
                  </h2>
                )}
                <Badge
                  color={STATUS_COLOR[currentCase.status] as 'blue'}
                  label={CASE_STATUS_LABELS[currentCase.status]}
                  size="sm"
                />
                <Badge
                  color={SEVERITY_COLOR[currentCase.severity] as 'red'}
                  label={CASE_SEVERITY_LABELS[currentCase.severity]}
                  size="sm"
                />
                {canEdit ? (
                  <select
                    value={currentCase.verification_status}
                    onChange={(e) =>
                      handleVerificationChange(e.target.value as VerificationStatus)
                    }
                    style={{
                      width: 'auto',
                      fontSize: 11,
                      fontWeight: 500,
                      padding: '1px 22px 1px 8px',
                      borderRadius: '20px',
                      border: `1px solid ${VERIFICATION_BORDER[currentCase.verification_status]}`,
                      background: VERIFICATION_BG[currentCase.verification_status],
                      color: VERIFICATION_TEXT[currentCase.verification_status],
                    }}
                  >
                    {Object.entries(VERIFICATION_STATUS_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge
                    color={VERIFICATION_COLOR[currentCase.verification_status] as 'green'}
                    label={VERIFICATION_STATUS_LABELS[currentCase.verification_status]}
                    size="sm"
                  />
                )}
                {CLASSIFICATION_COLOR[currentCase.confidentiality_label] ? (
                  <Badge
                    color={CLASSIFICATION_COLOR[currentCase.confidentiality_label] as 'green'}
                    label={currentCase.confidentiality_label}
                    size="sm"
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '1px 6px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {currentCase.confidentiality_label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                Открыто:{' '}
                {format(new Date(currentCase.created_at), 'dd.MM.yyyy HH:mm', {
                  locale: ru,
                })}
                {currentCase.external_ticket_id && (
                  <span style={{ marginLeft: 12 }}>
                    Тикет: <code>{currentCase.external_ticket_id}</code>
                  </span>
                )}
                {connectedUsers.length > 0 && (
                  <span style={{ marginLeft: 12, color: 'var(--success)' }}>
                    ● {connectedUsers.length} онлайн
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <Button variant="secondary" size="sm" onClick={handleExport} isLoading={isExporting}>
                Экспорт JSON
              </Button>
              {canEdit && (
                <Button variant="primary" size="sm" onClick={handleAddEvent}>
                  + Добавить факт
                </Button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginTop: 12 }}>
            {(
              [
                { key: 'timeline', label: 'Тайлайн' },
                { key: 'table', label: 'Таблица' },
                { key: 'iocs', label: `IOC (${iocs.length})` },
                { key: 'alerts', label: 'Алерты' },
              ] as { key: ActiveTab; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: `2px solid ${activeTab === key ? 'var(--accent)' : 'transparent'}`,
                  color: activeTab === key ? 'var(--accent)' : 'var(--text-secondary)',
                  padding: '6px 16px',
                  fontSize: 13,
                  fontWeight: activeTab === key ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left panel: branches */}
          <div style={{ width: 240, flexShrink: 0, overflow: 'hidden' }}>
            <BranchPanel
              branches={branches}
              currentBranch={currentBranch}
              caseId={currentCase.id}
              onBranchSelect={(b) => {
                setCurrentBranch(b)
                setSelectedEvent(null)
              }}
            />
          </div>

          {/* Center content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'timeline' && (
              <Timeline
                events={events}
                branches={branches}
                onEventClick={handleEventClick}
                selectedEventId={selectedEvent?.id}
              />
            )}

            {activeTab === 'table' && (
              <EventTable
                events={events}
                onEventClick={handleEventClick}
                selectedEventId={selectedEvent?.id}
              />
            )}

            {activeTab === 'iocs' && <IOCPanel iocs={iocs} caseId={currentCase.id} />}

            {activeTab === 'alerts' && <CaseAlertsPanel caseId={currentCase.id} />}
          </div>

          {/* Right panel: event detail */}
          {rightPanelOpen && selectedEvent && (
            <div
              style={{
                width: rightPanelWidth,
                flexShrink: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <EventDetail
                event={selectedEvent}
                iocs={iocs}
                onEdit={handleEditEvent}
                onDelete={handleDeleteEvent}
                onUpdate={(updated) => {
                  updateEventInStore(updated)
                  setSelectedEvent(updated)
                }}
                onClose={() => {
                  setRightPanelOpen(false)
                  setSelectedEvent(null)
                }}
              />
            </div>
          )}

          {/* Right panel: branch comments */}
          {(activeTab === 'timeline' || activeTab === 'table') && currentBranch && (
            <div
              style={{
                width: 280,
                flexShrink: 0,
                borderLeft: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  flexShrink: 0,
                }}
              >
                Комментарии
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                <CommentList
                  key={currentBranch.id}
                  fetchComments={() => getBranchComments(currentBranch.id)}
                  onCreateComment={(data) => createBranchComment(currentBranch.id, data)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Event modal */}
      <EventModal
        isOpen={showEventModal}
        onClose={() => {
          setShowEventModal(false)
          setEditingEvent(null)
        }}
        onSave={handleSaveEvent}
        branches={branches}
        defaultBranchId={currentBranch?.id}
        event={editingEvent}
      />
    </AppLayout>
  )
}

// Event table component
const EventTable: React.FC<{
  events: Event[]
  onEventClick: (e: Event) => void
  selectedEventId?: string
}> = ({ events, onEventClick, selectedEventId }) => {
  const activeEvents = events.filter((e) => !e.is_deleted)

  const EVENT_TYPE_COLOR: Record<string, string> = {
    attacker_action: 'red',
    detection: 'yellow',
    ir_action: 'green',
    inference: 'blue',
    legal_event: 'purple',
  }

  if (activeEvents.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          color: 'var(--text-secondary)',
          fontSize: 14,
        }}
      >
        Нет событий. Добавьте первое событие.
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 0' }}>
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
            <Th>Дата/время UTC</Th>
            <Th>Тип</Th>
            <Th>Заголовок</Th>
            <Th>Достоверность</Th>
            <Th>MITRE</Th>
            <Th>Артефакты</Th>
          </tr>
        </thead>
        <tbody>
          {activeEvents.map((event, idx) => (
            <tr
              key={event.id}
              onClick={() => onEventClick(event)}
              style={{
                borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
                background:
                  event.id === selectedEventId ? 'var(--bg-tertiary)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => {
                if (event.id !== selectedEventId) {
                  ;(e.currentTarget as HTMLTableRowElement).style.background = 'rgba(33,38,45,0.6)'
                }
              }}
              onMouseLeave={(e) => {
                if (event.id !== selectedEventId) {
                  ;(e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                }
              }}
            >
              <Td style={{ whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'monospace' }}>
                {format(new Date(event.event_ts), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}
              </Td>
              <Td>
                <Badge
                  color={(EVENT_TYPE_COLOR[event.event_type] ?? 'gray') as 'red'}
                  label={EVENT_TYPE_LABELS[event.event_type]}
                  size="sm"
                />
              </Td>
              <Td>
                <div style={{ fontWeight: 500 }}>{event.title}</div>
                {event.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 320,
                    }}
                  >
                    {event.description}
                  </div>
                )}
              </Td>
              <Td>
                <Badge
                  color={
                    event.confidence_level === 'confirmed'
                      ? 'green'
                      : event.confidence_level === 'corroborated'
                        ? 'yellow'
                        : 'gray'
                  }
                  label={CONFIDENCE_LABELS[event.confidence_level]}
                  size="sm"
                />
              </Td>
              <Td>
                {event.mitre_technique ? (
                  <code
                    style={{
                      fontSize: 11,
                      background: 'rgba(88,166,255,0.1)',
                      color: '#58a6ff',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}
                  >
                    {event.mitre_technique}
                    {event.mitre_subtechnique ? `.${event.mitre_subtechnique}` : ''}
                  </code>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>—</span>
                )}
              </Td>
              <Td>
                {event.artifacts && event.artifacts.length > 0 ? (
                  <span style={{ fontSize: 12 }}>📎 {event.artifacts.length}</span>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Th: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
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
      ...style,
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
