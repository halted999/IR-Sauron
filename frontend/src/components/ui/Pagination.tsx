import React from 'react'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

function getPageNumbers(current: number, totalPages: number): (number | 'ellipsis')[] {
  const delta = 1
  const range: number[] = []
  const withDots: (number | 'ellipsis')[] = []
  let last: number | undefined

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= current - delta && i <= current + delta)) {
      range.push(i)
    }
  }
  for (const i of range) {
    if (last !== undefined) {
      if (i - last === 2) withDots.push(last + 1)
      else if (i - last !== 1) withDots.push('ellipsis')
    }
    withDots.push(i)
    last = i
  }
  return withDots
}

function pageBtnStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    minWidth: 30,
    padding: '5px 10px',
    fontSize: 13,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'var(--bg-secondary)',
    color: active ? '#fff' : disabled ? 'var(--text-secondary)' : 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  }
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  pageSizeOptions = [50, 100, 200, 500],
  onPageChange,
  onPageSizeChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pages = getPageNumbers(page, totalPages)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        padding: '12px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', margin: 0 }}>
          Показывать по:
        </label>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ width: 90 }}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Всего: {total}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={pageBtnStyle(false, page <= 1)}
        >
          ← Назад
        </button>
        {pages.map((p, idx) =>
          p === 'ellipsis' ? (
            <span key={`dots-${idx}`} style={{ padding: '0 4px', color: 'var(--text-secondary)', fontSize: 13 }}>
              …
            </span>
          ) : (
            <button key={p} onClick={() => onPageChange(p)} style={pageBtnStyle(p === page, false)}>
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={pageBtnStyle(false, page >= totalPages)}
        >
          Вперёд →
        </button>
      </div>
    </div>
  )
}
