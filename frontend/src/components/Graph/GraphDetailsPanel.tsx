import React, { useEffect, useState } from 'react'
import type { Alert, AlertStatus, CorrelationGraphNode, GraphNodeKind } from '../../types'
import { ALERT_STATUS_COLORS, ALERT_STATUS_LABELS } from '../../types'
import { getAlert } from '../../api/alerts'
import { Spinner } from '../ui/Spinner'

export type PanelState =
  | { kind: 'alert'; nodeId: string }
  | { kind: 'alert-group'; groupId: string }
  | { kind: 'entity'; nodeId: string }

const ENTITY_LABEL: Record<Exclude<GraphNodeKind, 'alert'>, string> = {
  ip: 'IP-адрес',
  account: 'Учётная запись',
  file: 'Файл',
  ioc: 'IOC (домен/URL)',
}

const ENTITY_COUNT_LABEL: Record<'ip' | 'account' | 'file' | 'ioc', string> = {
  ip: 'IP-адреса',
  account: 'Учётные записи',
  file: 'Файлы',
  ioc: 'IOC (домен/URL)',
}

interface GraphDetailsPanelProps {
  panel: PanelState
  onClose: () => void
  nodeById: Map<string, CorrelationGraphNode>
  groupMembersById: Map<string, string[]>
  groupEntityCountsById: Map<string, Record<string, number>>
  mentionsByEntityId: Map<string, string[]>
  onOpenAlert: (alertId: string) => void
}

export const GraphDetailsPanel: React.FC<GraphDetailsPanelProps> = ({
  panel, onClose, nodeById, groupMembersById, groupEntityCountsById, mentionsByEntityId, onOpenAlert,
}) => {
  // Clicking an alert inside a list (similar-alerts group, entity mentions)
  // reads it right here instead of navigating away from the analyzer — the
  // analyzer stays open, and "Открыть алерт →" inside the reader is still
  // there for when the user actually wants the full alert page.
  const [inlineAlertId, setInlineAlertId] = useState<string | null>(null)

  useEffect(() => {
    setInlineAlertId(null)
  }, [panel])

  return (
    <div
      style={{
        width: 340,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {inlineAlertId ? (
          <button onClick={() => setInlineAlertId(null)} style={backButtonStyle}>
            ← Назад к списку
          </button>
        ) : (
          <strong style={{ fontSize: 13 }}>Детали</strong>
        )}
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
          }}
          title="Закрыть"
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {inlineAlertId ? (
          <AlertDetails alertId={inlineAlertId} onOpenAlert={onOpenAlert} />
        ) : panel.kind === 'alert' ? (
          <AlertDetails alertId={panel.nodeId} onOpenAlert={onOpenAlert} />
        ) : panel.kind === 'alert-group' ? (
          <AlertGroupDetails
            memberIds={groupMembersById.get(panel.groupId) ?? []}
            entityCounts={groupEntityCountsById.get(panel.groupId)}
            nodeById={nodeById}
            onSelectAlert={setInlineAlertId}
          />
        ) : (
          <EntityMentions
            node={nodeById.get(panel.nodeId)}
            alertIds={mentionsByEntityId.get(panel.nodeId) ?? []}
            nodeById={nodeById}
            onSelectAlert={setInlineAlertId}
          />
        )}
      </div>
    </div>
  )
}

const AlertDetails: React.FC<{ alertId: string; onOpenAlert: (id: string) => void }> = ({ alertId, onOpenAlert }) => {
  const [alert, setAlert] = useState<Alert | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getAlert(alertId)
      .then((res) => {
        if (!cancelled) setAlert(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [alertId])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
        <Spinner size={24} />
      </div>
    )
  }
  if (error || !alert) {
    return <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Не удалось загрузить алерт</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{alert.title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <StatusBadge status={alert.status} />
        {alert.threat_type && (
          <span
            style={{
              fontSize: 11, color: 'var(--text-secondary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '2px 8px',
            }}
          >
            {alert.threat_type}
          </span>
        )}
      </div>
      {alert.description && (
        <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {alert.description}
        </div>
      )}
      {alert.source && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Источник: {alert.source}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Создан: {new Date(alert.created_at).toLocaleString('ru-RU')}
      </div>
      <button onClick={() => onOpenAlert(alert.id)} style={openButtonStyle}>
        Открыть алерт →
      </button>
    </div>
  )
}

const AlertGroupDetails: React.FC<{
  memberIds: string[]
  entityCounts?: Record<string, number>
  nodeById: Map<string, CorrelationGraphNode>
  onSelectAlert: (id: string) => void
}> = ({ memberIds, entityCounts, nodeById, onSelectAlert }) => {
  const members = memberIds
    .map((id) => nodeById.get(id))
    .filter((n): n is CorrelationGraphNode => !!n)
  const countRows = (Object.keys(ENTITY_COUNT_LABEL) as Array<keyof typeof ENTITY_COUNT_LABEL>)
    .map((kind) => ({ kind, count: entityCounts?.[kind] ?? 0 }))
    .filter((row) => row.count > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Похожие алерты (связаны по одним и тем же элементам): <strong>{members.length}</strong>
      </div>

      {countRows.length > 0 && (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <tbody>
            {countRows.map(({ kind, count }) => (
              <tr key={kind} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>{ENTITY_COUNT_LABEL[kind]}</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {members.map((m) => (
          <button key={m.id} onClick={() => onSelectAlert(m.id)} style={rowButtonStyle}>
            <span style={rowLabelStyle}>{m.label}</span>
            {m.status && <StatusBadge status={m.status} small />}
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {m.case_id ? 'в инциденте' : 'без инцидента'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

const EntityMentions: React.FC<{
  node?: CorrelationGraphNode
  alertIds: string[]
  nodeById: Map<string, CorrelationGraphNode>
  onSelectAlert: (id: string) => void
}> = ({ node, alertIds, nodeById, onSelectAlert }) => {
  if (!node) return null
  const alerts = alertIds
    .map((id) => nodeById.get(id))
    .filter((n): n is CorrelationGraphNode => !!n)
  const label = node.kind === 'alert' ? 'Алерт' : ENTITY_LABEL[node.kind]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}: </span>
        <strong>{node.label}</strong>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Упоминаний в алертах: <strong>{alerts.length}</strong>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {alerts.map((a) => (
          <button key={a.id} onClick={() => onSelectAlert(a.id)} style={rowButtonStyle}>
            <span style={rowLabelStyle}>{a.label}</span>
            {a.status && <StatusBadge status={a.status} small />}
          </button>
        ))}
      </div>
    </div>
  )
}

const StatusBadge: React.FC<{ status: AlertStatus; small?: boolean }> = ({ status, small }) => (
  <span
    style={{
      fontSize: small ? 10 : 11,
      color: ALERT_STATUS_COLORS[status],
      border: `1px solid ${ALERT_STATUS_COLORS[status]}`,
      borderRadius: 10,
      padding: small ? '1px 6px' : '2px 8px',
      whiteSpace: 'nowrap',
    }}
  >
    {ALERT_STATUS_LABELS[status]}
  </span>
)

const openButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'rgba(88,166,255,0.15)',
  color: 'var(--accent)',
  cursor: 'pointer',
  alignSelf: 'flex-start',
}

const backButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  padding: 0,
}

const rowButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  fontSize: 12,
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
}

const rowLabelStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
