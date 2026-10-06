"""Rest-of-season value model -> players.json (phase 03).

Market projections blended with recent expected points, calibrated per position,
availability-adjusted, valued above free-agent replacement, plus trend signals and a BUY/SELL/HOLD tag.
"""
from __future__ import annotations

import json
import statistics
from datetime import datetime, timezone

from . import config
from .schema import validate
from .scoring import score, score_xfp

MARKET_ONLY = ("K", "DEF")


# pure pieces (unit-tested)

def blend(mkt: float, xfp_pg: float | None, pos: str) -> float:
    if pos in MARKET_ONLY or xfp_pg is None or mkt <= 0:
        return mkt
    return config.MARKET_W * mkt + config.XFP_W * xfp_pg


def calibrate(raw: dict[str, float], n: int, c: float) -> dict[str, float]:
    """Shrink one position-week toward the mean of its top n. Zero (no projection) stays zero."""
    vals = sorted((v for v in raw.values() if v > 0), reverse=True)[:n]
    if not vals:
        return dict(raw)
    m = sum(vals) / len(vals)
    return {k: (max(0.0, m + c * (v - m)) if v > 0 else 0.0) for k, v in raw.items()}


def availability(w: int, cur: int, bye: int | None, injury: str | None) -> float:
    if bye == w:
        return 0.0
    if injury == "IR":
        return 0.0 if w < cur + config.IR_WEEKS else 1.0
    if injury in config.AVAIL and w < cur + config.INJURY_WEEKS:
        return config.AVAIL[injury]
    return 1.0


def ros_value(proj: dict[int, float], repl: float) -> tuple[float, float]:
    ros = playoff = 0.0
    for w, p in proj.items():
        wt = config.PLAYOFF_WT if w in config.PLAYOFF_WEEKS else 1.0
        v = max(0.0, p - repl) * wt
        ros += v
        if w in config.PLAYOFF_WEEKS:
            playoff += v
    return round(ros, 2), round(playoff, 2)


def trend(series: list[dict]) -> float:
    vals = [s["value"] for s in series]
    if len(vals) < 2:
        return 0.0
    sd = max(statistics.pstdev(vals), config.USAGE_STD_FLOOR)
    return round((statistics.mean(vals[-3:]) - statistics.mean(vals)) / sd, 2)


def tag(pos: str, pos_rank: int, usage_trend: float, usage_txt: str, luck: float,
        market_gap: float | None, fc_rank: int | None, ros_rank: int) -> tuple[str, list[str]]:
    buy, sell = [], []
    if usage_trend > config.TAG_USAGE_Z:
        buy.append(f"Usage rising: {usage_txt} (z {usage_trend:+.2f})")
    elif usage_trend < -config.TAG_USAGE_Z:
        sell.append(f"Usage falling: {usage_txt} (z {usage_trend:+.2f})")
    if luck < -config.TAG_LUCK:
        buy.append(f"Unlucky: scored {-luck:.1f} pts below expected (xFP) this season")
    elif luck > config.TAG_LUCK:
        sell.append(f"Running hot: scored {luck:.1f} pts above expected (xFP) this season")
    if market_gap is not None and market_gap > config.TAG_MARKET_GAP:
        buy.append(f"Market undervalues: FantasyCalc #{fc_rank} vs our ROS #{ros_rank} (gap +{market_gap:.0f})")
    elif market_gap is not None and market_gap < -config.TAG_MARKET_GAP:
        sell.append(f"Market overvalues: FantasyCalc #{fc_rank} vs our ROS #{ros_rank} (gap {market_gap:.0f})")
    if pos_rank > config.STARTERS[pos]:
        buy = []  # only buy players who would start
    reasons = buy + sell
    if len(buy) > len(sell):
        return "BUY", reasons
    if len(sell) > len(buy):
        return "SELL", reasons
    return "HOLD", reasons


# data plumbing

def _pos(p: dict) -> str | None:
    if p.get("position") in config.FANTASY_POS:
        return p["position"]
    return next((x for x in p.get("fantasy_positions") or [] if x in config.FANTASY_POS), None)


