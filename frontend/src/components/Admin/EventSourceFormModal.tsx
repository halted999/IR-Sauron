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
  file_watch: 'Чтение из файла',
  email: 'Электронная почта',
  json_api: 'JSON по API-ключу',
}

const DEFAULT_FORM = {
  name: '',
  source_type: 'elastic' as EventSourceType,
  base_url: '',
  verify_ssl: true,
  auth_username: '',
  auth_secret: '',
  index_pattern: '',
  file_mask: '*.csv',
  file_format: 'csv' as 'csv' | 'json',
  csv_delimiter: ',',
  email_port: 993,
  email_mailbox: 'INBOX',
  email_use_ssl: true,
  api_key_header: 'X-API-Key',
  json_path: '',
  title_field: '',
  description_field: '',
  severity_field: '',
  id_field: '',
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
        file_mask: (source.config?.file_mask as string | undefined) ?? '*.csv',
        file_format: (source.config?.file_format as 'csv' | 'json' | undefined) ?? 'csv',
        csv_delimiter: (source.config?.csv_delimiter as string | undefined) ?? ',',
        email_port: (source.config?.port as number | undefined) ?? 993,
        email_mailbox: (source.config?.mailbox as string | undefined) ?? 'INBOX',
        email_use_ssl: (source.config?.use_ssl as boolean | undefined) ?? true,
        api_key_header: (source.config?.api_key_header as string | undefined) ?? 'X-API-Key',
        json_path: (source.config?.json_path as string | undefined) ?? '',
        title_field: (source.config?.title_field as string | undefined) ?? '',
        description_field: (source.config?.description_field as string | undefined) ?? '',
        severity_field: (source.config?.severity_field as string | undefined) ?? '',
        id_field: (source.config?.id_field as string | undefined) ?? '',
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
    if (!source && form.source_type !== 'file_watch' && !form.auth_secret.trim()) {
      newErrors.auth_secret = 'Обязательное поле'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSaving(true)
    try {
      const config =
        form.source_type === 'elastic' && form.index_pattern.trim()
          ? { index_pattern: form.index_pattern.trim() }
          : form.source_type === 'file_watch'
            ? {
                file_mask: form.file_mask.trim() || '*',
                file_format: form.file_format,
                ...(form.file_format === 'csv' ? { csv_delimiter: form.csv_delimiter || ',' } : {}),
              }
            : form.source_type === 'email'
              ? {
                  port: form.email_port || 993,
                  mailbox: form.email_mailbox.trim() || 'INBOX',
                  use_ssl: form.email_use_ssl,
                }
              : form.source_type === 'json_api'
                ? {
                    api_key_header: form.api_key_header.trim() || 'X-API-Key',
                    ...(form.json_path.trim() ? { json_path: form.json_path.trim() } : {}),
                    ...(form.title_field.trim() ? { title_field: form.title_field.trim() } : {}),
                    ...(form.description_field.trim()
                      ? { description_field: form.description_field.trim() }
                      : {}),
                    ...(form.severity_field.trim() ? { severity_field: form.severity_field.trim() } : {}),
                    ...(form.id_field.trim() ? { id_field: form.id_field.trim() } : {}),
                  }
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
            {form.source_type === 'elastic'
              ? 'URL Elasticsearch'
              : form.source_type === 'thehive'
                ? 'URL TheHive'
                : form.source_type === 'email'
                  ? 'Хост IMAP-сервера'
                  : form.source_type === 'json_api'
                    ? 'URL API'
                    : 'Сетевая папка'} *
          </label>
          <input
            id="es-base-url"
            type="text"
            value={form.base_url}
            onChange={(e) => setField('base_url', e.target.value)}
            placeholder={
              form.source_type === 'file_watch'
                ? '\\\\fileserver\\alerts-export'
                : form.source_type === 'email'
                  ? 'imap.example.com'
                  : form.source_type === 'json_api'
                    ? 'https://api.example.com/v1/alerts'
                    : 'https://elastic.example.com:9200'
            }
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

        {form.source_type === 'email' && (
          <div>
            <label htmlFor="es-auth-username">Адрес почтового ящика (логин) *</label>
            <input
              id="es-auth-username"
              type="text"
              value={form.auth_username}
              onChange={(e) => setField('auth_username', e.target.value)}
              placeholder="soc-alerts@example.com"
            />
          </div>
        )}

        {form.source_type === 'email' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="es-email-mailbox">Папка почтового ящика</label>
                <input
                  id="es-email-mailbox"
                  type="text"
                  value={form.email_mailbox}
                  onChange={(e) => setField('email_mailbox', e.target.value)}
                  placeholder="INBOX"
                />
              </div>
              <div>
                <label htmlFor="es-email-port">Порт IMAP</label>
                <input
                  id="es-email-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.email_port}
                  onChange={(e) => setField('email_port', Number(e.target.value) || 993)}
                />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.email_use_ssl}
                onChange={(e) => setField('email_use_ssl', e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span style={{ fontSize: 13 }}>Использовать SSL/TLS (IMAPS)</span>
            </label>
          </>
        )}

        {form.source_type === 'json_api' && (
          <>
            <div>
              <label htmlFor="es-api-key-header">Заголовок с API-ключом</label>
              <input
                id="es-api-key-header"
                type="text"
                value={form.api_key_header}
                onChange={(e) => setField('api_key_header', e.target.value)}
                placeholder="X-API-Key"
              />
            </div>
            <div>
              <label htmlFor="es-json-path">Путь к списку записей в JSON (необязательно)</label>
              <input
                id="es-json-path"
                type="text"
                value={form.json_path}
                onChange={(e) => setField('json_path', e.target.value)}
                placeholder="Например: data.alerts (если ответ — не сразу массив)"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="es-title-field">Поле заголовка</label>
                <input
                  id="es-title-field"
                  type="text"
                  value={form.title_field}
                  onChange={(e) => setField('title_field', e.target.value)}
                  placeholder="title"
                />
              </div>
              <div>
                <label htmlFor="es-description-field">Поле описания</label>
                <input
                  id="es-description-field"
                  type="text"
                  value={form.description_field}
                  onChange={(e) => setField('description_field', e.target.value)}
                  placeholder="description"
                />
              </div>
              <div>
                <label htmlFor="es-severity-field">Поле критичности</label>
                <input
                  id="es-severity-field"
                  type="text"
                  value={form.severity_field}
                  onChange={(e) => setField('severity_field', e.target.value)}
                  placeholder="severity"
                />
              </div>
              <div>
                <label htmlFor="es-id-field">Поле идентификатора</label>
                <input
                  id="es-id-field"
                  type="text"
                  value={form.id_field}
                  onChange={(e) => setField('id_field', e.target.value)}
                  placeholder="id"
                />
              </div>
            </div>
          </>
        )}

        {form.source_type === 'file_watch' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="es-file-mask">Маска имени файла</label>
                <input
                  id="es-file-mask"
                  type="text"
                  value={form.file_mask}
                  onChange={(e) => setField('file_mask', e.target.value)}
                  placeholder="*.csv"
                />
              </div>
              <div>
                <label htmlFor="es-file-format">Формат файла</label>
                <select
                  id="es-file-format"
                  value={form.file_format}
                  onChange={(e) => setField('file_format', e.target.value as 'csv' | 'json')}
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            </div>
            {form.file_format === 'csv' && (
              <div>
                <label htmlFor="es-csv-delimiter">Разделитель CSV</label>
                <select
                  id="es-csv-delimiter"
                  value={form.csv_delimiter}
                  onChange={(e) => setField('csv_delimiter', e.target.value)}
                >
                  <option value=",">Запятая (,)</option>
                  <option value=";">Точка с запятой (;)</option>
                  <option value="\t">Табуляция</option>
                  <option value="|">Вертикальная черта (|)</option>
                </select>
              </div>
            )}
          </>
        )}

        {form.source_type !== 'file_watch' && (
          <div>
            <label htmlFor="es-auth-secret">
              {form.source_type === 'elastic'
                ? (form.auth_username ? 'Пароль *' : 'API Key *')
                : form.source_type === 'thehive'
                  ? 'API-токен TheHive *'
                  : form.source_type === 'email'
                    ? 'Пароль от почтового ящика *'
                    : 'API-ключ *'}
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
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="es-poll-interval">
              {form.source_type === 'file_watch' ? 'Период чтения (сек.)' : 'Интервал опроса (сек.)'}
            </label>
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
            {form.source_type !== 'file_watch' && form.source_type !== 'email' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.verify_ssl}
                  onChange={(e) => setField('verify_ssl', e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>Проверять SSL-сертификат</span>
              </label>
            )}
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
