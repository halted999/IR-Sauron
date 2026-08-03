export type UserRole =
  | 'admin'
  | 'ir_lead'
  | 'investigator'
  | 'observer'
  | 'external_contractor'
  | 'demo'

export type CaseStatus = 'open' | 'in_progress' | 'confirmed' | 'rejected'

export type CaseSeverity = 'critical' | 'high' | 'medium' | 'low'

export type BranchStatus = 'hypothesis' | 'confirmed' | 'rejected'

export type AlertStatus = 'new' | 'triaged' | 'escalated' | 'dismissed' | 'archived'

export type EventType =
  | 'attacker_action'
  | 'detection'
  | 'ir_action'
  | 'inference'
  | 'legal_event'

export type ActionType =
  | 'network_connection'
  | 'logon_event'
  | 'file_operation'
  | 'command_execution'

export type ConfidenceLevel = 'confirmed' | 'corroborated' | 'hypothesis'

export type CommentVisibility = 'internal' | 'report'

export interface User {
  id: string
  username: string
  email: string
  full_name?: string
  role: UserRole
  is_active: boolean
  created_at?: string
}

export interface Alert {
  id: string
  title: string
  description?: string
  severity: CaseSeverity
  source?: string
  status: AlertStatus
  case_id?: string
  source_index?: string
  tags: string[]
  is_deleted: boolean
  deleted_at?: string
  delete_reason?: string
  assigned_to?: string
  created_by?: string
  created_at: string
  updated_at: string
  // Parsed on the backend — ECS fields for Elastic-sourced alerts, best-effort
  // regex over title/description otherwise. description itself is untouched.
  // See app.services.ecs_parsing / app.services.alert_stats_parsing.
  threat_type: string
  // ECS doc flattened into field/value rows for Elastic-sourced alerts (from
  // the untruncated raw event); null for plain-text sources (e.g. TheHive).
  description_table?: { key: string; value: string }[] | null
  parsed_urls: string[]
  parsed_external_ips: string[]
  parsed_internal_ips: string[]
  parsed_accounts: string[]
  parsed_files: string[]
}

export interface SimilarAlert {
  alert_id: string
  title: string
  status: AlertStatus
  created_at: string
  matched_internal_ips: string[]
  matched_accounts: string[]
}

export interface SimilarAlertsResponse {
  total: number
  items: SimilarAlert[]
}

export interface CreateAlertData {
  title: string
  description?: string
  severity: CaseSeverity
  source?: string
}

export interface EscalateAlertData {
  classification?: string
  confidentiality_label?: string
  external_ticket_id?: string
}

export interface BulkEscalateAlertData {
  alert_ids: string[]
  title?: string
  classification?: string
  confidentiality_label?: string
  external_ticket_id?: string
}

export interface Case {
  id: string
  title: string
  status: CaseStatus
  severity: CaseSeverity
  ir_lead_id?: string
  ir_lead?: User
  classification?: string
  incident_discovered_at?: string
  incident_started_at?: string
  incident_contained_at?: string
  incident_closed_at?: string
  confidentiality_label: string
  external_ticket_id?: string
  root_cause?: string
  impact_summary?: string
  attribution?: string
  report_notes?: string
  incident_number?: string
  detection_source?: string
  trigger_rule?: string
  severity_justification?: string
  executive_summary?: string
  attack_vector?: string
  exploited_vulnerability?: string
  tooling_used?: string
  affected_assets?: string
  confidentiality_impact?: string
  integrity_impact?: string
  availability_impact?: string
  financial_reputational_damage?: string
  sla_breach?: string
  containment_actions?: string
  eradication_actions?: string
  recovery_actions?: string
  lessons_worked_well?: string
  lessons_to_improve?: string
  new_detection_rules_needed?: string
  recommendations?: string
  approval_notes?: string
  is_archived?: boolean
  archived_at?: string
  parent_case_id?: string
  attach_reason?: string
  parent_case?: CaseSummary
  attached_cases?: CaseSummary[]
  created_at: string
  updated_at: string
  participants?: CaseParticipant[]
}

