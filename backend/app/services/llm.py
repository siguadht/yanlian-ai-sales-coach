import asyncio
import logging

from openai import APITimeoutError, AsyncOpenAI, OpenAIError

from ..core.config import settings
from ..core.errors import AppError

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not settings.llm_api_key or "待填" in settings.llm_api_key:
            raise AppError("LLM_INIT_FAILED", "未配置模型 API Key，请在 .env 中填写 LLM_API_KEY")
        if not settings.llm_base_url or "待填" in settings.llm_base_url:
            raise AppError("LLM_INIT_FAILED", "未配置模型 API 端点，请在 .env 中填写 LLM_BASE_URL")
        _client = AsyncOpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout,
        )
    return _client


def _extra_body(reasoning_effort: str | None) -> dict | None:
    if reasoning_effort:
        return {"reasoning_effort": reasoning_effort}
    return None


async def chat(
    messages,
    *,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 4000,
    reasoning_effort: str | None = None,
) -> str:
    model = model or settings.llm_dialog_model
    last_exc: Exception | None = None
    for attempt in range(settings.llm_max_retries + 1):
        try:
            client = get_client()
            resp = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                extra_body=_extra_body(reasoning_effort),
            )
            return (resp.choices[0].message.content or "").strip()
        except AppError:
            raise
        except (APITimeoutError, OpenAIError) as e:
            last_exc = e
            logger.warning("LLM 调用失败（第 %s 次）：%s", attempt + 1, type(e).__name__)
        if attempt < settings.llm_max_retries:
            await asyncio.sleep(1 + attempt)
    raise AppError("LLM_ERROR", "模型调用失败，请稍后重试")


async def chat_stream(
    messages,
    *,
    model: str | None = None,
    temperature: float = 0.4,
    max_tokens: int = 8000,
    reasoning_effort: str | None = None,
):
    """流式返回正文内容，跳过思考过程（reasoning_content）。"""
    model = model or settings.llm_dialog_model
    client = get_client()
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
            extra_body=_extra_body(reasoning_effort),
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except AppError:
        raise
    except APITimeoutError:
        raise AppError("LLM_TIMEOUT", "生成超时，请重试")
    except OpenAIError as e:
        logger.warning("LLM 流式调用失败：%s", type(e).__name__)
        raise AppError("LLM_ERROR", "模型调用失败，请稍后重试")
