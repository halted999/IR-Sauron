import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useCaseStore } from '../store/case'
import { useToastStore } from '../store/toast'
import { useAuthStore } from '../store/auth'
import { useThemeStore } from '../store/theme'
import { createCase, updateCase } from '../api/cases'
import { AppLayout } from '../components/Layout/AppLayout'
import { CaseModal } from '../components/Cases/CaseModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { SauronEyeIcon } from '../components/ui/SauronEyeIcon'
import { ElfLeafIcon } from '../components/ui/ElfLeafIcon'
import { Pagination } from '../components/ui/Pagination'
import { MultiSelectDropdown } from '../components/ui/MultiSelectDropdown'
import type { Case, CaseStatus, CaseSeverity, CreateCaseData } from '../types'
import {
  CASE_STATUS_LABELS, CASE_SEVERITY_LABELS,
  getCaseStatusLabel, getCaseStatusIconVariant,
} from '../types'
import { compileKqlQuery } from '../utils/kql'

const STATUS_OPTIONS = (Object.entries(CASE_STATUS_LABELS) as [CaseStatus, string][]).map(
  ([value, label]) => ({ value, label }),
)

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

const CLASSIFICATION_COLOR: Record<string, string> = {
  '1': 'green',
  '2': 'yellow',
  '3': 'orange',
  '4': 'red',
}

// Some cases carry a descriptive Russian grade instead of the "1"-"4" level
// the create form assigns — normalize those for display outside the Sauron
// theme, where the numeric level is shown instead of the words.
const CONFIDENTIALITY_TEXT_TO_LEVEL: Record<string, string> = {
  'Для служебного пользования': '1',
  'Секретно': '3',
  'Совершенно секретно': '4',
}

