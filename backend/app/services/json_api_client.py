"""Polls a generic JSON REST endpoint, authenticated via a static API-key
header, for a list of alert-like records.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_TITLE_FIELDS = ["title", "summary", "message", "alert", "name", "rule", "заголовок"]
_DESCRIPTION_FIELDS = ["description", "details", "comment", "body", "описание"]
_SEVERITY_FIELDS = ["severity", "priority", "level", "критичность"]
_SOURCE_FIELDS = ["source", "sensor", "system", "host", "источник"]
_ID_FIELDS = ["id", "_id", "alert_id", "event_id", "uuid", "guid"]


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

    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers[self.api_key_header] = self.api_key
        return headers

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
            async with httpx.AsyncClient(verify=self.verify_ssl, timeout=15.0) as client:
                response = await client.get(self.base_url, headers=self._headers())
                response.raise_for_status()
                items = self._extract_list(response.json())
                return True, f"Подключение успешно, записей получено: {len(items)}"
        except httpx.HTTPStatusError as exc:
            return False, f"HTTP {exc.response.status_code}: {exc.response.text[:300]}"
        except httpx.HTTPError as exc:
            return False, f"Ошибка соединения: {exc}"
        except ValueError as exc:
            return False, f"Ответ не является корректным JSON: {exc}"

    async def fetch_records(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=15.0) as client:
            response = await client.get(self.base_url, headers=self._headers())
            response.raise_for_status()
            return self._extract_list(response.json())

    def normalize(self, row: Dict[str, Any], fallback_id: str) -> Dict[str, Any]:
        return {
            "external_id": _pick(row, _ID_FIELDS, self.id_field) or fallback_id,
            "title": _pick(row, _TITLE_FIELDS, self.title_field),
            "description": _pick(row, _DESCRIPTION_FIELDS, self.description_field),
            "severity": _pick(row, _SEVERITY_FIELDS, self.severity_field),
            "source": _pick(row, _SOURCE_FIELDS, None),
            "data": row,
        }
