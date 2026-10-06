import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ComponentType } from "react";
import metaJson from "../fixtures/meta.json";
import playersJson from "../fixtures/players.json";
import leagueJson from "../fixtures/league.json";
import outlooksJson from "../fixtures/outlooks.json";
import type { PortalData } from "../data/load";
import type { League as LeagueData, Meta, Outlook, Player } from "../types/data";
import { CompareBody, CompareProvider } from "../components/CompareTray";
import { PlayerDetail, PlayerDrawerProvider } from "../components/PlayerDrawer";
import { Overview } from "./Overview";
import { Waivers } from "./Waivers";
import { Trades } from "./Trades";
import { MyTeam } from "./MyTeam";
import { League } from "./League";
import { Players } from "./Players";

const players = playersJson as Player[];
const base: PortalData = {
  meta: metaJson as Meta,
  players,
  league: leagueJson as unknown as LeagueData,
  outlooks: outlooksJson as Record<string, Outlook>,
};
const myStarters = players.filter((p) => p.roster_id === 1).map((p) => p.id);
const withLive: PortalData = {
  ...base,
  live: {
    week: 5,
    season: "2026",
    league: {} as never,
    users: [],
    projections: [],
    rosters: [{ roster_id: 1, owner_id: null, players: myStarters, starters: ["0", ...myStarters.slice(1)], reserve: null, settings: {} }],
  },
};

function render(node: JSX.Element, data: PortalData): string {
  return renderToString(
    <CompareProvider data={data}>
      <PlayerDrawerProvider data={data}>{node}</PlayerDrawerProvider>
    </CompareProvider>,
  );
}

const views: [string, ComponentType<{ data: PortalData }>][] = [
  ["Overview", Overview],
  ["Waivers", Waivers],
  ["Trades", Trades],
  ["MyTeam", MyTeam],
  ["League", League],
  ["Players", Players],
];

describe("views render with fixtures", () => {
  const errors = vi.spyOn(console, "error");
  afterEach(() => errors.mockClear());

  for (const [name, View] of views) {
    for (const [label, data] of [["no live", base], ["live", withLive]] as const) {
      it(name + " (" + label + ")", () => {
        const html = render(<View data={data} />, data);
        expect(html.length).toBeGreaterThan(200);
        expect(errors).not.toHaveBeenCalled();
      });
    }
  }

  it("Overview shows the briefing placeholder", () => {
    expect(render(<Overview data={base} />, base)).toContain("Briefing locked");
  });

  it("MyTeam flags a benched optimal starter from live data", () => {
    expect(render(<MyTeam data={withLive} />, withLive)).toContain("flagged");
  });

  it("drawer body renders for every player", () => {
    for (const p of players) render(<PlayerDetail player={p} data={base} />, base);
    const withOutlook = players.find((p) => base.outlooks[p.id])!;
    expect(render(<PlayerDetail player={withOutlook} data={base} />, base)).toContain(base.outlooks[withOutlook.id].summary);
    expect(errors).not.toHaveBeenCalled();
  });

  it("compare body renders 2 to 4 players", () => {
    for (const n of [2, 3, 4]) {
      const html = render(<CompareBody players={players.slice(0, n)} data={base} />, base);
      expect(html).toContain(players[n - 1].name);
    }
    expect(errors).not.toHaveBeenCalled();
  });
});
