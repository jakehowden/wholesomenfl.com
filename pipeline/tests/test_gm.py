import json
from datetime import datetime, timedelta, timezone

import pytest

from pipeline import config, gm
from pipeline.crypto import decrypt_json
from pipeline.schema import validate

NOW = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
ME = 1
POS = ["QB", "RB", "WR", "TE"]


def player(i, pos, rid, ros, pos_rank, tag="HOLD"):
    return {
        "id": str(i), "name": f"P{i}", "pos": pos, "team": "KC", "bye": 10, "injury": None,
        "roster_id": rid, "proj": {str(w): 10.0 for w in range(5, 18)}, "ros": float(ros),
        "ros_playoff": ros / 4, "ros_rank": i, "ros_pos_rank": pos_rank, "repl": 8.0,
        "season": {"games": 4, "pts": 60.0, "ppg": 15.0, "xfp": 55.0, "xfp_pg": 13.75},
        "signals": {"usage_trend": 0.1, "usage_metric": "target_share", "usage_series": [], "snap_series": [],
                    "luck": 5.0, "market_drift": None, "fc_value": 1000.0, "fc_rank": i, "market_gap": 0.0,
                    "fc_history": [], "breakout": None},
        "tag": tag, "tag_reasons": [],
    }


def team(rid, strength):
    return {"roster_id": rid, "owner": f"o{rid}", "avatar": None, "wins": 3, "losses": 1, "ties": 0,
            "pf": 500.0, "pa": 450.0, "all_play_w": 30, "all_play_l": 10, "ros_strength": 120.0,
            "pos_strength": strength, "playoff_odds": 0.6, "seed_dist": [0.1] * 10, "proj_wins": 8.5,
            "faab_left": 150.0, "roster": []}


@pytest.fixture
def world():
    players, i = [], 0
    for rid in [ME, 2, 3, 4, None, None, None, None, None, None, None, None]:
        for pos in POS:
            for _ in range(4):
                i += 1
                players.append(player(i, pos, rid, ros=1000 - i, pos_rank=i % 40 + 1))
    league = {
        "teams": [team(ME, {"QB": -5.0, "RB": 3.0, "WR": -1.0, "TE": -2.0, "K": 0.0, "DEF": 0.0})]
                 + [team(r, {p: 0.0 for p in POS + ["K", "DEF"]}) for r in (2, 3, 4)],
        "schedule": [{"week": 5, "matchups": [[1, 2], [3, 4]]}],
        "transactions": [], "sim": {"runs": 10, "sd": 22.0},
    }
    return players, league


def test_weak_positions(world):
    _, league = world
    assert gm.weak_positions(league["teams"][0]) == ["QB", "TE", "WR"]


def test_scope_deterministic_capped_and_prioritised(world):
    players, league = world
    a = gm.select_scope(players, league, ME, {}, {}, NOW, cap=80)
    b = gm.select_scope(list(reversed(players)), league, ME, {}, {}, NOW, cap=80)
    assert a == b
    assert len(a) == len(set(a)) <= 80
    by_id = {p["id"]: p for p in players}
    mine = [p["id"] for p in players if p["roster_id"] == ME]
    assert set(a[:len(mine)]) == set(mine)  # my roster comes first
    rivals = [by_id[x] for x in a if by_id[x]["roster_id"] not in (None, ME)]
    assert 0 < len(rivals) <= gm.RIVAL_N
    assert all(p["pos"] in ("QB", "TE", "WR") and p["ros_pos_rank"] <= config.STARTERS[p["pos"]] for p in rivals)
    assert sum(by_id[x]["roster_id"] is None for x in a) <= gm.FA_N
    assert len(gm.select_scope(players, league, ME, {}, {}, NOW, cap=5)) == 5


def test_scope_skips_fresh_unless_tag_changed(world):
    players, league = world
    mine = sorted((p for p in players if p["roster_id"] == ME), key=lambda p: -p["ros"])
    fresh, stale, flipped = mine[0]["id"], mine[1]["id"], mine[2]["id"]
    o = {"signal": "HOLD", "summary": "", "risks": [], "sources": [], "model": "m"}
    outlooks = {fresh: dict(o, updated=(NOW - timedelta(days=1)).isoformat()),
                stale: dict(o, updated=(NOW - timedelta(days=4)).isoformat()),
                flipped: dict(o, updated=(NOW - timedelta(days=1)).isoformat())}
    prev = {p["id"]: dict(p) for p in players}
    prev[flipped]["tag"] = "SELL"
    ids = gm.select_scope(players, league, ME, prev, outlooks, NOW)
    assert fresh not in ids and stale in ids and flipped in ids


