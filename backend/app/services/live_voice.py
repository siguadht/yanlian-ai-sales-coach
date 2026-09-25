"""Browser PCM -> Alibaba real-time ASR -> customer reply -> TTS.

Only text is persisted. Each customer turn pauses recognition until playback ends.
"""

import asyncio
import json
import logging
import time
import urllib.parse
import uuid

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from websockets.asyncio.client import connect

from ..core.config import settings
from ..core.errors import AppError
from ..models.models import PracticeSession, STATUS_IN_PROGRESS
from . import aliyun_nls, practice, voice

logger = logging.getLogger(__name__)
MAX_FRAME_BYTES = 64 * 1024
MAX_TURN_BYTES = 3 * 1024 * 1024
MAX_CALL_SECONDS = 15 * 60


def _command(name: str, task_id: str) -> str:
    command = {
        "header": {
            "message_id": uuid.uuid4().hex,
            "task_id": task_id,
            "namespace": "SpeechTranscriber",
            "name": name,
            "appkey": settings.aliyun_asr_appkey,
        }
    }
    if name == "StartTranscription":
        command["payload"] = {
            "format": "pcm",
            "sample_rate": 16000,
            "enable_intermediate_result": True,
            "enable_punctuation_prediction": True,
            "enable_inverse_text_normalization": True,
            "max_sentence_silence": 800,
        }
    return json.dumps(command)


class RealtimeTranscriber:
    def __init__(self, events: asyncio.Queue):
        self.events = events
        self.socket = None
        self.reader = None
        self.task_id = uuid.uuid4().hex
        self.stopping = False

    async def start(self) -> None:
        if not settings.aliyun_asr_appkey:
            raise AppError("ASR_AUTH_FAILED", "未配置实时语音识别 AppKey")
        token = await asyncio.to_thread(aliyun_nls._get_token)
        url = (
            f"wss://nls-gateway-{settings.aliyun_region}.aliyuncs.com/ws/v1"
            f"?token={urllib.parse.quote(token, safe='')}"
        )
        try:
            self.socket = await connect(url, proxy=None, open_timeout=15, max_size=1024 * 1024)
            await self.socket.send(_command("StartTranscription", self.task_id))
            started = json.loads(await asyncio.wait_for(self.socket.recv(), 15))
            header = started.get("header", {})
            if header.get("name") != "TranscriptionStarted" or header.get("status") != 20000000:
                raise AppError("ASR_FAILED", "实时语音识别启动失败")
            self.reader = asyncio.create_task(self._read())
        except AppError:
            await self.close()
            raise
        except Exception as exc:
            logger.warning("实时识别连接失败：%s", type(exc).__name__)
            await self.close()
            raise AppError("ASR_FAILED", "实时语音识别连接失败") from None

    async def _read(self) -> None:
        final_sent = False
        try:
            async for raw in self.socket:
                data = json.loads(raw)
                header = data.get("header", {})
                name = header.get("name")
                payload = data.get("payload") or {}
                if name == "TranscriptionResultChanged" and not final_sent:
                    await self.events.put(("partial", str(payload.get("result") or "")))
                elif name == "SentenceEnd" and not final_sent:
                    text = str(payload.get("result") or "").strip()
                    if text:
                        final_sent = True
                        await self.events.put(("final", text))
                elif name == "TaskFailed":
                    await self.events.put(("error", {"code": "ASR_FAILED", "message": "实时语音识别失败"}))
                    return
                elif name == "TranscriptionCompleted":
                    return
            if not self.stopping:
                await self.events.put(("error", {"code": "ASR_FAILED", "message": "实时语音识别连接中断"}))
        except Exception as exc:
            if not self.stopping:
                logger.warning("实时识别连接中断：%s", type(exc).__name__)
                await self.events.put(("error", {"code": "ASR_FAILED", "message": "实时语音识别连接中断"}))

    async def send(self, pcm: bytes) -> None:
        if self.socket:
            await self.socket.send(pcm)

    async def close(self) -> None:
        self.stopping = True
        if self.socket:
            try:
                await self.socket.send(_command("StopTranscription", self.task_id))
                if self.reader:
                    await asyncio.wait_for(self.reader, 5)
            except Exception:
                if self.reader:
                    self.reader.cancel()
            finally:
                await self.socket.close()
                self.socket = None


