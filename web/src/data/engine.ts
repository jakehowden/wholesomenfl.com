import type { PortalData } from "./load";
import type { Player, Team } from "../types/data";
import { buildActions, lineupIssues, type Action, type LineupIssue } from "../engine/actions";
import { sweepTrades } from "../engine/history";
import { buildContext, type EngineCtx } from "../engine/team";
import { tradeBoard, type TradeOffer } from "../engine/trades";
import { waiverBoard, type WaiverRow } from "../engine/waivers";

interface Cached {
  ctx: EngineCtx;
  waivers?: WaiverRow[];
  trades?: TradeOffer[];
}

// Keyed on the league object, so every tab shares one engine run per data load.
const cache = new WeakMap<object, Cached>();

function cached(data: PortalData): Cached {
  let c = cache.get(data.league);
  if (!c) {
    const my = data.meta.my_roster_id;
    const history = sweepTrades(
      data.league.transactions.map((t) => ({ type: t.type, status: t.status, roster_ids: t.sides.map((s) => s.roster_id) })),
      my,
    );
    c = {
      ctx: buildContext({ week: data.meta.week, players: data.players, teams: data.league.teams, myRosterId: my, history }),
    };
    cache.set(data.league, c);
  }
  return c;
}

export const engineCtx = (data: PortalData): EngineCtx => cached(data).ctx;

export function waiversFor(data: PortalData): WaiverRow[] {
  const c = cached(data);
  return (c.waivers ??= waiverBoard(c.ctx));
}

export function tradesFor(data: PortalData): TradeOffer[] {
  const c = cached(data);
  return (c.trades ??= tradeBoard(c.ctx));
}

/** My Sleeper starters, slot-aligned. Null until live data arrives. */
export function liveStarters(data: PortalData): (string | null)[] | null {
  const r = data.live?.rosters.find((x) => x.roster_id === data.meta.my_roster_id);
  return r?.starters ? r.starters.map((id) => (id && id !== "0" ? id : null)) : null;
}

export function issuesFor(data: PortalData): LineupIssue[] {
  const starters = liveStarters(data);
  return starters ? lineupIssues(engineCtx(data), starters) : [];
}

export const actionsFor = (data: PortalData): Action[] =>
  buildActions(engineCtx(data), { waivers: waiversFor(data), trades: tradesFor(data), issues: issuesFor(data) });

/** Power rank by ROS strength, 1 = strongest. */
export function powerRanks(teams: readonly Team[]): Map<number, number> {
  const order = [...teams].sort((a, b) => b.ros_strength - a.ros_strength);
  return new Map(order.map((t, i) => [t.roster_id, i + 1]));
}

export function ownerOf(data: PortalData, p: Player): string {
  if (p.roster_id == null) return "Free agent";
  return data.league.teams.find((t) => t.roster_id === p.roster_id)?.owner ?? "Team " + p.roster_id;
}
