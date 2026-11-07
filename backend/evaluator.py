"""Заглушка оценки: детерминированные допустимые ответы в фоновом потоке.

Человек 2 заменит этот файл, сохранив start_job, current_model и PROMPT_VERSION.
"""
import hashlib
import threading
import traceback

from . import db

PROMPT_VERSION = "mock"


def current_model():
    return "mock"


def start_job(job_id: int, evaluation_ids: list[int]) -> None:
    threading.Thread(target=_run, args=(evaluation_ids,), daemon=True).start()


def _run(evaluation_ids):
    for eid in evaluation_ids:
        try:
            db.set_evaluation_running(eid)
            results = _mock(db.get_evaluation_context(eid))
            db.save_evaluation_result(eid, results, current_model(), PROMPT_VERSION, "done")
        except Exception as e:
            traceback.print_exc()
            try:
                db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "error", str(e))
            except Exception:
                traceback.print_exc()


def _mock(ctx):
    conv = ctx["conversation"]
    utts = conv["transcript"]
    operator = [u for u in utts if u["speaker"] == "operator"] or utts
    results = []
    for c in ctx["checklist"]["criteria"]:
        h = int(hashlib.sha256(f"{conv['conversation_id']}|{c['id']}".encode()).hexdigest(), 16)
        if c.get("is_critical"):
            answer = "yes" if h % 10 == 0 else "no"
        else:
            options = ["yes", "yes", "no"] if c["type"] == "yes_no" else [s["value"] for s in c["steps"]]
            if c.get("na_allowed"):
                options.append("NA")
            answer = options[h % len(options)]
        u = operator[h % len(operator)]
        results.append({
            "criterion_id": c["id"],
            "answer": answer,
            "reason": "Заглушка: ответ выбран детерминированно, модель не вызывалась.",
            "evidence": [] if answer == "NA" else [{"id": u["id"], "quote": u["text"][:200], "verified": True}],
            "checked_range": {"from": utts[0]["id"], "to": utts[-1]["id"]},
        })
    return results
