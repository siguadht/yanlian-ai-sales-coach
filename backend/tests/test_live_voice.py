import base64

from app.core.errors import AppError
from app.services import live_voice, voice


class FakeTranscriber:
    starts = 0

    def __init__(self, events):
        self.events = events
        self.received = False

    async def start(self):
        FakeTranscriber.starts += 1

    async def send(self, pcm):
        if not self.received:
            self.received = True
            await self.events.put(("partial", "您好"))
            await self.events.put(("final", "您好，请介绍一下。"))

    async def close(self):
        pass


def _session(client):
    r = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "挑剔型", "difficulty": "难缠"},
    )
    return r.json()["session"]["id"]


def test_live_voice_two_turns_without_reopening_browser_socket(client, mock_llm, monkeypatch):
    FakeTranscriber.starts = 0
    monkeypatch.setattr(live_voice, "RealtimeTranscriber", FakeTranscriber)

    async def fake_tts(text):
        return base64.b64encode(b"RIFFfake").decode()

    monkeypatch.setattr(voice, "tts_audio_b64", fake_tts)
    sid = _session(client)
    with client.websocket_connect(f"/api/v1/voice/live/{sid}") as ws:
        assert ws.receive_json() == {"type": "state", "state": "listening"}
        for turn in range(2):
            ws.send_bytes(b"\0\0" * 1600)
            assert ws.receive_json()["type"] == "partial"
            assert ws.receive_json()["type"] == "final"
            assert ws.receive_json() == {"type": "state", "state": "thinking"}
            reply = ws.receive_json()
            assert reply["type"] == "reply"
            assert reply["reply_text"]
            ws.send_json({"type": "resume"})
            assert ws.receive_json() == {"type": "state", "state": "listening"}
        ws.send_json({"type": "stop"})
        assert ws.receive_json() == {"type": "done"}
    assert FakeTranscriber.starts == 3  # opening turn + each automatic resume
    details = client.get(f"/api/v1/practice/sessions/{sid}").json()
    assert len(details["messages"]) == 5  # opening + two sales/customer turns


def test_live_voice_invalid_session(client):
    with client.websocket_connect("/api/v1/voice/live/missing") as ws:
        error = ws.receive_json()
        assert error["type"] == "error"
        assert error["error"]["code"] == "INVALID_STATE"


def test_live_voice_rejects_oversized_frame(client, mock_llm, monkeypatch):
    monkeypatch.setattr(live_voice, "RealtimeTranscriber", FakeTranscriber)
    sid = _session(client)
    with client.websocket_connect(f"/api/v1/voice/live/{sid}") as ws:
        assert ws.receive_json()["state"] == "listening"
        ws.send_bytes(b"\0" * (live_voice.MAX_FRAME_BYTES + 2))
        error = ws.receive_json()
        assert error["type"] == "error"
        assert error["error"]["code"] == "INVALID_INPUT"


def test_live_voice_tts_failure_keeps_text_and_can_resume(client, mock_llm, monkeypatch):
    monkeypatch.setattr(live_voice, "RealtimeTranscriber", FakeTranscriber)

    async def fail_tts(text):
        raise AppError("TTS_FAILED", "语音合成失败")

    monkeypatch.setattr(voice, "tts_audio_b64", fail_tts)
    sid = _session(client)
    with client.websocket_connect(f"/api/v1/voice/live/{sid}") as ws:
        assert ws.receive_json()["state"] == "listening"
        ws.send_bytes(b"\0\0" * 1600)
        assert ws.receive_json()["type"] == "partial"
        assert ws.receive_json()["type"] == "final"
        assert ws.receive_json()["state"] == "thinking"
        reply = ws.receive_json()
        assert reply["type"] == "reply"
        assert reply["reply_text"]
        assert reply["audio_error"] is True
        ws.send_json({"type": "resume"})
        assert ws.receive_json()["state"] == "listening"
        ws.send_json({"type": "stop"})
        assert ws.receive_json()["type"] == "done"


def test_live_voice_customer_role(client, mock_llm, monkeypatch):
    monkeypatch.setattr(live_voice, "RealtimeTranscriber", FakeTranscriber)

    async def fake_tts(text):
        return base64.b64encode(b"RIFFfake").decode()

    monkeypatch.setattr(voice, "tts_audio_b64", fake_tts)
    sid = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "挑剔型", "difficulty": "难缠", "player_role": "customer"},
    ).json()["session"]["id"]
    with client.websocket_connect(f"/api/v1/voice/live/{sid}") as ws:
        assert ws.receive_json()["state"] == "listening"
        ws.send_bytes(b"\0\0" * 1600)
        assert ws.receive_json()["type"] == "partial"
        assert ws.receive_json()["type"] == "final"
        assert ws.receive_json()["state"] == "thinking"
        reply = ws.receive_json()
        assert reply["user_role"] == "customer"
        assert reply["reply_role"] == "sales"
        ws.send_json({"type": "stop"})
        assert ws.receive_json()["type"] == "done"
    details = client.get(f"/api/v1/practice/sessions/{sid}").json()
    assert [m["role"] for m in details["messages"]] == ["customer", "sales"]
