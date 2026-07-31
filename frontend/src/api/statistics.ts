import apiClient from './client'
import type { CorrelationGraph, StatisticsOverview, StatisticsPeriodKey } from '../types'

export interface StatisticsParams {
  period: StatisticsPeriodKey
  start?: string
  end?: string
}

export async function getStatisticsOverview(params: StatisticsParams): Promise<StatisticsOverview> {
  const response = await apiClient.get<StatisticsOverview>('/statistics/overview', { params })
  return response.data
}

export interface CorrelationGraphParams extends StatisticsParams {
  q?: string
}

export async function getCorrelationGraph(params: CorrelationGraphParams): Promise<CorrelationGraph> {
  const response = await apiClient.get<CorrelationGraph>('/statistics/correlation-graph', { params })
  return response.data
}
