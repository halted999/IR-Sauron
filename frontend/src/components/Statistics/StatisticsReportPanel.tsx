import React, { useMemo, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { StatisticsOverview, StatisticsPeriodKey, ThreatTypeCount, TimelineGranularity } from '../../types'
import { ALERT_STATUS_LABELS, STATISTICS_PERIOD_LABELS } from '../../types'
import { Button } from '../ui/Button'
import { useToastStore } from '../../store/toast'

interface StatisticsReportPanelProps {
  data: StatisticsOverview
  period: StatisticsPeriodKey
  search: string
}

function fmtDateTime(iso: string): string {
  try {
    return format(new Date(iso), 'dd.MM.yyyy HH:mm', { locale: ru })
  } catch {
    return iso
  }
}

const TIMELINE_TICK_FORMAT: Record<TimelineGranularity, string> = {
  hour: 'dd.MM HH:mm',
  day: 'dd.MM.yyyy',
  week: 'dd.MM.yyyy',
  month: 'LLLL yyyy',
}

function fmtBucket(iso: string, granularity: TimelineGranularity): string {
  try {
    return format(new Date(iso), TIMELINE_TICK_FORMAT[granularity], { locale: ru })
  } catch {
    return iso
  }
}

function filterByValue<T extends { value: string }>(rows: T[], search: string): T[] {
  const term = search.trim().toLowerCase()
  return term ? rows.filter((r) => r.value.toLowerCase().includes(term)) : rows
}

export const StatisticsReportPanel: React.FC<StatisticsReportPanelProps> = ({ data, period, search }) => {
  const toast = useToastStore()
  const reportRef = useRef<HTMLDivElement>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  const filteredUrls = useMemo(() => filterByValue(data.top_urls, search), [data.top_urls, search])
  const filteredExtIps = useMemo(() => filterByValue(data.top_external_ips, search), [data.top_external_ips, search])
  const filteredIntIps = useMemo(() => filterByValue(data.top_internal_ips, search), [data.top_internal_ips, search])
  const filteredAccounts = useMemo(() => filterByValue(data.top_accounts, search), [data.top_accounts, search])
  const filteredFiles = useMemo(() => filterByValue(data.top_files, search), [data.top_files, search])

  const topStatus = data.by_status[0]
  const topThreat = data.by_threat_type[0]
  const nonEmptyBuckets = data.timeline.filter((p) => p.count > 0)
  const peakBucket = nonEmptyBuckets.length > 0
    ? nonEmptyBuckets.reduce((max, p) => (p.count > max.count ? p : max), nonEmptyBuckets[0])
    : null

  const summaryText = useMemo(() => {
    const sentences: string[] = []
    sentences.push(
      `За период с ${fmtDateTime(data.period.start)} по ${fmtDateTime(data.period.end)} `
      + `зафиксировано ${data.total_alerts} алертов.`,
    )
    if (topStatus) {
      const pct = data.total_alerts > 0 ? Math.round((topStatus.count / data.total_alerts) * 100) : 0
      sentences.push(
        `Наибольшая доля приходится на статус «${ALERT_STATUS_LABELS[topStatus.status]}» `
        + `(${topStatus.count} из ${data.total_alerts}, ${pct}%).`,
      )
    }
    if (topThreat) {
      sentences.push(`Наиболее распространённый тип угрозы — «${topThreat.threat_type}» (${topThreat.count} алертов).`)
    }
    if (peakBucket) {
      sentences.push(
        `Пик активности приходится на ${fmtBucket(peakBucket.bucket, data.timeline_granularity)} `
        + `(${peakBucket.count} алертов).`,
      )
    }
    if (search.trim()) {
      sentences.push(`Показатели по URL/IP/учётным записям/файлам отфильтрованы по значению «${search.trim()}».`)
    }
    return sentences.join(' ')
  }, [data, topStatus, topThreat, peakBucket, search])

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
    // Print-safe palette — fixed regardless of the currently active theme.
    wrapper.style.setProperty('--bg-secondary', '#ffffff')
    wrapper.style.setProperty('--bg-tertiary', '#eef0f2')
    wrapper.style.setProperty('--border', '#d0d7de')
    wrapper.style.setProperty('--text-primary', '#1a1a1a')
    wrapper.style.setProperty('--text-secondary', '#55606b')
    wrapper.style.setProperty('--accent', '#1f6feb')

    const header = document.createElement('div')
    header.style.marginBottom = '20px'
    header.style.borderBottom = '2px solid #1a1a1a'
    header.style.paddingBottom = '12px'
    const titleEl = document.createElement('div')
    titleEl.textContent = 'Отчёт по алертам для аналитика SOC'
    titleEl.style.fontSize = '20px'
    titleEl.style.fontWeight = '700'
    titleEl.style.color = '#1a1a1a'
    const dateEl = document.createElement('div')
    dateEl.textContent = `Период: ${STATISTICS_PERIOD_LABELS[period]} · Сформировано: ${fmtDateTime(new Date().toISOString())}`
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

      pdf.save(`Отчёт_SOC_${STATISTICS_PERIOD_LABELS[period]}.pdf`)
    } catch {
      toast.error('Ошибка экспорта в PDF')
    } finally {
      document.body.removeChild(wrapper)
      setIsExportingPdf(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button variant="secondary" size="sm" onClick={handleExportPdf} isLoading={isExportingPdf}>
          Выгрузить в PDF
        </Button>
      </div>

      <div ref={reportRef} style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '75%', margin: '0 auto' }}>
        <ReportCard title="Сводка">
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>{summaryText}</p>
        </ReportCard>

        <ReportCard title="По типам угроз">
          <ThreatTypeDetailTable
            rows={data.by_threat_type}
            totalAlerts={data.total_alerts}
          />
        </ReportCard>

        <ReportCard title="Топ URL">
          <ReportTable headLabel="URL" rows={filteredUrls.map((v) => ({ label: v.value, count: v.count }))} />
        </ReportCard>
        <ReportCard title="Внешние IP-адреса">
          <ReportTable headLabel="IP-адрес" rows={filteredExtIps.map((v) => ({ label: v.value, count: v.count }))} />
        </ReportCard>
        <ReportCard title="Внутренние IP-адреса">
          <ReportTable headLabel="IP-адрес" rows={filteredIntIps.map((v) => ({ label: v.value, count: v.count }))} />
        </ReportCard>
        <ReportCard title="Учётные записи">
          <ReportTable headLabel="Учётная запись" rows={filteredAccounts.map((v) => ({ label: v.value, count: v.count }))} />
        </ReportCard>
        <ReportCard title="Файлы">
          <ReportTable headLabel="Файл" rows={filteredFiles.map((v) => ({ label: v.value, count: v.count }))} />
        </ReportCard>

        <ReportCard title="Динамика по времени">
          {data.timeline.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Нет данных за выбранный период</p>
          ) : (
            <ReportTable
              headLabel="Период"
              rows={data.timeline.map((p) => ({ label: fmtBucket(p.bucket, data.timeline_granularity), count: p.count }))}
            />
          )}
        </ReportCard>
      </div>
    </div>
  )
}

const ReportCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div
    style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 16,
    }}
  >
    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{title}</h3>
    {children}
  </div>
)

const THREAT_BAR_COLOR = '#58a6ff'

const ThreatTypeDetailTable: React.FC<{ rows: ThreatTypeCount[]; totalAlerts: number }> = ({ rows, totalAlerts }) => {
  if (rows.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Нет данных</p>
  }
  const maxCount = Math.max(...rows.map((r) => r.count))
  return (
    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: 32 }}>
              №
            </th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>
              Тип угрозы
            </th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: 70 }}>
              Кол-во
            </th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: 60 }}>
              Доля
            </th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: 200 }}>
              Распределение
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const pct = totalAlerts > 0 ? Math.round((row.count / totalAlerts) * 100) : 0
            const barWidth = maxCount > 0 ? Math.round((row.count / maxCount) * 100) : 0
            return (
              <tr key={row.threat_type} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                <td style={{ padding: '6px 8px', wordBreak: 'break-all' }}>{row.threat_type}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.count}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
                  {pct}%
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ background: 'var(--bg-tertiary)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${barWidth}%`, height: '100%', background: THREAT_BAR_COLOR, borderRadius: 4 }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
        Всего типов угроз: {rows.length} · Всего алертов: {totalAlerts}
      </p>
    </div>
  )
}

const ReportTable: React.FC<{ headLabel: string; rows: { label: string; count: number }[] }> = ({ headLabel, rows }) => {
  if (rows.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Нет данных</p>
  }
  return (
    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>
              {headLabel}
            </th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: 70 }}>
              Кол-во
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.label}-${idx}`} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px', wordBreak: 'break-all' }}>{row.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
