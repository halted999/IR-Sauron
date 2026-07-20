import React from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  children: React.ReactNode
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: '#238636',
    color: '#ffffff',
    border: '1px solid rgba(240,246,252,0.1)',
  },
  secondary: {
    background: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
  },
  danger: {
    background: 'rgba(248,81,73,0.15)',
    color: '#f85149',
    border: '1px solid rgba(248,81,73,0.4)',
  },
  ghost: {
    background: 'transparent',
    color: '#58a6ff',
    border: '1px solid transparent',
  },
}

const SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: '12px', borderRadius: '6px', gap: '4px' },
  md: { padding: '6px 14px', fontSize: '14px', borderRadius: '6px', gap: '6px' },
  lg: { padding: '10px 20px', fontSize: '15px', borderRadius: '8px', gap: '8px' },
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  isLoading = false,
  children,
  disabled,
  style,
  ...props
}) => {
  return (
    <button
      disabled={disabled || isLoading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'inherit',
        fontWeight: 500,
        cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
        opacity: disabled || isLoading ? 0.6 : 1,
        transition: 'opacity 0.15s, background 0.15s',
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...style,
      }}
      {...props}
    >
      {isLoading && (
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
            marginRight: 6,
          }}
        />
      )}
      {children}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  )
}
