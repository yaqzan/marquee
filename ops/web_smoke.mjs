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
function check(name, cond, extra = ''){ console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)); if (!cond) process.exitCode = 1; }

await new Promise(r => setTimeout(r, 600));
check('festival name in header', fest.text().includes('Windsor International Film Festival'), fest.text());

let t = await go('#/plans');
check('plans: ranked ticket, titles title-cased', t.includes('Sat Nov 7') && t.includes('Extravagant Ways To Say Goodbye'.replace('To','to')) , t);
check('plans: cost + top pick', t.includes('$57') && t.includes('top pick'), t);
check('plans: span 9:00 am to 8:51 pm', t.includes('9:00 am to 8:51 pm'), t);

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
const titles = app.find(e => e.tag === 'h3').map(e => e.text());
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
