import io
import wave
import struct

from app.services import aliyun_nls


def _wav():
    buf = io.BytesIO()
    with wave.open(buf, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 1600)
    return buf.getvalue()


def test_repair_truncated_tts_wav_header():
    original = _wav()
    overstated = bytearray(original)
    struct.pack_into("<I", overstated, 4, len(original) + 999)
    struct.pack_into("<I", overstated, 40, len(original) + 999)
    repaired = aliyun_nls._repair_wav_lengths(bytes(overstated))
    with wave.open(io.BytesIO(repaired), "rb") as audio:
        assert audio.getnframes() == 1600
        assert len(audio.readframes(audio.getnframes())) == 3200
    assert struct.unpack_from("<I", repaired, 4)[0] == len(repaired) - 8
    assert aliyun_nls._repair_wav_lengths(original) == original


def _create_session(client):
    r = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "挑剔型", "difficulty": "难缠"},
    )
    assert r.status_code == 200, r.text
    return r.json()["session"]["id"]


def test_voice_tts(client, mock_voice):
    r = client.post("/api/v1/voice/tts", json={"text": "你好，请问这个多少钱？"})
    assert r.status_code == 200, r.text
    assert r.json()["format"] == "wav"
    assert r.json()["audio"]  # base64 非空


def test_voice_turn_full_loop(client, mock_llm, mock_voice):
    sid = _create_session(client)
    r = client.post(
        "/api/v1/voice/turn",
        data={"session_id": sid},
        files={"audio": ("speech.wav", _wav(), "audio/wav")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sales_text"] == "你好，请问这个多少钱？"
    assert body["reply_text"]
    assert body["reply_audio"]


def test_voice_turn_empty_audio_rejected(client, mock_llm, mock_voice):
    sid = _create_session(client)
    r = client.post(
        "/api/v1/voice/turn",
        data={"session_id": sid},
        files={"audio": ("speech.wav", b"", "audio/wav")},
    )
    assert r.status_code == 422


def test_voice_turn_not_found(client, mock_llm, mock_voice):
    r = client.post(
        "/api/v1/voice/turn",
        data={"session_id": "nonexist"},
        files={"audio": ("speech.wav", _wav(), "audio/wav")},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


def test_voice_turn_rejects_invalid_audio(client, mock_llm, mock_voice):
    sid = _create_session(client)
    r = client.post(
        "/api/v1/voice/turn",
        data={"session_id": sid},
        files={"audio": ("speech.wav", b"fakewavdata", "audio/wav")},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_INPUT"


def test_voice_turn_rejects_wrong_media_type(client, mock_llm, mock_voice):
    sid = _create_session(client)
    r = client.post(
        "/api/v1/voice/turn",
        data={"session_id": sid},
        files={"audio": ("speech.txt", _wav(), "text/plain")},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_INPUT"


def test_token_cache_uses_absolute_expiry(monkeypatch):
    import json

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps({"Token": {"Id": "test-token", "ExpireTime": 2000}}).encode()

    monkeypatch.setattr(aliyun_nls.time, "time", lambda: 1000)
    monkeypatch.setattr(aliyun_nls.urllib.request, "urlopen", lambda *_args, **_kwargs: Response())
    monkeypatch.setattr(aliyun_nls.settings, "aliyun_access_key_id", "test-id")
    monkeypatch.setattr(aliyun_nls.settings, "aliyun_access_key_secret", "test-secret")
    aliyun_nls._token_cache.update(token=None, expire=0)
    try:
        assert aliyun_nls._get_token() == "test-token"
        assert aliyun_nls._token_cache["expire"] == 1940
    finally:
        aliyun_nls._token_cache.update(token=None, expire=0)


def test_voice_turn_customer_role(client, mock_llm, mock_voice):
    sid = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "挑剔型", "difficulty": "难缠", "player_role": "customer"},
    ).json()["session"]["id"]
    r = client.post(
        "/api/v1/voice/turn", data={"session_id": sid},
        files={"audio": ("speech.wav", _wav(), "audio/wav")},
    )
    assert r.status_code == 200
    assert r.json()["user_role"] == "customer"
    assert r.json()["reply_role"] == "sales"
    details = client.get(f"/api/v1/practice/sessions/{sid}").json()
    assert [m["role"] for m in details["messages"]] == ["customer", "sales"]
