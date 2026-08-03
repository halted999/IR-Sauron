"""Generates and clears synthetic demo data (cases/alerts/event sources/audit
log) for showcasing the platform without touching real IR work — driven by
the "Демо-режим" admin panel section. See app.services.mitre_attack for the
tactic/technique vocabulary reused here so seeded data resolves the same way
real ingested data would (severity ratchet, tactic detection).
"""
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Alert, AlertStatus, AuditLog, Branch, BranchStatus, Case, CaseSeverity, CaseStatus,
    ConfidenceLevel, Event, EventSource, EventSourceType, EventType, User,
)
from app.services.mitre_attack import TACTIC_SEVERITY, TECHNIQUE_TACTICS

# ─── Technique catalog ──────────────────────────────────────────────────────
# Real Enterprise ATT&CK technique IDs spanning Initial Access through
# Impact, each with a short realistic incident-scenario template. Verified
# against the bundled mitre_attack_data.json (TECHNIQUE_TACTICS) so the
# existing tactic-resolution logic organically recognizes seeded data.

_TECHNIQUES: List[Dict[str, str]] = [
    {"id": "T1566", "name": "Phishing", "scenario": "Фишинговое письмо с вредоносным вложением"},
    {"id": "T1195", "name": "Supply Chain Compromise", "scenario": "Компрометация через обновление стороннего поставщика"},
    {"id": "T1078", "name": "Valid Accounts", "scenario": "Использование скомпрометированной учётной записи"},
    {"id": "T1059", "name": "Command and Scripting Interpreter", "scenario": "Подозрительное выполнение PowerShell-скрипта"},
    {"id": "T1204", "name": "User Execution", "scenario": "Пользователь запустил вредоносный файл из письма"},
    {"id": "T1053", "name": "Scheduled Task/Job", "scenario": "Создана подозрительная запланированная задача"},
    {"id": "T1055", "name": "Process Injection", "scenario": "Обнаружена инъекция кода в легитимный процесс"},
    {"id": "T1112", "name": "Modify Registry", "scenario": "Изменение реестра для закрепления в системе"},
    {"id": "T1027", "name": "Obfuscated Files or Information", "scenario": "Обнаружен обфусцированный/упакованный payload"},
    {"id": "T1003", "name": "OS Credential Dumping", "scenario": "Попытка дампа учётных данных из LSASS"},
    {"id": "T1110", "name": "Brute Force", "scenario": "Множественные неудачные попытки входа (перебор пароля)"},
    {"id": "T1082", "name": "System Information Discovery", "scenario": "Разведывательные команды сбора информации о системе"},
    {"id": "T1021", "name": "Remote Services", "scenario": "Латеральное перемещение через RDP/SMB"},
    {"id": "T1005", "name": "Data from Local System", "scenario": "Сбор данных с локальной системы перед эксфильтрацией"},
    {"id": "T1071", "name": "Application Layer Protocol", "scenario": "Периодические HTTPS-запросы к внешнему C2-серверу"},
    {"id": "T1105", "name": "Ingress Tool Transfer", "scenario": "Загрузка стороннего инструмента на скомпрометированный хост"},
    {"id": "T1041", "name": "Exfiltration Over C2 Channel", "scenario": "Признаки эксфильтрации данных через канал C2"},
    {"id": "T1486", "name": "Data Encrypted for Impact", "scenario": "Обнаружено шифрование файлов (программа-вымогатель)"},
    {"id": "T1490", "name": "Inhibit System Recovery", "scenario": "Удаление теневых копий и точек восстановления"},
]

_HOSTNAMES = [
    "WKS-", "SRV-", "DC-", "FS-", "LT-", "APP-", "DB-", "WEB-",
]
_HOST_SUFFIXES = ["FIN", "HR", "IT", "SALES", "OPS", "DEV", "MSK", "SPB"]

_STATUS_WEIGHTS: List[Tuple[AlertStatus, float]] = [
    (AlertStatus.new, 0.4),
    (AlertStatus.triaged, 0.3),
    (AlertStatus.dismissed, 0.2),
    (AlertStatus.archived, 0.1),
]

_AUDIT_ACTIONS = [
    ("update", "case"), ("assign", "alert"), ("archive", "case"),
    ("add_participant", "case_participant"), ("update", "settings"),
    ("create", "comment"), ("update", "user"),
]


