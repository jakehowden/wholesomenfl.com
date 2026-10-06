import type { PortalData } from "../data/load";
import { Placeholder } from "./Placeholder";

export function Waivers({ data }: { data: PortalData }) {
  const fa = data.players.filter((p) => p.roster_id === null).length;
  return <Placeholder title="Waivers" note={fa + " free agents tracked"} />;
}
