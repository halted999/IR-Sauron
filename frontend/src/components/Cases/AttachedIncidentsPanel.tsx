import React from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import type { Case, CaseSeverity, CaseStatus } from '../../types'
import { CASE_SEVERITY_LABELS, CASE_STATUS_LABELS } from '../../types'

const SEVERITY_COLOR: Record<CaseSeverity, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'green',
}

const STATUS_COLOR: Record<CaseStatus, string> = {
  open: 'blue',
  in_progress: 'yellow',
  confirmed: 'green',
  rejected: 'red',
}

interface AttachedIncidentsPanelProps {
  currentCase: Case
  canEdit: boolean
  isDetaching: string | null
  onNavigate: (caseId: string) => void
  onDetach: (caseId: string) => void
}

export const AttachedIncidentsPanel: React.FC<AttachedIncidentsPanelProps> = ({
  currentCase, canEdit, isDetaching, onNavigate, onDetach,
}) => {
  const parent = currentCase.parent_case
  const children = currentCase.attached_cases ?? []

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%' }}>
      {parent && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Главный инцидент</h3>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => onNavigate(parent.id)}
                style={{
                  background: 'none', border: 'none', padding: 0, color: 'var(--accent)',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                }}
              >
                {parent.title}
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge color={STATUS_COLOR[parent.status] as 'blue'} label={CASE_STATUS_LABELS[parent.status]} size="sm" />
                <Badge color={SEVERITY_COLOR[parent.severity] as 'red'} label={CASE_SEVERITY_LABELS[parent.severity]} size="sm" />
              </div>
              {currentCase.attach_reason && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                  Причина присоединения: {currentCase.attach_reason}
                </p>
              )}
            </div>
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onDetach(currentCase.id)}
                isLoading={isDetaching === currentCase.id}
              >
                Отсоединить
              </Button>
            )}
          </div>
        </div>
      )}

      {children.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
            Присоединённые инциденты ({children.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {children.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 10,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    onClick={() => onNavigate(c.id)}
                    style={{
                      background: 'none', border: 'none', padding: 0, color: 'var(--accent)',
                      fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {c.title}
                  </button>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge color={STATUS_COLOR[c.status] as 'blue'} label={CASE_STATUS_LABELS[c.status]} size="sm" />
                    <Badge color={SEVERITY_COLOR[c.severity] as 'red'} label={CASE_SEVERITY_LABELS[c.severity]} size="sm" />
                  </div>
                  {c.attach_reason && (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                      Причина присоединения: {c.attach_reason}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onDetach(c.id)}
                    isLoading={isDetaching === c.id}
                  >
                    Отсоединить
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
