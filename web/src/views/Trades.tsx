import { useMemo, useState } from "react";
import type { PortalData } from "../data/load";
import { engineCtx, tradesFor } from "../data/engine";
import { copyOffer, type TradeOffer } from "../engine/trades";
import { optimalLineup, posLookup, projLookup } from "../engine/lineup";
import { POSITIONS, rosterIds, type EngineCtx } from "../engine/team";
import type { Player, Pos } from "../types/data";
import { Table, type Column } from "../components/Table";
import { PlayerName } from "../components/PlayerName";
import { f1, fcv, pct, signClass, signed } from "./format";

const offerKey = (o: TradeOffer) => o.rival.roster_id + ":" + o.target.id;

export function Trades({ data }: { data: PortalData }) {
  const ctx = engineCtx(data);
  const offers = useMemo(() => tradesFor(data), [data]);
  const [partner, setPartner] = useState<number | "ALL">("ALL");
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = offers.filter((o) => (partner === "ALL" || o.rival.roster_id === partner) && (pos === "ALL" || o.target.pos === pos));
  const current = rows.find((o) => offerKey(o) === selected) ?? rows[0] ?? null;
  const partners = data.league.teams.filter((t) => t.roster_id !== ctx.me.roster_id);

  const columns: Column<TradeOffer>[] = [
    {
      key: "view",
      label: "",
      render: (o) => (
        <button className="chip" type="button" aria-pressed={current === o} onClick={() => setSelected(offerKey(o))}>
          {current === o ? "Viewing" : "View"}
        </button>
      ),
    },
    { key: "give", label: "I GIVE", render: (o) => <Names players={o.send} /> },
    { key: "get", label: "I GET", sort: (o) => o.target.name, render: (o) => <PlayerName player={o.target} /> },
    { key: "partner", label: "PARTNER", sort: (o) => o.rival.owner, render: (o) => o.rival.owner },
    { key: "gain", label: "MY ROS GAIN", num: true, sort: (o) => o.gain_ros, render: (o) => signed(o.gain_ros) },
    { key: "fc", label: "FC GIVE / GET", num: true, sort: (o) => o.fc_received - o.fc_sent, render: (o) => fcv(o.fc_sent) + " / " + fcv(o.fc_received) },
    { key: "accept", label: "ACCEPT", num: true, sort: (o) => o.accept, render: (o) => pct(o.accept) },
    {
      key: "warn",
      label: "",
      render: (o) => (o.helps_rival ? <span className="chip chip-warn" title="Partner is within 1.5 projected wins of you">Helps rival</span> : null),
    },
  ];

  return (
    <>
      <section className="panel">
        <div className="phead">
          <h2>Trade offers</h2>
          <span className="pnote">Ranked by my ROS gain × acceptance. FantasyCalc values kept within 0.8–1.1×.</span>
        </div>
        <div className="filters">
          <label>
            Partner
            <select value={partner} onChange={(e) => setPartner(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}>
              <option value="ALL">All</option>
              {partners.map((t) => (
                <option key={t.roster_id} value={t.roster_id}>
                  {t.owner}
                </option>
              ))}
            </select>
          </label>
          <label>
            Position needed
            <select value={pos} onChange={(e) => setPos(e.target.value as Pos | "ALL")}>
              <option value="ALL">All</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rows.length === 0 ? (
          <div className="pbody dim">No offers match. The engine only lists trades that improve my lineup and pass the value gate.</div>
        ) : (
          <Table rows={rows} columns={columns} rowKey={offerKey} />
        )}
      </section>

      {current && <OfferDetail offer={current} ctx={ctx} />}
    </>
  );
}

function Names({ players }: { players: Player[] }) {
  return (
    <span className="names">
      {players.map((p) => (
        <PlayerName key={p.id} player={p} />
      ))}
    </span>
  );
}

