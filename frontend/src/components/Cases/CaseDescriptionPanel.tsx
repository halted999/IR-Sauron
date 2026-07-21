import React, { useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Case } from '../../types'
import { updateCase } from '../../api/cases'
import { useToastStore } from '../../store/toast'
import { Button } from '../ui/Button'

interface CaseDescriptionPanelProps {
  currentCase: Case
  canEdit: boolean
  onUpdate: (updated: Case) => void
}

function toDatetimeLocal(isoStr?: string): string {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da}T${h}:${mi}`
}

interface FormState {
  classification: string
  external_ticket_id: string
  incident_discovered_at: string
  incident_started_at: string
  incident_contained_at: string
  incident_closed_at: string
  root_cause: string
  impact_summary: string
  attribution: string
}

function formFromCase(c: Case): FormState {
  return {
    classification: c.classification ?? '',
    external_ticket_id: c.external_ticket_id ?? '',
    incident_discovered_at: toDatetimeLocal(c.incident_discovered_at),
    incident_started_at: toDatetimeLocal(c.incident_started_at),
    incident_contained_at: toDatetimeLocal(c.incident_contained_at),
    incident_closed_at: toDatetimeLocal(c.incident_closed_at),
    root_cause: c.root_cause ?? '',
    impact_summary: c.impact_summary ?? '',
    attribution: c.attribution ?? '',
  }
}

export const CaseDescriptionPanel: React.FC<CaseDescriptionPanelProps> = ({
  currentCase,
  canEdit,
  onUpdate,
}) => {
  const toast = useToastStore()
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<FormState>(() => formFromCase(currentCase))
  const [isSaving, setIsSaving] = useState(false)

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleStartEdit = () => {
    setForm(formFromCase(currentCase))
    setIsEditing(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updated = await updateCase(currentCase.id, {
        classification: form.classification.trim() || undefined,
        external_ticket_id: form.external_ticket_id.trim() || undefined,
        incident_discovered_at: form.incident_discovered_at
          ? new Date(form.incident_discovered_at).toISOString()
          : undefined,
        incident_started_at: form.incident_started_at
          ? new Date(form.incident_started_at).toISOString()
          : null,
        incident_contained_at: form.incident_contained_at
          ? new Date(form.incident_contained_at).toISOString()
          : null,
        incident_closed_at: form.incident_closed_at
          ? new Date(form.incident_closed_at).toISOString()
          : null,
        root_cause: form.root_cause.trim(),
        impact_summary: form.impact_summary.trim(),
        attribution: form.attribution.trim(),
      })
      onUpdate(updated)
      toast.success('Описание дела обновлено')
      setIsEditing(false)
    } catch {
      toast.error('Ошибка обновления описания')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          maxWidth: 720,
          margin: '0 auto 16px',
        }}
      >
        {canEdit &&
          (isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Отмена
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave} isLoading={isSaving}>
                Сохранить
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={handleStartEdit}>
              Редактировать
            </Button>
          ))}
      </div>

      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label htmlFor="desc-classification">Классификация</label>
            {isEditing ? (
              <input
                id="desc-classification"
                type="text"
                value={form.classification}
                onChange={(e) => setField('classification', e.target.value)}
                placeholder="Тип инцидента"
              />
            ) : (
              <Value>{currentCase.classification}</Value>
            )}
          </div>
          <div>
            <label htmlFor="desc-ticket">Внешний тикет</label>
            {isEditing ? (
              <input
                id="desc-ticket"
                type="text"
                value={form.external_ticket_id}
                onChange={(e) => setField('external_ticket_id', e.target.value)}
                placeholder="JIRA-1234"
              />
            ) : (
              <Value>{currentCase.external_ticket_id}</Value>
            )}
          </div>
        </div>

        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 8,
            }}
          >
            Хронология инцидента
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <DateField
              label="Обнаружен"
              isEditing={isEditing}
              value={form.incident_discovered_at}
              onChange={(v) => setField('incident_discovered_at', v)}
              displayValue={currentCase.incident_discovered_at}
            />
            <DateField
              label="Начался"
              isEditing={isEditing}
              value={form.incident_started_at}
              onChange={(v) => setField('incident_started_at', v)}
              displayValue={currentCase.incident_started_at}
            />
            <DateField
              label="Локализован"
              isEditing={isEditing}
              value={form.incident_contained_at}
              onChange={(v) => setField('incident_contained_at', v)}
              displayValue={currentCase.incident_contained_at}
            />
            <DateField
              label="Закрыт"
              isEditing={isEditing}
              value={form.incident_closed_at}
              onChange={(v) => setField('incident_closed_at', v)}
              displayValue={currentCase.incident_closed_at}
            />
          </div>
        </div>

        <div>
          <label htmlFor="desc-root-cause">Причина инцидента</label>
          {isEditing ? (
            <textarea
              id="desc-root-cause"
              value={form.root_cause}
              onChange={(e) => setField('root_cause', e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
              placeholder="Первопричина инцидента"
            />
          ) : (
            <Value multiline>{currentCase.root_cause}</Value>
          )}
        </div>

        <div>
          <label htmlFor="desc-impact">Влияние на бизнес</label>
          {isEditing ? (
            <textarea
              id="desc-impact"
              value={form.impact_summary}
              onChange={(e) => setField('impact_summary', e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
              placeholder="Последствия инцидента"
            />
          ) : (
            <Value multiline>{currentCase.impact_summary}</Value>
          )}
        </div>

        <div>
          <label htmlFor="desc-attribution">Атрибуция</label>
          {isEditing ? (
            <textarea
              id="desc-attribution"
              value={form.attribution}
              onChange={(e) => setField('attribution', e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
              placeholder="Предполагаемый источник / группировка"
            />
          ) : (
            <Value multiline>{currentCase.attribution}</Value>
          )}
        </div>
      </div>
    </div>
  )
}

const Value: React.FC<{ children?: string | null; multiline?: boolean }> = ({
  children,
  multiline,
}) => (
  <div
    style={{
      fontSize: 14,
      color: children ? 'var(--text-primary)' : 'var(--text-secondary)',
      whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
      lineHeight: 1.5,
    }}
  >
    {children || '—'}
  </div>
)

const DateField: React.FC<{
  label: string
  isEditing: boolean
  value: string
  onChange: (v: string) => void
  displayValue?: string
}> = ({ label, isEditing, value, onChange, displayValue }) => (
  <div>
    <label>{label}</label>
    {isEditing ? (
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
    ) : (
      <Value>
        {displayValue ? format(new Date(displayValue), 'dd.MM.yyyy HH:mm', { locale: ru }) : null}
      </Value>
    )}
  </div>
)
