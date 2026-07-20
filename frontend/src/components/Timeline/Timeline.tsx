import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Event, EventType, Branch } from '../../types'
import { EventCard } from './EventCard'

interface TimelineProps {
  events: Event[]
  branches: Branch[]
  onEventClick: (event: Event) => void
  selectedEventId?: string
}

type ZoomLevel = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months'

const ZOOM_CONFIGS: Record<ZoomLevel, { msPerPixel: number; tickMs: number; format: string }> = {
  seconds: { msPerPixel: 10, tickMs: 10_000, format: 'HH:mm:ss' },
  minutes: { msPerPixel: 500, tickMs: 60_000, format: 'HH:mm' },
  hours: { msPerPixel: 15_000, tickMs: 3_600_000, format: 'dd.MM HH:mm' },
  days: { msPerPixel: 300_000, tickMs: 86_400_000, format: 'dd.MM' },
  weeks: { msPerPixel: 2_000_000, tickMs: 7 * 86_400_000, format: 'dd.MM' },
  months: { msPerPixel: 8_000_000, tickMs: 30 * 86_400_000, format: 'MM.yyyy' },
}

const ZOOM_LEVELS: ZoomLevel[] = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months']

const EVENT_TYPE_ALL: EventType[] = [
  'attacker_action',
  'detection',
  'ir_action',
  'inference',
  'legal_event',
]

const EVENT_TYPE_LABELS_SHORT: Record<EventType, string> = {
  attacker_action: 'Атакующий',
  detection: 'Обнаружение',
  ir_action: 'IR команда',
  inference: 'Вывод',
  legal_event: 'Юридическое',
}

const EVENT_COLORS: Record<EventType, string> = {
  attacker_action: '#f85149',
  detection: '#d29922',
  ir_action: '#3fb950',
  inference: '#58a6ff',
  legal_event: '#bc8cff',
}

const LANE_WIDTH = 200
const AXIS_WIDTH = 88
const HEADER_HEIGHT = 44
const MINIMAP_WIDTH = 48
const EVENT_MARGIN = 8
const CARD_WIDTH_FULL = 160
const CARD_WIDTH_COMPACT = 120

