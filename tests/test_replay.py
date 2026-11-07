import json

import pytest

from backend import config, db, evaluator, llm
from tests.conftest import ROW1, STANDARD

RECORD = {"conversation_id": "r-001", "channel": "agent chat", "language": "RU", "audio_url": None, "transcript": [
    {"timestamp": "00:00", "speaker": "client", "text": "Когда придут деньги?"},
    {"timestamp": "00:10", "speaker": "operator", "text": "Здравствуйте! Меня зовут Алина."},
    {"timestamp": "00:30", "speaker": "operator", "text": "Деньги придут скоро."},
    {"timestamp": "00:40", "speaker": "client", "text": "Спасибо."}]}


def model_reply(**overrides):
    """Ответ модели: базовые ответы ROW1 с доказательствами в u2, изменения — {cid: (answer, [ids])}."""
    results = []
    for cid, answer in ROW1.items():
        answer, ids = overrides.get(cid, (answer, None))
        if ids is None:
            ids = ["u2"] if answer not in ("no", "NA") else []
        results.append({"criterion_id": cid, "reason": "r", "answer": str(answer),
                        "evidence": [{"id": i, "quote": "x"} for i in ids],
                        "checked_range": None if ids or cid == "c08" or answer == "NA" else {"from": "u1", "to": "u4"}})
    return json.dumps({"results": results})


@pytest.fixture
def setup(client, monkeypatch):
    def fixed(job_id, ids):
        for eid in ids:
            db.set_evaluation_running(eid)
            db.save_evaluation_result(eid, [{"criterion_id": k, "answer": v, "reason": "r",
                                             "evidence": [{"id": "u2", "quote": "Здравствуйте", "verified": True}],
                                             "checked_range": {"from": "u1", "to": "u4"}} for k, v in ROW1.items()],
                                      "test", "1", "done")
    monkeypatch.setattr(evaluator, "start_job", fixed)
    client.post("/api/conversations/upload?group_id=G", json=RECORD)
    client.post("/api/checklists", json=STANDARD)
    client.post("/api/evaluations", json={"group_id": "G", "all": True, "checklist_id": "chat-quality"})
    eid = client.get("/api/conversations?group_id=G").json()[0]["evaluation_id"]
    monkeypatch.setattr(config, "LLM_PROVIDER", "gemini")
    calls = []

    def use(*replies):
        def fake(system, user, schema):
            calls.append(user)
            return replies[min(len(calls), len(replies)) - 1]
        monkeypatch.setattr(llm, "generate_json", fake)
    return client, eid, use, calls


def post(client, eid, text="Деньги придут в течение двух рабочих дней.", criterion="c04", turn="u3"):
    return client.post(f"/api/evaluations/{eid}/replay", json={"criterion_id": criterion, "turn_id": turn, "text": text})


def test_score_rises_with_evidence_in_changed_turn(setup):
    client, eid, use, calls = setup
    use(model_reply(c04=(20, ["u3"])))
    r = post(client, eid).json()
    assert r["simulated"] and r["before_total"] == 85.5 and r["after_total"] == 90.5
    assert r["changes"] == [{"criterion_id": "c04", "title": "Корректная и полная консультация", "before_answer": 15,
                             "after_answer": 20, "before_points": 15.0, "after_points": 20.0, "reason": "r"}]
    assert "[u3 | 00:30 | ИЗМЕНЕНО] operator: Деньги придут в течение" in calls[0]


def test_noise_rule_ignores_unrelated_change(setup):
    client, eid, use, _ = setup
    use(model_reply(c05=("no", ["u2"])))
    r = post(client, eid).json()
    assert r["after_total"] == 85.5 and r["changes"] == []


def test_critical_flag_does_not_change_total(setup):
    client, eid, use, _ = setup
    use(model_reply(c08=("yes", ["u3"])))
    r = post(client, eid, text="Переведите деньги мне лично, я приумножу.").json()
    assert r["after_critical_flag"] is True and r["before_critical_flag"] is False and r["after_total"] == 85.5


