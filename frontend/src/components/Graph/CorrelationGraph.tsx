import React, { useCallback, useMemo, useRef, useState } from 'react'
import type { CorrelationGraphEdge, CorrelationGraphNode, GraphNodeKind } from '../../types'
import { ALERT_STATUS_COLORS, ALERT_STATUS_LABELS } from '../../types'

interface CorrelationGraphProps {
  nodes: CorrelationGraphNode[]
  edges: CorrelationGraphEdge[]
  onAlertClick: (alertId: string) => void
}

type Position = { x: number; y: number }

const ENTITY_COLOR: Record<Exclude<GraphNodeKind, 'alert'>, string> = {
  ip: '#58a6ff',
  account: '#bc8cff',
  file: '#3fb950',
}

const ENTITY_LABEL: Record<Exclude<GraphNodeKind, 'alert'>, string> = {
  ip: 'IP-адрес',
  account: 'Учётная запись',
  file: 'Файл',
}

const ALERT_RADIUS = 9
const CANVAS_W = 2400
const CANVAS_H = 1600

function hashSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0xffffffff
  }
  return Math.abs(h)
}

function entityRadius(degree: number): number {
  return Math.min(28, 10 + Math.sqrt(degree) * 3)
}

function computeLayout(
  nodes: CorrelationGraphNode[],
  edges: CorrelationGraphEdge[],
): Record<string, Position> {
  const positions: Record<string, Position> = {}
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2
    const radius = Math.min(CANVAS_W, CANVAS_H) * 0.32
    const jitter = hashSeed(n.id) % 60
    positions[n.id] = {
      x: CANVAS_W / 2 + radius * Math.cos(angle) + jitter,
      y: CANVAS_H / 2 + radius * Math.sin(angle) + jitter,
    }
  })

  const velocities: Record<string, Position> = {}
  nodes.forEach((n) => {
    velocities[n.id] = { x: 0, y: 0 }
  })

  const n = nodes.length
  const iterations = n > 250 ? 60 : n > 150 ? 100 : 200
  const repulsion = 3200
  const springLength = 130
  const springStrength = 0.02
  const damping = 0.82
  const centerStrength = 0.0015

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      const pa = positions[a.id]
      let fx = 0
      let fy = 0
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const pb = positions[nodes[j].id]
        const dx = pa.x - pb.x
        const dy = pa.y - pb.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) distSq = 1
        const dist = Math.sqrt(distSq)
        const force = repulsion / distSq
        fx += (dx / dist) * force
        fy += (dy / dist) * force
      }
      fx += (CANVAS_W / 2 - pa.x) * centerStrength
      fy += (CANVAS_H / 2 - pa.y) * centerStrength
      const v = velocities[a.id]
      v.x = (v.x + fx) * damping
      v.y = (v.y + fy) * damping
    }

    for (const e of edges) {
      const s = positions[e.source]
      const t = positions[e.target]
      if (!s || !t) continue
      const dx = t.x - s.x
      const dy = t.y - s.y
      const dist = Math.max(0.5, Math.sqrt(dx * dx + dy * dy))
      const diff = (dist - springLength) * springStrength
      const ux = dx / dist
      const uy = dy / dist
      velocities[e.source].x += ux * diff
      velocities[e.source].y += uy * diff
      velocities[e.target].x -= ux * diff
      velocities[e.target].y -= uy * diff
    }

    for (const node of nodes) {
      positions[node.id].x += velocities[node.id].x
      positions[node.id].y += velocities[node.id].y
    }
  }

  return positions
}

type EntityKind = Exclude<GraphNodeKind, 'alert'>

