"""Phase 07: Claude player outlooks (web search) -> outlooks.json, and an encrypted weekly GM briefing."""
from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from . import config
from .crypto import encrypt_json
from .schema import validate

OUTLOOK_MODEL = "claude-sonnet-5-5"
BRIEFING_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FRESH_DAYS = 3
RIVAL_N = 20
FA_N = 30
WEAK_POS_N = 3
WORKERS = 8

LEAGUE_FACTS = (
    "League: 10-team redraft superflex (QB, RB x3, WR x3, TE, FLEX x2, SUPER_FLEX, K, DEF), "
    "6 pt passing TD, full league scoring re-applied to raw stats. Median game on (2 results/week). "
    "Regular season weeks 1-14, 6 playoff teams, playoffs weeks 15-17, trade deadline week 11."
)

OUTLOOK_SCHEMA = {
    "type": "object",
    "properties": {
        "signal": {"type": "string", "enum": ["BUY", "SELL", "HOLD"]},
        "summary": {"type": "string"},
        "risks": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["signal", "summary", "risks"],
    "additionalProperties": False,
}

BRIEFING_SCHEMA = {
    "type": "object",
    "properties": {
        "situation": {"type": "string"},
        "moves": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["trade", "waiver", "lineup", "hold"]},
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "player_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["kind", "title", "detail", "player_ids"],
                "additionalProperties": False,
            },
        },
        "reasoning": {"type": "string"},
    },
    "required": ["situation", "moves", "reasoning"],
    "additionalProperties": False,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- scope

def _by_ros(ps):
    return sorted(ps, key=lambda p: (-p["ros"], p["id"]))


def weak_positions(team: dict, n: int = WEAK_POS_N) -> list[str]:
    ps = team["pos_strength"]
    return sorted((p for p in ("QB", "RB", "WR", "TE") if p in ps), key=lambda p: (ps[p], p))[:n]


def select_scope(players: list[dict], league: dict, my_rid: int, prev: dict[str, dict],
                 outlooks: dict[str, dict], now: datetime, cap: int = config.LLM_OUTLOOK_CAP) -> list[str]:
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
        if pid in seen:
            continue
        seen.add(pid)
        o = outlooks.get(pid)
        if o and pid not in changed and datetime.fromisoformat(o["updated"]) > cutoff:
            continue
        out.append(pid)
    return out[:cap]


# ---------------------------------------------------------------- Claude calls

def _client():
    import anthropic
    return anthropic.Anthropic(max_retries=5)  # SDK retries 429/5xx/connection errors with backoff


def _create(client, **kw):
    """beta.messages.create with server-side refusal fallback; resumes pause_turn from server tools."""
    msgs = list(kw.pop("messages"))
    for _ in range(4):
        r = client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", messages=msgs, **kw)
        if r.stop_reason != "pause_turn":
            break
        msgs = msgs + [{"role": "assistant", "content": r.content}]
    if r.stop_reason == "refusal":
        raise RuntimeError("model refused")
    return r


def _json_text(r) -> dict:
    text = [b.text for b in r.content if b.type == "text"]
    if not text:
        raise ValueError(f"no text in response (stop_reason={r.stop_reason})")
    return json.loads(text[-1])


def _sources(r, n: int = 6) -> list[dict]:
    """Cited search results first, then remaining search results; deduped by url."""
    found = []
    for b in r.content:
        for c in getattr(b, "citations", None) or []:
            if getattr(c, "url", None):
                found.append((c.url, getattr(c, "title", None) or c.url))
    for b in r.content:
        if b.type == "web_search_tool_result" and isinstance(b.content, list):
            found += [(x.url, x.title or x.url) for x in b.content if getattr(x, "url", None)]
    out, seen = [], set()
    for url, title in found:
        if url not in seen:
            seen.add(url)
            out.append({"title": title, "url": url})
    return out[:n]


def _player_brief(p: dict, cur: int) -> dict:
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


def outlook_prompt(p: dict, cur: int) -> str:
    return (
        f"{LEAGUE_FACTS}\nCurrent NFL week: {cur}.\n\n"
        f"Our model's numbers for {p['name']} ({p['pos']}, {p['team'] or 'FA'}):\n"
        f"{json.dumps(_player_brief(p, cur), indent=1)}\n\n"
        "proj_by_week is our calibrated, availability-adjusted league-scoring projection. ros_par is weighted "
        "points above replacement for the rest of the season (playoff weeks weighted up); the tag is our "
        "model's BUY/SELL/HOLD.\n\n"
        "Search for recent analyst and news coverage of this player (injuries, role and snap changes, depth "
        "chart, coach quotes, schedule) - at most 3 searches. Then write a rest-of-season outlook for this "
        "league's scoring. signal: your BUY/SELL/HOLD call (you may disagree with the model; say why). "
        "summary: 2-4 sentences, concrete, citing what the news adds beyond the numbers. "
        "risks: 1-4 short specific risks."
    )


