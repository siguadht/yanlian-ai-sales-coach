"""阿里云智能语音交互封装：一句话识别（ASR）+ 语音合成（TTS）。

只用标准库（urllib + hmac），不额外引入 SDK。密钥不落日志、不回显。
"""

import base64
import hashlib
import hmac
import json
import struct
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

from ..core.config import settings
from ..core.errors import AppError

_token_cache = {"token": None, "expire": 0.0}


def _percent_encode(s: str) -> str:
    return urllib.parse.quote(str(s), safe="-_.~")


def _get_token() -> str:
    """获取阿里云 NLS 访问 Token（带内存缓存，快过期自动刷新）。"""
    if _token_cache["token"] and time.time() < _token_cache["expire"]:
        return _token_cache["token"]

    if not settings.aliyun_access_key_id or not settings.aliyun_access_key_secret:
        raise AppError("ASR_AUTH_FAILED", "未配置阿里云 AccessKey，请在 .env 填写")

    params = {
        "AccessKeyId": settings.aliyun_access_key_id,
        "Action": "CreateToken",
        "Format": "JSON",
        "RegionId": settings.aliyun_region,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid.uuid4()),
        "SignatureVersion": "1.0",
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2019-02-28",
    }
    sorted_items = sorted(params.items())
    canonical = "&".join(f"{_percent_encode(k)}={_percent_encode(v)}" for k, v in sorted_items)
    string_to_sign = "GET&%2F&" + _percent_encode(canonical)
    signature = base64.b64encode(
        hmac.new(
            (settings.aliyun_access_key_secret + "&").encode(),
            string_to_sign.encode(),
            hashlib.sha1,
        ).digest()
    ).decode()
    url = (
        f"https://nls-meta.{settings.aliyun_region}.aliyuncs.com/?"
        + "&".join(f"{_percent_encode(k)}={_percent_encode(v)}" for k, v in sorted_items)
        + "&Signature=" + _percent_encode(signature)
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        raise AppError("ASR_AUTH_FAILED", "阿里云鉴权失败，请检查 AccessKey")

    token_obj = data.get("Token") or {}
    token = token_obj.get("Id") or ""
    if not token:
        raise AppError("ASR_AUTH_FAILED", "阿里云鉴权失败，未拿到 Token")
    expire = float(token_obj.get("ExpireTime") or 0)
    _token_cache["token"] = token
    _token_cache["expire"] = expire - 60
    return token


def recognize(audio_bytes: bytes, appkey: str, fmt: str = "wav", sample_rate: int = 16000) -> str:
    """一句话识别：音频字节 → 文字。"""
    token = _get_token()
    qs = urllib.parse.urlencode(
        {
            "appkey": appkey,
            "format": fmt,
            "sample_rate": str(sample_rate),
            "enable_punctuation_prediction": "true",
            "enable_inverse_text_normalization": "true",
        }
    )
    url = f"https://nls-gateway-{settings.aliyun_region}.aliyuncs.com/stream/v1/asr?{qs}"
    req = urllib.request.Request(url, data=audio_bytes, method="POST")
    req.add_header("X-NLS-Token", token)
    req.add_header("Content-Type", "application/octet-stream")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        raise AppError("ASR_FAILED", "语音识别失败，请重试")

    status = data.get("status")
    if status != 20000000:
        raise AppError("ASR_FAILED", f"语音识别失败（状态码 {status}）")
    return (data.get("result") or "").strip()


def synthesize(
    text: str,
    appkey: str,
    fmt: str = "wav",
    voice: str | None = None,
    speech_rate: int = 0,
) -> bytes:
    """语音合成：文字 → 音频字节。注意：text 必须放在 URL 查询参数里。"""
    token = _get_token()
    qs = urllib.parse.urlencode(
        {
            "appkey": appkey,
            "format": fmt,
            "sample_rate": "16000",
            "voice": voice or settings.aliyun_tts_voice,
            "volume": "50",
            "speech_rate": str(speech_rate),
            "pitch_rate": "0",
            "text": text,
        }
    )
    url = f"https://nls-gateway-{settings.aliyun_region}.aliyuncs.com/stream/v1/tts?{qs}"
    req = urllib.request.Request(url, method="POST")
    req.add_header("X-NLS-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            audio = resp.read()
    except Exception:
        raise AppError("TTS_FAILED", "语音合成失败，请重试")

    if not audio or (fmt == "wav" and not audio.startswith(b"RIFF")):
        raise AppError("TTS_FAILED", "语音合成未返回有效音频")
    if fmt == "wav":
        audio = _repair_wav_lengths(audio)
    return audio


def _repair_wav_lengths(audio: bytes) -> bytes:
    """阿里云流式 WAV 有时把预估长度写入文件头，超过实际音频长度。"""
    if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise AppError("TTS_FAILED", "语音合成未返回有效音频")
    offset = 12
    while offset + 8 <= len(audio):
        chunk_length = struct.unpack_from("<I", audio, offset + 4)[0]
        data_start = offset + 8
        if audio[offset:offset + 4] == b"data":
            actual_length = len(audio) - data_start
            if actual_length <= 0:
                raise AppError("TTS_FAILED", "语音合成未返回有效音频")
            if chunk_length <= actual_length:
                return audio
            repaired = bytearray(audio)
            struct.pack_into("<I", repaired, 4, len(audio) - 8)
            struct.pack_into("<I", repaired, offset + 4, actual_length)
            return bytes(repaired)
        offset = data_start + chunk_length + (chunk_length % 2)
    raise AppError("TTS_FAILED", "语音合成未返回有效音频")
