"""Invite-code identity and short-lived signed browser sessions.

Invite codes never leave server settings. Every code represents one isolated user;
distribute a different code to each tester.
"""

import base64
import hashlib
import hmac
import json
import time

from fastapi import Request, WebSocket

from .config import settings
from .errors import AppError

COOKIE_NAME = "yanlian_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
WS_TICKET_SECONDS = 60


def validate_auth_config() -> None:
    if settings.public_auth_enabled and (
        len(settings.auth_secret) < 32 or not settings.invite_codes
        or len(settings.invite_codes) != len(set(settings.invite_codes))
        or any(len(code) < 16 for code in settings.invite_codes)
        or not settings.public_ws_origin.startswith("wss://")
    ):
        raise RuntimeError("Public auth requires AUTH_SECRET, distinct INVITE_CODES, and a wss:// PUBLIC_WS_ORIGIN")


def user_for_code(code: str) -> str | None:
    if not settings.public_auth_enabled:
        return None
    for candidate in settings.invite_codes:
        if hmac.compare_digest(candidate, code):
            return hmac.new(settings.auth_secret.encode(), candidate.encode(), hashlib.sha256).hexdigest()
    return None


def sign(payload: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).rstrip(b"=")
    mac = hmac.new(settings.auth_secret.encode(), raw, hashlib.sha256).digest()
    return f"{raw.decode()}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


def verify(token: str | None, purpose: str) -> dict | None:
    if not token or len(token) > 2048 or "." not in token or not settings.auth_secret:
        return None
    try:
        raw, signature = token.split(".", 1)
        expected = hmac.new(settings.auth_secret.encode(), raw.encode(), hashlib.sha256).digest()
        actual = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(expected, actual):
            return None
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        if payload.get("purpose") != purpose or not isinstance(payload.get("user"), str):
            return None
        if not isinstance(payload.get("exp"), int) or payload["exp"] < time.time():
            return None
        return payload
    except (ValueError, UnicodeDecodeError, TypeError, KeyError):
        return None


def request_user(request: Request) -> str:
    if not settings.public_auth_enabled:
        return "local"
    payload = verify(request.cookies.get(COOKIE_NAME), "session")
    if not payload:
        raise AppError("UNAUTHORIZED", "请先输入体验码")
    return payload["user"]


def websocket_user(websocket: WebSocket, session_id: str) -> str | None:
    if not settings.public_auth_enabled:
        return "local"
    payload = verify(websocket.query_params.get("ticket"), "ws")
    if payload and payload.get("session") == session_id:
        return payload["user"]
    return None
