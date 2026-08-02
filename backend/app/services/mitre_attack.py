"""
MITRE ATT&CK tactic -> severity / Гриф (confidentiality grade) mapping.

Source: the Enterprise ATT&CK matrix, mitre-attack/attack-stix-data,
v19.1 (bundled as mitre_attack_data.json — technique ID -> tactic
shortnames, extracted once from the official STIX export; the full
53 MB STIX bundle is not vendored, only the technique->tactic index).

Approved methodology (documented for users on the Справка page):
grouping is by tactic (15 total) rather than by individual technique
(220+) — tractable to review and maintain, and every fact/link already
carries a free-text `mitre_tactic`/`mitre_technique` field to key off.
The HIGHEST-severity tactic observed drives the suggested level, never
the average — reaching Impact/Exfiltration/Credential Access once means
the incident is at least that serious, regardless of how many lower-
severity facts surround it.

Callers apply this as a one-way ratchet (see raise_severity/raise_grif):
raise the stored value if the implied level is higher, never lower it —
a human always remains free to lower it manually afterward.
"""
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from app.models import CaseSeverity

_DATA_PATH = Path(__file__).parent / "mitre_attack_data.json"
_data = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
TECHNIQUE_TACTICS: Dict[str, List[str]] = _data["technique_tactics"]
TECHNIQUE_NAMES: Dict[str, str] = _data["technique_names"]

# Tactic shortname -> display name (ATT&CK's own kill-chain order).
TACTIC_LABELS: Dict[str, str] = {
    "reconnaissance": "Reconnaissance",
    "resource-development": "Resource Development",
    "initial-access": "Initial Access",
    "execution": "Execution",
    "persistence": "Persistence",
    "privilege-escalation": "Privilege Escalation",
    "defense-impairment": "Defense Impairment",
    "stealth": "Stealth",
    "credential-access": "Credential Access",
    "discovery": "Discovery",
    "lateral-movement": "Lateral Movement",
    "collection": "Collection",
    "command-and-control": "Command and Control",
    "exfiltration": "Exfiltration",
    "impact": "Impact",
}
_NAME_TO_SHORTNAME = {name.lower(): short for short, name in TACTIC_LABELS.items()}

# Approved methodology — Критичность (severity, 5 levels; alerts + incidents).
TACTIC_SEVERITY: Dict[str, CaseSeverity] = {
    "reconnaissance": CaseSeverity.informational,
    "resource-development": CaseSeverity.informational,
    "initial-access": CaseSeverity.low,
    "discovery": CaseSeverity.low,
    "execution": CaseSeverity.medium,
    "persistence": CaseSeverity.medium,
    "stealth": CaseSeverity.medium,
    "privilege-escalation": CaseSeverity.high,
    "defense-impairment": CaseSeverity.high,
    "lateral-movement": CaseSeverity.high,
    "collection": CaseSeverity.high,
    "command-and-control": CaseSeverity.high,
    "credential-access": CaseSeverity.critical,
    "exfiltration": CaseSeverity.critical,
    "impact": CaseSeverity.critical,
}

# Approved methodology — Гриф (confidentiality grade, 4 levels; incidents only).
TACTIC_GRIF: Dict[str, str] = {
    "reconnaissance": "1",
    "resource-development": "1",
    "initial-access": "2",
    "discovery": "2",
    "execution": "3",
    "persistence": "3",
    "privilege-escalation": "3",
    "defense-impairment": "3",
    "stealth": "3",
    "lateral-movement": "3",
    "command-and-control": "3",
    "collection": "3",
    "credential-access": "4",
    "exfiltration": "4",
    "impact": "4",
}

_SEVERITY_RANK: Dict[CaseSeverity, int] = {
    CaseSeverity.informational: 0,
    CaseSeverity.low: 1,
    CaseSeverity.medium: 2,
    CaseSeverity.high: 3,
    CaseSeverity.critical: 4,
}

# A handful of cases were seeded with a descriptive Russian grade instead of
# the "1"-"4" the create form assigns (see DashboardPage.tsx's identical
# mapping on the frontend) — normalize those so the ratchet can compare them.
_GRIF_TEXT_TO_LEVEL: Dict[str, str] = {
    "Для служебного пользования": "1",
    "Секретно": "3",
    "Совершенно секретно": "4",
}

_TECHNIQUE_ID_RE = re.compile(r"\bT(\d{4})(\.(\d{3}))?\b", re.IGNORECASE)


def resolve_tactic_shortname(value: Optional[str]) -> Optional[str]:
    """Best-effort match of a free-text tactic value (name or shortname,
    as typed into the "Тактика" field on a fact) to a known ATT&CK tactic."""
    if not value:
        return None
    v = value.strip().lower()
    if v in TACTIC_LABELS:
        return v
    return _NAME_TO_SHORTNAME.get(v)


