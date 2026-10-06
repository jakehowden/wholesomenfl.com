import type { Player } from "../types/data";
import { PLAYOFF_START, remainingWeeks } from "../engine/lineup";

/** Weekly projections cur..17. Bye weeks greyed, playoff weeks (15–17) shaded. */
export function ProjGrid({ player, week }: { player: Player; week: number }) {
  return (
    <div className="projgrid" role="list" aria-label={"Weekly projections for " + player.name}>
      {remainingWeeks(week).map((w) => {
        const bye = player.bye === w;
        const playoff = w >= PLAYOFF_START;
        const v = player.proj[String(w)] ?? 0;
        return (
          <div
            key={w}
            role="listitem"
            className={"pcell" + (bye ? " bye" : "") + (playoff ? " po" : "")}
            title={"Week " + w + (playoff ? " (playoffs)" : "") + (bye ? ": bye" : ": " + v.toFixed(1) + " pts")}
          >
            <span className="pw">{w}</span>
            <span className="pv">{bye ? "BYE" : v.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}