async def run_live_session(websocket: WebSocket, session_id: str, db: Session) -> None:
    await websocket.accept()
    session = db.get(PracticeSession, session_id)
    if not session or session.status != STATUS_IN_PROGRESS:
        await websocket.send_json({"type": "error", "error": {"code": "INVALID_STATE", "message": "陪练不存在或已结束"}})
        await websocket.close()
        return

    events: asyncio.Queue = asyncio.Queue()
    state = {"value": "starting", "bytes": 0}
    transcriber: RealtimeTranscriber | None = None
    turn_task: asyncio.Task | None = None
    deadline = time.monotonic() + MAX_CALL_SECONDS

    async def browser_pump() -> None:
        try:
            while True:
                packet = await websocket.receive()
                if packet["type"] == "websocket.disconnect":
                    await events.put(("disconnect", None))
                    return
                pcm = packet.get("bytes")
                if pcm is not None:
                    if state["value"] != "listening":
                        continue
                    if not pcm or len(pcm) > MAX_FRAME_BYTES or len(pcm) % 2:
                        await events.put(("error", {"code": "INVALID_INPUT", "message": "音频片段不合法"}))
                        return
                    state["bytes"] += len(pcm)
                    if state["bytes"] > MAX_TURN_BYTES:
                        await events.put(("error", {"code": "INVALID_INPUT", "message": "本轮说话时间过长"}))
                        return
                    try:
                        await transcriber.send(pcm)
                    except Exception:
                        await events.put(("error", {"code": "ASR_FAILED", "message": "实时语音传输失败"}))
                        return
                elif packet.get("text"):
                    try:
                        control = json.loads(packet["text"]).get("type")
                    except (ValueError, TypeError):
                        control = None
                    if control in ("resume", "stop"):
                        await events.put((control, None))
        except WebSocketDisconnect:
            await events.put(("disconnect", None))

    async def generate_reply(text: str) -> None:
        try:
            reply = await asyncio.wait_for(practice.reply_text(db, session_id, text), 70)
            if not reply:
                raise AppError("LLM_ERROR", "客户回复为空，请重试")
            try:
                audio = await asyncio.wait_for(voice.tts_audio_b64(reply), 35)
            except (AppError, asyncio.TimeoutError):
                logger.warning("客户文字已保存，本轮语音合成失败")
                audio = ""
            await events.put(("reply", {
                "user_text": text,
                "user_role": session.player_role,
                "reply_role": "customer" if session.player_role == "sales" else "sales",
                "sales_text": text,  # Legacy alias for existing clients.
                "reply_text": reply, "reply_audio": audio, "format": "wav",
                "audio_error": not bool(audio),
            }))
        except AppError as exc:
            await events.put(("error", {"code": exc.code, "message": exc.message}))
        except asyncio.TimeoutError:
            await events.put(("error", {"code": "LLM_TIMEOUT", "message": "客户回复超时，请重试"}))
        except Exception as exc:
            logger.warning("实时陪练回复失败：%s", type(exc).__name__)
            await events.put(("error", {"code": "INTERNAL_ERROR", "message": "服务内部错误"}))

    pump = asyncio.create_task(browser_pump())
    try:
        transcriber = RealtimeTranscriber(events)
        await transcriber.start()
        state["value"] = "listening"
        await websocket.send_json({"type": "state", "state": "listening"})
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AppError("INVALID_STATE", "本次通话已达 15 分钟上限")
            event, data = await asyncio.wait_for(events.get(), remaining)
            if event == "disconnect":
                break
            if event == "stop":
                await websocket.send_json({"type": "done"})
                break
            if event == "error":
                raise AppError(data["code"], data["message"])
            if event == "partial" and state["value"] == "listening":
                await websocket.send_json({"type": "partial", "text": data})
            elif event == "final" and state["value"] == "listening":
                state["value"] = "thinking"
                await websocket.send_json({"type": "final", "text": data})
                await websocket.send_json({"type": "state", "state": "thinking"})
                await transcriber.close()
                transcriber = None
                turn_task = asyncio.create_task(generate_reply(data))
            elif event == "reply" and state["value"] == "thinking":
                state["value"] = "speaking"
                await websocket.send_json({"type": "reply", **data})
            elif event == "resume" and state["value"] == "speaking":
                state["value"] = "starting"
                state["bytes"] = 0
                transcriber = RealtimeTranscriber(events)
                await transcriber.start()
                state["value"] = "listening"
                await websocket.send_json({"type": "state", "state": "listening"})
    except AppError as exc:
        await websocket.send_json({"type": "error", "error": {"code": exc.code, "message": exc.message}})
    except asyncio.TimeoutError:
        await websocket.send_json({"type": "error", "error": {"code": "INVALID_STATE", "message": "本次通话已达 15 分钟上限"}})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("实时陪练连接失败：%s", type(exc).__name__)
        try:
            await websocket.send_json({"type": "error", "error": {"code": "INTERNAL_ERROR", "message": "服务内部错误"}})
        except Exception:
            pass
    finally:
        state["value"] = "closed"
        pump.cancel()
        if turn_task and not turn_task.done():
            turn_task.cancel()
        if transcriber:
            await transcriber.close()
        try:
            await websocket.close()
        except Exception:
            pass
