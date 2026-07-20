import React, { useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Event, EventType, ConfidenceLevel } from '../../types'
import { EVENT_TYPE_LABELS, CONFIDENCE_LABELS } from '../../types'

const EVENT_COLORS: Record<EventType, string> = {
  attacker_action: 'var(--event-attacker)',
  detection: 'var(--event-detection)',
  ir_action: 'var(--event-ir)',
  inference: 'var(--event-inference)',
  legal_event: 'var(--event-legal)',
}

const CONFIDENCE_BORDER: Record<ConfidenceLevel, React.CSSProperties> = {
  confirmed: { border: '1.5px solid currentColor' },
  corroborated: { border: '1.5px dashed currentColor' },
  hypothesis: { border: '1.5px solid currentColor', opacity: 0.65 },
}

interface EventCardProps {
  event: Event
  onClick: (event: Event) => void
  isSelected?: boolean
  compact?: boolean
}

export const EventCard: React.FC<EventCardProps> = ({
  event,
  onClick,
  isSelected = false,
  compact = false,
}) => {
  const [showTooltip, setShowTooltip] = useState(false)
  const color = EVENT_COLORS[event.event_type]
  const borderStyle = CONFIDENCE_BORDER[event.confidence_level]
  const hasArtifacts = event.artifacts && event.artifacts.length > 0
  const ts = new Date(event.event_ts)

  return (
    <div
      style={{
        position: 'relative',
        width: compact ? 120 : 160,
        flexShrink: 0,
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        onClick={() => onClick(event)}
        style={{
          background: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
          borderRadius: 6,
          overflow: 'hidden',
          cursor: 'pointer',
          color,
          transition: 'transform 0.1s, box-shadow 0.1s',
          boxShadow: isSelected
            ? `0 0 0 2px ${color}`
            : '0 2px 6px rgba(0,0,0,0.3)',
          ...borderStyle,
        }}
      >
        {/* Top color bar */}
        <div
          style={{
            height: 3,
            background: color,
            borderRadius: '4px 4px 0 0',
          }}
        />
        <div style={{ padding: compact ? '4px 6px' : '6px 8px' }}>
          {/* Header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: compact ? 2 : 4,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {EVENT_TYPE_LABELS[event.event_type]}
            </span>

            {/* Indicators */}
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
              {hasArtifacts && (
                <span
                  title="Есть артефакты"
                  style={{ fontSize: 10, color: 'var(--text-secondary)' }}
                >
                  📎
                </span>
              )}
              {event.confidence_level !== 'confirmed' && (
                <span
                  title={`Достоверность: ${CONFIDENCE_LABELS[event.confidence_level]}`}
                  style={{ fontSize: 10, color: 'var(--warning)' }}
                >
                  !
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: compact ? 11 : 12,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: compact ? 1 : 2,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              WebkitBoxOrient: 'vertical' as any,
              lineHeight: 1.3,
            }}
          >
            {event.title}
          </div>

          {/* MITRE badge */}
          {!compact && event.mitre_technique && (
            <div style={{ marginTop: 4 }}>
              <span
                style={{
                  fontSize: 10,
                  background: 'rgba(88,166,255,0.15)',
                  color: '#58a6ff',
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontFamily: 'monospace',
                }}
              >
                {event.mitre_technique}
              </span>
            </div>
          )}

          {/* Time */}
          {!compact && (
            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-secondary)' }}>
              {format(ts, 'dd.MM HH:mm', { locale: ru })}
            </div>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1c2128',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 14px',
            width: 280,
            zIndex: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color,
              fontWeight: 700,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {EVENT_TYPE_LABELS[event.event_type]}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: 6,
            }}
          >
            {event.title}
          </div>
          {event.description && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {event.description}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              borderTop: '1px solid var(--border)',
              paddingTop: 6,
              marginTop: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <span>
              UTC: {format(ts, 'dd.MM.yyyy HH:mm:ss', { locale: ru })}
            </span>
            <span>Достоверность: {CONFIDENCE_LABELS[event.confidence_level]}</span>
            {event.mitre_technique && (
              <span>MITRE: {event.mitre_technique}{event.mitre_subtechnique ? `.${event.mitre_subtechnique}` : ''}</span>
            )}
            {event.source_description && (
              <span>Источник: {event.source_description}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