def tactics_from_text(value: Optional[str]) -> List[str]:
    """Resolve every MITRE technique ID mentioned in free text (e.g. the
    "Техника" field, "T1566", or a sentence containing one) to the tactic
    shortnames those techniques belong to."""
    if not value:
        return []
    tactics: List[str] = []
    for match in _TECHNIQUE_ID_RE.finditer(value):
        tech_id = f"T{match.group(1)}" + (f".{match.group(3)}" if match.group(3) else "")
        tactics.extend(TECHNIQUE_TACTICS.get(tech_id.upper(), []))
    return tactics


def tactics_for_fact(mitre_tactic: Optional[str], mitre_technique: Optional[str]) -> List[str]:
    """All tactic shortnames implied by one fact/link's MITRE fields."""
    tactics: List[str] = []
    direct = resolve_tactic_shortname(mitre_tactic)
    if direct:
        tactics.append(direct)
    tactics.extend(tactics_from_text(mitre_technique))
    tactics.extend(tactics_from_text(mitre_tactic))  # in case a technique ID was typed into the tactic field
    return list(dict.fromkeys(tactics))


_ECS_TACTIC_PATHS = ["threat.tactic.name"]
_ECS_TECHNIQUE_PATHS = ["threat.technique.id", "threat.technique.name"]


def _get_ecs_path(doc: Dict[str, Any], dotted_path: str) -> Any:
    node: Any = doc
    for part in dotted_path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _ecs_strings(doc: Dict[str, Any], paths: List[str]) -> List[str]:
    values: List[str] = []
    for path in paths:
        node = _get_ecs_path(doc, path)
        if node is None:
            continue
        items = node if isinstance(node, list) else [node]
        values.extend(str(item) for item in items if item not in (None, ""))
    return values


def detect_alert_tactics(
    title: str, description: Optional[str], raw_event: Optional[Dict[str, Any]]
) -> List[str]:
    """Best-effort detection of MITRE tactics mentioned on an alert. Alerts
    have no structured MITRE field (only facts on the incident timeline do),
    so this reads the real ECS `threat.tactic.name` / `threat.technique.id`
    fields when the alert came from Elastic, and falls back to scanning the
    free text for tactic names / technique IDs otherwise (TheHive, file
    watch, email, JSON API sources).
    """
    tactics: List[str] = []
    if raw_event:
        for name in _ecs_strings(raw_event, _ECS_TACTIC_PATHS):
            resolved = resolve_tactic_shortname(name)
            if resolved:
                tactics.append(resolved)
        for tech in _ecs_strings(raw_event, _ECS_TECHNIQUE_PATHS):
            tactics.extend(tactics_from_text(tech))

    for text in (title, description):
        tactics.extend(tactics_from_text(text))
        if text:
            lowered = text.lower()
            for name, shortname in _NAME_TO_SHORTNAME.items():
                if re.search(rf"\b{re.escape(name)}\b", lowered):
                    tactics.append(shortname)

    return list(dict.fromkeys(tactics))


def highest_severity(tactics: Iterable[str]) -> Optional[CaseSeverity]:
    candidates = [TACTIC_SEVERITY[t] for t in tactics if t in TACTIC_SEVERITY]
    if not candidates:
        return None
    return max(candidates, key=lambda s: _SEVERITY_RANK[s])


def highest_grif(tactics: Iterable[str]) -> Optional[str]:
    candidates = [TACTIC_GRIF[t] for t in tactics if t in TACTIC_GRIF]
    return max(candidates) if candidates else None  # '1'..'4' compares correctly as strings


def normalize_grif_level(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if value in ("1", "2", "3", "4"):
        return value
    return _GRIF_TEXT_TO_LEVEL.get(value)


def raise_severity(current: CaseSeverity, candidate: Optional[CaseSeverity]) -> CaseSeverity:
    """One-way ratchet: raise, never lower."""
    if candidate is None:
        return current
    return candidate if _SEVERITY_RANK[candidate] > _SEVERITY_RANK[current] else current


def raise_grif(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
    """One-way ratchet: raise, never lower. An unrecognized current value
    (legacy free text, see _GRIF_TEXT_TO_LEVEL) can't be safely compared, so
    a normalized candidate replaces it outright rather than being skipped."""
    if candidate is None:
        return current
    normalized_current = normalize_grif_level(current)
    if normalized_current is None:
        return candidate
    return candidate if candidate > normalized_current else current


def raised_alert_severity(
    title: str, description: Optional[str], raw_event: Optional[Dict[str, Any]], current: CaseSeverity,
) -> CaseSeverity:
    """Detect MITRE tactics mentioned on an alert (ECS fields or free text)
    and raise its severity if a higher level is implied. One-way ratchet —
    never lowers what the source/analyst already set."""
    tactics = detect_alert_tactics(title, description, raw_event)
    return raise_severity(current, highest_severity(tactics))
