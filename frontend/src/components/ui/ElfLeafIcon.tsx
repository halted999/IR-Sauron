import React from 'react'

interface ElfLeafIconProps {
  variant: 'open' | 'closed' | 'review' | 'active'
  size?: number
}

const LEAF_COLORS: Record<'open' | 'review' | 'active' | 'closed', { fill: string; stroke: string }> = {
  open: { fill: '#8fd99c', stroke: '#2e6b3f' },
  review: { fill: '#c9a227', stroke: '#8a6f1a' },
  active: { fill: '#2e8b4f', stroke: '#184f2c' },
  closed: { fill: '#8a5a3a', stroke: '#5a3a22' },
}

export const ElfLeafIcon: React.FC<ElfLeafIconProps> = ({ variant, size = 13 }) => {
  const { fill, stroke } = LEAF_COLORS[variant]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M12 2C6 4 3 9 3 14C3 18.5 7 21.5 12 22C17 21.5 21 18.5 21 14C21 9 18 4 12 2Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1"
      />
      <path d="M12 4V21" stroke={stroke} strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
    </svg>
  )
}
