"""Periodic background sync of the MITRE ATT&CK matrix — checks every tick
whether the configured interval (AppSettings.mitre_sync_interval_hours) has
elapsed since the last successful sync, and re-downloads the matrix if so.
Mirrors app.services.event_source_scheduler's polling/locking pattern.
"""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.auth import get_redis
from app.database import AsyncSessionLocal
from app.models import AppSettings
from app.services.mitre_sync import sync_mitre_matrix

logger = logging.getLogger(__name__)

_TICK_SECONDS = 1800  # check every 30 min; actual sync only runs once the configured interval has elapsed
_TICK_LOCK_KEY = "mitre_sync_tick_lock"
_TICK_LOCK_TTL_SECONDS = 1700

_scheduler: AsyncIOScheduler | None = None


async def _tick() -> None:
    # Same multi-worker de-dup rationale as event_source_scheduler._poll_tick:
    # every uvicorn worker runs its own scheduler, so the redis lock (not the
    # in-process one) is what keeps this to a single real sync per interval.
    redis = await get_redis()
    acquired = await redis.set(_TICK_LOCK_KEY, "1", nx=True, ex=_TICK_LOCK_TTL_SECONDS)
    if not acquired:
        return

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(AppSettings).where(AppSettings.id == 1))
            settings_row = result.scalar_one_or_none()
            interval_hours = settings_row.mitre_sync_interval_hours if settings_row else 24
            last_synced = settings_row.mitre_last_synced_at if settings_row else None

            due = last_synced is None or (
                datetime.now(timezone.utc) - last_synced
            ).total_seconds() >= interval_hours * 3600
            if not due:
                return

            ok, message, count = await sync_mitre_matrix(session)
            await session.commit()
            logger.info("MITRE ATT&CK scheduled sync: ok=%s techniques=%s message=%s", ok, count, message)
    except Exception:  # noqa: BLE001
        logger.exception("MITRE ATT&CK scheduled sync failed")


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_tick, "interval", seconds=_TICK_SECONDS, id="mitre_sync_tick")
    _scheduler.start()
    logger.info("MITRE ATT&CK sync scheduler started (checks every %ss)", _TICK_SECONDS)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
