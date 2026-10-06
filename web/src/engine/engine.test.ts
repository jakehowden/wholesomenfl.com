import { describe, expect, it } from "vitest";
import playersJson from "../fixtures/players.json";
import leagueJson from "../fixtures/league.json";
import type { League, Player, Team } from "../types/data";
import { buildActions, lineupIssues } from "./actions";
import { sweepTrades } from "./history";
import { optimalLineup, startingSlots } from "./lineup";
import { buildContext, rosGain, teamProfiles, weeklyTotals } from "./team";
import { copyOffer, fairnessGate, tradeBoard } from "./trades";
import { waiverBoard } from "./waivers";

const players = playersJson as Player[];
const league = leagueJson as unknown as League;
const ctxFor = (teams: Team[] = league.teams) => buildContext({ week: 5, players, teams, myRosterId: 1 });

describe("lineup", () => {
  it("fills SUPER_FLEX with the leftover QB", () => {
    const pos: Record<string, string> = { qb1: "QB", qb2: "QB", rb1: "RB", wr1: "WR", te1: "TE" };
    const val: Record<string, number> = { qb1: 25, qb2: 20, rb1: 10, wr1: 9, te1: 8 };
    const slots = startingSlots(["QB", "RB", "WR", "TE", "SUPER_FLEX", "BN"]);
    const lu = optimalLineup(Object.keys(pos), (id) => val[id], slots, (id) => pos[id]);
    expect(lu.assigned[slots.indexOf("QB")]).toBe("qb1");
    expect(lu.assigned[slots.indexOf("SUPER_FLEX")]).toBe("qb2");
    expect(lu.total).toBe(72);
  });
});

describe("trades", () => {
  it("fairness gate rejects 1.2x FC and accepts inside the band", () => {
    expect(fairnessGate(1000, 1200)).toBe(false);
    expect(fairnessGate(1000, 700)).toBe(false);
    expect(fairnessGate(1000, 1100)).toBe(true);
    expect(fairnessGate(1000, 800)).toBe(true);
  });

  it("finds positive ROS gain for Barkley -> Gibbs", () => {
    const ctx = ctxFor();
    const me = ctx.teams.find((t) => t.roster_id === 1)!;
    const before = weeklyTotals(ctx, me.roster);
    const after = [...me.roster.filter((id) => id !== "4866"), "9226"];
    expect(rosGain(ctx, before, after)).toBeGreaterThan(0);

    const offers = tradeBoard(ctx);
    const deal = offers.find((o) => o.target.id === "9226");
    expect(deal).toBeDefined();
    expect(deal!.send.map((p) => p.id)).toEqual(["4866"]);
    expect(deal!.gain_ros).toBeGreaterThan(0);
    for (const o of offers) {
      expect(fairnessGate(o.fc_sent, o.fc_received)).toBe(true);
      expect(o.accept).toBeGreaterThanOrEqual(0);
      expect(o.accept).toBeLessThanOrEqual(0.98);
    }
    expect(copyOffer(deal!)).toBe("Trade offer\n\nYou get: Saquon Barkley (RB)\nI get: Jahmyr Gibbs (RB)");
    expect(copyOffer(deal!)).not.toMatch(/FAAB|\$/);
  });
});

describe("waivers", () => {
  it("never bids more than faab_left", () => {
    for (const faab of [0, 1, 5, 91, 1000]) {
      const teams = league.teams.map((t) => (t.roster_id === 1 ? { ...t, faab_left: faab } : t));
      const rows = waiverBoard(ctxFor(teams));
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.bid).toBeLessThanOrEqual(faab);
        expect(r.bid).toBeGreaterThanOrEqual(0);
        expect(r.signals).toBe(r.player.signals);
      }
    }
  });
});

describe("history, team, actions", () => {
  it("counts trade frequency and trades with me", () => {
    const s = sweepTrades(
      [
        { type: "trade", status: "complete", roster_ids: [1, 2] },
        { type: "trade", status: "failed", roster_ids: [2, 3] },
        { type: "waiver", roster_ids: [4] },
      ],
      1,
    );
    expect(s.total).toBe(2);
    expect(s.vetoed).toBe(1);
    expect(s.counts.get(2)).toBe(2);
    expect(s.withMe.get(2)).toBe(1);
    expect(s.withMe.has(3)).toBe(false);
  });

  it("profiles use pos_strength and build actions", () => {
    const ctx = ctxFor();
    const mine = teamProfiles(ctx).find((p) => p.team.roster_id === 1)!;
    expect(mine.need.QB).toBeCloseTo(1.41);
    expect(mine.surplus.RB).toBeCloseTo(3.45);

    const issues = lineupIssues(ctx, []);
    const actions = buildActions(ctx, { waivers: waiverBoard(ctx), trades: tradeBoard(ctx), issues });
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain("waiver");
    expect(kinds).toContain("trade");
    expect(kinds).toContain("sell");
    expect(kinds.filter((k) => k === "lineup").length).toBe(issues.length);
  });
});
