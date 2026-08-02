"""Refreshes the local `mitre_techniques` table from the official Enterprise
ATT&CK STIX bundle (mitre-attack/attack-stix-data on GitHub) — the same
source used to build the static tactic->severity mapping in
app.services.mitre_attack. Run on a schedule (see app.services.mitre_scheduler)
or on demand via the "Обновить сейчас" button in the MITRE ATT&CK admin
settings.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSettings, MitreTechnique

logger = logging.getLogger(__name__)

STIX_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json"


def _external_id(obj: Dict[str, Any]) -> str | None:
    for ref in obj.get("external_references", []):
        if ref.get("source_name") == "mitre-attack":
            return ref.get("external_id")
    return None


def _parse_techniques(stix_objects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    techniques = []
    for obj in stix_objects:
        if obj.get("type") != "attack-pattern":
            continue
        if obj.get("revoked") or obj.get("x_mitre_deprecated"):
            continue
        tech_id = _external_id(obj)
        if not tech_id:
            continue
        tactics = sorted({
            kc["phase_name"] for kc in obj.get("kill_chain_phases", [])
            if kc.get("kill_chain_name") == "mitre-attack"
        })
        is_sub = bool(obj.get("x_mitre_is_subtechnique"))
        parent_id = tech_id.split(".")[0] if is_sub and "." in tech_id else None
        techniques.append({
            "id": tech_id,
            "name": obj.get("name") or tech_id,
            "tactics": tactics,
            "is_subtechnique": is_sub,
            "parent_technique_id": parent_id,
        })
    return techniques


async def _get_or_create_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    row = result.scalar_one_or_none()
    if row is None:
        row = AppSettings(id=1)
        db.add(row)
        await db.flush()
    return row


async def sync_mitre_matrix(db: AsyncSession) -> Tuple[bool, str, int]:
    """Downloads the current Enterprise ATT&CK matrix and replaces the
    contents of `mitre_techniques` wholesale. Returns (ok, message, count).
    """
    settings_row = await _get_or_create_settings(db)
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(STIX_URL)
            response.raise_for_status()
            bundle = response.json()

        techniques = _parse_techniques(bundle.get("objects", []))
        if not techniques:
            raise ValueError("STIX bundle parsed but yielded zero techniques")

        await db.execute(delete(MitreTechnique))
        for tech in techniques:
            db.add(MitreTechnique(**tech))

        settings_row.mitre_last_synced_at = datetime.now(timezone.utc)
        settings_row.mitre_last_sync_status = "success"
        settings_row.mitre_last_sync_message = f"Загружено техник: {len(techniques)}"
        settings_row.mitre_technique_count = len(techniques)
        await db.flush()
        return True, settings_row.mitre_last_sync_message, len(techniques)

    except Exception as exc:  # noqa: BLE001
        message = f"Ошибка синхронизации матрицы MITRE ATT&CK: {exc}"
        logger.warning(message)
        settings_row.mitre_last_sync_status = "error"
        settings_row.mitre_last_sync_message = message[:2000]
        await db.flush()
        return False, message, 0
