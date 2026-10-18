# Data

## Source (WIFF)

The schedule panel on `/festival/how-to-wiff/?open-film-schedule=true` POSTs `get_film_schedule_films` to
`/wp-admin/admin-ajax.php`. The nonce is printed in the page HTML (`data-nonce` on the
`festival-schedule-` element). `session_date=all-festival-films` returns everything in one response
(2026: 239 rows = 236 films + 3 ticket products, 302 sessions = 299 + 3). `marquee/wiff.py` makes exactly
two requests per fetch (page, then action). Veezi's public `/sessions/` page lists the same sessions
without venue or runtime; useful only as a cross-check.

Traps (all handled in `wiff.py`, covered by `tests/test_wiff.py`):
- `resolved_time` holds the DATE ("Sat Oct 31") and `resolved_date` the TIME ("9:00 am"). Swapped.
- Asking per date is unreliable (Nov 1 returned every day). Never ask per date.
- Passes and ticket packs ride in the same feed on fake screens (PASSHOLDER ...). Skipped by
  `[products]` (genre + title regex), counted in the import result.
- `Attributes` are Veezi codes. 27 resolve from the page's Categories/Culture dropdowns into `tag`;
  33 codes (e.g. 0000000007 on 70 films, 0000000161 on 150, 273-279) have no public label and stay raw.
  Genre, country and language filters are plain text, not codes.
- The user's "232 films" is WIFF's marketing number; the feed holds 236 films (12 are genre "Alternative Content").

## Tables (marquee/store.py)

`festival`, `venue` (screen -> building via `[venues]`), `tag`, `film`, `film_tag`, `session` (id = Veezi
session id, `starts_at` local ISO), `fetch_log`, `change`, `plan` + `plan_item` (day-plan packages, empty
until the planner exists). Soft removal via `removed_at`; first import logs a single `baseline` change.
Raw payloads are kept by content hash in `marquee/state/raw/` so any import can be replayed.

## API (read-only, serve.py)

`/api/health` (always 200), `/api/festival` (days with session counts, venues), `/api/films` (filters:
`q`, `genre`, `country`, `tag`, `day`), `/api/films/<id>`, `/api/sessions?day=`, `/api/plans[?day=]`.

## Scoring (marquee/score.py, config [score])

`score = (sum(w_i * s_i) + prior_weight * P) / (sum(w_i) + prior_weight)`, P = 50 + pedigree points (WIFF category
tags: Cannes, Vincent's Picks, Festival Darlings, Oscar Submissions, Pre-Release, Famous Faces, Prize in Canadian
Film, Premium). Sources (Metacritic, RT, IMDb, TMDB) carry configured weights scaled by votes/(votes+half_votes).
No critic data = the pedigree prior alone, `confidence` 0, and the plan summary says "ranked on festival tags
only". Results are in `film_score` (rebuilt by `marquee plan`).

**Backtest finding (2026-10-18, owner's 211 movies + 21 docs in Arbiter, target = Arbiter Elo):** Plex critic
score Spearman 0.10 (n=213), audience 0.07, genre/country/decade taste model (leave-one-out) -0.03, and adding
it to the critic score only lowered the fit. Neither critics nor coarse taste features are validated on this
owner, so `taste_nudge_max` is 0 and nothing unvalidated gets weight. Retry the taste model with TMDB directors
and keywords once enrichment has run (gate: `taste_min_rho`). Caveat: Elo comes from few rounds and seeded
tiers, and the owner watched a pre-filtered set, so range restriction shrinks any correlation.

## Planner (marquee/planner.py, config [plan])

Exhaustive search (depth-first, films in start order, ~30 sessions a day) for the best 3-film lineup per day.
Valid = walking buffers (5 min inside a building, 15 between), first start >= 09:00, last end <= 22:45 (home by
1 am after a 2 h drive), runtime <= 8 h, and a 60 min free block inside both the lunch (11:30-14:30) and dinner
(16:30-20:00) windows. Lineup score = mean film score - 6 * mean pairwise similarity (same genre, shared country).
Cost: $19 single, $40 premium (tag 0000000115), premium 3-pack $99 only when it beats three $40s. Plans are
derived: `marquee plan` deletes and rewrites `plan` / `plan_item`. Only the closer *The Debut* (Sun Nov 8, 6 pm)
is premium on a trip day. All sessions are "Open" in the feed, so sold-out is unknown.

## Enrichment (marquee/enrich.py, config [enrich])

`marquee enrich` needs `[keys] tmdb`/`omdb` in `config.local.toml` (template: `config.local.example.toml`).
TMDB title search, candidates >= 2024, matched on runtime (+/- 3 min) since WIFF has no year; a lone exact title
is a weaker 'title' match; else 'none' (retried after 7 days). Stores directors, imdb id, TMDB score, then OMDb
for Metacritic / RT / IMDb under its own daily budget (900). Walks once, then only new films. A 429 or rejected
key stops the run. Written against the documented API shapes and tested with fake responses only: the first
real run (after the owner adds keys) is the live check; read its unmatched list.
