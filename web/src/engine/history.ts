const SLEEPER = "https://api.sleeper.app";
export const PREVIOUS_LEAGUE_ID = "1241014401570459648";

/** The fields we read from a raw Sleeper /transactions/{week} row. */
export interface SleeperTransaction {
  type: string;
  status?: string | null;
  roster_ids?: number[] | null;
  adds?: Record<string, number> | null;
}

export interface TradeStats {
  /** Trades per roster_id. */
  counts: Map<number, number>;
  /** Past trades with me, per roster_id. */
  withMe: Map<number, number>;
  total: number;
  vetoed: number;
  /** Most trades by any one manager (≥1), for normalising frequency. */
  max: number;
}

export function sweepTrades(transactions: readonly SleeperTransaction[], myRosterId: number | null): TradeStats {
  const counts = new Map<number, number>();
  const withMe = new Map<number, number>();
  let total = 0;
  let vetoed = 0;
  for (const t of transactions) {
    if (t.type !== "trade") continue;
    total++;
    if (t.status && t.status !== "complete") vetoed++;
    const ids = t.roster_ids ?? [];
    for (const rid of ids) counts.set(rid, (counts.get(rid) ?? 0) + 1);
    if (myRosterId != null && ids.includes(myRosterId)) {
      for (const rid of ids) if (rid !== myRosterId) withMe.set(rid, (withMe.get(rid) ?? 0) + 1);
    }
  }
  return { counts, withMe, total, vetoed, max: Math.max(1, ...counts.values()) };
}

/** 0..1 trade frequency relative to the league's most active trader. */
export const tradeRate = (stats: TradeStats, rosterId: number): number =>
  (stats.counts.get(rosterId) ?? 0) / stats.max;

async function weekTx(leagueId: string, week: number): Promise<SleeperTransaction[]> {
  try {
    const res = await fetch(SLEEPER + "/v1/league/" + leagueId + "/transactions/" + week);
    return res.ok ? ((await res.json()) as SleeperTransaction[]) : [];
  } catch {
    return [];
  }
}

/** Live Sleeper transactions: this season up to `week`, plus all of the previous league's season. */
export async function fetchTradeHistory(
  leagueId: string,
  week: number,
  previousLeagueId: string = PREVIOUS_LEAGUE_ID,
): Promise<SleeperTransaction[]> {
  const jobs: Promise<SleeperTransaction[]>[] = [];
  for (let w = 1; w <= week; w++) jobs.push(weekTx(leagueId, w));
  for (let w = 1; w <= 18; w++) jobs.push(weekTx(previousLeagueId, w));
  return (await Promise.all(jobs)).flat();
}