export interface CaseSummary {
  id: string
  title: string
  status: CaseStatus
  severity: CaseSeverity
  ir_lead_id?: string
  classification?: string
  incident_discovered_at?: string
  attach_reason?: string
  created_at: string
  updated_at: string
}

export interface CaseParticipant {
  case_id: string
  user_id: string
  role: UserRole
  user?: User
}

export interface Branch {
  id: string
  case_id: string
  parent_branch_id?: string
  branch_point_event_id?: string
  name: string
  description?: string
  status: BranchStatus
  status_reason?: string
  owner_id?: string
  is_main: boolean
  graph_layout?: Record<string, { x: number; y: number }> | null
  created_at: string
  children?: Branch[]
}

export interface EventLink {
  id: string
  source_event_id: string
  target_event_id: string
  link_type: string
  description?: string
  action_type?: ActionType
  event_ts?: string
  mitre_technique?: string
  created_at: string
}

export interface Event {
  id: string
  branch_id: string
  event_ts: string
  event_ts_tz_offset?: number
  event_type: EventType
  title: string
  description?: string
  source_description?: string
  confidence_level: ConfidenceLevel
  mitre_tactic?: string
  mitre_technique?: string
  mitre_subtechnique?: string
  action_type?: ActionType | null
  owner_id?: string
  is_deleted: boolean
  sort_order?: number
  version: number
  created_by: string
  created_at: string
  artifacts?: Artifact[]
  iocs?: IOC[]
  linked_events?: EventLink[]
}

export interface Artifact {
  id: string
  event_id: string
  file_name: string
  file_type?: string
  file_size?: number
  sha256: string
  upload_source?: string
  is_worm: boolean
  uploaded_at: string
}

export interface IOC {
  id: string
  case_id: string
  ioc_type: string
  value: string
  context?: string
  created_at: string
}

export interface Comment {
  id: string
  event_id?: string
  branch_id?: string
  parent_comment_id?: string
  author_id: string
  body: string
  visibility: CommentVisibility
  is_resolved: boolean
  is_deleted: boolean
  created_at: string
  updated_at: string
  author?: User
  replies?: Comment[]
}

export interface Token {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface CreateEventData {
  event_ts: string
  event_ts_tz_offset?: number
  event_type: EventType
  title: string
  description?: string
  source_description?: string
  confidence_level: ConfidenceLevel
  mitre_tactic?: string | null
  mitre_technique?: string | null
  mitre_subtechnique?: string | null
  action_type?: ActionType | null
  branch_id?: string
}

export interface CreateEventLinkData {
  target_event_id: string
  link_type: string
  description?: string
  action_type?: ActionType
  event_ts?: string
  mitre_technique?: string
}

export interface CreateCaseData {
  title: string
  classification?: string
  severity: CaseSeverity
  incident_discovered_at?: string
  confidentiality_label: string
  external_ticket_id?: string
}

export interface CreateIOCData {
  ioc_type: string
  value: string
  context?: string
}

export interface CreateCommentData {
  body: string
  visibility: CommentVisibility
  parent_comment_id?: string
}

export interface WSMessage {
  type: string
  payload: unknown
}

export type IOCType =
  | 'hash_md5'
  | 'hash_sha256'
  | 'ip'
  | 'domain'
  | 'url'
  | 'email'
  | 'filename'

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  attacker_action: 'Действие атакующего',
  detection: 'Обнаружение',
  ir_action: 'Действие команды IR',
  inference: 'Вывод/гипотеза',
  legal_event: 'Юридически значимое событие',
}

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  network_connection: 'Сетевое соединение',
  logon_event: 'Событие логона',
  file_operation: 'Операция с файлами',
  command_execution: 'Выполнение команды',
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  confirmed: 'Подтверждено',
  corroborated: 'Подкреплено',
  hypothesis: 'Гипотеза',
}

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  new: 'Новый',
  triaged: 'В работе',
  escalated: 'Эскалирован',
  dismissed: 'Отклонён',
  archived: 'В архиве',
}

