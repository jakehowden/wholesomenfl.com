import { useMemo, useState } from "react";
import type { PortalData } from "../data/load";
import { engineCtx, waiversFor } from "../data/engine";
import { freeAgents, type WaiverRow } from "../engine/waivers";
import { POSITIONS } from "../engine/team";
import type { Pos } from "../types/data";
import { Table, type Column } from "../components/Table";
import { Tag } from "../components/Tag";
import { Spark } from "../components/Spark";
import { PlayerName } from "../components/PlayerName";
import { f1, fcv, signClass, signed } from "./format";

const columns: Column<WaiverRow>[] = [
  { key: "name", label: "PLAYER", sort: (r) => r.player.name, render: (r) => <PlayerName player={r.player} /> },
  { key: "pos", label: "POS", sort: (r) => r.player.pos, render: (r) => r.player.pos },
  { key: "team", label: "TEAM", render: (r) => r.player.team ?? "FA" },
  { key: "gain_now", label: "GAIN NOW", num: true, sort: (r) => r.gain_now, render: (r) => signed(r.gain_now) },
  { key: "gain_ros", label: "GAIN ROS", num: true, sort: (r) => r.gain_ros, render: (r) => signed(r.gain_ros) },
  { key: "ros", label: "ROS", num: true, sort: (r) => r.player.ros, render: (r) => f1(r.player.ros) },
  {
    key: "usage",
    label: "USAGE",
    sort: (r) => r.signals.usage_trend,
    render: (r) => (
      <span className="sparkcell">
        <span className={"mono " + (signClass(r.signals.usage_trend) ?? "")}>{signed(r.signals.usage_trend, 2)}</span>
        <Spark data={r.signals.usage_series} />
      </span>
    ),
  },
  { key: "snap", label: "SNAP %", render: (r) => <Spark data={r.signals.snap_series} /> },
  { key: "luck", label: "LUCK", num: true, sort: (r) => r.signals.luck, render: (r) => signed(r.signals.luck) },
  { key: "fc", label: "FC", num: true, sort: (r) => r.signals.fc_value ?? -1, render: (r) => fcv(r.signals.fc_value) },
  { key: "tag", label: "TAG", sort: (r) => r.player.tag, render: (r) => <Tag tag={r.player.tag} /> },
  { key: "bid", label: "BID", num: true, sort: (r) => r.bid, render: (r) => "$" + r.bid },
];

export function Waivers({ data }: { data: PortalData }) {
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const board = useMemo(() => waiversFor(data), [data]);
  const radar = useMemo(
    () => freeAgents(engineCtx(data)).filter((p) => p.signals.breakout).sort((a, b) => b.ros - a.ros),
    [data],
  );
  const rows = pos === "ALL" ? board : board.filter((r) => r.player.pos === pos);

  return (
    <>
      <section className="panel">
        <div className="phead">
          <h2>Breakout radar</h2>
          <span className="pnote">Free agents whose role is growing</span>
        </div>
        {radar.length === 0 ? (
          <div className="pbody dim">No breakout signals among free agents.</div>
        ) : (
          <ul className="radar">
            {radar.map((p) => (
              <li key={p.id}>
                <div className="row">
                  <PlayerName player={p} />
                  <span className="dim mono">
                    {p.pos} · {p.team ?? "FA"} · ROS {f1(p.ros)}
                  </span>
                  <Tag tag={p.tag} />
                </div>
                <div className="dim">{p.signals.breakout}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="phead">
          <h2>Waivers</h2>
          <span className="pnote">Gain = my optimal lineup with the player added. Bid from ${engineCtx(data).me.faab_left} left.</span>
        </div>
        <div className="filters">
          <label>
            Position
            <select value={pos} onChange={(e) => setPos(e.target.value as Pos | "ALL")}>
              <option value="ALL">All</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <span className="pnote">Tap a column header to sort</span>
        </div>
        {rows.length === 0 ? (
          <div className="pbody dim">No free agent improves the lineup{pos === "ALL" ? "" : " at " + pos}.</div>
        ) : (
          <Table rows={rows} columns={columns} rowKey={(r) => r.player.id} initialSort={{ key: "gain_ros", dir: "desc" }} />
        )}
      </section>
    </>
  );
}
