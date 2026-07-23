export type UserRole =
  | 'admin'
  | 'ir_lead'
  | 'investigator'
  | 'threat_hunter'
  | 'observer'
  | 'legal'
  | 'external_contractor'

export type CaseStatus = 'open' | 'active' | 'review' | 'closed'

export type CaseSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational'

export type BranchStatus = 'hypothesis' | 'confirmed' | 'rejected'

export type AlertStatus = 'new' | 'triaged' | 'escalated' | 'dismissed'

export type VerificationStatus = 'in_progress' | 'confirmed' | 'rejected'

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
}

export interface Alert {
  id: string
  title: string
  description?: string
  severity: CaseSeverity
  source?: string
  status: AlertStatus
  case_id?: string
  is_deleted: boolean
  deleted_at?: string
  assigned_to?: string
  created_by?: string
  created_at: string
  updated_at: string
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
  verification_status: VerificationStatus
  severity: CaseSeverity
  ir_lead_id?: string
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
  created_at: string
  updated_at: string
  participants?: CaseParticipant[]
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
  created_at: string
  children?: Branch[]
}

export interface EventLink {
  id: string
  source_event_id: string
  target_event_id: string
  link_type: string
  description?: string
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
}

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: 'Открыто',
  active: 'Активно',
  review: 'На проверке',
  closed: 'Закрыто',
}

const SAURON_STATUS_LABELS: Partial<Record<CaseStatus, string>> = {
  open: 'Открытый глаз Саурона',
  active: 'Фиолетовый глаз Саурона',
  review: 'Прищуренный глаз Саурона',
  closed: 'Закрытый глаз Саурона',
}

export function getCaseStatusLabel(status: CaseStatus, theme: string): string {
  if (theme === 'sauron' && SAURON_STATUS_LABELS[status]) {
    return SAURON_STATUS_LABELS[status]!
  }
  return CASE_STATUS_LABELS[status]
}

export function getSauronEyeVariant(
  status: CaseStatus,
): 'open' | 'closed' | 'review' | 'active' | null {
  if (status === 'open') return 'open'
  if (status === 'active') return 'active'
  if (status === 'review') return 'review'
  if (status === 'closed') return 'closed'
  return null
}

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  in_progress: 'В работе',
  confirmed: 'Подтверждён',
  rejected: 'Отклонён',
}

export const CASE_SEVERITY_LABELS: Record<CaseSeverity, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
  informational: 'Информационный',
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
  investigator: 'Следователь',
  threat_hunter: 'Threat Hunter',
  observer: 'Наблюдатель',
  legal: 'Юрист',
  external_contractor: 'Внешний подрядчик',
}
