import React, { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { Case, CreateCaseData, CaseSeverity } from '../../types'
import { CASE_SEVERITY_LABELS } from '../../types'

interface CaseModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateCaseData) => Promise<void>
  caseData?: Case | null
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

const DEFAULT_FORM: CreateCaseData = {
  title: '',
  classification: '',
  severity: 'medium',
  incident_discovered_at: '',
  confidentiality_label: '1',
  external_ticket_id: '',
}

export const CaseModal: React.FC<CaseModalProps> = ({
  isOpen,
  onClose,
  onSave,
  caseData,
}) => {
  const [form, setForm] = useState<CreateCaseData>(DEFAULT_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof CreateCaseData, string>>>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    if (caseData) {
      setForm({
        title: caseData.title,
        classification: caseData.classification ?? '',
        severity: caseData.severity,
        incident_discovered_at: toDatetimeLocal(caseData.incident_discovered_at),
        confidentiality_label: caseData.confidentiality_label,
        external_ticket_id: caseData.external_ticket_id ?? '',
      })
    } else {
      setForm(DEFAULT_FORM)
    }
    setErrors({})
  }, [isOpen, caseData])

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof CreateCaseData, string>> = {}
    if (!form.title.trim()) newErrors.title = 'Обязательное поле'
    if (!form.confidentiality_label.trim())
      newErrors.confidentiality_label = 'Обязательное поле'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSaving(true)
    try {
      await onSave({
        ...form,
        incident_discovered_at: form.incident_discovered_at
          ? new Date(form.incident_discovered_at).toISOString()
          : undefined,
      })
      onClose()
    } catch {
      // error handled in parent
    } finally {
      setIsSaving(false)
    }
  }

  const setField = <K extends keyof CreateCaseData>(key: K, value: CreateCaseData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={caseData ? 'Редактировать дело' : 'Создать дело'}
      width={580}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            {caseData ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Title */}
        <div>
          <label htmlFor="case-title">Название дела *</label>
          <input
            id="case-title"
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="Краткое название инцидента"
          />
          {errors.title && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.title}</span>
          )}
        </div>

        {/* Severity + Classification */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="case-severity">Критичность *</label>
            <select
              id="case-severity"
              value={form.severity}
              onChange={(e) => setField('severity', e.target.value as CaseSeverity)}
            >
              {Object.entries(CASE_SEVERITY_LABELS)
                .filter(([val]) => val !== 'high')
                .map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="case-classification">Классификация</label>
            <input
              id="case-classification"
              type="text"
              value={form.classification}
              onChange={(e) => setField('classification', e.target.value)}
              placeholder="Тип инцидента"
            />
          </div>
        </div>

        {/* Discovered at */}
        <div>
          <label htmlFor="case-discovered">Дата обнаружения инцидента</label>
          <input
            id="case-discovered"
            type="datetime-local"
            value={form.incident_discovered_at ?? ''}
            onChange={(e) => setField('incident_discovered_at', e.target.value)}
          />
        </div>

        {/* Confidentiality + External ticket */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="case-confidentiality">Гриф конфиденциальности *</label>
            <select
              id="case-confidentiality"
              value={form.confidentiality_label}
              onChange={(e) => setField('confidentiality_label', e.target.value)}
            >
              <option value="1">1 — зелёный</option>
              <option value="2">2 — жёлтый</option>
              <option value="3">3 — оранжевый</option>
              <option value="4">4 — красный</option>
            </select>
            {errors.confidentiality_label && (
              <span style={{ color: 'var(--danger)', fontSize: 11 }}>
                {errors.confidentiality_label}
              </span>
            )}
          </div>
          <div>
            <label htmlFor="case-ticket">Внешний тикет</label>
            <input
              id="case-ticket"
              type="text"
              value={form.external_ticket_id ?? ''}
              onChange={(e) => setField('external_ticket_id', e.target.value)}
              placeholder="JIRA-1234"
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
