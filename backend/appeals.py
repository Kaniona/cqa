"""Апелляции: подача, очередь, решение с пересчётом финального итога. ai_* не трогаем."""
import json
import sqlite3
from contextlib import closing

from fastapi import HTTPException

from . import db, scoring


def create(evaluation_id, criterion_id, comment, created_by=None):
    if not (comment or "").strip():
        raise HTTPException(422, "комментарий обязателен")
    with closing(db.connect()) as conn, conn:
        ev = db.row(conn, "SELECT status FROM evaluations WHERE id=?", (evaluation_id,))
        if ev is None:
            raise HTTPException(404, "оценка не найдена")
        if ev["status"] not in ("done", "needs_review"):
            raise HTTPException(409, f"апелляция невозможна: статус оценки {ev['status']}")
        if not db.row(conn, "SELECT 1 FROM criterion_results WHERE evaluation_id=? AND criterion_id=?",
                      (evaluation_id, criterion_id)):
            raise HTTPException(404, "критерий в оценке не найден")
        try:
            cur = conn.execute(
                "INSERT INTO appeals(evaluation_id, criterion_id, comment, status, created_by, created_at)"
                " VALUES (?,?,?,'open',?,?)", (evaluation_id, criterion_id, comment.strip(), created_by, db.now()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "по этому критерию уже есть открытая апелляция")
        return db.row(conn, "SELECT * FROM appeals WHERE id=?", (cur.lastrowid,))


def queue(status=None):
    with closing(db.connect()) as conn:
        appeals = db.rows(conn, "SELECT * FROM appeals" + (" WHERE status=?" if status else "") + " ORDER BY id",
                          (status,) if status else ())
        out = []
        for a in appeals:
            ev = db.row(conn, "SELECT * FROM evaluations WHERE id=?", (a["evaluation_id"],))
            criteria = db.get_checklist(conn, ev["checklist_id"], ev["checklist_version"])["criteria"]
            criterion = next(c for c in criteria if c["id"] == a["criterion_id"])
            r = db.row(conn, "SELECT * FROM criterion_results WHERE evaluation_id=? AND criterion_id=?",
                       (a["evaluation_id"], a["criterion_id"]))
            evidence = json.loads(r["evidence_json"] or "[]")
            checked = json.loads(r["checked_range_json"] or "null")
            conv = db.get_conversation(conn, ev["group_id"], ev["conversation_id"])
            transcript = conv["transcript"]
            out.append({
                **a,
                "new_answer": json.loads(a["new_answer"]) if a["new_answer"] is not None else None,
                "group_id": ev["group_id"], "conversation_id": ev["conversation_id"],
                "language": conv["language"], "channel": conv["channel"],
                "criterion": criterion, "title": criterion["title"], "type": criterion["type"],
                "steps": criterion.get("steps"), "na_allowed": bool(criterion.get("na_allowed")),
                "ai_total": ev["ai_total"], "final_total": ev["final_total"],
                "ai_answer": json.loads(r["ai_answer"]), "final_answer": json.loads(r["final_answer"]),
                "reason": r["reason"], "evidence": evidence, "checked_range": checked,
                "fragment": _fragment(transcript, [e.get("id") for e in evidence], checked),
            })
        return out


def _fragment(transcript, evidence_ids, checked):
    """Реплики вокруг доказательств (±2), а без них — проверенный участок."""
    index = {u["id"]: i for i, u in enumerate(transcript)}
    hits = [index[i] for i in evidence_ids if i in index]
    if hits:
        return transcript[max(min(hits) - 2, 0): max(hits) + 3]
    if checked and checked.get("from") in index and checked.get("to") in index:
        return transcript[index[checked["from"]]: index[checked["to"]] + 1]
    return []


def decide(appeal_id, decision, new_answer, decision_reason, decided_by=None):
    if decision not in ("confirmed", "changed"):
        raise HTTPException(422, "decision должен быть confirmed или changed")
    if not (decision_reason or "").strip():
        raise HTTPException(422, "decision_reason обязателен")
    with closing(db.connect()) as conn, conn:  # решение и пересчёт — одна транзакция
        a = db.row(conn, "SELECT * FROM appeals WHERE id=?", (appeal_id,))
        if a is None:
            raise HTTPException(404, "апелляция не найдена")
        if a["status"] != "open":
            raise HTTPException(409, "по апелляции уже есть решение")
        eid = a["evaluation_id"]
        if decision == "changed":
            ev = db.row(conn, "SELECT * FROM evaluations WHERE id=?", (eid,))
            criteria = db.get_checklist(conn, ev["checklist_id"], ev["checklist_version"])["criteria"]
            criterion = next(c for c in criteria if c["id"] == a["criterion_id"])
            if new_answer is None:
                raise HTTPException(422, "для changed нужен new_answer")
            if criterion["type"] == "scale" and isinstance(new_answer, str) and new_answer != "NA":
                try:  # из <select> ступень приходит строкой
                    new_answer = float(new_answer) if "." in new_answer else int(new_answer)
                except ValueError:
                    pass
            try:
                scoring.check_answer(criterion, new_answer)
            except ValueError as e:
                raise HTTPException(422, str(e))
            conn.execute("UPDATE criterion_results SET final_answer=? WHERE evaluation_id=? AND criterion_id=?",
                         (json.dumps(new_answer), eid, a["criterion_id"]))
            answers = {r["criterion_id"]: json.loads(r["final_answer"]) for r in
                       db.rows(conn, "SELECT * FROM criterion_results WHERE evaluation_id=?", (eid,))}
            comp = scoring.compute(criteria, answers)
            for pc in comp["per_criterion"]:
                conn.execute("UPDATE criterion_results SET effective_weight=?, points=?"
                             " WHERE evaluation_id=? AND criterion_id=?",
                             (pc["effective_weight"], pc["points"], eid, pc["criterion_id"]))
            conn.execute("UPDATE evaluations SET final_total=?, final_critical_flag=? WHERE id=?",
                         (comp["total"], comp["critical_flag"], eid))
        conn.execute(
            "UPDATE appeals SET status='resolved', decision=?, new_answer=?, decision_reason=?, decided_by=?, decided_at=?"
            " WHERE id=?",
            (decision, json.dumps(new_answer) if decision == "changed" else None,
             decision_reason.strip(), decided_by, db.now(), appeal_id))
    with closing(db.connect()) as conn:
        return db.get_evaluation(conn, eid)
