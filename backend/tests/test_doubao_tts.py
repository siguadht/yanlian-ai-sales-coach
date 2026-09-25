import base64
import io
import json
import wave

import pytest

from app.core.config import settings
from app.core.errors import AppError
from app.services import doubao_tts


def _events(*rows):
    return b"\n".join(json.dumps(row).encode() for row in rows) + b"\n"


def test_doubao_pcm_events_keep_existing_wav_contract():
    result = doubao_tts._parse_pcm_events(_events(
        {"code": 0, "data": base64.b64encode(b"\x01\x00\x02\x00").decode()},
        {"code": 0, "data": base64.b64encode(b"\x03\x00").decode()},
        {"code": 20000000, "data": None},
    ))
    with wave.open(io.BytesIO(result), "rb") as wav:
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getframerate() == 24000
        assert wav.readframes(wav.getnframes()) == b"\x01\x00\x02\x00\x03\x00"


@pytest.mark.parametrize("events", [
    _events({"code": 0, "data": base64.b64encode(b"\x00\x00").decode()}),
    _events({"code": 45000001, "message": "details"}),
    _events({"code": 0, "data": "invalid-base64"}, {"code": 20000000}),
])
def test_doubao_rejects_incomplete_or_invalid_audio(events):
    with pytest.raises(AppError) as exc:
        doubao_tts._parse_pcm_events(events)
    assert exc.value.code == "TTS_FAILED"


def test_doubao_request_and_voice_route(client, monkeypatch):
    monkeypatch.setattr(settings, "tts_provider", "doubao")
    monkeypatch.setattr(settings, "doubao_tts_api_key", "test-key")
    monkeypatch.setattr(settings, "doubao_tts_voice", "zh_female_vv_uranus_bigtts")
    captured = {}

    class Response:
        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def read(self, _limit):
            return _events(
                {"code": 0, "data": base64.b64encode(b"\x01\x00").decode()},
                {"code": 20000000},
            )

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(doubao_tts.urllib.request, "urlopen", fake_urlopen)
    response = client.post("/api/v1/voice/tts", json={"text": "您好"})
    assert response.status_code == 200
    assert response.json()["format"] == "wav"
    assert base64.b64decode(response.json()["audio"]).startswith(b"RIFF")
    request = captured["request"]
    assert request.full_url == doubao_tts.URL
    assert request.get_header("X-api-key") == "test-key"
    assert request.get_header("X-api-resource-id") == "seed-tts-2.0"
    body = json.loads(request.data)
    assert body["req_params"]["speaker"] == "zh_female_vv_uranus_bigtts"
    assert body["req_params"]["audio_params"]["format"] == "pcm"
    assert captured["timeout"] == 30


def test_doubao_missing_key_does_not_fall_back_to_aliyun(client, monkeypatch):
    monkeypatch.setattr(settings, "tts_provider", "doubao")
    monkeypatch.setattr(settings, "doubao_tts_api_key", "")
    response = client.post("/api/v1/voice/tts", json={"text": "您好"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "TTS_NOT_CONFIGURED"
