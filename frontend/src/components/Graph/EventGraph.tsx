import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Event, EventLink, ActionType } from '../../types'
import { ACTION_TYPE_LABELS } from '../../types'
import { createEventLink, deleteEventLink } from '../../api/events'
import { updateBranchLayout } from '../../api/branches'
import { useCaseStore } from '../../store/case'
import { useToastStore } from '../../store/toast'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

type Position = { x: number; y: number }

interface EventGraphProps {
  events: Event[]
  branchId: string
  onEventClick: (event: Event) => void
  selectedEventId?: string
  initialLayout?: Record<string, Position> | null
}

// Groups events into columns by their causal depth in the link graph (longest
// path from a root with no incoming link), so attack chains read left-to-right
// instead of wrapping into an arbitrary fixed-width grid.
function computeLayerLayout(events: Event[], links: EventLink[]): Record<string, Position> {
  const ids = events.map((e) => e.id)
  const indexOf = new Set(ids)
  const adj = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  const layer = new Map<string, number>()
  for (const id of ids) {
    adj.set(id, [])
    indegree.set(id, 0)
    layer.set(id, 0)
  }
  for (const link of links) {
    if (!indexOf.has(link.source_event_id) || !indexOf.has(link.target_event_id)) continue
    adj.get(link.source_event_id)!.push(link.target_event_id)
    indegree.set(link.target_event_id, (indegree.get(link.target_event_id) ?? 0) + 1)
  }

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0)
  const visited = new Set<string>()
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    if (visited.has(id)) continue
    visited.add(id)
    for (const next of adj.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1))
      const remaining = (indegree.get(next) ?? 1) - 1
      indegree.set(next, remaining)
      if (remaining <= 0 && !visited.has(next)) queue.push(next)
    }
  }

  const byLayer = new Map<number, Event[]>()
  for (const e of events) {
    const l = layer.get(e.id) ?? 0
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(e)
  }
  for (const arr of byLayer.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.event_ts.localeCompare(b.event_ts))
  }

  // Alternate each causal layer between a top and a bottom row (zigzag) —
  // for the common case of a linear attack chain (one node per layer) this
  // reads as a staggered staircase instead of one flat row, which is much
  // easier to trace visually than everything lined up on a single line.
  const positions: Record<string, Position> = {}
  for (const [l, arr] of byLayer.entries()) {
    const baseY = l % 2 === 0 ? ZIGZAG_TOP_Y : ZIGZAG_BOTTOM_Y
    arr.forEach((e, row) => {
      positions[e.id] = { x: GRID_PAD_X + l * GRID_COL_GAP, y: baseY + row * GRID_ROW_GAP }
    })
  }
  return positions
}

const LINK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function todayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nowTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const NODE_W = 190
const NODE_H = 76
const GRID_COL_GAP = 240
const GRID_ROW_GAP = 120
const GRID_PAD_X = 60
const GRID_PAD_Y = 70
const ZIGZAG_TOP_Y = GRID_PAD_Y
const ZIGZAG_BOTTOM_Y = GRID_PAD_Y + NODE_H + 260
const LAYOUT_SAVE_DEBOUNCE_MS = 800

const ACTION_TYPE_COLORS: Record<ActionType, string> = {
  network_connection: '#58a6ff',
  logon_event: '#bc8cff',
  file_operation: '#3fb950',
  command_execution: '#f85149',
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  attacker_action: 'var(--event-attacker)',
  detection: 'var(--event-detection)',
  ir_action: 'var(--event-ir)',
  inference: 'var(--event-inference)',
  legal_event: 'var(--event-legal)',
}

function nodeColor(event: Event): string {
  if (event.action_type) return ACTION_TYPE_COLORS[event.action_type]
  return EVENT_TYPE_COLORS[event.event_type] ?? 'var(--text-secondary)'
}