def gen_outlook(client, p: dict, cur: int, now: datetime) -> dict:
    r = _create(
        client, model=OUTLOOK_MODEL, max_tokens=16000,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": OUTLOOK_SCHEMA}},
        tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 3}],
        messages=[{"role": "user", "content": outlook_prompt(p, cur)}],
    )
    o = _json_text(r)
    return {"signal": o["signal"], "summary": o["summary"], "risks": list(o["risks"]),
            "sources": _sources(r), "updated": now.isoformat(timespec="seconds"), "model": OUTLOOK_MODEL}


def gen_outlooks(client, players: list[dict], ids: list[str], cur: int, now: datetime) -> dict[str, dict]:
    by_id = {p["id"]: p for p in players}

    def one(pid):
        try:
            return pid, gen_outlook(client, by_id[pid], cur, now)
        except Exception as e:  # one bad player must not sink the run
            print(f"  outlook {pid} ({by_id[pid]['name']}) failed: {type(e).__name__}: {e}")
            return pid, None

    with ThreadPoolExecutor(WORKERS) as ex:
        return {pid: o for pid, o in ex.map(one, ids) if o}


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
        "meta": meta,
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


BRIEFING_SYSTEM = (
    "You are the general manager's assistant for a fantasy football team. " + LEAGUE_FACTS + "\n"
    "Goal: the playoff push - maximise playoff odds and playoff-week (15-17) strength. "
    "Trade acceptability is driven by FantasyCalc value fairness (fc_value): propose trades the other "
    "manager would plausibly accept on market value while we gain ROS points. FAAB is never part of a "
    "trade. Waiver bids come out of our remaining FAAB. Respect the week-11 trade deadline. "
    "ros/ros_playoff are points above replacement. Refer to players by name and list their ids in "
    "player_ids. Give 3-5 concrete, prioritised moves."
)


def gen_briefing(client, inp: dict, now: datetime) -> dict:
    r = _create(
        client, model=BRIEFING_MODEL, max_tokens=16000, system=BRIEFING_SYSTEM,
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": BRIEFING_SCHEMA}},
        messages=[{"role": "user", "content": "This week's data:\n" + json.dumps(inp, separators=(",", ":"))
                   + "\n\nWrite this week's briefing: situation, 3-5 moves, and your reasoning."}],
    )
    b = _json_text(r)
    out = {"week": inp["meta"]["week"], "generated_at": now.isoformat(timespec="seconds"),
           "situation": b["situation"], "moves": b["moves"], "reasoning": b["reasoning"]}
    validate("briefing", out)
    return out


# ---------------------------------------------------------------- hook

def _load_outlooks() -> dict:
    f = config.OUT_DIR / "outlooks.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def build(data: dict, client=None) -> None:
    from .model import load_snapshots
    from .run import my_roster_id, write_json

    if client is None and not os.environ.get("ANTHROPIC_API_KEY"):
        print("WARNING: ANTHROPIC_API_KEY not set; skipping LLM outlooks and briefing")
        return
    client = client or _client()
    now = _now()
    players, league, cur = data["players_out"], data["league_out"], data["week"]
    my_rid = my_roster_id(data)

    snaps = load_snapshots(now.date().isoformat())
    prev = snaps[-1][1] if snaps else {}
    outlooks = _load_outlooks()
    ids = select_scope(players, league, my_rid, prev, outlooks, now)
    if data.get("llm_limit") is not None:
        ids = ids[:data["llm_limit"]]
    print(f"\nLLM outlooks: {len(ids)} players")
    outlooks.update(gen_outlooks(client, players, ids, cur, now))
    write_json("outlooks.json", outlooks, "outlooks")
    print(f"wrote {config.OUT_DIR / 'outlooks.json'} ({len(outlooks)} outlooks)")

    passphrase = os.environ.get("BRIEFING_PASSPHRASE")
    if not passphrase:
        print("WARNING: BRIEFING_PASSPHRASE not set; skipping briefing")
    else:
        meta = {"season": data["season"], "week": cur, "my_roster_id": my_rid,
                "trade_deadline_week": 11, "playoff_weeks": [15, 16, 17], "faab_budget": 200}
        try:
            brief = gen_briefing(client, briefing_input(meta, players, league, my_rid, outlooks), now)
            path = config.OUT_DIR / "private" / "briefing.enc"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(encrypt_json(brief, passphrase), encoding="utf-8")
            print(f"wrote {path} ({len(brief['moves'])} moves, encrypted)")
        except Exception as e:
            print(f"WARNING: briefing failed: {type(e).__name__}: {e}")

    data["llm_generated_at"] = now.isoformat(timespec="seconds")
