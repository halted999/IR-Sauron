import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)


class TheHiveClient:
    def __init__(self, base_url: str, api_key: Optional[str], verify_ssl: bool = True) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.verify_ssl = verify_ssl

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def test_connection(self) -> Tuple[bool, str]:
        try:
            async with httpx.AsyncClient(verify=self.verify_ssl, timeout=15.0) as client:
                response = await client.get(f"{self.base_url}/api/v1/user/current", headers=self._headers())
                response.raise_for_status()
                data = response.json()
                login = data.get("login") or data.get("name") or "unknown"
                return True, f"Подключено к TheHive как «{login}»"
        except httpx.HTTPStatusError as exc:
            return False, f"HTTP {exc.response.status_code}: {exc.response.text[:300]}"
        except httpx.HTTPError as exc:
            return False, f"Ошибка соединения: {exc}"

    async def fetch_alerts(
        self,
        since: Optional[datetime],
        size: int = 100,
    ) -> List[Dict[str, Any]]:
        # TheHive's Query DSL nests the field/value inside the operator, e.g.
        # {"_gt": {"_field": "date", "_value": <epoch_ms>}} — NOT {"_field": ..., "_gt": ...}.
        query: List[Dict[str, Any]] = [{"_name": "listAlert"}]
        if since is not None:
            since_ms = int(since.timestamp() * 1000)
            query.append({"_name": "filter", "_gt": {"_field": "date", "_value": since_ms}})
        query.append({"_name": "sort", "_fields": [{"date": "asc"}]})
        # "extraData" is a required field on the page step (Set[String] server-side, empty is fine).
        query.append({"_name": "page", "from": 0, "to": size, "extraData": []})

        body = {"query": query}

        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=15.0) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/query",
                params={"name": "alerts"},
                headers=self._headers(),
                json=body,
            )
            response.raise_for_status()
            return response.json()
