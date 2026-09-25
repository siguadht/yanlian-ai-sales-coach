import asyncio
import json
import logging
import re

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.errors import AppError, NotFoundError
from ..models.models import (
    DemoReview,
    Evaluation,
    Message,
    PracticeSession,
    STATUS_EVALUATED,
    STATUS_IN_PROGRESS,
)
from ..schemas.schemas import DemoReviewOut, EvaluationOut
from . import llm
from .parsers import parse_json
from .prompts.customer import CUSTOMER_SYSTEM
from .prompts.evaluation import EVALUATION_SYSTEM
from .prompts.demo_review import DEMO_REVIEW_SYSTEM
from .prompts.seller import SELLER_SYSTEM
from .scenes import scene_context

logger = logging.getLogger(__name__)

RESCUE_SYSTEM = """你是销售陪练的救场教练。销售卡壳时，你只给一个"方向"（往哪个方向引），不给整句话。

要求：
1. 只给 1 个短方向，例如"往价格上引""先问清客户预算""重申产品价值""换个角度谈工期"。
2. 不超过 15 个字。
3. 不给完整话术，让销售自己想出来。"""


def _ai_role(s: PracticeSession) -> str:
    return "customer" if s.player_role == "sales" else "sales"


def _system(s: PracticeSession) -> str:
    template = CUSTOMER_SYSTEM if s.player_role == "sales" else SELLER_SYSTEM
    return template.format(
        industry=s.industry, customer_type=s.customer_type, difficulty=s.difficulty,
        scene_context=scene_context(s.scene),
    )


def _history_messages(msgs: list[Message], ai_role: str) -> list[dict]:
    return [
        {"role": "assistant" if m.role == ai_role else "user", "content": m.content}
        for m in msgs
    ]


def _transcript(msgs: list[Message]) -> str:
    lines = []
    for m in msgs:
        name = "客户" if m.role == "customer" else "销售"
        lines.append(f"{name}：{m.content}")
    return "\n".join(lines)


async def create_session(
    db: Session, industry: str, customer_type: str, difficulty: str,
    player_role: str = "sales",
    scene: str | None = None,
    owner_id: str | None = None,
) -> tuple[PracticeSession, str]:
    opening = ""
    if player_role == "sales":
        system = CUSTOMER_SYSTEM.format(
            industry=industry, customer_type=customer_type, difficulty=difficulty,
            scene_context=scene_context(scene),
        )
        opening = await llm.chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": "现在开始，你作为客户先开口，说第一句话。"},
            ],
            model=settings.llm_dialog_model,
            temperature=0.7,
            max_tokens=600,
            reasoning_effort=settings.llm_reasoning_effort,
        )
    s = PracticeSession(
        industry=industry,
        scene=scene,
        customer_type=customer_type,
        difficulty=difficulty,
        player_role=player_role,
        owner_id=owner_id,
        status=STATUS_IN_PROGRESS,
    )
    db.add(s)
    db.flush()
    if opening:
        db.add(Message(session_id=s.id, role="customer", content=opening))
    db.commit()
    db.refresh(s)
    return s, opening


def _prepare_reply(db: Session, session_id: str, content: str):
    """Persist the human's role and build messages for the opposite AI role."""
    s = db.get(PracticeSession, session_id)
    if not s:
        raise NotFoundError("会话不存在")
    if s.status != STATUS_IN_PROGRESS:
        raise AppError("INVALID_STATE", "该陪练已结束，请新建陪练")

    db.add(Message(session_id=s.id, role=s.player_role, content=content))
    db.commit()

    msgs = (
        db.query(Message)
        .filter(Message.session_id == s.id)
        .order_by(Message.created_at, Message.id)
        .all()
    )
    messages = [{"role": "system", "content": _system(s)}] + _history_messages(msgs, _ai_role(s))
    return s, messages


