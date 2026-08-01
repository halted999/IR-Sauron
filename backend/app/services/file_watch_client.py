"""Polls a local/mounted folder (e.g. an SMB share mounted into the
container) for CSV or JSON alert exports dropped there by an external system.
"""
import asyncio
import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_TITLE_FIELDS = ["title", "summary", "message", "alert", "name", "rule", "заголовок"]
_DESCRIPTION_FIELDS = ["description", "details", "comment", "body", "описание"]
_SEVERITY_FIELDS = ["severity", "priority", "level", "критичность"]
_SOURCE_FIELDS = ["source", "sensor", "system", "host", "источник"]


def _pick(row: Dict[str, Any], candidates: List[str]) -> Optional[str]:
    lower = {k.lower().strip(): v for k, v in row.items() if isinstance(k, str)}
    for name in candidates:
        value = lower.get(name)
        if value not in (None, ""):
            return str(value)
    return None


class FileWatchClient:
    def __init__(self, folder_path: str, file_mask: str, file_format: str, csv_delimiter: str):
        self.folder_path = folder_path
        self.file_mask = file_mask or "*"
        self.file_format = (file_format or "csv").lower()
        self.csv_delimiter = csv_delimiter or ","

    def _test_connection_sync(self) -> Tuple[bool, str]:
        folder = Path(self.folder_path)
        if not folder.exists():
            return False, f"Папка не найдена: {self.folder_path}"
        if not folder.is_dir():
            return False, f"Указанный путь не является папкой: {self.folder_path}"
        try:
            matches = [p for p in folder.glob(self.file_mask) if p.is_file()]
        except Exception as exc:  # noqa: BLE001
            return False, f"Некорректная маска имени файла: {exc}"
        return True, f"Папка доступна, найдено файлов по маске «{self.file_mask}»: {len(matches)}"

    async def test_connection(self) -> Tuple[bool, str]:
        return await asyncio.to_thread(self._test_connection_sync)

    def _read_csv(self, path: Path) -> List[Dict[str, Any]]:
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, delimiter=self.csv_delimiter)
            return [dict(row) for row in reader]

    def _read_json(self, path: Path) -> List[Dict[str, Any]]:
        text = path.read_text(encoding="utf-8-sig").strip()
        if not text:
            return []
        if text[0] == "[":
            data = json.loads(text)
            return data if isinstance(data, list) else [data]
        # NDJSON — one JSON object per line
        records = []
        for line in text.splitlines():
            line = line.strip()
            if line:
                records.append(json.loads(line))
        return records

    def _fetch_records_sync(self, since: datetime) -> List[Dict[str, Any]]:
        folder = Path(self.folder_path)
        if not folder.is_dir():
            return []
        results: List[Dict[str, Any]] = []
        for path in sorted(folder.glob(self.file_mask)):
            if not path.is_file():
                continue
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            if mtime <= since:
                continue
            try:
                rows = self._read_csv(path) if self.file_format == "csv" else self._read_json(path)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to parse %s: %s", path, exc)
                continue
            for i, row in enumerate(rows):
                if not isinstance(row, dict):
                    continue
                results.append({
                    "_file": path.name,
                    "_row": i,
                    "_mtime": mtime.isoformat(),
                    "title": _pick(row, _TITLE_FIELDS),
                    "description": _pick(row, _DESCRIPTION_FIELDS),
                    "severity": _pick(row, _SEVERITY_FIELDS),
                    "source": _pick(row, _SOURCE_FIELDS),
                    "data": row,
                })
        return results

    async def fetch_records(self, since: datetime) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._fetch_records_sync, since)
