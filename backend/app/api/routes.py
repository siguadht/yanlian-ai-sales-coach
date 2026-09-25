import json

import time

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, WebSocket
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.errors import AppError, NotFoundError
from ..core.auth import (COOKIE_NAME, SESSION_SECONDS, WS_TICKET_SECONDS, request_user,
                         sign, user_for_code, websocket_user)
from ..core.config import settings
from ..models.database import get_db
from ..models.models import DemoReview, Evaluation, Message, PracticeSession
from ..schemas.schemas import AssistantQuestion, SalesMessage, SessionCreate, TtsRequest
from ..services import assistant as assistant_svc
from ..services import practice as practice_svc
from ..services import voice as voice_svc
from ..services import live_voice as live_voice_svc

router = APIRouter()


class LoginInput(BaseModel):
    code: str


@router.get("/auth/me")
def auth_me(request: Request):
    return {"auth_required": settings.public_auth_enabled,
            "authenticated": not settings.public_auth_enabled or request_user_or_none(request) is not None}


def request_user_or_none(request: Request) -> str | None:
    try:
        return request_user(request)
    except AppError:
        return None


@router.post("/auth/login")
def auth_login(payload: LoginInput, response: Response):
    if not settings.public_auth_enabled:
        return {"ok": True}
    user = user_for_code(payload.code.strip())
    if not user:
        raise AppError("UNAUTHORIZED", "体验码不正确")
    response.set_cookie(COOKIE_NAME, sign({"purpose": "session", "user": user,
                                          "exp": int(time.time()) + SESSION_SECONDS}),
                        max_age=SESSION_SECONDS, secure=True, httponly=True, samesite="lax", path="/")
    return {"ok": True}


@router.post("/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


def _owned_session(db: Session, session_id: str, user: str) -> PracticeSession:
    session = db.get(PracticeSession, session_id)
    if not session or (settings.public_auth_enabled and session.owner_id != user):
        raise NotFoundError("会话不存在")
    return session


@router.post("/auth/ws-ticket")
def auth_ws_ticket(session_id: str, user: str = Depends(request_user), db: Session = Depends(get_db)):
    _owned_session(db, session_id, user)
    if not settings.public_auth_enabled:
        return {"ticket": None, "ws_origin": None}
    return {"ticket": sign({"purpose": "ws", "user": user, "session": session_id,
                             "exp": int(time.time()) + WS_TICKET_SECONDS}),
            "ws_origin": settings.public_ws_origin}


@router.websocket("/voice/live/{session_id}")
async def live_voice(websocket: WebSocket, session_id: str, db: Session = Depends(get_db)):
    user = websocket_user(websocket, session_id)
    if not user or (settings.public_auth_enabled and
                    (not (session := db.get(PracticeSession, session_id)) or session.owner_id != user)):
        await websocket.close(code=1008)
        return
    await live_voice_svc.run_live_session(websocket, session_id, db)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _session_out(s: PracticeSession) -> dict:
    return {
        "id": s.id,
        "industry": s.industry,
        "scene": s.scene,
        "customer_type": s.customer_type,
        "difficulty": s.difficulty,
        "player_role": s.player_role,
        "status": s.status,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _message_out(m: Message) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _eval_out(ev: Evaluation) -> dict:
    return {
        "kind": "score",
        "id": ev.id,
        "score": ev.score,
        "highlights": json.loads(ev.highlights),
        "tone": ev.tone,
    }


@router.post("/practice/sessions")
async def create_session(payload: SessionCreate, db: Session = Depends(get_db), user: str = Depends(request_user)):
    s, opening = await practice_svc.create_session(
        db, payload.industry, payload.customer_type, payload.difficulty, payload.player_role, payload.scene, user
    )
    return {"session": _session_out(s), "opening": opening}


@router.get("/practice/sessions")
def list_sessions(db: Session = Depends(get_db), user: str = Depends(request_user)):
    query = db.query(PracticeSession)
    if settings.public_auth_enabled:
        query = query.filter(PracticeSession.owner_id == user)
    sessions = query.order_by(PracticeSession.created_at.desc()).all()
    scores = dict(db.query(Evaluation.session_id, Evaluation.score).all())
    return {"sessions": [{**_session_out(s), "score": scores.get(s.id) if s.player_role == "sales" else None}
                         for s in sessions]}


@router.get("/practice/sessions/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db), user: str = Depends(request_user)):
    s = _owned_session(db, session_id, user)
    msgs = (
        db.query(Message)
        .filter(Message.session_id == s.id)
        .order_by(Message.created_at, Message.id)
        .all()
    )
    ev = db.query(Evaluation).filter(Evaluation.session_id == s.id).first()
    demo = db.query(DemoReview).filter(DemoReview.session_id == s.id).first()
    return {
        "session": _session_out(s),
        "messages": [_message_out(m) for m in msgs],
        "evaluation": (
            _eval_out(ev) if ev else
            {"kind": "demo", "id": demo.id, "summary": demo.summary,
             "highlights": json.loads(demo.highlights)} if demo else None
        ),
    }


@router.post("/practice/sessions/{session_id}/messages")
async def send_message(session_id: str, payload: SalesMessage, db: Session = Depends(get_db), user: str = Depends(request_user)):
    _owned_session(db, session_id, user)
    gen = await practice_svc.reply_stream(db, session_id, payload.content)

    async def wrap():
        async for event, data in gen:
            yield _sse(event, data)

    return StreamingResponse(
        wrap(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/practice/sessions/{session_id}/end")
async def end_session(session_id: str, db: Session = Depends(get_db), user: str = Depends(request_user)):
    _owned_session(db, session_id, user)
    evaluation = await practice_svc.evaluate(db, session_id)
    return {"evaluation": evaluation}


@router.post("/practice/sessions/{session_id}/rescue")
async def rescue_session(session_id: str, db: Session = Depends(get_db), user: str = Depends(request_user)):
    _owned_session(db, session_id, user)
    hint = await practice_svc.rescue(db, session_id)
    return {"hint": hint}


@router.post("/assistant/chat")
async def assistant_chat(payload: AssistantQuestion, db: Session = Depends(get_db), user: str = Depends(request_user)):
    gen = await assistant_svc.chat_stream(payload.question, payload.industry)

    async def wrap():
        async for event, data in gen:
            yield _sse(event, data)

    return StreamingResponse(
        wrap(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/voice/tts")
async def voice_tts(payload: TtsRequest, user: str = Depends(request_user)):
    audio = await voice_svc.tts_audio_b64(payload.text)
    return {"audio": audio, "format": "wav"}


@router.post("/voice/turn")
async def voice_turn(
    session_id: str = Form(...),
    audio: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: str = Depends(request_user),
):
    _owned_session(db, session_id, user)
    audio_bytes = await audio.read(voice_svc.MAX_AUDIO_BYTES + 1)
    if audio.content_type not in ("audio/wav", "audio/x-wav", "audio/wave"):
        raise AppError("INVALID_INPUT", "只支持 WAV 音频")
    result = await voice_svc.voice_turn(db, session_id, audio_bytes)
    return result
