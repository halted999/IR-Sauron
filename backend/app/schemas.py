import uuid
from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field, ConfigDict, computed_field, model_validator

from app.models import (
    UserRole, CaseStatus, CaseSeverity, BranchStatus,
    EventType, ActionType, ConfidenceLevel, CommentVisibility, AlertStatus,
    EventSourceType, AlertRuleAction,
)
from app.services.alert_stats_parsing import (
    classify_threat_type, is_internal_ip, resolve_accounts, resolve_files, resolve_ips, resolve_urls,
)
from app.services.ecs_parsing import flatten_ecs_doc


# ─── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPayload(BaseModel):
    sub: str
    role: str
    exp: Optional[int] = None


# ─── User ─────────────────────────────────────────────────────────────────────

class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    email: str = Field(..., max_length=255)
    full_name: Optional[str] = Field(None, max_length=255)
    role: UserRole


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseModel):
    email: Optional[str] = Field(None, max_length=255)
    full_name: Optional[str] = Field(None, max_length=255)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=8)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str
    full_name: Optional[str]
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserShort(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    full_name: Optional[str]
    role: UserRole


# ─── Case Participant ─────────────────────────────────────────────────────────

class CaseParticipantAdd(BaseModel):
    user_id: uuid.UUID
    role_in_case: Optional[UserRole] = None


class CaseParticipantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    role_in_case: Optional[UserRole]
    added_at: datetime
    user: Optional[UserShort] = None


# ─── Case ─────────────────────────────────────────────────────────────────────

class CaseCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    severity: CaseSeverity
    incident_discovered_at: Optional[datetime] = None
    classification: Optional[str] = Field(None, max_length=255)
    confidentiality_label: Optional[str] = Field(None, max_length=100)
    external_ticket_id: Optional[str] = Field(None, max_length=255)
    ir_lead_id: Optional[uuid.UUID] = None


class CaseUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    status: Optional[CaseStatus] = None
    severity: Optional[CaseSeverity] = None
    ir_lead_id: Optional[uuid.UUID] = None
    classification: Optional[str] = Field(None, max_length=255)
    confidentiality_label: Optional[str] = Field(None, max_length=100)
    external_ticket_id: Optional[str] = Field(None, max_length=255)
    incident_discovered_at: Optional[datetime] = None
    incident_started_at: Optional[datetime] = None
    incident_contained_at: Optional[datetime] = None
    incident_closed_at: Optional[datetime] = None
    root_cause: Optional[str] = None
    impact_summary: Optional[str] = None
    attribution: Optional[str] = None
    report_notes: Optional[str] = None
    incident_number: Optional[str] = Field(None, max_length=100)
    detection_source: Optional[str] = None
    trigger_rule: Optional[str] = None
    severity_justification: Optional[str] = None
    executive_summary: Optional[str] = None
    attack_vector: Optional[str] = None
    exploited_vulnerability: Optional[str] = None
    tooling_used: Optional[str] = None
    affected_assets: Optional[str] = None
    confidentiality_impact: Optional[str] = None
    integrity_impact: Optional[str] = None
    availability_impact: Optional[str] = None
    financial_reputational_damage: Optional[str] = None
    sla_breach: Optional[str] = None
    containment_actions: Optional[str] = None
    eradication_actions: Optional[str] = None
    recovery_actions: Optional[str] = None
    lessons_worked_well: Optional[str] = None
    lessons_to_improve: Optional[str] = None
    new_detection_rules_needed: Optional[str] = None
    recommendations: Optional[str] = None
    approval_notes: Optional[str] = None


class CaseListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: CaseStatus
    severity: CaseSeverity
    ir_lead_id: Optional[uuid.UUID]
    classification: Optional[str]
    incident_discovered_at: Optional[datetime]
    attach_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: CaseStatus
    severity: CaseSeverity
    ir_lead_id: Optional[uuid.UUID]
    ir_lead: Optional[UserShort] = None
    classification: Optional[str]
    confidentiality_label: Optional[str]
    external_ticket_id: Optional[str]
    incident_discovered_at: Optional[datetime]
    incident_started_at: Optional[datetime]
    incident_contained_at: Optional[datetime]
    incident_closed_at: Optional[datetime]
    root_cause: Optional[str] = None
    impact_summary: Optional[str] = None
    attribution: Optional[str] = None
    report_notes: Optional[str] = None
    incident_number: Optional[str] = None
    detection_source: Optional[str] = None
    trigger_rule: Optional[str] = None
    severity_justification: Optional[str] = None
    executive_summary: Optional[str] = None
    attack_vector: Optional[str] = None
    exploited_vulnerability: Optional[str] = None
    tooling_used: Optional[str] = None
    affected_assets: Optional[str] = None
    confidentiality_impact: Optional[str] = None
    integrity_impact: Optional[str] = None
    availability_impact: Optional[str] = None
    financial_reputational_damage: Optional[str] = None
    sla_breach: Optional[str] = None
    containment_actions: Optional[str] = None
    eradication_actions: Optional[str] = None
    recovery_actions: Optional[str] = None
    lessons_worked_well: Optional[str] = None
    lessons_to_improve: Optional[str] = None
    new_detection_rules_needed: Optional[str] = None
    recommendations: Optional[str] = None
    approval_notes: Optional[str] = None
    is_archived: bool = False
    archived_at: Optional[datetime] = None
    parent_case_id: Optional[uuid.UUID] = None
    attach_reason: Optional[str] = None
    parent_case: Optional[CaseListResponse] = None
    attached_cases: List[CaseListResponse] = []
    created_at: datetime
    updated_at: datetime
    participants: List[CaseParticipantResponse] = []


class CaseDeleteRequest(BaseModel):
    reason: str = Field(..., min_length=1)


class CaseAttachRequest(BaseModel):
    other_case_id: uuid.UUID
    main_case_id: uuid.UUID
    reason: str = Field(..., min_length=1)


# ─── Alert ────────────────────────────────────────────────────────────────────

class AlertCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    severity: CaseSeverity
    source: Optional[str] = Field(None, max_length=255)


class AlertUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    severity: Optional[CaseSeverity] = None
    source: Optional[str] = Field(None, max_length=255)
    status: Optional[AlertStatus] = None
    tags: Optional[List[str]] = None


class AlertEscalateRequest(BaseModel):
    classification: Optional[str] = Field(None, max_length=255)
    confidentiality_label: Optional[str] = Field(None, max_length=100)
    external_ticket_id: Optional[str] = Field(None, max_length=255)


class AlertBulkEscalateRequest(BaseModel):
    alert_ids: List[uuid.UUID] = Field(..., min_length=1)
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    classification: Optional[str] = Field(None, max_length=255)
    confidentiality_label: Optional[str] = Field(None, max_length=100)
    external_ticket_id: Optional[str] = Field(None, max_length=255)


class DescriptionField(BaseModel):
    key: str
    value: str


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: Optional[str]
    severity: CaseSeverity
    source: Optional[str]
    status: AlertStatus
    case_id: Optional[uuid.UUID]
    event_source_id: Optional[uuid.UUID]
    external_id: Optional[str]
    external_url: Optional[str]
    source_index: Optional[str]
    tags: List[str]
    is_deleted: bool
    deleted_at: Optional[datetime]
    delete_reason: Optional[str] = None
    assigned_to: Optional[uuid.UUID]
    created_by: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime

    # Full raw ECS event doc (Elastic sources only) — kept for the computed
    # fields below to read from, never sent back over the API.
    raw_event: Optional[Dict[str, Any]] = Field(default=None, exclude=True)

    # ── Parsed fields ──────────────────────────────────────────────────────
    # Elastic-sourced alerts (raw_event present) are parsed via real ECS
    # field paths — see app.services.ecs_parsing. Everything else (e.g.
    # TheHive, which has no structured fields) falls back to best-effort
    # regex extraction from title/description — see
    # app.services.alert_stats_parsing. Neither path mutates title/description.

    @computed_field  # type: ignore[prop-decorator]
    @property
    def threat_type(self) -> str:
        return classify_threat_type(self.title, self.description)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def description_table(self) -> Optional[List[DescriptionField]]:
        """
        The ECS event flattened into field/value rows for Elastic-sourced
        alerts, built from the untruncated raw_event (description itself is
        only a 4000-char JSON preview and is left exactly as ingested). None
        for other sources — their description is already human-written text.
        """
        if not self.raw_event:
            return None
        return [DescriptionField(key=key, value=value) for key, value in flatten_ecs_doc(self.raw_event)]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def parsed_urls(self) -> List[str]:
        return resolve_urls(self.title, self.description, self.raw_event)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def parsed_external_ips(self) -> List[str]:
        ips = resolve_ips(self.title, self.description, self.raw_event)
        return [ip for ip in ips if not is_internal_ip(ip)]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def parsed_internal_ips(self) -> List[str]:
        ips = resolve_ips(self.title, self.description, self.raw_event)
        return [ip for ip in ips if is_internal_ip(ip)]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def parsed_accounts(self) -> List[str]:
        return resolve_accounts(self.title, self.description, self.raw_event)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def parsed_files(self) -> List[str]:
        return resolve_files(self.title, self.description, self.raw_event)


class AlertIdsRequest(BaseModel):
    alert_ids: List[uuid.UUID] = Field(..., min_length=1)


class AlertDeleteRequest(AlertIdsRequest):
    reason: str = Field(..., min_length=1)


class SimilarAlert(BaseModel):
    alert_id: uuid.UUID
    title: str
    status: AlertStatus
    created_at: datetime
    matched_internal_ips: List[str]
    matched_accounts: List[str]


class SimilarAlertsResponse(BaseModel):
    total: int
    items: List[SimilarAlert]


class AlertAssignRequest(BaseModel):
    alert_ids: List[uuid.UUID] = Field(..., min_length=1)
    user_id: Optional[uuid.UUID] = None


# ─── Alert Rules ──────────────────────────────────────────────────────────────

class AlertRuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    match_source: Optional[str] = Field(None, max_length=255)
    match_severity: Optional[CaseSeverity] = None
    match_title_contains: Optional[str] = Field(None, max_length=500)
    match_description_contains: Optional[str] = Field(None, max_length=1000)
    action: AlertRuleAction
    target_case_id: Optional[uuid.UUID] = None
    tag_value: Optional[str] = Field(None, max_length=100)
    is_enabled: bool = True

    @model_validator(mode="after")
    def _validate(self) -> "AlertRuleCreate":
        if not (
            self.match_source or self.match_severity
            or self.match_title_contains or self.match_description_contains
        ):
            raise ValueError(
                "Укажите хотя бы один признак для сопоставления "
                "(источник, критичность, заголовок или описание)"
            )
        if (
            self.action in (AlertRuleAction.suppress, AlertRuleAction.archive)
            and self.target_case_id is not None
        ):
            raise ValueError("target_case_id недопустим для этого действия")
        if self.action == AlertRuleAction.assign_tag:
            if self.target_case_id is not None:
                raise ValueError("target_case_id недопустим для действия 'assign_tag'")
            if not self.tag_value or not self.tag_value.strip():
                raise ValueError("Укажите значение тега для действия 'assign_tag'")
        elif self.tag_value is not None:
            raise ValueError("tag_value допустим только для действия 'assign_tag'")
        return self


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    match_source: Optional[str] = Field(None, max_length=255)
    match_severity: Optional[CaseSeverity] = None
    match_title_contains: Optional[str] = Field(None, max_length=500)
    match_description_contains: Optional[str] = Field(None, max_length=1000)
    action: Optional[AlertRuleAction] = None
    target_case_id: Optional[uuid.UUID] = None
    tag_value: Optional[str] = Field(None, max_length=100)
    is_enabled: Optional[bool] = None


class AlertRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    match_source: Optional[str]
    match_severity: Optional[CaseSeverity]
    match_title_contains: Optional[str]
    match_description_contains: Optional[str]
    action: AlertRuleAction
    target_case_id: Optional[uuid.UUID]
    tag_value: Optional[str]
    is_enabled: bool
    applied_count: int
    last_applied_at: Optional[datetime]
    created_by: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime


class AlertRuleFromSelectionRequest(BaseModel):
    alert_ids: List[uuid.UUID] = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=255)
    match_source: Optional[str] = Field(None, max_length=255)
    match_severity: Optional[CaseSeverity] = None
    match_title_contains: Optional[str] = Field(None, max_length=500)
    match_description_contains: Optional[str] = Field(None, max_length=1000)
    action: AlertRuleAction
    target_case_id: Optional[uuid.UUID] = None
    tag_value: Optional[str] = Field(None, max_length=100)

    @model_validator(mode="after")
    def _validate(self) -> "AlertRuleFromSelectionRequest":
        if not (
            self.match_source or self.match_severity
            or self.match_title_contains or self.match_description_contains
        ):
            raise ValueError(
                "Укажите хотя бы один признак для сопоставления "
                "(источник, критичность, заголовок или описание)"
            )
        if (
            self.action in (AlertRuleAction.suppress, AlertRuleAction.archive)
            and self.target_case_id is not None
        ):
            raise ValueError("target_case_id недопустим для этого действия")
        if self.action == AlertRuleAction.assign_tag:
            if self.target_case_id is not None:
                raise ValueError("target_case_id недопустим для действия 'assign_tag'")
            if not self.tag_value or not self.tag_value.strip():
                raise ValueError("Укажите значение тега для действия 'assign_tag'")
        elif self.tag_value is not None:
            raise ValueError("tag_value допустим только для действия 'assign_tag'")
        return self