def _name(p: dict) -> str:
    if p.get("position") == "DEF":
        return f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
    return p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()


def _ids(id_map) -> tuple[dict, dict]:
    gsis, pfr = {}, {}
    for r in id_map[["sleeper_id", "gsis_id", "pfr_id"]].dropna(subset=["sleeper_id"]).itertuples(index=False):
        sid = str(int(r.sleeper_id))
        if isinstance(r.gsis_id, str):
            gsis.setdefault(sid, r.gsis_id)
        if isinstance(r.pfr_id, str):
            pfr.setdefault(sid, r.pfr_id)
    return gsis, pfr


def _wv(week, value) -> dict:
    return {"week": int(week), "value": round(float(value), 3)}


def load_snapshots(today: str) -> list[tuple[str, dict]]:
    out = []
    if config.HISTORY_DIR.exists():
        for d in sorted(config.HISTORY_DIR.iterdir()):
            f = d / "players.json"
            if d.name < today and f.exists():
                out.append((d.name, {p["id"]: p for p in json.loads(f.read_text(encoding="utf-8"))}))
    return out


def compute(data: dict, snapshots: list[tuple[str, dict]], today: str) -> list[dict]:
    cur = data["week"]
    weeks = list(range(cur, config.LAST_WEEK + 1))
    scoring = data["league"]["scoring_settings"]
    P = data["players"]
    byes = data["byes"]

    owner = {pid: r["roster_id"] for r in data["rosters"] for pid in (r.get("players") or [])}

    # market projection per week
    mkt: dict[str, dict[int, float]] = {}
    for w in weeks:
        for row in data["projections"].get(w, []):
            mkt.setdefault(row["player_id"], {})[w] = score(row.get("stats") or {}, scoring)

    cands = {pid for pid in set(mkt) | set(owner) if pid in P and _pos(P[pid])}
    pos_of = {pid: _pos(P[pid]) for pid in cands}

    gsis, pfr = _ids(data["id_map"])
    by_gsis = {}
    for sid in cands:
        if sid in gsis:
            by_gsis.setdefault(gsis[sid], sid)

    # expected points (ffopportunity, gsis ids)
    xfp_games: dict[str, list[tuple[int, float]]] = {}
    ff = data["ffopportunity"]
    for row in ff.to_dict("records"):
        sid = by_gsis.get(row.get("player_id"))
        if sid:
            xfp_games.setdefault(sid, []).append((int(row["week"]), score_xfp(row, scoring)))
    for v in xfp_games.values():
        v.sort()

    # actual league-scored points (Sleeper stats)
    season_pts: dict[str, float] = {}
    games: dict[str, int] = {}
    for w, rows in data["stats"].items():
        for row in rows:
            st = row.get("stats") or {}
            if row["player_id"] in cands and (st.get("gp") or 0) > 0:
                season_pts[row["player_id"]] = season_pts.get(row["player_id"], 0.0) + score(st, scoring)
                games[row["player_id"]] = games.get(row["player_id"], 0) + 1

    # raw blend, then per position-week calibration and availability
    raw: dict[str, dict[int, float]] = {}
    for pid in cands:
        xs = xfp_games.get(pid)
        xpg = statistics.mean(x for _, x in xs[-config.XFP_WINDOW:]) if xs else None
        raw[pid] = {w: blend(mkt.get(pid, {}).get(w, 0.0), xpg, pos_of[pid]) for w in weeks}

    proj: dict[str, dict[int, float]] = {pid: {} for pid in cands}
    for pos in config.FANTASY_POS:
        ids = [pid for pid in cands if pos_of[pid] == pos]
        for w in weeks:
            cal = calibrate({pid: raw[pid][w] for pid in ids}, config.STARTERS[pos], config.CALIB[pos])
            for pid in ids:
                team = P[pid].get("team")
                a = availability(w, cur, byes.get(team) if team else None, P[pid].get("injury_status"))
                proj[pid][w] = round(cal[pid] * a, 2)

    # replacement level from the best free agents
    repl: dict[str, float] = {}
    for pos in config.FANTASY_POS:
        means = []
        for pid in cands:
            if pos_of[pid] != pos or pid in owner:
                continue
            team = P[pid].get("team")
            bye = byes.get(team) if team else None
            ws = [proj[pid][w] for w in weeks if w != bye]
            means.append(sum(ws) / len(ws) if ws else 0.0)
        top = sorted(means, reverse=True)[:config.REPL_FA_N]
        repl[pos] = round(sum(top) / len(top), 2) if top else 0.0

    ros = {pid: ros_value(proj[pid], repl[pos_of[pid]]) for pid in cands}

    keep_fa = sorted((p for p in cands if p not in owner), key=lambda p: (-ros[p][0], -ros[p][1], p))[:config.FA_KEEP]
    keep = [p for p in cands if p in owner] + keep_fa
    keep.sort(key=lambda p: (-ros[p][0], -ros[p][1], p))
    rank = {pid: i + 1 for i, pid in enumerate(keep)}
    pos_rank, seen = {}, {}
    for pid in keep:
        seen[pos_of[pid]] = seen.get(pos_of[pid], 0) + 1
        pos_rank[pid] = seen[pos_of[pid]]

    # usage inputs
    nv = data["nflverse_stats"]
    team_carries = nv.groupby(["team", "week"])["carries"].sum().to_dict()
    nv_rows: dict[str, list[dict]] = {}
    for row in nv.to_dict("records"):
        sid = by_gsis.get(row.get("player_id"))
        if sid:
            nv_rows.setdefault(sid, []).append(row)

    sc = data["snap_counts"]
    snaps: dict[str, dict[int, float]] = {}
    for r in sc[["pfr_player_id", "week", "offense_pct"]].itertuples(index=False):
        snaps.setdefault(r.pfr_player_id, {})[int(r.week)] = float(r.offense_pct)
    last_wk = int(sc["week"].max()) if len(sc) else 0
    rb = sc[sc["position"] == "RB"]
    rb_lead = {}
    if len(rb):
        idx = rb.groupby(["team", "week"])["offense_pct"].idxmax()
        rb_lead = {(t, int(w)): rb.loc[i, "pfr_player_id"] for (t, w), i in idx.items()}

    fc = {}
    for i, e in enumerate(data["fantasycalc"]):
        sid = str((e.get("player") or {}).get("sleeperId") or "")
        if sid:
            fc[sid] = (float(e.get("value") or 0), int(e.get("overallRank") or i + 1))
    prev = snapshots[-1][1] if snapshots else None

    out = []
    for pid in keep:
        p, pos = P[pid], pos_of[pid]
        team = p.get("team")
        rows = sorted(nv_rows.get(pid, []), key=lambda r: r["week"])
        snap = snaps.get(pfr.get(pid), {})
        snap_series = [_wv(w, v) for w, v in sorted(snap.items())]

        def share(r):
            tc = team_carries.get((r["team"], r["week"])) or 0
            return (r.get("carries") or 0) / tc if tc else 0.0

        if pos in ("WR", "TE"):
            use_wopr = any(r.get("wopr") == r.get("wopr") and r.get("wopr") is not None for r in rows)
            metric = "wopr" if use_wopr else "target_share"
            usage = [_wv(r["week"], r.get(metric) or 0) for r in rows]
        elif pos == "RB":
            metric = "snap_pct+carries"
            usage = []
            for r in rows:
                parts = [share(r)] + ([snap[r["week"]]] if r["week"] in snap else [])
                usage.append(_wv(r["week"], sum(parts) / len(parts)))
        elif pos == "QB":
            metric = "rush_share"
            usage = [_wv(r["week"], share(r)) for r in rows]
        else:
            metric, usage = "none", []
        u_trend = trend(usage)
        vals = [u["value"] for u in usage]
        usage_txt = (f"{metric} {statistics.mean(vals[-3:]):.2f} over last 3 vs {statistics.mean(vals):.2f} season"
                     if vals else metric)

        xs = xfp_games.get(pid, [])
        xfp_tot = sum(x for _, x in xs)
        pts = season_pts.get(pid, 0.0)
        g = games.get(pid, 0)
        luck = round(pts - xfp_tot, 2) if xs else 0.0

        fc_value, fc_rank = fc.get(pid, (None, None))
        gap = fc_rank - rank[pid] if fc_rank is not None else None
        drift = round(ros[pid][0] - prev[pid]["ros"], 2) if prev and pid in prev else None
        hist = [{"date": d, "value": float(s[pid]["signals"]["fc_value"])}
                for d, s in snapshots if pid in s and s[pid]["signals"].get("fc_value") is not None]
        if fc_value is not None:
            hist.append({"date": today, "value": fc_value})

        # breakout radar on the latest played week
        bo = []
        if last_wk in snap:
            prior = [snap[w] for w in range(last_wk - 3, last_wk) if w in snap]
            if prior and snap[last_wk] - statistics.mean(prior) >= config.BREAKOUT_SNAP:
                bo.append(f"snap share jumped to {snap[last_wk]:.0%} in wk {last_wk} from {statistics.mean(prior):.0%}")
        ts = {int(r["week"]): r.get("target_share") or 0 for r in rows if r.get("target_share") == r.get("target_share")}
        if last_wk in ts and pos in ("WR", "TE", "RB"):
            prior = [ts[w] for w in range(last_wk - 3, last_wk) if w in ts]
            if prior and ts[last_wk] - statistics.mean(prior) >= config.BREAKOUT_TS:
                bo.append(f"target share rose to {ts[last_wk]:.0%} in wk {last_wk} from {statistics.mean(prior):.0%}")
        if pos == "RB" and pid in pfr and rows:
            t = rows[-1]["team"]
            if rb_lead.get((t, last_wk)) == pfr[pid]:
                earlier = [w for (tt, w) in rb_lead if tt == t and w < last_wk]
                if earlier and rb_lead[(t, max(earlier))] != pfr[pid]:
                    bo.append(f"took over as {t}'s top RB by snaps in wk {last_wk}")

        t, reasons = tag(pos, pos_rank[pid], u_trend, usage_txt, luck, gap, fc_rank, rank[pid])
        out.append({
            "id": pid, "name": _name(p), "pos": pos, "team": team,
            "bye": byes.get(team) if team else None,
            "injury": p.get("injury_status"),
            "roster_id": owner.get(pid),
            "proj": {str(w): v for w, v in proj[pid].items()},
            "ros": ros[pid][0], "ros_playoff": ros[pid][1],
            "ros_rank": rank[pid], "ros_pos_rank": pos_rank[pid],
            "repl": repl[pos],
            "season": {"games": g, "pts": round(pts, 2), "ppg": round(pts / g, 2) if g else 0.0,
                       "xfp": round(xfp_tot, 2), "xfp_pg": round(xfp_tot / len(xs), 2) if xs else 0.0},
            "signals": {
                "usage_trend": u_trend, "usage_metric": metric, "usage_series": usage,
                "snap_series": snap_series, "luck": luck, "market_drift": drift,
                "fc_value": fc_value, "fc_rank": fc_rank, "market_gap": gap,
                "fc_history": hist, "breakout": "; ".join(bo) or None,
            },
            "tag": t, "tag_reasons": reasons,
        })
    validate("players", out)
    return out


def build(data: dict) -> list[dict]:
    from .run import my_roster_id, write_json

    today = datetime.now(timezone.utc).date().isoformat()
    out = compute(data, load_snapshots(today), today)
    write_json("players.json", out, "players")
    snap = config.HISTORY_DIR / today / "players.json"
    snap.parent.mkdir(parents=True, exist_ok=True)
    snap.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {config.OUT_DIR / 'players.json'} ({len(out)} players) and {snap}")

    me = my_roster_id(data)
    print(f"\nmy roster ({config.MY_USERNAME}, roster_id {me}):")
    for p in sorted((p for p in out if p["roster_id"] == me), key=lambda p: -p["ros"]):
        print(f"  {p['pos']:3} {p['name']:26} ros {p['ros']:7.1f}  #{p['ros_pos_rank']:<3} {p['tag']:4}"
              + (f"  {' | '.join(p['tag_reasons'])}" if p["tag_reasons"] else ""))
    data["players_out"] = out
    return out
