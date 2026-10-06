import { useEffect, useState } from "react";
import type { Briefing, Player } from "../types/data";
import { decryptBriefing } from "../lib/crypto";
import { PlayerList } from "./PlayerName";

const STORE_KEY = "wnfl.briefing.pass";
const KIND_LABEL = { trade: "Trade", waiver: "Waiver", lineup: "Lineup", hold: "Hold" } as const;

function readPass(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}
function writePass(v: string | null) {
  try {
    if (v === null) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, v);
  } catch {
    /* storage blocked: passphrase just isn't remembered */
  }
}

/** The file text if it looks like a {salt, iv, ct} envelope, else null (404s and SPA fallbacks count as missing). */
async function fetchEnvelope(): Promise<string | null> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + "data/private/briefing.enc", { cache: "no-cache" });
    if (!res.ok) return null;
    const text = await res.text();
    const env = JSON.parse(text);
    return env && env.salt && env.iv && env.ct ? text : null;
  } catch {
    return null;
  }
}

type State =
  | { s: "loading" }
  | { s: "missing" }
  | { s: "locked"; error?: string }
  | { s: "decrypting" }
  | { s: "open"; brief: Briefing };

/** The weekly GM briefing, decrypted in the browser with a passphrase. */
export function BriefingSlot({ players }: { players: Map<string, Player> }) {
  const [blob, setBlob] = useState<string | null>(null);
  const [state, setState] = useState<State>({ s: "loading" });
  const [input, setInput] = useState("");

  async function unlock(text: string, pass: string) {
    setState({ s: "decrypting" });
    try {
      const brief = await decryptBriefing<Briefing>(text, pass);
      writePass(pass);
      setState({ s: "open", brief });
    } catch {
      writePass(null);
      setState({ s: "locked", error: "Wrong passphrase." });
    }
  }

  useEffect(() => {
    let live = true;
    fetchEnvelope().then((text) => {
      if (!live) return;
      setBlob(text);
      if (!text) return setState({ s: "missing" });
      const stored = readPass();
      if (stored) unlock(text, stored);
      else setState({ s: "locked" });
    });
    return () => {
      live = false;
    };
  }, []);

  function forget() {
    writePass(null);
    setInput("");
    setState({ s: "locked" });
  }

  const brief = state.s === "open" ? state.brief : null;

  return (
    <section className="panel">
      <div className="phead">
        <h2>Briefing</h2>
        {brief && (
          <span className="pnote">
            Week {brief.week} · {new Date(brief.generated_at).toLocaleString()} ·{" "}
            <button type="button" className="linkbtn" onClick={forget}>
              Forget passphrase
            </button>
          </span>
        )}
      </div>

      {state.s === "loading" && <div className="pbody dim">Loading briefing…</div>}
      {state.s === "missing" && <div className="pbody dim">No briefing yet.</div>}
      {state.s === "decrypting" && <div className="pbody dim">Decrypting…</div>}

      {state.s === "locked" && blob && (
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (input) unlock(blob, input);
          }}
        >
          <label className="grow">
            Passphrase
            <input
              type="password"
              autoComplete="current-password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!input}>
            Unlock
          </button>
          {state.error && (
            <span className="neg" role="alert">
              {state.error}
            </span>
          )}
        </form>
      )}

      {brief && (
        <>
          <div className="pbody">{brief.situation}</div>
          <ol className="actions">
            {brief.moves.map((m, i) => (
              <li key={m.kind + i} className="action">
                <span className={"chip kind-" + m.kind}>{KIND_LABEL[m.kind] ?? m.kind}</span>
                <div className="grow">
                  <div className="action-title">{m.title}</div>
                  <div className="dim">{m.detail}</div>
                  {m.player_ids.length > 0 && (
                    <div className="action-players">
                      <PlayerList ids={m.player_ids} players={players} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="pbody dim">{brief.reasoning}</div>
        </>
      )}
    </section>
  );
}
