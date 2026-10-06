import json
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import pytest

from pipeline import config, llm
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
    assert llm.weak_positions(league["teams"][0]) == ["QB", "TE", "WR"]


def test_scope_deterministic_capped_and_prioritised(world):
    players, league = world
    a = llm.select_scope(players, league, ME, {}, {}, NOW)
    b = llm.select_scope(list(reversed(players)), league, ME, {}, {}, NOW)
    assert a == b
    assert len(a) == len(set(a)) <= config.LLM_OUTLOOK_CAP
    by_id = {p["id"]: p for p in players}
    mine = [p["id"] for p in players if p["roster_id"] == ME]
    assert set(a[:len(mine)]) == set(mine)  # my roster comes first
    rivals = [by_id[x] for x in a if by_id[x]["roster_id"] not in (None, ME)]
    assert 0 < len(rivals) <= llm.RIVAL_N
    assert all(p["pos"] in ("QB", "TE", "WR") and p["ros_pos_rank"] <= config.STARTERS[p["pos"]] for p in rivals)
    assert sum(by_id[x]["roster_id"] is None for x in a) <= llm.FA_N
    assert len(llm.select_scope(players, league, ME, {}, {}, NOW, cap=5)) == 5


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
    ids = llm.select_scope(players, league, ME, prev, outlooks, NOW)
    assert fresh not in ids and stale in ids and flipped in ids


def test_scope_includes_tag_changes_outside_other_buckets(world):
    players, league = world
    deep = min((p for p in players if p["roster_id"] in (2, 3, 4) and p["pos"] == "RB"), key=lambda p: p["ros"])
    prev = {deep["id"]: dict(deep, tag="BUY")}
    assert deep["id"] not in llm.select_scope(players, league, ME, {}, {}, NOW)
    assert deep["id"] in llm.select_scope(players, league, ME, prev, {}, NOW)


class FakeClient:
    """Mimics client.beta.messages.create; no network."""

    def __init__(self):
        self.calls, self.lock = [], threading.Lock()
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **kw):
        with self.lock:
            self.calls.append(kw)
        if kw["model"] == llm.OUTLOOK_MODEL:
            assert kw["tools"][0]["type"] == "web_search_20260209" and kw["tools"][0]["max_uses"] == 3
            search = NS(type="web_search_tool_result", content=[
                NS(type="web_search_result", url="https://a.example/1", title="Beat report"),
                NS(type="web_search_result", url="https://a.example/2", title="Injury news")])
            body = {"signal": "BUY", "summary": "Role is growing. Schedule softens.", "risks": ["hamstring"]}
        else:
            assert "tools" not in kw
            inp = kw["messages"][0]["content"]
            pid = json.loads(inp.split("\n", 1)[1].split("\n\n")[0])["my_roster"][0]["id"]
            search = None
            body = {"situation": "3-1, 60% playoff odds.", "reasoning": "QB is the hole.",
                    "moves": [{"kind": "trade", "title": "Buy a QB", "detail": "Offer X for Y", "player_ids": [pid]},
                              {"kind": "waiver", "title": "Claim", "detail": "Bid 10", "player_ids": []},
                              {"kind": "lineup", "title": "Start", "detail": "Start Z", "player_ids": []}]}
        content = ([search] if search else []) + [NS(type="text", text=json.dumps(body), citations=None)]
        return NS(stop_reason="end_turn", content=content)


def _setup(tmp_path, monkeypatch, world):
    players, league = world
    monkeypatch.setattr(config, "OUT_DIR", tmp_path / "out")
    monkeypatch.setattr(config, "HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr("pipeline.run.my_roster_id", lambda data: ME)
    monkeypatch.setattr(llm, "_now", lambda: NOW)
    return {"players_out": players, "league_out": league, "week": 5, "season": "2026", "llm_limit": 3}


def test_build_with_mocked_client(tmp_path, monkeypatch, world):
    data = _setup(tmp_path, monkeypatch, world)
    monkeypatch.setenv("BRIEFING_PASSPHRASE", "pw")
    client = FakeClient()
    llm.build(data, client=client)

    outlooks = json.loads((config.OUT_DIR / "outlooks.json").read_text(encoding="utf-8"))
    validate("outlooks", outlooks)
    assert len(outlooks) == 3
    o = next(iter(outlooks.values()))
    assert o["signal"] == "BUY" and o["model"] == llm.OUTLOOK_MODEL and len(o["sources"]) == 2
    assert all(c["fallbacks"] == "default" for c in client.calls)
    assert [c["model"] for c in client.calls].count(llm.BRIEFING_MODEL) == 1

    brief = decrypt_json((config.OUT_DIR / "private" / "briefing.enc").read_text(encoding="utf-8"), "pw")
    validate("briefing", brief)
    assert brief["week"] == 5 and len(brief["moves"]) == 3
    assert data["llm_generated_at"] == NOW.isoformat(timespec="seconds")


def test_build_skips_briefing_without_passphrase(tmp_path, monkeypatch, world):
    data = _setup(tmp_path, monkeypatch, world)
    monkeypatch.delenv("BRIEFING_PASSPHRASE", raising=False)
    client = FakeClient()
    llm.build(data, client=client)
    assert not (config.OUT_DIR / "private" / "briefing.enc").exists()
    assert all(c["model"] == llm.OUTLOOK_MODEL for c in client.calls)


def test_build_skips_without_key(tmp_path, monkeypatch, world):
    data = _setup(tmp_path, monkeypatch, world)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    llm.build(data)
    assert not (config.OUT_DIR / "outlooks.json").exists()
    assert "llm_generated_at" not in data
