"""Fires outbound notifications (Telegram / email) for alert and incident
events, based on the admin-configured `AppSettings` singleton row. Failures
here are logged and swallowed — a notification channel being down must never
block alert ingestion or case updates.
"""
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, AppSettings, Case
from app.services.email_sender import send_notification_email
from app.services.telegram_client import send_telegram_message

logger = logging.getLogger(__name__)


async def _get_settings(db: AsyncSession) -> Optional[AppSettings]:
    result = await db.execute(select(AppSettings).limit(1))
    return result.scalar_one_or_none()


async def _dispatch(db: AsyncSession, subject: str, text: str) -> None:
    settings = await _get_settings(db)
    if settings is None:
        return

    if settings.telegram_notifications_enabled and settings.telegram_bot_token and settings.telegram_chat_id:
        try:
            await send_telegram_message(settings.telegram_bot_token, settings.telegram_chat_id, text)
        except Exception:
            logger.exception("Failed to send Telegram notification")

    if settings.email_notifications_enabled and settings.smtp_host and settings.email_notification_recipients:
        try:
            await send_notification_email(
                host=settings.smtp_host,
                port=settings.smtp_port or 587,
                username=settings.smtp_username,
                password=settings.smtp_password,
                use_tls=settings.smtp_use_tls,
                from_email=settings.smtp_from_email or settings.smtp_username or "noreply@ir-sauron.local",
                recipients=settings.email_notification_recipients,
                subject=subject,
                body=text,
            )
        except Exception:
            logger.exception("Failed to send notification email")


async def notify_new_alert(db: AsyncSession, alert: Alert) -> None:
    subject = f"[IR-Sauron] Новый алерт: {alert.title}"
    text = (
        f"Новый алерт [{alert.severity.value.upper()}]\n"
        f"{alert.title}\n"
        f"Источник: {alert.source or '—'}"
    )
    await _dispatch(db, subject, text)


async def notify_alert_escalated(db: AsyncSession, alert: Alert, case: Case) -> None:
    subject = f"[IR-Sauron] Алерт эскалирован в инцидент: {case.title}"
    text = (
        f"Алерт эскалирован в инцидент\n"
        f"Алерт: {alert.title}\n"
        f"Инцидент: {case.title} [{case.severity.value.upper()}]"
    )
    await _dispatch(db, subject, text)


async def notify_case_status_changed(db: AsyncSession, case: Case, old_status: str, new_status: str) -> None:
    subject = f"[IR-Sauron] Статус инцидента изменён: {case.title}"
    text = (
        f"Статус инцидента изменён\n"
        f"Инцидент: {case.title}\n"
        f"{old_status} → {new_status}"
    )
    await _dispatch(db, subject, text)
