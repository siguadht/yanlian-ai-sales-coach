"""语音陪练编排：音频 → 转文字 → 扮客户回复 → 转语音。原始音频只走内存，绝不落盘。"""

import asyncio
import base64
import io
import logging
import wave

from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.errors import AppError
from ..models.models import PracticeSession
from . import aliyun_nls, doubao_tts, practice

logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 3 * 1024 * 1024  # 单次音频上限 3MB（约 90 秒）


def validate_audio(audio_bytes: bytes) -> None:
    if not audio_bytes:
        raise AppError("INVALID_INPUT", "音频为空")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise AppError("INVALID_INPUT", "音频过长，请说短一点")
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as audio:
            valid = (
                audio.getcomptype() == "NONE"
                and audio.getnchannels() == 1
                and audio.getsampwidth() == 2
                and audio.getframerate() == 16000
                and audio.getnframes() > 0
            )
    except (EOFError, wave.Error):
        valid = False
    if not valid:
        raise AppError("INVALID_INPUT", "请上传 16kHz、单声道、16 位 PCM 的 WAV 音频")


async def tts_audio_b64(text: str) -> str:
    """文字 → 语音 → base64（供前端播放）。"""
    if settings.tts_provider == "doubao":
        synthesize = lambda: doubao_tts.synthesize(
            text, settings.doubao_tts_api_key, settings.doubao_tts_voice
        )
    elif settings.tts_provider == "aliyun":
        synthesize = lambda: aliyun_nls.synthesize(text, settings.aliyun_tts_appkey)
    else:
        raise AppError("TTS_NOT_CONFIGURED", "语音服务配置不正确")
    for attempt in range(2):
        try:
            audio = await asyncio.to_thread(synthesize)
            return base64.b64encode(audio).decode()
        except AppError as exc:
            if exc.code != "TTS_FAILED" or attempt == 1:
                raise
            await asyncio.sleep(0.5)


async def voice_turn(db: Session, session_id: str, audio_bytes: bytes) -> dict:
    """一轮语音陪练：识别销售的话 → 生成客户回复 → 合成客户语音。"""
    validate_audio(audio_bytes)

    # 1. 语音转文字
    sales_text = await asyncio.to_thread(
        aliyun_nls.recognize, audio_bytes, settings.aliyun_asr_appkey
    )
    if not sales_text:
        raise AppError("ASR_EMPTY", "没听清，请再说一次")

    # 2. 根据会话角色生成另一方回复
    reply_text = await practice.reply_text(db, session_id, sales_text)
    session = db.get(PracticeSession, session_id)

    # 3. 客户回复转语音
    reply_audio_b64 = await tts_audio_b64(reply_text)

    return {
        "user_text": sales_text,
        "user_role": session.player_role,
        "reply_role": "customer" if session.player_role == "sales" else "sales",
        "sales_text": sales_text,
        "reply_text": reply_text,
        "reply_audio": reply_audio_b64,
        "format": "wav",
    }
