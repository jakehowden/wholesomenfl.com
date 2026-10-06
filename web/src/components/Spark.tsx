interface SparkProps {
  data: { week: number; value: number }[];
  width?: number;
  height?: number;
}

/** Tiny inline sparkline, drawn in the accent colour. */
export function Spark({ data, width = 64, height = 18 }: SparkProps) {
  if (data.length < 2) return null;
  const vals = data.map((d) => d.value);
  const lo = Math.min(...vals);
  const span = Math.max(...vals) - lo || 1;
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((d.value - lo) / span) * (height - 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
