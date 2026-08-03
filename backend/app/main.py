import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, AsyncGenerator

from fastapi import Depends, FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import get_password_hash, verify_token
from app.core.maintenance import get_last_restore_error, get_maintenance_reason, get_restore_progress
from app.database import AsyncSessionLocal, Base, engine, get_db
from app.models import User, UserRole  # noqa: F401 — triggers model registration

# Import all models so that Base.metadata is fully populated before create_all
from app.models import (  # noqa: F401
    Case, CaseParticipant, Branch, Event, EventVersion,
    EventLink, IOC, EventIOC, Artifact, Comment, CommentHistory, AuditLog, Alert,
    AppSettings, EventSource, AlertRule, RolePermission,
)

from app.api.v1 import (
    auth, users, cases, branches, events, artifacts, iocs, comments, alerts, admin,
    event_sources, alert_rules, statistics, mitre,
)
from app.services.event_source_scheduler import start_scheduler, stop_scheduler
from app.services.mitre_scheduler import start_scheduler as start_mitre_scheduler, stop_scheduler as stop_mitre_scheduler
from app.ws.manager import manager

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


# ─── Lifespan ─────────────────────────────────────────────────────────────────

async def _create_enum_types_if_missing(conn) -> None:
    """
    SQLAlchemy's create_all won't auto-create PostgreSQL enum types if they were
    originally created outside SA (e.g. by a migration SQL file).  This helper
    creates them if they don't exist so the app works from a clean database.
    """
    enums = {
        "user_role": [
            "admin", "ir_lead", "investigator", "observer", "external_contractor", "demo",
        ],
        "case_status": ["open", "in_progress", "confirmed", "rejected"],
        "case_severity": ["critical", "high", "medium", "low"],
        "branch_status": ["hypothesis", "confirmed", "rejected"],
        "event_type": ["attacker_action", "detection", "ir_action", "inference", "legal_event"],
        "action_type": ["network_connection", "logon_event", "file_operation", "command_execution"],
        "confidence_level": ["confirmed", "corroborated", "hypothesis"],
        "comment_visibility": ["internal", "report"],
        "alert_status": ["new", "triaged", "escalated", "dismissed", "archived"],
        "event_source_type": ["elastic", "thehive", "file_watch", "email", "json_api"],
        "alert_rule_action": ["suppress", "escalate", "assign_tag", "archive"],
    }
    for name, values in enums.items():
        quoted = ", ".join(f"'{v}'" for v in values)
        await conn.execute(
            text(f"DO $$ BEGIN CREATE TYPE {name} AS ENUM ({quoted}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;")
        )
    # Enum values added after the type already existed on a deployed database
    # (CREATE TYPE above is a no-op there) must be added explicitly.
    await conn.execute(text("ALTER TYPE alert_rule_action ADD VALUE IF NOT EXISTS 'assign_tag'"))
    await conn.execute(text("ALTER TYPE alert_rule_action ADD VALUE IF NOT EXISTS 'archive'"))
    await conn.execute(text("ALTER TYPE alert_status ADD VALUE IF NOT EXISTS 'archived'"))
    await conn.execute(text("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'demo'"))
    await conn.execute(text("ALTER TYPE event_source_type ADD VALUE IF NOT EXISTS 'file_watch'"))
    await conn.execute(text("ALTER TYPE event_source_type ADD VALUE IF NOT EXISTS 'email'"))
    await conn.execute(text("ALTER TYPE event_source_type ADD VALUE IF NOT EXISTS 'json_api'"))
    # case_status merged with the old separate verification_status field —
    # add the new values so existing deployments can migrate their data
    # (see _migrate_legacy_case_status, run in a later, separate transaction —
    # Postgres forbids using a freshly-added enum value in the same transaction).
    await conn.execute(text("ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'in_progress'"))
    await conn.execute(text("ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'confirmed'"))
    await conn.execute(text("ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'rejected'"))


