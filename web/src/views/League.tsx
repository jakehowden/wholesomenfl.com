import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PortalData } from "../data/load";
import { engineCtx, powerRanks } from "../data/engine";
import { POSITIONS } from "../engine/team";
import type { Team, Tx } from "../types/data";
import { Table, type Column } from "../components/Table";
import { PlayerList } from "../components/PlayerName";
import { axisProps, BAR_MUTED, SERIES_1, tooltipStyle } from "../components/chart";
import { f1, pct, signClass, signed } from "./format";

const PLAYOFF_SEEDS = 6;
const TX_TYPES: Tx["type"][] = ["trade", "waiver", "free_agent"];
const TX_LABEL: Record<Tx["type"], string> = { trade: "Trade", waiver: "Waiver", free_agent: "Free agent" };

export function League({ data }: { data: PortalData }) {
  const myId = data.meta.my_roster_id;
  const teams = data.league.teams;
  const ranks = useMemo(() => powerRanks(teams), [teams]);
  const owner = (id: number) => teams.find((t) => t.roster_id === id)?.owner ?? "Team " + id;
  const teamLabel = (t: Team) => (t.roster_id === myId ? t.owner + " (you)" : t.owner);

  const standingCols: Column<Team>[] = [
    { key: "team", label: "TEAM", sort: (t) => t.owner, render: (t) => <span className={t.roster_id === myId ? "me" : undefined}>{teamLabel(t)}</span> },
    { key: "record", label: "W-L", num: true, sort: (t) => t.wins - t.losses + t.ties * 0.5, render: (t) => t.wins + "-" + t.losses + (t.ties ? "-" + t.ties : "") },
    { key: "pf", label: "PF", num: true, sort: (t) => t.pf, render: (t) => f1(t.pf) },
    { key: "allplay", label: "ALL-PLAY", num: true, sort: (t) => t.all_play_w / Math.max(1, t.all_play_w + t.all_play_l), render: (t) => t.all_play_w + "-" + t.all_play_l },
    { key: "ros", label: "ROS STR", num: true, sort: (t) => t.ros_strength, render: (t) => f1(t.ros_strength) },
    { key: "power", label: "POWER", num: true, sort: (t) => -(ranks.get(t.roster_id) ?? 99), render: (t) => "#" + ranks.get(t.roster_id) },
    { key: "pwins", label: "PROJ W", num: true, sort: (t) => t.proj_wins, render: (t) => f1(t.proj_wins) },
    {
      key: "odds",
      label: "PLAYOFF ODDS",
      sort: (t) => t.playoff_odds,
      render: (t) => (
        <span className="oddsbar" title={pct(t.playoff_odds) + " playoff odds"}>
          <span className="oddsbar-track">
            <span className={"oddsbar-fill" + (t.roster_id === myId ? " me" : "")} style={{ width: pct(t.playoff_odds) }} />
          </span>
          <span className="mono">{pct(t.playoff_odds)}</span>
        </span>
      ),
    },
    { key: "seeds", label: "SEED 1–10", render: (t) => <SeedChart dist={t.seed_dist} /> },
  ];

  const odds = [...teams]
    .sort((a, b) => b.playoff_odds - a.playoff_odds)
    .map((t) => ({ name: teamLabel(t), odds: t.playoff_odds, me: t.roster_id === myId }));

  return (
    <>
      <section className="panel">
        <div className="phead">
          <h2>Standings vs power</h2>
          <span className="pnote">
            Power = rank by ROS strength. Odds from {data.league.sim.runs.toLocaleString("en-US")} sims.
          </span>
        </div>
        <Table
          rows={teams}
          columns={standingCols}
          rowKey={(t) => String(t.roster_id)}
          initialSort={{ key: "record", dir: "desc" }}
        />
      </section>

      <div className="twocol">
        <section className="panel">
          <div className="phead">
            <h2>Playoff odds</h2>
            <span className="pnote">Top {PLAYOFF_SEEDS} make the playoffs</span>
          </div>
          <div className="pbody">
            <div className="chart" style={{ height: odds.length * 28 + 32 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={odds} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" domain={[0, 1]} {...axisProps} tickFormatter={(v: number) => pct(v)} />
                  <YAxis type="category" dataKey="name" {...axisProps} width={112} interval={0} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface2)" }} formatter={(v: number) => pct(v)} />
                  <Bar dataKey="odds" name="Playoff odds" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {odds.map((d) => (
                      <Cell key={d.name} fill={d.me ? SERIES_1 : BAR_MUTED} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <PosHeatmap teams={teams} myId={myId} />
      </div>

      <TxLog data={data} owner={owner} />
    </>
  );
}

function SeedChart({ dist }: { dist: number[] }) {
  const w = 6;
  const gap = 2;
  const h = 22;
  const max = Math.max(0.01, ...dist);
  return (
    <svg width={dist.length * (w + gap)} height={h} role="img" aria-label="Seed distribution">
      {dist.map((p, i) => {
        const bh = Math.max(1, (p / max) * (h - 2));
        return (
          <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1.5} fill={i < PLAYOFF_SEEDS ? SERIES_1 : BAR_MUTED}>
            <title>{"Seed " + (i + 1) + ": " + pct(p)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Diverging fill: blue above league average, red below, grey at zero. */
function heatColor(v: number, maxAbs: number): string {
  const t = Math.min(1, Math.abs(v) / maxAbs);
  const pole = v >= 0 ? "var(--div-pos)" : "var(--div-neg)";
  return `color-mix(in oklab, ${pole} ${Math.round(t * 85)}%, var(--div-mid))`;
}

function PosHeatmap({ teams, myId }: { teams: Team[]; myId: number }) {
  const maxAbs = Math.max(0.1, ...teams.flatMap((t) => POSITIONS.map((p) => Math.abs(t.pos_strength[p] ?? 0))));
  return (
    <section className="panel">
      <div className="phead">
        <h2>Positional strength</h2>
        <span className="pnote">Projected starter pts vs league average</span>
      </div>
      <div className="tablewrap">
        <table className="heat">
          <thead>
            <tr>
              <th>TEAM</th>
              {POSITIONS.map((p) => (
                <th key={p} className="num">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.roster_id}>
                <td className={t.roster_id === myId ? "me" : undefined}>{t.roster_id === myId ? t.owner + " (you)" : t.owner}</td>
                {POSITIONS.map((p) => {
                  const v = t.pos_strength[p] ?? 0;
                  return (
                    <td key={p} className="num heatcell" style={{ background: heatColor(v, maxAbs) }} title={t.owner + " " + p + ": " + signed(v)}>
                      {signed(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heatlegend">
        <span className="mono">{signed(-maxAbs)}</span>
        <span className="heatlegend-bar" aria-hidden="true" />
        <span className="mono">{signed(maxAbs)}</span>
        <span className="pnote">weaker ← avg → stronger</span>
      </div>
    </section>
  );
}

function TxLog({ data, owner }: { data: PortalData; owner: (id: number) => string }) {
  const [type, setType] = useState<Tx["type"] | "ALL">("ALL");
  const [team, setTeam] = useState<number | "ALL">("ALL");
  const players = engineCtx(data).players;
  const rows = data.league.transactions.filter(
    (t) => (type === "ALL" || t.type === type) && (team === "ALL" || t.sides.some((s) => s.roster_id === team)),
  );

  const cols: Column<Tx>[] = [
    { key: "week", label: "WK", num: true, sort: (t) => t.week },
    { key: "type", label: "TYPE", sort: (t) => t.type, render: (t) => TX_LABEL[t.type] + (t.status !== "complete" ? " (" + t.status + ")" : "") },
    {
      key: "moves",
      label: "MOVES",
      render: (t) => (
        <div className="txsides">
          {t.sides.map((s) => (
            <div key={s.roster_id}>
              <strong>{owner(s.roster_id)}</strong>
              {s.adds.length > 0 && (
                <>
                  {" "}
                  <span className="pos">+</span> <PlayerList ids={s.adds} players={players} />
                </>
              )}
              {s.drops.length > 0 && (
                <>
                  {" "}
                  <span className="neg">−</span> <PlayerList ids={s.drops} players={players} />
                </>
              )}{" "}
              <span className={"mono " + (signClass(s.ros_delta) ?? "")}>ROS {signed(s.ros_delta)}</span>
            </div>
          ))}
        </div>
      ),
    },
    { key: "faab", label: "FAAB", num: true, sort: (t) => t.faab ?? -1, render: (t) => (t.faab == null ? "" : "$" + t.faab) },
    { key: "grade", label: "GRADE", sort: (t) => t.grade ?? "", render: (t) => (t.grade ? <span className="mono grade">{t.grade}</span> : "") },
  ];

  return (
    <section className="panel">
      <div className="phead">
        <h2>Transactions</h2>
        <span className="pnote">Trade grades per side, in side order</span>
      </div>
      <div className="filters">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as Tx["type"] | "ALL")}>
            <option value="ALL">All</option>
            {TX_TYPES.map((t) => (
              <option key={t} value={t}>
                {TX_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select value={team} onChange={(e) => setTeam(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}>
            <option value="ALL">All</option>
            {data.league.teams.map((t) => (
              <option key={t.roster_id} value={t.roster_id}>
                {t.owner}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="pbody dim">No transactions match.</div>
      ) : (
        <Table rows={rows} columns={cols} rowKey={(t) => t.id} initialSort={{ key: "week", dir: "desc" }} />
      )}
    </section>
  );
}
