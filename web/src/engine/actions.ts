import type { Player } from "../types/data";
import { optimalLineup, posLookup, projLookup } from "./lineup";
import { rosterIds, type EngineCtx } from "./team";
import type { TradeOffer } from "./trades";
import type { WaiverRow } from "./waivers";

export interface LineupIssue {
  slot: string;
  current: Player | null;
  best: Player;
  /** This week's pts gained by the swap. */
  delta: number;
}

/** Slots where the set lineup (Sleeper `starters`, slot-aligned) is worse than the optimal one this week. */
export function lineupIssues(ctx: EngineCtx, starters: readonly (string | null)[]): LineupIssue[] {
  const valueOf = projLookup(ctx.players, ctx.week);
  const lineup = optimalLineup(rosterIds(ctx.me, ctx.players), valueOf, ctx.slots, posLookup(ctx.players));
  const set = new Set(starters);
  const issues: LineupIssue[] = [];
  lineup.assigned.forEach((bestId, i) => {
    if (!bestId || set.has(bestId)) return;
    const best = ctx.players.get(bestId)!;
    const curId = starters[i];
    const current = curId ? ctx.players.get(curId) ?? null : null;
    const delta = Math.round((valueOf(bestId) - (current ? valueOf(current.id) : 0)) * 10) / 10;
    if (delta <= 0.2) return;
    issues.push({ slot: ctx.slots[i], current, best, delta });
  });
  return issues.sort((a, b) => b.delta - a.delta);
}

export interface Action {
  kind: "lineup" | "waiver" | "trade" | "sell";
  title: string;
  detail: string;
  player_ids: string[];
  /** Points gained: pts this week for lineup, ROS pts for waiver/trade, the player's ROS for sell. */
  gain: number;
}

export interface ActionsInput {
  waivers: readonly WaiverRow[];
  trades: readonly TradeOffer[];
  issues: readonly LineupIssue[];
}

export function buildActions(ctx: EngineCtx, { waivers, trades, issues }: ActionsInput): Action[] {
  const out: Action[] = [];
  for (const issue of issues) {
    out.push({
      kind: "lineup",
      title: "Start " + issue.best.name + " over " + (issue.current ? issue.current.name : "an empty " + issue.slot),
      detail:
        issue.slot + " is set to " +
        (issue.current ? issue.current.name + (issue.current.injury ? " (" + issue.current.injury + ")" : "") : "nobody") +
        ". " + issue.best.name + " projects " + issue.delta.toFixed(1) + " more this week.",
      player_ids: [issue.best.id, ...(issue.current ? [issue.current.id] : [])],
      gain: issue.delta,
    });
  }
  const w = waivers[0];
  if (w) {
    out.push({
      kind: "waiver",
      title: "Claim " + w.player.name + (w.replaces ? " over " + w.replaces.name : "") + " for $" + w.bid,
      detail:
        w.player.name + " (" + w.player.pos + (w.player.team ? ", " + w.player.team : "") + ") adds " +
        w.gain_ros.toFixed(1) + " ROS lineup pts (" + w.gain_now.toFixed(1) + " this week). " +
        (w.demand === 0 ? "No rival needs him." : w.demand + " rival" + (w.demand === 1 ? "" : "s") + " would also gain."),
      player_ids: [w.player.id, ...(w.replaces ? [w.replaces.id] : [])],
      gain: w.gain_ros,
    });
  }
  const t = trades[0];
  if (t) {
    out.push({
      kind: "trade",
      title: "Get " + t.target.name + " from " + t.rival.owner + " for " + t.send.map((p) => p.name).join(", "),
      detail:
        "+" + t.gain_ros.toFixed(1) + " ROS lineup pts, " + Math.round(t.accept * 100) + "% likely. FantasyCalc " +
        Math.round(t.fc_sent) + " sent vs " + Math.round(t.fc_received) + " received." +
        (t.helps_rival ? " Strengthens a rival close to you in the standings." : ""),
      player_ids: [t.target.id, ...t.send.map((p) => p.id)],
      gain: t.gain_ros,
    });
  }
  const sell = rosterIds(ctx.me, ctx.players)
    .map((id) => ctx.players.get(id)!)
    .filter((p) => p.tag === "SELL")
    .sort((a, b) => (b.signals.fc_value ?? 0) - (a.signals.fc_value ?? 0))[0];
  if (sell) {
    out.push({
      kind: "sell",
      title: "Sell " + sell.name,
      detail: sell.tag_reasons.join(". ") || "Tagged SELL by the value model.",
      player_ids: [sell.id],
      gain: sell.ros,
    });
  }
  return out;
}
