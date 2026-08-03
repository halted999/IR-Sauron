import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AlertStatus, CorrelationGraphEdge, CorrelationGraphNode, GraphNodeKind } from '../../types'
import { ALERT_STATUS_COLORS, ALERT_STATUS_LABELS } from '../../types'
import { GraphDetailsPanel, type PanelState } from './GraphDetailsPanel'

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
  ioc: '#d29922',
}

const ENTITY_LABEL: Record<Exclude<GraphNodeKind, 'alert'>, string> = {
  ip: 'IP-адрес',
  account: 'Учётная запись',
  file: 'Файл',
  ioc: 'IOC (домен/URL)',
}

type AlertGroup = 'in_case' | 'no_case'

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

export const CorrelationGraph: React.FC<CorrelationGraphProps> = ({ nodes, edges, onAlertClick }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.55)
  const [pan, setPan] = useState<Position>({ x: 40, y: 20 })
  const [isPanning, setIsPanning] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hiddenKinds, setHiddenKinds] = useState<Set<GraphNodeKind>>(new Set())
  const [hiddenAlertGroups, setHiddenAlertGroups] = useState<Set<AlertGroup>>(new Set())
  const dragStartClient = useRef<Position>({ x: 0, y: 0 })

  const toggleKind = (kind: GraphNodeKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const toggleAlertGroup = (group: AlertGroup) => {
    setHiddenAlertGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const alertGroupCounts = useMemo(() => {
    let inCase = 0
    let noCase = 0
    for (const n of nodes) {
      if (n.kind !== 'alert') continue
      if (n.case_id) inCase++
      else noCase++
    }
    return { inCase, noCase }
  }, [nodes])

  const nodeById = useMemo(() => {
    const map = new Map<string, CorrelationGraphNode>()
    nodes.forEach((node) => map.set(node.id, node))
    return map
  }, [nodes])

  // Auto-layout (force-directed) runs once per distinct node/edge set, then
  // nodes can be dragged freely — a manual drag must not get clobbered by a
  // re-render, so positions live in state rather than a derived useMemo.
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const layoutKeyRef = useRef<string>('')
  useEffect(() => {
    const key = `${nodes.map((n) => n.id).join(',')}|${edges.length}`
    if (layoutKeyRef.current !== key) {
      layoutKeyRef.current = key
      setPositions(computeLayout(nodes, edges))
    }
  }, [nodes, edges])

  const handleAutoLayout = () => {
    setPositions(computeLayout(nodes, edges))
  }

  const visibleEdges = useMemo(
    () => edges.filter((e) => !hiddenKinds.has(e.kind)),
    [edges, hiddenKinds],
  )
  const visibleNodes = useMemo(() => {
    if (hiddenKinds.size === 0 && hiddenAlertGroups.size === 0) return nodes
    const connectedAlertIds = new Set(visibleEdges.map((e) => e.target))
    return nodes.filter((n) => {
      if (n.kind === 'alert') {
        if (hiddenKinds.has('alert')) return false
        const group: AlertGroup = n.case_id ? 'in_case' : 'no_case'
        if (hiddenAlertGroups.has(group)) return false
        // Entity-kind filters (ip/account/file/ioc) require the alert to still
        // have a surviving edge; group/kind-only filters don't touch edges,
        // so an isolated seed alert stays visible.
        if (hiddenKinds.size === 0) return true
        return connectedAlertIds.has(n.id)
      }
      return !hiddenKinds.has(n.kind)
    })
  }, [nodes, visibleEdges, hiddenKinds, hiddenAlertGroups])

  // Alerts that correlate through the exact same set of entities are "similar"
  // — collapsed into a single synthetic node so a cluster of near-duplicate
  // alerts doesn't clutter the graph. Real alert ids are kept in
  // groupMembersById for the details panel and edges are re-pointed at the
  // group node (deduplicated per source/kind).
  const { displayNodes, displayEdges, groupMembersById, groupEntityCountsById } = useMemo(() => {
    const neighborsByAlertId = new Map<string, string[]>()
    visibleEdges.forEach((e) => {
      const arr = neighborsByAlertId.get(e.target) ?? []
      arr.push(e.source)
      neighborsByAlertId.set(e.target, arr)
    })

    const keyToAlertIds = new Map<string, string[]>()
    visibleNodes.forEach((n) => {
      if (n.kind !== 'alert') return
      const neighbors = neighborsByAlertId.get(n.id)
      if (!neighbors || neighbors.length === 0) return
      const key = [...neighbors].sort().join('|')
      const arr = keyToAlertIds.get(key) ?? []
      arr.push(n.id)
      keyToAlertIds.set(key, arr)
    })

    const groupIdByAlertId = new Map<string, string>()
    const groupMembersById = new Map<string, string[]>()
    const groupEntityCountsById = new Map<string, Record<string, number>>()
    const groupNodeById = new Map<string, CorrelationGraphNode>()
    const statusPriority: AlertStatus[] = ['escalated', 'triaged', 'new', 'dismissed']

    for (const [key, ids] of keyToAlertIds) {
      if (ids.length < 2) continue
      const groupId = `group:${key}`
      ids.forEach((id) => groupIdByAlertId.set(id, groupId))
      groupMembersById.set(groupId, ids)

      const entityCounts: Record<string, number> = { ip: 0, account: 0, file: 0, ioc: 0 }
      key.split('|').forEach((entityId) => {
        const kind = entityId.slice(0, entityId.indexOf(':'))
        if (kind in entityCounts) entityCounts[kind] += 1
      })
      groupEntityCountsById.set(groupId, entityCounts)

      const members = ids.map((id) => nodeById.get(id)).filter((m): m is CorrelationGraphNode => !!m)
      const status = statusPriority.find((s) => members.some((m) => m.status === s))
      const caseIds = new Set(members.map((m) => m.case_id ?? null))
      groupNodeById.set(groupId, {
        id: groupId,
        kind: 'alert',
        label: `${ids.length} похожих алертов`,
        status,
        degree: ids.length,
        case_id: caseIds.size === 1 ? [...caseIds][0] ?? undefined : undefined,
      })
    }

    const displayNodes: CorrelationGraphNode[] = []
    const seenGroupIds = new Set<string>()
    visibleNodes.forEach((n) => {
      const groupId = n.kind === 'alert' ? groupIdByAlertId.get(n.id) : undefined
      if (groupId) {
        if (seenGroupIds.has(groupId)) return
        seenGroupIds.add(groupId)
        displayNodes.push(groupNodeById.get(groupId)!)
        return
      }
      displayNodes.push(n)
    })

    const edgeKeySeen = new Set<string>()
    const displayEdges: CorrelationGraphEdge[] = []
    visibleEdges.forEach((e) => {
      const target = groupIdByAlertId.get(e.target) ?? e.target
      const key = `${e.source}->${target}:${e.kind}`
      if (edgeKeySeen.has(key)) return
      edgeKeySeen.add(key)
      displayEdges.push({ source: e.source, target, kind: e.kind })
    })

    return { displayNodes, displayEdges, groupMembersById, groupEntityCountsById }
  }, [visibleNodes, visibleEdges, nodeById])

  // Which alerts mention each entity — used by the details panel's "mentions" table.
  const mentionsByEntityId = useMemo(() => {
    const map = new Map<string, string[]>()
    visibleEdges.forEach((e) => {
      const arr = map.get(e.source) ?? []
      arr.push(e.target)
      map.set(e.source, arr)
    })
    return map
  }, [visibleEdges])

  const [panel, setPanel] = useState<PanelState | null>(null)

  // Group nodes are synthetic (not part of the force layout), so once their
  // member alerts have positions, place the group at the members' centroid.
  useEffect(() => {
    setPositions((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [groupId, memberIds] of groupMembersById) {
        if (next[groupId]) continue
        const memberPositions = memberIds.map((id) => prev[id]).filter((p): p is Position => !!p)
        if (memberPositions.length === 0) continue
        next[groupId] = {
          x: memberPositions.reduce((s, p) => s + p.x, 0) / memberPositions.length,
          y: memberPositions.reduce((s, p) => s + p.y, 0) / memberPositions.length,
        }
        changed = true
      }
      return changed ? next : prev
    })
  }, [groupMembersById])

  // Chain size per node: how many nodes are reachable through displayed edges
  // (union-find over the currently displayed graph). Edges inside a chain of
  // 3+ nodes get a thicker stroke so correlated clusters stand out from
  // one-off pairs.
  const chainSizeByNode = useMemo(() => {
    const parent = new Map<string, string>()
    displayNodes.forEach((n) => parent.set(n.id, n.id))
    const find = (x: string): string => {
      let root = x
      while (parent.get(root) !== root) root = parent.get(root)!
      let cur = x
      while (parent.get(cur) !== root) {
        const next = parent.get(cur)!
        parent.set(cur, root)
        cur = next
      }
      return root
    }
    const union = (a: string, b: string) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    displayEdges.forEach((e) => {
      if (parent.has(e.source) && parent.has(e.target)) union(e.source, e.target)
    })
    const sizeByRoot = new Map<string, number>()
    displayNodes.forEach((n) => {
      const root = find(n.id)
      sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1)
    })
    const result = new Map<string, number>()
    displayNodes.forEach((n) => result.set(n.id, sizeByRoot.get(find(n.id)) ?? 1))
    return result
  }, [displayNodes, displayEdges])

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

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragMoved = useRef(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsPanning(true)
    dragStartClient.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingId) {
      dragMoved.current = true
      const world = screenToWorld(e.clientX, e.clientY)
      setPositions((prev) => ({ ...prev, [draggingId]: world }))
      return
    }
    if (!isPanning) return
    setPan({ x: e.clientX - dragStartClient.current.x, y: e.clientY - dragStartClient.current.y })
  }
  const handleMouseUp = () => {
    setIsPanning(false)
    setDraggingId(null)
  }

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    dragMoved.current = false
    setDraggingId(nodeId)
  }

  const handleNodeClick = (e: React.MouseEvent, node: CorrelationGraphNode) => {
    e.stopPropagation()
    if (dragMoved.current) {
      dragMoved.current = false
      return
    }
    if (node.kind === 'alert') {
      if (groupMembersById.has(node.id)) {
        setPanel({ kind: 'alert-group', groupId: node.id })
      } else {
        setPanel({ kind: 'alert', nodeId: node.id })
      }
    } else {
      setPanel({ kind: 'entity', nodeId: node.id })
    }
  }

  const handleZoomButton = (dir: 1 | -1) => {
    setZoom((z) => Math.min(3, Math.max(0.15, z * (dir === 1 ? 1.25 : 1 / 1.25))))
  }
  const handleFit = () => {
    setZoom(0.55)
    setPan({ x: 40, y: 20 })
  }

  const hoveredNode = hoveredId ? nodeById.get(hoveredId) : null

  return (
    <div style={{ display: 'flex', height: '100%' }}>
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, position: 'relative' }}>
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
        <button
          onClick={handleAutoLayout}
          style={{ ...toolbarBtnStyle, padding: '3px 10px' }}
          title="Заново расставить элементы автоматически"
        >
          Автораскладка
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Показывать:</span>
          <FilterCheckbox
            color="var(--text-secondary)"
            label="Алерты"
            shape="circle"
            checked={!hiddenKinds.has('alert')}
            onChange={() => toggleKind('alert')}
          />
          <FilterCheckbox
            color="var(--accent)"
            label={`В инциденте (${alertGroupCounts.inCase})`}
            shape="circle"
            outline="solid"
            checked={!hiddenAlertGroups.has('in_case')}
            onChange={() => toggleAlertGroup('in_case')}
          />
          <FilterCheckbox
            color="var(--border)"
            label={`Без инцидента (${alertGroupCounts.noCase})`}
            shape="circle"
            outline="dashed"
            checked={!hiddenAlertGroups.has('no_case')}
            onChange={() => toggleAlertGroup('no_case')}
          />
          <FilterCheckbox
            color={ENTITY_COLOR.ip}
            label="IP-адрес"
            shape="diamond"
            checked={!hiddenKinds.has('ip')}
            onChange={() => toggleKind('ip')}
          />
          <FilterCheckbox
            color={ENTITY_COLOR.account}
            label="Учётная запись"
            shape="diamond"
            checked={!hiddenKinds.has('account')}
            onChange={() => toggleKind('account')}
          />
          <FilterCheckbox
            color={ENTITY_COLOR.file}
            label="Файл"
            shape="diamond"
            checked={!hiddenKinds.has('file')}
            onChange={() => toggleKind('file')}
          />
          <FilterCheckbox
            color={ENTITY_COLOR.ioc}
            label="IOC (домен/URL)"
            shape="diamond"
            checked={!hiddenKinds.has('ioc')}
            onChange={() => toggleKind('ioc')}
          />
          <Legend color={ALERT_STATUS_COLORS.escalated} label="Эскалирован" shape="circle" bold />
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
            {displayEdges.map((e, idx) => {
              const s = positions[e.source]
              const t = positions[e.target]
              if (!s || !t) return null
              const dimmed = hoveredId != null && e.source !== hoveredId && e.target !== hoveredId
              const chainSize = chainSizeByNode.get(e.source) ?? 1
              const isChain = chainSize >= 3
              return (
                <line
                  key={`${e.source}-${e.target}-${idx}`}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={dimmed ? 'var(--border)' : ENTITY_COLOR[e.kind]}
                  strokeOpacity={dimmed ? 0.25 : isChain ? 0.75 : 0.55}
                  strokeWidth={isChain ? 3 : 1.4}
                />
              )
            })}
          </svg>

          {displayNodes.map((node) => {
            const pos = positions[node.id]
            if (!pos) return null
            const isAlert = node.kind === 'alert'
            const isGroup = groupMembersById.has(node.id)
            const color = node.kind === 'alert'
              ? node.status
                ? ALERT_STATUS_COLORS[node.status]
                : 'var(--text-secondary)'
              : ENTITY_COLOR[node.kind]
            const radius = isAlert
              ? isGroup
                ? Math.min(22, ALERT_RADIUS + Math.sqrt(node.degree) * 2.5)
                : ALERT_RADIUS
              : entityRadius(node.degree)
            const isHovered = node.id === hoveredId
            const isEscalated = isAlert && node.status === 'escalated'
            const inCase = isAlert && !!node.case_id
            const title = node.kind === 'alert'
              ? isGroup
                ? `${node.label} (нажмите, чтобы посмотреть список)`
                : `${node.label}${inCase ? ' · в инциденте' : ' · без инцидента'}`
              : `${ENTITY_LABEL[node.kind]}: ${node.label} (${node.degree} алертов)`

            const alertBorder = isEscalated
              ? '3px solid var(--text-primary)'
              : inCase
                ? '2px solid var(--accent)'
                : '2px dashed var(--border)'

            return (
              <React.Fragment key={node.id}>
                <div
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId((prev) => (prev === node.id ? null : prev))}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={(e) => handleNodeClick(e, node)}
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
                    border: isAlert ? alertBorder : '3px solid transparent',
                    boxSizing: 'border-box',
                    opacity: hoveredId && !isHovered ? 0.35 : 1,
                    boxShadow: isHovered ? `0 0 0 3px ${color}55` : '0 1px 4px rgba(0,0,0,0.4)',
                    cursor: draggingId === node.id ? 'grabbing' : 'grab',
                    zIndex: isHovered ? 20 : isAlert ? 5 : 8,
                  }}
                />
                {isGroup && (
                  <div
                    style={{
                      position: 'absolute',
                      left: pos.x + radius * 0.55,
                      top: pos.y - radius * 0.95,
                      minWidth: 15,
                      height: 15,
                      padding: '0 3px',
                      borderRadius: 8,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--text-primary)',
                      color: 'var(--text-primary)',
                      fontSize: 9,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                      zIndex: isHovered ? 21 : 7,
                    }}
                  >
                    {node.degree}
                  </div>
                )}
              </React.Fragment>
            )
          })}

          {displayNodes.map((node) => {
            const pos = positions[node.id]
            if (!pos) return null
            const isAlert = node.kind === 'alert'
            const isGroup = groupMembersById.has(node.id)
            const radius = isAlert
              ? isGroup
                ? Math.min(22, ALERT_RADIUS + Math.sqrt(node.degree) * 2.5)
                : ALERT_RADIUS
              : entityRadius(node.degree)
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

          {displayNodes.length === 0 && (
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
          <span style={{ color: 'var(--text-secondary)' }}>
            {' '}
            · {hoveredNode.case_id ? 'в инциденте' : 'без инцидента'}
          </span>
        </div>
      )}
    </div>
    {panel && (
      <GraphDetailsPanel
        panel={panel}
        onClose={() => setPanel(null)}
        nodeById={nodeById}
        groupMembersById={groupMembersById}
        groupEntityCountsById={groupEntityCountsById}
        mentionsByEntityId={mentionsByEntityId}
        onOpenAlert={onAlertClick}
      />
    )}
    </div>
  )
}

const FilterCheckbox: React.FC<{
  color: string
  label: string
  shape: 'circle' | 'diamond'
  checked: boolean
  onChange: () => void
  outline?: 'solid' | 'dashed'
}> = ({ color, label, shape, checked, onChange, outline }) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      color: 'var(--text-secondary)',
      cursor: 'pointer',
      userSelect: 'none',
      opacity: checked ? 1 : 0.45,
    }}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={{ width: 12, height: 12, margin: 0, cursor: 'pointer', accentColor: color }}
    />
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: shape === 'circle' ? '50%' : 2,
        transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
        background: outline ? 'transparent' : color,
        border: outline ? `2px ${outline} ${color}` : undefined,
        boxSizing: 'border-box',
      }}
    />
    {label}
  </label>
)

const Legend: React.FC<{
  color: string
  label: string
  shape: 'circle' | 'diamond'
  active?: boolean
  bold?: boolean
  onClick?: () => void
}> = ({ color, label, shape, active = true, bold = false, onClick }) => (
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
        border: bold ? '2px solid var(--text-primary)' : undefined,
        boxSizing: 'border-box',
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