const PART_LABELS: [keyof TradeOffer["parts"], string, number][] = [
  ["trade_rate", "Partner trades often", 0.3],
  ["history", "Has traded with me", 0.15],
  ["fairness", "FC value fairness", 0.25],
  ["partner_gain", "Partner's lineup gain", 0.3],
];

function OfferDetail({ offer, ctx }: { offer: TradeOffer; ctx: EngineCtx }) {
  const [copied, setCopied] = useState(false);
  const sendIds = new Set(offer.send.map((p) => p.id));
  const myIds = rosterIds(ctx.me, ctx.players);
  const theirIds = rosterIds(offer.rival, ctx.players);
  const myAfter = [...myIds.filter((id) => !sendIds.has(id)), offer.target.id];
  const theirAfter = [...theirIds.filter((id) => id !== offer.target.id), ...sendIds];

  const copy = () => {
    navigator.clipboard
      ?.writeText(copyOffer(offer))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <section className="panel">
      <div className="phead">
        <h2>
          {offer.target.name} from {offer.rival.owner}
        </h2>
        <span className="pnote">for {offer.send.map((p) => p.name).join(", ")}</span>
        <span style={{ flexGrow: 1 }} />
        <button className="btn btn-primary" type="button" onClick={copy}>
          {copied ? "Copied" : "Copy offer"}
        </button>
      </div>
      <div className="pbody detailgrid">
        <div>
          <h3 className="minihead">Acceptance {pct(offer.accept)}</h3>
          <ul className="meters">
            {PART_LABELS.map(([k, label, w]) => (
              <li key={k}>
                <div className="meter-label">
                  <span>{label}</span>
                  <span className="mono dim">
                    {pct(offer.parts[k])} × {w}
                  </span>
                </div>
                <div className="meter" role="img" aria-label={label + " " + pct(offer.parts[k])}>
                  <span style={{ width: pct(offer.parts[k]) }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="dim">
            Partner's ROS lineup change: <span className={signClass(offer.partner_gain)}>{signed(offer.partner_gain)}</span>
          </p>
          {offer.helps_rival && <p className="cau">This strengthens a rival within 1.5 projected wins of you.</p>}
        </div>
        <LineupDiff title="My lineup this week" ctx={ctx} before={myIds} after={myAfter} />
        <LineupDiff title={offer.rival.owner + "'s lineup this week"} ctx={ctx} before={theirIds} after={theirAfter} />
      </div>
    </section>
  );
}

function LineupDiff({ title, ctx, before, after }: { title: string; ctx: EngineCtx; before: string[]; after: string[] }) {
  const valueOf = projLookup(ctx.players, ctx.week);
  const posOf = posLookup(ctx.players);
  const a = optimalLineup(before, valueOf, ctx.slots, posOf);
  const b = optimalLineup(after, valueOf, ctx.slots, posOf);
  const name = (id: string | null) => (id ? ctx.players.get(id)?.name ?? id : "–");
  const delta = Math.round((b.total - a.total) * 10) / 10;
  return (
    <div>
      <h3 className="minihead">
        {title} <span className={"mono " + (signClass(delta) ?? "")}>{signed(delta)}</span>
      </h3>
      <div className="tablewrap">
        <table className="compact">
          <thead>
            <tr>
              <th>SLOT</th>
              <th>BEFORE</th>
              <th>AFTER</th>
            </tr>
          </thead>
          <tbody>
            {ctx.slots.map((slot, i) => {
              const changed = a.assigned[i] !== b.assigned[i];
              return (
                <tr key={i} className={changed ? "changed" : undefined}>
                  <td className="dim mono">{slot}</td>
                  <td>{name(a.assigned[i])}</td>
                  <td>{name(b.assigned[i])}</td>
                </tr>
              );
            })}
            <tr>
              <td className="dim mono">TOTAL</td>
              <td className="mono">{f1(a.total)}</td>
              <td className="mono">{f1(b.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