def _primary_tactic(technique_id: str) -> str:
    tactics = TECHNIQUE_TACTICS.get(technique_id, ["execution"])
    return tactics[0]


def _hostname(rng: random.Random) -> str:
    return f"{rng.choice(_HOSTNAMES)}{rng.choice(_HOST_SUFFIXES)}-{rng.randint(1, 99):02d}"


def _jittered_time(base: datetime, rng: random.Random, max_hours: int = 6) -> datetime:
    return base + timedelta(
        hours=rng.uniform(-max_hours, max_hours), minutes=rng.uniform(-59, 59)
    )


async def seed_demo_data(db: AsyncSession, created_by: uuid.UUID | None) -> Tuple[int, int]:
    """Creates 80 demo incidents (round-robin across 19 MITRE techniques,
    each with a main Branch + one Event carrying mitre_tactic/technique) and
    500 demo alerts: 320 attached to those incidents (4 each), 180
    unattached, all spread over the last ~60 days so timelines/statistics
    look organic rather than a single spike."""
    rng = random.Random()
    now = datetime.now(timezone.utc)
    cases_created = 0
    alerts_created = 0

    for i in range(80):
        technique = _TECHNIQUES[i % len(_TECHNIQUES)]
        tactic = _primary_tactic(technique["id"])
        severity = TACTIC_SEVERITY.get(tactic, CaseSeverity.medium)
        host = _hostname(rng)
        created_at = now - timedelta(days=rng.uniform(0, 60), hours=rng.uniform(0, 23))

        case = Case(
            id=uuid.uuid4(),
            title=f"[Демо] {technique['scenario']} — {host}",
            status=rng.choice([CaseStatus.open, CaseStatus.in_progress, CaseStatus.confirmed]),
            severity=severity,
            ir_lead_id=created_by,
            executive_summary=(
                f"Инцидент связан с техникой MITRE ATT&CK {technique['id']} "
                f"({technique['name']}). {technique['scenario']} на хосте {host}."
            ),
            created_at=created_at,
            updated_at=created_at,
        )
        db.add(case)
        await db.flush()

        branch = Branch(
            id=uuid.uuid4(),
            case_id=case.id,
            name="Main Timeline",
            is_main=True,
            status=BranchStatus.confirmed,
            created_by=created_by,
            created_at=created_at,
            updated_at=created_at,
        )
        db.add(branch)
        await db.flush()

        db.add(Event(
            id=uuid.uuid4(),
            branch_id=branch.id,
            event_ts=created_at,
            event_type=EventType.detection,
            title=f"Обнаружена активность {technique['id']}: {technique['scenario']}",
            description=f"Хост: {host}. Техника: {technique['id']} ({technique['name']}).",
            confidence_level=ConfidenceLevel.confirmed,
            mitre_tactic=tactic,
            mitre_technique=technique["id"],
            sort_order=0,
            created_by=created_by,
            created_at=created_at,
            updated_at=created_at,
        ))
        cases_created += 1

        for _ in range(4):
            alert_ts = _jittered_time(created_at, rng)
            db.add(Alert(
                id=uuid.uuid4(),
                title=f"{technique['scenario']} — {host}",
                description=(
                    f"Сработало обнаружение по технике MITRE {technique['id']} "
                    f"({technique['name']}) на хосте {host}."
                ),
                severity=severity,
                source="Demo",
                status=AlertStatus.escalated,
                case_id=case.id,
                tags=[],
                created_at=alert_ts,
                updated_at=alert_ts,
            ))
            alerts_created += 1

    for _ in range(180):
        technique = rng.choice(_TECHNIQUES)
        tactic = _primary_tactic(technique["id"])
        severity = TACTIC_SEVERITY.get(tactic, CaseSeverity.medium)
        host = _hostname(rng)
        alert_ts = now - timedelta(days=rng.uniform(0, 60), hours=rng.uniform(0, 23))
        status = rng.choices(
            [s for s, _ in _STATUS_WEIGHTS], weights=[w for _, w in _STATUS_WEIGHTS], k=1
        )[0]
        db.add(Alert(
            id=uuid.uuid4(),
            title=f"{technique['scenario']} — {host}",
            description=(
                f"Возможная активность по технике MITRE {technique['id']} "
                f"({technique['name']}) на хосте {host}. Требует проверки."
            ),
            severity=severity,
            source="Demo",
            status=status,
            case_id=None,
            tags=[],
            created_at=alert_ts,
            updated_at=alert_ts,
        ))
        alerts_created += 1

    await db.flush()
    return cases_created, alerts_created


