"""豆包语音合成 V3 HTTP Chunked；输出 WAV 以保持现有前端接口兼容。"""

import base64
import binascii
import io
import json
import urllib.request
import uuid
import wave

from ..core.errors import AppError

URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
RESOURCE_ID = "seed-tts-2.0"
SAMPLE_RATE = 24000
MAX_RESPONSE_BYTES = 12 * 1024 * 1024
MAX_PCM_BYTES = 8 * 1024 * 1024


def synthesize(text: str, api_key: str, voice: str) -> bytes:
    """一次性送入文字，汇总 PCM 分片；失败时绝不返回部分音频。"""
    if not api_key:
        raise AppError("TTS_NOT_CONFIGURED", "豆包语音尚未配置，请先完成服务开通")
    body = json.dumps({
        "user": {"uid": "sales-practice"},
        "req_params": {
            "text": text,
            "speaker": voice,
            "audio_params": {"format": "pcm", "sample_rate": SAMPLE_RATE},
        },
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(URL, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("X-Api-Key", api_key)
    request.add_header("X-Api-Resource-Id", RESOURCE_ID)
    request.add_header("X-Api-Request-Id", str(uuid.uuid4()))
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except Exception:
        raise AppError("TTS_FAILED", "豆包语音合成失败，请重试") from None
    if len(raw) > MAX_RESPONSE_BYTES:
        raise AppError("TTS_FAILED", "语音回复过长，请缩短内容")
    return _parse_pcm_events(raw)


def _parse_pcm_events(raw: bytes) -> bytes:
    pcm = bytearray()
    finished = False
    try:
        for line in raw.splitlines():
            if not line.strip():
                continue
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("invalid event")
            code = event.get("code")
            if code == 20000000:
                finished = True
                break
            if code != 0:
                raise ValueError("provider error")
            encoded = event.get("data")
            if encoded is not None:
                if not isinstance(encoded, str):
                    raise ValueError("invalid audio")
                pcm.extend(base64.b64decode(encoded, validate=True))
                if len(pcm) > MAX_PCM_BYTES:
                    raise ValueError("audio too long")
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError):
        raise AppError("TTS_FAILED", "豆包语音返回的数据无法读取") from None
    if not finished or not pcm or len(pcm) % 2:
        raise AppError("TTS_FAILED", "豆包语音合成未完成，请重试")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return output.getvalue()
