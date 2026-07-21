import uuid
import enum
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import (
    String, Text, Boolean, Integer, DateTime, Float,
    ForeignKey, Enum as SAEnum, JSON, UniqueConstraint, Index,
    func, text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ─── Enums ────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    admin = "admin"
    ir_lead = "ir_lead"
    investigator = "investigator"
    threat_hunter = "threat_hunter"
    observer = "observer"
    legal = "legal"
    external_contractor = "external_contractor"


class CaseStatus(str, enum.Enum):
    open = "open"
    active = "active"
    review = "review"
    closed = "closed"


class CaseSeverity(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    informational = "informational"


class BranchStatus(str, enum.Enum):
    hypothesis = "hypothesis"
    confirmed = "confirmed"
    rejected = "rejected"


class EventType(str, enum.Enum):
    attacker_action = "attacker_action"
    detection = "detection"
    ir_action = "ir_action"
    inference = "inference"
    legal_event = "legal_event"


class ActionType(str, enum.Enum):
    """Technical action category used by the event graph's action cards."""
    network_connection = "network_connection"
    logon_event = "logon_event"
    file_operation = "file_operation"
    command_execution = "command_execution"


class ConfidenceLevel(str, enum.Enum):
    confirmed = "confirmed"
    corroborated = "corroborated"
    hypothesis = "hypothesis"


class CommentVisibility(str, enum.Enum):
    internal = "internal"
    report = "report"


class AlertStatus(str, enum.Enum):
    new = "new"
    triaged = "triaged"
    escalated = "escalated"
    dismissed = "dismissed"


class VerificationStatus(str, enum.Enum):
    in_progress = "in_progress"
    confirmed = "confirmed"
    rejected = "rejected"


# ─── Models ───────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, name="user_role", create_type=False), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    cases_led: Mapped[List["Case"]] = relationship("Case", back_populates="ir_lead", foreign_keys="Case.ir_lead_id")
    case_participations: Mapped[List["CaseParticipant"]] = relationship("CaseParticipant", back_populates="user")
    audit_logs: Mapped[List["AuditLog"]] = relationship("AuditLog", back_populates="user")
    comments: Mapped[List["Comment"]] = relationship("Comment", back_populates="author", foreign_keys="Comment.author_id")


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[CaseStatus] = mapped_column(
        SAEnum(CaseStatus, name="case_status", create_type=False),
        default=CaseStatus.open, nullable=False
    )
    verification_status: Mapped[VerificationStatus] = mapped_column(
        SAEnum(VerificationStatus, name="verification_status", create_type=False),
        default=VerificationStatus.in_progress, nullable=False
    )
    severity: Mapped[CaseSeverity] = mapped_column(
        SAEnum(CaseSeverity, name="case_severity", create_type=False),
        nullable=False
    )
    ir_lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    classification: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confidentiality_label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    external_ticket_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    incident_discovered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    incident_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    incident_contained_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    incident_closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    ir_lead: Mapped[Optional["User"]] = relationship("User", back_populates="cases_led", foreign_keys=[ir_lead_id])
    participants: Mapped[List["CaseParticipant"]] = relationship("CaseParticipant", back_populates="case", cascade="all, delete-orphan")
    branches: Mapped[List["Branch"]] = relationship("Branch", back_populates="case", cascade="all, delete-orphan")
    iocs: Mapped[List["IOC"]] = relationship("IOC", back_populates="case", cascade="all, delete-orphan")
    audit_logs: Mapped[List["AuditLog"]] = relationship("AuditLog", back_populates="case")


class CaseParticipant(Base):
    __tablename__ = "case_participants"
    __table_args__ = (
        UniqueConstraint("case_id", "user_id", name="uq_case_participant"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role_in_case: Mapped[Optional[UserRole]] = mapped_column(
        SAEnum(UserRole, name="user_role", create_type=False), nullable=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    case: Mapped["Case"] = relationship("Case", back_populates="participants")
    user: Mapped["User"] = relationship("User", back_populates="case_participations")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    severity: Mapped[CaseSeverity] = mapped_column(
        SAEnum(CaseSeverity, name="case_severity", create_type=False), nullable=False
    )
    source: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[AlertStatus] = mapped_column(
        SAEnum(AlertStatus, name="alert_status", create_type=False),
        default=AlertStatus.new, nullable=False
    )
    case_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cases.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    case: Mapped[Optional["Case"]] = relationship("Case", foreign_keys=[case_id])
    created_by_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[BranchStatus] = mapped_column(
        SAEnum(BranchStatus, name="branch_status", create_type=False),
        default=BranchStatus.hypothesis, nullable=False
    )
    status_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    parent_branch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )
    branch_point_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    case: Mapped["Case"] = relationship("Case", back_populates="branches")
    parent_branch: Mapped[Optional["Branch"]] = relationship(
        "Branch", remote_side="Branch.id", foreign_keys=[parent_branch_id], backref="child_branches"
    )
    branch_point_event: Mapped[Optional["Event"]] = relationship(
        "Event", foreign_keys=[branch_point_event_id]
    )
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
    events: Mapped[List["Event"]] = relationship(
        "Event", back_populates="branch",
        foreign_keys="Event.branch_id",
        cascade="all, delete-orphan"
    )
    comments: Mapped[List["Comment"]] = relationship(
        "Comment", back_populates="branch",
        foreign_keys="Comment.branch_id"
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False
    )
    event_ts: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    event_ts_tz_offset: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    event_type: Mapped[EventType] = mapped_column(
        SAEnum(EventType, name="event_type", create_type=False), nullable=False
    )
    title: Mapped[str] = mapped_column(String(1000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence_level: Mapped[ConfidenceLevel] = mapped_column(
        SAEnum(ConfidenceLevel, name="confidence_level", create_type=False),
        default=ConfidenceLevel.hypothesis, nullable=False
    )
    mitre_tactic: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    mitre_technique: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    mitre_subtechnique: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    action_type: Mapped[Optional[ActionType]] = mapped_column(
        SAEnum(ActionType, name="action_type", create_type=False), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    delete_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    branch: Mapped["Branch"] = relationship("Branch", back_populates="events", foreign_keys=[branch_id])
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
    versions: Mapped[List["EventVersion"]] = relationship("EventVersion", back_populates="event", cascade="all, delete-orphan")
    artifacts: Mapped[List["Artifact"]] = relationship("Artifact", back_populates="event", cascade="all, delete-orphan")
    comments: Mapped[List["Comment"]] = relationship(
        "Comment", back_populates="event",
        foreign_keys="Comment.event_id"
    )
    ioc_links: Mapped[List["EventIOC"]] = relationship("EventIOC", back_populates="event", cascade="all, delete-orphan")

    # Links
    outgoing_links: Mapped[List["EventLink"]] = relationship(
        "EventLink", back_populates="source_event",
        foreign_keys="EventLink.source_event_id",
        cascade="all, delete-orphan"
    )
    incoming_links: Mapped[List["EventLink"]] = relationship(
        "EventLink", back_populates="target_event",
        foreign_keys="EventLink.target_event_id",
        cascade="all, delete-orphan"
    )


class EventVersion(Base):
    __tablename__ = "event_versions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    changed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    changes: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    event: Mapped["Event"] = relationship("Event", back_populates="versions")
    changed_by_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[changed_by])


class EventLink(Base):
    __tablename__ = "event_links"
    __table_args__ = (
        UniqueConstraint("source_event_id", "target_event_id", "link_type", name="uq_event_link"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    target_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    link_type: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    source_event: Mapped["Event"] = relationship("Event", back_populates="outgoing_links", foreign_keys=[source_event_id])
    target_event: Mapped["Event"] = relationship("Event", back_populates="incoming_links", foreign_keys=[target_event_id])


class IOC(Base):
    __tablename__ = "iocs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False
    )
    ioc_type: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ti_enrichment: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    case: Mapped["Case"] = relationship("Case", back_populates="iocs")
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
    event_links: Mapped[List["EventIOC"]] = relationship("EventIOC", back_populates="ioc", cascade="all, delete-orphan")


class EventIOC(Base):
    __tablename__ = "event_iocs"
    __table_args__ = (
        UniqueConstraint("event_id", "ioc_id", name="uq_event_ioc"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    ioc_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("iocs.id", ondelete="CASCADE"), nullable=False
    )
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    event: Mapped["Event"] = relationship("Event", back_populates="ioc_links")
    ioc: Mapped["IOC"] = relationship("IOC", back_populates="event_links")


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    md5: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    is_worm: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    integrity_ok: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    upload_source: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    uploaded_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    event: Mapped["Event"] = relationship("Event", back_populates="artifacts")
    uploader: Mapped[Optional["User"]] = relationship("User", foreign_keys=[uploaded_by])


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=True
    )
    branch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=True
    )
    author_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    parent_comment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comments.id", ondelete="CASCADE"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[CommentVisibility] = mapped_column(
        SAEnum(CommentVisibility, name="comment_visibility", create_type=False),
        default=CommentVisibility.internal, nullable=False
    )
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    event: Mapped[Optional["Event"]] = relationship("Event", back_populates="comments", foreign_keys=[event_id])
    branch: Mapped[Optional["Branch"]] = relationship("Branch", back_populates="comments", foreign_keys=[branch_id])
    author: Mapped[Optional["User"]] = relationship("User", back_populates="comments", foreign_keys=[author_id])
    parent_comment: Mapped[Optional["Comment"]] = relationship(
        "Comment", remote_side="Comment.id", foreign_keys=[parent_comment_id], backref="replies"
    )
    history: Mapped[List["CommentHistory"]] = relationship("CommentHistory", back_populates="comment", cascade="all, delete-orphan")


class CommentHistory(Base):
    __tablename__ = "comment_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    comment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comments.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    edited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    comment: Mapped["Comment"] = relationship("Comment", back_populates="history")
    editor: Mapped[Optional["User"]] = relationship("User", foreign_keys=[edited_by])


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cases.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    object_type: Mapped[str] = mapped_column(String(100), nullable=False)
    object_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    details: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    case: Mapped[Optional["Case"]] = relationship("Case", back_populates="audit_logs")
    user: Mapped[Optional["User"]] = relationship("User", back_populates="audit_logs")


class AppSettings(Base):
    """Singleton row (id=1) holding admin-configurable application settings."""
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)

    smtp_host: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    smtp_username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_from_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    telegram_bot_token: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    telegram_chat_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    telegram_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
