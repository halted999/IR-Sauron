"""Polls a generic JSON REST endpoint, authenticated via a static API-key
header, for a list of alert-like records.

Supports optional server-side incremental filtering (`since_param`) and
page-number pagination (`page_param`/`page_size_param`), both driven purely
by query-string config — without them, behaviour is unchanged from before:
a single unparameterized GET returning whatever the endpoint gives back.
A response is read in bounded chunks and capped at `max_response_bytes`
rather than buffered without limit, so a runaway or misconfigured endpoint
fails with a clear error instead of exhausting memory.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_TITLE_FIELDS = ["title", "summary", "message", "alert", "name", "rule", "заголовок"]
_DESCRIPTION_FIELDS = ["description", "details", "comment", "body", "описание"]
_SEVERITY_FIELDS = ["severity", "priority", "level", "критичность"]
_SOURCE_FIELDS = ["source", "sensor", "system", "host", "источник"]
_ID_FIELDS = ["id", "_id", "alert_id", "event_id", "uuid", "guid"]

_DEFAULT_TIMEOUT_SECONDS = 30.0
_DEFAULT_MAX_RESPONSE_BYTES = 50 * 1024 * 1024
_DEFAULT_MAX_PAGES = 100


def _pick(row: Dict[str, Any], candidates: List[str], override: Optional[str]) -> Optional[str]:
    if override:
        value = row.get(override)
        if value not in (None, ""):
            return str(value)
    lower = {k.lower().strip(): v for k, v in row.items() if isinstance(k, str)}
    for name in candidates:
        value = lower.get(name)
        if value not in (None, ""):
            return str(value)
    return None


class JsonApiClient:
    """Fetches records from a JSON REST API secured by an `Authorization`-style
    static header (e.g. `X-API-Key: <key>`), optionally nested under a path.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str],
        api_key_header: str = "X-API-Key",
        json_path: Optional[str] = None,
        title_field: Optional[str] = None,
        description_field: Optional[str] = None,
        severity_field: Optional[str] = None,
        id_field: Optional[str] = None,
        verify_ssl: bool = True,
        since_param: Optional[str] = None,
        since_format: str = "iso",
        page_param: Optional[str] = None,
        page_size_param: Optional[str] = None,
        page_size: Optional[int] = None,
        page_start: int = 1,
        max_pages: int = _DEFAULT_MAX_PAGES,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        max_response_bytes: int = _DEFAULT_MAX_RESPONSE_BYTES,
    ) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.api_key_header = api_key_header or "X-API-Key"
        self.json_path = json_path
        self.title_field = title_field
        self.description_field = description_field
        self.severity_field = severity_field
        self.id_field = id_field
        self.verify_ssl = verify_ssl
        self.since_param = since_param
        self.since_format = since_format or "iso"
        self.page_param = page_param
        self.page_size_param = page_size_param
        self.page_size = page_size
        self.page_start = page_start
        self.max_pages = max(1, max_pages)
        self.timeout_seconds = timeout_seconds
        self.max_response_bytes = max_response_bytes

    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers[self.api_key_header] = self.api_key
        return headers

    def _format_since(self, since: datetime) -> str:
        if self.since_format == "unix":
            return str(int(since.timestamp()))
        if self.since_format == "unix_ms":
            return str(int(since.timestamp() * 1000))
        return since.astimezone(timezone.utc).isoformat()

    def _build_params(self, since: Optional[datetime], page: int) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if self.since_param and since is not None:
            params[self.since_param] = self._format_since(since)
        if self.page_param:
            params[self.page_param] = page
            if self.page_size_param and self.page_size:
                params[self.page_size_param] = self.page_size
        return params

    async def _fetch_page(self, client: httpx.AsyncClient, params: Dict[str, Any]) -> Any:
        async with client.stream(
            "GET", self.base_url, headers=self._headers(), params=params, timeout=self.timeout_seconds
        ) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > self.max_response_bytes:
                    raise ValueError(
                        f"Ответ превышает допустимый размер ({self.max_response_bytes} байт) — "
                        "увеличьте лимит в настройках источника или включите/уменьшите постраничную выдачу"
                    )
            return json.loads(bytes(body).decode("utf-8"))

    def _extract_list(self, data: Any) -> List[Dict[str, Any]]:
        node = data
        if self.json_path:
            for part in self.json_path.split("."):
                if isinstance(node, dict) and part in node:
                    node = node[part]
                else:
                    return []
        if isinstance(node, list):
            return [item for item in node if isinstance(item, dict)]
        if isinstance(node, dict):
            return [node]
        return []

    async def test_connection(self) -> Tuple[bool, str]:
        try:
            async with httpx.AsyncClient(verify=self.verify_ssl) as client:
                data = await self._fetch_page(client, self._build_params(None, self.page_start))
                items = self._extract_list(data)
                return True, f"Подключение успешно, записей получено: {len(items)}"
        except httpx.HTTPStatusError as exc:
            return False, f"HTTP {exc.response.status_code}: {exc.response.text[:300]}"
        except httpx.HTTPError as exc:
            return False, f"Ошибка соединения: {exc}"
        except ValueError as exc:
            return False, f"Ответ не является корректным JSON: {exc}"

    async def fetch_records(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Fetches all pages (or a single request, if pagination isn't
        configured). `since` is only sent to the endpoint if `since_param`
        is configured — otherwise the full current result set is returned,
        same as before pagination support existed.
        """
        all_items: List[Dict[str, Any]] = []
        async with httpx.AsyncClient(verify=self.verify_ssl) as client:
            page = self.page_start
            pages_fetched = 0
            while True:
                data = await self._fetch_page(client, self._build_params(since, page))
                items = self._extract_list(data)
                all_items.extend(items)
                pages_fetched += 1

                if not self.page_param:
                    break  # pagination not configured — single request, as before
                if not items:
                    break
                if self.page_size and len(items) < self.page_size:
                    break  # short page — this was the last one
                if pages_fetched >= self.max_pages:
                    logger.warning(
                        "json_api source hit max_pages=%s for %s — some records may not "
                        "have been fetched this poll; they will be picked up on the next one "
                        "only if the endpoint still returns them (e.g. sorted oldest-first).",
                        self.max_pages, self.base_url,
                    )
                    break
                page += 1

        return all_items

    def normalize(self, row: Dict[str, Any]) -> Dict[str, Any]:
        id_value = _pick(row, _ID_FIELDS, self.id_field)
        if id_value:
            external_id = id_value
        else:
            # No stable id field on the record — fall back to a content hash
            # rather than the row's position in the response. Position isn't
            # a safe identity: if the endpoint's ordering isn't guaranteed
            # stable across polls (newest-first feeds, unordered results),
            # keying on index re-creates a "new" alert for the same real
            # event whenever it shifts position.
            digest = hashlib.sha256(
                json.dumps(row, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")
            ).hexdigest()
            external_id = f"content:{digest}"
        return {
            "external_id": external_id,
            "title": _pick(row, _TITLE_FIELDS, self.title_field),
            "description": _pick(row, _DESCRIPTION_FIELDS, self.description_field),
            "severity": _pick(row, _SEVERITY_FIELDS, self.severity_field),
            "source": _pick(row, _SOURCE_FIELDS, None),
            "data": row,
        }
