import uuid
from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, EmailStr, Field, ConfigDict

from app.models import (
    UserRole, CaseStatus, CaseSeverity, BranchStatus,
    EventType, ConfidenceLevel, CommentVisibility, AlertStatus, VerificationStatus
)


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
    verification_status: Optional[VerificationStatus] = None
    severity: Optional[CaseSeverity] = None
    ir_lead_id: Optional[uuid.UUID] = None
    classification: Optional[str] = Field(None, max_length=255)
    confidentiality_label: Optional[str] = Field(None, max_length=100)
    external_ticket_id: Optional[str] = Field(None, max_length=255)
    incident_discovered_at: Optional[datetime] = None
    incident_started_at: Optional[datetime] = None
    incident_contained_at: Optional[datetime] = None
    incident_closed_at: Optional[datetime] = None


class CaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: CaseStatus
    verification_status: VerificationStatus
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
    created_at: datetime
    updated_at: datetime
    participants: List[CaseParticipantResponse] = []


class CaseListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: CaseStatus
    verification_status: VerificationStatus
    severity: CaseSeverity
    ir_lead_id: Optional[uuid.UUID]
    classification: Optional[str]
    incident_discovered_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


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


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: Optional[str]
    severity: CaseSeverity
    source: Optional[str]
    status: AlertStatus
    case_id: Optional[uuid.UUID]
    created_by: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime


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


class BackupRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=255)


# ─── Generic ──────────────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str


class PaginatedResponse(BaseModel):
    total: int
    items: List[Any]
