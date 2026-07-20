import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useCaseStore } from '../store/case'
import { useToastStore } from '../store/toast'
import { useAuthStore } from '../store/auth'
import { createCase, updateCase } from '../api/cases'
import { AppLayout } from '../components/Layout/AppLayout'
import { CaseModal } from '../components/Cases/CaseModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import type { Case, CaseStatus, CaseSeverity, CreateCaseData, VerificationStatus } from '../types'
import { CASE_STATUS_LABELS, CASE_SEVERITY_LABELS, VERIFICATION_STATUS_LABELS } from '../types'

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

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toast = useToastStore()
  const { cases, isLoading, fetchCases } = useCaseStore()

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)
  const [editingCase, setEditingCase] = useState<Case | null>(null)

  useEffect(() => {
    const params: { status?: string; severity?: string } = {}
    if (filterStatus !== 'all') params.status = filterStatus
    if (filterSeverity !== 'all') params.severity = filterSeverity
    fetchCases(params).catch(() => toast.error('Ошибка загрузки дел'))
  }, [filterStatus, filterSeverity]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveCase = async (data: CreateCaseData) => {
    try {
      if (editingCase) {
        const updated = await updateCase(editingCase.id, data)
        useCaseStore.setState((s) => ({
          cases: s.cases.map((c) => (c.id === updated.id ? updated : c)),
        }))
        toast.success('Дело обновлено')
      } else {
        const newCase = await createCase(data)
        useCaseStore.setState((s) => ({ cases: [newCase, ...s.cases] }))
        toast.success(`Дело «${newCase.title}» создано`)
        navigate(`/cases/${newCase.id}`)
      }
      setShowModal(false)
      setEditingCase(null)
    } catch {
      toast.error('Ошибка сохранения дела')
      throw new Error('save failed')
    }
  }

  const filteredCases = cases.filter((c) => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (filterSeverity !== 'all' && c.severity !== filterSeverity) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!c.title.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) return false
    }
    return true
  })

  const canCreate =
    user?.role === 'admin' || user?.role === 'ir_lead' || user?.role === 'investigator'

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
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Дела</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Управление делами по расследованию инцидентов ИБ
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
              + Создать дело
            </Button>
          )}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру или названию дела..."
            style={{ width: '100%' }}
          />
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
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ width: 150 }}
            >
              <option value="all">Все статусы</option>
              {Object.entries(CASE_STATUS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
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
            Найдено: {filteredCases.length}
          </span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spinner size={32} />
          </div>
        ) : filteredCases.length === 0 ? (
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
              {cases.length === 0 ? 'Дел не найдено' : 'Нет дел по заданному фильтру'}
            </p>
            {cases.length === 0 && canCreate && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowModal(true)}
                style={{ marginTop: 8 }}
              >
                Создать первое дело
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
                  <Th>Подтверждение</Th>
                  <Th>Критичность</Th>
                  <Th>Гриф</Th>
                  <Th>Открыто</Th>
                  <Th>Обновлено</Th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.map((c, idx) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/cases/${c.id}`)}
                    style={{
                      borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
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
                      <code
                        style={{
                          fontSize: 12,
                          color: 'var(--accent)',
                          background: 'rgba(88,166,255,0.1)',
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}
                      >
                        {c.id.slice(0, 8)}
                      </code>
                    </Td>
                    <Td>
                      <div
                        style={{ fontWeight: 500, color: 'var(--text-primary)', maxWidth: 400 }}
                      >
                        {c.title}
                      </div>
                      {c.classification && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {c.classification}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        color={STATUS_COLOR[c.status] as 'blue'}
                        label={CASE_STATUS_LABELS[c.status]}
                        size="sm"
                      />
                    </Td>
                    <Td>
                      <Badge
                        color={VERIFICATION_COLOR[c.verification_status] as 'green'}
                        label={VERIFICATION_STATUS_LABELS[c.verification_status]}
                        size="sm"
                      />
                    </Td>
                    <Td>
                      <Badge
                        color={SEVERITY_COLOR[c.severity] as 'red'}
                        label={CASE_SEVERITY_LABELS[c.severity]}
                        size="sm"
                      />
                    </Td>
                    <Td>
                      {CLASSIFICATION_COLOR[c.confidentiality_label] ? (
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
