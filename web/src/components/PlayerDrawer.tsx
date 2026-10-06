import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortalData } from "../data/load";
import { ownerOf } from "../data/engine";
import type { Player } from "../types/data";
import { Tag } from "./Tag";
import { ProjGrid } from "./ProjGrid";
import { useCompare } from "./CompareTray";
import { axisProps, BAR_MUTED, gridProps, legendStyle, SERIES_1, SERIES_2, tooltipStyle } from "./chart";
import { f1, fcv, signed } from "../views/format";

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

export function PlayerDrawerProvider({ data, children }: { data: PortalData; children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);
  const api = useMemo(() => ({ open, close }), [open, close]);
  const player = openId ? byId.get(openId) ?? null : null;

  return (
    <DrawerContext.Provider value={api}>
      {children}
      {player && <PlayerDrawer player={player} data={data} onClose={close} />}
    </DrawerContext.Provider>
  );
}

function PlayerDrawer({ player, data, onClose }: { player: Player; data: PortalData; onClose: () => void }) {
  const compare = useCompare();
  const pinned = compare.isPinned(player.id);
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
          <button className="btn btn-ghost" type="button" aria-pressed={pinned} onClick={() => compare.toggle(player.id)}>
            {pinned ? "Pinned" : "Pin"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <PlayerDetail player={player} data={data} />
      </aside>
    </>
  );
}

const shareFmt = (max: number) => (v: number) => (max <= 1.5 ? Math.round(v * 100) + "%" : f1(v));

/** Drawer body. Exported so it can be rendered on its own in tests. */
export function PlayerDetail({ player, data }: { player: Player; data: PortalData }) {
  const s = player.signals;
  const outlook = data.outlooks[player.id];

  const usage = useMemo(() => {
    const byWeek = new Map<number, { week: number; usage?: number; snap?: number }>();
    for (const d of s.usage_series) byWeek.set(d.week, { ...byWeek.get(d.week), week: d.week, usage: d.value });
    for (const d of s.snap_series) byWeek.set(d.week, { ...byWeek.get(d.week), week: d.week, snap: d.value });
    return [...byWeek.values()].sort((a, b) => a.week - b.week);
  }, [s.usage_series, s.snap_series]);
  const usageMax = Math.max(0, ...usage.flatMap((d) => [d.usage ?? 0, d.snap ?? 0]));
  const fmtShare = shareFmt(usageMax);

  const season = [
    { label: "Actual", value: player.season.pts },
    { label: "xFP", value: player.season.xfp },
  ];

  return (
    <div className="drawer-body">
      <div className="stats">
        <Stat label="Owner" value={ownerOf(data, player)} />
        <Stat label="ROS" value={f1(player.ros)} />
        <Stat label="ROS playoffs" value={f1(player.ros_playoff)} />
        <Stat label="Rank" value={"#" + player.ros_rank + " · " + player.pos + player.ros_pos_rank} />
        <Stat label="FC value" value={fcv(s.fc_value)} />
        <Stat label="Bye" value={player.bye == null ? "–" : "Wk " + player.bye} />
      </div>

      <Section title="Tag">
        <div className="row">
          <Tag tag={player.tag} />
          {player.tag_reasons.length === 0 && <span className="dim">No reasons given</span>}
        </div>
        {player.tag_reasons.length > 0 && (
          <ul className="bullets">
            {player.tag_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {s.breakout && <p className="note">Breakout radar: {s.breakout}</p>}
      </Section>

      <Section title="Weekly projections" note="Shaded weeks are the playoffs (15–17)">
        <ProjGrid player={player} week={data.meta.week} />
      </Section>

      <Section title="Usage and snaps" note={s.usage_metric.replace(/_/g, " ") + " · trend " + signed(s.usage_trend, 2)}>
        {usage.length > 1 ? (
          <div className="chart" style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={usage} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="week" {...axisProps} tickFormatter={(w: number) => "W" + w} />
                <YAxis {...axisProps} tickFormatter={fmtShare} domain={[0, "auto"]} />
                <Tooltip {...tooltipStyle} labelFormatter={(w) => "Week " + w} formatter={(v: number) => fmtShare(v)} />
                <Legend wrapperStyle={legendStyle} iconType="plainline" />
                <Line type="monotone" dataKey="usage" name="Usage" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                <Line type="monotone" dataKey="snap" name="Snap %" stroke={SERIES_2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="dim">Not enough weeks yet.</p>
        )}
      </Section>

      <Section
        title="Season: actual vs expected"
        note={player.season.games + " games · luck " + signed(s.luck) + (s.luck > 0 ? " (overperforming)" : s.luck < 0 ? " (underperforming)" : "")}
      >
        <div className="chart" style={{ height: 92 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={season} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide domain={[0, "auto"]} />
              <YAxis type="category" dataKey="label" {...axisProps} width={56} axisLine={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface2)" }} formatter={(v: number) => f1(v) + " pts"} />
              <Bar dataKey="value" name="Points" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {season.map((d) => (
                  <Cell key={d.label} fill={d.label === "Actual" ? SERIES_1 : BAR_MUTED} />
                ))}
                <LabelList dataKey="value" position="right" formatter={(v: number) => f1(v)} fill="var(--text)" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="FantasyCalc value" note={s.fc_rank != null ? "Market rank #" + s.fc_rank : undefined}>
        {s.fc_history.length > 1 ? (
          <div className="chart" style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={s.fc_history} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis {...axisProps} domain={["auto", "auto"]} width={48} tickFormatter={(v: number) => fcv(v)} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => fcv(v)} />
                <Line type="monotone" dataKey="value" name="FC value" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="dim">No value history.</p>
        )}
      </Section>

      {outlook && (
        <Section title="Outlook" note={"Updated " + outlook.updated.slice(0, 10)}>
          <div className="row">
            <Tag tag={outlook.signal} />
          </div>
          <p>{outlook.summary}</p>
          {outlook.risks.length > 0 && (
            <>
              <h4 className="minihead">Risks</h4>
              <ul className="bullets">
                {outlook.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {outlook.sources.length > 0 && (
            <>
              <h4 className="minihead">Sources</h4>
              <ul className="bullets">
                {outlook.sources.map((src) => (
                  <li key={src.url + src.title}>
                    <a href={src.url} target="_blank" rel="noreferrer noopener">
                      {src.title}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="dsec">
      <div className="dsec-head">
        <h3>{title}</h3>
        {note && <span className="pnote">{note}</span>}
      </div>
      {children}
    </section>
  );
}
