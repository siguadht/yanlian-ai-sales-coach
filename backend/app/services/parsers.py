import json
import re

from ..core.errors import AppError


def parse_json(text: str) -> dict:
    """宽容解析 JSON：直接解析 → 去代码围栏 → 提取首尾花括号 → 仍失败抛 PARSE_ERROR。"""
    text = (text or "").strip()
    if not text:
        raise AppError("PARSE_ERROR", "模型返回为空")
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        obj = None
    if obj is None:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                obj = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                obj = None
    if obj is None or not isinstance(obj, dict):
        raise AppError("PARSE_ERROR", "模型输出不是有效 JSON")
    return obj