class AlertRuleFromSelectionResponse(BaseModel):
    rule: AlertRuleResponse
    applied_count: int


class AlertRuleMatchPreviewRequest(BaseModel):
    match_source: Optional[str] = Field(None, max_length=255)
    match_severity: Optional[CaseSeverity] = None
    match_title_contains: Optional[str] = Field(None, max_length=500)
    match_description_contains: Optional[str] = Field(None, max_length=1000)


class AlertRuleMatchPreviewResponse(BaseModel):
    matching_count: int


# ─── Branch ───────────────────────────────────────────────────────────────────

class BranchCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    parent_branch_id: Optional[uuid.UUID] = None
    branch_point_event_id: Optional[uuid.UUID] = None


class BranchUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    status: Optional[BranchStatus] = None
    status_reason: Optional[str] = None


class BranchLayoutUpdate(BaseModel):
    graph_layout: dict


class BranchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    name: str
    description: Optional[str]
    is_main: bool
    status: BranchStatus
    status_reason: Optional[str]
    parent_branch_id: Optional[uuid.UUID]
    branch_point_event_id: Optional[uuid.UUID]
    graph_layout: Optional[dict] = None
    created_by: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime


class BranchTreeResponse(BranchResponse):
    children: List["BranchTreeResponse"] = []


