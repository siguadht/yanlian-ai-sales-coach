import pytest

from app.core.errors import AppError
from app.models.models import Message, PracticeSession
from app.services.practice import _system, _transcript, _validate_demo, _validate_eval


def _msg(role, content):
    m = Message(role=role, content=content)
    return m


def test_validate_eval_normal():
    out = _validate_eval(
        {
            "score": 82,
            "highlights": [
                {"point": "开场清楚", "type": "good", "demo": "可以说……"},
                {"point": "直接降价", "type": "bad", "demo": "先讲价值"},
            ],
            "tone": "较稳",
        }
    )
    assert out.score == 82
    assert len(out.highlights) == 2
    assert out.highlights[0].type == "good"


def test_validate_eval_truncates_to_three():
    hl = [{"point": f"点{i}", "type": "good", "demo": "d"} for i in range(6)]
    out = _validate_eval({"score": 90, "highlights": hl, "tone": "好"})
    assert len(out.highlights) == 3


def test_validate_eval_clamps_score():
    out = _validate_eval({"score": 250, "highlights": [{"point": "x", "type": "good", "demo": "d"}], "tone": "t"})
    assert out.score == 100
    out2 = _validate_eval({"score": -5, "highlights": [{"point": "x", "type": "good", "demo": "d"}], "tone": "t"})
    assert out2.score == 0


def test_validate_eval_empty_highlights_raises():
    with pytest.raises(AppError) as e:
        _validate_eval({"score": 80, "highlights": [], "tone": "t"})
    assert e.value.code == "PARSE_ERROR"


def test_validate_eval_fills_missing_tone():
    out = _validate_eval({"score": 80, "highlights": [{"point": "x", "type": "good", "demo": "d"}]})
    assert out.tone


def test_validate_eval_rejects_unverified_price_in_reusable_script():
    with pytest.raises(AppError) as exc:
        _validate_eval({
            "score": 78,
            "highlights": [{"point": "应先问预算", "type": "bad", "demo": "我们全包大概13-16万。"}],
            "tone": "较稳",
        })
    assert exc.value.code == "PARSE_ERROR"


def test_transcript_format():
    msgs = [_msg("customer", "你好"), _msg("sales", "您好，请问有什么可以帮您？")]
    text = _transcript(msgs)
    assert "客户：你好" in text
    assert "销售：您好" in text


def test_both_ai_roles_keep_decoration_department_boundary():
    for role in ("sales", "customer"):
        telephone = _system(PracticeSession(
            industry="装修", scene="电销获客", customer_type="挑剔型", difficulty="温和", player_role=role,
        ))
        designer = _system(PracticeSession(
            industry="装修", scene="设计师逼单", customer_type="挑剔型", difficulty="温和", player_role=role,
        ))
        assert "电话初次接触" in telephone
        assert "不要把对话设定成陌生电话获客" in designer
        assert "不要把对话设定成已经量房" in telephone


def test_demo_review_rejects_obvious_fabricated_example():
    with pytest.raises(AppError) as exc:
        _validate_demo({
            "summary": "先说价值",
            "highlights": [
                {"point": "提供证据", "type": "good", "demo": "我们用 XX 品牌，去年客户零返修。"}
            ],
        })
    assert exc.value.code == "PARSE_ERROR"


def test_demo_review_rejects_unverified_numeric_claim():
    with pytest.raises(AppError) as exc:
        _validate_demo({
            "summary": "先核对报价",
            "highlights": [{"point": "澄清预算", "type": "good", "demo": "我们质保五年，可以放心。"}],
        })
    assert exc.value.code == "PARSE_ERROR"


def test_demo_review_rejects_overlong_summary():
    with pytest.raises(AppError) as exc:
        _validate_demo({
            "summary": "长" * 1001,
            "highlights": [{"point": "确认需求", "type": "good", "demo": "您最在意什么？"}],
        })
    assert exc.value.code == "PARSE_ERROR"
