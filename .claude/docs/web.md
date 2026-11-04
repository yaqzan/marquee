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
`#/paths[/<YYYY-MM-DD>]` (every option for a trip day, see below) ·
`#/plan/<id>` (timeline: films, free-time gaps labelled lunch/dinner by overlap with 11:30-14:30 and
16:30-20:00) · `#/films` (filters: trip days / all / one day, title search, genre; sort: A to Z, highest score with
Unrated films always last, earliest showtime within the chosen days; filters and sort persist while the tab is open) · `#/film/<ST id>` ·
`#/schedule[/<YYYY-MM-DD>]` (one day, grouped by building).

## Every option (`#/paths/<day>`, `pathsView` in marquee.js)

A true time chart (owner decisions, 2026-11-04). **Hours run down the page at 1.5 px a minute; a film is a block whose top
is its start and whose height is its running time** (never under 104 px so the poster and buttons stay usable); films
that overlap sit side by side in lanes. One block per session. A line leaves the bottom of a film (where it ends) and
arrives at the top of a film that starts later, with a dot at each end, and is only drawn for consecutive films of a live
lineup. This replaced rows grouped by start time, which put a film that starts at 3:30 between a 2:50 film and the 6:20 film
its line really went to, so the line looked like it hit the wrong film. Never lay films out by start time alone again.
Tapping a film lights up its own lines (blue) and fades the rest. Starting at 3 pm = tap the 3 pm label or drag the slider:
lineups with a film before then drop out, earlier time is shaded and a dashed line marks it. Picking moves the cursor to
when the pick ends; picks narrow the plans to those containing all of them. Merges are films with several lines arriving.
`/api/paths?day=` (trip days only) returns every valid lineup (planner rules: gaps, meals, 1 am home, no repeat) best
first, the sessions in them, and `skipped`: the day's sessions in no plan with the reason (listed under the chart).
It starts from the best `[plan] options_default` lineups (30); chips widen it to `options_more` or everything.
Tiles: poster as the block, score badge (hue red to green; films at `[display] glow_percentile` of rated films glow, the
server's `glow` flag; no real score shows a muted dash), title and times on a scrim, tap or hover for the source badges,
Pick and Film page. `main.wide` lifts the 40rem cap on this route only; the chart scrolls sideways on a phone.
Lines are an SVG measured from the DOM in the browser (`edges()`), so the stub-DOM smoke test cannot draw them. It
checks instead the data behind them: tile top and height against start and running time, no overlap in a lane, and every
pair in the canvas `data-edges` against the walking-gap rule, for all four trip days. Check the picture by eye after
layout changes (a paths check in a real browser: each `.pedges path` starts at tile `a`'s bottom and ends at tile `b`'s top).

## Score and why

The film page shows a score card built from `/api/films/<id>` -> `why`: the score (0-100), a coverage label
(Festival tags only < 15% confidence, Some critic scores < 50%, Well covered), critics and audiences with vote
counts (sources that barely count carry a "barely counts" badge), festival picks with their points, and the
people behind any taste nudge. Plan timelines show `Score N` plus a one-line reason under each film (`reasonLine`
in marquee.js; low-weight sources are left out). Film tiles (the index) show the score chip plus the reason line (`tileScore`): critic scores with a real
weight, festival tags, the taste people. Confidence under 0.15 gets a dashed chip and "Festival tags only: ..."
so a tags-only 55 is never presented as a verdict; a film with no critic scores, no tags and no taste match shows
"Unrated" instead of the default 50 (134 of 236 films today). The list API carries `why` for every film (~250 KB). The server builds the breakdown (`serve.score_view`) from
`film_score.parts`; the UI never recomputes a score. The film page also shows director and top-billed cast.

## Posters and badges

- **Posters**: WIFF's own poster per film (the Veezi image in the schedule feed, `film.poster_url`). The originals
  run up to 4 MB, so `marquee posters` downloads each once, shrinks it to a 360 px progressive JPEG with Pillow
  (~35 KB; 8.4 MB for all 236) into `marquee/state/posters/` (gitignored), and the server serves it at
  `/poster/<film id>?v=<hash>` with a week of cache (the hash busts it). Walk once, refetch only when the feed's
  URL changes; a 403/429 stops the run. Without Pillow the 125 px standard variant is stored instead. A missing
  poster renders a lettered paper placeholder, never a broken image. Shown on film cards, the film page and
  plan timelines.
- **Badges** (owner decision, 2026-11-04: one per source, each in that source's own style, side by side like Rotten
  Tomatoes' critics and audience pair): Rotten Tomatoes critics (tomato, fresh at `[display] fresh_at`), Metacritic (square
  metascore tile in its green / yellow / red bands), IMDb (yellow tag with a star), TMDB (percent ring in TMDB's
  green / yellow / red). Original shapes and icons in `web/icons/`, not the companies' logos. the film APIs carry `ratings`
  per film: `{source, name, kind, value, score, votes, band}` in a fixed order; the server sets the good / mixed / bad `band`
  (`serve._band`, thresholds under `[display]`) and drops IMDb under 100 votes and TMDB under 20. The UI never picks a colour
  from a number. **RT's own audience score (Popcornmeter) has no open source** (OMDb returns N/A; scraping RT is off the
  table), so the audience badges are IMDb and TMDB and say so; never present them as RT's. Shown compact (icon and number)
  on film cards, plan timelines and every-option tiles, big with a source label on the film page.
- Footer credits OMDb and TMDB (TMDB's attribution terms) and says the posters are the festival's own.

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