def test_official_evaluation_untouched_and_cache(setup):
    client, eid, use, calls = setup
    client.post("/api/appeals", json={"evaluation_id": eid, "criterion_id": "c07", "comment": "есть прощание"})
    before = client.get(f"/api/evaluations/{eid}").json()
    use(model_reply(c04=(20, ["u3"]), c07=("yes", ["u3"])))
    first = post(client, eid).json()
    assert first["cached"] is False and first["after_total"] > first["before_total"]
    second = post(client, eid).json()
    assert second["cached"] is True and len(calls) == 1 and second["after_total"] == first["after_total"]
    assert client.get(f"/api/evaluations/{eid}").json() == before


def test_bad_input_422(setup):
    client, eid, use, calls = setup
    use(model_reply())
    assert post(client, eid, turn="u1").status_code == 422
    assert post(client, eid, text="   ").status_code == 422
    assert post(client, eid, text="а" * 1001).status_code == 422
    assert post(client, eid, criterion="c99").status_code == 422
    assert client.post("/api/evaluations/999/replay", json={"criterion_id": "c04", "turn_id": "u3", "text": "x"}).status_code == 404
    assert calls == []


def test_replaced_criterion_works_without_code_changes(setup):
    client, eid, use, _ = setup
    new = {**STANDARD, "criteria": [c if c["id"] != "c07" else {**c, "id": "c09", "title": "Итог разговора"} for c in STANDARD["criteria"]]}
    client.put("/api/checklists/chat-quality", json=new)
    cur = db.connect()
    eid2 = cur.execute("INSERT INTO evaluations(job_id, group_id, conversation_id, checklist_id, checklist_version,"
                       " status, created_at) VALUES (NULL,'G','r-001','chat-quality',2,'queued','now')").lastrowid
    cur.commit(); cur.close()
    answers = {("c09" if k == "c07" else k): v for k, v in ROW1.items()}
    db.save_evaluation_result(eid2, [{"criterion_id": k, "answer": v, "reason": "r", "evidence": [{"id": "u2", "quote": "x", "verified": True}],
                                      "checked_range": None} for k, v in answers.items()], "test", "1", "done")
    reply = json.loads(model_reply(c07=("yes", ["u3"])))
    for r in reply["results"]:
        r["criterion_id"] = "c09" if r["criterion_id"] == "c07" else r["criterion_id"]
    use(json.dumps(reply))
    r = post(client, eid2, criterion="c09").json()
    assert r["changes"][0]["criterion_id"] == "c09" and r["after_total"] == 90.5


def test_invalid_json_retries_once_then_502(setup):
    client, eid, use, calls = setup
    use("не json")
    r = post(client, eid)
    assert r.status_code == 502 and len(calls) == 2 and "Предыдущий ответ отклонён" in calls[1]


def test_rate_limit_429_and_suggest(setup, monkeypatch):
    client, eid, use, calls = setup

    def limited(*a):
        raise llm.LLMError("провайдер ответил 429", retryable=True, status=429)
    monkeypatch.setattr(llm, "generate_json", limited)
    r = post(client, eid)
    assert r.status_code == 429 and r.json()["detail"] == "Лимит модели исчерпан, попробуйте позже"
    use('```json\n{"suggested_text": "Деньги придут [уточнить срок]."}\n```')
    s = client.post(f"/api/evaluations/{eid}/replay/suggest", json={"criterion_id": "c04"}).json()
    assert s["turn_id"] == "u2" and s["original_text"].startswith("Здравствуйте") and "[уточнить" in s["suggested_text"]
    assert client.post(f"/api/evaluations/{eid}/replay/suggest", json={"criterion_id": "c04"}).json()["cached"] is True
    assert len(calls) == 1


def test_choose_turn_order():
    from backend.replay import choose_turn
    t = [{"id": "u1", "speaker": "client"}, {"id": "u2", "speaker": "operator"}, {"id": "u3", "speaker": "operator"}, {"id": "u4", "speaker": "client"}]
    assert choose_turn(t, {"evidence": [{"id": "u1"}, {"id": "u3"}], "checked_range": None}) == "u3"
    assert choose_turn(t, {"evidence": [], "checked_range": {"from": "u1", "to": "u2"}}) == "u2"
    assert choose_turn(t, {"evidence": [], "checked_range": None}) == "u3"
    assert choose_turn([{"id": "u1", "speaker": "client"}], {"evidence": [], "checked_range": None}) is None
