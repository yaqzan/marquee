// Stub-DOM smoke test of web/marquee.js: every route against a server on BASE. Run via ops/web_smoke.py,
// which serves a scratch database with a seeded plan. Pinned to the Oct 2026 WIFF schedule.
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5099';
class TextN { constructor(t){ this.data = t; } }
class El {
  constructor(tag){ this.tag = tag; this.children = []; this.attrs = {}; this.ls = {}; this._cls = new Set(); this.dataset = {}; this.value = ''; }
  get className(){ return [...this._cls].join(' '); }
  set className(v){ this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList(){ const s = this._cls; return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, f) => { const on = f === undefined ? !s.has(c) : f; on ? s.add(c) : s.delete(c); return on; }, contains: c => s.has(c) }; }
  setAttribute(k, v){ this.attrs[k] = v; if (k === 'value') this.value = v; }
  addEventListener(t, fn){ (this.ls[t] = this.ls[t] || []).push(fn); }
  appendChild(c){ this.children.push(c); return c; }
  replaceChildren(...k){ this.children = k; }
  set textContent(t){ this.children = [new TextN(t)]; }
  get textContent(){ return this.text(); }
  text(){ return this.children.map(c => c instanceof TextN ? c.data : c.text()).join(' '); }
  find(pred, out = []){ for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.find(pred, out); } return out; }
}
const app = new El('main'), fest = new El('p');
const winLs = {};
globalThis.document = { getElementById: id => id === 'app' ? app : fest, createElement: t => new El(t), createTextNode: t => new TextN(t), querySelectorAll: () => [] };
globalThis.location = { hash: '' };
globalThis.window = { addEventListener: (t, f) => { winLs[t] = f; }, scrollTo(){} };
const realFetch = fetch;
globalThis.fetch = (p, o) => realFetch(BASE + p, o);
const errors = [];
process.on('unhandledRejection', e => errors.push('unhandled: ' + e));

new Function(fs.readFileSync(new URL('../web/marquee.js', import.meta.url), 'utf8'))();

async function go(hash){
  location.hash = hash;
  await winLs.hashchange();
  return app.text();
}
const nPlans = (txt, dflt) => +((/(\d+) plans? still possible/.exec(txt) || /out of (\d+) you could make/.exec(txt) || [0, dflt])[1]);
function check(name, cond, extra = ''){ console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)); if (!cond) process.exitCode = 1; }

await new Promise(r => setTimeout(r, 600));
check('festival name in header', fest.text().includes('Windsor International Film Festival'), fest.text());

let t = '';
const planId = (await (await fetch('/api/plans')).json()).plans[0].id;
t = await go('#/plan/' + planId);
check('plan detail: times', t.includes('9:00 am') && t.includes('10:28 am') && t.includes('1:00 pm') && t.includes('6:25 pm') && t.includes('8:51 pm'), t);
check('plan detail: lunch + dinner gaps', t.includes('2 h 32 min free: lunch') && t.includes('3 h 25 min free: dinner'), t);
check('plan detail: summary', t.includes('Test plan: three films'), t);

t = await go('#/films');
check('films: default trip days list', /\d+ films/.test(t) && t.includes('Trip days'), t.slice(0, 200));
const n = +t.match(/(\d+) films/)[1];
check('films: trip-day count plausible (1..236)', n > 20 && n < 236, String(n));
check('films: no ALL CAPS titles leaked', !/\b[A-Z]{6,}\b/.test(app.find(e => e.tag === 'h3').map(e => e.text()).join(' ')), '');
check('films: article moved ("Siege of Paradise" -> "The Siege of Paradise")', !t.includes('Siege Of Paradise, The'), '');

t = await go('#/film/ST00004238');
check('film detail: title, runtime, showtime, venue', t.includes('Neverman') && t.includes('93 min') && t.includes('Sat Oct 31') && t.includes('9:00 am') && t.includes('Armouries - Sheehan Hall'), t);
check('film detail: trip day badge', t.includes('trip day'), t);
check('film detail: no raw numeric tag', !/\b0000000\d+\b/.test(t), t);

