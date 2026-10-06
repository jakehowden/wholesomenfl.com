import type { League, Meta, Outlook, Player } from "../types/data";

export interface PortalData {
  meta: Meta;
  players: Player[];
  league: League;
  outlooks: Record<string, Outlook>;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + " on " + url.replace(/^https:\/\//, ""));
  return (await res.json()) as T;
}

async function loadPublished(): Promise<PortalData> {
  const base = import.meta.env.BASE_URL + "data/";
  const [meta, players, league, outlooks] = await Promise.all([
    getJSON<Meta>(base + "meta.json"),
    getJSON<Player[]>(base + "players.json"),
    getJSON<League>(base + "league.json"),
    getJSON<Record<string, Outlook>>(base + "outlooks.json").catch(() => ({})),
  ]);
  return { meta, players, league, outlooks };
}

async function loadFixtures(): Promise<PortalData> {
  const [meta, players, league, outlooks] = await Promise.all([
    import("../fixtures/meta.json"),
    import("../fixtures/players.json"),
    import("../fixtures/league.json"),
    import("../fixtures/outlooks.json"),
  ]);
  return {
    meta: meta.default as Meta,
    players: players.default as Player[],
    league: league.default as unknown as League,
    outlooks: outlooks.default as Record<string, Outlook>,
  };
}

/** Pipeline output from web/public/data. In dev, falls back to the bundled fixtures. */
export async function loadData(): Promise<PortalData> {
  try {
    return await loadPublished();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("Published data unavailable, using fixtures:", err);
      return loadFixtures();
    }
    throw err;
  }
}

// ---- Live Sleeper data, so lineups reflect today rather than the last pipeline run ----

const SLEEPER = "https://api.sleeper.app";
const FANTASY_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  settings: Record<string, number>;
}
export interface SleeperUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string };
}
export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
  previous_league_id: string | null;
}
export interface SleeperProjection {
  player_id: string;
  stats: Record<string, number>;
}

export interface LiveData {
  week: number;
  season: string;
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  projections: SleeperProjection[];
}

export async function loadLive(leagueId: string): Promise<LiveData> {
  const [state, league] = await Promise.all([
    getJSON<{ week: number; season: string }>(SLEEPER + "/v1/state/nfl"),
    getJSON<SleeperLeague>(SLEEPER + "/v1/league/" + leagueId),
  ]);
  const season = league.season || state.season;
  const week = Math.min(18, Math.max(1, state.week || 1));
  const q = FANTASY_POS.map((p) => "position[]=" + p).join("&");
  const [rosters, users, projections] = await Promise.all([
    getJSON<SleeperRoster[]>(SLEEPER + "/v1/league/" + leagueId + "/rosters"),
    getJSON<SleeperUser[]>(SLEEPER + "/v1/league/" + leagueId + "/users"),
    getJSON<SleeperProjection[]>(SLEEPER + "/projections/nfl/" + season + "/" + week + "?season_type=regular&" + q),
  ]);
  return { week, season, league, rosters, users, projections };
}
