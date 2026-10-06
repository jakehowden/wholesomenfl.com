import type { Player } from "../types/data";
import { optimalLineup, posLookup, projLookup, weekWeight } from "./lineup";
import { rosGain, rosterIds, weeklyTotals, type EngineCtx } from "./team";

export const GAIN_CAP = 25;
/** Rival lineups must improve by this much per week for the player to count as contested. */
export const RIVAL_DEMAND_MIN = 3;
const PER_POS = 3;

export interface WaiverRow {
  player: Player;
  /** This week's optimal-lineup gain. */
  gain_now: number;
  /** Σ remaining weeks of lineup gain, playoff-weighted. */
  gain_ros: number;
  alternatives: number;
  demand: number;
  bid: number;
  /** My starter the claim would displace this week, if any. */
  replaces: Player | null;
  signals: Player["signals"];
  breakout: string | null;
}

const weightSum = (ctx: EngineCtx) => ctx.weeks.reduce((s, w) => s + weekWeight(w), 0);

export function freeAgents(ctx: EngineCtx): Player[] {
  const rostered = new Set<string>();
  for (const t of ctx.teams) for (const id of t.roster) rostered.add(id);
  return [...ctx.players.values()].filter(
    (p) => p.roster_id == null && !rostered.has(p.id) && ctx.weeks.some((w) => (p.proj[String(w)] ?? 0) > 0),
  );
}

function weakestStarterFor(ctx: EngineCtx, ids: readonly string[], incoming: string): Player | null {
  const valueOf = projLookup(ctx.players, ctx.week);
  const posOf = posLookup(ctx.players);
  const before = optimalLineup(ids, valueOf, ctx.slots, posOf);
  const after = optimalLineup([...ids, incoming], valueOf, ctx.slots, posOf);
  for (const id of before.used) if (!after.used.has(id)) return ctx.players.get(id) ?? null;
  return null;
}

export function waiverBoard(ctx: EngineCtx): WaiverRow[] {
  const myIds = rosterIds(ctx.me, ctx.players);
  const valueNow = projLookup(ctx.players, ctx.week);
  const posOf = posLookup(ctx.players);
  const nowBefore = optimalLineup(myIds, valueNow, ctx.slots, posOf).total;
  const rosBefore = weeklyTotals(ctx, myIds);

  const scored: { player: Player; gain_now: number; gain_ros: number }[] = [];
  for (const fa of freeAgents(ctx)) {
    const withAdd = [...myIds, fa.id];
    const gain_now = Math.round((optimalLineup(withAdd, valueNow, ctx.slots, posOf).total - nowBefore) * 10) / 10;
    const gain_ros = rosGain(ctx, rosBefore, withAdd);
    if (gain_now <= 0.2 && gain_ros <= 1) continue;
    scored.push({ player: fa, gain_now, gain_ros });
  }
  scored.sort((a, b) => b.gain_ros - a.gain_ros || b.gain_now - a.gain_now);

  const perPos = new Map<string, number>();
  const diverse = scored.filter((row) => {
    const seen = perPos.get(row.player.pos) ?? 0;
    if (seen >= PER_POS) return false;
    perPos.set(row.player.pos, seen + 1);
    return true;
  });

  const rivals = ctx.teams.filter((t) => t.roster_id !== ctx.me.roster_id);
  const rivalBase = rivals.map((t) => {
    const ids = rosterIds(t, ctx.players);
    return { ids, before: weeklyTotals(ctx, ids) };
  });
  const weights = weightSum(ctx);
  const faab = Math.max(0, ctx.me.faab_left);

  return diverse.map((row) => {
    const alternatives = Math.max(
      1,
      scored.filter((o) => o.player.pos === row.player.pos && o.gain_ros >= row.gain_ros * 0.8).length,
    );
    let demand = 0;
    for (const rv of rivalBase) {
      if (rosGain(ctx, rv.before, [...rv.ids, row.player.id]) / weights >= RIVAL_DEMAND_MIN) demand++;
    }
    const share = Math.min(1, row.gain_ros / (GAIN_CAP * weights));
    const competition = 0.25 + 0.75 * (rivals.length ? demand / rivals.length : 0);
    const raw = (faab * share * 0.6 * competition) / Math.sqrt(alternatives);
    const bid = faab > 0 ? Math.min(faab, Math.max(1, Math.round(raw))) : 0;
    return {
      ...row,
      alternatives,
      demand,
      bid,
      replaces: weakestStarterFor(ctx, myIds, row.player.id),
      signals: row.player.signals,
      breakout: row.player.signals.breakout,
    };
  });
}
