import React, { useState, useEffect, useRef } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { getCases } from '../../api/cases'
import {
  createAlertRule, createAlertRuleFromSelection, previewAlertRuleMatches, updateAlertRule,
} from '../../api/alertRules'
import type { AlertRule, AlertRuleAction, AlertRuleFromSelectionResult } from '../../api/alertRules'
import type { Alert, Case } from '../../types'

interface AlertRuleFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (result?: AlertRuleFromSelectionResult) => void
  selectedAlerts?: Alert[]
  editingRule?: AlertRule | null
}

function extractErrorMessage(err: unknown): string | undefined {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') {
    return detail[0].msg.replace(/^Value error,\s*/, '')
  }
  return undefined
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
  useTitle: false,
  matchTitleContains: [] as string[],
  useDescription: false,
  matchDescriptionContains: [] as string[],
  action: 'suppress' as AlertRuleAction,
  targetMode: 'new' as 'new' | 'existing',
  targetCaseId: '',
  tagValue: '',
  applyToExisting: false,
}

const MultiValueInput: React.FC<{
  values: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
  placeholder?: string
}> = ({ values, onChange, disabled, placeholder }) => {
  const [draft, setDraft] = useState('')

  const addValue = () => {
    const trimmed = draft.trim()
    if (!trimmed || values.includes(trimmed)) return
    onChange([...values, trimmed])
    setDraft('')
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addValue()
            }
          }}
          onBlur={addValue}
          placeholder={placeholder}
          style={{ flex: 1 }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={addValue} disabled={disabled || !draft.trim()}>
          Добавить
        </Button>
      </div>
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {values.map((v) => (
            <span
              key={v}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 12, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '2px 4px 2px 8px',
              }}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                disabled={disabled}
                title="Удалить"
                style={{
                  background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
                  color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1, padding: '0 2px',
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export const AlertRuleFormModal: React.FC<AlertRuleFormModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  selectedAlerts,
  editingRule,
}) => {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [cases, setCases] = useState<Case[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [matchPreviewCount, setMatchPreviewCount] = useState<number | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const previewRequestId = useRef(0)

  const isEditing = !!editingRule
  const isFromSelection = !isEditing && !!selectedAlerts && selectedAlerts.length > 0
  const hasAnyCriteria = form.useSource || form.useTitle || form.useDescription

  useEffect(() => {
    if (!isOpen) return
    setError('')
    if (editingRule) {
      setForm({
        ...DEFAULT_FORM,
        name: editingRule.name,
        useSource: !!editingRule.match_source,
        matchSource: editingRule.match_source ?? '',
        useTitle: (editingRule.match_title_contains?.length ?? 0) > 0,
        matchTitleContains: editingRule.match_title_contains ?? [],
        useDescription: (editingRule.match_description_contains?.length ?? 0) > 0,
        matchDescriptionContains: editingRule.match_description_contains ?? [],
        action: editingRule.action,
        targetMode: editingRule.target_case_id ? 'existing' : 'new',
        targetCaseId: editingRule.target_case_id ?? '',
        tagValue: editingRule.tag_value ?? '',
      })
    } else if (isFromSelection && selectedAlerts) {
      const commonSource = commonValue(selectedAlerts.map((a) => a.source ?? ''))
      setForm({
        ...DEFAULT_FORM,
        name: `Правило из ${selectedAlerts.length} алертов`,
        useSource: !!commonSource,
        matchSource: commonSource || '',
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
        match_title_contains: form.useTitle && form.matchTitleContains.length > 0 ? form.matchTitleContains : undefined,
        match_description_contains:
          form.useDescription && form.matchDescriptionContains.length > 0 ? form.matchDescriptionContains : undefined,
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
    if (!form.useSource && !form.useTitle && !form.useDescription) {
      setError('Выберите хотя бы один признак для сопоставления')
      return
    }
    if (form.action === 'escalate' && form.targetMode === 'existing' && !form.targetCaseId) {
      setError('Выберите инцидент')
      return
    }
    if (form.action === 'assign_tag' && !form.tagValue.trim()) {
      setError('Укажите значение тега')
      return
    }

    const basePayload = {
      name: form.name.trim(),
      match_source: form.useSource ? form.matchSource.trim() || undefined : undefined,
      match_title_contains: form.useTitle && form.matchTitleContains.length > 0 ? form.matchTitleContains : undefined,
      match_description_contains:
        form.useDescription && form.matchDescriptionContains.length > 0 ? form.matchDescriptionContains : undefined,
      action: form.action,
      target_case_id:
        form.action === 'escalate' && form.targetMode === 'existing' ? form.targetCaseId : undefined,
      tag_value: form.action === 'assign_tag' ? form.tagValue.trim() : undefined,
    }

    setIsSaving(true)
    setError('')
    try {
      if (isEditing && editingRule) {
        await updateAlertRule(editingRule.id, basePayload)
        onSaved()
      } else if (isFromSelection && selectedAlerts) {
        const result = await createAlertRuleFromSelection({
          ...basePayload,
          alert_ids: selectedAlerts.map((a) => a.id),
          apply_to_existing: form.applyToExisting,
        })
        onSaved(result)
      } else {
        const rule = await createAlertRule({ ...basePayload, apply_to_existing: form.applyToExisting })
        onSaved(form.applyToExisting ? { rule, applied_count: rule.applied_count } : undefined)
      }
      onClose()
    } catch (e) {
      setError(extractErrorMessage(e) || 'Ошибка сохранения правила')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEditing
          ? `Изменить правило «${editingRule?.name}»`
          : isFromSelection
            ? `Новое правило из ${selectedAlerts?.length ?? 0} алертов`
            : 'Новое правило'
      }
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSaving}>
            {isEditing ? 'Сохранить' : isFromSelection || form.applyToExisting ? 'Создать и применить' : 'Создать'}
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
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: -8 }}>
          Для «Заголовок»/«Описание» можно добавить несколько подстрок — совпадение по любой из них
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

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.useTitle}
            onChange={(e) => setField('useTitle', e.target.checked)}
            style={{ width: 'auto', marginTop: 6 }}
          />
          <span style={{ fontSize: 13, minWidth: 110, marginTop: 6 }}>Заголовок содержит:</span>
          <MultiValueInput
            values={form.matchTitleContains}
            onChange={(values) => setField('matchTitleContains', values)}
            disabled={!form.useTitle}
            placeholder="Подстрока — Enter или «Добавить»"
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.useDescription}
            onChange={(e) => setField('useDescription', e.target.checked)}
            style={{ width: 'auto', marginTop: 6 }}
          />
          <span style={{ fontSize: 13, minWidth: 110, marginTop: 6 }}>Описание содержит:</span>
          <MultiValueInput
            values={form.matchDescriptionContains}
            onChange={(values) => setField('matchDescriptionContains', values)}
            disabled={!form.useDescription}
            placeholder="Подстрока — Enter или «Добавить»"
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

        {!isEditing && hasAnyCriteria && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.applyToExisting}
              onChange={(e) => setField('applyToExisting', e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span style={{ fontSize: 13 }}>
              {isFromSelection
                ? 'Также применить к другим существующим алертам, подходящим под условия'
                : 'Применить к существующим алертам'}
            </span>
          </label>
        )}

        <div>
          <label htmlFor="rule-action" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Действие
          </label>
          <select
            id="rule-action"
            value={form.action}
            onChange={(e) => setField('action', e.target.value as AlertRuleAction)}
          >
            <option value="suppress">Подавлять (отклонять)</option>
            <option value="escalate">Эскалировать в инцидент</option>
            <option value="assign_tag">Назначить тег</option>
            <option value="archive">В архив</option>
          </select>
        </div>

        {form.action === 'assign_tag' && (
          <div style={{ paddingLeft: 4 }}>
            <input
              type="text"
              value={form.tagValue}
              onChange={(e) => setField('tagValue', e.target.value)}
              placeholder="Значение тега"
            />
          </div>
        )}

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
                <span style={{ fontSize: 13 }}>В новый инцидент (на каждое совпадение)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={form.targetMode === 'existing'}
                  onChange={() => setField('targetMode', 'existing')}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>В существующий инцидент</span>
              </label>
            </div>
            {form.targetMode === 'existing' && (
              <select value={form.targetCaseId} onChange={(e) => setField('targetCaseId', e.target.value)}>
                <option value="">Выберите инцидент…</option>
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
