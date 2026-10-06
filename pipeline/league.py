"""League analytics -> league.json (phase 04): records, all-play, strength, schedule, playoff sim, transactions."""
from __future__ import annotations

import numpy as np

from . import config
from .lineup import optimal_lineup, starting_slots

PLAYOFF_TEAMS = 6
AVATAR = "https://sleepercdn.com/avatars/thumbs/{}"


# pure pieces (unit-tested)

def all_play(weeks: dict[int, dict[int, float]]) -> dict[int, tuple[int, int]]:
    """weeks: week -> {roster_id: points}. Each team vs every other team each week (ties count as losses)."""
    out: dict[int, list[int]] = {}
    for pts in weeks.values():
        for rid, p in pts.items():
            rec = out.setdefault(rid, [0, 0])
            for other, q in pts.items():
                if other != rid:
                    rec[0 if p > q else 1] += 1
    return {rid: (w, l) for rid, (w, l) in out.items()}


def pairs(matchups: list[dict]) -> list[tuple[int, int]]:
    by_id: dict[int, list[int]] = {}
    for m in matchups:
        if m.get("matchup_id") is not None:
            by_id.setdefault(m["matchup_id"], []).append(m["roster_id"])
    return [(a[0], a[1]) for _, a in sorted(by_id.items()) if len(a) == 2]


def simulate(rids: list[int], wins: dict[int, float], pf: dict[int, float],
             schedule: list[list[tuple[int, int]]], means: list[dict[int, float]],
             runs: int, sd: float, seed: int = 0) -> dict[int, dict]:
    """Monte Carlo of the remaining regular season: H2H + median result each week, top PLAYOFF_TEAMS by wins then PF."""
    rng = np.random.default_rng(seed)
    n = len(rids)
    idx = {r: i for i, r in enumerate(rids)}
    W = np.tile(np.array([wins[r] for r in rids], dtype=float), (runs, 1))
    PF = np.tile(np.array([pf[r] for r in rids], dtype=float), (runs, 1))
    for games, mu in zip(schedule, means):
        s = rng.normal(np.array([mu.get(r, 0.0) for r in rids]), sd, (runs, n))
        for a, b in games:
            ia, ib = idx[a], idx[b]
            W[:, ia] += s[:, ia] > s[:, ib]
            W[:, ib] += s[:, ib] > s[:, ia]
        W += s > np.median(s, axis=1, keepdims=True)
        PF += s
    order = np.argsort(-(W * 1e6 + PF), axis=1, kind="stable")  # wins, then points for
    seeds = np.empty_like(order)
    np.put_along_axis(seeds, order, np.arange(n)[None, :].repeat(runs, 0), axis=1)
    out = {}
    for r, i in idx.items():
        dist = np.bincount(seeds[:, i], minlength=n) / runs
        out[r] = {
            "playoff_odds": round(float(dist[:PLAYOFF_TEAMS].sum()), 4),
            "seed_dist": [round(float(x), 4) for x in dist],
            "proj_wins": round(float(W[:, i].mean()), 2),
        }
    return out


def grade(delta: float) -> str:
    if delta >= 30:
        return "A"
    if delta >= 10:
        return "B"
    if delta > -10:
        return "C"
    if delta > -30:
        return "D"
    return "F"


def transactions(by_week: dict[int, list], ros: dict[str, float]) -> list[dict]:
    out, seen = [], set()
    for wk in sorted(by_week):
        for t in by_week[wk] or []:
            tid = str(t.get("transaction_id"))
            if t.get("type") not in ("trade", "waiver", "free_agent") or tid in seen:
                continue
            seen.add(tid)
            adds, drops = t.get("adds") or {}, t.get("drops") or {}
            sides = []
            for rid in t.get("roster_ids") or []:
                a = [p for p, r in adds.items() if r == rid]
                d = [p for p, r in drops.items() if r == rid]
                delta = sum(ros.get(p, 0.0) for p in a) - sum(ros.get(p, 0.0) for p in d)
                sides.append({"roster_id": rid, "adds": a, "drops": d, "ros_delta": round(delta, 2)})
            trade = t["type"] == "trade"
            bid = (t.get("settings") or {}).get("waiver_bid")
            out.append({
                "id": tid, "type": t["type"], "week": int(t.get("leg") or wk), "status": t.get("status") or "",
                "sides": sides,
                "grade": "/".join(grade(s["ros_delta"]) for s in sides) if trade and t.get("status") == "complete" else None,
                "faab": None if trade or bid is None else float(bid),
            })
    return out


# assembly

