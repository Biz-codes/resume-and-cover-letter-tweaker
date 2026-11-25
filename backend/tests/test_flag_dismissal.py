"""Dismissing a writing flag and restoring it (app/flag_dismissal.py; docs/FRONTEND_CHECKS.md,
"Writing rules"): on a library item, kept when the same words are checked again; and in the
draft, a chat proposal, and a review's fix, each where it's kept."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.chat import _check_note
from app.flag_dismissal import FlagChoice, carry_dismissed, counted, set_dismissed
from app.models import BulletPoint, NarrativeContent
from tests import test_own_text
from tests.test_own_text import FLAG, filler, rule
from tests.test_sections_skills import add, error

# The own-text tests' stand-in for Claude, as a fixture here too.
claude = test_own_text.claude

OTHER = {"kind": "pattern", "rule": "em dashes used for drama", "quote": "—", "why": "Drama."}


def choice(flag: dict, dismissed: bool = True) -> dict:
    return {"kind": flag["kind"], "rule": flag["rule"], "quote": flag["quote"],
            "dismissed": dismissed}


def test_set_dismissed_marks_only_the_chosen_flag_and_restores_it():
    dismissed = set_dismissed([FLAG, OTHER], FlagChoice(**choice(FLAG)))
    assert dismissed == [FLAG | {"dismissed": True}, OTHER]
    assert counted(dismissed) == [OTHER]
    # Restoring leaves it as the check saved it.
    assert set_dismissed(dismissed, FlagChoice(**choice(FLAG, False))) == [FLAG, OTHER]


def test_a_new_check_keeps_dismissed_only_the_same_words():
    old = [FLAG | {"dismissed": True}]
    assert carry_dismissed(old, [FLAG, OTHER]) == [FLAG | {"dismissed": True}, OTHER]
    # Different words breaking the same rule are a new flag.
    assert carry_dismissed(old, [FLAG | {"quote": "leverages"}]) == [FLAG | {"quote": "leverages"}]


def test_claude_hears_which_flags_were_dismissed():
    note = _check_note({"flags": [FLAG | {"dismissed": True}, OTHER]})
    assert "still breaks these writing rules: em dashes used for drama" in note
    assert "dismissed these writing flags as fine here: leverage" in note


def test_an_items_flag_is_dismissed_and_restored(client: TestClient, db: Session, account_id: int):
    bullet = add(db, BulletPoint(account_id=account_id, content="Leveraged React — fast.",
                                 flags=[FLAG, OTHER]))
    url = f"/api/bullet-points/{bullet.bullet_id}/flags"
    response = client.put(url, json=choice(FLAG))
    assert response.status_code == 200, response.json()
    assert response.json()["flags"] == [FLAG | {"dismissed": True}, OTHER]
    db.expire_all()
    assert db.get(BulletPoint, bullet.bullet_id).flags == [FLAG | {"dismissed": True}, OTHER]

    restored = client.put(url, json=choice(FLAG, False)).json()
    assert restored["flags"] == [FLAG, OTHER]

    # A flag that isn't there (the text was checked again since) is NOT_FOUND.
    assert error(client.put(url, json=choice(FLAG | {"quote": "gone"})))[:2] == (404, "NOT_FOUND")

    excerpt = add(db, NarrativeContent(account_id=account_id, content="I leveraged apps.",
                                       flags=[FLAG]))
    body = client.put(f"/api/narrative-content/{excerpt.content_id}/flags",
                      json=choice(FLAG)).json()
    assert body["flags"] == [FLAG | {"dismissed": True}]


def test_a_dismissed_flag_stays_dismissed_when_checked_again(client: TestClient, db: Session,
                                                             account_id: int, claude):
    rule(db, account_id)
    filler(claude)
    bullet_id = client.post("/api/bullet-points", json={"content": "Leveraged React."}).json()[
        "bullet_id"]
    client.put(f"/api/bullet-points/{bullet_id}/flags", json=choice(FLAG))
    checked = client.post(f"/api/bullet-points/{bullet_id}/check").json()
    assert checked["flags"] == [FLAG | {"dismissed": True}]
    # "Check writing rules" on the library page counts only flags not dismissed.
    db.get(BulletPoint, bullet_id).flags = None
    db.commit()
    assert client.post("/api/bullet-points/check-unchecked").json()["flagged"] == 1
