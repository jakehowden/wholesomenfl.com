---
description: Weekly GM run — research player outlooks, write the encrypted briefing, publish to the site
argument-hint: "[cap, default 30]"
---

You are the general manager's assistant for my Sleeper fantasy team (JSH96). This command replaces paid API
calls: you do the research and writing yourself on my Claude plan. Work from the repo root.

## 1. Fresh data
- `git pull --rebase` (the daily Action commits data).
- Read `web/public/data/meta.json`. If `generated_at` is not today (UTC), run `python -m pipeline.run`.
- Check `BRIEFING_PASSPHRASE` is set (`python -c "import os;print(bool(os.environ.get('BRIEFING_PASSPHRASE')))"`).
  If it is not, stop and tell me to set it in my shell and restart Claude Code. Never print, echo or write the passphrase.

## 2. Scope
Run `python -m pipeline.gm prep --cap N` where N is "$ARGUMENTS", or 30 if that is empty. Read `.cache/gm/context.json`:
`league_facts`, `outlook_players` (who needs an outlook, with our model's numbers) and `briefing_input`.

## 3. Player outlooks
Split `outlook_players` into batches of about 10 and research each batch in a parallel general-purpose subagent
(one Agent call per batch, all in one message). Give each subagent `league_facts`, its players' JSON, and these
instructions:

> For each player, run at most 2 web searches for recent (last ~10 days) analyst and news coverage: injuries,
> role/snap changes, depth chart, coach quotes, upcoming schedule. Then write a rest-of-season outlook for this
> league's scoring. `proj_by_week` is our calibrated league-scoring projection; `ros_par` is weighted points above
> replacement (playoff weeks 15–17 up-weighted); `tag` is our model's call. Write JSON to
> `.cache/gm/outlooks.part<N>.json` shaped `{player_id: {"signal": "BUY"|"SELL"|"HOLD", "summary": "2-4 concrete
> sentences on what the news adds beyond the numbers (say why if you disagree with the model tag)", "risks":
> ["1-4 short specific risks"], "sources": [{"title": "...", "url": "..."}]}}`. Only cite URLs you actually read.
> Reply with just the file path and player count.

If `outlook_players` is empty, skip this step.

## 4. Briefing
Using `briefing_input` plus the new outlooks, write `.cache/gm/briefing.json`:
`{"situation": "...", "moves": [{"kind": "trade"|"waiver"|"lineup"|"hold", "title": "...", "detail": "...",
"player_ids": ["..."]}], "reasoning": "..."}`.
- Goal: the playoff push. Maximise playoff odds and week 15–17 strength.
- Give 3–5 concrete, prioritised moves. Refer to players by name and list their Sleeper ids in `player_ids`.
- Trades must look fair on FantasyCalc (`fc_value`, received within 0.8–1.1× of sent) while gaining us ROS.
  FAAB is never part of a trade. Waiver bids come out of `faab_left`. Trade deadline is week 11.
- Be blunt about the situation (record, playoff odds, gap to the 6th seed).

## 5. Publish
- `python -m pipeline.gm publish` (merges outlooks, encrypts the briefing, deletes the plaintext, stamps meta).
- Confirm `.cache/gm/briefing.json` no longer exists.
- `git add web/public/data data/history` and commit `gm: wk<week> outlooks + briefing`, then `git push`.
  The push redeploys the site.

Finish with a short summary in chat: the top 3 moves and how many outlooks were written. The briefing is private,
so keep the chat summary to the moves.
