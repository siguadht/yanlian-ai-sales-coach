import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.config import settings
from app.models.database import SessionLocal
from app.models.models import PracticeSession
from app.main import app


@pytest.fixture
def secure_client():
    return TestClient(app, base_url="https://testserver")


def _login(client, code):
    return client.post("/api/v1/auth/login", json={"code": code})


def _new_customer_session(client):
    result = client.post("/api/v1/practice/sessions", json={
        "industry": "装修", "customer_type": "挑剔型", "difficulty": "温和", "player_role": "customer",
    })
    assert result.status_code == 200, result.text
    return result.json()["session"]["id"]


def test_public_invites_isolate_all_session_routes_and_voice(secure_client, monkeypatch):
    client = secure_client
    monkeypatch.setattr(settings, "public_auth_enabled", True)
    monkeypatch.setattr(settings, "auth_secret", "a" * 40)
    monkeypatch.setattr(settings, "invite_codes", ("first-test-code-0001", "second-test-code-0002"))
    monkeypatch.setattr(settings, "public_ws_origin", "wss://voice.example.test")

    assert client.get("/api/v1/auth/me").json() == {"auth_required": True, "authenticated": False}
    assert client.get("/api/v1/practice/sessions").status_code == 401
    assert _login(client, "wrong-code").status_code == 401
    assert _login(client, "first-test-code-0001").status_code == 200
    first = _new_customer_session(client)
    voice_access = client.post(f"/api/v1/auth/ws-ticket?session_id={first}").json()
    ticket = voice_access["ticket"]
    assert isinstance(ticket, str)
    assert voice_access["ws_origin"] == "wss://voice.example.test"

    assert _login(client, "second-test-code-0002").status_code == 200
    second = _new_customer_session(client)
    assert [item["id"] for item in client.get("/api/v1/practice/sessions").json()["sessions"]] == [second]
    for path, method in (
        (f"/practice/sessions/{first}", "get"),
        (f"/practice/sessions/{first}/messages", "post"),
        (f"/practice/sessions/{first}/end", "post"),
        (f"/practice/sessions/{first}/rescue", "post"),
        (f"/auth/ws-ticket?session_id={first}", "post"),
    ):
        response = client.request(method.upper(), "/api/v1" + path,
                                  json={"content": "你好"} if path.endswith("messages") else None)
        assert response.status_code == 404, (path, response.text)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/v1/voice/live/{second}?ticket={ticket}"):
            pass
    assert client.get(f"/api/v1/practice/sessions/{second}").status_code == 200


def test_preexisting_local_sessions_stay_private_when_public_auth_enabled(secure_client, monkeypatch):
    client = secure_client
    old_id = _new_customer_session(client)
    with SessionLocal() as db:
        old = db.get(PracticeSession, old_id)
        old.owner_id = None
        db.commit()
    monkeypatch.setattr(settings, "public_auth_enabled", True)
    monkeypatch.setattr(settings, "auth_secret", "a" * 40)
    monkeypatch.setattr(settings, "invite_codes", ("first-test-code-0001",))
    monkeypatch.setattr(settings, "public_ws_origin", "wss://voice.example.test")
    _login(client, "first-test-code-0001")
    assert client.get("/api/v1/practice/sessions").json()["sessions"] == []
    assert client.get(f"/api/v1/practice/sessions/{old_id}").status_code == 404