BranchTreeResponse.model_rebuild()


# ─── Event ────────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    branch_id: uuid.UUID
    event_ts: Optional[datetime] = None
    event_ts_tz_offset: Optional[int] = None
    event_type: EventType
    title: str = Field(..., min_length=1, max_length=1000)
    description: Optional[str] = None
    source_description: Optional[str] = None
    confidence_level: ConfidenceLevel = ConfidenceLevel.hypothesis
    mitre_tactic: Optional[str] = Field(None, max_length=100)
    mitre_technique: Optional[str] = Field(None, max_length=100)
    mitre_subtechnique: Optional[str] = Field(None, max_length=100)
    action_type: Optional[ActionType] = None
    sort_order: int = 0


class EventUpdate(BaseModel):
    event_ts: Optional[datetime] = None
    event_ts_tz_offset: Optional[int] = None
    event_type: Optional[EventType] = None
    title: Optional[str] = Field(None, min_length=1, max_length=1000)
    description: Optional[str] = None
    source_description: Optional[str] = None
    confidence_level: Optional[ConfidenceLevel] = None
    mitre_tactic: Optional[str] = Field(None, max_length=100)
    mitre_technique: Optional[str] = Field(None, max_length=100)
    mitre_subtechnique: Optional[str] = Field(None, max_length=100)
    action_type: Optional[ActionType] = None
    sort_order: Optional[int] = None


