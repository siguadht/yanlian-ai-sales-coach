import logging

from ..core.config import settings
from ..core.errors import AppError
from . import llm
from .prompts.assistant import ASSISTANT_SYSTEM

logger = logging.getLogger(__name__)


async def chat_stream(question: str, industry: str | None):
    user = question if not industry else f"（行业：{industry}）\n{question}"
    messages = [
        {"role": "system", "content": ASSISTANT_SYSTEM},
        {"role": "user", "content": user},
    ]

    async def gen():
        full = ""
        try:
            async for piece in llm.chat_stream(
                messages,
                model=settings.llm_dialog_model,
                temperature=0.5,
                max_tokens=2000,
                reasoning_effort=settings.llm_reasoning_effort,
            ):
                full += piece
                yield "chunk", {"text": piece}
        except AppError as e:
            yield "error", {"error": {"code": e.code, "message": e.message}}
            return
        except Exception:
            logger.exception("话术助手流式失败")
            yield "error", {"error": {"code": "INTERNAL_ERROR", "message": "服务内部错误"}}
            return

        yield "done", {"reply": full.strip()}

    return gen()
