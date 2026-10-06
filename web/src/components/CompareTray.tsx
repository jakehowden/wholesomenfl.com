import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PortalData } from "../data/load";
import { engineCtx } from "../data/engine";
import { rosGain, rosterIds, weeklyTotals } from "../engine/team";
import type { Player } from "../types/data";
import { Tag } from "./Tag";
import { ProjGrid } from "./ProjGrid";
import { f1, fcv, signClass, signed } from "../views/format";

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
export function CompareProvider({ data, children }: { data: PortalData; children: ReactNode }) {
  const [pinned, setPinned] = useState<string[]>([]);
  const [modal, setModal] = useState(false);
  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);

  const toggle = useCallback(
    (id: string) =>
      setPinned((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PINS ? cur : [...cur, id])),
    []
  );
  const api = useMemo(() => ({ pinned, toggle, isPinned: (id: string) => pinned.includes(id) }), [pinned, toggle]);
  const chosen = pinned.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const showModal = modal && chosen.length >= MIN_COMPARE;

  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal]);

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
      {showModal && (
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
            <CompareBody players={chosen} data={data} />
          </div>
        </>
      )}
    </CompareContext.Provider>
  );
}

type Side = "give" | "get";

/** Modal body. Exported so it can be rendered on its own in tests. */
export function CompareBody({ players, data }: { players: Player[]; data: PortalData }) {
  const [mode, setMode] = useState<"side" | "trade">("side");
  const myId = data.meta.my_roster_id;
  const [sides, setSides] = useState<Record<string, Side>>({});
  const sideOf = (p: Player): Side => sides[p.id] ?? (p.roster_id === myId ? "give" : "get");

  return (
    <div className="pbody">
      <div className="seg" role="group" aria-label="Compare mode">
        <button type="button" aria-pressed={mode === "side"} onClick={() => setMode("side")}>
          Side by side
        </button>
        <button type="button" aria-pressed={mode === "trade"} onClick={() => setMode("trade")}>
          Give vs get
        </button>
      </div>
      {mode === "side" ? (
        <div className="cmpwrap">
          <div className="cmpgrid" style={{ gridTemplateColumns: `repeat(${players.length}, minmax(168px, 1fr))` }}>
            {players.map((p) => (
              <PlayerColumn key={p.id} player={p} week={data.meta.week} />
            ))}
          </div>
        </div>
      ) : (
        <TradeSplit
          players={players}
          data={data}
          sideOf={sideOf}
          flip={(p) => setSides((s) => ({ ...s, [p.id]: sideOf(p) === "give" ? "get" : "give" }))}
        />
      )}
    </div>
  );
}

function PlayerColumn({ player: p, week }: { player: Player; week: number }) {
  const s = p.signals;
  const rows: [string, string, string | undefined][] = [
    ["ROS", f1(p.ros), undefined],
    ["ROS playoffs", f1(p.ros_playoff), undefined],
    ["Rank", "#" + p.ros_rank + " · " + p.pos + p.ros_pos_rank, undefined],
    ["FC value", fcv(s.fc_value), undefined],
    ["Usage trend", signed(s.usage_trend, 2), signClass(s.usage_trend)],
    ["Luck", signed(s.luck), undefined],
    ["Market gap", s.market_gap == null ? "–" : signed(s.market_gap, 0), s.market_gap == null ? undefined : signClass(s.market_gap)],
  ];
  return (
    <div className="cmpcol">
      <div>
        <div className="cmpname">{p.name}</div>
        <div className="dim mono">
          {p.pos} · {p.team ?? "FA"}
          {p.injury ? " · " + p.injury : ""}
        </div>
      </div>
      <Tag tag={p.tag} />
      <dl className="kv">
        {rows.map(([k, v, cls]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={cls}>{v}</dd>
          </div>
        ))}
      </dl>
      {s.breakout && <p className="note">{s.breakout}</p>}
      <ProjGrid player={p} week={week} />
    </div>
  );
}

function TradeSplit({
  players,
  data,
  sideOf,
  flip,
}: {
  players: Player[];
  data: PortalData;
  sideOf: (p: Player) => Side;
  flip: (p: Player) => void;
}) {
  const ctx = engineCtx(data);
  const give = players.filter((p) => sideOf(p) === "give");
  const get = players.filter((p) => sideOf(p) === "get");
  const myIds = rosterIds(ctx.me, ctx.players);
  const giveIds = new Set(give.map((p) => p.id));
  const notMine = give.filter((p) => !myIds.includes(p.id));
  const after = [...myIds.filter((id) => !giveIds.has(id)), ...get.map((p) => p.id).filter((id) => !myIds.includes(id))];
  const impact = rosGain(ctx, weeklyTotals(ctx, myIds), after);

  const group = (title: string, list: Player[]) => (
    <div className="cmpgroup">
      <h3>{title}</h3>
      {list.length === 0 ? (
        <p className="dim">Nobody. Tap a player to move them here.</p>
      ) : (
        <ul className="plainlist">
          {list.map((p) => (
            <li key={p.id}>
              <button className="linkbtn" type="button" onClick={() => flip(p)} title="Move to the other side">
                {p.name}
              </button>{" "}
              <span className="dim mono">
                {p.pos} · ROS {f1(p.ros)} · FC {fcv(p.signals.fc_value)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="kv">
        <div>
          <dt>ROS</dt>
          <dd>{f1(list.reduce((t, p) => t + p.ros, 0))}</dd>
        </div>
        <div>
          <dt>ROS playoffs</dt>
          <dd>{f1(list.reduce((t, p) => t + p.ros_playoff, 0))}</dd>
        </div>
        <div>
          <dt>FC value</dt>
          <dd>{fcv(list.reduce((t, p) => t + (p.signals.fc_value ?? 0), 0))}</dd>
        </div>
      </dl>
    </div>
  );

  return (
    <>
      <div className="cmpsplit">
        {group("I give", give)}
        {group("I get", get)}
      </div>
      <p className="impact">
        Lineup impact for me:{" "}
        <strong className={signClass(impact)}>{signed(impact)}</strong>{" "}
        <span className="dim">ROS optimal-lineup pts (playoff weeks weighted)</span>
      </p>
      {notMine.length > 0 && (
        <p className="dim">{notMine.map((p) => p.name).join(", ")} not on my roster, so giving them changes nothing.</p>
      )}
    </>
  );
}
