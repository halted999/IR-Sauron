import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface AnalyzeDropdownButtonProps {
  ips: string[]
  accounts: string[]
  files: string[]
  size?: 'sm' | 'md'
}

type EntityKind = 'ip' | 'account' | 'file'

const KIND_LABEL: Record<EntityKind, string> = {
  ip: 'IP-адрес',
  account: 'Учётная запись',
  file: 'Файл',
}

export const AnalyzeDropdownButton: React.FC<AnalyzeDropdownButtonProps> = ({
  ips, accounts, files, size = 'md',
}) => {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const allGroups: { kind: EntityKind; values: string[] }[] = [
    { kind: 'ip', values: ips },
    { kind: 'account', values: accounts },
    { kind: 'file', values: files },
  ]
  const groups = allGroups.filter((g) => g.values.length > 0)

  if (groups.length === 0) return null

  const isSmall = size === 'sm'

  const goTo = (value: string) => {
    setIsOpen(false)
    navigate(`/analysis?q=${encodeURIComponent(value)}&period=30d`)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen((v) => !v)
        }}
        title="Найти связи в разделе «Анализ»"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: isSmall ? '3px 8px' : '5px 12px',
          fontSize: isSmall ? 11 : 13,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        В анализ <span style={{ fontSize: 9 }}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            zIndex: 40,
            minWidth: 220,
            maxWidth: 340,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            padding: 6,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {groups.map((group) => (
            <div key={group.kind} style={{ marginBottom: 4 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  padding: '4px 8px',
                }}
              >
                {KIND_LABEL[group.kind]}
              </div>
              {group.values.map((value) => (
                <button
                  key={value}
                  onClick={() => goTo(value)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    wordBreak: 'break-all',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
