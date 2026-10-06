import type { PortalData } from "../data/load";
import { Placeholder } from "./Placeholder";

export function MyTeam({ data }: { data: PortalData }) {
  const me = data.league.teams.find((t) => t.roster_id === data.meta.my_roster_id);
  return <Placeholder title="My Team" note={me ? me.roster.length + " rostered players" : "Roster not found"} />;
}