def test_scope_includes_tag_changes_outside_other_buckets(world):
    players, league = world
    deep = min((p for p in players if p["roster_id"] in (2, 3, 4) and p["pos"] == "RB"), key=lambda p: p["ros"])
    prev = {deep["id"]: dict(deep, tag="BUY")}
    assert deep["id"] not in gm.select_scope(players, league, ME, {}, {}, NOW, cap=200)
    assert deep["id"] in gm.select_scope(players, league, ME, prev, {}, NOW, cap=200)


@pytest.fixture
def dirs(tmp_path, monkeypatch, world):
    players, league = world
    out = tmp_path / "out"
    out.mkdir()
    monkeypatch.setattr(config, "OUT_DIR", out)
    monkeypatch.setattr(config, "HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(gm, "WORK_DIR", tmp_path / "gm")
    meta = {"generated_at": NOW.isoformat(), "season": "2026", "week": 5, "league_id": "x",
            "my_roster_id": ME, "sources": {}, "llm_generated_at": None}
    for name, obj in (("meta.json", meta), ("players.json", players), ("league.json", league)):
        (out / name).write_text(json.dumps(obj), encoding="utf-8")
    return out, tmp_path / "gm"


def test_prep_writes_context(dirs):
    _, work = dirs
    ctx = gm.prep(cap=7, now=NOW)
    on_disk = json.loads((work / "context.json").read_text(encoding="utf-8"))
    assert on_disk == ctx and ctx["week"] == 5 and len(ctx["outlook_players"]) == 7
    assert ctx["briefing_input"]["my_team"]["roster_id"] == ME


def test_publish_merges_outlooks_and_encrypts_briefing(dirs, monkeypatch):
    out, work = dirs
    work.mkdir()
    (work / "outlooks.json").write_text(json.dumps({"3": {
        "signal": "BUY", "summary": "Role growing.", "risks": ["hamstring"],
        "sources": [{"title": "Beat report", "url": "https://a.example/1"}]}}), encoding="utf-8")
    (work / "outlooks.part2.json").write_text(json.dumps({"4": {
        "signal": "SELL", "summary": "Touchdown luck.", "risks": [], "sources": []}}), encoding="utf-8")
    (work / "briefing.json").write_text(json.dumps({
        "situation": "1-7.", "reasoning": "QB is the hole.",
        "moves": [{"kind": "trade", "title": "Buy", "detail": "X for Y", "player_ids": ["3"]}]}), encoding="utf-8")
    monkeypatch.setenv("BRIEFING_PASSPHRASE", "pw")
    gm.publish(now=NOW)

    outlooks = json.loads((out / "outlooks.json").read_text(encoding="utf-8"))
    validate("outlooks", outlooks)
    assert set(outlooks) == {"3", "4"} and not list(work.glob("outlooks*.json"))
    assert outlooks["3"]["model"] == gm.MODEL_LABEL and outlooks["3"]["updated"] == NOW.isoformat(timespec="seconds")
    brief = decrypt_json((out / "private" / "briefing.enc").read_text(encoding="utf-8"), "pw")
    assert brief["week"] == 5 and brief["moves"][0]["player_ids"] == ["3"]
    assert not (work / "briefing.json").exists()  # plaintext never left behind
    assert json.loads((out / "meta.json").read_text(encoding="utf-8"))["llm_generated_at"]


def test_publish_refuses_briefing_without_passphrase(dirs, monkeypatch):
    out, work = dirs
    work.mkdir()
    (work / "briefing.json").write_text(json.dumps(
        {"situation": "s", "reasoning": "r", "moves": []}), encoding="utf-8")
    monkeypatch.delenv("BRIEFING_PASSPHRASE", raising=False)
    with pytest.raises(SystemExit):
        gm.publish(now=NOW)
    assert not (out / "private" / "briefing.enc").exists()
