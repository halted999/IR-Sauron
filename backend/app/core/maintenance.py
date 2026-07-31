from typing import Optional, Tuple

from app.core.auth import get_redis

_MAINTENANCE_KEY = "irsauron:maintenance"
_PROGRESS_KEY = "irsauron:maintenance:progress"
_ERROR_KEY = "irsauron:maintenance:last_error"
# Safety-net auto-expire: if a worker crashes mid-restore before clearing the
# flag, the app doesn't stay stuck in maintenance mode forever.
_MAINTENANCE_TTL_SECONDS = 900


async def set_maintenance(active: bool, reason: str = "restore") -> None:
    redis = await get_redis()
    if active:
        await redis.setex(_MAINTENANCE_KEY, _MAINTENANCE_TTL_SECONDS, reason)
    else:
        await redis.delete(_MAINTENANCE_KEY)
        await redis.delete(_PROGRESS_KEY)


async def get_maintenance_reason() -> Optional[str]:
    redis = await get_redis()
    value = await redis.get(_MAINTENANCE_KEY)
    if value is None:
        return None
    return value.decode() if isinstance(value, bytes) else value


async def set_restore_progress(processed: int, total: int) -> None:
    redis = await get_redis()
    await redis.setex(_PROGRESS_KEY, _MAINTENANCE_TTL_SECONDS, f"{processed}/{max(total, 1)}")


async def get_restore_progress() -> Optional[Tuple[int, int]]:
    redis = await get_redis()
    value = await redis.get(_PROGRESS_KEY)
    if value is None:
        return None
    text = value.decode() if isinstance(value, bytes) else value
    try:
        processed_str, total_str = text.split("/")
        return int(processed_str), int(total_str)
    except (ValueError, AttributeError):
        return None


async def set_last_restore_error(message: Optional[str]) -> None:
    redis = await get_redis()
    if message:
        await redis.setex(_ERROR_KEY, 300, message[:2000])
    else:
        await redis.delete(_ERROR_KEY)


async def get_last_restore_error() -> Optional[str]:
    redis = await get_redis()
    value = await redis.get(_ERROR_KEY)
    if value is None:
        return None
    return value.decode() if isinstance(value, bytes) else value
