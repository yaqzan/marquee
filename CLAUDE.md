# Marquee

Curates festival day trips: browse a festival's films and sessions, and (next) the ranked weekend
day-plan packages (best 3-film lineup per day, timeline, cost, justification). First festival: the
Windsor International Film Festival (WIFF) 2026, Oct 29 - Nov 8, as a day trip by car. Built to
take other festivals later. Read-only public site, no auth, no input surface.

**Public repo (github.com/yaqzan/marquee).** The owner's instance is https://marquee.yaqzan.dev.

- Gitignored: `marquee/state/` (database, raw schedule snapshots), `config.local.toml`,
  `ops/cloudflared-config.yml` (tunnel UUID), `ops/windows/logs/`. Never commit those, or a vault path,
  taste/rating data, API key or machine path in tracked files.

## Commands

- `py -3.11 -m marquee fetch [--force]`: pull the WIFF schedule (2 requests), save the raw snapshot, import.
  Refuses inside `[fetch] min_interval_minutes` unless `--force`. Run it when you want fresh data.
- `py -3.11 -m marquee import [file]`: re-import a saved snapshot (newest by default), no network.
- `py -3.11 -m marquee show`: counts per day and venue, last fetch.
- `py -3.11 -m marquee serve`: site + API on 127.0.0.1:5007.
- `C:\Development\server.ps1 start|status|logs|restart -Service marquee`: server + tunnel.
- `ops\windows\install-tasks.ps1 -Controller C:\Development\server.ps1`: 5-min watchdog.
- `py -3.11 -m unittest`: tests.

## Invariants

- **Only WIFF's own public schedule action.** Never fetch Veezi's `/purchase/*` pages (Cloudflare-gated;
  not ours to bypass). No scraping of Letterboxd / Rotten Tomatoes (no open API); critic data comes from
  OMDb / TMDB when enrichment lands.
- **Every tunable lives in `marquee/config.toml`** (festival, fetch guard, candidate days, venue ->
  building, product filter). Code never hardcodes a festival, date or venue.
- The database is the only thing the site reads; the server opens it read-only. A failed fetch keeps
  the previous data and is logged in `fetch_log`.
- Imports never delete: a film/session the feed stops listing gets `removed_at`; every difference lands
  in `change`. A payload under half the size of what we hold withdraws nothing.
- Human judgement (tier, rating, hand edits) is never overwritten by a pipeline.
- LLM steps (later) dispatch a Claude Code subagent from prompt FILES; no API key exists on this box.
- Page copy (web/): no em-dashes, no "X, not Y", plain sentences. Data goes in via textContent only.

## Docs

Data source, schema, WIFF payload traps: `.claude/docs/data.md` · hosting, tunnel, tasks: `.claude/docs/ops.md` ·
kanban: vault `Engineering Wiki/Projects/Marquee/`.
