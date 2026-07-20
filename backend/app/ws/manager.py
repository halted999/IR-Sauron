import asyncio
import json
import logging
from typing import Dict, Set, Optional, Any

import redis.asyncio as aioredis
from fastapi import WebSocket, WebSocketDisconnect

from app.config import settings
from app.models import User

logger = logging.getLogger(__name__)

# Recognised outbound message types
MSG_EVENT_CREATED = "event_created"
MSG_EVENT_UPDATED = "event_updated"
MSG_EVENT_DELETED = "event_deleted"
MSG_COMMENT_ADDED = "comment_added"
MSG_BRANCH_STATUS_CHANGED = "branch_status_changed"
MSG_USER_JOINED = "user_joined"
MSG_USER_LEFT = "user_left"


class ConnectionManager:
    """
    Manages WebSocket connections per case and uses Redis Pub/Sub so that
    messages broadcast in one server process reach clients connected to other
    processes (horizontal scaling).
    """

    def __init__(self) -> None:
        # case_id (str) → set of active WebSocket connections
        self._connections: Dict[str, Set[WebSocket]] = {}
        self._redis_pub: Optional[aioredis.Redis] = None
        self._listener_tasks: Dict[str, asyncio.Task] = {}

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis_pub is None:
            self._redis_pub = await aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        return self._redis_pub

    @staticmethod
    def _channel_name(case_id: str) -> str:
        return f"ir:case:{case_id}"

    # ── connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, websocket: WebSocket, case_id: str, user: User) -> None:
        await websocket.accept()
        if case_id not in self._connections:
            self._connections[case_id] = set()
            # Start a Redis subscriber for this case channel
            self._listener_tasks[case_id] = asyncio.create_task(
                self._redis_listener(case_id)
            )
        self._connections[case_id].add(websocket)
        await self.broadcast_to_case(
            case_id,
            {
                "type": MSG_USER_JOINED,
                "user_id": str(user.id),
                "username": user.username,
            },
        )

    async def disconnect(self, websocket: WebSocket, case_id: str, user: User) -> None:
        connections = self._connections.get(case_id, set())
        connections.discard(websocket)
        if not connections:
            # No more local connections — cancel the listener task
            task = self._listener_tasks.pop(case_id, None)
            if task:
                task.cancel()
            self._connections.pop(case_id, None)
        else:
            self._connections[case_id] = connections

        await self.broadcast_to_case(
            case_id,
            {
                "type": MSG_USER_LEFT,
                "user_id": str(user.id),
                "username": user.username,
            },
        )

    # ── sending helpers ───────────────────────────────────────────────────────

    async def broadcast_to_case(self, case_id: str, message: Dict[str, Any]) -> None:
        """
        Publish *message* via Redis so all server instances receive it, then
        deliver to all local WebSocket connections for this case.
        """
        payload = json.dumps(message)
        try:
            redis = await self._get_redis()
            await redis.publish(self._channel_name(case_id), payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis publish failed: %s", exc)
            # Fall back to local-only delivery
            await self._send_local(case_id, payload)

    async def _send_local(self, case_id: str, payload: str) -> None:
        """Send raw JSON *payload* to every local connection for *case_id*."""
        dead: Set[WebSocket] = set()
        for ws in list(self._connections.get(case_id, set())):
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001
                dead.add(ws)
        for ws in dead:
            self._connections.get(case_id, set()).discard(ws)

    # ── Redis subscriber ──────────────────────────────────────────────────────

    async def _redis_listener(self, case_id: str) -> None:
        """Background task: subscribe to the Redis channel and fan-out locally."""
        redis = await aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        pubsub = redis.pubsub()
        channel = self._channel_name(case_id)
        await pubsub.subscribe(channel)
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    await self._send_local(case_id, message["data"])
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(channel)
            await redis.aclose()

    # ── main WebSocket handler ────────────────────────────────────────────────

    async def handle_websocket(
        self,
        websocket: WebSocket,
        case_id: str,
        user: User,
    ) -> None:
        await self.connect(websocket, case_id, user)
        try:
            while True:
                # We only push server → client; client messages are ignored
                # (but we must receive to detect disconnects)
                data = await websocket.receive_text()
                # Optional: echo back ping/pong
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                except (json.JSONDecodeError, AttributeError):
                    pass
        except WebSocketDisconnect:
            pass
        finally:
            await self.disconnect(websocket, case_id, user)


# Singleton used throughout the app
manager = ConnectionManager()
