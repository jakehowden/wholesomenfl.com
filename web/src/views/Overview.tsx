import { useMemo } from "react";
import type { PortalData } from "../data/load";
import { actionsFor, engineCtx, powerRanks } from "../data/engine";
import { BriefingSlot } from "../components/BriefingSlot";
import { PlayerList } from "../components/PlayerName";
import { f1, pct } from "./format";

const FAAB_BUDGET = 200;
const KIND_LABEL = { lineup: "Lineup", waiver: "Waiver", trade: "Trade", sell: "Sell" } as const;

export function Overview({ data }: { data: PortalData }) {
  const ctx = engineCtx(data);
  const me = ctx.me;
  const actions = useMemo(() => actionsFor(data), [data]);
  const rank = powerRanks(data.league.teams).get(me.roster_id);

  const kpis: [string, string, string?][] = [
    ["Record", me.wins + "-" + me.losses + (me.ties ? "-" + me.ties : ""), "PF " + f1(me.pf)],
    ["Playoff odds", pct(me.playoff_odds), data.league.sim.runs.toLocaleString("en-US") + " sims"],
    ["Power rank", "#" + rank, "of " + data.league.teams.length + " by ROS strength"],
    ["Projected wins", f1(me.proj_wins)],
    ["FAAB left", "$" + me.faab_left, "of $" + FAAB_BUDGET],
  ];

  return (
    <>
      <div className="kpis">
        {kpis.map(([label, value, sub]) => (
          <div key={label} className="kpi">
            <div className="stat-label">{label}</div>
            <div className="kpi-value">{value}</div>
            {sub && <div className="pnote">{sub}</div>}
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="phead">
          <h2>Actions</h2>
          <span className="pnote">
            {data.live ? "Lineup checks use your live Sleeper starters" : "Live Sleeper lineup not loaded, so no lineup checks"}
          </span>
        </div>
        {actions.length === 0 ? (
          <div className="pbody dim">Nothing to do this week.</div>
        ) : (
          <ol className="actions">
            {actions.map((a, i) => (
              <li key={a.kind + i} className="action">
                <span className={"chip kind-" + a.kind}>{KIND_LABEL[a.kind]}</span>
                <div className="grow">
                  <div className="action-title">{a.title}</div>
                  <div className="dim">{a.detail}</div>
                  <div className="action-players">
                    <PlayerList ids={a.player_ids} players={ctx.players} />
                  </div>
                </div>
                {a.kind !== "sell" && <span className="mono pos action-gain">+{f1(a.gain)}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <BriefingSlot />
    </>
  );
}
