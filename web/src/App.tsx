import { useEffect, useState, type ComponentType } from "react";
import { loadData, loadLive, type PortalData } from "./data/load";
import { PlayerDrawerProvider } from "./components/PlayerDrawer";
import { CompareProvider } from "./components/CompareTray";
import { Overview } from "./views/Overview";
import { Waivers } from "./views/Waivers";
import { Trades } from "./views/Trades";
import { MyTeam } from "./views/MyTeam";
import { League } from "./views/League";
import { Players } from "./views/Players";

const TABS: { id: string; label: string; View: ComponentType<{ data: PortalData }> }[] = [
  { id: "overview", label: "Overview", View: Overview },
  { id: "waivers", label: "Waivers", View: Waivers },
  { id: "trades", label: "Trades", View: Trades },
  { id: "my-team", label: "My Team", View: MyTeam },
  { id: "league", label: "League", View: League },
  { id: "players", label: "Players", View: Players },
];

function tabFromHash(): string {
  const id = location.hash.replace(/^#\/?/, "");
  return TABS.some((t) => t.id === id) ? id : TABS[0].id;
}

function useHashTab(): [string, (id: string) => void] {
  const [tab, setTab] = useState(tabFromHash);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [tab, (id) => (location.hash = id)];
}

/** Same behaviour as initTheme() in the old app.js: flip from whatever is showing, persist under "theme". */
function toggleTheme() {
  const root = document.documentElement;
  const now = root.dataset.theme;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = now ? (now === "dark" ? "light" : "dark") : dark ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // storage blocked; the toggle still works for this visit
  }
}

function age(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? hrs + "h ago" : Math.round(hrs / 24) + "d ago";
}

export function App() {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState("Wholesome NFL");
  const [tab, setTab] = useHashTab();

  useEffect(() => {
    loadData()
      .then((d) => {
        setData(d);
        loadLive(d.meta.league_id)
          .then((live) => {
            setLeagueName(live.league.name);
            setData((cur) => cur && { ...cur, live });
          })
          .catch(() => {});
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          <div className="topbar-id">
            <h1>{leagueName}</h1>
            {data && <span className="chip">Week {data.meta.week}</span>}
          </div>
          <div className="topbar-tools">
            <button className="btn btn-ghost" type="button" onClick={toggleTheme}>
              Theme
            </button>
          </div>
        </div>
        {data && (
          <div className="topbar-meta">
            {data.meta.season} · data {age(data.meta.generated_at)}
          </div>
        )}
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab" type="button" aria-selected={t.id === current.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="fatal">
          <h2>Couldn't load data</h2>
          <p className="dim">{error}</p>
        </div>
      ) : !data ? (
        <div className="boot">
          <div className="spinner" aria-hidden="true" />
          <p>Loading…</p>
        </div>
      ) : (
        <CompareProvider data={data}>
          <PlayerDrawerProvider data={data}>
            <main>
              <div className="panelgroup">
                <current.View data={data} />
              </div>
            </main>
          </PlayerDrawerProvider>
        </CompareProvider>
      )}
    </>
  );
}