async def _add_missing_columns_if_needed(conn) -> None:
    """
    create_all() only creates tables that don't exist yet — it never alters
    existing tables. When a column is added to a model after the table has
    already been created (e.g. by an earlier deploy), it must be added here
    so existing databases pick it up on next startup.
    """
    await conn.execute(
        text("ALTER TABLE events ADD COLUMN IF NOT EXISTS action_type action_type NULL")
    )
    await conn.execute(
        text(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS event_source_id UUID NULL "
            "REFERENCES event_sources(id) ON DELETE SET NULL"
        )
    )
    await conn.execute(
        text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS external_id VARCHAR(500) NULL")
    )
    await conn.execute(
        text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS external_url VARCHAR(1000) NULL")
    )
    await conn.execute(
        text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS raw_event JSONB NULL")
    )
    await conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_source_external ON alerts "
            "(event_source_id, external_id) WHERE event_source_id IS NOT NULL AND external_id IS NOT NULL"
        )
    )
    await conn.execute(
        text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false")
    )
    await conn.execute(
        text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL")
    )
    await conn.execute(
        text(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS deleted_by UUID NULL "
            "REFERENCES users(id) ON DELETE SET NULL"
        )
    )
    await conn.execute(
        text(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS assigned_to UUID NULL "
            "REFERENCES users(id) ON DELETE SET NULL"
        )
    )
    await conn.execute(
        text(
            "ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS "
            "match_description_contains VARCHAR(1000) NULL"
        )
    )
    await conn.execute(
        text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_index VARCHAR(255) NULL")
    )
    await conn.execute(
        text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb")
    )
    await conn.execute(
        text("ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS tag_value VARCHAR(100) NULL")
    )
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS root_cause TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS impact_summary TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS attribution TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS report_notes TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS incident_number VARCHAR(100) NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS detection_source TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS trigger_rule TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS severity_justification TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS executive_summary TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS attack_vector TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS exploited_vulnerability TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS tooling_used TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS affected_assets TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS confidentiality_impact TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS integrity_impact TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS availability_impact TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS financial_reputational_damage TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS sla_breach TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS containment_actions TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS eradication_actions TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS recovery_actions TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS lessons_worked_well TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS lessons_to_improve TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS new_detection_rules_needed TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS recommendations TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS approval_notes TEXT NULL"))
    await conn.execute(
        text("ALTER TABLE event_links ADD COLUMN IF NOT EXISTS action_type action_type NULL")
    )
    await conn.execute(
        text("ALTER TABLE event_links ADD COLUMN IF NOT EXISTS event_ts TIMESTAMPTZ NULL")
    )
    await conn.execute(
        text("ALTER TABLE event_links ADD COLUMN IF NOT EXISTS mitre_technique VARCHAR(255) NULL")
    )
    await conn.execute(text("ALTER TABLE branches ADD COLUMN IF NOT EXISTS graph_layout JSONB NULL"))
    await conn.execute(text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL"))
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL"))
    await conn.execute(
        text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false")
    )
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL"))
    await conn.execute(
        text(
            "ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_by UUID NULL "
            "REFERENCES users(id) ON DELETE SET NULL"
        )
    )
    await conn.execute(
        text(
            "ALTER TABLE cases ADD COLUMN IF NOT EXISTS parent_case_id UUID NULL "
            "REFERENCES cases(id) ON DELETE SET NULL"
        )
    )
    await conn.execute(text("ALTER TABLE cases ADD COLUMN IF NOT EXISTS attach_reason TEXT NULL"))
    await conn.execute(
        text("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mitre_sync_interval_hours INTEGER NOT NULL DEFAULT 24")
    )
    await conn.execute(
        text("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mitre_last_synced_at TIMESTAMPTZ NULL")
    )
    await conn.execute(
        text("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mitre_last_sync_status VARCHAR(20) NULL")
    )
    await conn.execute(
        text("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mitre_last_sync_message TEXT NULL")
    )
    await conn.execute(
        text("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mitre_technique_count INTEGER NULL")
    )
    await conn.execute(
        text("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS demo_mode_enabled BOOLEAN NOT NULL DEFAULT false")
    )
    await conn.execute(
        text("ALTER TABLE event_sources ADD COLUMN IF NOT EXISTS file_offsets JSONB NULL")
    )


async def _migrate_informational_severity_to_low(conn) -> None:
    """
    The 'informational' severity level was removed from CaseSeverity — every
    alert/case/alert-rule already using it is downgraded to 'low' (Postgres
    has no ALTER TYPE ... DROP VALUE, so the enum type itself is swapped for
    a fresh one without that value once no row references it anymore).
    Idempotent: a no-op once already migrated.
    """
    has_value = await conn.scalar(
        text(
            "SELECT 1 FROM pg_enum WHERE enumlabel = 'informational' "
            "AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'case_severity')"
        )
    )
    if not has_value:
        return  # already migrated (or fresh install, created without it)

    await conn.execute(text("UPDATE alerts SET severity = 'low' WHERE severity = 'informational'"))
    await conn.execute(text("UPDATE cases SET severity = 'low' WHERE severity = 'informational'"))
    await conn.execute(
        text("UPDATE alert_rules SET match_severity = 'low' WHERE match_severity = 'informational'")
    )

    await conn.execute(text("ALTER TYPE case_severity RENAME TO case_severity_old"))
    await conn.execute(text("CREATE TYPE case_severity AS ENUM ('critical', 'high', 'medium', 'low')"))
    await conn.execute(
        text("ALTER TABLE alerts ALTER COLUMN severity TYPE case_severity USING severity::text::case_severity")
    )
    await conn.execute(
        text("ALTER TABLE cases ALTER COLUMN severity TYPE case_severity USING severity::text::case_severity")
    )
    await conn.execute(
        text(
            "ALTER TABLE alert_rules ALTER COLUMN match_severity TYPE case_severity "
            "USING match_severity::text::case_severity"
        )
    )
    await conn.execute(text("DROP TYPE case_severity_old"))


async def _migrate_legacy_case_status(conn) -> None:
    """
    case_status used to carry open/active/review/closed while a separate
    verification_status column tracked in_progress/confirmed/rejected. Both
    are now merged into a single case_status value. Must run in a
    transaction separate from the one that adds the new case_status enum
    values (see _create_enum_types_if_missing) — Postgres refuses to use a
    freshly added enum value within the same transaction that added it.
    """
    has_verification_column = await conn.scalar(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'cases' AND column_name = 'verification_status'"
        )
    )
    if not has_verification_column:
        return  # fresh install — nothing to migrate

    await conn.execute(
        text(
            "UPDATE cases SET status = (CASE "
            "WHEN verification_status = 'confirmed' THEN 'confirmed' "
            "WHEN verification_status = 'rejected' THEN 'rejected' "
            "WHEN status = 'open' THEN 'open' "
            "ELSE 'in_progress' "
            "END)::case_status "
            "WHERE status IN ('active', 'review', 'closed')"
        )
    )
    # The column itself was never dropped after the data migration above, and
    # its NOT NULL constraint (with no default) breaks every new case insert
    # since the Case model has no such field to populate — relax it rather
    # than dropping the column outright, since ORM inserts simply omit it.
    await conn.execute(text("ALTER TABLE cases ALTER COLUMN verification_status DROP NOT NULL"))


