"""Sends outbound notification emails via SMTP (distinct from
`email_client.py`, which polls an IMAP mailbox as an alert source).
"""
import asyncio
import smtplib
from email.mime.text import MIMEText
from typing import List, Optional


def _send_sync(
    host: str,
    port: int,
    username: Optional[str],
    password: Optional[str],
    use_tls: bool,
    from_email: str,
    recipients: List[str],
    subject: str,
    body: str,
) -> None:
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = ", ".join(recipients)

    with smtplib.SMTP(host, port, timeout=10) as server:
        if use_tls:
            server.starttls()
        if username:
            server.login(username, password or "")
        server.sendmail(from_email, recipients, msg.as_string())


async def send_notification_email(
    host: str,
    port: int,
    username: Optional[str],
    password: Optional[str],
    use_tls: bool,
    from_email: str,
    recipients: List[str],
    subject: str,
    body: str,
) -> None:
    await asyncio.to_thread(
        _send_sync, host, port, username, password, use_tls, from_email, recipients, subject, body,
    )
