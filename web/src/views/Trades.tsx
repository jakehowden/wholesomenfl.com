import type { PortalData } from "../data/load";
import { Placeholder } from "./Placeholder";

export function Trades({ data }: { data: PortalData }) {
  const trades = data.league.transactions.filter((t) => t.type === "trade").length;
  return <Placeholder title="Trades" note={trades + " league trades this season"} />;
}
