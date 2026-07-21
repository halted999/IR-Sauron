import React, { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { CreateEventData, ActionType } from '../../types'
import { ACTION_TYPE_LABELS } from '../../types'

interface ActionCardModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateEventData) => Promise<void>
  defaultBranchId: string
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function todayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nowTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface FormState {
  date: string
  time: string
  action_type: ActionType
  mitre_technique: string
  description: string
}

function defaultForm(): FormState {
  return {
    date: todayDateStr(),
    time: nowTimeStr(),
    action_type: 'network_connection',
    mitre_technique: '',
    description: '',
  }
}

export const ActionCardModal: React.FC<ActionCardModalProps> = ({
  isOpen,
  onClose,
  onSave,
  defaultBranchId,
}) => {
  const [form, setForm] = useState<FormState>(defaultForm())
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setForm(defaultForm())
    setErrors({})
  }, [isOpen])

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const validate = (): boolean => {
    const newErrors: typeof errors = {}
    if (!form.date) newErrors.date = 'Обязательное поле'
    if (!TIME_PATTERN.test(form.time)) newErrors.time = 'Формат ЧЧ:ММ, 24 часа'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSaving(true)
    try {
      const event_ts = new Date(`${form.date}T${form.time}:00Z`).toISOString()
      await onSave({
        event_ts,
        event_ts_tz_offset: 0,
        event_type: 'attacker_action',
        title: ACTION_TYPE_LABELS[form.action_type],
        description: form.description.trim() || undefined,
        confidence_level: 'hypothesis',
        mitre_technique: form.mitre_technique.trim() || null,
        action_type: form.action_type,
        branch_id: defaultBranchId,
      })
      onClose()
    } catch {
      // error handled by parent (toast)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Новый факт"
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            Добавить
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="action-type">Тип события *</label>
          <select
            id="action-type"
            value={form.action_type}
            onChange={(e) => setField('action_type', e.target.value as ActionType)}
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
            <label htmlFor="action-date">Дата *</label>
            <input
              id="action-date"
              type="date"
              value={form.date}
              onChange={(e) => setField('date', e.target.value)}
            />
            {errors.date && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.date}</span>}
          </div>
          <div>
            <label htmlFor="action-time">Время (24ч) *</label>
            <input
              id="action-time"
              type="text"
              value={form.time}
              onChange={(e) => setField('time', e.target.value)}
              placeholder="ЧЧ:ММ"
              pattern="^([01]\d|2[0-3]):([0-5]\d)$"
              maxLength={5}
            />
            {errors.time && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.time}</span>}
          </div>
        </div>

        <div>
          <label htmlFor="action-technique">Техника</label>
          <input
            id="action-technique"
            type="text"
            value={form.mitre_technique}
            onChange={(e) => setField('mitre_technique', e.target.value)}
            placeholder="Например, T1071"
          />
        </div>

        <div>
          <label htmlFor="action-description">Описание</label>
          <textarea
            id="action-description"
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            rows={3}
            style={{ resize: 'vertical' }}
            placeholder="Подробности действия"
          />
        </div>
      </div>
    </Modal>
  )
}