class EventDeleteRequest(BaseModel):
    delete_reason: Optional[str] = None


class IOCShort(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ioc_type: str
    value: str


class ArtifactShort(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_name: str
    sha256: Optional[str]
    uploaded_at: datetime


class EventLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_event_id: uuid.UUID
    target_event_id: uuid.UUID
    link_type: str
    description: Optional[str]
    action_type: Optional[ActionType]
    event_ts: Optional[datetime]
    mitre_technique: Optional[str]
    created_at: datetime


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    branch_id: uuid.UUID
    event_ts: Optional[datetime]
    event_ts_tz_offset: Optional[int]
    event_type: EventType
    title: str
    description: Optional[str]
    source_description: Optional[str]
    confidence_level: ConfidenceLevel
    mitre_tactic: Optional[str]
    mitre_technique: Optional[str]
    mitre_subtechnique: Optional[str]
    action_type: Optional[ActionType]
    sort_order: int
    version: int
    is_deleted: bool
    created_by: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime
    artifacts: List[ArtifactShort] = []
    iocs: List[IOCShort] = []
    linked_events: List[EventLinkResponse] = []


class EventListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    branch_id: uuid.UUID
    event_ts: Optional[datetime]
    event_type: EventType
    title: str
    confidence_level: ConfidenceLevel
    mitre_tactic: Optional[str]
    mitre_technique: Optional[str]
    sort_order: int
    version: int
    created_at: datetime
    updated_at: datetime


# ─── Event Version ────────────────────────────────────────────────────────────

class EventVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    version: int
    changed_by: Optional[uuid.UUID]
    changed_at: datetime
    changes: Optional[Dict[str, Any]]
    snapshot: Optional[Dict[str, Any]]


# ─── Event Link ───────────────────────────────────────────────────────────────

class EventLinkCreate(BaseModel):
    target_event_id: uuid.UUID
    link_type: str = Field(..., max_length=100)
    description: Optional[str] = None
    action_type: Optional[ActionType] = None
    event_ts: Optional[datetime] = None
    mitre_technique: Optional[str] = Field(None, max_length=255)


# ─── Artifact ─────────────────────────────────────────────────────────────────

class ArtifactResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    file_name: str
    content_type: Optional[str]
    file_size: Optional[int]
    sha256: Optional[str]
    md5: Optional[str]
    is_worm: bool
    integrity_ok: Optional[bool]
    upload_source: Optional[str]
    uploaded_by: Optional[uuid.UUID]
    uploaded_at: datetime


class ArtifactDownloadResponse(BaseModel):
    download_url: str
    expires_in: int = 3600


# ─── IOC ──────────────────────────────────────────────────────────────────────

class IOCCreate(BaseModel):
    ioc_type: str = Field(..., max_length=100)
    value: str
    context: Optional[str] = None


class IOCUpdate(BaseModel):
    context: Optional[str] = None
    ti_enrichment: Optional[Dict[str, Any]] = None


class IOCResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    ioc_type: str
    value: str
    context: Optional[str]
    ti_enrichment: Optional[Dict[str, Any]]
    created_by: Optional[uuid.UUID]
    created_at: datetime


# ─── Comment ──────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1)
    visibility: CommentVisibility = CommentVisibility.internal
    parent_comment_id: Optional[uuid.UUID] = None


class CommentUpdate(BaseModel):
    body: str = Field(..., min_length=1)


class CommentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: Optional[uuid.UUID]
    branch_id: Optional[uuid.UUID]
    author_id: Optional[uuid.UUID]
    parent_comment_id: Optional[uuid.UUID]
    body: str
    visibility: CommentVisibility
    is_resolved: bool
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    author: Optional[UserShort] = None
    replies: List["CommentResponse"] = []


CommentResponse.model_rebuild()


# ─── Audit Log ────────────────────────────────────────────────────────────────

class AuditLogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: Optional[uuid.UUID]
    user_id: Optional[uuid.UUID]
    action: str
    object_type: str
    object_id: Optional[str]
    details: Optional[Dict[str, Any]]
    ip_address: Optional[str]
    ts: datetime


class AuditLogEntryDetailed(AuditLogEntry):
    username: Optional[str] = None
    case_title: Optional[str] = None


# ─── Admin settings ───────────────────────────────────────────────────────────

class AppSettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    smtp_host: Optional[str] = Field(None, max_length=255)
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_username: Optional[str] = Field(None, max_length=255)
    smtp_password: Optional[str] = Field(None, max_length=255)
    smtp_from_email: Optional[str] = Field(None, max_length=255)
    smtp_use_tls: Optional[bool] = None
    email_notifications_enabled: Optional[bool] = None
    telegram_bot_token: Optional[str] = Field(None, max_length=255)
    telegram_chat_id: Optional[str] = Field(None, max_length=255)
    telegram_notifications_enabled: Optional[bool] = None


class AppSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    timezone: str
    smtp_host: Optional[str]
    smtp_port: Optional[int]
    smtp_username: Optional[str]
    smtp_password: Optional[str]
    smtp_from_email: Optional[str]
    smtp_use_tls: bool
    email_notifications_enabled: bool
    telegram_bot_token: Optional[str]
    telegram_chat_id: Optional[str]
    telegram_notifications_enabled: bool
    updated_at: datetime


# ─── Demo mode ──────────────────────────────────────────────────────────────

class DemoModeStatus(BaseModel):
    enabled: bool


class DemoModeToggleRequest(BaseModel):
    enabled: bool


class DemoModeClearRequest(BaseModel):
    confirm: str


class DemoModeSeedDataResult(BaseModel):
    cases_created: int
    alerts_created: int


class DemoModeSeedCountResult(BaseModel):
    created: int


class DemoModeClearResult(BaseModel):
    alerts_deleted: int
    cases_deleted: int


# ─── MITRE ATT&CK ───────────────────────────────────────────────────────────

class MitreTechniqueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    tactics: List[str]
    is_subtechnique: bool
    parent_technique_id: Optional[str]


class MitreTacticInfo(BaseModel):
    shortname: str
    label: str
    severity: str
    grif: str


class MitreMatrixResponse(BaseModel):
    tactics: List[MitreTacticInfo]
    techniques: List[MitreTechniqueResponse]
    technique_count: int
    last_synced_at: Optional[datetime]


class MitreSettingsResponse(BaseModel):
    sync_interval_hours: int
    last_synced_at: Optional[datetime]
    last_sync_status: Optional[str]
    last_sync_message: Optional[str]
    technique_count: Optional[int]
    source_url: str


class MitreSettingsUpdate(BaseModel):
    sync_interval_hours: int = Field(..., ge=1, le=720)


class MitreSyncResult(BaseModel):
    ok: bool
    message: str
    technique_count: int


class BackupRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=255)


class RestoreRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=255)
    confirm: str


