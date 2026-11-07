"""Чек-листы: проверка и версии. Старые версии не меняются, PUT всегда создаёт новую."""
import json
import time
from contextlib import closing

from fastapi import HTTPException

from . import config, db


def validate(cl):
    """422 при ошибке; иначе список предупреждений."""
    errors = []
    if not isinstance(cl, dict):
        raise HTTPException(422, "чек-лист должен быть объектом")
    if not str(cl.get("id") or "").strip():
        errors.append("нет id чек-листа")
    if not str(cl.get("name") or "").strip():
        errors.append("нет названия чек-листа")
    criteria = cl.get("criteria")
    if not isinstance(criteria, list) or not criteria:
        raise HTTPException(422, "; ".join(errors + ["нужен хотя бы один критерий"]))
    seen = set()
    for i, c in enumerate(criteria, 1):
        if not isinstance(c, dict):
            errors.append(f"критерий {i}: должен быть объектом")
            continue
        name = c.get("id") or f"№{i}"
        if not str(c.get("id") or "").strip():
            errors.append(f"критерий {i}: нет id")
        elif c["id"] in seen:
            errors.append(f"{name}: id повторяется")
        seen.add(c.get("id"))
        for field in ("title", "instruction"):
            if not str(c.get(field) or "").strip():
                errors.append(f"{name}: пустое поле {field}")
        weight = c.get("weight")
        if not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight < 0:
            errors.append(f"{name}: weight должен быть числом >= 0")
        if c.get("type") not in ("yes_no", "scale"):
            errors.append(f"{name}: type должен быть yes_no или scale")
        elif c["type"] == "scale":
            steps = c.get("steps")
            values = [s.get("value") for s in steps if isinstance(s, dict)] if isinstance(steps, list) else []
            if (len(values) < 2 or len(values) != len(steps)
                    or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 for v in values)
                    or len(set(values)) != len(values) or max(values) <= 0):
                errors.append(f"{name}: у шкалы нужно >= 2 ступеней с разными значениями >= 0 и максимум > 0")
        if c.get("is_critical"):
            if c.get("type") != "yes_no" or weight != 0 or c.get("na_allowed"):
                errors.append(f"{name}: критический критерий — только yes_no, вес 0, без N/A")
        if c.get("na_allowed") and not str(c.get("na_condition") or "").strip():
            errors.append(f"{name}: при na_allowed нужно na_condition")
    if errors:
        raise HTTPException(422, "; ".join(errors))
    total = sum(c["weight"] for c in criteria)
    return [] if total == 100 else [f"сумма весов {total}, а не 100"]


def _insert(conn, cl, version):
    created = db.now()
    conn.execute("INSERT INTO checklists VALUES (?,?,?,?,?)",
                 (cl["id"], version, cl["name"], json.dumps(cl["criteria"], ensure_ascii=False), created))
    return {"id": cl["id"], "version": version, "name": cl["name"], "criteria": cl["criteria"], "created_at": created}


def create(cl):
    if isinstance(cl, dict) and not str(cl.get("id") or "").strip():
        cl = {**cl, "id": f"checklist-{int(time.time() * 1000)}"}  # сайт создаёт чек-лист без id
    warnings = validate(cl)
    with closing(db.connect()) as conn, conn:
        if db.get_checklist(conn, cl["id"]):
            raise HTTPException(409, f"чек-лист {cl['id']} уже есть, новая версия — через PUT")
        return {**_insert(conn, cl, 1), "warnings": warnings}


def new_version(checklist_id, cl):
    if isinstance(cl, dict):
        cl = {**cl, "id": checklist_id}
    warnings = validate(cl)
    with closing(db.connect()) as conn, conn:
        last = db.get_checklist(conn, checklist_id)
        return {**_insert(conn, cl, last["version"] + 1 if last else 1), "warnings": warnings}


def latest_all():
    with closing(db.connect()) as conn:
        ids = [r["id"] for r in conn.execute("SELECT DISTINCT id FROM checklists ORDER BY id")]
        return [db.get_checklist(conn, i) for i in ids]


def versions(checklist_id):
    with closing(db.connect()) as conn:
        r = db.rows(conn, "SELECT id, version, name, created_at FROM checklists WHERE id=? ORDER BY version DESC",
                    (checklist_id,))
    if not r:
        raise HTTPException(404, "чек-лист не найден")
    return r


def get(checklist_id, version):
    with closing(db.connect()) as conn:
        cl = db.get_checklist(conn, checklist_id, version)
    if not cl:
        raise HTTPException(404, "версия чек-листа не найдена")
    return cl


def seed_if_empty():
    with closing(db.connect()) as conn:
        empty = conn.execute("SELECT COUNT(*) FROM checklists").fetchone()[0] == 0
    if empty and config.SEED_CHECKLIST.exists():
        cl = json.loads(config.SEED_CHECKLIST.read_text(encoding="utf-8") or "{}")
        if cl.get("criteria"):
            create(cl)
