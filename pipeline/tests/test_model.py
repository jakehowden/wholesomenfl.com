import pandas as pd
import pytest

from pipeline import config, model
from pipeline.schema import validate

SCORING = {"rec": 0.5, "rec_yd": 0.1, "rec_td": 6.0, "pass_yd": 0.04, "pass_td": 6.0, "rush_yd": 0.1}


def test_bye_week_projects_zero():
    assert model.availability(7, 5, bye=7, injury=None) == 0
    assert model.availability(8, 5, bye=7, injury=None) == 1


def test_out_zero_current_week_only_two_weeks():
    assert model.availability(5, 5, None, "Out") == 0
    assert model.availability(6, 5, None, "Out") == 0
    assert model.availability(7, 5, None, "Out") == 1
    assert model.availability(5, 5, None, "Questionable") == config.AVAIL["Questionable"]


def test_ir_zero_until_cur_plus_4():
    assert [model.availability(w, 5, None, "IR") for w in range(5, 11)] == [0, 0, 0, 0, 1, 1]


def test_ros_non_negative_and_playoff_weight():
    flat = {w: 15.0 for w in range(5, 18)}
    ros, playoff = model.ros_value(flat, repl=10.0)
    assert ros >= 0
    assert playoff / 3 == pytest.approx(config.PLAYOFF_WT * 5.0)
    assert model.ros_value({5: 2.0, 15: 1.0}, repl=10.0) == (0.0, 0.0)


def test_calibration_shrinks_spread():
    raw = {str(i): float(v) for i, v in enumerate([30, 25, 20, 15, 10])}
    cal = model.calibrate(raw, n=5, c=0.8)
    assert max(cal.values()) - min(cal.values()) < max(raw.values()) - min(raw.values())
    assert sum(cal.values()) == pytest.approx(sum(raw.values()))
    assert model.calibrate({"a": 0.0, "b": 10.0}, 2, 0.5)["a"] == 0.0


def test_blend_market_only_for_k_def():
    assert model.blend(10.0, 20.0, "K") == 10.0
    assert model.blend(10.0, None, "WR") == 10.0
    assert model.blend(10.0, 20.0, "WR") == pytest.approx(config.MARKET_W * 10 + config.XFP_W * 20)


def test_tag_rules():
    t, r = model.tag("WR", 5, 1.2, "wopr up", 0.0, None, None, 5)
    assert t == "BUY" and r
    t, r = model.tag("WR", 80, 1.2, "wopr up", 0.0, None, None, 200)
    assert t == "HOLD"  # not startable
    t, r = model.tag("WR", 5, 0.0, "", 20.0, -30, 1, 31)
    assert t == "SELL" and len(r) == 2


def _data():
    players = {
        "1": {"position": "WR", "full_name": "Wide One", "team": "AAA", "injury_status": None},
        "2": {"position": "WR", "full_name": "Wide Two", "team": "BBB", "injury_status": "Out"},
        "3": {"position": "QB", "full_name": "Quarter Back", "team": "AAA", "injury_status": None},
        "AAA": {"position": "DEF", "first_name": "Aaa", "last_name": "Team", "team": "AAA"},
    }
    proj = {w: [{"player_id": "1", "stats": {"rec": 5, "rec_yd": 70}},
                {"player_id": "2", "stats": {"rec": 3, "rec_yd": 40}},
                {"player_id": "3", "stats": {"pass_yd": 250, "pass_td": 2}},
                {"player_id": "AAA", "stats": {}}] for w in range(5, 18)}
    stats = {1: [{"player_id": "1", "stats": {"gp": 1, "rec": 6, "rec_yd": 90}}]}
    return {
        "week": 5,
        "league": {"scoring_settings": SCORING},
        "players": players,
        "rosters": [{"roster_id": 1, "players": ["1", "3"]}],
        "projections": proj,
        "stats": stats,
        "byes": {"AAA": 7, "BBB": 9},
        "ffopportunity": pd.DataFrame([{"player_id": "g1", "week": 1, "position": "WR",
                                        "receptions_exp": 5.0, "rec_yards_gained_exp": 60.0}]),
        "nflverse_stats": pd.DataFrame([{"player_id": "g1", "week": w, "team": "AAA", "carries": 0,
                                         "target_share": .2 + .05 * w, "wopr": .3 + .05 * w} for w in range(1, 5)]),
        "snap_counts": pd.DataFrame([{"pfr_player_id": "P1", "week": w, "offense_pct": .6 + .1 * (w == 4),
                                      "position": "WR", "team": "AAA"} for w in range(1, 5)]),
        "id_map": pd.DataFrame([{"sleeper_id": 1.0, "gsis_id": "g1", "pfr_id": "P1"}]),
        "fantasycalc": [{"player": {"sleeperId": "1"}, "value": 5000, "overallRank": 3}],
    }


def test_compute_validates_and_shapes():
    snap = ("2026-01-01", {"1": {"ros": 10.0, "signals": {"fc_value": 4000}}})
    out = model.compute(_data(), [snap], "2026-10-06")
    validate("players", out)
    by = {p["id"]: p for p in out}
    assert by["1"]["proj"]["7"] == 0  # AAA bye
    assert by["2"]["proj"]["5"] == 0 and by["2"]["proj"]["7"] > 0  # Out: cur + next only
    assert all(p["ros"] >= 0 for p in out)
    assert by["1"]["signals"]["fc_history"] == [{"date": "2026-01-01", "value": 4000.0},
                                                {"date": "2026-10-06", "value": 5000.0}]
    assert by["1"]["signals"]["market_drift"] == pytest.approx(by["1"]["ros"] - 10.0)
    assert by["1"]["signals"]["usage_metric"] == "wopr"
    assert by["1"]["signals"]["usage_trend"] > 0
