"""Sends outbound notification messages to a Telegram chat via the Bot API."""
import httpx

_API_BASE = "https://api.telegram.org"
_TIMEOUT = 10.0


async def send_telegram_message(bot_token: str, chat_id: str, text: str) -> None:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(
            f"{_API_BASE}/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
        )
        response.raise_for_status()
