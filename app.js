const SLEEPER = "https://api.sleeper.app";
const FANTASYCALC = "https://api.fantasycalc.com";
const DEFAULT_LEAGUE = "1383485349862338560";
const MY_USERNAME = "jsh96";
const FANTASY_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const GAIN_CAP = 25;
const VALUE_PER_DOLLAR = 45;
const MAX_SEND = 3;
const FAIRNESS_FLOOR = 0.95;
const CASH_BUDGET_SHARE = 0.15;
const CASH_SELLER_NET = 40;

const SLOT_ELIGIBILITY = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  WRRB_WRT: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};
const BENCH_SLOTS = ["BN", "IR", "TAXI"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const commas = (v) => Math.round(v).toLocaleString("en-US");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const signed = (v) => (v > 0 ? "+" + n1(v) : n1(v));

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + " on " + url.replace(/^https:\/\//, ""));
  return res.json();
}

let STATE = null;
let SELECTED_TRADE = 0;

function progress(pct, msg) {
  const fill = $("bootFill");
  if (fill) fill.style.width = pct + "%";
  if (msg) $("bootMsg").textContent = msg;
}

function fcParams(league) {
  const slots = league.roster_positions || [];
  const qbSlots = slots.filter((s) => s === "QB").length;
  const superflex = slots.includes("SUPER_FLEX");
  const numQbs = superflex || qbSlots >= 2 ? 2 : 1;
  const allowed = [8, 10, 12, 14];
  const teams = league.total_rosters || 12;
  const numTeams = allowed.reduce((a, b) => (Math.abs(b - teams) < Math.abs(a - teams) ? b : a), 12);
  const rec = league.scoring_settings?.rec ?? 0;
  const ppr = [0, 0.5, 1].reduce((a, b) => (Math.abs(b - rec) < Math.abs(a - rec) ? b : a), 0);
  const teBonus = league.scoring_settings?.bonus_rec_te ?? 0;
  const tep = teBonus >= 0.5 ? "te++" : teBonus > 0 ? "te+" : "none";
  return { isDynasty: league.settings?.type === 2, numQbs, numTeams, ppr, tep };
}

function positionQuery() {
  return FANTASY_POS.map((p) => "position[]=" + p).join("&");
}

async function loadAll(leagueId) {
  progress(6, "Reading league settings…");
  const [state, league] = await Promise.all([
    getJSON(SLEEPER + "/v1/state/nfl"),
    getJSON(SLEEPER + "/v1/league/" + leagueId),
  ]);

  const season = league.season || state.season;
  const week = clamp(state.week || 1, 1, 18);

  progress(18, "Fetching rosters and managers…");
  const [rosters, users] = await Promise.all([
    getJSON(SLEEPER + "/v1/league/" + leagueId + "/rosters"),
    getJSON(SLEEPER + "/v1/league/" + leagueId + "/users"),
  ]);

  const p = fcParams(league);
  const fcUrl =
    FANTASYCALC +
    "/values/current?isDynasty=" + p.isDynasty +
    "&numQbs=" + p.numQbs +
    "&numTeams=" + p.numTeams +
    "&ppr=" + p.ppr +
    "&tep=" + p.tep;

  progress(34, "Fetching trade values and projections…");
  const q = positionQuery();
  const [values, proj, seasonStats, trending] = await Promise.all([
    getJSON(fcUrl),
    getJSON(SLEEPER + "/projections/nfl/" + season + "/" + week + "?season_type=regular&" + q),
    getJSON(SLEEPER + "/stats/nfl/" + season + "?season_type=regular&" + q).catch(() => []),
    getJSON(SLEEPER + "/v1/players/nfl/trending/add?lookback_hours=48&limit=200").catch(() => []),
  ]);

  progress(72, "Sweeping trade history…");
  const weeks = Array.from({ length: week }, (_, i) => i + 1);
  const thisSeason = weeks.map((w) =>
    getJSON(SLEEPER + "/v1/league/" + leagueId + "/transactions/" + w).catch(() => [])
  );
  let prior = [];
  if (league.previous_league_id) {
    prior = Array.from({ length: 18 }, (_, i) => i + 1).map((w) =>
      getJSON(SLEEPER + "/v1/league/" + league.previous_league_id + "/transactions/" + w).catch(() => [])
    );
  }
  const txChunks = await Promise.all([...thisSeason, ...prior]);
  const transactions = txChunks.flat();

  progress(94, "Scoring…");
  return { state, league, rosters, users, values, proj, seasonStats, trending, transactions, season, week, fcParams: p, fcUrl };
}

function buildPlayerIndex(proj, seasonStats, scoring) {
  const idx = new Map();
  for (const rec of proj) {
    const id = String(rec.player_id);
    const pl = rec.player || {};
    const name = [pl.first_name, pl.last_name].filter(Boolean).join(" ").trim();
    idx.set(id, {
      id,
      name: name || id,
      pos: pl.position || (pl.fantasy_positions || [])[0] || "?",
      team: pl.team || pl.team_abbr || null,
      injury: pl.injury_status || null,
      proj: score(rec.stats || {}, scoring),
      actual: 0,
      games: 0,
    });
  }
  for (const rec of seasonStats) {
    const id = String(rec.player_id);
    const hit = idx.get(id);
    if (!hit) continue;
    hit.actual = score(rec.stats || {}, scoring);
    hit.games = rec.stats?.gp || 0;
  }
  return idx;
}

function score(stats, scoring) {
  let total = 0;
  for (const k in stats) {
    const w = scoring[k];
    if (typeof w === "number") total += w * stats[k];
  }
  return Math.round(total * 100) / 100;
}

function startingSlots(league) {
  return (league.roster_positions || []).filter((s) => !BENCH_SLOTS.includes(s));
}

function optimalLineup(playerIds, players, slots) {
  const order = slots
    .map((slot, i) => ({ slot, i, width: (SLOT_ELIGIBILITY[slot] || []).length }))
    .sort((a, b) => a.width - b.width || a.i - b.i);
  const used = new Set();
  const assigned = new Map();
  let total = 0;
  for (const { slot, i } of order) {
    const elig = SLOT_ELIGIBILITY[slot] || [];
    let best = null;
    for (const id of playerIds) {
      if (used.has(id)) continue;
      const pl = players.get(id);
      if (!pl || !elig.includes(pl.pos)) continue;
      if (!best || pl.proj > best.proj) best = pl;
    }
    if (best) {
      used.add(best.id);
      total += best.proj;
      assigned.set(i, best);
    } else {
      assigned.set(i, null);
    }
  }
  return { total: Math.round(total * 10) / 10, used, assigned };
}

function combinations(list, maxSize) {
  const out = [];
  const walk = (start, picked) => {
    if (picked.length) out.push(picked.slice());
    if (picked.length === maxSize) return;
    for (let i = start; i < list.length; i++) {
      picked.push(list[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

function teamProfile(ctx) {
  const { league, rosters, users, values, players } = ctx;
  const slots = startingSlots(league);
  const budget = league.settings?.waiver_budget ?? 0;
  const nameByUser = new Map(
    users.map((u) => [u.user_id, u.metadata?.team_name || u.display_name || "Unknown"])
  );

  const maxTrades = Math.max(1, ...ctx.tradeStats.counts.values());

  return rosters.map((r) => {
    const ids = (r.players || []).filter((id) => players.has(id));
    const lineup = optimalLineup(ids, players, slots);
    const surplus = ids
      .filter((id) => !lineup.used.has(id))
      .map((id) => players.get(id))
      .sort((a, b) => b.proj - a.proj);
    const rosterValue = ids.reduce((sum, id) => sum + (values.get(id)?.value || 0), 0);
    const s = r.settings || {};
    const spent = s.waiver_budget_used || 0;
    const trades = ctx.tradeStats.counts.get(r.roster_id) || 0;
    const netFaab = ctx.tradeStats.netFaab.get(r.roster_id) || 0;
    const withMe = ctx.tradeStats.withRoster.get(r.roster_id) || 0;
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const played = wins + losses + (s.ties || 0);
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      name: nameByUser.get(r.owner_id) || "Roster " + r.roster_id,
      ids,
      lineup,
      surplus,
      rosterValue,
      wins,
      losses,
      ties: s.ties || 0,
      played,
      winPct: played ? wins / played : 0,
      pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
      pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
      faabLeft: budget - spent,
      faabSpent: spent,
      trades,
      tradeRate: trades / maxTrades,
      netFaab,
      withMe,
    };
  });
}

function sweepTrades(transactions, myRosterId) {
  const counts = new Map();
  const netFaab = new Map();
  const withRoster = new Map();
  const cashDeals = [];
  const shapes = new Map();
  let total = 0;
  let vetoed = 0;
  for (const t of transactions) {
    if (t.type !== "trade") continue;
    total++;
    const received = new Map();
    for (const rid of t.roster_ids || []) received.set(rid, 0);
    for (const rid of Object.values(t.adds || {})) received.set(rid, (received.get(rid) || 0) + 1);
    const shape = [...received.values()].sort((a, b) => b - a).join("-");
    shapes.set(shape, (shapes.get(shape) || 0) + 1);
    if (t.status && t.status !== "complete") vetoed++;
    const ids = t.roster_ids || [];
    for (const rid of ids) counts.set(rid, (counts.get(rid) || 0) + 1);
    if (myRosterId != null && ids.includes(myRosterId)) {
      for (const rid of ids) {
        if (rid !== myRosterId) withRoster.set(rid, (withRoster.get(rid) || 0) + 1);
      }
    }
    for (const wb of t.waiver_budget || []) {
      netFaab.set(wb.sender, (netFaab.get(wb.sender) || 0) - wb.amount);
      netFaab.set(wb.receiver, (netFaab.get(wb.receiver) || 0) + wb.amount);
      cashDeals.push({ amount: wb.amount, sender: wb.sender, receiver: wb.receiver, created: t.created });
    }
  }
  cashDeals.sort((a, b) => b.amount - a.amount);
  const peak = Math.max(1, ...shapes.values());
  const shapeFit = (send, get) => (shapes.get([send, get].sort((a, b) => b - a).join("-")) || 0) / peak;
  const topShapes = [...shapes.entries()].sort((a, b) => b[1] - a[1]);
  return { counts, netFaab, withRoster, cashDeals, shapes, shapeFit, topShapes, total, vetoed };
}

function freeAgents(ctx) {
  const rostered = new Set();
  for (const r of ctx.rosters) for (const id of r.players || []) rostered.add(id);
  const out = [];
  for (const pl of ctx.players.values()) {
    if (rostered.has(pl.id)) continue;
    if (!FANTASY_POS.includes(pl.pos)) continue;
    if (pl.proj <= 0) continue;
    out.push(pl);
  }
  return out.sort((a, b) => b.proj - a.proj);
}

function lineupGain(team, players, slots, addId) {
  const withAdd = optimalLineup([...team.ids, addId], players, slots);
  return Math.round((withAdd.total - team.lineup.total) * 10) / 10;
}

function waiverBoard(ctx) {
  const { league, me, players, trending, values } = ctx;
  const slots = startingSlots(league);
  const fas = freeAgents(ctx);
  const trendMap = new Map(trending.map((t) => [String(t.player_id), t.count]));
  const rivals = ctx.teams.filter((t) => t.rosterId !== me.rosterId);

  const scored = [];
  for (const fa of fas) {
    const gain = lineupGain(me, players, slots, fa.id);
    if (gain <= 0.2) continue;
    scored.push({ player: fa, gain, trend: trendMap.get(fa.id) || 0, value: values.get(fa.id)?.value || 0 });
  }
  scored.sort((a, b) => b.gain - a.gain);
  const perPos = new Map();
  const diverse = scored.filter((row) => {
    const seen = perPos.get(row.player.pos) || 0;
    if (seen >= 3) return false;
    perPos.set(row.player.pos, seen + 1);
    return true;
  });

  const weeksLeft = Math.max(1, (league.settings?.playoff_week_start || 15) - ctx.week);
  const budget = league.settings?.waiver_budget ?? 0;

  for (const row of diverse) {
    const alternatives = Math.max(
      1,
      scored.filter((o) => o.player.pos === row.player.pos && o.gain >= row.gain * 0.8).length
    );
    let demand = 0;
    for (const rv of rivals) {
      if (lineupGain(rv, players, slots, row.player.id) >= 3) demand++;
    }
    const share = Math.min(1, row.gain / GAIN_CAP);
    const competition = 0.25 + 0.75 * (rivals.length ? demand / rivals.length : 0);
    const raw = me.faabLeft * share * 0.6 * competition / Math.sqrt(alternatives);
    row.alternatives = alternatives;
    row.demand = demand;
    row.weeksLeft = weeksLeft;
    row.seasonGain = Math.round(row.gain * weeksLeft * 10) / 10;
    row.bid = me.faabLeft > 0 ? clamp(Math.round(raw), 1, me.faabLeft) : 0;
    row.bidPct = budget ? Math.round((row.bid / me.faabLeft) * 100) : 0;
    row.replaces = weakestStarterFor(me, players, slots, row.player);
  }
  return diverse;
}

function weakestStarterFor(team, players, slots, incoming) {
  const before = team.lineup;
  const after = optimalLineup([...team.ids, incoming.id], players, slots);
  for (const [i, pl] of before.assigned) {
    const now = after.assigned.get(i);
    if (pl && now && now.id !== pl.id) return pl;
    if (!pl && now) return null;
  }
  return null;
}

function lineupIssues(ctx) {
  const { league, me, players } = ctx;
  const slots = startingSlots(league);
  const set = new Set(me.starters || []);
  const issues = [];
  for (const [i, best] of me.lineup.assigned) {
    if (!best) continue;
    if (set.has(best.id)) continue;
    const current = (me.starters || [])[i] ? players.get((me.starters || [])[i]) : null;
    const delta = Math.round((best.proj - (current?.proj || 0)) * 10) / 10;
    if (delta <= 0.2) continue;
    issues.push({ slot: slots[i], current, best, delta });
  }
  return issues.sort((a, b) => b.delta - a.delta);
}

function tradeBoard(ctx) {
  const { league, me, players, values } = ctx;
  const slots = startingSlots(league);
  const budget = league.settings?.waiver_budget ?? 0;
  const offers = [];

  const surplusValue = (p) => values.get(p.id)?.value || 0;
  const mySurplus = [...me.surplus]
    .filter((p) => surplusValue(p) > 0 || p.proj > 0)
    .sort((a, b) => surplusValue(a) - surplusValue(b) || a.proj - b.proj);
  const packages = combinations(mySurplus, MAX_SEND);

  for (const rival of ctx.teams) {
    if (rival.rosterId === me.rosterId) continue;
    for (const target of rival.surplus) {
      if (target.proj <= 0) continue;
      const gain = lineupGain(me, players, slots, target.id);
      if (gain <= 0.5) continue;

      const targetValue = values.get(target.id)?.value || 0;
      const need = targetValue * FAIRNESS_FLOOR;
      const budgetShare = budget ? rival.faabLeft / budget : 1;
      const cashWelcome = budgetShare <= CASH_BUDGET_SHARE || rival.netFaab >= CASH_SELLER_NET;

      let best = null;
      for (const combo of packages) {
        const sent = combo.reduce((sum, p) => sum + surplusValue(p), 0);
        const shortfall = Math.max(0, need - sent);
        const cash = cashWelcome && shortfall > 0
          ? clamp(Math.ceil(shortfall / VALUE_PER_DOLLAR), 0, me.faabLeft)
          : 0;
        const paid = sent + cash * VALUE_PER_DOLLAR;
        const fair = targetValue > 0 ? Math.min(1, paid / targetValue) : 1;
        const shape = ctx.tradeStats.shapeFit(combo.length, 1);
        const overpay = targetValue > 0 ? Math.min(1, Math.max(0, paid - targetValue) / targetValue) : 0;
        const rank = 0.5 * fair + 0.38 * shape - 0.12 * overpay;
        if (!best || rank > best.rank) best = { combo, sent, cash, paid, fair, shape, rank };
      }
      if (!best) continue;

      const send = best.combo;
      const cash = best.cash;
      const paid = best.paid;
      const fairness = best.fair;
      const shapeFit = best.shape;
      const cashSeller = clamp(rival.netFaab / 81, 0, 1);
      const lowBudget = clamp(1 - budgetShare, 0, 1);
      const cashAppetite = cash > 0 ? Math.max(cashSeller, lowBudget) : 0.5;
      const priorMe = Math.min(1, rival.withMe / 3);

      const accept =
        0.25 * rival.tradeRate + 0.12 * priorMe + 0.12 * 1 + 0.16 * cashAppetite + 0.2 * fairness + 0.15 * shapeFit;

      offers.push({
        rival,
        target,
        targetValue,
        send,
        sentValue: best.sent,
        cash,
        paid,
        gain,
        shape: send.length + "-for-1",
        accept: clamp(accept, 0, 0.98),
        parts: { tradeRate: rival.tradeRate, priorMe, benchFit: 1, cashAppetite, fairness, shapeFit },
      });
    }
  }

  const seen = new Set();
  return offers
    .sort((a, b) => b.gain * b.accept - a.gain * a.accept)
    .filter((o) => {
      const key = o.rival.rosterId + ":" + o.target.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function buildActions(ctx) {
  const out = [];
  for (const issue of ctx.issues.slice(0, 2)) {
    out.push({
      kind: "LINEUP",
      tone: "urgent",
      head: "Start " + issue.best.name + " over " + (issue.current ? issue.current.name : "an empty " + issue.slot),
      why:
        "Your <strong>" + esc(issue.slot) + "</strong> slot is set to " +
        (issue.current
          ? esc(issue.current.name) + ", projecting <strong>" + n1(issue.current.proj) + "</strong>" +
            (issue.current.injury ? " and listed <strong>" + esc(issue.current.injury) + "</strong>" : "")
          : "nobody") +
        ". " + esc(issue.best.name) + " projects <strong>" + n1(issue.best.proj) + "</strong> and is already on your roster.",
      gain: issue.delta,
      rank: issue.delta,
      unit: "pts/wk",
      cost: "free",
      cta: null,
    });
  }
  for (const row of ctx.waivers.slice(0, 3)) {
    out.push({
      kind: "WAIVER",
      tone: row.gain >= 10 ? "urgent" : row.gain >= 3 ? "warn" : "ok",
      head: "Claim " + row.player.name + (row.replaces ? " over " + row.replaces.name : ""),
      why:
        esc(row.player.name) + " (" + esc(row.player.pos) + (row.player.team ? " · " + esc(row.player.team) : "") +
        ") projects <strong>" + n1(row.player.proj) + "</strong> and is unowned. " +
        (row.demand === 0
          ? "No rival lineup improves by 3+ points from him, so he should come cheap."
          : "<strong>" + row.demand + "</strong> rival" + (row.demand === 1 ? "" : "s") + " would also gain from him.") +
        " Worth about <strong>" + n1(row.seasonGain) + "</strong> points across the " + row.weeksLeft + " weeks left.",
      gain: row.gain,
      rank: row.gain * 0.95,
      unit: "pts/wk",
      cost: "$" + row.bid,
      cta: null,
    });
  }
  for (const offer of ctx.trades.slice(0, 2)) {
    const giving = offer.send.map((p) => p.name).join(", ");
    out.push({
      kind: "TRADE · " + Math.round(offer.accept * 100) + "% LIKELY",
      tone: "ok",
      head: "Get " + offer.target.name + " from " + offer.rival.name,
      why:
        esc(offer.target.name) + " sits on their <strong>bench</strong>, outside their own best lineup. " +
        esc(offer.rival.name) + " are " + offer.rival.wins + "–" + offer.rival.losses +
        " with <strong>" + offer.rival.trades + "</strong> trades on record" +
        (offer.cash > 0
          ? offer.rival.netFaab >= CASH_SELLER_NET
            ? ", and net <strong>+$" + offer.rival.netFaab + " FAAB</strong> received across their trades — they sell players for budget"
            : ", and down to <strong>$" + offer.rival.faabLeft + "</strong> of FAAB, so cash actually tempts them"
          : "") +
        ".",
      gain: offer.gain,
      rank: offer.gain * offer.accept,
      unit: "pts/wk",
      cost: (giving ? giving : "") + (offer.cash ? (giving ? " + " : "") + "$" + offer.cash : ""),
      cta: null,
    });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, 6);
}

function renderKpis(ctx) {
  const { me, league, teams } = ctx;
  const ranked = [...teams].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
  const place = ranked.findIndex((t) => t.rosterId === me.rosterId) + 1;
  const byValue = [...teams].sort((a, b) => b.rosterValue - a.rosterValue);
  const valueRank = byValue.findIndex((t) => t.rosterId === me.rosterId) + 1;
  const topValue = byValue[0]?.rosterValue || 0;
  const paRank = [...teams].sort((a, b) => b.pa - a.pa).findIndex((t) => t.rosterId === me.rosterId) + 1;
  const budget = league.settings?.waiver_budget ?? 0;
  const playoffStart = league.settings?.playoff_week_start || 15;
  const deadline = league.settings?.trade_deadline || playoffStart;
  const median = league.settings?.league_average_match === 1;
  const perWeek = median ? 2 : 1;
  const totalGames = (playoffStart - 1) * perWeek;

  const cards = [
    {
      label: "ROSTER VALUE",
      fig: commas(me.rosterValue),
      note: valueRank + " of " + teams.length + " · top is " + commas(topValue),
      tone: valueRank > teams.length / 2 ? "neg" : "pos",
    },
    {
      label: "FAAB LEFT",
      fig: "$" + me.faabLeft,
      note: "of $" + budget + " · " + (budget ? Math.round((me.faabLeft / budget) * 100) : 0) + "% unspent",
      tone: "pos",
      figTone: "pos",
    },
    {
      label: "POINTS AGAINST",
      fig: n1(me.pa),
      note: paRank === 1 ? "worst in league · unlucky" : paRank + " of " + teams.length + " most faced",
      tone: paRank <= 3 ? "cau" : "",
    },
    {
      label: "SEASON ELAPSED",
      fig: me.played + '<span class="unit">/' + totalGames + "</span>",
      note:
        Math.round((me.played / totalGames) * 100) + "% · " +
        (league.settings?.playoff_teams || 6) + " of " + teams.length + " make playoffs",
      tone: "pos",
    },
    {
      label: "TRADE WINDOW",
      fig: Math.max(0, deadline - ctx.week) + '<span class="unit">wk</span>',
      note: "deadline week " + deadline,
      tone: "",
    },
  ];

  $("kpis").innerHTML = cards
    .map(
      (c) =>
        '<div class="kpi"><div class="kpi-label">' + c.label +
        '</div><div class="kpi-fig ' + (c.figTone || "") + '">' + c.fig +
        '</div><div class="kpi-note ' + (c.tone || "dim") + '">' + esc(c.note) + "</div></div>"
    )
    .join("");
}

function renderActions(ctx) {
  const actions = ctx.actions;
  $("actionsNote").textContent =
    actions.length +
    " moves, ranked by points gained per week" +
    (ctx.league.settings?.league_average_match === 1
      ? ". Your league runs a median match, so every point counts toward two results."
      : ".");

  $("actions").innerHTML = actions
    .map(
      (a, i) =>
        '<div class="action">' +
        '<div class="action-top"><span class="rank rank-' + a.tone + '">' + (i + 1) +
        '</span><span class="action-kind ' + (a.tone === "urgent" ? "neg" : a.tone === "warn" ? "cau" : "pos") + '">' +
        esc(a.kind) + "</span></div>" +
        '<div class="action-head">' + esc(a.head) + "</div>" +
        '<div class="action-why">' + a.why + "</div>" +
        '<div class="action-nums"><span class="action-gain pos">' + signed(a.gain) +
        '</span><span class="action-unit">' + esc(a.unit) +
        '</span><span class="action-cost">' + esc(a.cost) + "</span></div>" +
        "</div>"
    )
    .join("");
}

function renderWaivers(ctx) {
  const rows = ctx.waivers.slice(0, 14);
  const head =
    "<thead><tr><th>PLAYER</th><th>POS</th><th class='num'>PROJ</th><th class='num'>GAIN</th>" +
    "<th>REPLACES</th><th class='num'>RIVALS</th><th class='num'>BID</th></tr></thead>";
  const body = rows
    .map(
      (r) =>
        "<tr><td class='name'>" + esc(r.player.name) +
        (r.player.injury ? ' <span class="neg">' + esc(r.player.injury) + "</span>" : "") +
        "</td><td class='dim'>" + esc(r.player.pos) + (r.player.team ? "·" + esc(r.player.team) : "") +
        "</td><td class='num'>" + n1(r.player.proj) +
        "</td><td class='num pos'>" + signed(r.gain) +
        "</td><td class='dim'>" + (r.replaces ? esc(r.replaces.name) : "—") +
        "</td><td class='num dim'>" + r.demand +
        "</td><td class='num'>$" + r.bid + "</td></tr>"
    )
    .join("");
  $("waiverTable").innerHTML = head + "<tbody>" + (body || "<tr><td colspan='7' class='dim'>Nothing on the wire beats your lineup.</td></tr>") + "</tbody>";

  const weeksLeft = ctx.waivers[0]?.weeksLeft ?? 0;
  $("waiverFoot").innerHTML =
    "Bids scale with the gain, divided by how many equivalent alternatives exist and weighted by how many rivals actually need the position. " +
    "RIVALS counts opposing lineups that improve by 3+ points from the same player. " +
    weeksLeft + " weeks remain before the playoffs.";
}

function renderPartners(ctx) {
  const rivals = ctx.teams
    .filter((t) => t.rosterId !== ctx.me.rosterId)
    .sort((a, b) => b.trades - a.trades);
  $("partnersNote").textContent =
    ctx.tradeStats.total + " trades on record, " + ctx.tradeStats.vetoed + " vetoed.";

  $("partners").innerHTML = rivals
    .map((t) => {
      const bits = [t.wins + "–" + t.losses];
      if (t.withMe) bits.push("traded with you " + t.withMe + "×");
      if (t.netFaab > 0) bits.push("sells for cash +$" + t.netFaab);
      else if (t.netFaab < 0) bits.push("buys with cash −$" + Math.abs(t.netFaab));
      bits.push("$" + t.faabLeft);
      const cold = t.tradeRate < 0.2;
      return (
        '<div class="prow"><div class="prow-main"><div class="prow-name' + (cold ? " dim" : "") + '">' +
        esc(t.name) + '</div><div class="prow-sub">' + esc(bits.join(" · ")) +
        (cold ? " · rarely trades" : "") +
        '</div></div><div class="meter' + (cold ? " cold" : "") + '"><i style="width:' +
        Math.round(t.tradeRate * 100) + '%"></i></div><div class="prow-n' + (cold ? " dim" : "") + '">' +
        t.trades + "</div></div>"
      );
    })
    .join("");
}

function renderTrades(ctx) {
  const rows = ctx.trades;
  const head =
    "<thead><tr><th>YOU SEND</th><th>YOU GET</th><th>PARTNER</th>" +
    "<th class='num'>&Delta;PTS</th><th class='num'>VALUE</th><th class='num'>LIKELY</th></tr></thead>";
  const body = rows
    .map((o, i) => {
      const giving =
        o.send.map((p) => esc(p.name)).join(", ") +
        (o.cash ? (o.send.length ? ' <span class="pos">+$' + o.cash + "</span>" : '<span class="pos">$' + o.cash + "</span>") : "");
      return (
        "<tr class='clickable" + (i === SELECTED_TRADE ? " sel" : "") + "' data-i='" + i + "'>" +
        "<td class='dim'>" + (giving || "—") +
        "</td><td class='name'>" + esc(o.target.name) + ' <span class="dim">' + esc(o.target.pos) +
        "</span></td><td class='dim'>" + esc(o.rival.name) +
        " <span class='" + (o.rival.winPct >= 0.5 ? "pos" : "cau") + "'>" + o.rival.wins + "–" + o.rival.losses +
        "</span></td><td class='num pos'>" + signed(o.gain) +
        "</td><td class='num dim'>" + commas(o.targetValue) +
        "</td><td class='num'>" + Math.round(o.accept * 100) + "%</td></tr>"
      );
    })
    .join("");
  $("tradeTable").innerHTML = head + "<tbody>" + (body || "<tr><td colspan='6' class='dim'>No rival bench player improves your lineup.</td></tr>") + "</tbody>";

  for (const tr of $("tradeTable").querySelectorAll("tr.clickable")) {
    tr.addEventListener("click", () => {
      SELECTED_TRADE = Number(tr.dataset.i);
      renderTrades(ctx);
    });
  }
  renderTradeDetail(ctx);
}

function renderTradeDetail(ctx) {
  const o = ctx.trades[SELECTED_TRADE];
  const box = $("tradeDetail");
  if (!o) {
    box.className = "detail";
    box.innerHTML = "";
    return;
  }
  const r = o.rival;
  const biggestCash = ctx.tradeStats.cashDeals[0];
  const reasons = [];
  reasons.push(
    "<strong>" + esc(r.name) + "</strong> have made <strong>" + r.trades +
      "</strong> trades on record, against a league high of " + Math.max(...ctx.teams.map((t) => t.trades)) + "."
  );
  reasons.push(
    esc(o.target.name) + " is <strong>on their bench</strong>, outside their own best lineup. They give up nothing they start."
  );
  const shapeKey = [o.send.length, 1].sort((a, b) => b - a).join("-");
  const shapeCount = ctx.tradeStats.shapes.get(shapeKey) || 0;
  const commonest = ctx.tradeStats.topShapes[0];
  reasons.push(
    "Shape: this is a <strong>" + esc(o.shape) + "</strong>, which this league has done <strong>" +
      shapeCount + "</strong> time" + (shapeCount === 1 ? "" : "s") + " in " + ctx.tradeStats.total + " trades" +
      (commonest ? ". Their most common shape is " + esc(commonest[0].split("-").join("-for-")) + " (" + commonest[1] + "×)" : "") +
      "."
  );
  if (o.cash > 0) {
    const budget = ctx.league.settings?.waiver_budget ?? 0;
    if (budget && r.faabLeft <= budget * CASH_BUDGET_SHARE)
      reasons.push(
        "Cash is in this offer because they are down to <strong class='neg'>$" + r.faabLeft +
          "</strong> of $" + budget + ". They are effectively locked out of the waiver wire, which is the one situation where FAAB genuinely tempts someone."
      );
    else if (r.netFaab >= CASH_SELLER_NET)
      reasons.push(
        "Cash is in this offer because their history is net <strong class='pos'>+$" + r.netFaab +
          " FAAB</strong> received — they have repeatedly sold players for budget."
      );
    if (biggestCash)
      reasons.push("Precedent: the largest cash trade in this league moved <strong>$" + biggestCash.amount + "</strong>, of " + ctx.tradeStats.cashDeals.length + " cash deals in " + ctx.tradeStats.total + " trades.");
  }
  if (r.withMe) reasons.push("You have traded with them <strong>" + r.withMe + "</strong> time" + (r.withMe === 1 ? "" : "s") + " before.");
  reasons.push(
    "They are " + r.wins + "–" + r.losses + " and " +
      ([...ctx.teams].sort((a, b) => b.rosterValue - a.rosterValue).findIndex((t) => t.rosterId === r.rosterId) + 1) +
      " of " + ctx.teams.length + " in roster value."
  );
  const vetoVotes = ctx.league.settings?.veto_votes_needed;
  if (vetoVotes)
    reasons.push(
      "Veto risk: " + vetoVotes + " votes needed, and <strong class='pos'>" + ctx.tradeStats.vetoed +
        " of " + ctx.tradeStats.total + "</strong> trades here have been vetoed."
    );

  const parts = o.parts;
  box.className = "detail on";
  box.innerHTML =
    '<div class="detail-grid">' +
    '<div class="detail-box"><div class="detail-label">YOU SEND</div><div class="detail-fig">' +
    (o.send.map((p) => esc(p.name)).join(", ") || "—") +
    (o.cash ? '<span class="pos"> + $' + o.cash + "</span>" : "") +
    '</div><div class="dim">' + commas(o.paid) + " of value" +
    (o.cash ? " · " + Math.round((o.cash / Math.max(1, ctx.me.faabLeft)) * 100) + "% of your budget" : "") +
    '</div></div>' +
    '<div class="detail-box"><div class="detail-label">YOU GET</div><div class="detail-fig">' +
    esc(o.target.name) + '</div><div class="dim">' + esc(o.target.pos) +
    (o.target.team ? " · " + esc(o.target.team) : "") +
    " · proj " + n1(o.target.proj) + " · value " + commas(o.targetValue) + "</div></div>" +
    '<div class="detail-box"><div class="detail-label">LIKELY TO BE ACCEPTED</div><div class="detail-fig pos">' +
    Math.round(o.accept * 100) + '%</div><div class="score">' +
    '<span class="score-part">activity ' + Math.round(parts.tradeRate * 100) + "%</span>" +
    '<span class="score-part">history ' + Math.round(parts.priorMe * 100) + "%</span>" +
    '<span class="score-part">bench fit ' + Math.round(parts.benchFit * 100) + "%</span>" +
    '<span class="score-part">cash appetite ' + Math.round(parts.cashAppetite * 100) + "%</span>" +
    '<span class="score-part">fairness ' + Math.round(parts.fairness * 100) + "%</span>" +
    '<span class="score-part">shape ' + Math.round((parts.shapeFit || 0) * 100) + "%</span>" +
    "</div></div></div>" +
    '<div class="reasons">' + reasons.map((x) => '<div class="reason">' + x + "</div>").join("") + "</div>" +
    '<button class="btn btn-primary btn-wide" type="button" id="copyOffer">Copy offer text</button>';

  $("copyOffer").addEventListener("click", () => {
    const text =
      "Trade offer\n\nYou get: " + o.send.map((p) => p.name + " (" + p.pos + ")").join(", ") +
      (o.cash ? (o.send.length ? " plus " : "") + "$" + o.cash + " FAAB" : "") +
      "\nI get: " + o.target.name + " (" + o.target.pos + ")";
    navigator.clipboard?.writeText(text).then(
      () => ($("copyOffer").textContent = "Copied"),
      () => ($("copyOffer").textContent = "Copy failed")
    );
  });
}

function renderLineup(ctx) {
  const slots = startingSlots(ctx.league);
  const set = ctx.me.starters || [];
  const head =
    "<thead><tr><th>SLOT</th><th>BEST AVAILABLE</th><th class='num'>PROJ</th><th>CURRENTLY SET</th><th class='num'>&Delta;</th></tr></thead>";
  const body = slots
    .map((slot, i) => {
      const best = ctx.me.lineup.assigned.get(i);
      const cur = set[i] ? ctx.players.get(set[i]) : null;
      const delta = Math.round(((best?.proj || 0) - (cur?.proj || 0)) * 10) / 10;
      const bad = delta > 0.2;
      return (
        "<tr><td class='dim'>" + esc(slot) +
        "</td><td class='name'>" + (best ? esc(best.name) : '<span class="neg">nobody eligible</span>') +
        "</td><td class='num'>" + (best ? n1(best.proj) : "—") +
        "</td><td class='" + (bad ? "neg" : "dim") + "'>" + (cur ? esc(cur.name) : "—") +
        (cur?.injury ? " (" + esc(cur.injury) + ")" : "") +
        "</td><td class='num " + (bad ? "neg" : "dim") + "'>" + (delta > 0.2 ? signed(delta) : "—") + "</td></tr>"
      );
    })
    .join("");
  $("lineupTable").innerHTML = head + "<tbody>" + body + "</tbody>";
}

function renderSurplus(ctx) {
  $("surplus").innerHTML =
    ctx.me.surplus
      .map(
        (p) =>
          '<span class="pill">' + esc(p.name) + ' <span class="dim mono">' +
          commas(ctx.values.get(p.id)?.value || 0) + "</span></span>"
      )
      .join("") || '<span class="dim">Every rostered player is in your best lineup.</span>';
}

function renderRoster(ctx) {
  const rows = ctx.me.ids
    .map((id) => ({ pl: ctx.players.get(id), v: ctx.values.get(id) }))
    .sort((a, b) => (b.v?.value || 0) - (a.v?.value || 0));
  const starting = ctx.me.lineup.used;
  $("rosterNote").textContent =
    ctx.me.ids.length + " players · " + ctx.me.surplus.length + " outside your best lineup · trade values are FantasyCalc redraft for this exact format";
  const head =
    "<thead><tr><th>PLAYER</th><th>POS</th><th class='num'>VALUE</th><th class='num'>30D</th>" +
    "<th class='num'>PROJ</th><th class='num'>SEASON</th><th>STATUS</th></tr></thead>";
  const body = rows
    .map(({ pl, v }) => {
      if (!pl) return "";
      const trend = v?.trend30Day ?? null;
      return (
        "<tr><td class='name'>" + esc(pl.name) +
        "</td><td class='dim'>" + esc(pl.pos) + (pl.team ? "·" + esc(pl.team) : "") +
        "</td><td class='num'>" + (v ? commas(v.value) : "—") +
        "</td><td class='num " + (trend > 0 ? "pos" : trend < 0 ? "neg" : "dim") + "'>" +
        (trend == null ? "—" : (trend > 0 ? "+" : "") + commas(trend)) +
        "</td><td class='num'>" + n1(pl.proj) +
        "</td><td class='num dim'>" + n1(pl.actual) +
        "</td><td>" +
        (pl.injury
          ? '<span class="chip chip-danger">' + esc(pl.injury) + "</span>"
          : starting.has(pl.id)
          ? '<span class="chip chip-accent">starting</span>'
          : '<span class="chip">bench</span>') +
        "</td></tr>"
      );
    })
    .join("");
  $("rosterTable").innerHTML = head + "<tbody>" + body + "</tbody>";
}

function renderHeader(ctx) {
  const { me, league, teams } = ctx;
  $("teamName").innerHTML = esc(me.name);
  const rec = $("recordChip");
  rec.textContent = me.wins + "–" + me.losses + (me.ties ? "–" + me.ties : "");
  rec.className = "chip " + (me.winPct >= 0.5 ? "chip-accent" : "chip-danger");
  rec.hidden = false;

  const ranked = [...teams].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
  const place = ranked.findIndex((t) => t.rosterId === me.rosterId) + 1;
  const st = $("standingChip");
  st.textContent = place + " of " + teams.length;
  st.hidden = false;

  const s = league.scoring_settings || {};
  const bits = [
    esc(league.name),
    "WEEK " + ctx.week,
    teams.length + "-TEAM",
    (league.roster_positions || []).includes("SUPER_FLEX") ? "SUPERFLEX" : "1QB",
    (s.rec ?? 0) + " PPR",
    (s.pass_td ?? 4) + "PT PASS TD",
  ];
  $("leagueMeta").textContent = bits.join(" · ");
  $("stamp").textContent =
    "Loaded " + new Date().toLocaleString() + " · FantasyCalc " + ctx.fcUrl.split("?")[1];
}

async function boot(leagueId) {
  $("fatal").hidden = true;
  $("app").hidden = true;
  $("boot").style.display = "";
  try {
    const raw = await loadAll(leagueId);
    const scoring = raw.league.scoring_settings || {};
    const players = buildPlayerIndex(raw.proj, raw.seasonStats, scoring);
    const values = new Map();
    for (const row of raw.values) {
      const sid = row.player?.sleeperId;
      if (sid) values.set(String(sid), row);
    }

    const myUser = raw.users.find(
      (u) => (u.display_name || "").toLowerCase() === MY_USERNAME.toLowerCase()
    );
    const myRoster = raw.rosters.find((r) => r.owner_id === myUser?.user_id) || raw.rosters[0];
    const tradeStats = sweepTrades(raw.transactions, myRoster?.roster_id);

    const ctx = { ...raw, players, values, scoring, tradeStats };
    ctx.teams = teamProfile(ctx);
    ctx.me = ctx.teams.find((t) => t.rosterId === myRoster.roster_id);
    ctx.me.starters = (myRoster.starters || []).slice();

    ctx.issues = lineupIssues(ctx);
    ctx.waivers = waiverBoard(ctx);
    ctx.trades = tradeBoard(ctx);
    ctx.actions = buildActions(ctx);

    STATE = ctx;
    SELECTED_TRADE = 0;

    renderHeader(ctx);
    renderKpis(ctx);
    renderActions(ctx);
    renderWaivers(ctx);
    renderPartners(ctx);
    renderTrades(ctx);
    renderLineup(ctx);
    renderSurplus(ctx);
    renderRoster(ctx);

    progress(100, "Ready");
    $("boot").style.display = "none";
    $("app").hidden = false;
  } catch (err) {
    $("boot").style.display = "none";
    $("fatalMsg").textContent = err.message || String(err);
    $("fatal").hidden = false;
  }
}

function currentLeagueId() {
  const fromUrl = new URLSearchParams(location.search).get("league");
  return (fromUrl || localStorage.getItem("leagueId") || DEFAULT_LEAGUE).trim();
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch (e) {}
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  $("themeBtn").addEventListener("click", () => {
    const now = document.documentElement.dataset.theme;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = now ? (now === "dark" ? "light" : "dark") : dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (e) {}
  });
}

function init() {
  initTheme();
  const id = currentLeagueId();
  $("leagueInput").value = id;
  $("reloadBtn").addEventListener("click", () => {
    const next = $("leagueInput").value.trim();
    if (!/^\d{6,25}$/.test(next)) {
      $("leagueInput").focus();
      return;
    }
    try {
      localStorage.setItem("leagueId", next);
    } catch (e) {}
    boot(next);
  });
  $("fatalRetry").addEventListener("click", () => boot($("leagueInput").value.trim() || DEFAULT_LEAGUE));
  $("leagueInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("reloadBtn").click();
  });
  boot(id);
}

init();
