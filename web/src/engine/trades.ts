import type { Player, Team } from "../types/data";
import { tradeRate } from "./history";
import { combinations } from "./lineup";
import { rosGain, rosterIds, weeklyTotals, type EngineCtx } from "./team";

export const MAX_SEND = 3;
/** FantasyCalc gate: received / sent must sit inside [FAIR_MIN, FAIR_MAX]. */
export const FAIR_MIN = 0.8;
export const FAIR_MAX = 1.1;
/** Rivals within this many projected wins of me count as direct competition. */
export const RIVAL_WINS_WINDOW = 1.5;
/** Partner ROS gain (pts) that maps to a full partner_gain score. */
const PARTNER_SCALE = 20;
const MIN_GAIN = 0.5;
const MAX_OFFERS = 12;

export interface AcceptParts {
  /** 0..1, partner's trade frequency vs the league's most active trader. */
  trade_rate: number;
  /** 0..1, past trades with me (3+ = 1). */
  history: number;
  /** 0..1, FC value they receive vs give (1 = they get at least as much). */
  fairness: number;
  /** 0..1, 0.5 = neutral; from the partner's ROS lineup change. */
  partner_gain: number;
}

export interface TradeOffer {
  rival: Team;
  target: Player;
  send: Player[];
  fc_sent: number;
  fc_received: number;
  /** My ROS optimal-lineup change (playoff-weighted weekly proj sum). */
  gain_ros: number;
  /** Partner's ROS optimal-lineup change; positive = good for them. */
  partner_gain: number;
  accept: number;
  parts: AcceptParts;
  rank: number;
  /** Offer strengthens a rival within RIVAL_WINS_WINDOW projected wins of me. */
  helps_rival: boolean;
}

export function fairnessGate(fcSent: number, fcReceived: number): boolean {
  if (!(fcSent > 0) || !(fcReceived > 0)) return false;
  return fcReceived <= FAIR_MAX * fcSent && fcReceived >= FAIR_MIN * fcSent;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function acceptance(parts: AcceptParts): number {
  const raw = 0.3 * parts.trade_rate + 0.15 * parts.history + 0.25 * parts.fairness + 0.3 * parts.partner_gain;
  return clamp(raw, 0, 0.98);
}

export function tradeBoard(ctx: EngineCtx): TradeOffer[] {
  const fc = (p: Player) => p.signals.fc_value;
  const myIds = rosterIds(ctx.me, ctx.players);
  const myBefore = weeklyTotals(ctx, myIds);
  const mine = myIds
    .map((id) => ctx.players.get(id)!)
    .filter((p) => fc(p) != null && fc(p)! > 0)
    .sort((a, b) => fc(a)! - fc(b)!);
  const packages = combinations(mine, MAX_SEND).map((combo) => ({
    combo,
    ids: new Set(combo.map((p) => p.id)),
    fc: combo.reduce((s, p) => s + fc(p)!, 0),
  }));

  const offers: TradeOffer[] = [];
  for (const rival of ctx.teams) {
    if (rival.roster_id === ctx.me.roster_id) continue;
    const rivalIds = rosterIds(rival, ctx.players);
    const rivalBefore = weeklyTotals(ctx, rivalIds);
    const parts0 = {
      trade_rate: tradeRate(ctx.history, rival.roster_id),
      history: Math.min(1, (ctx.history.withMe.get(rival.roster_id) ?? 0) / 3),
    };
    const helpsRival = Math.abs(rival.proj_wins - ctx.me.proj_wins) <= RIVAL_WINS_WINDOW;

    for (const tid of rivalIds) {
      const target = ctx.players.get(tid)!;
      const recv = fc(target);
      if (recv == null || recv <= 0) continue;

      let best: TradeOffer | null = null;
      for (const pkg of packages) {
        if (!fairnessGate(pkg.fc, recv)) continue;
        const myAfter = [...myIds.filter((id) => !pkg.ids.has(id)), tid];
        const gain = rosGain(ctx, myBefore, myAfter);
        if (gain <= MIN_GAIN) continue;
        const rivalAfter = [...rivalIds.filter((id) => id !== tid), ...pkg.ids];
        const partnerGain = rosGain(ctx, rivalBefore, rivalAfter);
        const parts: AcceptParts = {
          ...parts0,
          fairness: clamp(pkg.fc / recv, 0, 1),
          partner_gain: clamp(0.5 + partnerGain / (2 * PARTNER_SCALE), 0, 1),
        };
        const accept = acceptance(parts);
        const rank = gain * accept;
        if (!best || rank > best.rank) {
          best = {
            rival,
            target,
            send: pkg.combo,
            fc_sent: pkg.fc,
            fc_received: recv,
            gain_ros: gain,
            partner_gain: partnerGain,
            accept,
            parts,
            rank,
            helps_rival: helpsRival && partnerGain > 0,
          };
        }
      }
      if (best) offers.push(best);
    }
  }
  return offers.sort((a, b) => b.rank - a.rank).slice(0, MAX_OFFERS);
}

export function copyOffer(trade: TradeOffer): string {
  return (
    "Trade offer\n\nYou get: " +
    trade.send.map((p) => p.name + " (" + p.pos + ")").join(", ") +
    "\nI get: " +
    trade.target.name +
    " (" +
    trade.target.pos +
    ")"
  );
}
