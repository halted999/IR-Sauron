import React, { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { IOC, IOCType, CreateIOCData } from '../../types'
import { IOC_TYPE_LABELS } from '../../types'
import { createIOC, deleteIOC } from '../../api/iocs'
import { useCaseStore } from '../../store/case'
import { useToastStore } from '../../store/toast'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Modal } from '../ui/Modal'

interface IOCPanelProps {
  iocs: IOC[]
  caseId: string
}

const IOC_COLOR_MAP: Record<string, string> = {
  hash_md5: 'gray',
  hash_sha256: 'gray',
  ip: 'red',
  domain: 'blue',
  url: 'purple',
  email: 'yellow',
  filename: 'teal',
}

const IOC_TYPES: IOCType[] = [
  'hash_md5',
  'hash_sha256',
  'ip',
  'domain',
  'url',
  'email',
  'filename',
]

export const IOCPanel: React.FC<IOCPanelProps> = ({ iocs, caseId }) => {
  const toast = useToastStore()
  const { addIOC, removeIOC } = useCaseStore()
  const [filterType, setFilterType] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState<CreateIOCData>({
    ioc_type: 'ip',
    value: '',
    context: '',
  })
  const [isAdding, setIsAdding] = useState(false)
  const [formError, setFormError] = useState('')

  const filtered = useMemo(() => {
    return iocs.filter((ioc) => {
      const matchType = filterType === 'all' || ioc.ioc_type === filterType
      const matchSearch =
        !search ||
        ioc.value.toLowerCase().includes(search.toLowerCase()) ||
        (ioc.context ?? '').toLowerCase().includes(search.toLowerCase())
      return matchType && matchSearch
    })
  }, [iocs, filterType, search])

  const handleAdd = async () => {
    if (!form.value.trim()) {
      setFormError('Введите значение IOC')
      return
    }
    setFormError('')
    setIsAdding(true)
    try {
      const ioc = await createIOC(caseId, {
        ...form,
        value: form.value.trim(),
        context: form.context?.trim() || undefined,
      })
      addIOC(ioc)
      setShowAddModal(false)
      setForm({ ioc_type: 'ip', value: '', context: '' })
      toast.success('IOC добавлен')
    } catch {
      toast.error('Ошибка добавления IOC')
    } finally {
      setIsAdding(false)
    }
  }

  const handleDelete = async (iocId: string) => {
    if (!confirm('Удалить IOC?')) return
    try {
      await deleteIOC(iocId)
      removeIOC(iocId)
      toast.success('IOC удалён')
    } catch {
      toast.error('Ошибка удаления IOC')
    }
  }

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск IOC..."
          style={{ width: 240, flexShrink: 0 }}
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ width: 160, flexShrink: 0 }}
        >
          <option value="all">Все типы</option>
          {IOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {IOC_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
          + Добавить IOC
        </Button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 0',
            color: 'var(--text-secondary)',
          }}
        >
          {iocs.length === 0
            ? 'Нет индикаторов компрометации. Добавьте первый IOC.'
            : 'Нет результатов по заданному фильтру.'}
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <Th>Тип</Th>
                <Th>Значение</Th>
                <Th>Контекст</Th>
                <Th>Добавлен</Th>
                <Th style={{ width: 40 }}></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ioc, idx) => (
                <tr
                  key={ioc.id}
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <Td>
                    <Badge
                      color={(IOC_COLOR_MAP[ioc.ioc_type] ?? 'gray') as 'gray'}
                      label={IOC_TYPE_LABELS[ioc.ioc_type] ?? ioc.ioc_type}
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <code
                      style={{
                        fontSize: 12,
                        background: 'var(--bg-tertiary)',
                        padding: '2px 6px',
                        borderRadius: 3,
                        border: '1px solid var(--border)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {ioc.value}
                    </code>
                  </Td>
                  <Td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {ioc.context ?? '—'}
                  </Td>
                  <Td style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {format(new Date(ioc.created_at), 'dd.MM.yyyy', { locale: ru })}
                  </Td>
                  <Td>
                    <button
                      onClick={() => handleDelete(ioc.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--danger)',
                        cursor: 'pointer',
                        fontSize: 14,
                        padding: 4,
                      }}
                      title="Удалить IOC"
                    >
                      ×
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        Всего: {filtered.length} из {iocs.length}
      </p>

      {/* Add IOC Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Добавить индикатор компрометации"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowAddModal(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={handleAdd} isLoading={isAdding}>
              Добавить
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="ioc-type">Тип IOC *</label>
            <select
              id="ioc-type"
              value={form.ioc_type}
              onChange={(e) => setForm((prev) => ({ ...prev, ioc_type: e.target.value }))}
            >
              {IOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {IOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ioc-value">Значение *</label>
            <input
              id="ioc-value"
              type="text"
              value={form.value}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, value: e.target.value }))
                setFormError('')
              }}
              placeholder={
                form.ioc_type === 'ip'
                  ? '192.168.1.1'
                  : form.ioc_type === 'domain'
                    ? 'evil.example.com'
                    : form.ioc_type === 'hash_sha256'
                      ? 'sha256...'
                      : form.ioc_type === 'email'
                        ? 'attacker@evil.com'
                        : form.ioc_type === 'url'
                          ? 'https://evil.example.com/path'
                          : 'значение...'
              }
              autoFocus
            />
            {formError && (
              <span style={{ color: 'var(--danger)', fontSize: 11 }}>{formError}</span>
            )}
          </div>
          <div>
            <label htmlFor="ioc-context">Контекст</label>
            <textarea
              id="ioc-context"
              value={form.context}
              onChange={(e) => setForm((prev) => ({ ...prev, context: e.target.value }))}
              rows={3}
              placeholder="Где обнаружен, связь с событиями..."
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

const Th: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
  <th
    style={{
      padding: '8px 12px',
      textAlign: 'left',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
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
      padding: '10px 12px',
      fontSize: 13,
      color: 'var(--text-primary)',
      verticalAlign: 'middle',
      ...style,
    }}
  >
    {children}
  </td>
)