def compute(data: dict, players: list[dict]) -> dict:
    cur = data["week"]
    lg = data["league"]
    settings = lg.get("settings") or {}
    reg_end = settings.get("playoff_week_start", 15) - 1
    budget = settings.get("waiver_budget", 200)
    slots = starting_slots(lg.get("roster_positions") or [])

    P = {p["id"]: p for p in players}
    pos = lambda pid: P[pid]["pos"] if pid in P else None  # noqa: E731
    users = {u["user_id"]: u for u in data["users"]}
    rosters = sorted(data["rosters"], key=lambda r: r["roster_id"])
    rids = [r["roster_id"] for r in rosters]

    rem = list(range(cur, reg_end + 1))
    strength_weeks = rem or list(range(cur, config.LAST_WEEK + 1))

    # projected optimal lineups per team-week
    lineup_tot: dict[int, dict[int, float]] = {}
    pos_pts: dict[int, dict[str, float]] = {}
    for r in rosters:
        ids = r.get("players") or []
        lineup_tot[r["roster_id"]] = {}
        acc = {p: 0.0 for p in config.FANTASY_POS}
        for w in strength_weeks:
            val = lambda pid: P[pid]["proj"].get(str(w), 0.0) if pid in P else 0.0  # noqa: E731
            tot, assigned = optimal_lineup(ids, val, pos, slots)
            lineup_tot[r["roster_id"]][w] = tot
            for pid in assigned:
                if pid:
                    acc[pos(pid)] += val(pid) / len(strength_weeks)
        pos_pts[r["roster_id"]] = acc
    league_pos = {p: sum(pos_pts[r][p] for r in rids) / len(rids) for p in config.FANTASY_POS}

    # completed weeks: all-play
    played = {}
    for w in range(1, cur):
        pts = {m["roster_id"]: float(m.get("points") or 0) for m in data["matchups"].get(w, [])}
        if pts and any(pts.values()):
            played[w] = pts
    ap = all_play(played)

    schedule = [{"week": w, "matchups": [list(p) for p in pairs(data["matchups"].get(w, []))]} for w in rem]

    def fpts(s, k):
        return (s.get(k) or 0) + (s.get(k + "_decimal") or 0) / 100

    rec = {r["roster_id"]: r.get("settings") or {} for r in rosters}
    sim = simulate(
        rids,
        {rid: (s.get("wins") or 0) + 0.5 * (s.get("ties") or 0) for rid, s in rec.items()},
        {rid: fpts(s, "fpts") for rid, s in rec.items()},
        [[tuple(p) for p in wk["matchups"]] for wk in schedule],
        [{rid: lineup_tot[rid][w] for rid in rids} for w in rem],
        config.SIM_RUNS, config.SIM_SD, seed=cur,
    )

    teams = []
    for r in rosters:
        rid, s = r["roster_id"], rec[r["roster_id"]]
        u = users.get(r.get("owner_id")) or {}
        teams.append({
            "roster_id": rid,
            "owner": u.get("display_name") or f"Team {rid}",
            "avatar": AVATAR.format(u["avatar"]) if u.get("avatar") else None,
            "wins": s.get("wins") or 0, "losses": s.get("losses") or 0, "ties": s.get("ties") or 0,
            "pf": round(fpts(s, "fpts"), 2), "pa": round(fpts(s, "fpts_against"), 2),
            "all_play_w": ap.get(rid, (0, 0))[0], "all_play_l": ap.get(rid, (0, 0))[1],
            "ros_strength": round(sum(lineup_tot[rid].values()) / len(strength_weeks), 2),
            "pos_strength": {p: round(pos_pts[rid][p] - league_pos[p], 2) for p in config.FANTASY_POS},
            **sim[rid],
            "faab_left": budget - (s.get("waiver_budget_used") or 0),
            "roster": list(r.get("players") or []),
        })

    ros = {p["id"]: p["ros"] for p in players}
    return {
        "teams": teams,
        "schedule": schedule,
        "transactions": transactions(data["transactions"], ros),
        "sim": {"runs": config.SIM_RUNS, "sd": config.SIM_SD},
    }


def build(data: dict) -> dict:
    from .run import my_roster_id, write_json

    out = compute(data, data["players_out"])
    write_json("league.json", out, "league")
    print(f"wrote {config.OUT_DIR / 'league.json'} ({len(out['teams'])} teams, {len(out['transactions'])} transactions)")

    me = my_roster_id(data)
    power = {t["roster_id"]: i + 1 for i, t in enumerate(sorted(out["teams"], key=lambda t: -t["ros_strength"]))}
    print("\npower (ROS strength)  team                record   all-play   ros/wk  proj W  playoff")
    for t in sorted(out["teams"], key=lambda t: power[t["roster_id"]]):
        mark = ">>" if t["roster_id"] == me else "  "
        print(f"{mark} #{power[t['roster_id']]:<2} rid {t['roster_id']:<2}  {t['owner'][:18]:18} "
              f"{t['wins']}-{t['losses']}-{t['ties']:<3} {t['all_play_w']:>3}-{t['all_play_l']:<4} "
              f"{t['ros_strength']:7.1f} {t['proj_wins']:6.2f}  {t['playoff_odds']:6.1%}")
    trades = [x for x in out["transactions"] if x["grade"]]
    if trades:
        print("\ntrades:")
        for x in trades:
            print(f"  wk {x['week']:<2} {x['grade']:5} " + "  |  ".join(
                f"rid {s['roster_id']} {s['ros_delta']:+.1f}" for s in x["sides"]))
    data["league_out"] = out
    return out
