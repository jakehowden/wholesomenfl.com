import { useMemo, useState } from "react";
import type { PortalData } from "../data/load";
import { ownerOf } from "../data/engine";
import { POSITIONS } from "../engine/team";
import type { Player, Pos, Tag as TagValue } from "../types/data";
import { Table, type Column } from "../components/Table";
import { Tag } from "../components/Tag";
import { Spark } from "../components/Spark";
import { PlayerName } from "../components/PlayerName";
import { f1, fcv, signClass, signed } from "./format";

type Status = "ALL" | "ROSTERED" | "FA";

export function Players({ data }: { data: PortalData }) {
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [status, setStatus] = useState<Status>("ALL");
  const [tag, setTag] = useState<TagValue | "ALL">("ALL");
  const [q, setQ] = useState("");

  const columns = useMemo<Column<Player>[]>(
    () => [
      { key: "name", label: "PLAYER", sort: (p) => p.name, render: (p) => <PlayerName player={p} /> },
      { key: "pos", label: "POS", sort: (p) => p.pos },
      { key: "team", label: "TEAM", sort: (p) => p.team ?? "", render: (p) => p.team ?? "FA" },
      { key: "owner", label: "OWNER", sort: (p) => ownerOf(data, p), render: (p) => <span className={p.roster_id == null ? "dim" : undefined}>{ownerOf(data, p)}</span> },
      { key: "ros", label: "ROS", num: true, sort: (p) => p.ros, render: (p) => f1(p.ros) },
      { key: "ros_playoff", label: "ROS PO", num: true, sort: (p) => p.ros_playoff, render: (p) => f1(p.ros_playoff) },
      { key: "ros_rank", label: "RANK", num: true, sort: (p) => -p.ros_rank },
      { key: "pos_rank", label: "POS RK", num: true, sort: (p) => -p.ros_pos_rank, render: (p) => p.pos + p.ros_pos_rank },
      { key: "ppg", label: "PPG", num: true, sort: (p) => p.season.ppg, render: (p) => f1(p.season.ppg) },
      {
        key: "usage",
        label: "USAGE",
        sort: (p) => p.signals.usage_trend,
        render: (p) => (
          <span className="sparkcell">
            <span className={"mono " + (signClass(p.signals.usage_trend) ?? "")}>{signed(p.signals.usage_trend, 2)}</span>
            <Spark data={p.signals.usage_series} />
          </span>
        ),
      },
      { key: "luck", label: "LUCK", num: true, sort: (p) => p.signals.luck, render: (p) => signed(p.signals.luck) },
      { key: "fc", label: "FC", num: true, sort: (p) => p.signals.fc_value ?? -1, render: (p) => fcv(p.signals.fc_value) },
      { key: "tag", label: "TAG", sort: (p) => p.tag, render: (p) => <Tag tag={p.tag} /> },
    ],
    [data],
  );

  const needle = q.trim().toLowerCase();
  const rows = data.players.filter(
    (p) =>
      (pos === "ALL" || p.pos === pos) &&
      (status === "ALL" || (status === "FA") === (p.roster_id == null)) &&
      (tag === "ALL" || p.tag === tag) &&
      (!needle || p.name.toLowerCase().includes(needle) || (p.team ?? "").toLowerCase() === needle),
  );

  return (
    <section className="panel">
      <div className="phead">
        <h2>Players</h2>
        <span className="pnote">
          {rows.length} of {data.players.length}
        </span>
      </div>
      <div className="filters">
        <label className="grow">
          Search
          <input type="search" value={q} placeholder="Name or team" onChange={(e) => setQ(e.target.value)} />
        </label>
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
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="ALL">All</option>
            <option value="ROSTERED">Rostered</option>
            <option value="FA">Free agent</option>
          </select>
        </label>
        <label>
          Tag
          <select value={tag} onChange={(e) => setTag(e.target.value as TagValue | "ALL")}>
            <option value="ALL">All</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
            <option value="HOLD">HOLD</option>
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="pbody dim">No players match.</div>
      ) : (
        <Table rows={rows} columns={columns} rowKey={(p) => p.id} initialSort={{ key: "ros", dir: "desc" }} />
      )}
    </section>
  );
}
