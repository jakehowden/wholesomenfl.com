import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Player } from "../types/data";

const MAX_PINS = 4;
const MIN_COMPARE = 2;

interface CompareApi {
  pinned: string[];
  toggle: (id: string) => void;
  isPinned: (id: string) => boolean;
}

const CompareContext = createContext<CompareApi | null>(null);

export function useCompare(): CompareApi {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used inside CompareProvider");
  return ctx;
}

/** Pin 2 to 4 players, then open a side-by-side compare. */
export function CompareProvider({ players, children }: { players: Player[]; children: ReactNode }) {
  const [pinned, setPinned] = useState<string[]>([]);
  const [modal, setModal] = useState(false);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const toggle = useCallback(
    (id: string) =>
      setPinned((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PINS ? cur : [...cur, id])),
    []
  );
  const api = useMemo(() => ({ pinned, toggle, isPinned: (id: string) => pinned.includes(id) }), [pinned, toggle]);
  const chosen = pinned.map((id) => byId.get(id)).filter((p): p is Player => !!p);

  return (
    <CompareContext.Provider value={api}>
      {children}
      {chosen.length > 0 && (
        <div className="tray" role="region" aria-label="Compare tray">
          {chosen.map((p) => (
            <button key={p.id} className="chip" type="button" onClick={() => toggle(p.id)} title="Unpin">
              {p.name} ×
            </button>
          ))}
          <span className="grow" />
          <button className="btn btn-ghost" type="button" onClick={() => setPinned([])}>
            Clear
          </button>
          <button className="btn btn-primary" type="button" disabled={chosen.length < MIN_COMPARE} onClick={() => setModal(true)}>
            Compare {chosen.length}
          </button>
        </div>
      )}
      {modal && chosen.length >= MIN_COMPARE && (
        <>
          <div className="scrim" onClick={() => setModal(false)} />
          <div className="modal" role="dialog" aria-modal="true" aria-label="Compare players">
            <div className="phead">
              <h2>Compare</h2>
              <span className="pnote">{chosen.map((p) => p.name).join(" vs ")}</span>
              <span style={{ flexGrow: 1 }} />
              <button className="btn btn-ghost" type="button" onClick={() => setModal(false)}>
                Close
              </button>
            </div>
            <div className="pbody dim">Side-by-side comparison arrives in a later phase.</div>
          </div>
        </>
      )}
    </CompareContext.Provider>
  );
}
