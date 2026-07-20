import React, { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { CreateAlertData, CaseSeverity } from '../../types'
import { CASE_SEVERITY_LABELS } from '../../types'

interface AlertModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateAlertData) => Promise<void>
}

const DEFAULT_FORM: CreateAlertData = {
  title: '',
  description: '',
  severity: 'medium',
  source: '',
}

export const AlertModal: React.FC<AlertModalProps> = ({ isOpen, onClose, onSave }) => {
  const [form, setForm] = useState<CreateAlertData>(DEFAULT_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof CreateAlertData, string>>>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setForm(DEFAULT_FORM)
    setErrors({})
  }, [isOpen])

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof CreateAlertData, string>> = {}
    if (!form.title.trim()) newErrors.title = 'Обязательное поле'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSaving(true)
    try {
      await onSave(form)
      onClose()
    } catch {
      // error handled in parent
    } finally {
      setIsSaving(false)
    }
  }

  const setField = <K extends keyof CreateAlertData>(key: K, value: CreateAlertData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Новый алерт"
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            Создать
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="alert-title">Заголовок *</label>
          <input
            id="alert-title"
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="Краткое описание алерта"
          />
          {errors.title && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.title}</span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="alert-severity">Критичность *</label>
            <select
              id="alert-severity"
              value={form.severity}
              onChange={(e) => setField('severity', e.target.value as CaseSeverity)}
            >
              {Object.entries(CASE_SEVERITY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="alert-source">Источник</label>
            <input
              id="alert-source"
              type="text"
              value={form.source}
              onChange={(e) => setField('source', e.target.value)}
              placeholder="SIEM / EDR / SOC"
            />
          </div>
        </div>

        <div>
          <label htmlFor="alert-description">Описание</label>
          <textarea
            id="alert-description"
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            rows={4}
            style={{ resize: 'vertical' }}
            placeholder="Подробности алерта"
          />
        </div>
      </div>
    </Modal>
  )
}
