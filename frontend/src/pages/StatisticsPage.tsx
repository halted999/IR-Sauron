import React, { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { AppLayout } from '../components/Layout/AppLayout'
import { Spinner } from '../components/ui/Spinner'
import { getStatisticsOverview } from '../api/statistics'
import { useToastStore } from '../store/toast'
import type {
  StatisticsOverview, StatisticsPeriodKey, ThreatTypeCount, TimelineGranularity, ValueCount,
} from '../types'
import { ALERT_STATUS_COLORS, ALERT_STATUS_LABELS, STATISTICS_PERIOD_LABELS } from '../types'

const PERIOD_ORDER: StatisticsPeriodKey[] = [
  'day', 'current_week', '7d', 'current_month', '30d', 'custom',
]

const STATUS_COLOR = ALERT_STATUS_COLORS

const PALETTE = ['#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff', '#00c8c8', '#ff8c00', '#8b949e']

function cardStyle(): React.CSSProperties {
  return {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
  }
}

function fmtDate(iso: string): string {
  try {
    return format(new Date(iso), 'dd.MM.yyyy HH:mm', { locale: ru })
  } catch {
    return iso
  }
}

const TIMELINE_TICK_FORMAT: Record<TimelineGranularity, string> = {
  hour: 'HH:mm',
  day: 'dd.MM',
  week: 'dd.MM',
  month: 'LLL yyyy',
}

function fmtBucket(iso: string, granularity: TimelineGranularity): string {
  try {
    return format(new Date(iso), TIMELINE_TICK_FORMAT[granularity], { locale: ru })
  } catch {
    return iso
  }
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{children}</h2>
)

const EmptyHint: React.FC = () => (
  <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 0' }}>Нет данных за выбранный период</p>
)

const CountTable: React.FC<{ headLabel: string; rows: { label: string; count: number }[] }> = ({ headLabel, rows }) => {
  if (rows.length === 0) return <EmptyHint />
  return (
    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>
              {headLabel}
            </th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: 70 }}>
              Кол-во
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px', wordBreak: 'break-all' }} title={row.label}>{row.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const CountListCard: React.FC<{ title: string; headLabel: string; rows: { label: string; count: number }[] }> = ({
  title, headLabel, rows,
}) => (
  <div style={cardStyle()}>
    <SectionTitle>{title}</SectionTitle>
    <CountTable headLabel={headLabel} rows={rows} />
  </div>
)

export const StatisticsPage: React.FC = () => {
  const toast = useToastStore()
  const [period, setPeriod] = useState<StatisticsPeriodKey>('day')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [data, setData] = useState<StatisticsOverview | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (period === 'custom' && (!customStart || !customEnd)) return

    let cancelled = false
    setIsLoading(true)
    getStatisticsOverview({
      period,
      start: period === 'custom' ? `${customStart}T00:00:00` : undefined,
      end: period === 'custom' ? `${customEnd}T23:59:59` : undefined,
    })
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) toast.error('Не удалось загрузить статистику')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customStart, customEnd])

  const statusRows = useMemo(
    () => (data?.by_status ?? []).map((s) => ({ label: ALERT_STATUS_LABELS[s.status], count: s.count, status: s.status })),
    [data],
  )
  const threatRows = useMemo(
    () => (data?.by_threat_type ?? []).map((t: ThreatTypeCount) => ({ label: t.threat_type, count: t.count })),
    [data],
  )
  const urlRows = useMemo(
    () => (data?.top_urls ?? []).map((v: ValueCount) => ({ label: v.value, count: v.count })),
    [data],
  )
  const extIpRows = useMemo(
    () => (data?.top_external_ips ?? []).map((v: ValueCount) => ({ label: v.value, count: v.count })),
    [data],
  )
  const intIpRows = useMemo(
    () => (data?.top_internal_ips ?? []).map((v: ValueCount) => ({ label: v.value, count: v.count })),
    [data],
  )
  const accountFromAlertsRows = useMemo(
    () => (data?.top_accounts ?? []).map((v: ValueCount) => ({ label: v.value, count: v.count })),
    [data],
  )

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Статистика</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Сводка по алертам за выбранный период. Данные по URL, IP-адресам и типу угрозы
            определяются эвристически на основе текста алертов.
          </p>
        </div>

        {/* Period selector */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
          {PERIOD_ORDER.map((key) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                borderRadius: 20,
                border: period === key ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: period === key ? 'rgba(88,166,255,0.15)' : 'var(--bg-secondary)',
                color: period === key ? 'var(--accent)' : 'var(--text-primary)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {STATISTICS_PERIOD_LABELS[key]}
            </button>
          ))}
          {period === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ width: 150 }} />
              <span style={{ color: 'var(--text-secondary)' }}>—</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ width: 150 }} />
            </div>
          )}
        </div>

        {!isLoading && data && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Всего алертов: <strong style={{ color: 'var(--text-primary)' }}>{data.total_alerts}</strong>
            {'  ·  '}
            Период: {fmtDate(data.period.start)} — {fmtDate(data.period.end)}
          </p>
        )}

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner />
          </div>
        )}

        {!isLoading && period === 'custom' && (!customStart || !customEnd) && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Укажите начало и конец периода</p>
        )}

        {!isLoading && data && (
          <>
            {/* Timeline */}
            <div style={{ ...cardStyle(), marginBottom: 20 }}>
              <SectionTitle>Количество алертов</SectionTitle>
              {data.timeline.every((p) => p.count === 0) ? (
                <EmptyHint />
              ) : (
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.timeline} margin={{ top: 4, right: 16, left: -20, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="bucket"
                        tickFormatter={(v: string) => fmtBucket(v, data.timeline_granularity)}
                        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(v: any) => fmtBucket(v, data.timeline_granularity)}
                        contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                        itemStyle={{ color: 'var(--text-primary)' }}
                        labelStyle={{ color: 'var(--text-primary)' }}
                      />
                      <Bar dataKey="count" fill="#58a6ff" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Status + threat type */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 16 }}>
              <div style={cardStyle()}>
                <SectionTitle>По статусам</SectionTitle>
                {statusRows.length === 0 ? (
                  <EmptyHint />
                ) : (
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusRows}
                          dataKey="count"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={(entry: any) => `${entry.label}: ${entry.count}`}
                        >
                          {statusRows.map((row) => (
                            <Cell key={row.status} fill={STATUS_COLOR[row.status]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                          itemStyle={{ color: 'var(--text-primary)' }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <CountTable headLabel="Статус" rows={statusRows} />
                </div>
              </div>

              <div style={cardStyle()}>
                <SectionTitle>По типу угрозы</SectionTitle>
                {threatRows.length === 0 ? (
                  <EmptyHint />
                ) : (
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={threatRows} margin={{ top: 4, right: 8, left: -20, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                          angle={-30}
                          textAnchor="end"
                          interval={0}
                        />
                        <YAxis allowDecimals={false} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                          itemStyle={{ color: 'var(--text-primary)' }}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {threatRows.map((row, idx) => (
                            <Cell key={row.label} fill={PALETTE[idx % PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <CountTable headLabel="Тип угрозы" rows={threatRows} />
                </div>
              </div>
            </div>

            {/* URL / IP breakdowns */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
              <CountListCard title="Топ URL" headLabel="URL" rows={urlRows} />
              <CountListCard title="Внешние IP-адреса" headLabel="IP-адрес" rows={extIpRows} />
              <CountListCard title="Внутренние IP-адреса" headLabel="IP-адрес" rows={intIpRows} />
              <CountListCard title="Учётные записи в алертах" headLabel="Учётная запись" rows={accountFromAlertsRows} />
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
