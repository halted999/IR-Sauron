import React, { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { getCases, attachCase } from '../../api/cases'
import type { AttachCaseData } from '../../api/cases'
import type { Case } from '../../types'
import { CASE_STATUS_LABELS } from '../../types'

interface AttachCaseModalProps {
  isOpen: boolean
  onClose: () => void
  currentCase: Case
  onAttached: (updated: Case) => void
}

export const AttachCaseModal: React.FC<AttachCaseModalProps> = ({
  isOpen, onClose, currentCase, onAttached,
}) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Case[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selected, setSelected] = useState<Case | null>(null)
  const [mainCaseId, setMainCaseId] = useState<string>(currentCase.id)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setResults([])
    setSelected(null)
    setMainCaseId(currentCase.id)
    setReason('')
    setError('')
  }, [isOpen, currentCase.id])

  useEffect(() => {
    if (!isOpen || selected) return
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      setIsSearching(true)
      getCases({ q, limit: 15 })
        .then((res) => setResults(res.filter((c) => c.id !== currentCase.id)))
        .catch(() => setResults([]))
        .finally(() => setIsSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, isOpen, selected, currentCase.id])

  const handleSelect = (c: Case) => {
    setSelected(c)
    setResults([])
  }

  const handleSubmit = async () => {
    if (!selected) {
      setError('Выберите инцидент для присоединения')
      return
    }
    if (!reason.trim()) {
      setError('Укажите причину присоединения')
      return
    }
    const data: AttachCaseData = {
      other_case_id: selected.id,
      main_case_id: mainCaseId,
      reason: reason.trim(),
    }
    setIsSaving(true)
    setError('')
    try {
      const updated = await attachCase(currentCase.id, data)
      onAttached(updated)
      onClose()
    } catch (e) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(message || 'Ошибка присоединения инцидента')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Присоединить инцидент"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving} disabled={!selected}>
            Присоединить
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label>Инцидент для присоединения</label>
          {selected ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg-tertiary)', fontSize: 13,
              }}
            >
              <span>{selected.title}</span>
              <button
                onClick={() => {
                  setSelected(null)
                  setMainCaseId(currentCase.id)
                }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}
              >
                Изменить
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по номеру, названию..."
              />
              {isSearching && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                  <Spinner size={18} />
                </div>
              )}
              {!isSearching && results.length > 0 && (
                <div
                  style={{
                    marginTop: 6, maxHeight: 200, overflowY: 'auto',
                    border: '1px solid var(--border)', borderRadius: 6,
                  }}
                >
                  {results.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelect(c)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                        fontSize: 13, background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                        cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit',
                      }}
                    >
                      {c.title}
                      <span style={{ color: 'var(--text-secondary)', fontSize: 11, marginLeft: 8 }}>
                        {CASE_STATUS_LABELS[c.status]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!isSearching && query.trim() && results.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>Ничего не найдено</p>
              )}
            </>
          )}
        </div>

        {selected && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Главный инцидент
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={mainCaseId === currentCase.id}
                  onChange={() => setMainCaseId(currentCase.id)}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>{currentCase.title} (текущий)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={mainCaseId === selected.id}
                  onChange={() => setMainCaseId(selected.id)}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>{selected.title}</span>
              </label>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="attach-reason">Причина присоединения *</label>
          <textarea
            id="attach-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: связаны общей учётной записью и временным окном атаки"
            rows={3}
          />
        </div>

        {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
      </div>
    </Modal>
  )
}
