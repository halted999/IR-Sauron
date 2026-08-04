import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useAlertStore } from '../store/alert'
import { useToastStore } from '../store/toast'
import { useAuthStore } from '../store/auth'
import {
  createAlert, updateAlert, escalateAlert, escalateAlertsBulk,
  deleteAlertsBulk, restoreAlertsBulk, purgeAlertsBulk, assignAlertsBulk,
} from '../api/alerts'
import { getAssignableUsers } from '../api/users'
import type { AssignableUser } from '../api/users'
import { AppLayout } from '../components/Layout/AppLayout'
import { AlertModal } from '../components/Alerts/AlertModal'
import { AlertRulesModal } from '../components/Alerts/AlertRulesModal'
import { AlertRuleFormModal } from '../components/Alerts/AlertRuleFormModal'
import { ProcessAlertsModal } from '../components/Alerts/ProcessAlertsModal'
import { AttachAlertsToCaseModal } from '../components/Alerts/AttachAlertsToCaseModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Pagination } from '../components/ui/Pagination'
import { MultiSelectDropdown } from '../components/ui/MultiSelectDropdown'
import type { AlertsParams } from '../api/alerts'
import type { Alert, AlertStatus, Case, CaseSeverity, CreateAlertData } from '../types'
import { ALERT_STATUS_LABELS, CASE_SEVERITY_LABELS } from '../types'
import { compileKqlQuery } from '../utils/kql'

const STATUS_OPTIONS = (Object.entries(ALERT_STATUS_LABELS) as [AlertStatus, string][]).map(
  ([value, label]) => ({ value, label }),
)

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

