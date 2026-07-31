import React, { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Case, IOC } from '../../types'
import { CASE_STATUS_LABELS, VERIFICATION_STATUS_LABELS, CASE_SEVERITY_LABELS } from '../../types'
import { updateCase } from '../../api/cases'
import { getAlerts } from '../../api/alerts'
import { useToastStore } from '../../store/toast'
import { Button } from '../ui/Button'

interface CaseReportPanelProps {
  currentCase: Case
  iocs: IOC[]
  canEdit: boolean
  onUpdate: (updated: Case) => void
}

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  return format(new Date(iso), 'dd.MM.yyyy HH:mm', { locale: ru })
}

export const CaseReportPanel: React.FC<CaseReportPanelProps> = ({
  currentCase, iocs, canEdit, onUpdate,
}) => {
  const toast = useToastStore()
  const [alertCount, setAlertCount] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [notes, setNotes] = useState(currentCase.report_notes ?? '')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    getAlerts({ case_id: currentCase.id })
      .then((alerts) => setAlertCount(alerts.length))
      .catch(() => setAlertCount(null))
  }, [currentCase.id])

  const handleStartEdit = () => {
    setNotes(currentCase.report_notes ?? '')
    setIsEditing(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updated = await updateCase(currentCase.id, { report_notes: notes.trim() })
      onUpdate(updated)
      toast.success('Отчёт сохранён')
      setIsEditing(false)
    } catch {
      toast.error('Ошибка сохранения отчёта')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Сводка</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
            <SummaryField label="Статус" value={CASE_STATUS_LABELS[currentCase.status]} />
            <SummaryField
              label="Подтверждение"
              value={VERIFICATION_STATUS_LABELS[currentCase.verification_status]}
            />
            <SummaryField label="Критичность" value={CASE_SEVERITY_LABELS[currentCase.severity]} />
            <SummaryField label="Классификация" value={currentCase.classification} />
            <SummaryField label="Внешний тикет" value={currentCase.external_ticket_id} />
            <SummaryField label="Гриф конфиденциальности" value={currentCase.confidentiality_label} />
            <SummaryField label="Обнаружен" value={fmtDate(currentCase.incident_discovered_at)} />
            <SummaryField label="Начался" value={fmtDate(currentCase.incident_started_at)} />
            <SummaryField label="Локализован" value={fmtDate(currentCase.incident_contained_at)} />
            <SummaryField label="Закрыт" value={fmtDate(currentCase.incident_closed_at)} />
            <SummaryField label="Алертов в деле" value={alertCount !== null ? String(alertCount) : '—'} />
            <SummaryField label="Индикаторов (IOC)" value={String(iocs.length)} />
          </div>

          <SummaryBlock label="Причина инцидента" value={currentCase.root_cause} />
          <SummaryBlock label="Влияние на бизнес" value={currentCase.impact_summary} />
          <SummaryBlock label="Атрибуция" value={currentCase.attribution} />

          {currentCase.participants && currentCase.participants.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={labelStyle}>Участники</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {currentCase.participants.map((p) => (
                  <span
                    key={p.user_id}
                    style={{
                      fontSize: 12,
                      padding: '2px 10px',
                      borderRadius: 12,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {p.user?.full_name || p.user?.username || p.user_id.slice(0, 8)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Текст отчёта</h3>
            {canEdit &&
              (isEditing ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                    Отмена
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSave} isLoading={isSaving}>
                    Сохранить
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={handleStartEdit}>
                  Редактировать
                </Button>
              ))}
          </div>
          {isEditing ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={12}
              style={{ resize: 'vertical', width: '100%' }}
              placeholder="Свободный текст отчёта об инциденте..."
            />
          ) : (
            <div
              style={{
                fontSize: 14,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                color: currentCase.report_notes ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {currentCase.report_notes || 'Отчёт ещё не написан.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const SummaryField: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div>
    <div style={labelStyle}>{label}</div>
    <div style={{ color: value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{value || '—'}</div>
  </div>
)

const SummaryBlock: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div style={{ marginTop: 14 }}>
    <div style={labelStyle}>{label}</div>
    <div
      style={{
        fontSize: 13,
        whiteSpace: 'pre-wrap',
        color: value ? 'var(--text-primary)' : 'var(--text-secondary)',
        marginTop: 4,
      }}
    >
      {value || '—'}
    </div>
  </div>
)