export const EventGraph: React.FC<EventGraphProps> = ({
  events,
  branchId,
  onEventClick,
  selectedEventId,
  initialLayout,
}) => {
  const toast = useToastStore()
  const { fetchEvents } = useCaseStore()
  const containerRef = useRef<HTMLDivElement>(null)

  const [positions, setPositions] = useState<Record<string, Position>>(() => initialLayout ?? {})
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Position>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null)
  const [cursorWorldPos, setCursorWorldPos] = useState<Position | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [pendingLink, setPendingLink] = useState<{ sourceId: string; targetId: string } | null>(null)
  const [linkDescInput, setLinkDescInput] = useState('')
  const [linkActionType, setLinkActionType] = useState<ActionType>('network_connection')
  const [linkDate, setLinkDate] = useState('')
  const [linkTime, setLinkTime] = useState('')
  const [linkTechnique, setLinkTechnique] = useState('')
  const [isSavingLink, setIsSavingLink] = useState(false)

  const dragMoved = useRef(false)
  const dragStartClient = useRef<Position>({ x: 0, y: 0 })

  const activeEvents = useMemo(() => events.filter((e) => !e.is_deleted), [events])

  // De-duplicate links embedded on both source and target events.
  const rawLinks = useMemo(() => {
    const map = new Map<string, EventLink>()
    for (const e of activeEvents) {
      for (const link of e.linked_events ?? []) {
        map.set(link.id, link)
      }
    }
    return Array.from(map.values())
  }, [activeEvents])

  const links = useMemo(
    () => rawLinks.filter((l) => positions[l.source_event_id] && positions[l.target_event_id]),
    [rawLinks, positions],
  )

  // Reset to the saved layout whenever the branch changes (switching branches
  // reuses this component instance rather than remounting it).
  const prevBranchIdRef = useRef(branchId)
  useEffect(() => {
    if (prevBranchIdRef.current !== branchId) {
      prevBranchIdRef.current = branchId
      setPositions(initialLayout ?? {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId])

  // Assign a default layered position (by causal depth in the link graph,
  // chronological order within a layer) to any event that doesn't have one yet.
  useEffect(() => {
    setPositions((prev) => {
      const missing = activeEvents.filter((e) => !prev[e.id])
      if (missing.length === 0) return prev
      const layout = computeLayerLayout(activeEvents, rawLinks)
      const next = { ...prev }
      for (const e of missing) {
        next[e.id] = layout[e.id]
      }
      return next
    })
  }, [activeEvents, rawLinks])

  // Persist position changes (debounced) so the layout survives a revisit.
  const savedBranchIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (savedBranchIdRef.current !== branchId) {
      // Just loaded/reset for this branch — nothing new to persist yet.
      savedBranchIdRef.current = branchId
      return
    }
    if (Object.keys(positions).length === 0) return
    const timer = setTimeout(() => {
      updateBranchLayout(branchId, positions).catch(() => {
        toast.error('Не удалось сохранить расположение графа')
      })
    }, LAYOUT_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, branchId])

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Position => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      }
    },
    [pan, zoom],
  )

  // ── Zoom (wheel, cursor-anchored) ──────────────────────────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const worldX = (cursorX - pan.x) / zoom
      const worldY = (cursorY - pan.y) / zoom

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newZoom = Math.min(2.5, Math.max(0.3, zoom * factor))

      setPan({ x: cursorX - worldX * newZoom, y: cursorY - worldY * newZoom })
      setZoom(newZoom)
    },
    [pan, zoom],
  )

  // ── Background pan ─────────────────────────────────────────────────────────
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (linkingFromId) {
      setLinkingFromId(null)
      return
    }
    setSelectedLinkId(null)
    setIsPanning(true)
    dragStartClient.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - dragStartClient.current.x, y: e.clientY - dragStartClient.current.y })
    }
    if (draggingId) {
      const world = screenToWorld(e.clientX, e.clientY)
      dragMoved.current = true
      setPositions((prev) => ({
        ...prev,
        [draggingId]: { x: world.x - NODE_W / 2, y: world.y - NODE_H / 2 },
      }))
    }
    if (linkingFromId) {
      setCursorWorldPos(screenToWorld(e.clientX, e.clientY))
    }
  }

  const handleCanvasMouseUp = () => {
    setIsPanning(false)
    setDraggingId(null)
  }

  // ── Node drag & click ──────────────────────────────────────────────────────
  const handleNodeMouseDown = (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    dragMoved.current = false
    setDraggingId(eventId)
  }

  const handleNodeClick = (e: React.MouseEvent, event: Event) => {
    e.stopPropagation()
    if (dragMoved.current) {
      dragMoved.current = false
      return
    }
    if (linkingFromId) {
      if (linkingFromId !== event.id) {
        setPendingLink({ sourceId: linkingFromId, targetId: event.id })
        setLinkDescInput('')
        setLinkActionType('network_connection')
        setLinkDate(todayDateStr())
        setLinkTime(nowTimeStr())
        setLinkTechnique('')
      }
      setLinkingFromId(null)
      return
    }
    onEventClick(event)
  }

  const handleStartLink = (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation()
    setLinkingFromId((prev) => (prev === eventId ? null : eventId))
  }

  // ── Link create/delete ─────────────────────────────────────────────────────
  const refreshLinks = () => {
    fetchEvents(branchId).catch(() => toast.error('Ошибка обновления графа'))
  }

  const handleSaveLink = async () => {
    if (!pendingLink) return
    setIsSavingLink(true)
    try {
      const event_ts =
        linkDate && LINK_TIME_PATTERN.test(linkTime)
          ? new Date(`${linkDate}T${linkTime}:00Z`).toISOString()
          : undefined
      await createEventLink(pendingLink.sourceId, {
        target_event_id: pendingLink.targetId,
        link_type: ACTION_TYPE_LABELS[linkActionType],
        description: linkDescInput.trim() || undefined,
        action_type: linkActionType,
        event_ts,
        mitre_technique: linkTechnique.trim() || undefined,
      })
      toast.success('Связь добавлена')
      setPendingLink(null)
      refreshLinks()
    } catch {
      toast.error('Ошибка создания связи (возможно, уже существует)')
    } finally {
      setIsSavingLink(false)
    }
  }

  const handleDeleteLink = async (linkId: string) => {
    try {
      await deleteEventLink(linkId)
      toast.success('Связь удалена')
      setSelectedLinkId(null)
      refreshLinks()
    } catch {
      toast.error('Ошибка удаления связи')
    }
  }

  const handleZoomButton = (dir: 1 | -1) => {
    setZoom((z) => Math.min(2.5, Math.max(0.3, z * (dir === 1 ? 1.2 : 1 / 1.2))))
  }

  const handleFit = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const selectedLink = links.find((l) => l.id === selectedLinkId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => handleZoomButton(1)} style={toolbarBtnStyle} title="Приблизить">
            +
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 42, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => handleZoomButton(-1)} style={toolbarBtnStyle} title="Отдалить">
            −
          </button>
        </div>
        <button onClick={handleFit} style={{ ...toolbarBtnStyle, padding: '3px 10px' }}>
          Сбросить масштаб
        </button>

        {linkingFromId && (
          <span style={{ fontSize: 12, color: 'var(--accent)' }}>
            Выберите второе действие для связи, или кликните по пустому месту, чтобы отменить
          </span>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--bg-primary)',
          cursor: isPanning ? 'grabbing' : linkingFromId ? 'crosshair' : 'grab',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Edges */}
          <svg
            width={4000}
            height={3000}
            style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
          >
            <defs>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="var(--text-secondary)" />
              </marker>
            </defs>
            {links.map((link) => {
              const from = positions[link.source_event_id]
              const to = positions[link.target_event_id]
              if (!from || !to) return null
              const x1 = from.x + NODE_W / 2
              const y1 = from.y + NODE_H / 2
              const x2 = to.x + NODE_W / 2
              const y2 = to.y + NODE_H / 2
              const isSelected = link.id === selectedLinkId
              return (
                <g key={link.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth={14}
                    onClick={() => setSelectedLinkId(link.id)}
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isSelected ? 'var(--accent)' : 'var(--border)'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    markerEnd="url(#graph-arrow)"
                  />
                </g>
              )
            })}
            {linkingFromId && cursorWorldPos && positions[linkingFromId] && (
              <line
                x1={positions[linkingFromId].x + NODE_W / 2}
                y1={positions[linkingFromId].y + NODE_H / 2}
                x2={cursorWorldPos.x}
                y2={cursorWorldPos.y}
                stroke="var(--accent)"
                strokeWidth={1.5}
                strokeDasharray="5,4"
              />
            )}
          </svg>

          {/* Edge labels */}
          {links.map((link) => {
            const from = positions[link.source_event_id]
            const to = positions[link.target_event_id]
            if (!from || !to) return null
            const mx = (from.x + to.x) / 2 + NODE_W / 2
            const my = (from.y + to.y) / 2 + NODE_H / 2
            const isSelected = link.id === selectedLinkId
            return (
              <div
                key={link.id}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedLinkId(link.id)
                }}
                style={{
                  position: 'absolute',
                  left: mx,
                  top: my,
                  transform: 'translate(-50%, -50%)',
                  background: isSelected ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '2px 8px',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  zIndex: 5,
                }}
                title={link.description ?? undefined}
              >
                {link.link_type}
              </div>
            )
          })}

          {/* Nodes */}
          {activeEvents.map((event) => {
            const pos = positions[event.id]
            if (!pos) return null
            const color = nodeColor(event)
            const isSelected = event.id === selectedEventId
            const isLinkSource = event.id === linkingFromId
            return (
              <div
                key={event.id}
                onMouseDown={(e) => handleNodeMouseDown(e, event.id)}
                onClick={(e) => handleNodeClick(e, event)}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  width: NODE_W,
                  minHeight: NODE_H,
                  background: 'var(--bg-secondary)',
                  border: `1.5px solid ${isLinkSource ? 'var(--accent)' : color}`,
                  borderLeft: `4px solid ${color}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  boxShadow: isSelected ? '0 0 0 2px var(--accent)' : '0 2px 6px rgba(0,0,0,0.3)',
                  zIndex: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {event.title}
                  </div>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => handleStartLink(e, event.id)}
                    title="Создать связь"
                    style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: '1px solid var(--border)',
                      background: isLinkSource ? 'var(--accent)' : 'var(--bg-tertiary)',
                      color: isLinkSource ? '#fff' : 'var(--text-secondary)',
                      fontSize: 11,
                      lineHeight: '16px',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ⚭
                  </button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {event.event_ts && format(new Date(event.event_ts), 'dd.MM.yyyy HH:mm', { locale: ru })}
                </div>
                {event.action_type && (
                  <div style={{ fontSize: 10, color, marginTop: 2 }}>
                    {ACTION_TYPE_LABELS[event.action_type]}
                  </div>
                )}
              </div>
            )
          })}

          {activeEvents.length === 0 && (
            <div
              style={{
                position: 'absolute',
                left: 40,
                top: 40,
                color: 'var(--text-secondary)',
                fontSize: 14,
              }}
            >
              Нет действий для отображения. Добавьте первое действие.
            </div>
          )}
        </div>
      </div>

      {/* Selected link actions */}
      {selectedLink && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <span style={{ fontSize: 12 }}>
            Связь «{selectedLink.link_type}»{selectedLink.description ? `: ${selectedLink.description}` : ''}
          </span>
          <Button variant="danger" size="sm" onClick={() => handleDeleteLink(selectedLink.id)}>
            Удалить связь
          </Button>
        </div>
      )}

      {/* Связь между действиями — тип связи + описательные поля перехода
          (перенесены из бывшей отдельной формы «Добавить факт») */}
      <Modal
        isOpen={!!pendingLink}
        onClose={() => setPendingLink(null)}
        title="Новая связь между действиями"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingLink(null)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveLink}
              isLoading={isSavingLink}
            >
              Создать
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="link-action-type">Тип связи</label>
            <select
              id="link-action-type"
              value={linkActionType}
              autoFocus
              onChange={(e) => setLinkActionType(e.target.value as ActionType)}
            >
              {Object.entries(ACTION_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="link-date">Дата</label>
              <input
                id="link-date"
                type="date"
                value={linkDate}
                onChange={(e) => setLinkDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="link-time">Время (24ч)</label>
              <input
                id="link-time"
                type="text"
                value={linkTime}
                onChange={(e) => setLinkTime(e.target.value)}
                placeholder="ЧЧ:ММ"
                maxLength={5}
              />
            </div>
          </div>

          <div>
            <label htmlFor="link-technique">Техника</label>
            <input
              id="link-technique"
              type="text"
              value={linkTechnique}
              onChange={(e) => setLinkTechnique(e.target.value)}
              placeholder="Например, T1071"
            />
          </div>

          <div>
            <label htmlFor="link-desc">Описание</label>
            <textarea
              id="link-desc"
              value={linkDescInput}
              onChange={(e) => setLinkDescInput(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
              placeholder="Необязательно"
            />
          </div>
        </div>
      </Modal>
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
