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
16:30-20:00) · `#/films` (filters: trip days / all / one day, title search, genre; sort: A to Z, highest score with
Unrated films always last, earliest showtime within the chosen days; filters and sort persist while the tab is open) · `#/film/<ST id>` ·
`#/schedule[/<YYYY-MM-DD>]` (one day, grouped by building).

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
- **Badges**: Rotten Tomatoes style, original icons in `web/icons/` (tomato-fresh, tomato-rotten, popcorn-full,
  popcorn-spilled; not RT's artwork). Critics = the RT percent from OMDb. **Audience = IMDb (100+ votes), else
  TMDB (20+), and the label says which**: RT's own audience score (Popcornmeter) has no open source (OMDb returns
  N/A; scraping RT is off the table), so never present this as RT's. Fresh = at or above `[display] fresh_at`
  (60); the server sets the `fresh` flag, the UI only picks the icon. 54 films have RT, 50 an audience score.
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
