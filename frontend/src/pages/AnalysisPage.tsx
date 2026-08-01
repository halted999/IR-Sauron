import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppLayout } from '../components/Layout/AppLayout'
import { CorrelationGraph } from '../components/Graph/CorrelationGraph'
import { Spinner } from '../components/ui/Spinner'
import { getCorrelationGraph } from '../api/statistics'
import { useToastStore } from '../store/toast'
import type { CorrelationGraph as CorrelationGraphData, StatisticsPeriodKey } from '../types'

const PERIOD_ORDER: StatisticsPeriodKey[] = ['day', 'current_week', '7d', 'current_month', '30d', 'custom']
const VALID_PERIODS = new Set<string>(PERIOD_ORDER)

const PERIOD_LABELS: Record<StatisticsPeriodKey, string> = {
  day: '24 часа',
  current_week: 'Текущая неделя',
  '7d': 'Последние 7 дней',
  current_month: 'Текущий месяц',
  '30d': 'Последние 30 дней',
  custom: 'Период',
}

function initialPeriod(searchParams: URLSearchParams): StatisticsPeriodKey {
  const p = searchParams.get('period')
  return p && VALID_PERIODS.has(p) ? (p as StatisticsPeriodKey) : 'day'
}

export const AnalysisPage: React.FC = () => {
  const navigate = useNavigate()
  const toast = useToastStore()
  const [searchParams, setSearchParams] = useSearchParams()

  const [period, setPeriod] = useState<StatisticsPeriodKey>(() => initialPeriod(searchParams))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '')
  const [activeQuery, setActiveQuery] = useState<string | null>(() => searchParams.get('q')?.trim() || null)
  const [data, setData] = useState<CorrelationGraphData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!activeQuery) {
      setData(null)
      return
    }
    if (period === 'custom' && (!customStart || !customEnd)) {
      setData(null)
      return
    }
    let cancelled = false
    setIsLoading(true)
    getCorrelationGraph({
      period,
      q: activeQuery,
      start: period === 'custom' ? `${customStart}T00:00:00` : undefined,
      end: period === 'custom' ? `${customEnd}T23:59:59` : undefined,
    })
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) toast.error('Не удалось загрузить граф связей')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, activeQuery, customStart, customEnd])

  const runSearch = () => {
    const trimmed = searchInput.trim()
    if (!trimmed) return
    setActiveQuery(trimmed)
    setSearchParams({ q: trimmed, period })
  }

  const handlePeriodChange = (key: StatisticsPeriodKey) => {
    setPeriod(key)
    if (activeQuery) {
      setSearchParams({ q: activeQuery, period: key })
    }
  }

  return (
    <AppLayout>
      <div style={{ padding: '24px 32px 0', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Анализ</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Связи между алертами по общим IP-адресам, учётным записям и файловым операциям. Введите IP, файл,
            учётную запись, название алерта или инцидента, чтобы построить граф.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexShrink: 0 }}>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            placeholder="IP-адрес, файл, учётная запись, название алерта или инцидента..."
            style={{ flex: 1, maxWidth: 420 }}
          />
          <button
            onClick={runSearch}
            disabled={!searchInput.trim()}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: '1px solid var(--accent)',
              background: 'rgba(88,166,255,0.15)',
              color: 'var(--accent)',
              cursor: searchInput.trim() ? 'pointer' : 'not-allowed',
              opacity: searchInput.trim() ? 1 : 0.5,
            }}
          >
            Найти
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, flexShrink: 0 }}>
          {PERIOD_ORDER.map((key) => (
            <button
              key={key}
              onClick={() => handlePeriodChange(key)}
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
              {PERIOD_LABELS[key]}
            </button>
          ))}
          {period === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ width: 150 }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>—</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ width: 150 }}
              />
            </div>
          )}
          {data?.truncated && (
            <span style={{ fontSize: 12, color: 'var(--warning, #d29922)' }}>
              Граф слишком большой — показана только часть связей
            </span>
          )}
        </div>

        {activeQuery && period === 'custom' && (!customStart || !customEnd) && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
            Укажите начало и конец периода
          </p>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            marginBottom: 20,
            background: 'var(--bg-secondary)',
          }}
        >
          {!activeQuery ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: 'var(--text-secondary)',
                fontSize: 14,
                textAlign: 'center',
                padding: 24,
              }}
            >
              Введите IP-адрес, файл, учётную запись, название алерта или инцидента и нажмите «Найти», чтобы
              построить граф связей
            </div>
          ) : isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Spinner size={32} />
            </div>
          ) : (
            <CorrelationGraph
              nodes={data?.nodes ?? []}
              edges={data?.edges ?? []}
              onAlertClick={(alertId) => navigate(`/alerts/${alertId}`)}
            />
          )}
        </div>
      </div>
    </AppLayout>
  )
}
