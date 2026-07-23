import React, { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { EventSource, EventSourceType, CreateEventSourceData, UpdateEventSourceData } from '../../api/eventSources'

interface EventSourceFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateEventSourceData | UpdateEventSourceData) => Promise<void>
  source?: EventSource | null
}

const SOURCE_TYPE_LABELS: Record<EventSourceType, string> = {
  elastic: 'Elastic',
  thehive: 'TheHive',
}

const DEFAULT_FORM = {
  name: '',
  source_type: 'elastic' as EventSourceType,
  base_url: '',
  verify_ssl: true,
  auth_username: '',
  auth_secret: '',
  index_pattern: '',
  is_enabled: true,
  poll_interval_seconds: 300,
}

export const EventSourceFormModal: React.FC<EventSourceFormModalProps> = ({ isOpen, onClose, onSave, source }) => {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof typeof DEFAULT_FORM, string>>>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    if (source) {
      setForm({
        name: source.name,
        source_type: source.source_type,
        base_url: source.base_url,
        verify_ssl: source.verify_ssl,
        auth_username: source.auth_username ?? '',
        auth_secret: '',
        index_pattern: (source.config?.index_pattern as string | undefined) ?? '',
        is_enabled: source.is_enabled,
        poll_interval_seconds: source.poll_interval_seconds,
      })
    } else {
      setForm(DEFAULT_FORM)
    }
    setErrors({})
  }, [isOpen, source])

  const setField = <K extends keyof typeof DEFAULT_FORM>(key: K, value: (typeof DEFAULT_FORM)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const validate = (): boolean => {
    const newErrors: typeof errors = {}
    if (form.name.trim().length < 1) newErrors.name = 'Обязательное поле'
    if (form.base_url.trim().length < 1) newErrors.base_url = 'Обязательное поле'
    if (!source && !form.auth_secret.trim()) newErrors.auth_secret = 'Обязательное поле'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSaving(true)
    try {
      const config = form.source_type === 'elastic' && form.index_pattern.trim()
        ? { index_pattern: form.index_pattern.trim() }
        : undefined

      const base = {
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        verify_ssl: form.verify_ssl,
        auth_username: form.auth_username.trim() || undefined,
        config,
        is_enabled: form.is_enabled,
        poll_interval_seconds: form.poll_interval_seconds,
      }

      if (source) {
        const data: UpdateEventSourceData = { ...base }
        if (form.auth_secret.trim()) data.auth_secret = form.auth_secret.trim()
        await onSave(data)
      } else {
        await onSave({
          ...base,
          source_type: form.source_type,
          auth_secret: form.auth_secret.trim(),
        })
      }
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
      title={source ? 'Редактировать источник алертов' : 'Новый источник алертов'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            {source ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="es-name">Название *</label>
          <input
            id="es-name"
            type="text"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="Например: Elastic SIEM (prod)"
          />
          {errors.name && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.name}</span>}
        </div>

        <div>
          <label htmlFor="es-type">Тип источника *</label>
          <select
            id="es-type"
            value={form.source_type}
            onChange={(e) => setField('source_type', e.target.value as EventSourceType)}
            disabled={!!source}
          >
            {Object.entries(SOURCE_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="es-base-url">
            {form.source_type === 'elastic' ? 'URL Elasticsearch' : 'URL TheHive'} *
          </label>
          <input
            id="es-base-url"
            type="text"
            value={form.base_url}
            onChange={(e) => setField('base_url', e.target.value)}
            placeholder="https://elastic.example.com:9200"
          />
          {errors.base_url && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.base_url}</span>}
        </div>

        {form.source_type === 'elastic' && (
          <div>
            <label htmlFor="es-index-pattern">Индекс/паттерн индекса</label>
            <input
              id="es-index-pattern"
              type="text"
              value={form.index_pattern}
              onChange={(e) => setField('index_pattern', e.target.value)}
              placeholder="alerts-*"
            />
          </div>
        )}

        {form.source_type === 'elastic' && (
          <div>
            <label htmlFor="es-auth-username">Логин (для Basic Auth, необязательно)</label>
            <input
              id="es-auth-username"
              type="text"
              value={form.auth_username}
              onChange={(e) => setField('auth_username', e.target.value)}
              placeholder="Оставьте пустым для API Key"
            />
          </div>
        )}

        <div>
          <label htmlFor="es-auth-secret">
            {form.source_type === 'elastic'
              ? (form.auth_username ? 'Пароль *' : 'API Key *')
              : 'API-токен TheHive *'}
          </label>
          <input
            id="es-auth-secret"
            type="password"
            value={form.auth_secret}
            onChange={(e) => setField('auth_secret', e.target.value)}
            placeholder={source ? 'Оставьте пустым, чтобы не менять' : undefined}
          />
          {errors.auth_secret && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.auth_secret}</span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="es-poll-interval">Интервал опроса (сек.)</label>
            <input
              id="es-poll-interval"
              type="number"
              min={30}
              max={86400}
              value={form.poll_interval_seconds}
              onChange={(e) => setField('poll_interval_seconds', Number(e.target.value) || 300)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.verify_ssl}
                onChange={(e) => setField('verify_ssl', e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span style={{ fontSize: 13 }}>Проверять SSL-сертификат</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.is_enabled}
                onChange={(e) => setField('is_enabled', e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span style={{ fontSize: 13 }}>Источник включён</span>
            </label>
          </div>
        </div>
      </div>
    </Modal>
  )
}
