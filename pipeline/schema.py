"""Data contract for web/public/data/*. Mirrors overview.md and web/src/types/data.ts exactly."""
from __future__ import annotations

import types
import typing
from typing import Literal, Optional, Tuple, TypedDict, Union

Pos = Literal["QB", "RB", "WR", "TE", "K", "DEF"]
Tag = Literal["BUY", "SELL", "HOLD"]


# meta.json
class Meta(TypedDict):
    generated_at: str
    season: str
    week: int
    league_id: str
    my_roster_id: int
    sources: dict[str, str]
    llm_generated_at: Optional[str]


# players.json -> list[Player]
class SeasonLine(TypedDict):
    games: int
    pts: float
    ppg: float
    xfp: float
    xfp_pg: float


class WeekValue(TypedDict):
    week: int
    value: float


class DateValue(TypedDict):
    date: str
    value: float


class Signals(TypedDict):
    usage_trend: float
    usage_metric: str
    usage_series: list[WeekValue]
    snap_series: list[WeekValue]
    luck: float
    market_drift: Optional[float]
    fc_value: Optional[float]
    fc_rank: Optional[int]
    market_gap: Optional[float]
    fc_history: list[DateValue]
    breakout: Optional[str]


class Player(TypedDict):
    id: str
    name: str
    pos: Pos
    team: Optional[str]
    bye: Optional[int]
    injury: Optional[str]
    roster_id: Optional[int]
    proj: dict[str, float]
    ros: float
    ros_playoff: float
    ros_rank: int
    ros_pos_rank: int
    repl: float
    season: SeasonLine
    signals: Signals
    tag: Tag
    tag_reasons: list[str]


# league.json
class Team(TypedDict):
    roster_id: int
    owner: str
    avatar: Optional[str]
    wins: int
    losses: int
    ties: int
    pf: float
    pa: float
    all_play_w: int
    all_play_l: int
    ros_strength: float
    pos_strength: dict[Pos, float]
    playoff_odds: float
    seed_dist: list[float]
    proj_wins: float
    faab_left: float
    roster: list[str]


class TxSide(TypedDict):
    roster_id: int
    adds: list[str]
    drops: list[str]
    ros_delta: float


class Tx(TypedDict):
    id: str
    type: Literal["trade", "waiver", "free_agent"]
    week: int
    status: str
    sides: list[TxSide]
    grade: Optional[str]
    faab: Optional[float]


class ScheduleWeek(TypedDict):
    week: int
    matchups: list[Tuple[int, int]]


class Sim(TypedDict):
    runs: int
    sd: float


class League(TypedDict):
    teams: list[Team]
    schedule: list[ScheduleWeek]
    transactions: list[Tx]
    sim: Sim


# outlooks.json -> dict[player_id, Outlook]
class Source(TypedDict):
    title: str
    url: str


class Outlook(TypedDict):
    signal: Tag
    summary: str
    risks: list[str]
    sources: list[Source]
    updated: str
    model: str


# private/briefing.enc plaintext
class Move(TypedDict):
    kind: Literal["trade", "waiver", "lineup", "hold"]
    title: str
    detail: str
    player_ids: list[str]


class Briefing(TypedDict):
    week: int
    generated_at: str
    situation: str
    moves: list[Move]
    reasoning: str


SCHEMAS = {
    "meta": Meta,
    "players": list[Player],
    "league": League,
    "outlooks": dict[str, Outlook],
    "briefing": Briefing,
}


def _is_typeddict(t) -> bool:
    return isinstance(t, type) and issubclass(t, dict) and hasattr(t, "__annotations__")


def _check(t, v, path: str) -> None:
    origin = typing.get_origin(t)
    args = typing.get_args(t)

    if t is typing.Any:
        return
    if t is type(None):
        if v is not None:
            raise TypeError(f"{path}: expected null, got {type(v).__name__}")
        return
    if origin is Union or (hasattr(types, "UnionType") and isinstance(t, types.UnionType)):
        errors = []
        for a in args:
            try:
                _check(a, v, path)
                return
            except (TypeError, KeyError) as e:
                errors.append(str(e))
        raise TypeError(f"{path}: no union member matched ({'; '.join(errors)})")
    if origin is Literal:
        if v not in args:
            raise TypeError(f"{path}: {v!r} not in {args}")
        return
    if _is_typeddict(t):
        if not isinstance(v, dict):
            raise TypeError(f"{path}: expected object, got {type(v).__name__}")
        hints = typing.get_type_hints(t)
        for key, kt in hints.items():
            if key not in v:
                raise KeyError(f"{path}.{key}: missing")
            _check(kt, v[key], f"{path}.{key}")
        return
    if origin is list:
        if not isinstance(v, list):
            raise TypeError(f"{path}: expected list, got {type(v).__name__}")
        for i, item in enumerate(v):
            _check(args[0], item, f"{path}[{i}]")
        return
    if origin is tuple:
        if not isinstance(v, (list, tuple)) or len(v) != len(args):
            raise TypeError(f"{path}: expected {len(args)}-tuple, got {v!r}")
        for i, (a, item) in enumerate(zip(args, v)):
            _check(a, item, f"{path}[{i}]")
        return
    if origin is dict:
        if not isinstance(v, dict):
            raise TypeError(f"{path}: expected object, got {type(v).__name__}")
        for k, item in v.items():
            _check(args[0], k, f"{path}<key>")
            _check(args[1], item, f"{path}[{k!r}]")
        return
    if t is bool:
        ok = isinstance(v, bool)
    elif t is int:
        ok = not isinstance(v, bool) and (isinstance(v, int) or (isinstance(v, float) and v.is_integer()))
    elif t is float:
        ok = not isinstance(v, bool) and isinstance(v, (int, float))
    elif t is str:
        ok = isinstance(v, str)
    else:
        raise TypeError(f"{path}: unsupported schema type {t!r}")
    if not ok:
        raise TypeError(f"{path}: expected {t.__name__}, got {type(v).__name__} ({v!r})")


def validate(name: str, obj) -> None:
    """Raise KeyError/TypeError if obj doesn't match the named contract (meta, players, league, outlooks, briefing)."""
    _check(SCHEMAS[name], obj, name)