function confidentialityLevel(label: string): string {
  return CONFIDENTIALITY_TEXT_TO_LEVEL[label] ?? label
}

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { theme } = useThemeStore()
  const toast = useToastStore()
  const { cases, total, isLoading, fetchCases } = useCaseStore()

  // Filters/pagination/search live in the URL (not just component state) so
  // they survive navigating away (e.g. opening a case) and back, and page
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

  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('q') ?? '')
  const [filterStatuses, setFilterStatusesState] = useState<Set<CaseStatus>>(
    () => new Set((searchParams.get('status')?.split(',').filter(Boolean) ?? []) as CaseStatus[]),
  )
  const [filterSeverity, setFilterSeverityState] = useState<string>(() => searchParams.get('severity') ?? 'all')
  const [showArchived, setShowArchivedState] = useState(() => searchParams.get('archived') === '1')
  const [showModal, setShowModal] = useState(false)
  const [editingCase, setEditingCase] = useState<Case | null>(null)
  const [page, setPageState] = useState(() => Number(searchParams.get('page')) || 1)
  const [pageSize, setPageSizeState] = useState(() => Number(searchParams.get('pageSize')) || 50)

  // Remembers the current filters/pagination so the "Инциденты" nav link
  // (see AppLayout) can return here with them intact instead of resetting
  // to a bare /dashboard — see the matching comment in AlertsPage.tsx.
  useEffect(() => {
    const qs = searchParams.toString()
    sessionStorage.setItem('irsauron:nav:dashboard', qs ? `/dashboard?${qs}` : '/dashboard')
  }, [searchParams])

  // Debounce free-text search — it's matched server-side against the title
  // and against curated IOCs (IP/account/file/domain/hash) recorded on each
  // incident, which the client never has loaded, so it can't be done locally.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPageState(1)
      updateSearchParams({ q: search.trim() || null, page: null })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // The query is parsed here purely to show an inline syntax error next to
  // the field — actual filtering happens server-side (see cases.py), which
  // parses the same grammar independently and degrades to "no filter" on a
  // bad query, same as this does by omitting `q` below.
  const searchKql = useMemo(() => compileKqlQuery(debouncedSearch), [debouncedSearch])

  useEffect(() => {
    const params: {
      status?: string[]; severity?: string; q?: string; archived?: boolean; skip?: number; limit?: number
    } = {
      skip: (page - 1) * pageSize,
      limit: pageSize,
      archived: showArchived,
    }
    if (filterStatuses.size > 0) params.status = [...filterStatuses]
    if (filterSeverity !== 'all') params.severity = filterSeverity
    if (debouncedSearch && !searchKql.error) params.q = debouncedSearch
    fetchCases(params).catch(() => toast.error('Ошибка загрузки инцидентов'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatuses, filterSeverity, debouncedSearch, searchKql, showArchived, page, pageSize])

  const setPage = (p: number) => {
    setPageState(p)
    updateSearchParams({ page: p > 1 ? String(p) : null })
  }

  const handleToggleShowArchived = () => {
    const next = !showArchived
    setShowArchivedState(next)
    setPageState(1)
    updateSearchParams({ archived: next ? '1' : null, page: null })
  }

  const handleFilterStatusesChange = (next: Set<string>) => {
    setFilterStatusesState(next as Set<CaseStatus>)
    setPageState(1)
    updateSearchParams({ status: next.size > 0 ? [...next].join(',') : null, page: null })
  }

  const handleFilterSeverityChange = (v: string) => {
    setFilterSeverityState(v)
    setPageState(1)
    updateSearchParams({ severity: v === 'all' ? null : v, page: null })
  }

  const handlePageSizeChange = (size: number) => {
    setPageSizeState(size)
    setPageState(1)
    updateSearchParams({ pageSize: size !== 50 ? String(size) : null, page: null })
  }

  const handleSaveCase = async (data: CreateCaseData) => {
    try {
      if (editingCase) {
        const updated = await updateCase(editingCase.id, data)
        useCaseStore.setState((s) => ({
          cases: s.cases.map((c) => (c.id === updated.id ? updated : c)),
        }))
        toast.success('Инцидент обновлён')
      } else {
        const newCase = await createCase(data)
        useCaseStore.setState((s) => ({ cases: [newCase, ...s.cases] }))
        toast.success(`Инцидент «${newCase.title}» создан`)
        navigate(`/cases/${newCase.id}`)
      }
      setShowModal(false)
      setEditingCase(null)
    } catch {
      toast.error('Ошибка сохранения инцидента')
      throw new Error('save failed')
    }
  }

  const canCreate =
    user?.role === 'admin' || user?.role === 'ir_lead' || user?.role === 'investigator'

  const hasActiveFilter =
    filterStatuses.size > 0 || filterSeverity !== 'all' || debouncedSearch !== '' || showArchived

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px', width: '100%' }}>
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
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 10 }}>
              Инциденты
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>Всего: {total}</span>
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Управление инцидентами информационной безопасности
            </p>
          </div>
          {canCreate && (
            <Button
              variant="primary"
              onClick={() => {
                setEditingCase(null)
                setShowModal(true)
              }}
            >
              + Создать инцидент
            </Button>
          )}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Поиск (KQL) по номеру, названию, IOC, IP, учётной записи, файлу...'
            style={{ width: '100%' }}
          />
          {searchKql.error && (
            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
              Ошибка в запросе: {searchKql.error} — фильтр временно не применяется
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
            <label
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                margin: 0,
              }}
            >
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
            <label
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                margin: 0,
              }}
            >
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
          <button
            onClick={handleToggleShowArchived}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 20,
              border: showArchived ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: showArchived ? 'rgba(88,166,255,0.15)' : 'var(--bg-secondary)',
              color: showArchived ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {showArchived ? '✓ Архивные' : 'Архивные'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            Найдено: {total}
          </span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spinner size={32} />
          </div>
        ) : cases.length === 0 ? (
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
            <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
            <p style={{ fontSize: 15, marginBottom: 8 }}>
              {hasActiveFilter ? 'Нет инцидентов по заданному фильтру' : 'Инцидентов не найдено'}
            </p>
            {!hasActiveFilter && canCreate && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowModal(true)}
                style={{ marginTop: 8 }}
              >
                Создать первый инцидент
              </Button>
            )}
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
                  <Th>Номер</Th>
                  <Th>Название</Th>
                  <Th>Статус</Th>
                  <Th>Критичность</Th>
                  <Th>Гриф</Th>
                  <Th>Открыто</Th>
                  <Th>Обновлено</Th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c, idx) => (
                  <tr
                    key={c.id}
                    style={{
                      borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLTableRowElement).style.background =
                        'var(--bg-tertiary)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                    }}
                  >
                    <Td>
                      <Link
                        to={`/cases/${c.id}`}
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
                        {c.id.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        to={`/cases/${c.id}`}
                        style={{ display: 'block', fontWeight: 500, color: 'var(--text-primary)', maxWidth: 400 }}
                      >
                        {c.title}
                      </Link>
                      {c.classification && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {c.classification}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {(() => {
                        const iconVariant =
                          theme === 'sauron' || theme === 'elves'
                            ? getCaseStatusIconVariant(c.status)
                            : null
                        const icon = iconVariant
                          ? theme === 'elves'
                            ? <ElfLeafIcon variant={iconVariant} />
                            : <SauronEyeIcon variant={iconVariant} />
                          : undefined
                        return (
                          <span className="icon-tooltip" data-tooltip={getCaseStatusLabel(c.status, theme)}>
                            <Badge
                              color={STATUS_COLOR[c.status] as 'blue'}
                              label={iconVariant ? '' : getCaseStatusLabel(c.status, theme)}
                              size="sm"
                              icon={icon}
                            />
                          </span>
                        )
                      })()}
                    </Td>
                    <Td>
                      <Badge
                        color={SEVERITY_COLOR[c.severity] as 'red'}
                        label={CASE_SEVERITY_LABELS[c.severity]}
                        size="sm"
                      />
                    </Td>
                    <Td>
                      {!c.confidentiality_label ? (
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>—</span>
                      ) : theme === 'sauron' ? (
                        CLASSIFICATION_COLOR[c.confidentiality_label] ? (
                          <Badge
                            color={CLASSIFICATION_COLOR[c.confidentiality_label] as 'green'}
                            label={c.confidentiality_label}
                            size="sm"
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              background: 'var(--bg-tertiary)',
                              padding: '1px 6px',
                              borderRadius: 4,
                              border: '1px solid var(--border)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {c.confidentiality_label}
                          </span>
                        )
                      ) : (
                        (() => {
                          const level = confidentialityLevel(c.confidentiality_label)
                          return CLASSIFICATION_COLOR[level] ? (
                            <Badge color={CLASSIFICATION_COLOR[level] as 'green'} label={level} size="sm" />
                          ) : (
                            <span
                              style={{
                                fontSize: 11,
                                background: 'var(--bg-tertiary)',
                                padding: '1px 6px',
                                borderRadius: 4,
                                border: '1px solid var(--border)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {level}
                            </span>
                          )
                        })()
                      )}
                    </Td>
                    <Td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {format(new Date(c.created_at), 'dd.MM.yyyy', { locale: ru })}
                    </Td>
                    <Td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {format(new Date(c.updated_at), 'dd.MM HH:mm', { locale: ru })}
                    </Td>
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

      <CaseModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false)
          setEditingCase(null)
        }}
        onSave={handleSaveCase}
        caseData={editingCase}
      />
    </AppLayout>
  )
}

const Th: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
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