export const ALERT_STATUS_COLORS: Record<AlertStatus, string> = {
  new: '#58a6ff',
  triaged: '#d29922',
  escalated: '#3fb950',
  dismissed: '#8b949e',
  archived: '#6e7681',
}

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: 'Открыто',
  in_progress: 'В работе',
  confirmed: 'Подтверждён',
  rejected: 'Отклонён',
}

const SAURON_STATUS_LABELS: Partial<Record<CaseStatus, string>> = {
  open: 'Открытый глаз Саурона',
  in_progress: 'Прищуренный глаз Саурона',
  confirmed: 'Пылающий глаз Саурона',
  rejected: 'Закрытый глаз Саурона',
}

export function getCaseStatusLabel(status: CaseStatus, theme: string): string {
  if (theme === 'sauron' && SAURON_STATUS_LABELS[status]) {
    return SAURON_STATUS_LABELS[status]!
  }
  return CASE_STATUS_LABELS[status]
}

// Shared by the Sauron eye icon and the Elves leaf icon — both reuse the
// same 4-way variant mapping from case status, just rendered differently.
export function getCaseStatusIconVariant(
  status: CaseStatus,
): 'open' | 'closed' | 'review' | 'active' | null {
  if (status === 'open') return 'open'
  if (status === 'in_progress') return 'review'
  if (status === 'confirmed') return 'active'
  if (status === 'rejected') return 'closed'
  return null
}

export const CASE_SEVERITY_LABELS: Record<CaseSeverity, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
}

export const IOC_TYPE_LABELS: Record<string, string> = {
  hash_md5: 'MD5',
  hash_sha256: 'SHA256',
  ip: 'IP-адрес',
  domain: 'Домен',
  url: 'URL',
  email: 'Email',
  filename: 'Имя файла',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Администратор',
  ir_lead: 'Руководитель IR',
  investigator: 'Аналитик',
  observer: 'Наблюдатель',
  external_contractor: 'Внешний подрядчик',
  demo: 'Демо-пользователь',
}

// ─── Statistics ─────────────────────────────────────────────────────────────

export type StatisticsPeriodKey =
  | 'day'
  | 'current_week'
  | '7d'
  | 'current_month'
  | '30d'
  | 'custom'

export const STATISTICS_PERIOD_LABELS: Record<StatisticsPeriodKey, string> = {
  day: '24 часа',
  current_week: 'Текущая неделя',
  '7d': '7 дней',
  current_month: 'Текущий месяц',
  '30d': '30 дней',
  custom: 'Период',
}

export interface StatisticsPeriod {
  start: string
  end: string
}

export interface StatusCount {
  status: AlertStatus
  count: number
}

export interface ThreatTypeCount {
  threat_type: string
  count: number
  top_ips: ValueCount[]
  top_accounts: ValueCount[]
}

export interface ValueCount {
  value: string
  count: number
}

export type TimelineGranularity = 'hour' | 'day' | 'week' | 'month'

export interface TimelinePoint {
  bucket: string
  count: number
}

export interface StatisticsOverview {
  period: StatisticsPeriod
  total_alerts: number
  timeline: TimelinePoint[]
  timeline_granularity: TimelineGranularity
  by_status: StatusCount[]
  by_threat_type: ThreatTypeCount[]
  top_urls: ValueCount[]
  top_external_ips: ValueCount[]
  top_internal_ips: ValueCount[]
  top_accounts: ValueCount[]
  top_files: ValueCount[]
}

export type GraphNodeKind = 'alert' | 'ip' | 'account' | 'file' | 'ioc'

export interface CorrelationGraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  status?: AlertStatus
  degree: number
  case_id?: string | null
}

export interface CorrelationGraphEdge {
  source: string
  target: string
  kind: 'ip' | 'account' | 'file' | 'ioc'
}

export interface CorrelationGraph {
  period: StatisticsPeriod
  nodes: CorrelationGraphNode[]
  edges: CorrelationGraphEdge[]
  truncated: boolean
}