export const Timeline: React.FC<TimelineProps> = ({
  events,
  branches,
  onEventClick,
  selectedEventId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoomIndex, setZoomIndex] = useState(2) // hours
  const [offsetMs, setOffsetMs] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragStartOffset, setDragStartOffset] = useState(0)
  const [containerHeight, setContainerHeight] = useState(700)
  const [containerWidth, setContainerWidth] = useState(1000)
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false)
  const [minimapDragStartY, setMinimapDragStartY] = useState(0)
  const [minimapDragStartOffset, setMinimapDragStartOffset] = useState(0)
  const [visibleTypes, setVisibleTypes] = useState<Set<EventType>>(new Set(EVENT_TYPE_ALL))

  const zoomLevel = ZOOM_LEVELS[zoomIndex]
  const { msPerPixel, tickMs, format: tickFormat } = ZOOM_CONFIGS[zoomLevel]

  // Filter non-deleted events
  const activeEvents = useMemo(
    () => events.filter((e) => !e.is_deleted && visibleTypes.has(e.event_type)),
    [events, visibleTypes],
  )

  // Get time bounds
  const { minTs, maxTs } = useMemo(() => {
    if (activeEvents.length === 0) {
      const now = Date.now()
      return { minTs: now - 3_600_000, maxTs: now + 3_600_000 }
    }
    const times = activeEvents.map((e) => new Date(e.event_ts).getTime())
    const min = Math.min(...times)
    const max = Math.max(...times)
    const padding = (max - min) * 0.1 || 3_600_000
    return { minTs: min - padding, maxTs: max + padding }
  }, [activeEvents])

  // Minimap scale (must precede callbacks below that reference it)
  const minimapRange = maxTs - minTs

  // Group events by branch for lanes
  const branchLanes = useMemo(() => {
    const map = new Map<string, Event[]>()
    activeEvents.forEach((e) => {
      const lane = map.get(e.branch_id) ?? []
      lane.push(e)
      map.set(e.branch_id, lane)
    })
    return map
  }, [activeEvents])

  const laneOrder = useMemo(() => {
    // Main branch first
    const mainBranch = branches.find((b) => b.is_main)
    const ids = branches.map((b) => b.id)
    if (mainBranch) {
      return [mainBranch.id, ...ids.filter((id) => id !== mainBranch.id)]
    }
    return ids
  }, [branches])

  const activeLanes = useMemo(
    () => laneOrder.filter((id) => branchLanes.has(id)),
    [laneOrder, branchLanes],
  )

  // Track container height (time axis runs vertically)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height)
      setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit all on initial load
  const fitAll = useCallback(() => {
    const range = maxTs - minTs
    let newZoomIdx = 2
    for (let i = 0; i < ZOOM_LEVELS.length; i++) {
      const cfg = ZOOM_CONFIGS[ZOOM_LEVELS[i]]
      if (range / cfg.msPerPixel <= containerHeight * 0.85) {
        newZoomIdx = i
        break
      }
    }
    setZoomIndex(newZoomIdx)
    setOffsetMs(minTs)
  }, [minTs, maxTs, containerHeight])

  // Convert ts to pixel Y
  const tsToY = useCallback(
    (ts: number) => (ts - offsetMs) / msPerPixel,
    [offsetMs, msPerPixel],
  )

  // Generate ticks
  const ticks = useMemo(() => {
    const result: { y: number; label: string }[] = []
    const startTick = Math.floor(offsetMs / tickMs) * tickMs
    const visibleMs = containerHeight * msPerPixel
    let t = startTick
    let count = 0
    while (t <= offsetMs + visibleMs && count < 200) {
      const y = tsToY(t)
      result.push({ y, label: format(new Date(t), tickFormat, { locale: ru }) })
      t += tickMs
      count++
    }
    return result
  }, [offsetMs, containerHeight, msPerPixel, tickMs, tickFormat, tsToY])

  // Wheel scroll (pan through time)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      setOffsetMs((prev) => prev + e.deltaY * msPerPixel)
    },
    [msPerPixel],
  )

  // Drag pan (vertical)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      setIsDragging(true)
      setDragStartY(e.clientY)
      setDragStartOffset(offsetMs)
    },
    [offsetMs],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return
      const dy = e.clientY - dragStartY
      setOffsetMs(dragStartOffset - dy * msPerPixel)
    },
    [isDragging, dragStartY, dragStartOffset, msPerPixel],
  )

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  // Minimap: click track to jump/select a range, drag the highlighted band to move it
  const handleMinimapTrackMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const y = e.clientY - rect.top
      const t = minTs + (y / containerHeight) * minimapRange
      const newOffset = t - (containerHeight * msPerPixel) / 2
      setOffsetMs(newOffset)
      setIsDraggingMinimap(true)
      setMinimapDragStartY(e.clientY)
      setMinimapDragStartOffset(newOffset)
    },
    [minTs, minimapRange, containerHeight, msPerPixel],
  )

  const handleMinimapBandMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsDraggingMinimap(true)
      setMinimapDragStartY(e.clientY)
      setMinimapDragStartOffset(offsetMs)
    },
    [offsetMs],
  )

  useEffect(() => {
    if (!isDraggingMinimap) return
    const scale = minimapRange / containerHeight
    const handleMove = (e: MouseEvent) => {
      const dy = e.clientY - minimapDragStartY
      setOffsetMs(minimapDragStartOffset + dy * scale)
    }
    const handleUp = () => setIsDraggingMinimap(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDraggingMinimap, minimapDragStartY, minimapDragStartOffset, minimapRange, containerHeight])

  // Chunk rendering: only render visible events (virtualization)
  const visibleEvents = useMemo(() => {
    const margin = containerHeight * msPerPixel * 0.2
    const start = offsetMs - margin
    const end = offsetMs + containerHeight * msPerPixel + margin
    return activeEvents.filter((e) => {
      const t = new Date(e.event_ts).getTime()
      return t >= start && t <= end
    })
  }, [activeEvents, offsetMs, containerHeight, msPerPixel])

  // Auto re-fit whenever there are events but none fall inside the current viewport
  // (e.g. initial load, or a newly added event with a timestamp outside the fitted range).
  // Skipped while the user is actively panning/scrubbing, since passing through an empty
  // stretch of time is expected there and shouldn't force a zoom reset.
  useEffect(() => {
    if (isDragging || isDraggingMinimap) return
    if (activeEvents.length > 0 && visibleEvents.length === 0) {
      fitAll()
    }
  }, [activeEvents.length, visibleEvents.length, fitAll, isDragging, isDraggingMinimap])

  const laneWidth =
    activeLanes.length > 0
      ? Math.max(
          LANE_WIDTH,
          Math.floor((containerWidth - AXIS_WIDTH - MINIMAP_WIDTH) / activeLanes.length),
        )
      : LANE_WIDTH

  const totalWidth = AXIS_WIDTH + activeLanes.length * laneWidth + EVENT_MARGIN

  // Minimap viewport indicator position
  const minimapVisibleStart = ((offsetMs - minTs) / minimapRange) * containerHeight
  const minimapVisibleHeight = (containerHeight * msPerPixel / minimapRange) * containerHeight

  const toggleType = (t: EventType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) {
        if (next.size > 1) next.delete(t)
      } else {
        next.add(t)
      }
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        {/* Zoom buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            style={toolbarBtnStyle}
            title="Приблизить"
          >
            +
          </button>
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              minWidth: 60,
              textAlign: 'center',
            }}
          >
            {zoomLevel === 'seconds'
              ? 'Секунды'
              : zoomLevel === 'minutes'
                ? 'Минуты'
                : zoomLevel === 'hours'
                  ? 'Часы'
                  : zoomLevel === 'days'
                    ? 'Дни'
                    : zoomLevel === 'weeks'
                      ? 'Недели'
                      : 'Месяцы'}
          </span>
          <button
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
            style={toolbarBtnStyle}
            title="Отдалить"
          >
            −
          </button>
        </div>

        <button onClick={fitAll} style={{ ...toolbarBtnStyle, padding: '3px 10px' }}>
          Вписать всё
        </button>

        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--border)',
          }}
        />

        {/* Type filters */}
        {EVENT_TYPE_ALL.map((t) => (
          <label
            key={t}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              cursor: 'pointer',
              fontSize: 12,
              color: visibleTypes.has(t) ? EVENT_COLORS[t] : 'var(--text-secondary)',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={visibleTypes.has(t)}
              onChange={() => toggleType(t)}
              style={{
                width: 12,
                height: 12,
                accentColor: EVENT_COLORS[t],
                cursor: 'pointer',
              }}
            />
            {EVENT_TYPE_LABELS_SHORT[t]}
          </label>
        ))}

        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
          Событий: {visibleEvents.length} / {activeEvents.length}
        </div>
      </div>

      {/* Timeline canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
          position: 'relative',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          display: 'flex',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            minWidth: totalWidth,
            height: '100%',
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {/* Horizontal grid lines */}
          {ticks.map(({ y }, i) => (
            <div
              key={`grid-${i}`}
              style={{
                position: 'absolute',
                top: HEADER_HEIGHT + y,
                left: AXIS_WIDTH,
                right: 0,
                height: 1,
                background: 'rgba(48,54,61,0.5)',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Lane column separators */}
          {activeLanes.map((branchId, laneIdx) => (
            <div
              key={`col-${branchId}`}
              style={{
                position: 'absolute',
                top: HEADER_HEIGHT,
                bottom: 0,
                left: AXIS_WIDTH + laneIdx * laneWidth,
                width: laneWidth,
                borderRight: '1px solid var(--border)',
              }}
            />
          ))}

          {/* Lane headers */}
          {activeLanes.map((branchId, laneIdx) => {
            const branch = branches.find((b) => b.id === branchId)
            return (
              <div
                key={`header-${branchId}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: AXIS_WIDTH + laneIdx * laneWidth,
                  width: laneWidth,
                  height: HEADER_HEIGHT,
                  background: 'var(--bg-primary)',
                  borderRight: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 10px',
                  zIndex: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: laneWidth - 20,
                    }}
                  >
                    {branch?.name ?? branchId.slice(0, 8)}
                  </div>
                  {branch?.is_main && (
                    <span style={{ fontSize: 10, color: 'var(--accent)' }}>главная</span>
                  )}
                </div>
              </div>
            )
          })}

          {/* Events */}
          {activeLanes.map((branchId, laneIdx) => {
            const laneEvents = visibleEvents.filter((e) => e.branch_id === branchId)
            const colLeft = AXIS_WIDTH + laneIdx * laneWidth
            const compact = msPerPixel > 300_000
            const cardWidth = compact ? CARD_WIDTH_COMPACT : CARD_WIDTH_FULL

            return laneEvents.map((event) => {
              const y = tsToY(new Date(event.event_ts).getTime())
              return (
                <div
                  key={event.id}
                  style={{
                    position: 'absolute',
                    top: HEADER_HEIGHT + y,
                    left: colLeft + (laneWidth - cardWidth) / 2,
                    zIndex: 5,
                  }}
                >
                  <EventCard
                    event={event}
                    onClick={onEventClick}
                    isSelected={event.id === selectedEventId}
                    compact={compact}
                  />
                </div>
              )
            })
          })}

          {/* Empty state */}
          {activeLanes.length === 0 && (
            <div
              style={{
                position: 'absolute',
                top: HEADER_HEIGHT + 40,
                left: AXIS_WIDTH + 20,
                right: 0,
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: 14,
              }}
            >
              Нет событий для отображения. Добавьте первое событие.
            </div>
          )}

          {/* Sticky vertical time axis (includes frozen corner) */}
          <div
            style={{
              position: 'sticky',
              left: 0,
              top: 0,
              width: AXIS_WIDTH,
              height: '100%',
              background: 'var(--bg-primary)',
              borderRight: '1px solid var(--border)',
              zIndex: 20,
            }}
          >
            {/* Corner */}
            <div style={{ height: HEADER_HEIGHT, borderBottom: '1px solid var(--border)' }} />
            {/* Tick labels */}
            <div style={{ position: 'relative', height: `calc(100% - ${HEADER_HEIGHT}px)`, overflow: 'hidden' }}>
              {ticks.map(({ y, label }, i) => (
                <div
                  key={`tick-${i}`}
                  style={{
                    position: 'absolute',
                    top: y,
                    left: 0,
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <div style={{ width: 8, height: 1, background: 'var(--border)', marginLeft: 4 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Minimap */}
        <div
          onMouseDown={handleMinimapTrackMouseDown}
          style={{
            position: 'sticky',
            right: 0,
            top: 0,
            width: MINIMAP_WIDTH,
            height: '100%',
            background: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border)',
            overflow: 'hidden',
            zIndex: 30,
            flexShrink: 0,
            marginLeft: 'auto',
            cursor: isDraggingMinimap ? 'grabbing' : 'pointer',
          }}
        >
          {/* Minimap events */}
          {activeEvents.map((e) => {
            const y = ((new Date(e.event_ts).getTime() - minTs) / minimapRange) * containerHeight
            return (
              <div
                key={e.id}
                style={{
                  position: 'absolute',
                  top: y,
                  left: 8,
                  width: MINIMAP_WIDTH - 16,
                  height: 3,
                  background: EVENT_COLORS[e.event_type],
                  borderRadius: 2,
                  opacity: 0.7,
                }}
              />
            )
          })}
          {/* Viewport indicator — drag to move the visible range */}
          <div
            onMouseDown={handleMinimapBandMouseDown}
            style={{
              position: 'absolute',
              top: Math.max(0, minimapVisibleStart),
              left: 0,
              height: Math.min(containerHeight, minimapVisibleHeight),
              width: '100%',
              background: isDraggingMinimap ? 'rgba(88,166,255,0.22)' : 'rgba(88,166,255,0.1)',
              border: '1px solid rgba(88,166,255,0.4)',
              cursor: isDraggingMinimap ? 'grabbing' : 'grab',
            }}
          />
        </div>
      </div>
    </div>
  )
}

const toolbarBtnStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  color: 'var(--text-primary)',
  padding: '3px 8px',
  fontSize: 13,
  cursor: 'pointer',
}
