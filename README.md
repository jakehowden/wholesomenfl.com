# Wholesome NFL GM

A fantasy portal for one Sleeper league (10-team redraft superflex, 6 pt pass TD).
It covers lineups, waivers, FAAB bids, trades and playoff odds, all scored against the
league's own settings rather than anyone's defaults.

Live at **https://jakehowden.github.io/wholesomenfl.com/**

## Architecture

```
GitHub Actions (cron)          web/public/data/*.json           GitHub Pages
python -m pipeline.run  ───▶  meta, players, league,     ───▶  Vite + React SPA (web/)
(Sleeper, nflverse,            outlooks, private/briefing.enc
 FantasyCalc, Claude)
```

- `pipeline/` is a Python 3.12 package. It fetches Sleeper, nflverse/ffopportunity and
  FantasyCalc data, re-scores every stat with the league's 51 scoring keys, runs the value
  model and league analytics, optionally asks Claude for player outlooks and a weekly GM
  briefing, and writes JSON into `web/public/data/`. Snapshots go to `data/history/`.
- `web/` is a static Vite + React + TypeScript app. It reads the JSON, pulls live
  Sleeper rosters in the browser, and runs the lineup, waiver and trade engines client side.
- The briefing is encrypted (AES-GCM-256, key from PBKDF2-SHA256 with 250k iterations)
  and decrypted in the browser with a passphrase, so it can sit on a public site.

The data contract lives in `pipeline/schema.py` and `web/src/types/data.ts`.

## Value model

- Weekly projections blend market projections (85%) with recent expected fantasy points
  (15%, last 4 weeks), both scored with league settings.
- Each position is calibrated against its startable pool, then adjusted for availability
  (injury status, IR and byes).
- `ros` is weighted points above replacement (the mean of the 3 best free agents at the
  position) for the rest of the season. Playoff weeks 15–17 count 1.5×.
- Signals: usage trend, luck (points minus xFP), market gap against FantasyCalc, and a
  breakout radar. Together they set a BUY / SELL / HOLD tag with reasons.
- League analytics: optimal-lineup solver, all-play records, ROS and positional
  strength, a 10,000-run playoff simulation and trade grades.

## Run locally

```sh
pip install -r requirements.txt
python -m pipeline.run --no-llm      # writes web/public/data
cd web && npm install && npm run dev
```

`python -m pytest pipeline -q` and `cd web && npx vitest run` run the tests.

## Deploy

`.github/workflows/build.yml` refreshes data daily at 10:00 UTC without Claude. On Tuesday
and Saturday at 14:00 UTC it runs with Claude. It commits any changed data, then builds
`web/` and deploys it to Pages. Pushes to `web/**` on main only redeploy. Manual runs
take an `llm` input.

Setup:

- Repository secrets: `ANTHROPIC_API_KEY` and `BRIEFING_PASSPHRASE`.
- Settings → Pages → Source: **GitHub Actions**.
