import React, { useEffect, useRef, useState } from 'react'

interface MultiSelectDropdownProps {
  options: { value: string; label: string }[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  placeholder: string
  width?: number
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  options, selected, onChange, placeholder, width = 220,
}) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const toggleValue = (value: string) => {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  const label =
    selected.size === 0
      ? placeholder
      : selected.size === 1
        ? options.find((o) => selected.has(o.value))?.label ?? placeholder
        : `Выбрано: ${selected.size}`

  return (
    <div ref={containerRef} style={{ position: 'relative', width }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '6px 28px 6px 10px',
          fontSize: 13,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg-primary)',
          color: selected.size === 0 ? 'var(--text-secondary)' : 'var(--text-primary)',
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 10,
            color: 'var(--text-secondary)',
            pointerEvents: 'none',
          }}
        >
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: '100%',
            maxHeight: 280,
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 30,
            padding: 4,
          }}
        >
          {selected.size > 0 && (
            <>
              <button
                type="button"
                onClick={() => onChange(new Set())}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                  fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Сбросить выбор
              </button>
              <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
            </>
          )}
          {options.map((o) => (
            <label
              key={o.value}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                fontSize: 13, cursor: 'pointer', borderRadius: 6,
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLLabelElement).style.background = 'var(--bg-tertiary)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLLabelElement).style.background = 'none'
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={() => toggleValue(o.value)}
                style={{ width: 'auto' }}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