async def _ensure_admin_user() -> None:
    """Ensure the built-in admin account exists with username=admin / password=admin."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == "admin"))
        admin = result.scalar_one_or_none()
        if admin is None:
            admin = User(
                id=uuid.uuid4(),
                username="admin",
                email="admin@ir-sauron.local",
                full_name="System Administrator",
                hashed_password=get_password_hash("admin"),
                role=UserRole.admin,
                is_active=True,
            )
            session.add(admin)
            logger.info("Created admin user (username=admin, password=admin)")
        else:
            # Restore role / active status in case they were accidentally changed
            admin.role = UserRole.admin
            admin.is_active = True
            # Reset password only when env var is set (e.g. first-time deploy)
            import os
            if os.getenv("RESET_ADMIN_PASSWORD", "false").lower() == "true":
                admin.hashed_password = get_password_hash("admin")
                logger.info("Admin password reset to 'admin' (RESET_ADMIN_PASSWORD=true)")
        await session.commit()


async def _seed_role_permissions() -> None:
    """
    Seed role_permissions with the defaults that reproduce the previously
    hardcoded RBAC checks (see app.core.rbac.DEFAULT_ROLE_PERMISSIONS) — only
    for rows that don't exist yet, so an admin's edits are never overwritten
    on restart.
    """
    from app.core.rbac import DEFAULT_ROLE_PERMISSIONS
    from app.models import RolePermission

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(RolePermission))
        existing = {(rp.role, rp.permission) for rp in result.scalars().all()}
        for (role, permission), allowed in DEFAULT_ROLE_PERMISSIONS.items():
            if (role, permission) not in existing:
                session.add(RolePermission(role=role, permission=permission, allowed=allowed))
        await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    logger.info("Starting IR-Sauron backend...")
    async with engine.begin() as conn:
        await _create_enum_types_if_missing(conn)
        await conn.run_sync(Base.metadata.create_all)
        await _add_missing_columns_if_needed(conn)
    async with engine.begin() as conn:
        await _migrate_legacy_case_status(conn)
        await _migrate_informational_severity_to_low(conn)
    await _ensure_admin_user()
    await _seed_role_permissions()

    # Ensure MinIO bucket exists (run sync method off the event loop)
    try:
        from app.services.storage import storage_service
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, storage_service._ensure_bucket)
        logger.info("MinIO bucket ready: %s", settings.minio_bucket)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not connect to MinIO at startup: %s", exc)

    start_scheduler()
    start_mitre_scheduler()

    logger.info("Startup complete.")
    yield

    # Shutdown
    logger.info("Shutting down...")
    stop_scheduler()
    stop_mitre_scheduler()
    await engine.dispose()


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="IR-Sauron",
    description=(
        "Backend API for the Incident Response Timeline Constructor — "
        "a collaborative tool for IR/DFIR teams to build, annotate, and export "
        "attack timelines."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)

# ── Maintenance mode ──────────────────────────────────────────────────────────
# Set by the DB restore endpoint (see app.api.v1.admin) for the duration of a
# pg_restore run, since --clean drops and recreates every table — any other
# request touching the DB concurrently would otherwise see broken/missing
# data. Backed by Redis (not an in-process flag) because uvicorn runs several
# worker processes that don't share memory.

_MAINTENANCE_EXEMPT_PREFIXES = ("/v1/admin/restore", "/v1/ping", "/health")


@app.middleware("http")
async def maintenance_mode_middleware(request: Request, call_next):
    if not any(request.url.path.startswith(p) for p in _MAINTENANCE_EXEMPT_PREFIXES):
        reason = await get_maintenance_reason()
        if reason:
            return JSONResponse(
                status_code=503,
                content={"detail": "maintenance", "maintenance": True, "reason": reason},
            )
    return await call_next(request)


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router, prefix="/v1")
app.include_router(users.router, prefix="/v1")
app.include_router(cases.router, prefix="/v1")
app.include_router(branches.router, prefix="/v1")
app.include_router(events.router, prefix="/v1")
app.include_router(artifacts.router, prefix="/v1")
app.include_router(iocs.router, prefix="/v1")
app.include_router(comments.router, prefix="/v1")
app.include_router(alerts.router, prefix="/v1")
app.include_router(admin.router, prefix="/v1")
app.include_router(event_sources.router, prefix="/v1")
app.include_router(alert_rules.router, prefix="/v1")
app.include_router(statistics.router, prefix="/v1")
app.include_router(mitre.router, prefix="/v1")

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["health"])
async def health_check(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "error",
    }


@app.get("/v1/ping", tags=["health"])
async def ping(db: Annotated[AsyncSession, Depends(get_db)]) -> dict:
    """Lightweight, unauthenticated, maintenance-mode-exempt endpoint — used
    by the frontend to detect when a database restore has finished, and to
    poll its progress while it runs. Also exposes demo_mode_enabled so the
    login page and app header can react to it without authentication."""
    reason = await get_maintenance_reason()
    progress = await get_restore_progress()
    last_error = await get_last_restore_error()
    settings_result = await db.execute(select(AppSettings.demo_mode_enabled).where(AppSettings.id == 1))
    demo_mode_enabled = bool(settings_result.scalar_one_or_none() or False)
    return {
        "status": "ok",
        "maintenance": bool(reason),
        "demo_mode_enabled": demo_mode_enabled,
        "reason": reason,
        "progress": {"processed": progress[0], "total": progress[1]} if progress else None,
        "last_error": last_error,
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/cases/{case_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    case_id: str,
) -> None:
    """
    Real-time collaboration endpoint per case.
    Clients must send the JWT access token as a query parameter: ?token=<access_token>
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return

    try:
        payload = verify_token(token)
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise ValueError("No sub in token")
        user_id = uuid.UUID(user_id_str)
    except Exception:
        await websocket.close(code=4001, reason="Invalid token")
        return

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        await websocket.close(code=4003, reason="User not found or inactive")
        return

    await manager.handle_websocket(websocket, case_id, user)
