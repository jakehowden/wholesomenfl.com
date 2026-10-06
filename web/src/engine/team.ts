import type { Player, Pos, Team } from "../types/data";
import { sweepTrades, type TradeStats } from "./history";
import {
  indexPlayers,
  optimalLineup,
  posLookup,
  projLookup,
  remainingWeeks,
  startingSlots,
  weekWeight,
  type Lineup,
} from "./lineup";

export const POSITIONS: readonly Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface EngineCtx {
  week: number;
  /** cur..17, the weeks ROS sums run over. */
  weeks: number[];
  players: Map<string, Player>;
  teams: Team[];
  me: Team;
  slots: string[];
  history: TradeStats;
}

export interface EngineInput {
  week: number;
  players: readonly Player[];
  teams: Team[];
  myRosterId: number;
  rosterPositions?: readonly string[];
  history?: TradeStats;
}

export function buildContext(input: EngineInput): EngineCtx {
  const me = input.teams.find((t) => t.roster_id === input.myRosterId);
  if (!me) throw new Error("Roster " + input.myRosterId + " not in league");
  return {
    week: input.week,
    weeks: remainingWeeks(input.week),
    players: indexPlayers(input.players),
    teams: input.teams,
    me,
    slots: startingSlots(input.rosterPositions),
    history: input.history ?? sweepTrades([], input.myRosterId),
  };
}

/** Roster ids that the player index knows about. */
export const rosterIds = (team: Team, players: Map<string, Player>): string[] =>
  team.roster.filter((id) => players.has(id));

/** Per-week lineup totals for a roster, so gain sums can reuse the baseline. */
export function weeklyTotals(ctx: EngineCtx, ids: readonly string[]): number[] {
  const posOf = posLookup(ctx.players);
  return ctx.weeks.map((w) => optimalLineup(ids, projLookup(ctx.players, w), ctx.slots, posOf).total);
}

/** Playoff-weighted Σ over remaining weeks of (lineup with `after`) − `before` totals. */
export function rosGain(ctx: EngineCtx, before: readonly number[], after: readonly string[]): number {
  const totals = weeklyTotals(ctx, after);
  let g = 0;
  ctx.weeks.forEach((w, i) => (g += weekWeight(w) * (totals[i] - before[i])));
  return Math.round(g * 10) / 10;
}

export interface TeamProfile {
  team: Team;
  ids: string[];
  /** This week's optimal lineup. */
  lineup: Lineup;
  starters: string[];
  /** Rostered players outside the optimal lineup, best first. */
  bench: string[];
  /** Positive part of position strength (starter pts above league avg). */
  surplus: Record<Pos, number>;
  /** Negative part of position strength, as a positive number. */
  need: Record<Pos, number>;
}

const zeroByPos = (): Record<Pos, number> => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 });

const hasPosStrength = (t: Team): boolean =>
  !!t.pos_strength && POSITIONS.some((p) => typeof t.pos_strength[p] === "number" && t.pos_strength[p] !== 0);

/** Profiles for every team. Uses Team.pos_strength from league.json, else derives it from this week's starters. */
export function teamProfiles(ctx: EngineCtx): TeamProfile[] {
  const valueOf = projLookup(ctx.players, ctx.week);
  const posOf = posLookup(ctx.players);
  const base = ctx.teams.map((team) => {
    const ids = rosterIds(team, ctx.players);
    const lineup = optimalLineup(ids, valueOf, ctx.slots, posOf);
    const starters = lineup.assigned.filter((id): id is string => id != null);
    const bench = ids.filter((id) => !lineup.used.has(id)).sort((a, b) => valueOf(b) - valueOf(a));
    const atPos = zeroByPos();
    for (const id of starters) {
      const pos = ctx.players.get(id)?.pos;
      if (pos) atPos[pos] += valueOf(id);
    }
    return { team, ids, lineup, starters, bench, atPos };
  });

  const avg = zeroByPos();
  for (const b of base) for (const p of POSITIONS) avg[p] += b.atPos[p] / base.length;

  return base.map(({ team, ids, lineup, starters, bench, atPos }) => {
    const surplus = zeroByPos();
    const need = zeroByPos();
    for (const p of POSITIONS) {
      const strength = hasPosStrength(team) ? team.pos_strength[p] : atPos[p] - avg[p];
      surplus[p] = Math.max(0, strength);
      need[p] = Math.max(0, -strength);
    }
    return { team, ids, lineup, starters, bench, surplus, need };
  });
}

export function teamProfile(ctx: EngineCtx, rosterId: number): TeamProfile | undefined {
  return teamProfiles(ctx).find((p) => p.team.roster_id === rosterId);
}
