import type { Player } from "../types/data";

export const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  WRRB_WRT: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};
export const BENCH_SLOTS: readonly string[] = ["BN", "IR", "TAXI"];

/** This league's Sleeper roster_positions (see overview). */
export const ROSTER_POSITIONS: readonly string[] = [
  "QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "K", "DEF",
  "BN", "BN", "BN", "BN", "BN", "BN", "IR",
];

export const LAST_WEEK = 17;
export const PLAYOFF_START = 15;
/** Playoff weeks count this much more than regular-season weeks in ROS sums. */
export const PLAYOFF_WEIGHT = 1.5;

export function startingSlots(rosterPositions: readonly string[] = ROSTER_POSITIONS): string[] {
  return rosterPositions.filter((s) => !BENCH_SLOTS.includes(s));
}

export interface Lineup {
  total: number;
  used: Set<string>;
  /** Player id per starting slot index, null if nobody eligible. */
  assigned: (string | null)[];
}

/** Greedy fill, narrowest slots first, so SUPER_FLEX gets whoever is left (e.g. the second QB). */
export function optimalLineup(
  playerIds: readonly string[],
  valueOf: (id: string) => number,
  slots: readonly string[],
  posOf: (id: string) => string | undefined,
): Lineup {
  const order = slots
    .map((slot, i) => ({ slot, i, width: (SLOT_ELIGIBILITY[slot] ?? []).length }))
    .sort((a, b) => a.width - b.width || a.i - b.i);
  const used = new Set<string>();
  const assigned: (string | null)[] = slots.map(() => null);
  let total = 0;
  for (const { slot, i } of order) {
    const elig = SLOT_ELIGIBILITY[slot] ?? [];
    let best: string | null = null;
    let bestVal = -Infinity;
    for (const id of playerIds) {
      if (used.has(id)) continue;
      const pos = posOf(id);
      if (!pos || !elig.includes(pos)) continue;
      const v = valueOf(id);
      if (v > bestVal) {
        best = id;
        bestVal = v;
      }
    }
    if (best) {
      used.add(best);
      total += bestVal;
    }
    assigned[i] = best;
  }
  return { total: Math.round(total * 10) / 10, used, assigned };
}

export function combinations<T>(list: readonly T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length) out.push(picked.slice());
    if (picked.length === maxSize) return;
    for (let i = start; i < list.length; i++) {
      picked.push(list[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

export const indexPlayers = (players: readonly Player[]): Map<string, Player> =>
  new Map(players.map((p) => [p.id, p]));

export const posLookup = (players: Map<string, Player>) => (id: string) => players.get(id)?.pos;

/** This week's projection lookup. */
export const projLookup = (players: Map<string, Player>, week: number) => (id: string) =>
  players.get(id)?.proj[String(week)] ?? 0;

/** Mean ROS per remaining week: an alternative `valueOf` for season-long views. */
export const rosPerWeekLookup = (players: Map<string, Player>, week: number) => {
  const n = Math.max(1, LAST_WEEK - week + 1);
  return (id: string) => (players.get(id)?.ros ?? 0) / n;
};

export function remainingWeeks(cur: number): number[] {
  const out: number[] = [];
  for (let w = Math.max(1, cur); w <= LAST_WEEK; w++) out.push(w);
  return out;
}

export const weekWeight = (w: number): number => (w >= PLAYOFF_START ? PLAYOFF_WEIGHT : 1);

/** Σ over weeks of the optimal lineup total using weekly proj, playoff-weighted. */
export function rosLineupTotal(
  ids: readonly string[],
  players: Map<string, Player>,
  slots: readonly string[],
  weeks: readonly number[],
): number {
  const posOf = posLookup(players);
  let total = 0;
  for (const w of weeks) total += weekWeight(w) * optimalLineup(ids, projLookup(players, w), slots, posOf).total;
  return Math.round(total * 10) / 10;
}
