import React, { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToastStore } from '../../store/toast'
import { getAlertRules, updateAlertRule, deleteAlertRule } from '../../api/alertRules'
import type { AlertRule } from '../../api/alertRules'
import { AlertRuleFormModal } from './AlertRuleFormModal'
import { CASE_SEVERITY_LABELS } from '../../types'

interface AlertRulesModalProps {
  isOpen: boolean
  onClose: () => void
}

function describeRule(rule: AlertRule): string {
  const parts: string[] = []
  if (rule.match_source) parts.push(`источник = ${rule.match_source}`)
  if (rule.match_severity) parts.push(`критичность = ${CASE_SEVERITY_LABELS[rule.match_severity]}`)
  if (rule.match_title_contains) parts.push(`заголовок содержит «${rule.match_title_contains}»`)
  if (rule.match_description_contains) parts.push(`описание содержит «${rule.match_description_contains}»`)
  return parts.join(', ') || '—'
}

function describeAction(rule: AlertRule): string {
  if (rule.action === 'suppress') return 'Подавлять'
  return rule.target_case_id ? 'Эскалировать → существующее дело' : 'Эскалировать → новое дело'
}

export const AlertRulesModal: React.FC<AlertRulesModalProps> = ({ isOpen, onClose }) => {
  const toast = useToastStore()
  const [rules, setRules] = useState<AlertRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deletingRule, setDeletingRule] = useState<AlertRule | null>(null)

  const load = () => {
    setIsLoading(true)
    getAlertRules()
      .then(setRules)
      .catch(() => toast.error('Ошибка загрузки правил'))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    if (isOpen) load()
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = async (rule: AlertRule) => {
    try {
      const updated = await updateAlertRule(rule.id, { is_enabled: !rule.is_enabled })
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch {
      toast.error('Ошибка обновления правила')
    }
  }

  const handleDelete = async () => {
    if (!deletingRule) return
    try {
      await deleteAlertRule(deletingRule.id)
      setRules((prev) => prev.filter((r) => r.id !== deletingRule.id))
      toast.success('Правило удалено')
    } catch {
      toast.error('Ошибка удаления правила')
    } finally {
      setDeletingRule(null)
    }
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Правила алертов"
        width={760}
        footer={
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
            + Создать правило
          </Button>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 0' }}>
            <Spinner size={24} />
          </div>
        ) : rules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Правил ещё нет
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  <th style={thStyle}>Название</th>
                  <th style={thStyle}>Условие</th>
                  <th style={thStyle}>Действие</th>
                  <th style={thStyle}>Вкл.</th>
                  <th style={thStyle}>Применено</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {rules.map((r, idx) => (
                  <tr key={r.id} style={{ borderTop: idx > 0 ? '1px solid var(--border)' : 'none' }}>
                    <td style={tdStyle}>{r.name}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>
                      {describeRule(r)}
                    </td>
                    <td style={tdStyle}>{describeAction(r)}</td>
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={r.is_enabled}
                        onChange={() => handleToggle(r)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={tdStyle}>
                      {r.applied_count}
                      {r.last_applied_at && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {format(new Date(r.last_applied_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <button onClick={() => setDeletingRule(r)} style={linkDangerStyle}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <AlertRuleFormModal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSaved={() => {
          toast.success('Правило создано')
          load()
        }}
      />

      <ConfirmDialog
        isOpen={!!deletingRule}
        onClose={() => setDeletingRule(null)}
        onConfirm={handleDelete}
        title="Удалить правило"
        message={`Правило «${deletingRule?.name}» будет удалено. На уже обработанные алерты это не повлияет.`}
        confirmLabel="Удалить"
        isDanger
      />
    </>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '10px',
  fontSize: 13,
  color: 'var(--text-primary)',
  verticalAlign: 'middle',
}

const linkDangerStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--danger)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
}
