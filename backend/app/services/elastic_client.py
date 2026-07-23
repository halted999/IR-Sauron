import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

DEFAULT_INDEX_PATTERN = "*"


class ElasticClient:
    def __init__(
        self,
        base_url: str,
        auth_username: Optional[str],
        auth_secret: Optional[str],
        verify_ssl: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth_username = auth_username
        self.auth_secret = auth_secret
        self.verify_ssl = verify_ssl

    def _client_kwargs(self) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {"verify": self.verify_ssl, "timeout": 15.0}
        if self.auth_username:
            kwargs["auth"] = (self.auth_username, self.auth_secret or "")
        elif self.auth_secret:
            kwargs["headers"] = {"Authorization": f"ApiKey {self.auth_secret}"}
        return kwargs

    async def test_connection(self) -> Tuple[bool, str]:
        try:
            async with httpx.AsyncClient(**self._client_kwargs()) as client:
                response = await client.get(f"{self.base_url}/")
                response.raise_for_status()
                data = response.json()
                cluster_name = data.get("cluster_name", "unknown")
                version = data.get("version", {}).get("number", "unknown")
                return True, f"Подключено к кластеру «{cluster_name}» (Elasticsearch {version})"
        except httpx.HTTPStatusError as exc:
            return False, f"HTTP {exc.response.status_code}: {exc.response.text[:300]}"
        except httpx.HTTPError as exc:
            return False, f"Ошибка соединения: {exc}"

    async def fetch_alerts(
        self,
        index_pattern: Optional[str],
        query: Optional[Dict[str, Any]],
        since: Optional[datetime],
        size: int = 100,
    ) -> List[Dict[str, Any]]:
        index = index_pattern or DEFAULT_INDEX_PATTERN
        body: Dict[str, Any] = query or {"query": {"match_all": {}}}
        body = dict(body)
        if since is not None:
            time_filter = {"range": {"@timestamp": {"gt": since.astimezone(timezone.utc).isoformat()}}}
            base_query = body.get("query", {"match_all": {}})
            body["query"] = {"bool": {"must": [base_query], "filter": [time_filter]}}
        body["sort"] = body.get("sort", [{"@timestamp": "asc"}])
        body["size"] = size

        async with httpx.AsyncClient(**self._client_kwargs()) as client:
            response = await client.post(f"{self.base_url}/{index}/_search", json=body)
            response.raise_for_status()
            data = response.json()
            return data.get("hits", {}).get("hits", [])
