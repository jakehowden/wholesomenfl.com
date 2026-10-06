// Shared recharts styling. Every colour is a CSS token, so charts follow the theme toggle.

export const axisProps = {
  stroke: "var(--border2)",
  tick: { fill: "var(--muted)", fontSize: 11 },
  tickLine: false,
} as const;

export const gridProps = { stroke: "var(--border)", strokeDasharray: "0", vertical: false } as const;

export const tooltipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border2)",
    borderRadius: 8,
    color: "var(--text)",
    fontSize: 13,
  },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--text)" },
} as const;

export const legendStyle = { fontSize: 12, color: "var(--muted)" } as const;

export const SERIES_1 = "var(--series-1)";
export const SERIES_2 = "var(--series-2)";
export const BAR_MUTED = "var(--bar-muted)";
