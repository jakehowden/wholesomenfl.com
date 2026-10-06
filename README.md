# Wholesome NFL GM

Trade, waiver and FAAB decisions for a Sleeper superflex league, scored against the
league's own settings rather than anyone's defaults.

Live at **https://jakehowden.github.io/wholesomenfl.com/**

Static page, no backend, no API keys. Both the Sleeper and FantasyCalc APIs send
`Access-Control-Allow-Origin: *`, so everything runs in the browser and refreshes on
each load.

## Why it disagrees with public rankings

The league scores **6 points per passing touchdown**, not the standard 4, plus
distance-based field goals and `def_3_and_out` / `def_4_and_stop` for defences.
Sleeper's prebuilt `pts_half_ppr` assumes none of that, so every public number is
wrong here — quarterbacks by roughly ten points a week. The app recomputes every
projection from raw stats against all 51 of the league's scoring keys.

## What it does

**Lineup check** solves the optimal legal lineup by slot restrictiveness (dedicated
slots first, then FLEX, then SUPER_FLEX) and flags any slot you are losing by default.

**Waiver board** diffs every unrostered player against that optimal lineup, so a
player only scores if he would actually start. Bids scale with the gain, divided by
how many equivalent alternatives exist, and weighted by how many rival lineups
improve by 3+ points from the same player — a target nobody else needs should be
cheap, and the model says so.

**Trade finder** only targets players sitting on a rival's bench, outside that rival's
own best lineup, so no offer asks anyone to weaken what they start. Packages are
players-for-players by default. Cash is added only where the league's own history
says it works: a manager down to a sliver of their budget, or one whose trades are
net-positive FAAB received.

**Acceptance scoring** is a transparent blend, shown broken out per offer: how often
that manager trades, whether they have traded with you before, bench fit, cash
appetite, and value fairness. It is swept from every transaction in the current and
previous season.

## Configuration

The league ID is read from `?league=<id>`, then `localStorage`, then the default at
the top of `app.js`. `MY_USERNAME` there decides which roster is "yours".

## Design

Tokens are Atlas's "Mission Control" palette — Geist and Geist Mono, one green accent,
flat cards separated by hairlines, one shadow reserved for overlays. Light and dark
both ship; the toggle persists.
