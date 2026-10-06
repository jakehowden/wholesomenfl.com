import type { ReactNode } from "react";

/** Shared shell for tab placeholders until phase 06 fills them in. */
export function Placeholder({ title, note, children }: { title: string; note: string; children?: ReactNode }) {
  return (
    <section className="panel">
      <div className="phead">
        <h2>{title}</h2>
        <span className="pnote">{note}</span>
      </div>
      {children ?? <div className="pbody dim">Coming in a later phase.</div>}
    </section>
  );
}