t = await go('#/schedule');
check('schedule: defaults to first trip day w/ 3 buildings', t.includes('Capitol Theatre') && t.includes('Armouries') && t.includes('Chrysler Theatre'), t.slice(0, 200));
t = await go('#/schedule/2026-11-07');
check('schedule 11-07: 26 slots', app.find(e => e.className === 'slot').length === 26, String(app.find(e => e.className === 'slot').length));
check('schedule: end time math (Antidiva 9:00 + 89 = 10:29 am)', t.includes('to 10:29 am'), t.slice(0, 300));

t = await go('#/plan/999');
check('plan missing: friendly message', t.includes('That plan is gone'), t);
t = await go('#/film/ST1');
check('unknown film: friendly error, no crash', t.includes("Couldn't load that"), t);
t = await go('#/nonsense');
check('unknown route redirects to plans', location.hash === '#/plans', location.hash);

check('no unhandled errors', errors.length === 0, errors.join(' | '));
await go('#/films');
const titles = app.find(e => e.tag === 'h3').map(e => (e.children[0] && e.children[0].text ? e.children[0].text() : e.text()));
check('title case: "The Siege of Paradise"', titles.includes('The Siege of Paradise'), titles.filter(x => /siege/i.test(x)).join('|'));
check('title case: "Brunello: The Gracious Visionary"', titles.includes('Brunello: The Gracious Visionary'), titles.filter(x => /brunello/i.test(x)).join('|'));
check('title case: "2026 WIFF Local Shorts 6"', titles.includes('2026 WIFF Local Shorts 6'), titles.filter(x => /shorts/i.test(x)).join('|'));
console.log('sample titles:', titles.filter(x => /'|’|:|-/.test(x)).slice(0, 8).join(' | '));

// ---- score and reasons
const allFilms = (await (await fetch('/api/films')).json()).films;
const covered = allFilms.filter(f => f.confidence > 0.6)[0];
t = await go('#/film/' + covered.id);
check('film page: score card with coverage and confidence', t.includes('Well covered') && /Confidence \d+%/.test(t), t.slice(0, 400));
check('film page: critics section lists named sources', t.includes('Critics and audiences') && /(Rotten Tomatoes|Metacritic|IMDb)/.test(t), t.slice(0, 400));
check('film page: directed by line', t.includes('Directed by'), t.slice(0, 300));
const pt = allFilms.find(f => f.title === 'PAPER TIGER');
t = await go('#/film/' + pt.id);
check('film page: taste section names the people', t.includes('Your taste') && t.includes('Miles Teller') && t.includes('Festival picks'), t);
check('film page: no raw uppercase tag leaked', !t.includes("VINCENT'S PICKS"), t);
const thin = allFilms.find(f => f.confidence != null && f.confidence < 0.15);
t = await go('#/film/' + thin.id);
check('film page: thin-data film says festival tags only', t.includes('Festival tags only') || t.includes('No critic scores yet'), t.slice(0, 300));
await go('#/films');
check('films list: score chips only on films with data', app.find(e => e.className === 'scorechip').length > 5, String(app.find(e => e.className === 'scorechip').length));
t = await go('#/plan/' + planId);
check('plan timeline: score and reasons under each film', (t.match(/Score \d+/g) || []).length === 3, t);

// ---- posters and badges
await go('#/films');
const posterImgs = app.find(e => e.tag === 'img' && /(^| )poster( |$)/.test(e.className));
check('films list: poster thumbnails served from /poster/', posterImgs.length > 10 && posterImgs.every(i => i.attrs.src.startsWith('/poster/')), String(posterImgs.length));
const rtOf = f => f.ratings.find(r => r.source === 'rt');
const withBoth = allFilms.find(f => rtOf(f) && f.ratings.length >= 3) || allFilms.find(f => rtOf(f));
check('API: ratings come one per source, in a fixed order, with a band', allFilms.every(f => f.ratings.every(r => ['good', 'mixed', 'bad'].includes(r.band)) &&
  f.ratings.map(r => ['rt', 'metacritic', 'imdb', 'tmdb'].indexOf(r.source)).every((x, i, a) => x >= 0 && (i === 0 || a[i - 1] < x))), '');
check('API: IMDb and TMDB only appear with enough votes', allFilms.every(f => f.ratings.every(r => r.source === 'imdb' ? r.votes >= 100 : r.source === 'tmdb' ? r.votes >= 20 : true)), '');
t = await go('#/film/' + withBoth.id);
const bdg = () => app.find(e => /(^| )rb( |$)/.test(e.className));
check('film page: one badge per source, side by side', bdg().length === withBoth.ratings.length && bdg().length >= 1, bdg().map(e => e.className).join('|'));
check('film page: Rotten Tomatoes badge uses the tomato for its band', app.find(e => e.tag === 'img' && /tomato-/.test(e.attrs.src || '')).every(i => i.attrs.src.includes(rtOf(withBoth).band === 'good' ? 'tomato-fresh' : 'tomato-rotten')), '');
check('film page: badges are labelled with their source', withBoth.ratings.every(r => t.includes(r.name)), t.slice(0, 500));
const other = allFilms.find(f => f.ratings.some(r => r.source === 'metacritic'));
if (other) {
  t = await go('#/film/' + other.id);
  const mc = other.ratings.find(r => r.source === 'metacritic');
  check('film page: Metacritic is a coloured tile with the metascore', app.find(e => /(^| )rb-mc( |$)/.test(e.className)).some(e => e.className.includes(mc.band) && e.text().trim() === mc.value), JSON.stringify(mc));
}
const tm = allFilms.find(f => f.ratings.some(r => r.source === 'tmdb'));
if (tm) {
  t = await go('#/film/' + tm.id);
  const r = tm.ratings.find(x => x.source === 'tmdb');
  check('film page: TMDB is a ring carrying its score', app.find(e => /(^| )rb-tmdb( |$)/.test(e.className)).some(e => e.attrs.style === `--p:${r.score}` && e.className.includes(r.band)), JSON.stringify(r));
}
const im = allFilms.find(f => f.ratings.some(r => r.source === 'imdb'));
if (im) {
  t = await go('#/film/' + im.id);
  check('film page: IMDb is a yellow tag with the star icon', app.find(e => /(^| )rb-imdb( |$)/.test(e.className)).length >= 1 && app.find(e => e.tag === 'img' && /imdb-star/.test(e.attrs.src || '')).length >= 1, '');
}
const rotten = allFilms.find(f => rtOf(f) && rtOf(f).band === 'bad');
if (rotten) {
  await go('#/film/' + rotten.id);
  check('film page: a sub-60 critics score gets the rotten icon', app.find(e => e.tag === 'img' && (e.attrs.src || '').includes('tomato-rotten')).length === 1, '');
}
const res = await fetch(withBoth.poster);
check('poster URL answers 200 image/jpeg', res.status === 200 && res.headers.get('content-type') === 'image/jpeg', res.status + ' ' + res.headers.get('content-type'));
const noPoster = allFilms.find(f => !f.poster);
if (noPoster) { await go('#/film/' + noPoster.id); check('film without a poster shows a lettered placeholder', app.find(e => /poster none/.test(e.className)).length === 1, ''); }
t = await go('#/plan/' + planId);
check('plan timeline: posters beside each film', app.find(e => e.tag === 'img' && /poster xs/.test(e.className)).length === 3, '');

// ---- placeholder when a poster is missing (every real film has one, so blank one in flight)
{
  const prev = globalThis.fetch;
  globalThis.fetch = async (p, o) => {
    const r = await prev(p, o);
    if (p === '/api/films/' + withBoth.id) { const j = await r.json(); j.poster = null; return { ok: true, status: 200, json: async () => j }; }
    return r;
  };
  await go('#/film/' + withBoth.id);
  const ph = app.find(e => /poster none/.test(e.className));
  check('missing poster: lettered placeholder, no broken image', ph.length === 1 && ph[0].text().trim().length === 1 &&
    app.find(e => e.tag === 'img' && /^poster/.test(e.className)).length === 0, ph.map(e => e.text()).join('|'));
  globalThis.fetch = prev;
}

// ---- score and reason on the films index tiles
{
  await go('#/films');
  const tiles = app.find(e => e.tag === 'a' && /(^| )film( |$)/.test(e.className));
  const tileFor = id => tiles.find(a => a.attrs.href === '#/film/' + id);
  const full = allFilms.find(f => f.why && f.why.confidence > 0.6 && f.why.critics.some(c => !c.minor) && f.sessions.some(s => ['2026-10-31','2026-11-01','2026-11-07','2026-11-08'].includes(s.starts_at.slice(0, 10))));
  const tt = tileFor(full.id).text();
  const reason = full.why.critics.filter(c => !c.minor).map(c => ({ rt: 'RT', metacritic: 'Metacritic', imdb: 'IMDb', tmdb: 'TMDB' }[c.source] + ' ' + c.value))[0];
  check('tile: shows the score and the first reason', tt.includes(String(Math.round(full.score))) && tt.includes(reason), tt);
  const unrated = allFilms.find(f => f.why && f.why.confidence < 0.15 && !f.why.tags.length && !f.why.taste.nudge && tileFor(f.id));
  check('tile: no data = "Unrated", not a default 50', !!unrated && tileFor(unrated.id).text().includes('Unrated') && !/\b50\b/.test(tileFor(unrated.id).text().replace(/\d+ min/, '')), unrated && tileFor(unrated.id).text());
  const tagsOnly = allFilms.find(f => f.why && f.why.confidence < 0.15 && f.why.tags.length && tileFor(f.id));
  check('tile: tags-only score is labelled as such', !!tagsOnly && tileFor(tagsOnly.id).text().includes('Festival tags only'), tagsOnly && tileFor(tagsOnly.id).text());
}

// ---- sort control on the films index
{
  await go('#/films');
  const sortSel = () => app.find(e => e.tag === 'select' && e.attrs['aria-label'] === 'Sort films')[0];
  const choose = v => { const s = sortSel(); s.value = v; (s.ls.change || []).forEach(fn => fn()); };
  const tiles = () => app.find(e => e.tag === 'a' && /(^| )film( |$)/.test(e.className));
  const idOf = a => a.attrs.href.replace('#/film/', '');
  const trip = ['2026-10-31', '2026-11-01', '2026-11-07', '2026-11-08'];
  const byId = Object.fromEntries(allFilms.map(f => [f.id, f]));

  const azTitles = tiles().map(a => a.find(e => e.tag === 'h3')[0].children[0].text());
  check('sort: default is A to Z', azTitles.every((t, i) => i === 0 || azTitles[i - 1].localeCompare(t) <= 0), azTitles.slice(0, 4).join('|'));

  choose('score');
  const chips = tiles().map(a => a.find(e => /(^| )scorechip( |$)/.test(e.className))[0]);
  const firstNone = chips.findIndex(c => /none/.test(c.className));
  const nums = chips.slice(0, firstNone < 0 ? chips.length : firstNone).map(c => Number(c.text()));
  check('sort: highest score first, scores never increase down the list', nums.length > 5 && nums.every((n, i) => i === 0 || nums[i - 1] >= n), nums.join(','));
  check('sort: Unrated films sink below every scored film', firstNone > 0 && chips.slice(firstNone).every(c => /none/.test(c.className)), String(firstNone));

  choose('time');
  const firsts = tiles().map(a => byId[idOf(a)].sessions.map(s => s.starts_at).filter(s => trip.includes(s.slice(0, 10))).sort()[0]);
  check('sort: earliest showtime first (within the chosen days)', firsts.length > 20 && firsts.every((t, i) => i === 0 || firsts[i - 1] <= t), firsts.slice(0, 3).join(' '));

  choose('az');
}

// ---- every option (branching view)
{
  const day = '2026-11-07';
  const api = await (await fetch('/api/paths?day=' + day)).json();
  check('paths API: lineups best first, each with three distinct sessions', api.lineups.length > 50 &&
    api.lineups.every((L, i) => L.s.length === 3 && new Set(L.s).size === 3 && (i === 0 || api.lineups[i - 1].score >= L.score)), String(api.lineups.length));
  const byId = Object.fromEntries(api.nodes.map(n => [n.session_id, n]));
  check('paths API: every lineup respects the configured walking buffers and film order', api.lineups.every(L => L.s.every((s, i) => {
    if (!i) return true;
    const a = byId[L.s[i - 1]], b = byId[s];
    return b.start >= a.end + (a.building === b.building ? api.buffers.same : api.buffers.same + (api.buffers.walk[[a.building, b.building].sort().join(' | ')] ?? (api.buffers.fallback - api.buffers.same)));
  })), '');
  check('paths API: a non-trip day is refused', (await fetch('/api/paths?day=2026-11-04')).status === 404, '');
  check('paths API: bad day is a 400', (await fetch('/api/paths?day=x')).status === 400, '');

  t = await go('#/paths/' + day);
  const tiles = () => app.find(e => /(^| )ptile( |$)/.test(e.className));
  const live = () => tiles().filter(e => !/(^| )dead( |$)/.test(e.className));
  const pickBtn = tile => tile.find(e => e.tag === 'button' && /ppick/.test(e.className))[0];
  const click = el => (el.ls.click || []).forEach(fn => fn());
  check('paths page: an hour axis and one poster tile per session, each linking to its film page', app.find(e => /(^| )paxl( |$)/.test(e.className)).length >= 5 &&
    tiles().length > 6 && tiles().every(tl => tl.find(e => e.tag === 'a' && (e.attrs.href || '').startsWith('#/film/')).length === 1), String(tiles().length));
  check('paths API: top-percentile films carry the glow flag, and only they outrank the rest', api.nodes.some(n => n.glow) &&
    Math.min(...api.nodes.filter(n => n.glow).map(n => n.score)) >= Math.max(...api.nodes.filter(n => !n.glow).map(n => n.score)), '');
  const badges = app.find(e => /(^| )pbadge( |$)/.test(e.className));
  check('paths page: every tile has a score badge, unrated ones a muted dash', badges.length === tiles().length &&
    badges.filter(b => /none/.test(b.className)).every(b => b.text().trim() === '–') && !app.text().includes('Unrated') &&
    badges.filter(b => !/none/.test(b.className)).every(b => /^\d+$/.test(b.text().trim()) && /hsl\(/.test(b.attrs.style)), badges.map(b => b.text()).join(','));
  check('paths page: glow class only on flagged films', badges.filter(b => /glow/.test(b.className)).length === tiles().filter(tl => api.nodes.find(n => n.glow && tl.attrs['data-k'] === String(n.session_id))).length, '');
  const frame0 = tiles()[0];
  (frame0.ls.click || []).forEach(fn => fn());
  check('paths page: tapping a poster reveals its Pick overlay', /(^| )open( |$)/.test(tiles()[0].className), tiles()[0].className);
  (frame0.ls.click || []).forEach(fn => fn());
  check('paths page: tapping again hides it', !/(^| )open( |$)/.test(tiles()[0].className), '');
  check('paths page: uses the wide column', /(^| )wide( |$)/.test(app.className), app.className);
  check('paths page: copy has no em-dash', !t.includes('—'), t.slice(0, 200));
  const before = nPlans(t, 0);
  const firstTile = tiles()[0];
  click(pickBtn(firstTile));
  t = app.text();
  const after = nPlans(t, 1);
  check('picking a film narrows the plans and dims the others', after < before && live().length < tiles().length, `${before} -> ${after}`);
  check('picked tile offers Release', pickBtn(app.find(e => /(^| )ptile( |$)/.test(e.className) && /(^| )on( |$)/.test(e.className))[0]).text() === 'Release', '');
  const picked = app.find(e => /(^| )ptile( |$)/.test(e.className) && /(^| )on( |$)/.test(e.className))[0];
  click(pickBtn(picked));
  check('tapping Picked releases it', nPlans(app.text(), -1) === before, app.text().slice(0, 300));
  // the time cursor: arriving late leaves fewer plans, moving it back restores them
  const slider = app.find(e => e.tag === 'input' && e.attrs.type === 'range')[0];
  slider.value = String(+slider.attrs.max); (slider.ls.input || []).forEach(fn => fn());
  const late = nPlans(app.text(), 0);
  check('time cursor: free only from the latest first start leaves fewer plans', late < before, `${before} -> ${late}`);
  slider.value = slider.attrs.min; (slider.ls.input || []).forEach(fn => fn());
  check('time cursor: back to the start restores them', nPlans(app.text(), -1) === before, '');
  t = await go('#/plans');
  const plansApi = await (await fetch('/api/plans')).json();
  const bestDay = plansApi.plans.slice().sort((x, y) => x.rank - y.rank)[0].day;
  const chipsOn = app.find(e => e.tag === 'button' && /(^| )chip( |$)/.test(e.className) && /(^| )on( |$)/.test(e.className)).map(e => e.text().trim());
  check('Plans tab opens the timeline of the best-ranked day, no index of tickets', app.find(e => /(^| )pcanvas( |$)/.test(e.className)).length === 1 &&
    app.find(e => /(^| )ticket( |$)/.test(e.className)).length === 0 && chipsOn.some(x => x.includes('Sat Nov 7')) && bestDay === '2026-11-07', chipsOn.join('|'));
  const dayChips = app.find(e => e.tag === 'button' && /(^| )chip( |$)/.test(e.className) && /^(Sat|Sun) /.test(e.text().trim())).map(e => e.text().trim());
  check('days sit across the top and only the best one says so', dayChips.length === 4 && dayChips.filter(x => x.includes('Best day')).length === 1 && dayChips.find(x => x.includes('Best day')).startsWith('Sat Nov 7'), dayChips.join('|'));
  const rapi = await (await fetch('/api/paths?day=' + bestDay)).json();
  const recTiles = app.find(e => /(^| )ptile( |$)/.test(e.className) && /(^| )rec( |$)/.test(e.className)).map(e => +e.attrs['data-k']);
  check('the recommended plan is highlighted on the timeline (its three films, tagged Recommended)', JSON.stringify(recTiles.sort()) === JSON.stringify(rapi.lineups[0].s.slice().sort()) &&
    app.find(e => /(^| )ptag( |$)/.test(e.className) && e.text().trim() === 'Recommended').length === 3, recTiles.join(','));
  t = await go('#/paths/2026-11-08');
  t = await go('#/plans');
  check('the Plans tab returns to the day you were on', app.find(e => e.tag === 'h2')[0].text().includes('Sun Nov 8'), app.find(e => e.tag === 'h2').map(e => e.text()).join('|'));
  const reset2 = app.find(e => e.tag === 'button' && e.text().trim() === 'Reset')[0];
  (reset2.ls.click || []).forEach(fn => fn());
  const firstRec = app.find(e => /(^| )ptile( |$)/.test(e.className) && /(^| )rec( |$)/.test(e.className))[0];
  (firstRec.find(e => e.tag === 'button' && /ppick/.test(e.className))[0].ls.click || []).forEach(fn => fn());
  check('after a pick the tag says Best from here', app.find(e => /(^| )ptag( |$)/.test(e.className)).some(e => e.text().trim() === 'Picked') &&
    app.find(e => /(^| )ptag( |$)/.test(e.className)).some(e => e.text().trim() === 'Best from here'), app.find(e => /(^| )ptag( |$)/.test(e.className)).map(e => e.text()).join('|'));
  (reset2.ls.click || []).forEach(fn => fn());
  t = await go('#/paths/' + bestDay);
}

// ---- every option: each session appears once, rows run earliest to latest, a time label starts the day there
{
  const day = '2026-11-08';
  const api = await (await fetch('/api/paths?day=' + day)).json();
  await go('#/paths/' + day);
  const tiles = () => app.find(e => /(^| )ptile( |$)/.test(e.className));
  const keys = tiles().map(e => e.attrs['data-k']);
  check('paths: every session is drawn exactly once', keys.length === new Set(keys).size && keys.length === new Set(api.lineups.slice(0, api.default_show).flatMap(L => L.s)).size, `${keys.length} tiles, ${new Set(keys).size} unique`);
  const byId = Object.fromEntries(api.nodes.map(n => [String(n.session_id), n]));
  const starts = keys.map(k => byId[k].start);
  check('paths: tiles run earliest to latest', starts.every((s, i) => i === 0 || starts[i - 1] <= s), starts.join(','));
  const labels = app.find(e => e.tag === 'button' && /(^| )paxl( |$)/.test(e.className));
  check('paths: an hour label down the axis, in order', labels.length >= 5, String(labels.length));
  const before = nPlans(app.text(), 0);
  const mid = labels[Math.floor(labels.length / 2)];
  (mid.ls.click || []).forEach(fn => fn());
  const mt = nPlans(app.text(), 0);
  check('paths: tapping a time starts the day there and drops earlier starts', mt < before && /Starting from/.test(app.text()), `${before} -> ${mt}`);
  const dead = tiles().filter(e => /(^| )dead( |$)/.test(e.className)).length;
  check('paths: tiles that cannot be part of a plan from there are dimmed', dead > 0, String(dead));
}

// ---- every option: the picture must say what the data says (a film is as tall as it runs, a line joins two films that fit)
for (const day of ['2026-10-31', '2026-11-01', '2026-11-07', '2026-11-08']) {
  const api = await (await fetch('/api/paths?day=' + day)).json();
  await go('#/paths/' + day);
  const reset = app.find(e => e.tag === 'button' && e.text().trim() === 'Reset')[0];
  (reset.ls.click || []).forEach(fn => fn());  // the page keeps its time filter while the tab is open
  const tiles = app.find(e => /(^| )ptile( |$)/.test(e.className));
  const canvas = app.find(e => /(^| )pcanvas( |$)/.test(e.className))[0];
  const byId = Object.fromEntries(api.nodes.map(n => [String(n.session_id), n]));
  const css = (tile, k) => +(new RegExp(k + ':(-?[\\d.]+)px').exec(tile.attrs.style) || [])[1];
  const first = tiles[0];
  const t0 = byId[first.attrs['data-k']].start - css(first, 'top') / 1.5;
  check(`${day}: tile top is its start time and tile height is its running time`, tiles.every(tl => {
    const n = byId[tl.attrs['data-k']];
    return Math.abs(css(tl, 'top') - (n.start - t0) * 1.5) <= 1 && css(tl, 'height') >= Math.round((n.end - n.start) * 1.5) - 1;
  }), '');
  const lanes = {};
  tiles.forEach(tl => { const lane = /left:(calc\([^;]*\));/.exec(tl.attrs.style)[1]; (lanes[lane] = lanes[lane] || []).push(tl); });
  check(`${day}: no two tiles overlap in a lane`, Object.values(lanes).every(list => list.map(tl => [css(tl, 'top'), css(tl, 'top') + css(tl, 'height')]).sort((a, b) => a[0] - b[0]).every((r, i, a) => i === 0 || a[i - 1][1] <= r[0])), '');
  const pairs = (canvas.attrs['data-edges'] || '').split(' ').filter(Boolean).map(x => x.split('>'));
  const need = (a, b) => a.building === b.building ? api.buffers.same : api.buffers.same + (api.buffers.walk[[a.building, b.building].sort().join(' | ')] ?? (api.buffers.fallback - api.buffers.same));
  const bad = pairs.filter(([a, b]) => !(byId[b].start >= byId[a].end + need(byId[a], byId[b]) && byId[a].film_id !== byId[b].film_id));
  check(`${day}: all ${pairs.length} lines join a film to one that really fits after it`, pairs.length > 0 && bad.length === 0, bad.slice(0, 3).map(([a, b]) => `${byId[a].title} ${byId[a].end} -> ${byId[b].title} ${byId[b].start}`).join(' | '));
  const pageText = app.text();
  check(`${day}: sessions in no plan are listed with a reason`, api.skipped.length === 0 || (pageText.includes('are in no plan') && api.skipped.every(x => pageText.includes(x.reason.slice(0, 20)))), '');
}

// ---- every option: columns are buildings (nearest together), and a hovered film greys out what you could no longer make
for (const day of ['2026-11-07', '2026-11-08']) {
  const api = await (await fetch('/api/paths?day=' + day)).json();
  await go('#/paths/' + day);
  const reset = app.find(e => e.tag === 'button' && e.text().trim() === 'Reset')[0];
  (reset.ls.click || []).forEach(fn => fn());
  const tiles = () => app.find(e => /(^| )ptile( |$)/.test(e.className));
  const heads = app.find(e => /(^| )pbandh( |$)/.test(e.className)).map(e => e.text().trim());
  const buildings = [...new Set(api.nodes.map(n => n.building))];
  const d = (a, b) => a === b ? 0 : api.buffers.walk[[a, b].sort().join(' | ')];
  check(`${day}: one column group per building, in order of walking distance (middle one is nearest to both)`, heads.length === buildings.length &&
    new Set(heads).size === heads.length && (heads.length < 3 || d(heads[0], heads[1]) + d(heads[1], heads[2]) <= d(heads[0], heads[2]) + 2 * Math.min(d(heads[0], heads[1]), d(heads[1], heads[2]))) &&
    (heads.length < 3 || d(heads[0], heads[2]) === Math.max(...buildings.flatMap(a => buildings.map(b => d(a, b))))), heads.join(' | '));
  const walks = app.find(e => /(^| )pwalk( |$)/.test(e.className)).map(e => e.text());
  check(`${day}: the space between buildings says the walk in minutes and metres`, walks.length === heads.length - 1 && walks.every(t => /\d+ min walk/.test(t) && /\d+ m/.test(t)), walks.join(' | '));
  check(`${day}: every film sits in its own building's column`, tiles().every(tl => {
    const col = heads.indexOf(tl.attrs['data-building']);
    return col >= 0;
  }), '');
  const sidOf = tl => +tl.attrs['data-k'];
  const first = api.lineups.slice(0, api.default_show);
  const target = tiles()[Math.floor(tiles().length / 2)];
  (target.ls.mouseenter || []).forEach(fn => fn());
  const expect = new Set(first.filter(L => L.s.includes(sidOf(target))).flatMap(L => L.s));
  const lit = tiles().filter(tl => !/(^| )unrel( |$)/.test(tl.className)).map(sidOf);
  check(`${day}: hovering a film lights exactly the films that share a plan with it, the rest go grey`, lit.length === expect.size && lit.every(x => expect.has(x)) && expect.size < tiles().length, `${lit.length} lit, ${expect.size} expected of ${tiles().length}`);
  (target.ls.mouseleave || []).forEach(fn => fn());
  check(`${day}: leaving the film clears the grey`, tiles().every(tl => !/(^| )unrel( |$)/.test(tl.className)), '');
  (target.ls.click || []).forEach(fn => fn());
  check(`${day}: tapping pins it (overlay open, others stay grey after the pointer leaves)`, /(^| )open( |$)/.test(target.className) && tiles().some(tl => /(^| )unrel( |$)/.test(tl.className)), '');
  (target.ls.click || []).forEach(fn => fn());
}
