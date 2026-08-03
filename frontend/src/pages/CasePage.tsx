import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useCaseStore } from '../store/case'
import { useAuthStore } from '../store/auth'
import { useThemeStore } from '../store/theme'
import { useToastStore } from '../store/toast'
import { useTimelineWS } from '../hooks/useTimelineWS'
import { archiveCase, deleteCase, detachCase, unarchiveCase, updateCase } from '../api/cases'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { createEvent, updateEvent, getEvents } from '../api/events'
import { getBranchComments, createBranchComment, getBranches } from '../api/branches'
import { CommentList } from '../components/Comments/CommentList'
import { AppLayout } from '../components/Layout/AppLayout'
import { EventGraph } from '../components/Graph/EventGraph'
import { EventModal } from '../components/Events/EventModal'
import { EventDetail } from '../components/Events/EventDetail'
import { IOCPanel } from '../components/Cases/IOCPanel'
import { getIOCs } from '../api/iocs'
import { CaseReportPanel } from '../components/Cases/CaseReportPanel'
import { CaseAlertsPanel } from '../components/Alerts/CaseAlertsPanel'
import { AssignLeadDropdown } from '../components/Cases/AssignLeadDropdown'
import { AttachCaseModal } from '../components/Cases/AttachCaseModal'
import { AttachedIncidentsPanel } from '../components/Cases/AttachedIncidentsPanel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { SauronEyeIcon } from '../components/ui/SauronEyeIcon'
import { ElfLeafIcon } from '../components/ui/ElfLeafIcon'
import type { Event, CaseStatus, CaseSeverity, CreateEventData, IOC } from '../types'
import {
  CASE_SEVERITY_LABELS, EVENT_TYPE_LABELS, CONFIDENCE_LABELS,
  CASE_STATUS_LABELS, getCaseStatusLabel, getCaseStatusIconVariant,
} from '../types'

type ActiveTab = 'table' | 'graph' | 'iocs' | 'alerts' | 'incidents' | 'report'

const SEVERITY_COLOR: Record<CaseSeverity, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'green',
}

const STATUS_COLOR: Record<CaseStatus, string> = {
  open: 'blue',
  in_progress: 'yellow',
  confirmed: 'green',
  rejected: 'red',
}

const STATUS_BG: Record<CaseStatus, string> = {
  open: 'rgba(88,166,255,0.15)',
  in_progress: 'rgba(210,153,34,0.15)',
  confirmed: 'rgba(63,185,80,0.15)',
  rejected: 'rgba(248,81,73,0.15)',
}

const STATUS_TEXT: Record<CaseStatus, string> = {
  open: '#58a6ff',
  in_progress: '#d29922',
  confirmed: '#3fb950',
  rejected: '#f85149',
}

const STATUS_BORDER: Record<CaseStatus, string> = {
  open: 'rgba(88,166,255,0.4)',
  in_progress: 'rgba(210,153,34,0.4)',
  confirmed: 'rgba(63,185,80,0.4)',
  rejected: 'rgba(248,81,73,0.4)',
}

const CLASSIFICATION_COLOR: Record<string, string> = {
  '1': 'green',
  '2': 'yellow',
  '3': 'orange',
  '4': 'red',
}