async def reply_stream(db: Session, session_id: str, content: str):
    s, messages = _prepare_reply(db, session_id, content)

    async def gen():
        full = ""
        try:
            async for piece in llm.chat_stream(
                messages,
                model=settings.llm_dialog_model,
                temperature=0.7,
                max_tokens=800,
                reasoning_effort=settings.llm_reasoning_effort,
            ):
                full += piece
                yield "chunk", {"text": piece}
        except AppError as e:
            yield "error", {"error": {"code": e.code, "message": e.message}}
            return
        except Exception:
            logger.exception("客户回复流式失败")
            yield "error", {"error": {"code": "INTERNAL_ERROR", "message": "服务内部错误"}}
            return

        if full.strip():
            db.add(Message(session_id=s.id, role=_ai_role(s), content=full.strip()))
            db.commit()
        yield "done", {"reply": full.strip()}

    return gen()


async def reply_text(db: Session, session_id: str, content: str) -> str:
    """Non-streaming AI response for either player role."""
    s, messages = _prepare_reply(db, session_id, content)
    full = await llm.chat(
        messages,
        model=settings.llm_dialog_model,
        temperature=0.7,
        max_tokens=800,
        reasoning_effort=settings.llm_reasoning_effort,
    )
    if full.strip():
        db.add(Message(session_id=s.id, role=_ai_role(s), content=full.strip()))
        db.commit()
    return full.strip()


