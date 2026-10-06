import type { PortalData } from "../data/load";
import type { Player } from "../types/data";
import { Table, type Column } from "../components/Table";
import { Tag } from "../components/Tag";
import { Spark } from "../components/Spark";
import { usePlayerDrawer } from "../components/PlayerDrawer";
import { useCompare } from "../components/CompareTray";
import { Placeholder } from "./Placeholder";

export function Players({ data }: { data: PortalData }) {
  const drawer = usePlayerDrawer();
  const compare = useCompare();

  const columns: Column<Player>[] = [
    {
      key: "name",
      label: "PLAYER",
      sort: (p) => p.name,
      render: (p) => (
        <button className="linkbtn" type="button" onClick={() => drawer.open(p.id)}>
          {p.name}
        </button>
      ),
    },
    { key: "pos", label: "POS", sort: (p) => p.pos },
    { key: "team", label: "TEAM", render: (p) => p.team ?? "FA" },
    { key: "ros", label: "ROS", num: true, sort: (p) => p.ros, render: (p) => p.ros.toFixed(1) },
    { key: "ros_rank", label: "RANK", num: true, sort: (p) => -p.ros_rank },
    { key: "usage", label: "USAGE", render: (p) => <Spark data={p.signals.usage_series} /> },
    { key: "tag", label: "TAG", sort: (p) => p.tag, render: (p) => <Tag tag={p.tag} /> },
    {
      key: "pin",
      label: "",
      render: (p) => (
        <button className="chip" type="button" onClick={() => compare.toggle(p.id)}>
          {compare.isPinned(p.id) ? "Pinned" : "Pin"}
        </button>
      ),
    },
  ];

  return (
    <Placeholder title="Players" note={data.players.length + " players"}>
      <Table rows={data.players} columns={columns} rowKey={(p) => p.id} initialSort={{ key: "ros", dir: "desc" }} />
    </Placeholder>
  );
}
