import React, { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Event, Artifact, IOC } from '../../types'
import { EVENT_TYPE_LABELS, CONFIDENCE_LABELS, IOC_TYPE_LABELS } from '../../types'
import {
  uploadArtifact, getArtifactUrl, deleteEvent, getComments, createComment, updateEvent,
} from '../../api/events'
import { useAuthStore } from '../../store/auth'
import { useToastStore } from '../../store/toast'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { CommentList } from '../Comments/CommentList'
import { ConfirmDialog } from '../ui/ConfirmDialog'

interface EventDetailProps {
  event: Event
  iocs: IOC[]
  onEdit: (event: Event) => void
  onDelete: (eventId: string) => void
  onUpdate: (event: Event) => void
  onClose: () => void
}

const EVENT_COLOR_MAP: Record<string, string> = {
  attacker_action: 'red',
  detection: 'yellow',
  ir_action: 'green',
  inference: 'blue',
  legal_event: 'purple',
}

const CONFIDENCE_COLOR_MAP: Record<string, string> = {
  confirmed: 'green',
  corroborated: 'yellow',
  hypothesis: 'gray',
}

export const EventDetail: React.FC<EventDetailProps> = ({
  event,
  iocs,
  onEdit,
  onDelete,
  onUpdate,
  onClose,
}) => {
  const { user } = useAuthStore()
  const toast = useToastStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>(event.artifacts ?? [])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isEditingMitre, setIsEditingMitre] = useState(false)
  const [mitreDraft, setMitreDraft] = useState({ tactic: '', technique: '', subtechnique: '' })
  const [isSavingMitre, setIsSavingMitre] = useState(false)

  useEffect(() => {
    setArtifacts(event.artifacts ?? [])
    setIsEditingMitre(false)
  }, [event])

  const canEdit =
    user?.role === 'admin' ||
    user?.role === 'ir_lead' ||
    user?.role === 'investigator' ||
    user?.role === 'threat_hunter'

  const handleArtifactUpload = async (file: File) => {
    setUploadingFile(true)
    try {
      const artifact = await uploadArtifact(event.id, file)
      setArtifacts((prev) => [...prev, artifact])
      toast.success(`Артефакт "${file.name}" загружен`)
    } catch {
      toast.error('Ошибка загрузки артефакта')
    } finally {
      setUploadingFile(false)
    }
  }

  const handleDownload = async (artifact: Artifact) => {
    try {
      const url = await getArtifactUrl(artifact.id)
      const a = document.createElement('a')
      a.href = url
      a.download = artifact.file_name
      a.click()
    } catch {
      toast.error('Ошибка получения ссылки на скачивание')
    }
  }

  const handleDelete = async (reason: string) => {
    setIsDeleting(true)
    try {
      await deleteEvent(event.id, reason)
      onDelete(event.id)
      toast.success('Событие удалено')
      setShowDeleteDialog(false)
    } catch {
      toast.error('Ошибка удаления события')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleMitreStartEdit = () => {
    setMitreDraft({
      tactic: event.mitre_tactic ?? '',
      technique: event.mitre_technique ?? '',
      subtechnique: event.mitre_subtechnique ?? '',
    })
    setIsEditingMitre(true)
  }

  const handleMitreSave = async () => {
    setIsSavingMitre(true)
    try {
      const updated = await updateEvent(event.id, {
        mitre_tactic: mitreDraft.tactic.trim() || null,
        mitre_technique: mitreDraft.technique.trim() || null,
        mitre_subtechnique: mitreDraft.subtechnique.trim() || null,
      })
      onUpdate(updated)
      toast.success('MITRE ATT&CK обновлён')
      setIsEditingMitre(false)
    } catch {
      toast.error('Ошибка обновления MITRE ATT&CK')
    } finally {
      setIsSavingMitre(false)
    }
  }

  const eventIocs = iocs.filter((ioc) => event.iocs?.some((i) => i.id === ioc.id))

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <Badge
              color={EVENT_COLOR_MAP[event.event_type] as 'red'}
              label={EVENT_TYPE_LABELS[event.event_type]}
              size="sm"
            />
            <Badge
              color={CONFIDENCE_COLOR_MAP[event.confidence_level] as 'green'}
              label={CONFIDENCE_LABELS[event.confidence_level]}
              size="sm"
            />
          </div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.4,
            }}
          >
            {event.title}
          </h3>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 18,
            cursor: 'pointer',
            padding: 2,
            flexShrink: 0,
          }}
          title="Закрыть"
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {/* Timestamps */}
        <Section title="Время события">
          <MetaRow label="UTC">
            {format(new Date(event.event_ts), 'dd.MM.yyyy HH:mm:ss', { locale: ru })} UTC
          </MetaRow>
          {event.event_ts_tz_offset !== undefined && event.event_ts_tz_offset !== 0 && (
            <MetaRow label="Местное">
              UTC{event.event_ts_tz_offset >= 0 ? '+' : ''}
              {event.event_ts_tz_offset / 60}
            </MetaRow>
          )}
        </Section>

        {/* MITRE */}
        <Section
          title="MITRE ATT&CK"
          action={
            canEdit && !isEditingMitre ? (
              <Button variant="ghost" size="sm" onClick={handleMitreStartEdit}>
                Изменить
              </Button>
            ) : undefined
          }
        >
          {isEditingMitre ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label htmlFor="mitre-tactic-edit" style={{ fontSize: 11 }}>
                  Тактика
                </label>
                <input
                  id="mitre-tactic-edit"
                  type="text"
                  value={mitreDraft.tactic}
                  onChange={(e) => setMitreDraft((p) => ({ ...p, tactic: e.target.value }))}
                  placeholder="Например, Initial Access"
                  style={{ fontSize: 12 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="mitre-technique-edit" style={{ fontSize: 11 }}>
                    Техника
                  </label>
                  <input
                    id="mitre-technique-edit"
                    type="text"
                    value={mitreDraft.technique}
                    onChange={(e) => setMitreDraft((p) => ({ ...p, technique: e.target.value }))}
                    placeholder="T1566"
                    style={{ fontSize: 12 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="mitre-sub-edit" style={{ fontSize: 11 }}>
                    Подтехника
                  </label>
                  <input
                    id="mitre-sub-edit"
                    type="text"
                    value={mitreDraft.subtechnique}
                    onChange={(e) => setMitreDraft((p) => ({ ...p, subtechnique: e.target.value }))}
                    placeholder="001"
                    style={{ fontSize: 12 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" size="sm" onClick={() => setIsEditingMitre(false)}>
                  Отмена
                </Button>
                <Button variant="primary" size="sm" onClick={handleMitreSave} isLoading={isSavingMitre}>
                  Сохранить
                </Button>
              </div>
            </div>
          ) : event.mitre_tactic || event.mitre_technique ? (
            <>
              {event.mitre_tactic && <MetaRow label="Тактика">{event.mitre_tactic}</MetaRow>}
              {event.mitre_technique && (
                <MetaRow label="Техника">
                  <code>{event.mitre_technique}</code>
                  {event.mitre_subtechnique && <code>.{event.mitre_subtechnique}</code>}
                </MetaRow>
              )}
            </>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Не указано</p>
          )}
        </Section>

        {/* Description */}
        {event.description && (
          <Section title="Описание">
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {event.description}
            </p>
          </Section>
        )}

        {/* Source */}
        {event.source_description && (
          <Section title="Источник / доказательство">
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {event.source_description}
            </p>
          </Section>
        )}

        {/* Artifacts */}
        <Section
          title={`Артефакты (${artifacts.length})`}
          action={
            canEdit ? (
              <Button
                variant="ghost"
                size="sm"
                isLoading={uploadingFile}
                onClick={() => fileInputRef.current?.click()}
              >
                + Добавить
              </Button>
            ) : undefined
          }
        >
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleArtifactUpload(file)
              e.target.value = ''
            }}
          />
          {artifacts.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Артефакты отсутствуют</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {artifacts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>📄</span>
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
                        marginTop: 2,
                      }}
                    >
                      {a.sha256}
                    </div>
                    {a.file_size && (
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>
                        {(a.file_size / 1024).toFixed(1)} KB
                        {a.is_worm && (
                          <span
                            style={{ marginLeft: 6, color: 'var(--success)' }}
                            title="WORM-защита"
                          >
                            🔒 WORM
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDownload(a)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: 4,
                      flexShrink: 0,
                    }}
                    title="Скачать"
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* IOCs */}
        {eventIocs.length > 0 && (
          <Section title="Индикаторы компрометации">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {eventIocs.map((ioc) => (
                <span
                  key={ioc.id}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: 'var(--text-primary)',
                  }}
                  title={`${IOC_TYPE_LABELS[ioc.ioc_type] ?? ioc.ioc_type}: ${ioc.value}`}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {IOC_TYPE_LABELS[ioc.ioc_type] ?? ioc.ioc_type}:{' '}
                  </span>
                  {ioc.value}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Comments */}
        <Section title="Комментарии">
          <CommentList
            key={event.id}
            fetchComments={() => getComments(event.id)}
            onCreateComment={(data) => createComment(event.id, data)}
          />
        </Section>
      </div>

      {/* Actions */}
      {canEdit && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <Button variant="secondary" size="sm" onClick={() => onEdit(event)} style={{ flex: 1 }}>
            Редактировать
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            style={{ flex: 1 }}
          >
            Удалить
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Удалить событие"
        message={`Вы уверены, что хотите удалить событие "${event.title}"? Событие будет помечено как удалённое.`}
        requireReason
        reasonLabel="Причина удаления"
        confirmLabel="Удалить"
        isDanger
        isLoading={isDeleting}
      />
    </div>
  )
}

// Helper components
const Section: React.FC<{
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}> = ({ title, children, action }) => (
  <div style={{ marginBottom: 16 }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}
    >
      <h4
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {title}
      </h4>
      {action}
    </div>
    {children}
  </div>
)

const MetaRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div
    style={{
      display: 'flex',
      gap: 8,
      fontSize: 12,
      marginBottom: 4,
      alignItems: 'baseline',
    }}
  >
    <span style={{ color: 'var(--text-secondary)', minWidth: 80, flexShrink: 0 }}>{label}:</span>
    <span style={{ color: 'var(--text-primary)' }}>{children}</span>
  </div>
)
