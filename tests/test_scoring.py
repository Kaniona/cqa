import pytest

from backend.scoring import compute
from tests.conftest import ROW1, STANDARD

CRITERIA = STANDARD["criteria"]


@pytest.mark.parametrize("changes, total, flag", [
    ({}, 85.50, False),
    ({"c07": "NA"}, 90.00, False),
    ({"c02": "NA", "c03": "NA", "c07": "NA", "c01": "yes", "c04": 10, "c05": "no", "c06": 10, "c08": "no"}, 58.33, False),
    ({"c08": "yes"}, 85.50, True),
    ({"c07": "yes"}, 90.50, False),
])
def test_table(changes, total, flag):
    r = compute(CRITERIA, {**ROW1, **changes})
    assert r["total"] == total
    assert r["critical_flag"] is flag


def test_all_na():
    criteria = [{**c, "na_allowed": True, "na_condition": "x"} for c in CRITERIA if not c["is_critical"]]
    r = compute(criteria, {c["id"]: "NA" for c in criteria})
    assert r["total"] is None and r["critical_flag"] is False
    assert all(s["total"] is None for s in r["sections"])


def test_weights_and_sections():
    r = compute(CRITERIA, {**ROW1, "c07": "NA"})
    per = {p["criterion_id"]: p for p in r["per_criterion"]}
    assert per["c07"]["effective_weight"] == 0 and per["c08"]["points"] == 0
    assert per["c01"]["effective_weight"] == 10.53  # 10 * 100 / 95
    assert {s["section"]: s["total"] for s in r["sections"]}["Общение"] == 70.0  # c06 = 7/10, c07 N/A


def test_invalid_answers():
    for bad in ({**ROW1, "c04": 12}, {**ROW1, "c01": "NA"}, {**ROW1, "c08": "NA"}, {k: v for k, v in ROW1.items() if k != "c05"}):
        with pytest.raises(ValueError):
            compute(CRITERIA, bad)
