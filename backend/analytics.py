"""Сводка по последней оценке каждого диалога, по финальным ответам."""
import json
from collections import Counter, defaultdict
from contextlib import closing

from . import db, scoring


def _avg(values):
    return round(sum(values) / len(values), 2) if values else None


def summary(group_id=None, checklist_id=None):
    with closing(db.connect()) as conn:
        evs = db.latest_evaluations(conn, group_id, checklist_id)
        convs = {(c["group_id"], c["conversation_id"]): c for c in
                 db.rows(conn, "SELECT group_id, conversation_id, channel, language FROM conversations")}
        checklists = {}
        ratios, na_count, titles = defaultdict(list), Counter(), {}
        for ev in evs:
            key = (ev["checklist_id"], ev["checklist_version"])
            if key not in checklists:
                checklists[key] = {c["id"]: c for c in db.get_checklist(conn, *key)["criteria"]}
            for r in db.rows(conn, "SELECT criterion_id, final_answer FROM criterion_results WHERE evaluation_id=?",
                             (ev["id"],)):
                c = checklists[key][r["criterion_id"]]
                if c.get("is_critical"):
                    continue
                titles[c["id"]] = c["title"]
                ratio = scoring.check_answer(c, json.loads(r["final_answer"]))
                if ratio is None:
                    na_count[c["id"]] += 1
                else:
                    ratios[c["id"]].append(float(ratio))
        ids = [ev["id"] for ev in evs]
        appeals = Counter(r["status"] for r in db.rows(
            conn, f"SELECT status FROM appeals WHERE evaluation_id IN ({','.join('?' * len(ids))})", ids)) if ids else {}

    scored = [ev for ev in evs if ev["final_total"] is not None]

    def breakdown(field):
        groups = defaultdict(list)
        for ev in evs:
            groups[convs[(ev["group_id"], ev["conversation_id"])][field]].append(ev)
        return [{field: k, "count": len(v), "average_total": _avg([e["final_total"] for e in v
                                                                   if e["final_total"] is not None])}
                for k, v in sorted(groups.items())]

    weak = [{"criterion_id": cid, "title": titles[cid], "average_ratio": _avg(ratios[cid]), "na_count": na_count[cid]}
            for cid in titles]
    weak.sort(key=lambda w: (w["average_ratio"] is None, w["average_ratio"] or 0))
    return {
        "evaluated": len(scored),
        "average_total": _avg([ev["final_total"] for ev in scored]),
        "critical_count": sum(1 for ev in evs if ev["final_critical_flag"]),
        "needs_review": sum(1 for ev in evs if ev["status"] == "needs_review"),
        "weak_criteria": weak,
        "by_language": breakdown("language"),
        "by_channel": breakdown("channel"),
        "appeals": {"total": sum(appeals.values()), "open": appeals.get("open", 0),
                    "confirmed": appeals.get("confirmed", 0), "changed": appeals.get("changed", 0)},
    }