export const CorrelationGraph: React.FC<CorrelationGraphProps> = ({ nodes, edges, onAlertClick }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.55)
  const [pan, setPan] = useState<Position>({ x: 40, y: 20 })
  const [isPanning, setIsPanning] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hiddenKinds, setHiddenKinds] = useState<Set<EntityKind>>(new Set())
  const dragStartClient = useRef<Position>({ x: 0, y: 0 })

  const toggleKind = (kind: EntityKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const nodeById = useMemo(() => {
    const map = new Map<string, CorrelationGraphNode>()
    nodes.forEach((node) => map.set(node.id, node))
    return map
  }, [nodes])

  // Layout is computed once from the full (unfiltered) graph so toggling a
  // category filter just hides nodes/edges in place instead of reshuffling
  // everything else's position.
  const positions = useMemo(() => computeLayout(nodes, edges), [nodes, edges])

  const visibleEdges = useMemo(
    () => edges.filter((e) => !hiddenKinds.has(e.kind)),
    [edges, hiddenKinds],
  )
  const visibleNodes = useMemo(() => {
    if (hiddenKinds.size === 0) return nodes
    const connectedAlertIds = new Set(visibleEdges.map((e) => e.target))
    return nodes.filter((n) => (n.kind === 'alert' ? connectedAlertIds.has(n.id) : !hiddenKinds.has(n.kind)))
  }, [nodes, visibleEdges, hiddenKinds])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const worldX = (cursorX - pan.x) / zoom
      const worldY = (cursorY - pan.y) / zoom
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.min(3, Math.max(0.15, zoom * factor))
      setPan({ x: cursorX - worldX * newZoom, y: cursorY - worldY * newZoom })
      setZoom(newZoom)
    },
    [pan, zoom],
  )

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsPanning(true)
    dragStartClient.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return
    setPan({ x: e.clientX - dragStartClient.current.x, y: e.clientY - dragStartClient.current.y })
  }
  const handleMouseUp = () => setIsPanning(false)

  const handleZoomButton = (dir: 1 | -1) => {
    setZoom((z) => Math.min(3, Math.max(0.15, z * (dir === 1 ? 1.25 : 1 / 1.25))))
  }
  const handleFit = () => {
    setZoom(0.55)
    setPan({ x: 40, y: 20 })
  }

  const hoveredNode = hoveredId ? nodeById.get(hoveredId) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          flexWrap: 'wrap',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Категории:</span>
          <Legend
            color={ENTITY_COLOR.ip}
            label="IP-адрес"
            shape="diamond"
            active={!hiddenKinds.has('ip')}
            onClick={() => toggleKind('ip')}
          />
          <Legend
            color={ENTITY_COLOR.account}
            label="Учётная запись"
            shape="diamond"
            active={!hiddenKinds.has('account')}
            onClick={() => toggleKind('account')}
          />
          <Legend
            color={ENTITY_COLOR.file}
            label="Файл"
            shape="diamond"
            active={!hiddenKinds.has('file')}
            onClick={() => toggleKind('file')}
          />
          <Legend color="var(--text-secondary)" label="Алерт" shape="circle" />
        </div>
      </div>

      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--bg-primary)',
          cursor: isPanning ? 'grabbing' : 'grab',
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
          <svg
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
          >
            {visibleEdges.map((e, idx) => {
              const s = positions[e.source]
              const t = positions[e.target]
              if (!s || !t) return null
              const dimmed = hoveredId != null && e.source !== hoveredId && e.target !== hoveredId
              return (
                <line
                  key={`${e.source}-${e.target}-${idx}`}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={dimmed ? 'var(--border)' : ENTITY_COLOR[e.kind]}
                  strokeOpacity={dimmed ? 0.25 : 0.55}
                  strokeWidth={1.4}
                />
              )
            })}
          </svg>

          {visibleNodes.map((node) => {
            const pos = positions[node.id]
            if (!pos) return null
            const isAlert = node.kind === 'alert'
            const color = node.kind === 'alert'
              ? node.status
                ? ALERT_STATUS_COLORS[node.status]
                : 'var(--text-secondary)'
              : ENTITY_COLOR[node.kind]
            const radius = isAlert ? ALERT_RADIUS : entityRadius(node.degree)
            const isHovered = node.id === hoveredId
            const title = node.kind === 'alert'
              ? node.label
              : `${ENTITY_LABEL[node.kind]}: ${node.label} (${node.degree} алертов)`

            return (
              <div
                key={node.id}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId((prev) => (prev === node.id ? null : prev))}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isAlert) onAlertClick(node.id)
                }}
                title={title}
                style={{
                  position: 'absolute',
                  left: pos.x - radius,
                  top: pos.y - radius,
                  width: radius * 2,
                  height: radius * 2,
                  borderRadius: isAlert ? '50%' : 6,
                  transform: isAlert ? undefined : 'rotate(45deg)',
                  background: color,
                  opacity: hoveredId && !isHovered ? 0.35 : 1,
                  boxShadow: isHovered ? `0 0 0 3px ${color}55` : '0 1px 4px rgba(0,0,0,0.4)',
                  cursor: isAlert ? 'pointer' : 'default',
                  zIndex: isHovered ? 20 : isAlert ? 5 : 8,
                }}
              />
            )
          })}

          {visibleNodes.map((node) => {
            const pos = positions[node.id]
            if (!pos) return null
            const isAlert = node.kind === 'alert'
            const radius = isAlert ? ALERT_RADIUS : entityRadius(node.degree)
            const isHovered = node.id === hoveredId
            const maxChars = isAlert ? 18 : 24
            const label = node.label.length > maxChars ? `${node.label.slice(0, maxChars)}…` : node.label
            return (
              <div
                key={`label-${node.id}`}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y + radius + 3,
                  transform: 'translateX(-50%)',
                  fontSize: 10,
                  fontWeight: isHovered ? 700 : 400,
                  color: isAlert && !isHovered ? 'var(--text-secondary)' : 'var(--text-primary)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '1px 5px',
                  whiteSpace: 'nowrap',
                  opacity: hoveredId && !isHovered ? 0.5 : 1,
                  pointerEvents: 'none',
                  zIndex: isHovered ? 22 : isAlert ? 6 : 9,
                }}
              >
                {label}
              </div>
            )
          })}

          {visibleNodes.length === 0 && (
            <div style={{ position: 'absolute', left: 40, top: 40, color: 'var(--text-secondary)', fontSize: 14 }}>
              Нет связей для отображения за выбранный период
            </div>
          )}
        </div>
      </div>

      {hoveredNode && hoveredNode.kind === 'alert' && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 12,
            maxWidth: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <strong>{hoveredNode.label}</strong>
          {hoveredNode.status && (
            <span style={{ color: 'var(--text-secondary)' }}> · {ALERT_STATUS_LABELS[hoveredNode.status]}</span>
          )}
        </div>
      )}
    </div>
  )
}

const Legend: React.FC<{
  color: string
  label: string
  shape: 'circle' | 'diamond'
  active?: boolean
  onClick?: () => void
}> = ({ color, label, shape, active = true, onClick }) => (
  <button
    onClick={onClick}
    disabled={!onClick}
    title={onClick ? (active ? `Скрыть «${label}»` : `Показать «${label}»`) : undefined}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      color: 'var(--text-secondary)',
      background: 'none',
      border: 'none',
      padding: 0,
      fontFamily: 'inherit',
      opacity: active ? 1 : 0.4,
      cursor: onClick ? 'pointer' : 'default',
      textDecoration: !active ? 'line-through' : 'none',
    }}
  >
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: shape === 'circle' ? '50%' : 2,
        transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
        background: color,
      }}
    />
    {label}
  </button>
)

const toolbarBtnStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  color: 'var(--text-primary)',
  padding: '3px 8px',
  fontSize: 13,
  cursor: 'pointer',
}
