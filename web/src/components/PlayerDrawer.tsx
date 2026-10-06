import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Player } from "../types/data";
import { Tag } from "./Tag";

interface DrawerApi {
  open: (id: string) => void;
  close: () => void;
}

const DrawerContext = createContext<DrawerApi | null>(null);

export function usePlayerDrawer(): DrawerApi {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error("usePlayerDrawer must be used inside PlayerDrawerProvider");
  return ctx;
}

export function PlayerDrawerProvider({ players, children }: { players: Player[]; children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);
  const api = useMemo(() => ({ open, close }), [open, close]);
  const player = openId ? byId.get(openId) ?? null : null;

  return (
    <DrawerContext.Provider value={api}>
      {children}
      {player && <PlayerDrawer player={player} onClose={close} />}
    </DrawerContext.Provider>
  );
}

function PlayerDrawer({ player, onClose }: { player: Player; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={player.name}>
        <div className="drawer-head">
          <div className="grow">
            <h2>{player.name}</h2>
            <div className="dim mono">
              {player.pos} · {player.team ?? "FA"}
              {player.injury ? " · " + player.injury : ""}
            </div>
          </div>
          <Tag tag={player.tag} />
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="drawer-body">
          <p className="dim">Player detail arrives in a later phase.</p>
        </div>
      </aside>
    </>
  );
}