async def seed_demo_event_sources(db: AsyncSession, created_by: uuid.UUID | None) -> int:
    """One disabled placeholder EventSource per source type, so the admin
    event-sources list looks populated without the background scheduler
    trying (and failing) to poll a fake URL."""
    labels = {
        EventSourceType.elastic: "Elastic (демо)",
        EventSourceType.thehive: "TheHive (демо)",
        EventSourceType.file_watch: "Файловый watch (демо)",
        EventSourceType.email: "Email-опрос (демо)",
        EventSourceType.json_api: "JSON API (демо)",
    }
    created = 0
    for source_type, label in labels.items():
        existing = await db.execute(
            select(EventSource.id).where(EventSource.name == f"[Демо] {label}")
        )
        if existing.scalar_one_or_none() is not None:
            continue
        db.add(EventSource(
            id=uuid.uuid4(),
            name=f"[Демо] {label}",
            source_type=source_type,
            base_url="https://demo.invalid/api",
            verify_ssl=True,
            is_enabled=False,
            created_by=created_by,
        ))
        created += 1
    await db.flush()
    return created


async def seed_demo_audit_log(db: AsyncSession) -> int:
    """~200 backdated audit-log rows referencing real seeded cases/alerts
    where plausible, plus generic entries drawn from the app's existing
    action/object_type vocabulary, spread over the same ~60-day window."""
    rng = random.Random()
    now = datetime.now(timezone.utc)

    user_ids = (await db.execute(select(User.id))).scalars().all()
    if not user_ids:
        user_ids = [None]

    case_rows = (await db.execute(
        select(Case.id, Case.created_at).where(Case.title.like("[Демо]%")).limit(80)
    )).all()
    alert_rows = (await db.execute(
        select(Alert.id, Alert.case_id, Alert.created_at)
        .where(Alert.source == "Demo", Alert.case_id.isnot(None))
        .limit(320)
    )).all()

    created = 0

    for case_id, case_created_at in case_rows:
        db.add(AuditLog(
            id=uuid.uuid4(),
            case_id=case_id,
            user_id=rng.choice(user_ids),
            action="create",
            object_type="case",
            object_id=str(case_id),
            details={"demo": True},
            ts=case_created_at,
        ))
        created += 1

    for alert_id, case_id, alert_created_at in rng.sample(alert_rows, k=min(120, len(alert_rows))):
        db.add(AuditLog(
            id=uuid.uuid4(),
            case_id=case_id,
            user_id=rng.choice(user_ids),
            action="escalate_from_alert",
            object_type="alert",
            object_id=str(alert_id),
            details={"demo": True},
            ts=alert_created_at,
        ))
        created += 1

    remaining = max(0, 200 - created)
    for _ in range(remaining):
        action, object_type = rng.choice(_AUDIT_ACTIONS)
        ts = now - timedelta(days=rng.uniform(0, 60), hours=rng.uniform(0, 23))
        db.add(AuditLog(
            id=uuid.uuid4(),
            case_id=None,
            user_id=rng.choice(user_ids),
            action=action,
            object_type=object_type,
            object_id=None,
            details={"demo": True},
            ts=ts,
        ))
        created += 1

    await db.flush()
    return created


async def clear_all_alerts_and_cases(db: AsyncSession) -> Tuple[int, int]:
    """Deletes every alert and every case in the system (not just demo-seeded
    ones — an explicit, confirmed choice made at the admin-panel layer via a
    type-to-confirm phrase). All relevant child tables (branches, events,
    IOCs, comments, artifacts, etc.) cascade automatically at the DB level;
    alerts.case_id / audit_log.case_id are ON DELETE SET NULL, so no manual
    child cleanup or particular statement order is required."""
    alerts_count = (await db.execute(select(func.count()).select_from(Alert))).scalar_one()
    cases_count = (await db.execute(select(func.count()).select_from(Case))).scalar_one()

    await db.execute(delete(Alert))
    await db.execute(delete(Case))
    await db.flush()

    return alerts_count, cases_count