export const AlertsPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toast = useToastStore()
  const { alerts, total, isLoading, fetchAlerts, addAlert, updateAlertInStore, removeAlertsFromStore } = useAlertStore()

  // Filters/pagination/search live in the URL (not just component state) so
  // they survive navigating away (e.g. opening an alert) and back, and page
  // reloads/bookmarks — not just clicks within this page.
  const [searchParams, setSearchParams] = useSearchParams()
  const updateSearchParams = (patch: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      return next
    })
  }

  const [filterStatuses, setFilterStatusesState] = useState<Set<AlertStatus>>(
    () => new Set((searchParams.get('status')?.split(',').filter(Boolean) ?? []) as AlertStatus[]),
  )
  const [filterSeverity, setFilterSeverityState] = useState<string>(() => searchParams.get('severity') ?? 'all')
  const [page, setPageState] = useState(() => Number(searchParams.get('page')) || 1)
  const [pageSize, setPageSizeState] = useState(() => Number(searchParams.get('pageSize')) || 50)
  const [showArchive, setShowArchiveState] = useState(() => searchParams.get('archive') === '1')
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '')
  const [showModal, setShowModal] = useState(false)
  const [escalatingId, setEscalatingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkEscalating, setIsBulkEscalating] = useState(false)
  const [showRulesModal, setShowRulesModal] = useState(false)
  const [showRuleFromSelection, setShowRuleFromSelection] = useState(false)
  const [deletingIds, setDeletingIds] = useState<string[] | null>(null)
  const [purgingIds, setPurgingIds] = useState<string[] | null>(null)
  const [isBulkBusy, setIsBulkBusy] = useState(false)
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])

  // Remembers the current filters/pagination so the "Алерты" nav link (see
  // AppLayout) can return here with them intact instead of resetting to a
  // bare /alerts — the URL alone doesn't help once you've navigated away to
  // a different route (e.g. an alert's own page) and click the nav link
  // rather than the browser's back button.
  useEffect(() => {
    const qs = searchParams.toString()
    sessionStorage.setItem('irsauron:nav:alerts', qs ? `/alerts?${qs}` : '/alerts')
  }, [searchParams])
  const [showProcessModal, setShowProcessModal] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [showAttachModal, setShowAttachModal] = useState(false)

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

  const buildParams = (): AlertsParams => {
    const params: AlertsParams = {
      deleted: showArchive,
      skip: (page - 1) * pageSize,
      limit: pageSize,
    }
    if (filterStatuses.size > 0) params.status = [...filterStatuses]
    if (filterSeverity !== 'all') params.severity = filterSeverity as CaseSeverity
    if (debouncedQuery.trim()) params.q = debouncedQuery.trim()
    return params
  }

  // Debounced so the search box doesn't fire a request on every keystroke —
  // the query is matched server-side (title/description/id) against the full
  // table, not just the currently-loaded page, so results beyond page 1 are
  // still found.
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchParams.get('q') ?? '')
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery)
      setPageState(1)
      updateSearchParams({ q: searchQuery.trim() || null, page: null })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  useEffect(() => {
    fetchAlerts(buildParams()).catch(() => toast.error('Ошибка загрузки алертов'))
    setSelectedIds(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatuses, filterSeverity, showArchive, page, pageSize, debouncedQuery])

  const setPage = (p: number) => {
    setPageState(p)
    updateSearchParams({ page: p > 1 ? String(p) : null })
  }

  const handleFilterStatusesChange = (next: Set<string>) => {
    setFilterStatusesState(next as Set<AlertStatus>)
    setPageState(1)
    updateSearchParams({ status: next.size > 0 ? [...next].join(',') : null, page: null })
  }

  const handleFilterSeverityChange = (v: string) => {
    setFilterSeverityState(v)
    setPageState(1)
    updateSearchParams({ severity: v === 'all' ? null : v, page: null })
  }

  const handleToggleArchive = () => {
    const next = !showArchive
    setShowArchiveState(next)
    setPageState(1)
    updateSearchParams({ archive: next ? '1' : null, page: null })
  }

  const handlePageSizeChange = (size: number) => {
    setPageSizeState(size)
    setPageState(1)
    updateSearchParams({ pageSize: size !== 50 ? String(size) : null, page: null })
  }

  const canWrite =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator'

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

  const handleBulkDismiss = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Отклонить ${selectedIds.size} выбранных алертов?`)) return
    setIsBulkBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const updated = await Promise.all(ids.map((id) => updateAlert(id, { status: 'dismissed' })))
      updated.forEach((a) => updateAlertInStore(a))
      toast.success(`Отклонено алертов: ${updated.length}`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Ошибка отклонения алертов')
    } finally {
      setIsBulkBusy(false)
    }
  }

  const handleEscalate = async (alert: Alert) => {
    if (!confirm(`Эскалировать алерт "${alert.title}" в новый инцидент?`)) return
    setEscalatingId(alert.id)
    try {
      const newCase = await escalateAlert(alert.id, {})
      updateAlertInStore({ ...alert, status: 'escalated', case_id: newCase.id })
      toast.success(`Инцидент «${newCase.title}» создан из алерта`)
      navigate(`/cases/${newCase.id}`)
    } catch {
      toast.error('Ошибка эскалации алерта')
    } finally {
      setEscalatingId(null)
    }
  }

  // Client-side parse is only used to surface a syntax error inline while
  // typing — actual matching now happens server-side (see buildParams/q),
  // against the full table rather than just the currently-loaded page.
  const searchKql = useMemo(() => compileKqlQuery(searchQuery), [searchQuery])

  const filteredAlerts = alerts

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
    setSelectedIds(allSelected ? new Set() : new Set(selectableAlerts.map((a) => a.id)))
  }

  const handleBulkEscalate = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Создать один инцидент из ${selectedIds.size} выбранных алертов?`)) return
    setIsBulkEscalating(true)
    try {
      const newCase = await escalateAlertsBulk({ alert_ids: Array.from(selectedIds) })
      alerts
        .filter((a) => selectedIds.has(a.id))
        .forEach((a) => updateAlertInStore({ ...a, status: 'escalated', case_id: newCase.id }))
      toast.success(`Инцидент «${newCase.title}» создан из ${selectedIds.size} алертов`)
      setSelectedIds(new Set())
      navigate(`/cases/${newCase.id}`)
    } catch {
      toast.error('Ошибка создания инцидента из алертов')
    } finally {
      setIsBulkEscalating(false)
    }
  }

  const handleAttached = (updatedCase: Case) => {
    alerts
      .filter((a) => selectedIds.has(a.id))
      .forEach((a) => updateAlertInStore({ ...a, status: 'escalated', case_id: updatedCase.id }))
    toast.success(`Присоединено к инциденту «${updatedCase.title}»: ${selectedIds.size} алертов`)
    setSelectedIds(new Set())
    setShowAttachModal(false)
    navigate(`/cases/${updatedCase.id}`)
  }

  const handleConfirmDelete = async (reason: string) => {
    if (!deletingIds || deletingIds.length === 0) return
    setIsBulkBusy(true)
    try {
      await deleteAlertsBulk(deletingIds, reason)
      removeAlertsFromStore(deletingIds)
      toast.success(`Удалено алертов: ${deletingIds.length}`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Ошибка удаления алертов')
    } finally {
      setIsBulkBusy(false)
      setDeletingIds(null)
    }
  }

  const handleBulkRestore = async () => {
    if (selectedIds.size === 0) return
    setIsBulkBusy(true)
    try {
      const ids = Array.from(selectedIds)
      await restoreAlertsBulk(ids)
      removeAlertsFromStore(ids)
      toast.success(`Восстановлено алертов: ${ids.length}`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Ошибка восстановления алертов')
    } finally {
      setIsBulkBusy(false)
    }
  }

  const handleConfirmPurge = async () => {
    if (!purgingIds || purgingIds.length === 0) return
    setIsBulkBusy(true)
    try {
      await purgeAlertsBulk(purgingIds)
      removeAlertsFromStore(purgingIds)
      toast.success(`Удалено навсегда: ${purgingIds.length}`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Ошибка окончательного удаления')
    } finally {
      setIsBulkBusy(false)
      setPurgingIds(null)
    }
  }

  const handleAssign = async (userId: string) => {
    if (selectedIds.size === 0) return
    setIsAssigning(true)
    try {
      const ids = Array.from(selectedIds)
      const updated = await assignAlertsBulk(ids, userId)
      updated.forEach((a) => updateAlertInStore(a))
      toast.success(`Назначено алертов: ${updated.length}`)
      setSelectedIds(new Set())
      setShowProcessModal(false)
    } catch {
      toast.error('Ошибка назначения')
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px', width: '100%' }}>
        {/* Sticky control area: page header + filters stay together under the app nav bar */}
        <div
          style={{
            position: 'sticky',
            top: 56,
            zIndex: 90,
            background: 'var(--bg-primary)',
            paddingTop: 24,
            marginTop: -24,
            paddingBottom: 20,
            borderBottom: '1px solid var(--border)',
          }}
        >
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
          </div>
          {canWrite && (
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedIds.size > 0 && !showArchive && (
                <>
                  <Button variant="primary" onClick={handleBulkEscalate} isLoading={isBulkEscalating}>
                    Создать инцидент ({selectedIds.size})
                  </Button>
                  <Button variant="secondary" onClick={() => setShowProcessModal(true)}>
                    Обработать ({selectedIds.size})
                  </Button>
                </>
              )}
              {selectedIds.size > 0 && showArchive && (
                <>
                  <Button variant="primary" onClick={handleBulkRestore} isLoading={isBulkBusy}>
                    Восстановить ({selectedIds.size})
                  </Button>
                  {user?.role === 'admin' && (
                    <Button
                      variant="danger"
                      onClick={() => setPurgingIds(Array.from(selectedIds))}
                      isLoading={isBulkBusy}
                    >
                      Удалить навсегда ({selectedIds.size})
                    </Button>
                  )}
                </>
              )}
              {!showArchive && (
                <>
                  <Button variant="secondary" onClick={() => setShowRuleFromSelection(true)}>
                    + Правило
                  </Button>
                  <Button variant="primary" onClick={() => setShowModal(true)}>
                    + Добавить алерт
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Поиск (KQL) по названию и описанию…'
            style={{ width: '100%' }}
          />
          {searchKql.error && (
            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
              Ошибка в запросе: {searchKql.error}
            </div>
          )}
        </div>

        {/* Filters */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', margin: 0 }}>
              Статус:
            </label>
            <MultiSelectDropdown
              options={STATUS_OPTIONS}
              selected={filterStatuses}
              onChange={handleFilterStatusesChange}
              placeholder="Все статусы"
              width={170}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', margin: 0 }}>
              Критичность:
            </label>
            <select
              value={filterSeverity}
              onChange={(e) => handleFilterSeverityChange(e.target.value)}
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
          {canWrite && (
            <Button variant="secondary" size="sm" onClick={() => setShowRulesModal(true)}>
              Правила алертов
            </Button>
          )}
          <button
            onClick={handleToggleArchive}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {showArchive ? '← К активным алертам' : 'Архив удалённых'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            Найдено: {filteredAlerts.length}
          </span>
        </div>
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
                  <Th>Назначено</Th>
                  <Th>Тэги</Th>
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
                          title={isSelectable(a) ? undefined : 'Алерт уже эскалирован в инцидент'}
                          style={{
                            cursor: isSelectable(a) ? 'pointer' : 'not-allowed',
                            opacity: isSelectable(a) ? 1 : 0.4,
                          }}
                        />
                      </Td>
                    )}
                    <Td>
                      <Link
                        to={`/alerts/${a.id}`}
                        style={{
                          fontSize: 12,
                          fontFamily: 'monospace',
                          color: 'var(--accent)',
                          background: 'rgba(88,166,255,0.1)',
                          padding: '2px 6px',
                          borderRadius: 4,
                          textDecoration: 'none',
                        }}
                      >
                        {a.id.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        to={`/alerts/${a.id}`}
                        style={{
                          display: 'block',
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                          maxWidth: 400,
                          textDecoration: 'none',
                        }}
                        onMouseEnter={(e) => {
                          ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline'
                        }}
                        onMouseLeave={(e) => {
                          ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none'
                        }}
                      >
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
                    <Td style={{ fontSize: 12, color: a.assigned_to ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {assigneeLabel(a.assigned_to)}
                    </Td>
                    <Td>
                      {a.tags.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 180 }}>
                          {a.tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: 11,
                                padding: '1px 8px',
                                borderRadius: 10,
                                background: 'rgba(88,166,255,0.15)',
                                color: 'var(--accent)',
                                border: '1px solid rgba(88,166,255,0.4)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                      )}
                    </Td>
                    <Td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {format(new Date(a.created_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
                    </Td>
                    {canWrite && (
                      <Td>
                        {a.is_deleted ? (
                          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                            Удалён {a.deleted_at ? format(new Date(a.deleted_at), 'dd.MM.yyyy HH:mm', { locale: ru }) : ''}
                          </span>
                        ) : a.status === 'escalated' ? (
                          a.case_id ? (
                            <Link to={`/cases/${a.case_id}`} style={{ ...linkBtnStyle, textDecoration: 'none' }}>
                              Открыть инцидент
                            </Link>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                          )
                        ) : a.status === 'dismissed' || a.status === 'archived' ? (
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

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>

      <AlertModal isOpen={showModal} onClose={() => setShowModal(false)} onSave={handleSaveAlert} />

      <AlertRulesModal isOpen={showRulesModal} onClose={() => setShowRulesModal(false)} />

      <AlertRuleFormModal
        isOpen={showRuleFromSelection}
        onClose={() => setShowRuleFromSelection(false)}
        selectedAlerts={alerts.filter((a) => selectedIds.has(a.id))}
        onSaved={(result) => {
          toast.success(
            result ? `Правило создано, применено к ${result.applied_count} алертам` : 'Правило создано',
          )
          setSelectedIds(new Set())
          fetchAlerts(buildParams()).catch(() => undefined)
        }}
      />

      <ProcessAlertsModal
        isOpen={showProcessModal}
        onClose={() => setShowProcessModal(false)}
        count={selectedIds.size}
        assignableUsers={assignableUsers}
        isAssigning={isAssigning}
        onAttach={() => {
          setShowProcessModal(false)
          setShowAttachModal(true)
        }}
        onDismiss={() => {
          setShowProcessModal(false)
          handleBulkDismiss()
        }}
        onArchive={() => {
          setShowProcessModal(false)
          setDeletingIds(Array.from(selectedIds))
        }}
        onAssign={handleAssign}
      />

      <AttachAlertsToCaseModal
        isOpen={showAttachModal}
        onClose={() => setShowAttachModal(false)}
        alertIds={Array.from(selectedIds)}
        onAttached={handleAttached}
      />

      <ConfirmDialog
        isOpen={!!deletingIds}
        onClose={() => setDeletingIds(null)}
        onConfirm={handleConfirmDelete}
        title="Удалить алерты"
        message={`Выбранные алерты (${deletingIds?.length ?? 0}) будут перемещены в архив. Их можно будет восстановить.`}
        confirmLabel="Удалить"
        isDanger
        isLoading={isBulkBusy}
        requireReason
        reasonLabel="Причина удаления"
      />

      <ConfirmDialog
        isOpen={!!purgingIds}
        onClose={() => setPurgingIds(null)}
        onConfirm={handleConfirmPurge}
        title="Удалить навсегда"
        message={`Выбранные алерты (${purgingIds?.length ?? 0}) будут удалены безвозвратно. Это действие нельзя отменить.`}
        confirmLabel="Удалить навсегда"
        isDanger
        isLoading={isBulkBusy}
      />
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
