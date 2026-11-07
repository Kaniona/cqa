"""Расчёт итога. Чистые функции, без базы. Точная арифметика на Fraction."""
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction


def rnd(x):
    """Округление только на выходе: половина вверх, 2 знака."""
    if x is None:
        return None
    x = Fraction(x)
    d = (Decimal(x.numerator) / Decimal(x.denominator)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return float(d)


def check_answer(criterion, answer):
    """Доля ответа (Fraction) или None для N/A. ValueError, если ответ недопустим."""
    cid = criterion["id"]
    if answer == "NA":
        if criterion.get("na_allowed") and not criterion.get("is_critical"):
            return None
        raise ValueError(f"{cid}: N/A не разрешён")
    if criterion["type"] == "yes_no":
        if answer in ("yes", "no"):
            return Fraction(answer == "yes")
        raise ValueError(f"{cid}: ожидается yes или no, получено {answer!r}")
    values = [s["value"] for s in criterion["steps"]]
    if isinstance(answer, (int, float)) and not isinstance(answer, bool) and answer in values:
        return Fraction(str(answer)) / Fraction(str(max(values)))
    raise ValueError(f"{cid}: ожидается одна из ступеней {values}, получено {answer!r}")


def compute(criteria, answers):
    ratios = {}
    for c in criteria:
        if c["id"] not in answers:
            raise ValueError(f"{c['id']}: нет ответа")
        ratios[c["id"]] = check_answer(c, answers[c["id"]])

    def weight(c):
        return Fraction(str(c["weight"]))

    def applicable(c):
        return not c.get("is_critical") and c["weight"] > 0 and ratios[c["id"]] is not None

    def total(cs):
        app = [c for c in cs if applicable(c)]
        wsum = sum(weight(c) for c in app)
        if not app:
            return None, wsum
        return 100 * sum(weight(c) * ratios[c["id"]] for c in app) / wsum, wsum

    value, wsum = total(criteria)
    per = []
    for c in criteria:
        r = ratios[c["id"]]
        ew = weight(c) * 100 / wsum if applicable(c) else Fraction(0)
        per.append({
            "criterion_id": c["id"],
            "section": c.get("section"),
            "answer": answers[c["id"]],
            "ratio": rnd(r),
            "base_weight": c["weight"],
            "effective_weight": rnd(ew),
            "points": rnd(ew * (r or 0)),
        })
    sections = [
        {"section": s, "total": rnd(total([c for c in criteria if c.get("section") == s])[0])}
        for s in dict.fromkeys(c.get("section") for c in criteria)
    ]
    flag = any(c.get("is_critical") and answers[c["id"]] == "yes" for c in criteria)
    return {"total": rnd(value), "critical_flag": flag, "per_criterion": per, "sections": sections}