# ─── Role permission matrix ───────────────────────────────────────────────────

class RolePermissionItem(BaseModel):
    role: UserRole
    permission: str
    allowed: bool


class RolePermissionsResponse(BaseModel):
    permissions: List[RolePermissionItem]
    labels: Dict[str, str]


class UpdateRolePermissionsRequest(BaseModel):
    permissions: List[RolePermissionItem]


# ─── Event Sources (Elastic / TheHive) ────────────────────────────────────────

class EventSourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    source_type: EventSourceType
    base_url: str = Field(..., min_length=1, max_length=500)
    verify_ssl: bool = True
    auth_username: Optional[str] = Field(None, max_length=255)
    auth_secret: Optional[str] = Field(None, max_length=2000)
    config: Optional[Dict[str, Any]] = None
    is_enabled: bool = True
    poll_interval_seconds: int = Field(300, ge=30, le=86400)


class EventSourceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    base_url: Optional[str] = Field(None, min_length=1, max_length=500)
    verify_ssl: Optional[bool] = None
    auth_username: Optional[str] = Field(None, max_length=255)
    auth_secret: Optional[str] = Field(None, max_length=2000)
    config: Optional[Dict[str, Any]] = None
    is_enabled: Optional[bool] = None
    poll_interval_seconds: Optional[int] = Field(None, ge=30, le=86400)


class EventSourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    source_type: EventSourceType
    base_url: str
    verify_ssl: bool
    auth_username: Optional[str]
    has_secret: bool
    config: Optional[Dict[str, Any]]
    is_enabled: bool
    poll_interval_seconds: int
    last_synced_at: Optional[datetime]
    last_sync_status: Optional[str]
    last_sync_message: Optional[str]
    last_sync_alert_count: Optional[int]
    created_at: datetime
    updated_at: datetime


class EventSourceTestResult(BaseModel):
    ok: bool
    message: str


class EventSourceSyncResult(BaseModel):
    ok: bool
    message: str
    new_alerts: int


# ─── Statistics ───────────────────────────────────────────────────────────────

class StatisticsPeriod(BaseModel):
    start: datetime
    end: datetime


class StatusCount(BaseModel):
    status: AlertStatus
    count: int


class ValueCount(BaseModel):
    value: str
    count: int


class ThreatTypeCount(BaseModel):
    threat_type: str
    count: int


class TimelinePoint(BaseModel):
    bucket: datetime
    count: int


class StatisticsResponse(BaseModel):
    period: StatisticsPeriod
    total_alerts: int
    timeline: List[TimelinePoint]
    timeline_granularity: str
    by_status: List[StatusCount]
    by_threat_type: List[ThreatTypeCount]
    top_urls: List[ValueCount]
    top_external_ips: List[ValueCount]
    top_internal_ips: List[ValueCount]
    top_accounts: List[ValueCount]
    top_files: List[ValueCount]


class GraphNode(BaseModel):
    id: str
    kind: str  # "alert" | "ip" | "account" | "file"
    label: str
    status: Optional[AlertStatus] = None
    degree: int = 0
    case_id: Optional[str] = None


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: str  # "ip" | "account" | "file"


class CorrelationGraphResponse(BaseModel):
    period: StatisticsPeriod
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    truncated: bool


# ─── Generic ──────────────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str


class PaginatedResponse(BaseModel):
    total: int
    items: List[Any]
