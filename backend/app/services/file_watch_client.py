"""Polls a local/mounted folder (e.g. an SMB share mounted into the
container) for CSV or JSON alert exports dropped there by an external system.

Reads incrementally: for line-oriented formats (CSV, NDJSON) each file has a
persisted byte-offset bookmark (EventSource.file_offsets), so a poll only
reads the bytes appended since the last read — not the whole file every
time. This matters once a watched file reaches real-world log sizes (hundreds
of MB to multi-GB): re-parsing it from scratch on every poll would re-read
gigabytes of already-seen data, balloon memory (the old implementation
materialized the entire file as a list of dicts up front), and — because the
old per-row identity was derived from the file's mtime — re-create a
duplicate alert for every already-ingested row each time the file was
appended to and its mtime changed.

A whole-file JSON array (`[...]`) can't be resumed by byte offset without a
real streaming JSON parser, so that one format is still read in full each
time its mtime changes — large exports should prefer NDJSON or CSV.
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

_BOM = b"\xef\xbb\xbf"

# Read/decode in chunks rather than the whole appended range at once, so a
# single poll of a multi-GB file can't spike memory even when a lot of new
# data has accumulated since the last read.
_READ_CHUNK_BYTES = 4 * 1024 * 1024


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

    # ── Incremental line-oriented reading (CSV, NDJSON) ─────────────────────

    def _iter_new_lines(self, path: Path, start_offset: int):
        """Yields (line_start_offset, line_bytes) for every complete line
        found after start_offset, reading the file in bounded chunks rather
        than all at once. A trailing line with no terminating newline (still
        being written by whatever produces the file) is left unread — it
        will be picked up whole on a later poll once it's complete.
        """
        with path.open("rb") as f:
            f.seek(start_offset)
            pos = start_offset
            carry = b""
            while True:
                chunk = f.read(_READ_CHUNK_BYTES)
                if not chunk:
                    break
                data = carry + chunk
                lines = data.split(b"\n")
                carry = lines.pop()  # last piece has no \n yet — may be partial
                for line in lines:
                    yield pos, line
                    pos += len(line) + 1
                # carry's start offset is implicitly `pos` for the next round

    def _read_incremental(self, path: Path, state: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        offset = int(state.get("offset") or 0)
        fieldnames = state.get("fieldnames")
        size = path.stat().st_size

        if size < offset:
            # File was truncated or replaced with something smaller — start over.
            offset = 0
            fieldnames = None

        if offset == 0 and fieldnames is None:
            # Peel off a UTF-8 BOM once, at the very start of the file, without
            # decoding it as part of line 0.
            with path.open("rb") as f:
                head = f.read(len(_BOM))
            if head == _BOM:
                offset = len(_BOM)

        records: List[Dict[str, Any]] = []
        last_line_end = offset
        lines_iter = self._iter_new_lines(path, offset)

        if self.file_format == "csv" and fieldnames is None:
            try:
                header_offset, header_line = next(lines_iter)
            except StopIteration:
                return [], {"offset": offset, "fieldnames": None}
            fieldnames = next(csv.reader([header_line.decode("utf-8", errors="replace")], delimiter=self.csv_delimiter), [])
            last_line_end = header_offset + len(header_line) + 1

        for line_start, raw_line in lines_iter:
            last_line_end = line_start + len(raw_line) + 1
            text_line = raw_line.decode("utf-8", errors="replace").strip("\r")
            if not text_line:
                continue
            try:
                if self.file_format == "csv":
                    values = next(csv.reader([text_line], delimiter=self.csv_delimiter))
                    row = dict(zip(fieldnames or [], values))
                else:  # NDJSON
                    row = json.loads(text_line)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to parse %s at offset %s: %s", path, line_start, exc)
                continue
            if not isinstance(row, dict):
                continue
            records.append({
                "_file": path.name,
                "_offset": line_start,
                "title": _pick(row, _TITLE_FIELDS),
                "description": _pick(row, _DESCRIPTION_FIELDS),
                "severity": _pick(row, _SEVERITY_FIELDS),
                "source": _pick(row, _SOURCE_FIELDS),
                "data": row,
            })

        return records, {"offset": last_line_end, "fieldnames": fieldnames}

    # ── Whole-array JSON fallback (can't be read incrementally) ─────────────

    def _looks_like_json_array(self, path: Path) -> bool:
        with path.open("r", encoding="utf-8-sig") as f:
            for ch in f.read(64):
                if ch.isspace():
                    continue
                return ch == "["
        return False

    def _read_json_array_whole(self, path: Path) -> List[Dict[str, Any]]:
        text = path.read_text(encoding="utf-8-sig").strip()
        if not text:
            return []
        data = json.loads(text)
        rows = data if isinstance(data, list) else [data]
        records = []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            records.append({
                "_file": path.name,
                "_offset": i,  # no byte offset available for a single JSON array — index is the best stable key
                "title": _pick(row, _TITLE_FIELDS),
                "description": _pick(row, _DESCRIPTION_FIELDS),
                "severity": _pick(row, _SEVERITY_FIELDS),
                "source": _pick(row, _SOURCE_FIELDS),
                "data": row,
            })
        return records

    # ── Entry point ──────────────────────────────────────────────────────────

    def _fetch_records_sync(
        self, file_offsets: Dict[str, Any]
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        folder = Path(self.folder_path)
        if not folder.is_dir():
            return [], file_offsets

        all_records: List[Dict[str, Any]] = []
        new_offsets: Dict[str, Any] = dict(file_offsets)

        for path in sorted(folder.glob(self.file_mask)):
            if not path.is_file():
                continue
            state = file_offsets.get(path.name) or {}
            stat = path.stat()
            mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()

            try:
                if self.file_format == "json" and self._looks_like_json_array(path):
                    if state.get("mtime") == mtime:
                        continue  # already read this exact version in full
                    records = self._read_json_array_whole(path)
                    new_offsets[path.name] = {"mode": "json_array", "mtime": mtime}
                else:
                    if state.get("mtime") == mtime and int(state.get("offset") or 0) >= stat.st_size:
                        continue  # nothing new since last read
                    records, updated_state = self._read_incremental(path, state)
                    updated_state["mtime"] = mtime
                    new_offsets[path.name] = updated_state
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to read %s: %s", path, exc)
                continue

            all_records.extend(records)

        return all_records, new_offsets

    async def fetch_records(self, file_offsets: Optional[Dict[str, Any]] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        return await asyncio.to_thread(self._fetch_records_sync, file_offsets or {})
