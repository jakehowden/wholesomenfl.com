import type { Player } from "../types/data";
import { usePlayerDrawer } from "./PlayerDrawer";
import { useCompare } from "./CompareTray";

/** A player name that opens the drawer, with a pin-to-compare toggle beside it. */
export function PlayerName({ player }: { player: Player }) {
  const drawer = usePlayerDrawer();
  const compare = useCompare();
  const pinned = compare.isPinned(player.id);
  return (
    <span className="pname">
      <button className="linkbtn" type="button" onClick={() => drawer.open(player.id)}>
        {player.name}
      </button>
      <button
        className={"pinbtn" + (pinned ? " on" : "")}
        type="button"
        aria-pressed={pinned}
        aria-label={(pinned ? "Unpin " : "Pin ") + player.name + " to compare"}
        title={pinned ? "Unpin from compare" : "Pin to compare"}
        onClick={() => compare.toggle(player.id)}
      >
        {pinned ? "✓" : "+"}
      </button>
    </span>
  );
}

/** Comma-separated PlayerNames; ids missing from the index show as plain text. */
export function PlayerList({ ids, players }: { ids: readonly string[]; players: Map<string, Player> }) {
  return (
    <>
      {ids.map((id, i) => {
        const p = players.get(id);
        return (
          <span key={id}>
            {i > 0 && ", "}
            {p ? <PlayerName player={p} /> : <span className="dim">{id}</span>}
          </span>
        );
      })}
    </>
  );
}
