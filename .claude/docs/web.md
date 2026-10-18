# Web UI

Static files in `web/`, no build step, no framework, no dependencies: `index.html` (shell), `marquee.css`,
`marquee.js`. Phone-first (single column, max 40rem), a fixed tab bar: Plans, Films, Schedule. Read-only.

## Look (owner decision, 2026-10-18)

Playbill header (cream paper, double rule, "the MARQUEE", festival name from `/api/festival`) plus ticket
cards (cream stub with notches and a dashed tear line) as the interface component for plans and trip days.
Always light. The dark "theatre" theme was mocked and set aside; the owner wants to revisit logo styles later.
Palette and fonts are CSS variables at the top of `marquee.css`: paper `#f3e9d2`, ink `#241b15`, oxblood
`#7a2f22`, gold `#a8741a` for the top pick and trip-day accents; Georgia for titles, system sans for data.

## Routes (hash router in marquee.js)

`#/plans` (ranked plan tickets; until plans exist, the four trip days with screening counts) ·
`#/plan/<id>` (timeline: films, free-time gaps labelled lunch/dinner by overlap with 11:30-14:30 and
16:30-20:00) · `#/films` (filters: trip days / all / one day, title search, genre) · `#/film/<ST id>` ·
`#/schedule[/<YYYY-MM-DD>]` (one day, grouped by building).

## Rules

- **Data goes in as DOM text only** (`h()` builds elements with `createTextNode`; no innerHTML on data).
- WIFF titles are ALL CAPS: `titleCase()` fixes case, moves a trailing ", THE" to the front, keeps
  acronyms from `KEEP`. Add new acronyms there. Numeric tag labels (unlabelled Veezi codes) are hidden.
- Times are local festival times from the database (`starts_at`), formatted by hand, never through `Date`
  parsing of the string (time zone shifts).
- Page copy: no em-dashes, no "X, not Y", plain sentences.
- Cloudflare caches web/ files ~4 h despite `no-cache`: bump the `?v=` on the CSS and JS URLs in
  `index.html` whenever either changes.

## Verifying

`py -3.11 ops/web_smoke.py` (needs node): serves a scratch copy of the database with a seeded plan on
:5099 and runs the real `marquee.js` over a stub DOM through every route (`ops/web_smoke.mjs`). It does
not check layout; visual QA is the owner's. Pinned to the Oct 2026 schedule (see `FILMS` in the .py).
It caught a nested-array `replaceChildren` bug on its first run.
