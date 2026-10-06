import { useMemo } from "react";
import type { PortalData } from "../data/load";
import { engineCtx, issuesFor, liveStarters } from "../data/engine";
import { optimalLineup, posLookup, projLookup } from "../engine/lineup";
import { rosterIds } from "../engine/team";
import type { Player } from "../types/data";
import { Table, type Column } from "../components/Table";
import { Tag } from "../components/Tag";
import { PlayerName } from "../components/PlayerName";
import { f1, fcv, signed } from "./format";

const LUCK_SELL = 15;

export function MyTeam({ data }: { data: PortalData }) {
  const ctx = engineCtx(data);
  const week = ctx.week;
  const valueOf = projLookup(ctx.players, week);
  const roster = useMemo(() => rosterIds(ctx.me, ctx.players).map((id) => ctx.players.get(id)!), [ctx]);
  const optimal = useMemo(
    () => optimalLineup(roster.map((p) => p.id), projLookup(ctx.players, week), ctx.slots, posLookup(ctx.players)),
    [ctx, roster, week],
  );
  const starters = liveStarters(data);
  const issues = useMemo(() => issuesFor(data), [data]);
  const sells = roster
    .filter((p) => p.tag === "SELL" || p.signals.luck > LUCK_SELL)
    .sort((a, b) => (b.signals.fc_value ?? 0) - (a.signals.fc_value ?? 0));

  const cell = (id: string | null | undefined) => {
    const p = id ? ctx.players.get(id) : undefined;
    if (!p) return <span className="dim">{id ? id : "Empty"}</span>;
    return (
      <span className="pname-proj">
        <PlayerName player={p} />
        <span className="dim mono">{f1(valueOf(p.id))}</span>
      </span>
    );
  };

  const columns: Column<Player>[] = [
    { key: "name", label: "PLAYER", sort: (p) => p.name, render: (p) => <PlayerName player={p} /> },
    { key: "pos", label: "POS", sort: (p) => p.pos },
    { key: "team", label: "TEAM", render: (p) => p.team ?? "FA" },
    { key: "inj", label: "STATUS", render: (p) => (p.injury ? <span className="cau">{p.injury}</span> : p.bye === week ? <span className="dim">Bye</span> : "") },
    { key: "proj", label: "WK " + week, num: true, sort: (p) => valueOf(p.id), render: (p) => f1(valueOf(p.id)) },
    { key: "ros", label: "ROS", num: true, sort: (p) => p.ros, render: (p) => f1(p.ros) },
    { key: "ros_playoff", label: "ROS PO", num: true, sort: (p) => p.ros_playoff, render: (p) => f1(p.ros_playoff) },
    { key: "rank", label: "POS RANK", num: true, sort: (p) => -p.ros_pos_rank, render: (p) => p.pos + p.ros_pos_rank },
    { key: "luck", label: "LUCK", num: true, sort: (p) => p.signals.luck, render: (p) => signed(p.signals.luck) },
    { key: "fc", label: "FC", num: true, sort: (p) => p.signals.fc_value ?? -1, render: (p) => fcv(p.signals.fc_value) },
    { key: "tag", label: "TAG", sort: (p) => p.tag, render: (p) => <Tag tag={p.tag} /> },
  ];

  return (
    <>
      <section className="panel">
        <div className="phead">
          <h2>Lineup, week {week}</h2>
          <span className="pnote">
            {starters
              ? issues.length
                ? issues.length + " lineup mistake" + (issues.length === 1 ? "" : "s") + " vs Sleeper"
                : "Your Sleeper lineup is optimal"
              : "Live Sleeper lineup not loaded, so this shows the optimal lineup only"}
          </span>
        </div>
        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((i) => (
              <li key={i.slot + i.best.id}>
                <span className="chip chip-warn">{i.slot}</span> Start <strong>{i.best.name}</strong> over{" "}
                {i.current ? i.current.name : "an empty slot"} <span className="mono pos">+{f1(i.delta)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>SLOT</th>
                {starters && <th>SLEEPER</th>}
                <th>OPTIMAL</th>
              </tr>
            </thead>
            <tbody>
              {ctx.slots.map((slot, i) => {
                const best = optimal.assigned[i];
                const cur = starters?.[i] ?? null;
                const wrong = !!starters && !!best && !starters.includes(best);
                return (
                  <tr key={i} className={wrong ? "flagged" : undefined}>
                    <td className="dim mono">
                      {slot}
                      {wrong && <span className="flag" title="Optimal starter is benched"> !</span>}
                    </td>
                    {starters && <td>{cell(cur)}</td>}
                    <td>{cell(best)}</td>
                  </tr>
                );
              })}
              <tr>
                <td className="dim mono">TOTAL</td>
                {starters && <td className="mono">{f1(starters.reduce((t, id) => t + (id ? valueOf(id) : 0), 0))}</td>}
                <td className="mono">{f1(optimal.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <h2>Sell candidates</h2>
          <span className="pnote">SELL tags, plus anyone scoring {LUCK_SELL}+ pts above expected</span>
        </div>
        {sells.length === 0 ? (
          <div className="pbody dim">No sell candidates.</div>
        ) : (
          <ul className="radar">
            {sells.map((p) => (
              <li key={p.id}>
                <div className="row">
                  <PlayerName player={p} />
                  <Tag tag={p.tag} />
                  <span className="dim mono">
                    luck {signed(p.signals.luck)} · FC {fcv(p.signals.fc_value)}
                  </span>
                </div>
                {p.tag_reasons.length > 0 && <div className="dim">{p.tag_reasons.join(". ")}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="phead">
          <h2>My roster</h2>
          <span className="pnote">{roster.length} players · sorted by ROS</span>
        </div>
        <Table rows={roster} columns={columns} rowKey={(p) => p.id} initialSort={{ key: "ros", dir: "desc" }} />
      </section>
    </>
  );
}
