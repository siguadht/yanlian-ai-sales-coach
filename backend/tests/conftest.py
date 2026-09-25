import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

# 测试用独立数据库（放在 data/ 下，已被 .gitignore 忽略），须在导入 app 前设置
os.environ["DATABASE_URL"] = "sqlite:///" + str(PROJECT_DIR / "data" / "test_app.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.models.database import Base, engine  # noqa: E402
from app.services import llm as llm_svc  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_llm(monkeypatch):
    """把所有 LLM 调用换成确定性假实现，离线可跑。"""

    async def fake_chat(messages, **kwargs):
        system = next((m["content"] for m in messages if m.get("role") == "system"), "")
        last = messages[-1]["content"]
        if "销售教练" in system:
            return (
                '{"score": 82, "highlights": ['
                '{"point": "开场问需求问得清楚", "type": "good", "demo": "先问清预算和用途。"},'
                '{"point": "客户嫌贵时直接降价了", "type": "bad", "demo": "先讲价值再谈价格。"}'
                '], "tone": "整体较稳，个别处偏急。"}'
            )
        if "销售培训教练" in system:
            return (
                '{"summary":"先确认顾虑，再解释方案。","highlights":['
                '{"point":"先问清需求","type":"good","demo":"您最在意预算还是工期？"},'
                '{"point":"避免空泛承诺","type":"bad","demo":"具体价格我核实后给您。"}'
                ']}'
            )
        if "资深销售示范者" in system:
            return "我理解您担心价格，先说说您最在意哪些需求？"
        if "救场" in system:
            return "往价格上引"
        if "先开口" in last:
            return "喂？你们家这个怎么收费啊？"
        return "嗯，你接着说。"

    async def fake_chat_stream(messages, **kwargs):
        system = next((m["content"] for m in messages if m.get("role") == "system"), "")
        if "资深销售示范者" in system:
            yield "我理解您担心价格，"
            yield "先说说您最在意哪些需求？"
            return
        yield "这个我再想想，"
        yield "隔壁好像更便宜。"

    monkeypatch.setattr(llm_svc, "chat", fake_chat)
    monkeypatch.setattr(llm_svc, "chat_stream", fake_chat_stream)
    return fake_chat


@pytest.fixture
def mock_voice(monkeypatch):
    """把阿里云 ASR/TTS 换成确定性假实现，离线可跑。"""
    from app.services import aliyun_nls

    monkeypatch.setattr(
        aliyun_nls,
        "recognize",
        lambda audio, appkey, fmt="wav", sample_rate=16000: "你好，请问这个多少钱？",
    )
    monkeypatch.setattr(
        aliyun_nls,
        "synthesize",
        lambda text, appkey, fmt="wav", voice=None, speech_rate=0: b"FAKEWAVDATA",
    )
    return aliyun_nls
