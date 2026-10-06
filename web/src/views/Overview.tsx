import type { PortalData } from "../data/load";
import { Placeholder } from "./Placeholder";

export function Overview({ data }: { data: PortalData }) {
  const me = data.league.teams.find((t) => t.roster_id === data.meta.my_roster_id);
  return (
    <Placeholder
      title="Overview"
      note={me ? `${me.owner} · ${me.wins}-${me.losses} · ${Math.round(me.playoff_odds * 100)}% playoff odds` : "Week " + data.meta.week}
    />
  );
}
