export const f1 = (n: number): string => n.toFixed(1);
export const signed = (n: number, d = 1): string => (n > 0 ? "+" : "") + n.toFixed(d);
export const pct = (n: number): string => Math.round(n * 100) + "%";
export const fcv = (n: number | null): string => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
export const signClass = (n: number): string | undefined => (n > 0 ? "pos" : n < 0 ? "neg" : undefined);
