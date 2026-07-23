import React, { useState, useEffect, useRef } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { getCases } from '../../api/cases'
import { createAlertRule, createAlertRuleFromSelection, previewAlertRuleMatches } from '../../api/alertRules'
import type { AlertRuleAction, AlertRuleFromSelectionResult } from '../../api/alertRules'
import type { Alert, Case, CaseSeverity } from '../../types'
import { CASE_SEVERITY_LABELS } from '../../types'

interface AlertRuleFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (result?: AlertRuleFromSelectionResult) => void
  selectedAlerts?: Alert[]
}

function commonValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined
  const [first, ...rest] = values
  return rest.every((v) => v === first) ? first : undefined
}

const DEFAULT_FORM = {
  name: '',
  useSource: false,
  matchSource: '',
  useSeverity: false,
  matchSeverity: 'medium' as CaseSeverity,
  useTitle: false,
  matchTitleContains: '',
  useDescription: false,
  matchDescriptionContains: '',
  action: 'suppress' as AlertRuleAction,
  targetMode: 'new' as 'new' | 'existing',
  targetCaseId: '',
}

export const AlertRuleFormModal: React.FC<AlertRuleFormModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  selectedAlerts,
}) => {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [cases, setCases] = useState<Case[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [matchPreviewCount, setMatchPreviewCount] = useState<number | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const previewRequestId = useRef(0)

  const isFromSelection = !!selectedAlerts && selectedAlerts.length > 0
  const hasAnyCriteria = form.useSource || form.useSeverity || form.useTitle || form.useDescription

  useEffect(() => {
    if (!isOpen) return
    setError('')
    if (isFromSelection && selectedAlerts) {
      const commonSource = commonValue(selectedAlerts.map((a) => a.source ?? ''))
      const commonSeverity = commonValue(selectedAlerts.map((a) => a.severity))
      setForm({
        ...DEFAULT_FORM,
        name: `Правило из ${selectedAlerts.length} алертов`,
        useSource: !!commonSource,
        matchSource: commonSource || '',
        useSeverity: !!commonSeverity,
        matchSeverity: commonSeverity ?? 'medium',
      })
    } else {
      setForm(DEFAULT_FORM)
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen || form.targetMode !== 'existing') return
    getCases({ limit: 100 })
      .then(setCases)
      .catch(() => setCases([]))
  }, [isOpen, form.targetMode])

  // Automatic live check: as soon as any matching condition is set, ask the
  // backend how many currently-active alerts already satisfy it — this is
  // the "проверка совпадений в условиях правил" requested for this modal.
  useEffect(() => {
    if (!isOpen || !hasAnyCriteria) {
      setMatchPreviewCount(null)
      return
    }
    const requestId = ++previewRequestId.current
    setIsPreviewLoading(true)
    const timer = setTimeout(() => {
      previewAlertRuleMatches({
        match_source: form.useSource ? form.matchSource.trim() || undefined : undefined,
        match_severity: form.useSeverity ? form.matchSeverity : undefined,
        match_title_contains: form.useTitle ? form.matchTitleContains.trim() || undefined : undefined,
        match_description_contains: form.useDescription
          ? form.matchDescriptionContains.trim() || undefined
          : undefined,
      })
        .then((count) => {
          if (requestId === previewRequestId.current) setMatchPreviewCount(count)
        })
        .catch(() => {
          if (requestId === previewRequestId.current) setMatchPreviewCount(null)
        })
        .finally(() => {
          if (requestId === previewRequestId.current) setIsPreviewLoading(false)
        })
    }, 400)
    return () => clearTimeout(timer)
  }, [
    isOpen,
    hasAnyCriteria,
    form.useSource,
    form.matchSource,
    form.useSeverity,
    form.matchSeverity,
    form.useTitle,
    form.matchTitleContains,
    form.useDescription,
    form.matchDescriptionContains,
  ])

  const setField = <K extends keyof typeof DEFAULT_FORM>(key: K, value: (typeof DEFAULT_FORM)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Укажите название правила')
      return
    }
    if (!form.useSource && !form.useSeverity && !form.useTitle && !form.useDescription) {
      setError('Выберите хотя бы один признак для сопоставления')
      return
    }
    if (form.action === 'escalate' && form.targetMode === 'existing' && !form.targetCaseId) {
      setError('Выберите дело')
      return
    }

    const basePayload = {
      name: form.name.trim(),
      match_source: form.useSource ? form.matchSource.trim() || undefined : undefined,
      match_severity: form.useSeverity ? form.matchSeverity : undefined,
      match_title_contains: form.useTitle ? form.matchTitleContains.trim() || undefined : undefined,
      match_description_contains: form.useDescription
        ? form.matchDescriptionContains.trim() || undefined
        : undefined,
      action: form.action,
      target_case_id:
        form.action === 'escalate' && form.targetMode === 'existing' ? form.targetCaseId : undefined,
    }

    setIsSaving(true)
    setError('')
    try {
      if (isFromSelection && selectedAlerts) {
        const result = await createAlertRuleFromSelection({
          ...basePayload,
          alert_ids: selectedAlerts.map((a) => a.id),
        })
        onSaved(result)
      } else {
        await createAlertRule(basePayload)
        onSaved()
      }
      onClose()
    } catch {
      setError('Ошибка сохранения правила')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isFromSelection ? `Новое правило из ${selectedAlerts?.length ?? 0} алертов` : 'Новое правило'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            {isFromSelection ? 'Создать и применить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="rule-name">Название *</label>
          <input
            id="rule-name"
            type="text"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
          />
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          Признаки для сопоставления (выберите хотя бы один)
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.useSource}
            onChange={(e) => setField('useSource', e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: 13, minWidth: 110 }}>Источник:</span>
          <input
            type="text"
            value={form.matchSource}
            disabled={!form.useSource}
            onChange={(e) => setField('matchSource', e.target.value)}
            placeholder="Например: TheHive"
            style={{ flex: 1 }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.useSeverity}
            onChange={(e) => setField('useSeverity', e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: 13, minWidth: 110 }}>Критичность:</span>
          <select
            value={form.matchSeverity}
            disabled={!form.useSeverity}
            onChange={(e) => setField('matchSeverity', e.target.value as CaseSeverity)}
            style={{ flex: 1 }}
          >
            {Object.entries(CASE_SEVERITY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.useTitle}
            onChange={(e) => setField('useTitle', e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: 13, minWidth: 110 }}>Заголовок содержит:</span>
          <input
            type="text"
            value={form.matchTitleContains}
            disabled={!form.useTitle}
            onChange={(e) => setField('matchTitleContains', e.target.value)}
            placeholder="Подстрока"
            style={{ flex: 1 }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.useDescription}
            onChange={(e) => setField('useDescription', e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontSize: 13, minWidth: 110 }}>Описание содержит:</span>
          <input
            type="text"
            value={form.matchDescriptionContains}
            disabled={!form.useDescription}
            onChange={(e) => setField('matchDescriptionContains', e.target.value)}
            placeholder="Подстрока"
            style={{ flex: 1 }}
          />
        </label>

        {hasAnyCriteria && (
          <div
            style={{
              fontSize: 12,
              color: isPreviewLoading ? 'var(--text-secondary)' : 'var(--accent)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
            }}
          >
            {isPreviewLoading
              ? 'Проверка совпадений…'
              : matchPreviewCount === null
                ? 'Не удалось проверить совпадения'
                : `Совпадает с текущими условиями: ${matchPreviewCount} алерт(ов)`}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 6 }}>
          Действие
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={form.action === 'suppress'}
              onChange={() => setField('action', 'suppress')}
              style={{ width: 'auto' }}
            />
            <span style={{ fontSize: 13 }}>Подавлять (отклонять)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={form.action === 'escalate'}
              onChange={() => setField('action', 'escalate')}
              style={{ width: 'auto' }}
            />
            <span style={{ fontSize: 13 }}>Эскалировать в дело</span>
          </label>
        </div>

        {form.action === 'escalate' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
            <div style={{ display: 'flex', gap: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={form.targetMode === 'new'}
                  onChange={() => setField('targetMode', 'new')}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>В новое дело (на каждое совпадение)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={form.targetMode === 'existing'}
                  onChange={() => setField('targetMode', 'existing')}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>В существующее дело</span>
              </label>
            </div>
            {form.targetMode === 'existing' && (
              <select value={form.targetCaseId} onChange={(e) => setField('targetCaseId', e.target.value)}>
                <option value="">Выберите дело…</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
      </div>
    </Modal>
  )
}
