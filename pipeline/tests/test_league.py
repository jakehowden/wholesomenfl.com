from pipeline import league
from pipeline.lineup import optimal_lineup, starting_slots
from pipeline.schema import validate

ROSTER_POSITIONS = ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "K", "DEF",
                    "BN", "BN", "BN", "BN", "BN", "BN", "IR"]
RIDS = list(range(1, 11))
SCHED = [[(1, 2), (3, 4), (5, 6), (7, 8), (9, 10)], [(1, 3), (2, 4), (5, 7), (6, 8), (9, 10)]] * 3


def test_superflex_takes_second_qb():
    pos = {"q1": "QB", "q2": "QB", "r1": "RB", "r2": "RB", "r3": "RB", "r4": "RB",
           "w1": "WR", "w2": "WR", "w3": "WR", "w4": "WR", "t1": "TE", "k": "K", "d": "DEF"}
    val = {"q1": 25, "q2": 18, "r1": 15, "r2": 14, "r3": 13, "r4": 12,
           "w1": 16, "w2": 15, "w3": 14, "w4": 11, "t1": 9, "k": 8, "d": 7}
    slots = starting_slots(ROSTER_POSITIONS)
    assert len(slots) == 13
    tot, assigned = optimal_lineup(pos, val.get, pos.get, slots)
    sf = assigned[slots.index("SUPER_FLEX")]
    assert sf == "q2"
    assert set(assigned[i] for i, s in enumerate(slots) if s == "FLEX") == {"r4", "w4"}
    assert tot == sum(val.values())


def test_sim_odds_sum_to_playoff_spots():
    wins = {r: float(r % 5) for r in RIDS}
    pf = {r: 800.0 + 10 * r for r in RIDS}
    means = [{r: 100.0 + 3 * r for r in RIDS}] * len(SCHED)
    out = league.simulate(RIDS, wins, pf, SCHED, means, runs=4000, sd=22.0, seed=1)
    assert abs(sum(t["playoff_odds"] for t in out.values()) - 6.0) <= 0.01
    for t in out.values():
        assert len(t["seed_dist"]) == 10
        assert abs(sum(t["seed_dist"]) - 1) < 1e-3
    # each week hands out 5 H2H wins + 5 median wins
    assert abs(sum(t["proj_wins"] for t in out.values()) - (sum(wins.values()) + 10 * len(SCHED))) < 0.1


def test_all_play_totals():
    weeks = {w: {r: 90.0 + ((r * 7 + w * 3) % 11) * 4.1 for r in RIDS} for w in range(1, 6)}
    ap = league.all_play(weeks)
    for w, l in ap.values():
        assert w + l == 9 * len(weeks)


def test_grades_and_trade_sides():
    assert [league.grade(x) for x in (30, 10, 9.9, -9.9, -10, -29.9, -30)] == ["A", "B", "C", "C", "D", "D", "F"]
    tx = {3: [{"transaction_id": "t1", "type": "trade", "status": "complete", "leg": 3, "roster_ids": [5, 2],
               "adds": {"a": 5, "b": 2}, "drops": {"a": 2, "b": 5}, "settings": None},
              {"transaction_id": "w1", "type": "waiver", "status": "complete", "leg": 3, "roster_ids": [5],
               "adds": {"c": 5}, "drops": None, "settings": {"waiver_bid": 12}}]}
    out = league.transactions(tx, {"a": 50.0, "b": 15.0, "c": 4.0})
    assert out[0]["grade"] == "A/F"
    assert out[0]["sides"][0]["ros_delta"] == 35.0
    assert out[0]["faab"] is None
    assert out[1]["faab"] == 12.0 and out[1]["grade"] is None
    validate("league", {"teams": [], "schedule": [{"week": 9, "matchups": [[1, 2]]}],
                        "transactions": out, "sim": {"runs": 1, "sd": 22.0}})
