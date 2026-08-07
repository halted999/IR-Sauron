"""Polls a folder for CSV or JSON alert exports dropped there by an external
system. The folder can be either:

  - a local/mounted path (e.g. an SMB share mounted into the container by the
    host, or a bind-mounted directory), read via `pathlib`; or
  - a bare UNC network path (`\\\\server\\share\\...`), read directly over
    SMB2/3 using `smbprotocol` — no host-level mount required. Credentials
    come from the event source's `auth_username`/`auth_secret` fields (a
    plain "user" or "DOMAIN\\user" username is accepted; smbprotocol handles
    the domain split).

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
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

import smbclient
import smbclient.path

logger = logging.getLogger(__name__)

_SMB_CONNECT_TIMEOUT_SECONDS = 10
# Grant read+write+delete sharing on our own handle: the external system is
# typically still appending to the file while we poll it, and the default
# (read-only sharing) would make our open collide with its write handle.
_SMB_SHARE_ACCESS = "rwd"


def _is_unc_path(value: str) -> bool:
    stripped = value.strip()
    return stripped.startswith("\\\\") or stripped.startswith("//") or stripped.lower().startswith("smb://")


def _normalize_unc_path(value: str) -> str:
    """Canonicalise any of the network-path spellings users might reach for
    (\\\\server\\share\\..., //server/share/..., smb://server/share/...) into
    the backslash UNC form smbclient/smbprotocol expects. Idempotent for an
    already-canonical UNC path.
    """
    stripped = value.strip()
    if stripped.lower().startswith("smb://"):
        stripped = stripped[len("smb://"):]
    stripped = stripped.lstrip("\\/")
    return "\\\\" + stripped.replace("/", "\\")


def _unc_server(value: str) -> str:
    return value.strip().lstrip("\\/").split("\\")[0].split("/")[0]


class _SmbPath:
    """Minimal pathlib.Path-alike backed by a live SMB session, covering only
    the operations FileWatchClient needs. Lets the incremental-read logic
    below stay identical regardless of whether folder_path is a locally
    mounted directory or a bare UNC path reached directly over SMB.
    """

    def __init__(self, raw: str):
        self._raw = raw.rstrip("\\/") or raw

    def __str__(self) -> str:
        return self._raw

    @property
    def name(self) -> str:
        return self._raw.replace("/", "\\").rsplit("\\", 1)[-1]

    def exists(self) -> bool:
        return smbclient.path.exists(self._raw)

    def is_dir(self) -> bool:
        return smbclient.path.isdir(self._raw)

    def is_file(self) -> bool:
        return smbclient.path.isfile(self._raw)

    def glob(self, mask: str):
        for entry in smbclient.scandir(self._raw, search_pattern=mask or "*"):
            yield _SmbPath(entry.path)

    def stat(self):
        return smbclient.stat(self._raw)

    def open(self, mode: str = "rb", encoding: Optional[str] = None):
        return smbclient.open_file(self._raw, mode=mode, encoding=encoding, share_access=_SMB_SHARE_ACCESS)

    def read_text(self, encoding: str = "utf-8") -> str:
        with self.open("r", encoding=encoding) as f:
            return f.read()


_FilePath = Union[Path, _SmbPath]

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
    def __init__(
        self,
        folder_path: str,
        file_mask: str,
        file_format: str,
        csv_delimiter: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
        skip_backlog: bool = False,
    ):
        self.folder_path = folder_path
        self.file_mask = file_mask or "*"
        self.file_format = (file_format or "csv").lower()
        self.csv_delimiter = csv_delimiter or ","
        self.username = username
        self.password = password
        # When true, a file seen for the first time (no prior offset in
        # EventSource.file_offsets) is not read from byte 0 -- its current
        # contents are treated as pre-existing backlog, not new alerts. Only
        # bytes appended after this point are ingested. Useful for a
        # multi-GB export where the file already contains a large amount of
        # historical data and only future appends should raise alerts.
        self.skip_backlog = skip_backlog
        self.is_smb = _is_unc_path(folder_path)
        if self.is_smb:
            self.folder_path = _normalize_unc_path(folder_path)

    def _folder(self) -> _FilePath:
        return _SmbPath(self.folder_path) if self.is_smb else Path(self.folder_path)

    def _ensure_smb_session(self) -> None:
        # Many real-world shares (this one included) sit behind a DFS
        # namespace: \\mercury.ru\dkb$ is a referral to the real file server
        # (e.g. file04-dch.mercury.ru), resolved transparently inside
        # smbclient/smbprotocol. That resolution — and the secure-negotiate
        # validation round trip that comes with it — opens its own internal
        # connection and only picks up credentials from the process-wide
        # smbclient.ClientConfig singleton, not from the username/password
        # passed to register_session() below. Without this, the referral
        # connection goes in anonymous and fails with a confusing SPNEGO
        # error ("no username or password... credential cache did not
        # exist") that has nothing to do with the credentials actually being
        # wrong.
        smbclient.ClientConfig(
            username=self.username or None,
            password=self.password or None,
            auth_protocol="ntlm",
        )
        smbclient.register_session(
            _unc_server(self.folder_path),
            username=self.username or None,
            password=self.password or None,
            connection_timeout=_SMB_CONNECT_TIMEOUT_SECONDS,
            # The default "negotiate" tries Kerberos first via system GSSAPI,
            # which isn't installed in this image (no krb5 libs/realm config)
            # and fails in a way that aborts the whole handshake before NTLM
            # is even attempted. Force NTLM directly — it's what the
            # username/password we already collect are for.
            auth_protocol="ntlm",
        )

    def _test_connection_sync(self) -> Tuple[bool, str]:
        if self.is_smb:
            try:
                self._ensure_smb_session()
            except Exception as exc:  # noqa: BLE001
                return False, f"Не удалось подключиться по SMB к {_unc_server(self.folder_path)}: {exc}"

        folder = self._folder()
        try:
            if not folder.exists():
                return False, f"Папка не найдена: {self.folder_path}"
            if not folder.is_dir():
                return False, f"Указанный путь не является папкой: {self.folder_path}"
            matches = [p for p in folder.glob(self.file_mask) if p.is_file()]
        except Exception as exc:  # noqa: BLE001
            return False, f"Ошибка доступа к папке: {exc}"
        return True, f"Папка доступна, найдено файлов по маске «{self.file_mask}»: {len(matches)}"

    async def test_connection(self) -> Tuple[bool, str]:
        return await asyncio.to_thread(self._test_connection_sync)

    # ── Incremental line-oriented reading (CSV, NDJSON) ─────────────────────

    def _iter_new_lines(self, path: _FilePath, start_offset: int):
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

    def _read_incremental(self, path: _FilePath, state: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
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

    def _looks_like_json_array(self, path: _FilePath) -> bool:
        with path.open("r", encoding="utf-8-sig") as f:
            for ch in f.read(64):
                if ch.isspace():
                    continue
                return ch == "["
        return False

    def _read_json_array_whole(self, path: _FilePath) -> List[Dict[str, Any]]:
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

    def _seed_backlog_skip_state(self, path: _FilePath) -> Dict[str, Any]:
        """Build the offset state for a file seen for the first time when
        skip_backlog is on: jump straight to its current end, so nothing
        already sitting in the file is treated as new. For CSV, the header
        is still read (not skipped) so the fieldnames are known for whatever
        gets appended afterwards.
        """
        size = path.stat().st_size
        fieldnames = None
        if self.file_format == "csv":
            with path.open("rb") as f:
                head = f.read(len(_BOM))
            offset = len(_BOM) if head == _BOM else 0
            try:
                _, header_line = next(self._iter_new_lines(path, offset))
                fieldnames = next(
                    csv.reader([header_line.decode("utf-8", errors="replace")], delimiter=self.csv_delimiter), []
                )
            except StopIteration:
                pass
        return {"offset": size, "fieldnames": fieldnames}

    # ── Entry point ──────────────────────────────────────────────────────────

    def _fetch_records_sync(
        self, file_offsets: Dict[str, Any]
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        # Connection/auth failures raise here and propagate up to the caller
        # (sync_source), which records them as a sync error — unlike a folder
        # that simply doesn't exist (handled below), a share we can't even
        # reach is not something to silently report as "0 new alerts".
        if self.is_smb:
            self._ensure_smb_session()

        folder = self._folder()
        if not folder.is_dir():
            return [], file_offsets

        all_records: List[Dict[str, Any]] = []
        new_offsets: Dict[str, Any] = dict(file_offsets)

        for path in sorted(folder.glob(self.file_mask), key=lambda p: p.name):
            if not path.is_file():
                continue
            stat = path.stat()
            mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()

            if self.skip_backlog and path.name not in file_offsets and not (
                self.file_format == "json" and self._looks_like_json_array(path)
            ):
                try:
                    seeded = self._seed_backlog_skip_state(path)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Failed to seed backlog-skip offset for %s: %s", path, exc)
                    continue
                seeded["mtime"] = mtime
                new_offsets[path.name] = seeded
                continue

            state = file_offsets.get(path.name) or {}

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
