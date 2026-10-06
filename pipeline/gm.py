"""Hand-off between the data pipeline and the /gm Claude Code command (no API calls here).

    python -m pipeline.gm prep [--cap N]   -> .cache/gm/context.json (who needs an outlook + briefing input)
    python -m pipeline.gm publish          <- .cache/gm/outlooks*.json, .cache/gm/briefing.json
                                           -> web/public/data/outlooks.json, private/briefing.enc, meta.json
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone

from . import config
from .crypto import encrypt_json
from .schema import validate

WORK_DIR = config.CACHE_DIR / "gm"
MODEL_LABEL = "claude-code"
DEFAULT_CAP = 30
FRESH_DAYS = 3
RIVAL_N = 20
FA_N = 30
WEAK_POS_N = 3

LEAGUE_FACTS = (
    "League: 10-team redraft superflex (QB, RB x3, WR x3, TE, FLEX x2, SUPER_FLEX, K, DEF), "
    "6 pt passing TD, full league scoring re-applied to raw stats. Median game on (2 results/week). "
    "Regular season weeks 1-14, 6 playoff teams, playoffs weeks 15-17, trade deadline week 11."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _read(name: str):
    f = config.OUT_DIR / name
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


# ---------------------------------------------------------------- scope

def _by_ros(ps):
    return sorted(ps, key=lambda p: (-p["ros"], p["id"]))


def weak_positions(team: dict, n: int = WEAK_POS_N) -> list[str]:
    ps = team["pos_strength"]
    return sorted((p for p in ("QB", "RB", "WR", "TE") if p in ps), key=lambda p: (ps[p], p))[:n]


def select_scope(players: list[dict], league: dict, my_rid: int, prev: dict[str, dict],
                 outlooks: dict[str, dict], now: datetime, cap: int = DEFAULT_CAP) -> list[str]:
    """Player ids that need a fresh outlook, in priority order, deduplicated and capped."""
    me = next(t for t in league["teams"] if t["roster_id"] == my_rid)
    weak = set(weak_positions(me))
    changed = {p["id"] for p in players if p["id"] in prev and prev[p["id"]]["tag"] != p["tag"]}

    mine = _by_ros(p for p in players if p["roster_id"] == my_rid)
    rivals = _by_ros(p for p in players if p["roster_id"] not in (None, my_rid) and p["pos"] in weak
                     and p["ros_pos_rank"] <= config.STARTERS[p["pos"]])[:RIVAL_N]
    fas = _by_ros(p for p in players if p["roster_id"] is None)[:FA_N]
    moved = _by_ros(p for p in players if p["id"] in changed)

    cutoff = now - timedelta(days=FRESH_DAYS)
    out, seen = [], set()
    for p in mine + rivals + fas + moved:
        pid = p["id"]
        if pid in seen or p["pos"] in ("K", "DEF"):  # not worth researching
            continue
        seen.add(pid)
        o = outlooks.get(pid)
        if o and pid not in changed and datetime.fromisoformat(o["updated"]) > cutoff:
            continue
        out.append(pid)
    return out[:cap]


# ---------------------------------------------------------------- context

def player_brief(p: dict, cur: int) -> dict:
    s = p["signals"]
    return {
        "id": p["id"], "name": p["name"], "pos": p["pos"], "team": p["team"], "bye": p["bye"],
        "injury": p["injury"], "rostered": p["roster_id"] is not None,
        "proj_by_week": {w: v for w, v in p["proj"].items() if int(w) >= cur},
        "ros_par": p["ros"], "ros_playoff_par": p["ros_playoff"], "ros_rank": p["ros_rank"],
        "ros_pos_rank": p["ros_pos_rank"], "replacement_weekly_pts": p["repl"], "season": p["season"],
        "signals": {k: s[k] for k in ("usage_trend", "usage_metric", "luck", "market_drift",
                                      "fc_value", "fc_rank", "market_gap", "breakout")},
        "tag": p["tag"], "tag_reasons": p["tag_reasons"],
    }


def briefing_input(meta: dict, players: list[dict], league: dict, my_rid: int, outlooks: dict) -> dict:
    cur = meta["week"]
    me = next(t for t in league["teams"] if t["roster_id"] == my_rid)

    def row(p):
        d = {k: p[k] for k in ("id", "name", "pos", "team", "bye", "injury", "ros", "ros_playoff",
                               "ros_pos_rank", "tag", "tag_reasons")}
        d["next_proj"] = {w: v for w, v in p["proj"].items() if cur <= int(w) < cur + 3}
        d["fc_value"] = p["signals"]["fc_value"]
        if p["id"] in outlooks:
            d["outlook"] = {k: outlooks[p["id"]][k] for k in ("signal", "summary", "risks")}
        return d

    owner = {t["roster_id"]: t["owner"] for t in league["teams"]}
    rivals = _by_ros(p for p in players if p["roster_id"] not in (None, my_rid))[:10]
    return {
        "my_team": {k: me[k] for k in ("roster_id", "owner", "wins", "losses", "ties", "pf", "pa",
                                        "all_play_w", "all_play_l", "ros_strength", "pos_strength",
                                        "playoff_odds", "seed_dist", "proj_wins", "faab_left")},
        "standings": [{k: t[k] for k in ("roster_id", "owner", "wins", "losses", "ties", "pf",
                                          "ros_strength", "playoff_odds", "proj_wins")}
                      for t in sorted(league["teams"], key=lambda t: (-t["wins"], -t["pf"]))],
        "remaining_schedule": [{"week": s["week"], "opponent": next(
            (owner[b if a == my_rid else a] for a, b in s["matchups"] if my_rid in (a, b)), None)}
            for s in league["schedule"]],
        "my_roster": [row(p) for p in _by_ros(p for p in players if p["roster_id"] == my_rid)],
        "top_waiver_fas": [row(p) for p in _by_ros(p for p in players if p["roster_id"] is None)[:15]],
        "top_rival_targets": [dict(row(p), owner=owner.get(p["roster_id"])) for p in rivals],
    }


def prep(cap: int = DEFAULT_CAP, now: datetime | None = None) -> dict:
    from .model import load_snapshots

    now = now or _now()
    meta, players, league = _read("meta.json"), _read("players.json"), _read("league.json")
    if not (meta and players and league):
        raise SystemExit("run `python -m pipeline.run` first (meta/players/league.json missing)")
    my_rid, cur = meta["my_roster_id"], meta["week"]
    snaps = load_snapshots(now.date().isoformat())
    prev = snaps[-1][1] if snaps else {}
    outlooks = _read("outlooks.json") or {}
    by_id = {p["id"]: p for p in players}
    ids = select_scope(players, league, my_rid, prev, outlooks, now, cap)
    ctx = {
        "week": cur, "season": meta["season"], "league_facts": LEAGUE_FACTS,
        "outlook_players": [player_brief(by_id[i], cur) for i in ids],
        "briefing_input": briefing_input(meta, players, league, my_rid, outlooks),
    }
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    for stale in [*WORK_DIR.glob("outlooks*.json"), WORK_DIR / "briefing.json"]:
        stale.unlink(missing_ok=True)
    (WORK_DIR / "context.json").write_text(json.dumps(ctx, indent=1), encoding="utf-8")
    print(f"wrote {WORK_DIR / 'context.json'}: {len(ids)} players need outlooks (week {cur})")
    return ctx


# ---------------------------------------------------------------- publish

def publish(now: datetime | None = None) -> None:
    now = now or _now()
    stamp = now.isoformat(timespec="seconds")
    meta = _read("meta.json")
    wrote = False

    parts = sorted(WORK_DIR.glob("outlooks*.json"))
    if parts:
        new = {}
        for f in parts:
            new.update(json.loads(f.read_text(encoding="utf-8")))
        outlooks = _read("outlooks.json") or {}
        for pid, o in new.items():
            outlooks[pid] = {"signal": o["signal"], "summary": o["summary"], "risks": list(o["risks"]),
                             "sources": [{"title": s["title"], "url": s["url"]} for s in o.get("sources", [])],
                             "updated": stamp, "model": MODEL_LABEL}
        validate("outlooks", outlooks)
        (config.OUT_DIR / "outlooks.json").write_text(json.dumps(outlooks, separators=(",", ":")), encoding="utf-8")
        for f in parts:
            f.unlink()
        print(f"merged {len(new)} outlooks ({len(outlooks)} total)")
        wrote = True

    brief_f = WORK_DIR / "briefing.json"
    if brief_f.exists():
        passphrase = os.environ.get("BRIEFING_PASSPHRASE")
        if not passphrase:
            raise SystemExit("BRIEFING_PASSPHRASE is not set; briefing left unencrypted at " + str(brief_f))
        b = json.loads(brief_f.read_text(encoding="utf-8"))
        brief = {"week": meta["week"], "generated_at": stamp, "situation": b["situation"],
                 "moves": b["moves"], "reasoning": b["reasoning"]}
        validate("briefing", brief)
        path = config.OUT_DIR / "private" / "briefing.enc"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(encrypt_json(brief, passphrase), encoding="utf-8")
        brief_f.unlink()
        print(f"wrote {path} ({len(brief['moves'])} moves, encrypted)")
        wrote = True

    if not wrote:
        raise SystemExit(f"nothing to publish in {WORK_DIR}")
    meta["llm_generated_at"] = stamp
    validate("meta", meta)
    (config.OUT_DIR / "meta.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="python -m pipeline.gm")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prep", help="write .cache/gm/context.json")
    p.add_argument("--cap", type=int, default=DEFAULT_CAP, help="max players needing an outlook")
    sub.add_parser("publish", help="merge outlooks, encrypt the briefing, stamp meta.json")
    args = ap.parse_args(argv)
    prep(args.cap) if args.cmd == "prep" else publish()


if __name__ == "__main__":
    main()