export const CasePage: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const { user } = useAuthStore()
  const { theme } = useThemeStore()
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
    setCurrentCase,
    addEvent,
    updateEventInStore,
    removeEvent,
    clearCaseData,
  } = useCaseStore()

  const [activeTab, setActiveTab] = useState<ActiveTab>('report')
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [isAssigning, setIsAssigning] = useState(false)
  const [showAttachModal, setShowAttachModal] = useState(false)
  const [isDetaching, setIsDetaching] = useState<string | null>(null)
  const [attachedGraphData, setAttachedGraphData] = useState<
    { caseId: string; caseTitle: string; events: Event[] }[]
  >([])
  const rightPanelWidth = 320
  const [rightPanelOpen, setRightPanelOpen] = useState(false)

  const { connectedUsers } = useTimelineWS(caseId ?? '')

  useEffect(() => {
    if (!caseId) return
    clearCaseData()
    Promise.all([fetchCase(caseId), fetchBranches(caseId), fetchIOCs(caseId)]).catch(() => {
      toast.error('Ошибка загрузки данных инцидента')
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

  const attachedCaseIds = currentCase?.attached_cases?.map((c) => c.id).join(',') ?? ''

  // Pull in each attached (child) incident's main-branch events so they can
  // be shown alongside this incident's own graph — read-only, see
  // EventGraph's foreignEvents prop.
  useEffect(() => {
    const children = currentCase?.attached_cases ?? []
    if (children.length === 0) {
      setAttachedGraphData([])
      return
    }
    let cancelled = false
    Promise.all(
      children.map(async (c) => {
        try {
          const caseBranches = await getBranches(c.id)
          const mainBranch = caseBranches.find((b) => b.is_main) ?? caseBranches[0]
          if (!mainBranch) return { caseId: c.id, caseTitle: c.title, events: [] as Event[] }
          const childEvents = await getEvents(mainBranch.id)
          return { caseId: c.id, caseTitle: c.title, events: childEvents }
        } catch {
          return { caseId: c.id, caseTitle: c.title, events: [] as Event[] }
        }
      }),
    ).then((results) => {
      if (!cancelled) setAttachedGraphData(results)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedCaseIds])

  const foreignGraphEvents = useMemo(() => {
    const map: Record<string, { caseId: string; caseTitle: string }> = {}
    for (const g of attachedGraphData) {
      for (const e of g.events) {
        map[e.id] = { caseId: g.caseId, caseTitle: g.caseTitle }
      }
    }
    return map
  }, [attachedGraphData])

  const combinedGraphEvents = useMemo(
    () => [...events, ...attachedGraphData.flatMap((g) => g.events)],
    [events, attachedGraphData],
  )

  const [attachedIOCData, setAttachedIOCData] = useState<
    { caseId: string; caseTitle: string; iocs: IOC[] }[]
  >([])

  // Pull in each attached (child) incident's IOCs so they're visible on the
  // main incident's IOC tab too — same "Присоединён" pattern as alerts/graph.
  useEffect(() => {
    const children = currentCase?.attached_cases ?? []
    if (children.length === 0) {
      setAttachedIOCData([])
      return
    }
    let cancelled = false
    Promise.all(
      children.map(async (c) => {
        try {
          const childIOCs = await getIOCs(c.id)
          return { caseId: c.id, caseTitle: c.title, iocs: childIOCs }
        } catch {
          return { caseId: c.id, caseTitle: c.title, iocs: [] as IOC[] }
        }
      }),
    ).then((results) => {
      if (!cancelled) setAttachedIOCData(results)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedCaseIds])

  const foreignIOCs = useMemo(() => {
    const map: Record<string, { caseId: string; caseTitle: string }> = {}
    for (const g of attachedIOCData) {
      for (const ioc of g.iocs) {
        map[ioc.id] = { caseId: g.caseId, caseTitle: g.caseTitle }
      }
    }
    return map
  }, [attachedIOCData])

  const combinedIOCs = useMemo(
    () => [...iocs, ...attachedIOCData.flatMap((g) => g.iocs)],
    [iocs, attachedIOCData],
  )

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

  const handleStatusChange = async (status: CaseStatus) => {
    if (!currentCase) return
    try {
      const updated = await updateCase(currentCase.id, { status })
      setCurrentCase(updated)
      toast.success('Статус инцидента обновлён')
    } catch {
      toast.error('Ошибка обновления статуса')
    }
  }

  const handleAssignLead = async (userId: string) => {
    if (!currentCase) return
    setIsAssigning(true)
    try {
      const updated = await updateCase(currentCase.id, { ir_lead_id: userId })
      setCurrentCase(updated)
      toast.success('Ответственный инцидента назначен')
    } catch {
      toast.error('Ошибка назначения ответственного')
    } finally {
      setIsAssigning(false)
    }
  }

  const handleDetach = async (targetCaseId: string) => {
    if (!currentCase) return
    setIsDetaching(targetCaseId)
    try {
      await detachCase(targetCaseId)
      await fetchCase(currentCase.id)
      toast.success('Инцидент отсоединён')
    } catch {
      toast.error('Ошибка отсоединения инцидента')
    } finally {
      setIsDetaching(null)
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
      toast.success('Название инцидента обновлено')
    } catch {
      toast.error('Ошибка обновления названия')
    } finally {
      setIsEditingTitle(false)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    toast.success('Ссылка на инцидент скопирована в буфер обмена')
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

  const handleToggleArchive = async () => {
    if (!caseId || !currentCase) return
    setIsArchiving(true)
    try {
      const updated = currentCase.is_archived ? await unarchiveCase(caseId) : await archiveCase(caseId)
      setCurrentCase(updated)
      toast.success(currentCase.is_archived ? 'Инцидент возвращён из архива' : 'Инцидент отправлен в архив')
    } catch {
      toast.error('Ошибка изменения статуса архивации')
    } finally {
      setIsArchiving(false)
    }
  }

  const handleConfirmDelete = async (reason: string) => {
    if (!caseId) return
    setIsDeleting(true)
    try {
      await deleteCase(caseId, reason)
      toast.success('Инцидент удалён')
      navigate('/dashboard')
    } catch {
      toast.error('Ошибка удаления инцидента')
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
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
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>Инцидент не найден</p>
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
    user?.role === 'investigator'

  const isAttachedCase = !!currentCase.parent_case_id || (currentCase.attached_cases?.length ?? 0) > 0

  const statusIconVariant =
    theme === 'sauron' || theme === 'elves' ? getCaseStatusIconVariant(currentCase.status) : null
  const statusIcon = statusIconVariant
    ? theme === 'elves'
      ? <ElfLeafIcon variant={statusIconVariant} />
      : <SauronEyeIcon variant={statusIconVariant} />
    : null

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
            <span>Номер</span>
            <code
              onClick={handleCopyLink}
              title="Скопировать ссылку на инцидент"
              style={{ color: 'var(--accent)', cursor: 'pointer' }}
            >
              {currentCase.id.slice(0, 8)}
            </code>
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
                {canEdit ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {statusIcon}
                    <select
                      value={currentCase.status}
                      onChange={(e) => handleStatusChange(e.target.value as CaseStatus)}
                      style={{
                        width: 'auto',
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '1px 22px 1px 8px',
                        borderRadius: '20px',
                        border: `1px solid ${STATUS_BORDER[currentCase.status]}`,
                        background: STATUS_BG[currentCase.status],
                        color: STATUS_TEXT[currentCase.status],
                      }}
                    >
                      {Object.entries(CASE_STATUS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <Badge
                    color={STATUS_COLOR[currentCase.status] as 'blue'}
                    label={statusIconVariant ? '' : getCaseStatusLabel(currentCase.status, theme)}
                    size="sm"
                    icon={statusIcon ?? undefined}
                  />
                )}
                <Badge
                  color={SEVERITY_COLOR[currentCase.severity] as 'red'}
                  label={CASE_SEVERITY_LABELS[currentCase.severity]}
                  size="sm"
                />
                {!currentCase.confidentiality_label ? (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>—</span>
                ) : CLASSIFICATION_COLOR[currentCase.confidentiality_label] ? (
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
                {currentCase.is_archived && <Badge color="gray" label="В архиве" size="sm" />}
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
              {canEdit && (
                <AssignLeadDropdown
                  currentLeadName={currentCase.ir_lead?.full_name || currentCase.ir_lead?.username}
                  isLoading={isAssigning}
                  onAssign={handleAssignLead}
                />
              )}
              {canEdit && !currentCase.parent_case_id && (
                <Button variant="secondary" size="sm" onClick={() => setShowAttachModal(true)}>
                  Присоединить
                </Button>
              )}
              {canEdit && (
                <Button variant="secondary" size="sm" onClick={handleToggleArchive} isLoading={isArchiving}>
                  {currentCase.is_archived ? 'Разархивировать' : 'Архивировать'}
                </Button>
              )}
              {canEdit && currentCase.is_archived && (
                <Button variant="danger" size="sm" onClick={() => setShowDeleteDialog(true)}>
                  Удалить
                </Button>
              )}
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
                { key: 'report', label: 'Отчёт' },
                { key: 'table', label: 'Таймлайн' },
                { key: 'graph', label: 'Граф' },
                { key: 'iocs', label: `IOC (${iocs.length})` },
                { key: 'alerts', label: 'Алерты' },
                ...(isAttachedCase
                  ? [{ key: 'incidents' as ActiveTab, label: 'Инциденты' }]
                  : []),
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
          {/* Center content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'table' && (
              <EventTable
                events={combinedGraphEvents}
                onEventClick={handleEventClick}
                selectedEventId={selectedEvent?.id}
                foreignEvents={foreignGraphEvents}
                onForeignEventClick={(childCaseId) => navigate(`/cases/${childCaseId}`)}
              />
            )}

            {activeTab === 'graph' && currentBranch && (
              <EventGraph
                events={combinedGraphEvents}
                branchId={currentBranch.id}
                initialLayout={currentBranch.graph_layout}
                onEventClick={handleEventClick}
                selectedEventId={selectedEvent?.id}
                foreignEvents={foreignGraphEvents}
                onForeignEventClick={(childCaseId) => navigate(`/cases/${childCaseId}`)}
              />
            )}

            {activeTab === 'iocs' && (
              <IOCPanel
                iocs={combinedIOCs}
                caseId={currentCase.id}
                foreignIOCs={foreignIOCs}
                onForeignClick={(childCaseId) => navigate(`/cases/${childCaseId}`)}
              />
            )}

            {activeTab === 'alerts' && (
              <CaseAlertsPanel caseId={currentCase.id} attachedCases={currentCase.attached_cases} />
            )}

            {activeTab === 'incidents' && (
              <AttachedIncidentsPanel
                currentCase={currentCase}
                canEdit={canEdit}
                isDetaching={isDetaching}
                onNavigate={(id) => navigate(`/cases/${id}`)}
                onDetach={handleDetach}
              />
            )}

            {activeTab === 'report' && (
              <CaseReportPanel
                currentCase={currentCase}
                iocs={iocs}
                canEdit={canEdit}
                onUpdate={setCurrentCase}
              />
            )}
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
          {activeTab === 'table' && currentBranch && (
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

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        title="Удалить инцидент"
        message="Инцидент будет удалён безвозвратно. Это действие нельзя отменить."
        confirmLabel="Удалить"
        isDanger
        isLoading={isDeleting}
        requireReason
        reasonLabel="Причина удаления"
      />

      <AttachCaseModal
        isOpen={showAttachModal}
        onClose={() => setShowAttachModal(false)}
        currentCase={currentCase}
        onAttached={(updated) => {
          setCurrentCase(updated)
          toast.success('Инцидент присоединён')
        }}
      />
    </AppLayout>
  )
}

// Event table component
const EventTable: React.FC<{
  events: Event[]
  onEventClick: (e: Event) => void
  selectedEventId?: string
  foreignEvents?: Record<string, { caseId: string; caseTitle: string }>
  onForeignEventClick?: (caseId: string) => void
}> = ({ events, onEventClick, selectedEventId, foreignEvents = {}, onForeignEventClick }) => {
  const activeEvents = events.filter((e) => !e.is_deleted)
  const hasForeignEvents = Object.keys(foreignEvents).length > 0

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
            {hasForeignEvents && <Th>Присоединён</Th>}
          </tr>
        </thead>
        <tbody>
          {activeEvents.map((event, idx) => {
            const foreign = foreignEvents[event.id]
            return (
            <tr
              key={event.id}
              onClick={() => (foreign ? onForeignEventClick?.(foreign.caseId) : onEventClick(event))}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {event.mitre_technique && (
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
                  )}
                  {event.mitre_tactic && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{event.mitre_tactic}</span>
                  )}
                  {!event.mitre_technique && !event.mitre_tactic && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>—</span>
                  )}
                </div>
              </Td>
              <Td>
                {event.artifacts && event.artifacts.length > 0 ? (
                  <span style={{ fontSize: 12 }}>📎 {event.artifacts.length}</span>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>—</span>
                )}
              </Td>
              {hasForeignEvents && (
                <Td onClick={(e) => e.stopPropagation()}>
                  {foreign ? (
                    <button
                      onClick={() => onForeignEventClick?.(foreign.caseId)}
                      title="Перейти к присоединённому инциденту"
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: 'var(--accent)', fontSize: 12, textAlign: 'left',
                      }}
                    >
                      → {foreign.caseTitle}
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                  )}
                </Td>
              )}
            </tr>
            )
          })}
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

const Td: React.FC<{
  children?: React.ReactNode
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void
}> = ({
  children,
  style,
  onClick,
}) => (
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
