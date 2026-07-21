import React, { useState, useEffect, useRef } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type {
  Event,
  Branch,
  CreateEventData,
  EventType,
  ConfidenceLevel,
  Artifact,
} from '../../types'
import { EVENT_TYPE_LABELS, CONFIDENCE_LABELS } from '../../types'
import { uploadArtifact, deleteArtifact, getEventHistory } from '../../api/events'
import { useToastStore } from '../../store/toast'

interface EventModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CreateEventData) => Promise<void>
  branches: Branch[]
  defaultBranchId?: string
  event?: Event | null
}

function toDatetimeLocal(isoStr: string): string {
  const d = new Date(isoStr)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da}T${h}:${mi}`
}

export const EventModal: React.FC<EventModalProps> = ({
  isOpen,
  onClose,
  onSave,
  branches,
  defaultBranchId,
  event,
}) => {
  const toast = useToastStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<unknown[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const [form, setForm] = useState<CreateEventData>({
    event_ts: new Date().toISOString().slice(0, 16),
    event_ts_tz_offset: 0,
    event_type: 'detection',
    title: '',
    description: '',
    source_description: '',
    confidence_level: 'hypothesis',
    mitre_tactic: '',
    mitre_technique: '',
    mitre_subtechnique: '',
    branch_id: defaultBranchId,
  })

  const [errors, setErrors] = useState<Partial<Record<keyof CreateEventData, string>>>({})

  useEffect(() => {
    if (!isOpen) return
    if (event) {
      setForm({
        event_ts: toDatetimeLocal(event.event_ts),
        event_ts_tz_offset: event.event_ts_tz_offset ?? 0,
        event_type: event.event_type,
        title: event.title,
        description: event.description ?? '',
        source_description: event.source_description ?? '',
        confidence_level: event.confidence_level,
        mitre_tactic: event.mitre_tactic ?? '',
        mitre_technique: event.mitre_technique ?? '',
        mitre_subtechnique: event.mitre_subtechnique ?? '',
        branch_id: event.branch_id,
      })
      setArtifacts(event.artifacts ?? [])
    } else {
      setForm({
        event_ts: new Date().toISOString().slice(0, 16),
        event_ts_tz_offset: 0,
        event_type: 'detection',
        title: '',
        description: '',
        source_description: '',
        confidence_level: 'hypothesis',
        mitre_tactic: '',
        mitre_technique: '',
        mitre_subtechnique: '',
        branch_id: defaultBranchId,
      })
      setArtifacts([])
    }
    setErrors({})
    setShowHistory(false)
    setHistory([])
  }, [isOpen, event, defaultBranchId])

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof CreateEventData, string>> = {}
    if (!form.title.trim()) newErrors.title = 'Обязательное поле'
    if (!form.event_ts) newErrors.event_ts = 'Обязательное поле'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setIsSaving(true)
    try {
      // Interpret datetime-local value in the analyst's declared timezone offset,
      // not the browser's local timezone (they may differ).
      const tzOffsetMin = form.event_ts_tz_offset ?? 0
      const sign = tzOffsetMin >= 0 ? '+' : '-'
      const absMin = Math.abs(tzOffsetMin)
      const tzStr = `${sign}${String(Math.floor(absMin / 60)).padStart(2, '0')}:${String(absMin % 60).padStart(2, '0')}`
      await onSave({
        ...form,
        event_ts: new Date(`${form.event_ts}:00${tzStr}`).toISOString(),
      })
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  const handleFileUpload = async (file: File) => {
    if (!event?.id) {
      toast.warning('Сохраните событие перед загрузкой артефактов')
      return
    }
    setUploadingFile(true)
    try {
      const artifact = await uploadArtifact(event.id, file)
      setArtifacts((prev) => [...prev, artifact])
      toast.success(`Файл "${file.name}" загружен`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла')
    } finally {
      setUploadingFile(false)
    }
  }

  const handleDeleteArtifact = async (artifactId: string) => {
    try {
      await deleteArtifact(artifactId)
      setArtifacts((prev) => prev.filter((a) => a.id !== artifactId))
      toast.success('Артефакт удалён')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления')
    }
  }

  const handleLoadHistory = async () => {
    if (!event?.id) return
    try {
      const h = await getEventHistory(event.id)
      setHistory(h)
      setShowHistory(true)
    } catch {
      toast.error('Ошибка загрузки истории')
    }
  }

  const setField = <K extends keyof CreateEventData>(key: K, value: CreateEventData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const inputStyle: React.CSSProperties = { width: '100%' }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={event ? 'Редактировать событие' : 'Добавить событие'}
      width={720}
      footer={
        <>
          {event && (
            <Button variant="ghost" onClick={handleLoadHistory} size="sm">
              История изменений
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            Сохранить
          </Button>
        </>
      }
    >
      {showHistory ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>
              ← Назад
            </Button>
            <span style={{ fontSize: 14, fontWeight: 600 }}>История изменений</span>
          </div>
          {history.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>История пуста</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(history as Array<Record<string, unknown>>).map((entry, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '10px 14px',
                    fontSize: 12,
                  }}
                >
                  <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Row 1: datetime + tz + type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 12 }}>
            <div>
              <label htmlFor="event-ts">Дата и время события *</label>
              <input
                id="event-ts"
                type="datetime-local"
                value={form.event_ts}
                onChange={(e) => setField('event_ts', e.target.value)}
                style={inputStyle}
              />
              {errors.event_ts && (
                <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.event_ts}</span>
              )}
            </div>
            <div>
              <label htmlFor="tz-offset">UTC смещ.</label>
              <input
                id="tz-offset"
                type="number"
                min={-720}
                max={840}
                step={30}
                value={form.event_ts_tz_offset ?? 0}
                onChange={(e) => setField('event_ts_tz_offset', Number(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="event-type">Тип события *</label>
              <select
                id="event-type"
                value={form.event_type}
                onChange={(e) => setField('event_type', e.target.value as EventType)}
                style={inputStyle}
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="event-title">Заголовок *</label>
            <input
              id="event-title"
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="Краткое описание события"
              style={inputStyle}
            />
            {errors.title && (
              <span style={{ color: 'var(--danger)', fontSize: 11 }}>{errors.title}</span>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="event-desc">Описание</label>
            <textarea
              id="event-desc"
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={3}
              placeholder="Подробное описание события..."
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Source + Confidence */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="event-source">Источник / доказательство</label>
              <input
                id="event-source"
                type="text"
                value={form.source_description}
                onChange={(e) => setField('source_description', e.target.value)}
                placeholder="Лог, скриншот, отчёт..."
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="confidence">Уровень достоверности *</label>
              <select
                id="confidence"
                value={form.confidence_level}
                onChange={(e) => setField('confidence_level', e.target.value as ConfidenceLevel)}
                style={inputStyle}
              >
                {Object.entries(CONFIDENCE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* MITRE */}
          <div>
            <label style={{ marginBottom: 8 }}>MITRE ATT&amp;CK</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="mitre-tactic" style={{ fontSize: 11 }}>
                  Тактика
                </label>
                <input
                  id="mitre-tactic"
                  type="text"
                  value={form.mitre_tactic ?? ''}
                  onChange={(e) => setField('mitre_tactic', e.target.value)}
                  placeholder="Initial Access"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="mitre-technique" style={{ fontSize: 11 }}>
                  Техника
                </label>
                <input
                  id="mitre-technique"
                  type="text"
                  value={form.mitre_technique ?? ''}
                  onChange={(e) => setField('mitre_technique', e.target.value)}
                  placeholder="T1566"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="mitre-sub" style={{ fontSize: 11 }}>
                  Подтехника
                </label>
                <input
                  id="mitre-sub"
                  type="text"
                  value={form.mitre_subtechnique ?? ''}
                  onChange={(e) => setField('mitre_subtechnique', e.target.value)}
                  placeholder=".001"
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* Branch */}
          <div>
            <label htmlFor="branch-select">Ветка расследования</label>
            <select
              id="branch-select"
              value={form.branch_id ?? ''}
              onChange={(e) => setField('branch_id', e.target.value)}
              style={inputStyle}
            >
              <option value="">— Выберите ветку —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.is_main ? '(главная)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Artifacts */}
          <div>
            <label>Артефакты</label>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                const file = e.dataTransfer.files[0]
                if (file) handleFileUpload(file)
              }}
              style={{
                border: `2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8,
                padding: 16,
                background: isDragOver ? 'rgba(88,166,255,0.05)' : 'var(--bg-tertiary)',
                transition: 'all 0.15s',
                cursor: 'pointer',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileUpload(file)
                  e.target.value = ''
                }}
              />
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                {uploadingFile ? (
                  <span>Загрузка...</span>
                ) : (
                  <>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>📎</div>
                    Перетащите файл или нажмите для выбора
                  </>
                )}
              </div>
            </div>

            {artifacts.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {artifacts.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '6px 10px',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>📄</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {a.file_name}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: 'var(--text-secondary)',
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        SHA256: {a.sha256}
                      </div>
                    </div>
                    {a.file_size && (
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                        {(a.file_size / 1024).toFixed(1)} KB
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteArtifact(a.id)
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--danger)',
                        cursor: 'pointer',
                        fontSize: 14,
                        padding: 2,
                        flexShrink: 0,
                      }}
                      title="Удалить артефакт"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
