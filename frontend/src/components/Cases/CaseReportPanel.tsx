import React, { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import type { Alert, Artifact, Case, Event, IOC } from '../../types'
import { CASE_STATUS_LABELS, CASE_SEVERITY_LABELS, IOC_TYPE_LABELS } from '../../types'
import { updateCase } from '../../api/cases'
import { getAlerts } from '../../api/alerts'
import { getBranches } from '../../api/branches'
import { getEvents } from '../../api/events'
import { useToastStore } from '../../store/toast'
import { Button } from '../ui/Button'

interface CaseReportPanelProps {
  currentCase: Case
  iocs: IOC[]
  canEdit: boolean
  onUpdate: (updated: Case) => void
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  return format(new Date(iso), 'dd.MM.yyyy HH:mm', { locale: ru })
}

function durationLabel(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) return '—'
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalMin = Math.round(ms / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const parts: string[] = []
  if (days) parts.push(`${days} д`)
  if (hours) parts.push(`${hours} ч`)
  if (mins || parts.length === 0) parts.push(`${mins} мин`)
  return parts.join(' ')
}

interface FormState {
  report_notes: string
  attack_vector: string
  exploited_vulnerability: string
  tooling_used: string
  affected_assets: string
  confidentiality_impact: string
  integrity_impact: string
  availability_impact: string
  financial_reputational_damage: string
  sla_breach: string
  containment_actions: string
  eradication_actions: string
  recovery_actions: string
  lessons_worked_well: string
  lessons_to_improve: string
  new_detection_rules_needed: string
  recommendations: string
}

function formFromCase(c: Case): FormState {
  return {
    report_notes: c.report_notes ?? '',
    attack_vector: c.attack_vector ?? '',
    exploited_vulnerability: c.exploited_vulnerability ?? '',
    tooling_used: c.tooling_used ?? '',
    affected_assets: c.affected_assets ?? '',
    confidentiality_impact: c.confidentiality_impact ?? '',
    integrity_impact: c.integrity_impact ?? '',
    availability_impact: c.availability_impact ?? '',
    financial_reputational_damage: c.financial_reputational_damage ?? '',
    sla_breach: c.sla_breach ?? '',
    containment_actions: c.containment_actions ?? '',
    eradication_actions: c.eradication_actions ?? '',
    recovery_actions: c.recovery_actions ?? '',
    lessons_worked_well: c.lessons_worked_well ?? '',
    lessons_to_improve: c.lessons_to_improve ?? '',
    new_detection_rules_needed: c.new_detection_rules_needed ?? '',
    recommendations: c.recommendations ?? '',
  }
}

export const CaseReportPanel: React.FC<CaseReportPanelProps> = ({
  currentCase, iocs, canEdit, onUpdate,
}) => {
  const toast = useToastStore()
  const [alertCount, setAlertCount] = useState<number | null>(null)
  const [caseAlerts, setCaseAlerts] = useState<Alert[]>([])
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<FormState>(() => formFromCase(currentCase))
  const [isSaving, setIsSaving] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getAlerts({ case_id: currentCase.id })
      .then((alerts) => {
        setAlertCount(alerts.length)
        setCaseAlerts(alerts)
      })
      .catch(() => {
        setAlertCount(null)
        setCaseAlerts([])
      })

    getBranches(currentCase.id)
      .then(async (branches) => {
        const eventLists = await Promise.all(
          branches.map((b) => getEvents(b.id).catch(() => [] as Event[])),
        )
        const merged = eventLists.flat().filter((e) => !e.is_deleted)
        merged.sort((a, b) => new Date(a.event_ts).getTime() - new Date(b.event_ts).getTime())
        setAllEvents(merged)
      })
      .catch(() => setAllEvents([]))
  }, [currentCase.id])

  const artifactsList = useMemo(() => {
    const seen = new Set<string>()
    const list: Artifact[] = []
    for (const e of allEvents) {
      for (const a of e.artifacts ?? []) {
        if (seen.has(a.id)) continue
        seen.add(a.id)
        list.push(a)
      }
    }
    return list
  }, [allEvents])

  const affectedAssets = useMemo(() => {
    const ips = new Set<string>()
    const accounts = new Set<string>()
    for (const a of caseAlerts) {
      ;(a.parsed_internal_ips ?? []).forEach((ip) => ips.add(ip))
      ;(a.parsed_accounts ?? []).forEach((acc) => accounts.add(acc))
    }
    return { ips: Array.from(ips), accounts: Array.from(accounts) }
  }, [caseAlerts])

  const mttd = durationLabel(currentCase.incident_started_at, currentCase.incident_discovered_at)
  const timeToContain = durationLabel(currentCase.incident_discovered_at, currentCase.incident_contained_at)
  const mttr = durationLabel(currentCase.incident_discovered_at, currentCase.incident_closed_at)

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleStartEdit = () => {
    setForm(formFromCase(currentCase))
    setIsEditing(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updated = await updateCase(currentCase.id, {
        report_notes: form.report_notes.trim(),
        attack_vector: form.attack_vector.trim(),
        exploited_vulnerability: form.exploited_vulnerability.trim(),
        tooling_used: form.tooling_used.trim(),
        affected_assets: form.affected_assets.trim(),
        confidentiality_impact: form.confidentiality_impact.trim(),
        integrity_impact: form.integrity_impact.trim(),
        availability_impact: form.availability_impact.trim(),
        financial_reputational_damage: form.financial_reputational_damage.trim(),
        sla_breach: form.sla_breach.trim(),
        containment_actions: form.containment_actions.trim(),
        eradication_actions: form.eradication_actions.trim(),
        recovery_actions: form.recovery_actions.trim(),
        lessons_worked_well: form.lessons_worked_well.trim(),
        lessons_to_improve: form.lessons_to_improve.trim(),
        new_detection_rules_needed: form.new_detection_rules_needed.trim(),
        recommendations: form.recommendations.trim(),
      })
      onUpdate(updated)
      toast.success('Отчёт сохранён')
      setIsEditing(false)
    } catch {
      toast.error('Ошибка сохранения отчёта')
    } finally {
      setIsSaving(false)
    }
  }

  const handleExportPdf = async () => {
    if (!reportRef.current) return
    setIsExportingPdf(true)

    const clone = reportRef.current.cloneNode(true) as HTMLElement
    const wrapper = document.createElement('div')
    wrapper.style.position = 'fixed'
    wrapper.style.top = '0'
    wrapper.style.left = '-10000px'
    wrapper.style.width = '1160px'
    wrapper.style.padding = '32px'
    wrapper.style.boxSizing = 'border-box'
    wrapper.style.background = '#ffffff'
    wrapper.style.fontFamily = getComputedStyle(document.body).fontFamily
    // Print-safe palette — fixed regardless of the currently active theme
    // (light/dark/sauron), since printed reports must stay light/readable.
    wrapper.style.setProperty('--bg-secondary', '#ffffff')
    wrapper.style.setProperty('--bg-tertiary', '#eef0f2')
    wrapper.style.setProperty('--border', '#d0d7de')
    wrapper.style.setProperty('--text-primary', '#1a1a1a')
    wrapper.style.setProperty('--text-secondary', '#55606b')

    const header = document.createElement('div')
    header.style.marginBottom = '20px'
    header.style.borderBottom = '2px solid #1a1a1a'
    header.style.paddingBottom = '12px'
    const titleEl = document.createElement('div')
    titleEl.textContent = `Отчёт по инциденту: ${currentCase.title || currentCase.id}`
    titleEl.style.fontSize = '20px'
    titleEl.style.fontWeight = '700'
    titleEl.style.color = '#1a1a1a'
    const dateEl = document.createElement('div')
    dateEl.textContent = `Сформировано: ${fmtDateTime(new Date().toISOString())}`
    dateEl.style.fontSize = '12px'
    dateEl.style.color = '#55606b'
    dateEl.style.marginTop = '4px'
    header.appendChild(titleEl)
    header.appendChild(dateEl)

    wrapper.appendChild(header)
    wrapper.appendChild(clone)
    document.body.appendChild(wrapper)

    try {
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      })

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const imgWidth = pageWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      let remainingHeight = imgHeight
      let position = 0
      const imgData = canvas.toDataURL('image/png')

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      remainingHeight -= pageHeight

      while (remainingHeight > 0) {
        position -= pageHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        remainingHeight -= pageHeight
      }

      pdf.save(`Отчёт_${currentCase.title || currentCase.id}.pdf`)
    } catch {
      toast.error('Ошибка экспорта в PDF')
    } finally {
      document.body.removeChild(wrapper)
      setIsExportingPdf(false)
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportPdf}
            isLoading={isExportingPdf}
            disabled={isEditing}
            title={isEditing ? 'Сохраните изменения перед экспортом' : undefined}
          >
            Выгрузить в PDF
          </Button>
          {canEdit &&
            (isEditing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                  Отмена
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave} isLoading={isSaving}>
                  Сохранить
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={handleStartEdit}>
                Редактировать
              </Button>
            ))}
        </div>

        <div
          ref={reportRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* ─── Колонка 1 ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Сводка — только для чтения */}
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Сводка</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                <SummaryField label="Статус" value={CASE_STATUS_LABELS[currentCase.status]} />
                <SummaryField label="Критичность" value={CASE_SEVERITY_LABELS[currentCase.severity]} />
                <SummaryField label="Гриф конфиденциальности" value={currentCase.confidentiality_label} />
                <SummaryField label="Алертов в инциденте" value={alertCount !== null ? String(alertCount) : '—'} />
                <SummaryField label="Индикаторов (IOC)" value={String(iocs.length)} />
              </div>

              {currentCase.participants && currentCase.participants.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={labelStyle}>Участники</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {currentCase.participants.map((p) => (
                      <span key={p.user_id} style={tagStyle}>
                        {p.user?.full_name || p.user?.username || p.user_id.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Оценка ущерба */}
            <ReportSection title="Оценка ущерба">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                <TextBlock
                  id="report-confidentiality-impact"
                  label="Влияние на конфиденциальность"
                  isEditing={isEditing}
                  value={form.confidentiality_impact}
                  onChange={(v) => setField('confidentiality_impact', v)}
                  displayValue={currentCase.confidentiality_impact}
                  rows={2}
                />
                <TextBlock
                  id="report-integrity-impact"
                  label="Влияние на целостность"
                  isEditing={isEditing}
                  value={form.integrity_impact}
                  onChange={(v) => setField('integrity_impact', v)}
                  displayValue={currentCase.integrity_impact}
                  rows={2}
                />
                <TextBlock
                  id="report-availability-impact"
                  label="Влияние на доступность"
                  isEditing={isEditing}
                  value={form.availability_impact}
                  onChange={(v) => setField('availability_impact', v)}
                  displayValue={currentCase.availability_impact}
                  rows={2}
                />
              </div>
              <TextBlock
                id="report-financial-reputational-damage"
                label="Финансовый/репутационный ущерб"
                isEditing={isEditing}
                value={form.financial_reputational_damage}
                onChange={(v) => setField('financial_reputational_damage', v)}
                displayValue={currentCase.financial_reputational_damage}
              />
              <TextBlock
                id="report-sla-breach"
                label="Нарушение SLA"
                isEditing={isEditing}
                value={form.sla_breach}
                onChange={(v) => setField('sla_breach', v)}
                displayValue={currentCase.sla_breach}
                rows={2}
              />
            </ReportSection>

            {/* Выводы и рекомендации */}
            <ReportSection title="Выводы и рекомендации">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <TextBlock
                  id="report-lessons-worked-well"
                  label="Что сработало хорошо"
                  isEditing={isEditing}
                  value={form.lessons_worked_well}
                  onChange={(v) => setField('lessons_worked_well', v)}
                  displayValue={currentCase.lessons_worked_well}
                />
                <TextBlock
                  id="report-lessons-to-improve"
                  label="Что можно улучшить"
                  isEditing={isEditing}
                  value={form.lessons_to_improve}
                  onChange={(v) => setField('lessons_to_improve', v)}
                  displayValue={currentCase.lessons_to_improve}
                />
              </div>
              <TextBlock
                id="report-new-detection-rules"
                label="Необходимые новые правила детектирования"
                isEditing={isEditing}
                value={form.new_detection_rules_needed}
                onChange={(v) => setField('new_detection_rules_needed', v)}
                displayValue={currentCase.new_detection_rules_needed}
              />
              <TextBlock
                id="report-recommendations"
                label="Рекомендации"
                isEditing={isEditing}
                value={form.recommendations}
                onChange={(v) => setField('recommendations', v)}
                displayValue={currentCase.recommendations}
                rows={4}
              />
            </ReportSection>

            {/* Хронология событий — собрана автоматически из фактов инцидента */}
            <ReportSection title="Хронология событий (авто)">
              {allEvents.length === 0 ? (
                <Value>Событий в инциденте пока нет</Value>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                        <th style={thStyle}>Дата/время</th>
                        <th style={thStyle}>Событие</th>
                        <th style={thStyle}>Источник</th>
                        <th style={thStyle}>MITRE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allEvents.map((e) => (
                        <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={tdStyle}>{fmtDateTime(e.event_ts)}</td>
                          <td style={tdStyle}>{e.title}</td>
                          <td style={tdStyle}>{e.source_description || '—'}</td>
                          <td style={tdStyle}>{e.mitre_technique || e.mitre_tactic || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportSection>

          </div>

          {/* ─── Колонка 2 ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Свободный текст отчёта */}
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Описание инцидента</h3>
              {isEditing ? (
                <textarea
                  value={form.report_notes}
                  onChange={(e) => setField('report_notes', e.target.value)}
                  rows={12}
                  style={{ resize: 'vertical', width: '100%' }}
                  placeholder="Свободный текст отчёта об инциденте..."
                />
              ) : (
                <div
                  style={{
                    fontSize: 14,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    color: currentCase.report_notes ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {currentCase.report_notes || 'Отчёт ещё не написан.'}
                </div>
              )}
            </div>

            {/* Затронутые активы */}
            <ReportSection title="Затронутые активы">
              <TextBlock
                id="report-affected-assets"
                label="Активы, учётные записи, данные"
                isEditing={isEditing}
                value={form.affected_assets}
                onChange={(v) => setField('affected_assets', v)}
                displayValue={currentCase.affected_assets}
                rows={4}
              />
              <div>
                <div style={labelStyle}>Обнаружено автоматически (по алертам инцидента)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8, fontSize: 13 }}>
                  <div>
                    <div style={{ ...labelStyle, fontSize: 10 }}>Внутренние IP-адреса</div>
                    {affectedAssets.ips.length === 0 ? (
                      <Value>—</Value>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {affectedAssets.ips.map((ip) => (
                          <span key={ip} style={tagStyle}>{ip}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ ...labelStyle, fontSize: 10 }}>Учётные записи</div>
                    {affectedAssets.accounts.length === 0 ? (
                      <Value>—</Value>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {affectedAssets.accounts.map((acc) => (
                          <span key={acc} style={tagStyle}>{acc}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ReportSection>

            {/* Реагирование и меры */}
            <ReportSection title="Реагирование и меры">
              <TextBlock
                id="report-containment-actions"
                label="Меры сдерживания"
                isEditing={isEditing}
                value={form.containment_actions}
                onChange={(v) => setField('containment_actions', v)}
                displayValue={currentCase.containment_actions}
              />
              <TextBlock
                id="report-eradication-actions"
                label="Меры устранения"
                isEditing={isEditing}
                value={form.eradication_actions}
                onChange={(v) => setField('eradication_actions', v)}
                displayValue={currentCase.eradication_actions}
              />
              <TextBlock
                id="report-recovery-actions"
                label="Меры восстановления"
                isEditing={isEditing}
                value={form.recovery_actions}
                onChange={(v) => setField('recovery_actions', v)}
                displayValue={currentCase.recovery_actions}
              />
            </ReportSection>

            {/* Приложения и доказательства — файлы, прикреплённые к событиям инцидента */}
            <ReportSection title="Приложения и доказательства (авто)">
              {artifactsList.length === 0 ? (
                <Value>Файлы-доказательства не прикреплены</Value>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                        <th style={thStyle}>Файл</th>
                        <th style={thStyle}>SHA256</th>
                        <th style={thStyle}>Загружен</th>
                      </tr>
                    </thead>
                    <tbody>
                      {artifactsList.map((a) => (
                        <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={tdStyle}>{a.file_name}</td>
                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{a.sha256}</td>
                          <td style={tdStyle}>{fmtDateTime(a.uploaded_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportSection>

            {/* Ключевые метрики — вычислены автоматически из хронологии инцидента */}
            <ReportSection title="Ключевые метрики (авто)">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
                <SummaryField label="MTTD (время до обнаружения)" value={mttd} />
                <SummaryField label="Время до локализации" value={timeToContain} />
                <SummaryField label="MTTR (время до закрытия)" value={mttr} />
              </div>
            </ReportSection>

            {/* Анализ атаки */}
            <ReportSection title="Анализ атаки">
              <TextBlock
                id="report-attack-vector"
                label="Вектор первичного доступа"
                isEditing={isEditing}
                value={form.attack_vector}
                onChange={(v) => setField('attack_vector', v)}
                displayValue={currentCase.attack_vector}
              />
              <TextBlock
                id="report-exploited-vulnerability"
                label="Эксплуатированная уязвимость"
                isEditing={isEditing}
                value={form.exploited_vulnerability}
                onChange={(v) => setField('exploited_vulnerability', v)}
                displayValue={currentCase.exploited_vulnerability}
              />
              <TextBlock
                id="report-tooling-used"
                label="Использованный инструментарий"
                isEditing={isEditing}
                value={form.tooling_used}
                onChange={(v) => setField('tooling_used', v)}
                displayValue={currentCase.tooling_used}
              />
            </ReportSection>
          </div>
        </div>

        {/* Индикаторы компрометации — из существующей модели IOC инцидента */}
        <div style={{ marginTop: 16 }}>
          <ReportSection title="Индикаторы компрометации (авто)">
            {iocs.length === 0 ? (
              <Value>IOC в инциденте не зарегистрированы</Value>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={thStyle}>Тип</th>
                      <th style={thStyle}>Значение</th>
                      <th style={thStyle}>Контекст</th>
                    </tr>
                  </thead>
                  <tbody>
                    {iocs.map((ioc) => (
                      <tr key={ioc.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={tdStyle}>{IOC_TYPE_LABELS[ioc.ioc_type] || ioc.ioc_type}</td>
                        <td style={tdStyle}>{ioc.value}</td>
                        <td style={tdStyle}>{ioc.context || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ReportSection>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  color: 'var(--text-primary)',
  verticalAlign: 'top',
}

const tagStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '2px 10px',
  borderRadius: 12,
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
}

const SummaryField: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div>
    <div style={labelStyle}>{label}</div>
    <div style={{ color: value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{value || '—'}</div>
  </div>
)

const Value: React.FC<{ children?: string | null; multiline?: boolean }> = ({ children, multiline }) => (
  <div
    style={{
      fontSize: 14,
      color: children ? 'var(--text-primary)' : 'var(--text-secondary)',
      whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
      lineHeight: 1.5,
    }}
  >
    {children || '—'}
  </div>
)

const ReportSection: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div
    style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}
  >
    <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</h3>
    {children}
  </div>
)

const TextBlock: React.FC<{
  id: string
  label: string
  isEditing: boolean
  value: string
  onChange: (v: string) => void
  displayValue?: string
  rows?: number
  placeholder?: string
}> = ({ id, label, isEditing, value, onChange, displayValue, rows = 3, placeholder }) => (
  <div>
    <label htmlFor={id}>{label}</label>
    {isEditing ? (
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        style={{ resize: 'vertical', width: '100%' }}
        placeholder={placeholder}
      />
    ) : (
      <Value multiline>{displayValue}</Value>
    )}
  </div>
)
