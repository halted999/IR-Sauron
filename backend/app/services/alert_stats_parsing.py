"""
Best-effort extraction of URLs / IP addresses / threat categories from alert
text (title + description).

The Alert model has no dedicated columns for these — alerts are ingested from
heterogeneous sources (TheHive free-text notes, Elastic ECS docs dumped as
JSON into `description`) and there is no reliable structured field to key
off. This module parses whatever text is available at query time. It is a
heuristic, not a guarantee of accuracy.
"""
import ipaddress
import re
from typing import Any, Dict, List, Optional

from app.services.ecs_parsing import extract_ecs_accounts, extract_ecs_files, extract_ecs_ips, extract_ecs_urls

_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}"
    r"(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\b"
)
_URL_RE = re.compile(r"https?://[^\s\"'<>\\]+")
_URL_TRAILING_PUNCT = ".,;:)]}”’\r\n"

# Best-effort only — free text has no reliable markup for "this is a username"
# or "this is a filename". Used for sources with no structured data (TheHive);
# Elastic alerts use the real ECS fields instead, see app.services.ecs_parsing.
_ACCOUNT_RE = re.compile(
    r"\b(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"  # email
    r"|[A-Za-z][\w.-]{1,63}\\[A-Za-z][\w.-]{1,63})\b"  # DOMAIN\user
)
_FILE_RE = re.compile(
    r"\b[\w][\w\-. ]{0,80}\.(?:exe|dll|ps1|bat|cmd|vbs|js|jar|msi|scr|lnk|iso|"
    r"zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|pdf|rtf|py|sh)\b",
    re.IGNORECASE,
)


def extract_ips(text: Optional[str]) -> List[str]:
    if not text:
        return []
    seen: List[str] = []
    for match in _IPV4_RE.findall(text):
        if match not in seen:
            seen.append(match)
    return seen


def is_internal_ip(ip: str) -> bool:
    """RFC1918 (and other non-globally-routable) ranges count as internal."""
    try:
        return not ipaddress.ip_address(ip).is_global
    except ValueError:
        return False


def extract_urls(text: Optional[str]) -> List[str]:
    if not text:
        return []
    seen: List[str] = []
    for match in _URL_RE.findall(text):
        cleaned = match.rstrip(_URL_TRAILING_PUNCT)
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return seen


def extract_accounts(*texts: Optional[str]) -> List[str]:
    seen: List[str] = []
    for text in texts:
        if not text:
            continue
        for match in _ACCOUNT_RE.findall(text):
            if match not in seen:
                seen.append(match)
    return seen


def extract_files(*texts: Optional[str]) -> List[str]:
    seen: List[str] = []
    for text in texts:
        if not text:
            continue
        for m in _FILE_RE.finditer(text):
            value = m.group(0)
            if value not in seen:
                seen.append(value)
    return seen


# Ordered (category label, keywords) — first match wins. Keywords are matched
# case-insensitively against the alert title (falls back to description).
_THREAT_CATEGORIES = [
    ("Вредоносное ПО", [
        "anti-virus", "antivirus", "malware", "вредонос", "вирус", "троян",
        "trojan", "ransomware", "шифровальщик",
    ]),
    ("Command & Control", [
        "c2-сервер", "c2 server", "command and control", "command & control",
        "ботнет", "botnet", "c2",
    ]),
    ("Эксплуатация уязвимостей", [
        "ips", "rce", "remote code execution", "exploit", "эксплойт",
        "уязвим", "vulnerability", "cve-",
    ]),
    ("Подозрительная почта", [
        "smtp", "mta", "phishing", "фишинг", "почт", "email",
    ]),
    ("Аномалии доступа", [
        "geolocation", "геолокац", "вход в систему", "login", "logon",
        "brute force", "перебор паролей", "unusual", "необычн",
    ]),
    ("Утечка данных", [
        "exfiltration", "утечка", "data leak", "dlp",
    ]),
    ("Отказ в обслуживании", [
        "ddos", "denial of service", "отказ в обслуживании",
    ]),
]


def classify_threat_type(title: str, description: Optional[str] = None) -> str:
    haystacks = [title or ""]
    if description:
        haystacks.append(description[:2000])
    combined = " ".join(haystacks).lower()
    for label, keywords in _THREAT_CATEGORIES:
        if any(keyword in combined for keyword in keywords):
            return label
    return "Прочее"


# ─── Source dispatch ────────────────────────────────────────────────────────
# Single place deciding "ECS fields if we have the raw event, regex over free
# text otherwise" — used by both the alert card (schemas.AlertResponse) and
# the statistics endpoint, so the two stay consistent for the same alert.

def resolve_urls(title: str, description: Optional[str], raw_event: Optional[Dict[str, Any]]) -> List[str]:
    if raw_event:
        return extract_ecs_urls(raw_event)
    return list(dict.fromkeys(extract_urls(title) + extract_urls(description)))


def resolve_ips(title: str, description: Optional[str], raw_event: Optional[Dict[str, Any]]) -> List[str]:
    if raw_event:
        return extract_ecs_ips(raw_event)
    return list(dict.fromkeys(extract_ips(title) + extract_ips(description)))


def resolve_accounts(title: str, description: Optional[str], raw_event: Optional[Dict[str, Any]]) -> List[str]:
    if raw_event:
        return extract_ecs_accounts(raw_event)
    return extract_accounts(title, description)


def resolve_files(title: str, description: Optional[str], raw_event: Optional[Dict[str, Any]]) -> List[str]:
    if raw_event:
        return extract_ecs_files(raw_event)
    return extract_files(title, description)
