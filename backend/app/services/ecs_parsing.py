"""
Extraction of IPs / URLs / accounts / files from a raw Elastic Common Schema
(ECS) event document (the `_source` of an Elastic hit, stored verbatim on
Alert.raw_event). Unlike app.services.alert_stats_parsing (which regexes
free text for sources with no structured data, e.g. TheHive), this reads
well-known ECS field paths directly — confirmed against the project's live
`checkpoint-*` index mapping, which populates: source.ip / destination.ip /
related.ip, url.original, user / source.user.name / destination.user.name /
related.user, file.name / file.hash.md5 / related.hash.
"""
import re
from typing import Any, Dict, List, Tuple

# Checked in order; values from every matching path are combined and de-duped
# rather than stopping at the first hit, since different event types populate
# different subsets of these fields.
_ECS_IP_PATHS = ["related.ip", "source.ip", "destination.ip"]
_ECS_URL_PATHS = ["url.full", "url.original", "url.domain"]
_ECS_ACCOUNT_PATHS = ["related.user", "user.name", "source.user.name", "destination.user.name", "user"]
_ECS_FILE_PATHS = ["file.name", "file.path", "file.hash.sha256", "file.hash.md5", "related.hash"]


def _get_path(doc: Dict[str, Any], dotted_path: str) -> Any:
    node: Any = doc
    for part in dotted_path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _as_str_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        name = value.get("name")
        return [str(name)] if isinstance(name, str) and name else []
    if isinstance(value, list):
        result: List[str] = []
        for v in value:
            result.extend(_as_str_list(v))
        return result
    return [str(value)] if value != "" else []


def _collect(doc: Dict[str, Any], paths: List[str]) -> List[str]:
    values: List[str] = []
    for path in paths:
        values.extend(_as_str_list(_get_path(doc, path)))
    return list(dict.fromkeys(values))


def extract_ecs_ips(doc: Dict[str, Any]) -> List[str]:
    return _collect(doc, _ECS_IP_PATHS)


def extract_ecs_urls(doc: Dict[str, Any]) -> List[str]:
    return _collect(doc, _ECS_URL_PATHS)


def extract_ecs_accounts(doc: Dict[str, Any]) -> List[str]:
    return _collect(doc, _ECS_ACCOUNT_PATHS)


def extract_ecs_files(doc: Dict[str, Any]) -> List[str]:
    return _collect(doc, _ECS_FILE_PATHS)


def _flatten(obj: Any, prefix: str = "") -> List[Tuple[str, str]]:
    if isinstance(obj, dict):
        rows: List[Tuple[str, str]] = []
        for key, value in obj.items():
            rows.extend(_flatten(value, f"{prefix}.{key}" if prefix else str(key)))
        return rows

    if isinstance(obj, list):
        if not obj:
            return [(prefix, "—")]
        if any(isinstance(item, (dict, list)) for item in obj):
            rows = []
            for index, item in enumerate(obj):
                rows.extend(_flatten(item, f"{prefix}[{index}]"))
            return rows
        return [(prefix, ", ".join(str(item) for item in obj if item is not None))]

    if obj is None:
        return [(prefix, "—")]

    return [(prefix, str(obj))]


_ARRAY_INDEX_RE = re.compile(r"\[\d+\]")

# Lower priority number = shown higher in the table. Matched against the
# lowercased flattened path and its last segment (basename) — kept loose
# since alerts now come from 17 different index types (AD, Citrix, DNS,
# MFA, ...), not just Checkpoint, each with their own field naming.
_TIMESTAMP_BASENAMES = {
    "@timestamp", "timestamp", "time", "index_time", "last_hit_time",
    "policy_date", "lastupdatetime", "browse_time", "date", "created",
    "start", "end", "ingested",
}
_IP_PATHS = {"source.ip", "destination.ip", "related.ip", "source.nat.ip", "destination.nat.ip"}
_IP_BASENAMES = {"ip", "src", "dst", "src_ip", "dst_ip", "srcip", "dstip", "source_ip", "destination_ip"}


def _field_priority(path: str) -> int:
    lower = path.lower()
    basename = _ARRAY_INDEX_RE.sub("", lower).rsplit(".", 1)[-1]

    if lower == "log.level":
        return -1
    if basename in _TIMESTAMP_BASENAMES or basename.endswith("_time") or basename.endswith("_date"):
        return 0
    if lower in _IP_PATHS or basename in _IP_BASENAMES:
        return 1
    if "user" in lower or "account" in basename:
        return 2
    if "file" in lower or "hash" in lower:
        return 3
    if "command" in lower or lower.startswith("process.") or basename in {"cmd", "process"}:
        return 4
    return 5


def flatten_ecs_doc(obj: Any) -> List[Tuple[str, str]]:
    """
    Flatten a nested ECS document into (dotted field path, value) rows for
    display as a table. Objects recurse into "parent.child" paths; a list of
    plain values is joined into one row, a list of objects/lists gets one row
    per "field[index]". Rows are then reordered (stable) so timestamps,
    source/destination IPs, accounts, files and executed commands surface at
    the top — the fields analysts look for first — with everything else
    following in its original document order.
    """
    rows = _flatten(obj)
    return sorted(rows, key=lambda row: _field_priority(row[0]))
