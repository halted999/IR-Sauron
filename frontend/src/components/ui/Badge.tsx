import React from 'react'

type BadgeColor = 'red' | 'orange' | 'green' | 'yellow' | 'blue' | 'purple' | 'gray' | 'teal'

interface BadgeProps {
  color: BadgeColor
  label: string
  size?: 'sm' | 'md'
  icon?: React.ReactNode
}

const COLOR_MAP: Record<BadgeColor, { bg: string; color: string; border: string }> = {
  red: { bg: 'rgba(248,81,73,0.15)', color: '#f85149', border: 'rgba(248,81,73,0.4)' },
  orange: { bg: 'rgba(255,140,0,0.15)', color: '#ff8c00', border: 'rgba(255,140,0,0.4)' },
  green: { bg: 'rgba(63,185,80,0.15)', color: '#3fb950', border: 'rgba(63,185,80,0.4)' },
  yellow: { bg: 'rgba(210,153,34,0.15)', color: '#d29922', border: 'rgba(210,153,34,0.4)' },
  blue: { bg: 'rgba(88,166,255,0.15)', color: '#58a6ff', border: 'rgba(88,166,255,0.4)' },
  purple: { bg: 'rgba(188,140,255,0.15)', color: '#bc8cff', border: 'rgba(188,140,255,0.4)' },
  gray: { bg: 'rgba(139,148,158,0.15)', color: '#8b949e', border: 'rgba(139,148,158,0.4)' },
  teal: { bg: 'rgba(0,200,200,0.15)', color: '#00c8c8', border: 'rgba(0,200,200,0.4)' },
}

export const Badge: React.FC<BadgeProps> = ({ color, label, size = 'md', icon }) => {
  const styles = COLOR_MAP[color]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: styles.bg,
        color: styles.color,
        border: `1px solid ${styles.border}`,
        borderRadius: '20px',
        padding: size === 'sm' ? '1px 7px' : '2px 10px',
        fontSize: size === 'sm' ? '11px' : '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        lineHeight: '18px',
      }}
    >
      {icon}
      {label || null}
    </span>
  )
}
