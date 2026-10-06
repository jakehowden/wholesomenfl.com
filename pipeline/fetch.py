"""One fetcher per data source. Raw responses are cached in CACHE_DIR (6h TTL, 24h for the players dump)."""
from __future__ import annotations

import hashlib
import io
import json
import time

import pandas as pd
import requests

from . import config

SLEEPER = "https://api.sleeper.app"
FANTASYCALC = "https://api.fantasycalc.com"
FFOPP = "https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_{season}.csv"
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
GAMES = "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
ID_MAP = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv"

TTL = 6 * 3600
PLAYERS_TTL = 24 * 3600

REFRESH = False  # set True (run.py --refresh) to bypass the cache


def _get(url: str, ttl: int = TTL) -> bytes:
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = config.CACHE_DIR / hashlib.sha1(url.encode()).hexdigest()
    if not REFRESH and path.exists() and time.time() - path.stat().st_mtime < ttl:
        return path.read_bytes()
    res = requests.get(url, timeout=120, allow_redirects=True)
    res.raise_for_status()
    path.write_bytes(res.content)
    return res.content


def _json(url: str, ttl: int = TTL):
    return json.loads(_get(url, ttl))


def _csv(url: str, ttl: int = TTL) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(_get(url, ttl)), low_memory=False)


def _pos_query() -> str:
    return "&".join("position[]=" + p for p in config.FANTASY_POS)


# Sleeper

def state() -> dict:
    return _json(f"{SLEEPER}/v1/state/nfl")


def league(league_id: str = config.LEAGUE_ID) -> dict:
    return _json(f"{SLEEPER}/v1/league/{league_id}")


def rosters(league_id: str = config.LEAGUE_ID) -> list:
    return _json(f"{SLEEPER}/v1/league/{league_id}/rosters")


def users(league_id: str = config.LEAGUE_ID) -> list:
    return _json(f"{SLEEPER}/v1/league/{league_id}/users")


def matchups(week: int, league_id: str = config.LEAGUE_ID) -> list:
    return _json(f"{SLEEPER}/v1/league/{league_id}/matchups/{week}")


def transactions(league_id: str, week: int) -> list:
    return _json(f"{SLEEPER}/v1/league/{league_id}/transactions/{week}")


def players() -> dict:
    return _json(f"{SLEEPER}/v1/players/nfl", PLAYERS_TTL)


def projections(week: int, season: str = config.SEASON) -> list:
    return _json(f"{SLEEPER}/projections/nfl/{season}/{week}?season_type=regular&{_pos_query()}")


def season_stats_week(week: int, season: str = config.SEASON) -> list:
    return _json(f"{SLEEPER}/stats/nfl/{season}/{week}?season_type=regular&{_pos_query()}")


def schedule(season: str = config.SEASON) -> list:
    return _json(f"{SLEEPER}/schedule/nfl/regular/{season}")


def byes(season: str = config.SEASON) -> dict[str, int]:
    """team -> bye week, derived from the Sleeper NFL schedule (players dump has no bye)."""
    games = schedule(season)
    weeks = sorted({g["week"] for g in games})
    played: dict[str, set] = {}
    for g in games:
        for t in (g["home"], g["away"]):
            played.setdefault(t, set()).add(g["week"])
    out = {}
    for team, wks in played.items():
        missing = [w for w in weeks if w not in wks]
        if missing:
            out[team] = missing[0]
    return out


# ffopportunity (expected points; player_id = gsis id)

def ffopportunity(season: str = config.SEASON) -> pd.DataFrame:
    return _csv(FFOPP.format(season=season))


# nflverse

def nflverse_stats(season: str = config.SEASON) -> pd.DataFrame:
    return _csv(f"{NFLVERSE}/stats_player/stats_player_week_{season}.csv")


def snap_counts(season: str = config.SEASON) -> pd.DataFrame:
    return _csv(f"{NFLVERSE}/snap_counts/snap_counts_{season}.csv")


def games(season: str = config.SEASON) -> pd.DataFrame:
    df = _csv(GAMES)
    return df[df["season"] == int(season)]


# ID map (sleeper_id, gsis_id, pfr_id)

def id_map() -> pd.DataFrame:
    return _csv(ID_MAP)


# FantasyCalc

def fc_params(lg: dict) -> dict:
    """Port of app.js fcParams()."""
    slots = lg.get("roster_positions") or []
    num_qbs = 2 if "SUPER_FLEX" in slots or slots.count("QB") >= 2 else 1
    teams = lg.get("total_rosters") or 12
    num_teams = 12
    for n in (8, 10, 12, 14):
        if abs(n - teams) < abs(num_teams - teams):
            num_teams = n
    ss = lg.get("scoring_settings") or {}
    rec = ss.get("rec") or 0
    ppr = 0
    for p in (0, 0.5, 1):
        if abs(p - rec) < abs(ppr - rec):
            ppr = p
    te = ss.get("bonus_rec_te") or 0
    tep = "te++" if te >= 0.5 else "te+" if te > 0 else "none"
    is_dynasty = (lg.get("settings") or {}).get("type") == 2
    return {"isDynasty": str(is_dynasty).lower(), "numQbs": num_qbs, "numTeams": num_teams, "ppr": ppr, "tep": tep}


def fantasycalc_url(lg: dict) -> str:
    p = fc_params(lg)
    return f"{FANTASYCALC}/values/current?" + "&".join(f"{k}={v}" for k, v in p.items())


def fantasycalc(lg: dict) -> list:
    return _json(fantasycalc_url(lg))
