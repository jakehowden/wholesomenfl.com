import type { PortalData } from "../data/load";
import { Placeholder } from "./Placeholder";

export function League({ data }: { data: PortalData }) {
  return <Placeholder title="League" note={data.league.teams.length + " teams · " + data.league.sim.runs.toLocaleString("en-US") + " sims"} />;
}
