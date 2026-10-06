"""Pipeline entry point: python -m pipeline.run [--refresh]. Outlooks/briefing come from /gm (pipeline.gm)."""
from __future__ import annotations

import argparse
import importlib
import importlib.util
import json
from datetime import datetime, timezone

from . import config, fetch
from .schema import validate


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hook(module: str):
    """Return pipeline.<module>.build if that module exists yet, else None."""
    if importlib.util.find_spec(f"pipeline.{module}") is None:
        return None
    return importlib.import_module(f"pipeline.{module}").build


def write_json(name: str, obj, schema: str | None = None) -> None:
    if schema:
        validate(schema, obj)
    path = config.OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def gather() -> dict:
    st = fetch.state()
    week = max(1, min(int(st.get("week") or 1), 18))
    lg = fetch.league()
    season = str(lg.get("season") or config.SEASON)
    reg_end = (lg.get("settings") or {}).get("playoff_week_start", 15) - 1

    data = {
        "state": st,
        "week": week,
        "season": season,
        "league": lg,
        "rosters": fetch.rosters(),
        "users": fetch.users(),
        "players": fetch.players(),
        "matchups": {w: fetch.matchups(w) for w in range(1, reg_end + 1)},
        "transactions": {w: fetch.transactions(config.LEAGUE_ID, w) for w in range(1, week + 1)},
        "projections": {w: fetch.projections(w, season) for w in range(week, config.LAST_WEEK + 1)},
        "stats": {w: fetch.season_stats_week(w, season) for w in range(1, week)},
        "byes": fetch.byes(season),
        "ffopportunity": fetch.ffopportunity(season),
        "nflverse_stats": fetch.nflverse_stats(season),
        "snap_counts": fetch.snap_counts(season),
        "id_map": fetch.id_map(),
        "fantasycalc": fetch.fantasycalc(lg),
    }
    return data


def _count(v) -> int:
    if isinstance(v, dict) and v and all(isinstance(k, int) for k in v):
        return sum(len(x) for x in v.values())
    return len(v)


def my_roster_id(data: dict) -> int:
    me = config.MY_USERNAME.lower()
    uid = next(u["user_id"] for u in data["users"] if (u.get("display_name") or "").lower() == me)
    return next(r["roster_id"] for r in data["rosters"] if r.get("owner_id") == uid)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="python -m pipeline.run")
    ap.add_argument("--refresh", action="store_true", help="bypass the fetch cache")
    args = ap.parse_args(argv)
    fetch.REFRESH = args.refresh

    data = gather()
    skip = {"state", "week", "season", "league"}
    for name, v in data.items():
        if name in skip:
            continue
        n = _count(v)
        print(f"{name:16} {n:>8}")
        if n == 0:
            raise SystemExit(f"source {name} returned no data")

    # PHASE 03: value model -> players.json
    build = _hook("model")
    if build:
        build(data)

    # PHASE 04: league analytics -> league.json
    build = _hook("league")
    if build:
        build(data)

    lg = data["league"]
    prev_f = config.OUT_DIR / "meta.json"
    prev_meta = json.loads(prev_f.read_text(encoding="utf-8")) if prev_f.exists() else {}
    meta = {
        "generated_at": _now(),
        "season": data["season"],
        "week": data["week"],
        "league_id": config.LEAGUE_ID,
        "my_roster_id": my_roster_id(data),
        "sources": {
            "sleeper": fetch.SLEEPER,
            "ffopportunity": fetch.FFOPP.format(season=data["season"]),
            "nflverse": fetch.NFLVERSE,
            "id_map": fetch.ID_MAP,
            "fantasycalc": fetch.fantasycalc_url(lg),
        },
        "llm_generated_at": prev_meta.get("llm_generated_at"),  # stamped by `pipeline.gm publish`
    }
    write_json("meta.json", meta, "meta")
    print(f"wrote {config.OUT_DIR / 'meta.json'}")


if __name__ == "__main__":
    main()
