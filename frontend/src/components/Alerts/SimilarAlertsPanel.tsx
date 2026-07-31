import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSimilarAlerts } from '../../api/alerts'
import { Spinner } from '../ui/Spinner'
import { useToastStore } from '../../store/toast'
import type { SimilarAlert } from '../../types'

interface SimilarAlertsPanelProps {
  alertId: string
}

export const SimilarAlertsPanel: React.FC<SimilarAlertsPanelProps> = ({ alertId }) => {
  const toast = useToastStore()
  const [items, setItems] = useState<SimilarAlert[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsOpen(false)
    getSimilarAlerts(alertId)
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setTotal(res.total)
      })
      .catch(() => {
        if (!cancelled) toast.error('Не удалось загрузить похожие алерты')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertId])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        position: 'sticky',
        top: 16,
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Похожие алерты</h2>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
          <Spinner size={20} />
        </div>
      ) : (
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            Похожих алертов: <span style={{ fontWeight: 700, fontSize: 16 }}>{total}</span>
          </div>

          {items.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Совпадений по внутреннему IP или учётной записи не найдено
            </p>
          ) : (
            <>
              <button
                onClick={() => setIsOpen((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '7px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                <span>Список похожих алертов</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 6,
                    zIndex: 30,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                    maxHeight: 480,
                    overflowY: 'auto',
                  }}
                >
                  {total > items.length && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        padding: '6px 10px',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      Показаны первые {items.length} из {total}
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-tertiary)' }}>
                        <Th>Совпадение</Th>
                        <Th>Учётная запись</Th>
                        <Th>Ссылка</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.alert_id} style={{ borderTop: '1px solid var(--border)' }}>
                          <Td>
                            {item.matched_internal_ips.length > 0 ? item.matched_internal_ips.join(', ') : '—'}
                          </Td>
                          <Td>{item.matched_accounts.length > 0 ? item.matched_accounts.join(', ') : '—'}</Td>
                          <Td>
                            <Link
                              to={`/alerts/${item.alert_id}`}
                              onClick={() => setIsOpen(false)}
                              style={{ color: 'var(--accent)' }}
                            >
                              Открыть
                            </Link>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th
    style={{
      textAlign: 'left',
      padding: '6px 8px',
      color: 'var(--text-secondary)',
      fontWeight: 500,
      borderBottom: '1px solid var(--border)',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </th>
)

const Td: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <td style={{ padding: '6px 8px', verticalAlign: 'top', wordBreak: 'break-word' }}>{children}</td>
)
