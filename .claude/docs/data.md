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

## Planned (not built)

Enrichment (TMDB, OMDb), taste profile (vault film stars + live Arbiter tiers), critic/pedigree-led score
with a bounded taste nudge sized by backtest on the owner's rated films, lineup optimizer (brute force
over ~28 sessions/day), the browse UI. Constraints agreed: home by 1am (last film ends ~10:45pm), 15 min
between buildings, 60+ min lunch and dinner gaps, premium screenings $40, candidate days Oct 31, Nov 1, Nov 7, Nov 8.
