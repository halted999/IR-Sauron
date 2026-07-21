import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, AsyncGenerator

from fastapi import Depends, FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import get_password_hash, verify_token
from app.database import AsyncSessionLocal, Base, engine, get_db
from app.models import User, UserRole  # noqa: F401 — triggers model registration

# Import all models so that Base.metadata is fully populated before create_all
from app.models import (  # noqa: F401
    Case, CaseParticipant, Branch, Event, EventVersion,
    EventLink, IOC, EventIOC, Artifact, Comment, CommentHistory, AuditLog, Alert,
    AppSettings,
)

from app.api.v1 import auth, users, cases, branches, events, artifacts, iocs, comments, alerts, admin
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
            "admin", "ir_lead", "investigator", "threat_hunter",
            "observer", "legal", "external_contractor",
        ],
        "case_status": ["open", "active", "review", "closed"],
        "case_severity": ["critical", "high", "medium", "low", "informational"],
        "branch_status": ["hypothesis", "confirmed", "rejected"],
        "event_type": ["attacker_action", "detection", "ir_action", "inference", "legal_event"],
        "action_type": ["network_connection", "logon_event", "file_operation", "command_execution"],
        "confidence_level": ["confirmed", "corroborated", "hypothesis"],
        "comment_visibility": ["internal", "report"],
        "alert_status": ["new", "triaged", "escalated", "dismissed"],
        "verification_status": ["in_progress", "confirmed", "rejected"],
    }
    for name, values in enums.items():
        quoted = ", ".join(f"'{v}'" for v in values)
        await conn.execute(
            text(f"DO $$ BEGIN CREATE TYPE {name} AS ENUM ({quoted}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;")
        )


async def _add_missing_columns_if_needed(conn) -> None:
    """
    create_all() only creates tables that don't exist yet — it never alters
    existing tables. When a column is added to a model after the table has
    already been created (e.g. by an earlier deploy), it must be added here
    so existing databases pick it up on next startup.
    """
    await conn.execute(
        text(
            "ALTER TABLE cases ADD COLUMN IF NOT EXISTS "
            "verification_status verification_status NOT NULL DEFAULT 'in_progress'"
        )
    )
    await conn.execute(
        text("ALTER TABLE events ADD COLUMN IF NOT EXISTS action_type action_type NULL")
    )


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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    logger.info("Starting IR-Sauron backend...")
    async with engine.begin() as conn:
        await _create_enum_types_if_missing(conn)
        await conn.run_sync(Base.metadata.create_all)
        await _add_missing_columns_if_needed(conn)
    await _ensure_admin_user()

    # Ensure MinIO bucket exists (run sync method off the event loop)
    try:
        from app.services.storage import storage_service
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, storage_service._ensure_bucket)
        logger.info("MinIO bucket ready: %s", settings.minio_bucket)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not connect to MinIO at startup: %s", exc)

    logger.info("Startup complete.")
    yield

    # Shutdown
    logger.info("Shutting down...")
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
)

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
