import React, { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AppLayout } from '../components/Layout/AppLayout'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'
import { useToastStore } from '../store/toast'
import {
  getMitreMatrix, getMitreSettings, syncMitreNow, updateMitreSettings,
} from '../api/mitre'
import type { MitreMatrix, MitreSettings, MitreTechnique } from '../api/mitre'

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'green',
  informational: 'gray',
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
  informational: 'Информационный',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: '#f85149',
  high: '#ff8c00',
  medium: '#d29922',
  low: '#3fb950',
  informational: '#8b949e',
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  informational: 0,
}

function fmtDateTime(value?: string | null): string {
  if (!value) return 'никогда'
  return format(new Date(value), 'dd.MM.yyyy HH:mm', { locale: ru })
}

export const MitreAttackPage: React.FC = () => {
  const toast = useToastStore()
  const [matrix, setMatrix] = useState<MitreMatrix | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  const load = () => {
    setIsLoading(true)
    getMitreMatrix()
      .then(setMatrix)
      .catch(() => toast.error('Не удалось загрузить матрицу MITRE ATT&CK'))
      .finally(() => setIsLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const techniquesByTactic = useMemo(() => {
    const map = new Map<string, MitreTechnique[]>()
    if (!matrix) return map
    for (const tech of matrix.techniques) {
      if (tech.is_subtechnique) continue
      for (const tactic of tech.tactics) {
        if (!map.has(tactic)) map.set(tactic, [])
        map.get(tactic)!.push(tech)
      }
    }
    return map
  }, [matrix])

  const subtechniquesByParent = useMemo(() => {
    const map = new Map<string, MitreTechnique[]>()
    if (!matrix) return map
    for (const tech of matrix.techniques) {
      if (!tech.is_subtechnique || !tech.parent_technique_id) continue
      if (!map.has(tech.parent_technique_id)) map.set(tech.parent_technique_id, [])
      map.get(tech.parent_technique_id)!.push(tech)
    }
    return map
  }, [matrix])

  const tacticsBySeverity = useMemo(() => {
    if (!matrix) return []
    return [...matrix.tactics].sort(
      (a, b) => (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1),
    )
  }, [matrix])

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>MITRE ATT&amp;CK</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Матрица тактик и техник Enterprise ATT&amp;CK. Последнее обновление:{' '}
              {fmtDateTime(matrix?.last_synced_at)}, всего техник: {matrix?.technique_count ?? '—'}.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowSettings(true)}>
            Настройки
          </Button>
        </div>

        {matrix && matrix.tactics.length > 0 && (
          <div
            style={{
              marginBottom: 16,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Тактика</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Критичность</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Гриф</th>
                </tr>
              </thead>
              <tbody>
                {tacticsBySeverity.map((tactic, idx) => (
                  <tr key={tactic.shortname} style={{ borderTop: idx > 0 ? '1px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '6px 12px' }}>{tactic.label}</td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: SEVERITY_DOT[tactic.severity],
                            flexShrink: 0,
                          }}
                        />
                        {SEVERITY_LABEL[tactic.severity] ?? tactic.severity}
                      </span>
                    </td>
                    <td style={{ padding: '6px 12px' }}>{tactic.grif}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spinner size={32} />
          </div>
        ) : !matrix || matrix.technique_count === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--text-secondary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            Матрица ещё не загружена. Откройте «Настройки» и нажмите «Обновить сейчас».
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
            {matrix.tactics.map((tactic) => {
              const techniques = techniquesByTactic.get(tactic.shortname) ?? []
              return (
                <div
                  key={tactic.shortname}
                  style={{
                    minWidth: 240,
                    maxWidth: 240,
                    flexShrink: 0,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: 'calc(100vh - 220px)',
                  }}
                >
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{tactic.label}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Badge
                        color={SEVERITY_COLOR[tactic.severity] as 'red'}
                        label={SEVERITY_LABEL[tactic.severity] ?? tactic.severity}
                        size="sm"
                      />
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '1px 6px',
                        }}
                        title="Уровень Грифа, до которого автоматически повышается инцидент при обнаружении этой тактики"
                      >
                        Гриф {tactic.grif}
                      </span>
                    </div>
                  </div>
                  <div style={{ overflowY: 'auto', padding: 6, flex: 1 }}>
                    {techniques.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 6 }}>Нет техник</p>
                    ) : (
                      techniques.map((tech) => {
                        const subs = subtechniquesByParent.get(tech.id) ?? []
                        return (
                          <details key={tech.id} style={{ marginBottom: 4 }}>
                            <summary
                              style={{
                                cursor: subs.length > 0 ? 'pointer' : 'default',
                                listStyle: subs.length > 0 ? undefined : 'none',
                                fontSize: 12,
                                padding: '6px 8px',
                                borderRadius: 6,
                                background: 'var(--bg-tertiary)',
                              }}
                            >
                              <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', marginRight: 6 }}>
                                {tech.id}
                              </span>
                              {tech.name}
                              {subs.length > 0 && (
                                <span style={{ color: 'var(--text-secondary)' }}> ({subs.length})</span>
                              )}
                            </summary>
                            {subs.length > 0 && (
                              <div style={{ paddingLeft: 12, marginTop: 4 }}>
                                {subs.map((sub) => (
                                  <div
                                    key={sub.id}
                                    style={{
                                      fontSize: 11,
                                      padding: '4px 8px',
                                      color: 'var(--text-secondary)',
                                    }}
                                  >
                                    <span style={{ fontFamily: 'monospace', marginRight: 6 }}>{sub.id}</span>
                                    {sub.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </details>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <MitreSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSynced={load}
      />
    </AppLayout>
  )
}

const MitreSettingsModal: React.FC<{ isOpen: boolean; onClose: () => void; onSynced: () => void }> = ({
  isOpen, onClose, onSynced,
}) => {
  const toast = useToastStore()
  const [settings, setSettings] = useState<MitreSettings | null>(null)
  const [intervalHours, setIntervalHours] = useState(24)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    getMitreSettings()
      .then((s) => {
        setSettings(s)
        setIntervalHours(s.sync_interval_hours)
      })
      .catch(() => toast.error('Не удалось загрузить настройки MITRE ATT&CK'))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSaveInterval = async () => {
    setIsSaving(true)
    try {
      const updated = await updateMitreSettings(intervalHours)
      setSettings(updated)
      toast.success('Период обновления сохранён')
    } catch {
      toast.error('Ошибка сохранения периода обновления')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSyncNow = async () => {
    setIsSyncing(true)
    try {
      const result = await syncMitreNow()
      toast[result.ok ? 'success' : 'error'](result.message)
      const updated = await getMitreSettings()
      setSettings(updated)
      onSynced()
    } catch {
      toast.error('Ошибка синхронизации матрицы')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Настройки MITRE ATT&CK" width={440}>
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <Spinner size={24} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="mitre-interval">Период автоматического обновления (часов)</label>
            <input
              id="mitre-interval"
              type="number"
              min={1}
              max={720}
              value={intervalHours}
              onChange={(e) => setIntervalHours(Number(e.target.value) || 24)}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Последнее обновление: {fmtDateTime(settings?.last_synced_at)}
            {settings?.technique_count != null && <> · техник загружено: {settings.technique_count}</>}
            {settings?.last_sync_status === 'error' && settings.last_sync_message && (
              <div style={{ color: 'var(--danger)', marginTop: 4 }}>{settings.last_sync_message}</div>
            )}
          </div>
          {settings?.source_url && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Источник синхронизации:{' '}
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{settings.source_url}</code>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" size="sm" onClick={handleSyncNow} isLoading={isSyncing}>
              Обновить сейчас
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveInterval} isLoading={isSaving}>
              Сохранить период
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
