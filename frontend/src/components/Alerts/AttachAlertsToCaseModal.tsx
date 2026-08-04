import React, { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { getCases } from '../../api/cases'
import { attachAlertsToCase } from '../../api/alerts'
import type { Case } from '../../types'
import { CASE_STATUS_LABELS } from '../../types'

interface AttachAlertsToCaseModalProps {
  isOpen: boolean
  onClose: () => void
  alertIds: string[]
  onAttached: (updated: Case) => void
}

export const AttachAlertsToCaseModal: React.FC<AttachAlertsToCaseModalProps> = ({
  isOpen, onClose, alertIds, onAttached,
}) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Case[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selected, setSelected] = useState<Case | null>(null)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setResults([])
    setSelected(null)
    setError('')
  }, [isOpen])

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
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setIsSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, isOpen, selected])

  const handleSelect = (c: Case) => {
    setSelected(c)
    setResults([])
  }

  const handleSubmit = async () => {
    if (!selected) {
      setError('Выберите инцидент для присоединения')
      return
    }
    setIsSaving(true)
    setError('')
    try {
      const updated = await attachAlertsToCase(alertIds, selected.id)
      onAttached(updated)
      onClose()
    } catch (e) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(message || 'Ошибка присоединения алертов')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Присоединить к инциденту (${alertIds.length})`}
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
          <label>Инцидент</label>
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
                onClick={() => setSelected(null)}
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
                autoFocus
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

        {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
      </div>
    </Modal>
  )
}
