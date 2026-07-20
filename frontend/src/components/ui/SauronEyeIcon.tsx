import React from 'react'

interface SauronEyeIconProps {
  variant: 'open' | 'closed' | 'review' | 'active'
  size?: number
}

const EYE_COLORS: Record<'open' | 'review' | 'active', { fill: string; stroke: string }> = {
  open: { fill: '#ff5a1f', stroke: '#7a1a00' },
  review: { fill: '#d29922', stroke: '#5c4108' },
  active: { fill: '#bc8cff', stroke: '#4b2e7a' },
}

export const SauronEyeIcon: React.FC<SauronEyeIconProps> = ({ variant, size = 13 }) => {
  if (variant === 'open' || variant === 'review' || variant === 'active') {
    const { fill, stroke } = EYE_COLORS[variant]
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path
          d="M2 12C2 12 7 5 12 5C17 5 22 12 22 12C22 12 17 19 12 19C7 19 2 12 2 12Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="1"
        />
        <ellipse cx="12" cy="12" rx="1.8" ry="6" fill="#150402" />
      </svg>
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M2 12C2 12 7 15 12 15C17 15 22 12 22 12"
        stroke="#7a1a00"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
