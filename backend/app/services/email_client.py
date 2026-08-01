"""Polls an IMAP mailbox for alert-notification emails (e.g. a shared
security@ inbox that vendors/SOC tooling send plain-text alerts to).
"""
import asyncio
import email
import email.utils
import imaplib
import logging
from datetime import datetime, timezone
from email.header import decode_header
from email.message import Message
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _decode_header_value(value: Optional[str]) -> str:
    if not value:
        return ""
    decoded = ""
    for text, enc in decode_header(value):
        if isinstance(text, bytes):
            decoded += text.decode(enc or "utf-8", errors="replace")
        else:
            decoded += text
    return decoded


def _extract_body(msg: Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                charset = part.get_content_charset() or "utf-8"
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(charset, errors="replace")
        return ""
    charset = msg.get_content_charset() or "utf-8"
    payload = msg.get_payload(decode=True)
    return payload.decode(charset, errors="replace") if payload else ""


class EmailClient:
    """Reads alert notification emails from an IMAP mailbox."""

    def __init__(
        self,
        host: str,
        port: int,
        username: Optional[str],
        password: Optional[str],
        mailbox: str = "INBOX",
        use_ssl: bool = True,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.mailbox = mailbox or "INBOX"
        self.use_ssl = use_ssl

    def _connect(self) -> imaplib.IMAP4:
        conn: imaplib.IMAP4 = (
            imaplib.IMAP4_SSL(self.host, self.port)
            if self.use_ssl
            else imaplib.IMAP4(self.host, self.port)
        )
        if self.username:
            conn.login(self.username, self.password or "")
        conn.select(self.mailbox, readonly=True)
        return conn

    def _test_connection_sync(self) -> Tuple[bool, str]:
        try:
            conn = self._connect()
            try:
                status, data = conn.search(None, "ALL")
                count = len(data[0].split()) if status == "OK" and data and data[0] else 0
                return True, f"Подключено к папке «{self.mailbox}», писем: {count}"
            finally:
                conn.logout()
        except Exception as exc:  # noqa: BLE001
            return False, f"Ошибка подключения к почтовому серверу: {exc}"

    async def test_connection(self) -> Tuple[bool, str]:
        return await asyncio.to_thread(self._test_connection_sync)

    def _fetch_alerts_sync(self, since: datetime) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            criteria = f'(SINCE "{since.strftime("%d-%b-%Y")}")'
            status, data = conn.search(None, criteria)
            if status != "OK" or not data or not data[0]:
                return []
            results: List[Dict[str, Any]] = []
            for num in data[0].split():
                status, msg_data = conn.fetch(num, "(RFC822)")
                if status != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                    continue
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)

                raw_date = msg.get("Date")
                parsed_date: Optional[datetime] = None
                if raw_date:
                    try:
                        parsed_date = email.utils.parsedate_to_datetime(raw_date)
                    except (TypeError, ValueError):
                        parsed_date = None
                if parsed_date and parsed_date.tzinfo is None:
                    parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                if parsed_date and parsed_date <= since:
                    continue

                results.append({
                    "message_id": msg.get("Message-ID") or f"{num.decode()}@{self.host}",
                    "subject": _decode_header_value(msg.get("Subject")),
                    "from": _decode_header_value(msg.get("From")),
                    "date": parsed_date.isoformat() if parsed_date else None,
                    "body": _extract_body(msg),
                })
            return results
        finally:
            conn.logout()

    async def fetch_alerts(self, since: datetime) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._fetch_alerts_sync, since)
