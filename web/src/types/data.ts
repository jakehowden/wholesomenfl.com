// Data contract. Mirrors the overview contract and pipeline/schema.py exactly.

export type Pos = "QB"|"RB"|"WR"|"TE"|"K"|"DEF";
export type Tag = "BUY"|"SELL"|"HOLD";

// meta.json
export interface Meta { generated_at: string; season: string; week: number; league_id: string;
  my_roster_id: number; sources: Record<string,string>; llm_generated_at: string|null; }

// players.json  → Player[]  (every fantasy-relevant player: rostered + top 300 FAs by ROS)
export interface Player {
  id: string; name: string; pos: Pos; team: string|null; bye: number|null;
  injury: string|null;               // Sleeper injury_status
  roster_id: number|null;            // null = free agent
  proj: Record<string, number>;      // week ("5".."17") → calibrated, availability-adjusted league pts
  ros: number;                       // weighted points-above-replacement, wks cur..17
  ros_playoff: number;               // same, wks 15..17 only (weighted)
  ros_rank: number; ros_pos_rank: number;
  repl: number;                      // replacement-level weekly pts at this pos
  season: { games: number; pts: number; ppg: number; xfp: number; xfp_pg: number };
  signals: {
    usage_trend: number;             // z-ish: last-3 avg vs season avg of the pos usage metric, + = rising
    usage_metric: string;            // e.g. "target_share", "snap_pct+carries", "rush_share"
    usage_series: { week: number; value: number }[];
    snap_series: { week: number; value: number }[];
    luck: number;                    // season pts − xfp (league scoring); + = overperforming
    market_drift: number|null;       // ros now − ros at previous snapshot
    fc_value: number|null;           // FantasyCalc redraft value
    fc_rank: number|null;
    market_gap: number|null;         // fc_rank − ros_rank (+ = we rate higher than market = buy)
    fc_history: { date: string; value: number }[];
    breakout: string|null;           // reason text if breakout radar fired, else null
  };
  tag: Tag; tag_reasons: string[];
}

// league.json
export interface League {
  teams: Team[];
  schedule: { week: number; matchups: [number, number][] }[];   // roster_id pairs, wks cur..14
  transactions: Tx[];
  sim: { runs: number; sd: number };
}
export interface Team {
  roster_id: number; owner: string; avatar: string|null;
  wins: number; losses: number; ties: number; pf: number; pa: number;
  all_play_w: number; all_play_l: number;
  ros_strength: number;               // mean projected optimal-lineup pts/wk for remaining wks
  pos_strength: Record<Pos, number>;  // projected starter pts at pos minus league avg at pos
  playoff_odds: number;               // 0..1
  seed_dist: number[];                // length 10, P(finish seed i+1)
  proj_wins: number;
  faab_left: number;
  roster: string[];                   // player ids
}
export interface Tx {
  id: string; type: "trade"|"waiver"|"free_agent"; week: number; status: string;
  sides: { roster_id: number; adds: string[]; drops: string[]; ros_delta: number }[];
  grade: string|null;                 // trades only: "A".."F" per side, joined "A/C"
  faab: number|null;
}

// outlooks.json  → Record<player_id, Outlook>
export interface Outlook { signal: Tag; summary: string; risks: string[]; sources: { title: string; url: string }[];
  updated: string; model: string; }

// private/briefing.enc  → base64 JSON {salt, iv, ct}; AES-GCM-256, key = PBKDF2-SHA256(passphrase, salt, 250000)
// plaintext:
export interface Briefing { week: number; generated_at: string; situation: string;
  moves: { kind: "trade"|"waiver"|"lineup"|"hold"; title: string; detail: string; player_ids: string[] }[];
  reasoning: string; }