def _validate_eval(data: dict) -> EvaluationOut:
    data = dict(data)
    hl = data.get("highlights")
    if isinstance(hl, list) and len(hl) > 3:
        hl = hl[:3]
    cleaned = []
    for h in hl if isinstance(hl, list) else []:
        if isinstance(h, dict):
            demo = str(h.get("demo", "")).strip()
            _validate_safe_demo(demo)
            cleaned.append(
                {
                    "point": str(h.get("point", "")).strip() or "（未说明）",
                    "type": "good" if h.get("type") != "bad" else "bad",
                    "demo": demo,
                }
            )
    if not cleaned:
        raise AppError("PARSE_ERROR", "点评缺少关键点")
    try:
        score = int(data.get("score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))
    tone = str(data.get("tone", "")).strip() or "（无）"
    return EvaluationOut(score=score, highlights=cleaned, tone=tone)


def _validate_safe_demo(demo: str) -> None:
    """Keep unverified prices, discounts and performance claims out of reusable scripts."""
    if re.search(r"(?i)(XX|零返修|去年有位|百分之\d+|质保\d+年|\d|[零一二三四五六七八九十百千万两]{1,6}(?:元|块|万|折|年|天))", demo):
        raise AppError("PARSE_ERROR", "示范话术包含未经核实的具体数字或承诺")


async def evaluate(db: Session, session_id: str) -> dict:
    s = db.get(PracticeSession, session_id)
    if not s:
        raise NotFoundError("会话不存在")
    if s.player_role == "customer":
        return await evaluate_demo(db, s)

    existing = db.query(Evaluation).filter(Evaluation.session_id == s.id).first()
    if existing:
        return {
            "kind": "score",
            "id": existing.id,
            "score": existing.score,
            "highlights": json.loads(existing.highlights),
            "tone": existing.tone,
        }

    msgs = (
        db.query(Message)
        .filter(Message.session_id == s.id)
        .order_by(Message.created_at, Message.id)
        .all()
    )
    if len(msgs) < 2:
        raise AppError("INVALID_STATE", "对话太短，无法点评")

    prompt = f"行业：{s.industry}；部门场景：{s.scene or '未区分'}。\n以下是完整对话：\n\n{_transcript(msgs)}\n\n请按对应部门的工作阶段输出点评。"
    messages = [
        {"role": "system", "content": EVALUATION_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    for attempt in range(settings.llm_max_retries + 1):
        try:
            raw = await llm.chat(
                messages,
                model=settings.llm_eval_model,
                temperature=0.3,
                max_tokens=3000,
                reasoning_effort=settings.llm_reasoning_effort,
            )
            out = _validate_eval(parse_json(raw))
            ev = Evaluation(
                session_id=s.id,
                score=out.score,
                highlights=json.dumps([h.model_dump() for h in out.highlights], ensure_ascii=False),
                tone=out.tone,
            )
            s.status = STATUS_EVALUATED
            db.add(ev)
            db.commit()
            db.refresh(ev)
            return {
                "kind": "score",
                "id": ev.id,
                "score": ev.score,
                "highlights": json.loads(ev.highlights),
                "tone": ev.tone,
            }
        except AppError as e:
            if e.code == "PARSE_ERROR":
                logger.warning("点评解析失败（第 %s 次）", attempt + 1)
                if attempt < settings.llm_max_retries:
                    await asyncio.sleep(1)
                    continue
            raise

    raise AppError("PARSE_ERROR", "点评生成失败，请重试")


def _validate_demo(data: dict) -> DemoReviewOut:
    if not isinstance(data, dict):
        raise AppError("PARSE_ERROR", "示范拆解格式不正确")
    raw = data.get("highlights")
    if not isinstance(raw, list):
        raise AppError("PARSE_ERROR", "示范拆解缺少关键点")
    highlights = []
    for item in raw[:3]:
        if isinstance(item, dict) and item.get("type") in ("good", "bad"):
            point = str(item.get("point") or "").strip()
            demo = str(item.get("demo") or "").strip()
            _validate_safe_demo(demo)
            if point and demo:
                highlights.append({"point": point, "type": item["type"], "demo": demo})
    summary = str(data.get("summary") or "").strip()
    if not summary or not highlights:
        raise AppError("PARSE_ERROR", "示范拆解内容不完整")
    try:
        return DemoReviewOut(summary=summary, highlights=highlights)
    except ValidationError:
        raise AppError("PARSE_ERROR", "示范拆解格式不正确") from None


async def evaluate_demo(db: Session, s: PracticeSession) -> dict:
    existing = db.query(DemoReview).filter(DemoReview.session_id == s.id).first()
    if existing:
        return {
            "kind": "demo", "id": existing.id, "summary": existing.summary,
            "highlights": json.loads(existing.highlights),
        }
    msgs = (
        db.query(Message)
        .filter(Message.session_id == s.id)
        .order_by(Message.created_at, Message.id)
        .all()
    )
    if len(msgs) < 2 or not any(m.role == "sales" for m in msgs):
        raise AppError("INVALID_STATE", "对话太短，无法拆解示范")
    messages = [
        {"role": "system", "content": DEMO_REVIEW_SYSTEM},
        {"role": "user", "content": f"行业：{s.industry}；部门场景：{s.scene or '未区分'}。\n以下是完整对话：\n\n{_transcript(msgs)}\n\n请按对应部门的工作阶段输出示范拆解。"},
    ]
    for attempt in range(settings.llm_max_retries + 1):
        try:
            raw = await llm.chat(
                messages, model=settings.llm_eval_model, temperature=0.3,
                max_tokens=3000, reasoning_effort=settings.llm_reasoning_effort,
            )
            out = _validate_demo(parse_json(raw))
            review = DemoReview(
                session_id=s.id, summary=out.summary,
                highlights=json.dumps([h.model_dump() for h in out.highlights], ensure_ascii=False),
            )
            s.status = STATUS_EVALUATED
            db.add(review)
            db.commit()
            db.refresh(review)
            return {
                "kind": "demo", "id": review.id, "summary": review.summary,
                "highlights": json.loads(review.highlights),
            }
        except AppError as exc:
            if exc.code == "PARSE_ERROR" and attempt < settings.llm_max_retries:
                await asyncio.sleep(1)
                continue
            raise
    raise AppError("PARSE_ERROR", "示范拆解失败，请重试")


async def rescue(db: Session, session_id: str) -> str:
    s = db.get(PracticeSession, session_id)
    if not s:
        raise NotFoundError("会话不存在")
    if s.player_role != "sales":
        raise AppError("INVALID_STATE", "示范模式不提供救场提示")
    msgs = (
        db.query(Message)
        .filter(Message.session_id == s.id)
        .order_by(Message.created_at, Message.id)
        .all()
    )
    hint = await llm.chat(
        [
            {"role": "system", "content": RESCUE_SYSTEM},
            {"role": "user", "content": f"对话记录：\n{_transcript(msgs)}\n\n请给一个救场方向。"},
        ],
        model=settings.llm_dialog_model,
        temperature=0.5,
        max_tokens=500,
        reasoning_effort=settings.llm_reasoning_effort,
    )
    return hint.strip()
