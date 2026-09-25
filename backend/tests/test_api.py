def _create_session(client):
    r = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "挑剔型", "difficulty": "难缠"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return body["session"]["id"], body["opening"]


def test_create_session(client, mock_llm):
    sid, opening = _create_session(client)
    assert sid
    assert opening == "喂？你们家这个怎么收费啊？"


def test_send_message_streams_reply(client, mock_llm):
    sid, _ = _create_session(client)
    r = client.post(f"/api/v1/practice/sessions/{sid}/messages", json={"content": "您好，请问您想了解哪方面？"})
    assert r.status_code == 200, r.text
    assert "event: chunk" in r.text
    assert "event: done" in r.text
    assert "隔壁好像更便宜" in r.text


def test_end_session_returns_evaluation(client, mock_llm):
    sid, _ = _create_session(client)
    client.post(f"/api/v1/practice/sessions/{sid}/messages", json={"content": "您好，请问您想了解哪方面？"})
    r = client.post(f"/api/v1/practice/sessions/{sid}/end")
    assert r.status_code == 200, r.text
    ev = r.json()["evaluation"]
    assert ev["score"] == 82
    assert len(ev["highlights"]) == 2


def test_rescue_returns_hint(client, mock_llm):
    sid, _ = _create_session(client)
    r = client.post(f"/api/v1/practice/sessions/{sid}/rescue")
    assert r.status_code == 200, r.text
    assert r.json()["hint"] == "往价格上引"


def test_assistant_chat_streams(client, mock_llm):
    r = client.post("/api/v1/assistant/chat", json={"question": "客户说太贵了怎么回？"})
    assert r.status_code == 200, r.text
    assert "event: done" in r.text


def test_list_and_get_session(client, mock_llm):
    sid, _ = _create_session(client)
    r = client.get("/api/v1/practice/sessions")
    assert r.status_code == 200
    assert len(r.json()["sessions"]) == 1

    r = client.get(f"/api/v1/practice/sessions/{sid}")
    assert r.status_code == 200
    assert len(r.json()["messages"]) == 1  # 开场白


def test_history_list_exposes_only_sales_scores(client, mock_llm):
    sales_id, _ = _create_session(client)
    client.post(f"/api/v1/practice/sessions/{sales_id}/messages", json={"content": "您好，请问您想了解哪方面？"})
    client.post(f"/api/v1/practice/sessions/{sales_id}/end")
    customer_id = client.post("/api/v1/practice/sessions", json={
        "industry": "装修", "customer_type": "挑剔型", "difficulty": "难缠", "player_role": "customer",
    }).json()["session"]["id"]
    client.post(f"/api/v1/practice/sessions/{customer_id}/messages", json={"content": "你们有什么优势？"})
    client.post(f"/api/v1/practice/sessions/{customer_id}/end")
    rows = {row["id"]: row for row in client.get("/api/v1/practice/sessions").json()["sessions"]}
    assert rows[sales_id]["score"] == 82
    assert rows[customer_id]["score"] is None


def test_send_message_not_found(client, mock_llm):
    r = client.post("/api/v1/practice/sessions/nonexist/messages", json={"content": "你好"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


def test_end_too_short_returns_conflict(client, mock_llm):
    sid, _ = _create_session(client)
    r = client.post(f"/api/v1/practice/sessions/{sid}/end")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "INVALID_STATE"


def test_invalid_industry_rejected(client, mock_llm):
    r = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "房地产", "customer_type": "挑剔型", "difficulty": "难缠"},
    )
    assert r.status_code == 422


def test_decoration_departments_are_persisted_and_reach_prompt(client, mock_llm, monkeypatch):
    from app.services import llm
    calls = []

    async def capture(messages, **kwargs):
        calls.append(messages[0]["content"])
        return "您好，想了解一下。"

    monkeypatch.setattr(llm, "chat", capture)
    ids = []
    for scene in ("电销获客", "设计师逼单"):
        response = client.post("/api/v1/practice/sessions", json={
            "industry": "装修", "scene": scene, "customer_type": "挑剔型", "difficulty": "温和",
        })
        assert response.status_code == 200, response.text
        ids.append(response.json()["session"]["id"])
        assert response.json()["session"]["scene"] == scene
    assert "电话初次接触" in calls[0]
    assert "量房" in calls[1]
    assert "电话初次接触" not in calls[1]
    rows = {row["id"]: row for row in client.get("/api/v1/practice/sessions").json()["sessions"]}
    assert [rows[sid]["scene"] for sid in ids] == ["电销获客", "设计师逼单"]
    assert client.get(f"/api/v1/practice/sessions/{ids[1]}").json()["session"]["scene"] == "设计师逼单"


def test_scene_rejects_wrong_industry_or_unknown_department(client, mock_llm):
    for industry, scene in (("保险", "电销获客"), ("装修", "施工部")):
        response = client.post("/api/v1/practice/sessions", json={
            "industry": industry, "scene": scene, "customer_type": "挑剔型", "difficulty": "温和",
        })
        assert response.status_code == 422


def test_customer_role_gets_ai_sales_and_demo_review(client, mock_llm):
    created = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "爱砍价型", "difficulty": "难缠", "player_role": "customer"},
    )
    assert created.status_code == 200
    sid = created.json()["session"]["id"]
    assert created.json()["session"]["player_role"] == "customer"
    assert created.json()["opening"] == ""  # The human customer opens first.
    turn = client.post(f"/api/v1/practice/sessions/{sid}/messages", json={"content": "你们价格太高了"})
    assert turn.status_code == 200
    assert "我理解您担心价格" in turn.text
    details = client.get(f"/api/v1/practice/sessions/{sid}").json()
    assert [m["role"] for m in details["messages"]] == ["customer", "sales"]
    review = client.post(f"/api/v1/practice/sessions/{sid}/end")
    assert review.status_code == 200
    assert review.json()["evaluation"]["kind"] == "demo"
    assert "score" not in review.json()["evaluation"]
    assert client.get(f"/api/v1/practice/sessions/{sid}").json()["evaluation"] == review.json()["evaluation"]
    assert client.post(f"/api/v1/practice/sessions/{sid}/end").json()["evaluation"] == review.json()["evaluation"]


def test_customer_role_rescue_is_unavailable(client, mock_llm):
    sid = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "挑剔型", "difficulty": "温和", "player_role": "customer"},
    ).json()["session"]["id"]
    r = client.post(f"/api/v1/practice/sessions/{sid}/rescue")
    assert r.status_code == 409


def test_invalid_player_role_rejected(client, mock_llm):
    r = client.post(
        "/api/v1/practice/sessions",
        json={"industry": "装修", "customer_type": "挑剔型", "difficulty": "温和", "player_role": "observer"},
    )
    assert r.status_code == 422
