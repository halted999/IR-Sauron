import React, { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { Branch, CreateEventData, ActionType } from '../../types'
import { ACTION_TYPE_LABELS } from '../../types'

interface ActionCardModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateEventData) => Promise<void>
  branches: Branch[]
  defaultBranchId?: string
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
  title: string
  date: string
  time: string
  branch_id: string
  action_type: ActionType
  mitre_technique: string
  description: string
}

function defaultForm(defaultBranchId?: string): FormState {
  return {
    title: '',
    date: todayDateStr(),
    time: nowTimeStr(),
    branch_id: defaultBranchId ?? '',
    action_type: 'network_connection',
    mitre_technique: '',
    description: '',
  }
}

export const ActionCardModal: React.FC<ActionCardModalProps> = ({
  isOpen,
  onClose,
  onSave,
  branches,
  defaultBranchId,
}) => {
  const [form, setForm] = useState<FormState>(defaultForm(defaultBranchId))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setForm(defaultForm(defaultBranchId))
    setErrors({})
  }, [isOpen, defaultBranchId])

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const validate = (): boolean => {
    const newErrors: typeof errors = {}
    if (!form.title.trim()) newErrors.title = 'Обязательное поле'
    if (!form.date) newErrors.date = 'Обязательное поле'
    if (!TIME_PATTERN.test(form.time)) newErrors.time = 'Формат ЧЧ:ММ, 24 часа'
    if (!form.branch_id) newErrors.branch_id = 'Выберите ветку'
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
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        confidence_level: 'hypothesis',
        mitre_technique: form.mitre_technique.trim() || null,
        action_type: form.action_type,
        branch_id: form.branch_id,
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
      title="Новое действие"
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
          <label htmlFor="action-title">Название *</label>
          <input
            id="action-title"
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="Краткое название действия"
          />
          {errors.title && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.title}</span>}
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
          <label htmlFor="action-branch">Ветка *</label>
          <select
            id="action-branch"
            value={form.branch_id}
            onChange={(e) => setField('branch_id', e.target.value)}
          >
            <option value="" disabled>
              Выберите ветку
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {errors.branch_id && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.branch_id}</span>
          )}
        </div>

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
