import pytest

from app.core.errors import AppError
from app.services.parsers import parse_json


def test_parse_plain_json():
    assert parse_json('{"score": 80, "tone": "好"}') == {"score": 80, "tone": "好"}


def test_parse_json_with_code_fence():
    text = '```json\n{"score": 80, "tone": "好"}\n```'
    assert parse_json(text) == {"score": 80, "tone": "好"}


def test_parse_json_with_surrounding_text():
    text = '好的，点评如下：\n{"score": 80, "tone": "好"}\n以上。'
    assert parse_json(text) == {"score": 80, "tone": "好"}


def test_parse_invalid_raises():
    with pytest.raises(AppError) as e:
        parse_json("这不是 JSON")
    assert e.value.code == "PARSE_ERROR"


def test_parse_empty_raises():
    with pytest.raises(AppError) as e:
        parse_json("")
    assert e.value.code == "PARSE_ERROR"
