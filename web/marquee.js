(() => {
'use strict';

const app = document.getElementById('app');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SMALL = new Set(['of', 'the', 'a', 'an', 'and', 'in', 'on', 'at', 'to', 'for', 'de', 'la', 'le', 'du', 'des', 'von', 'van', 'y', 'el']);
const KEEP = new Set(['WIFF', 'TV', 'DJ', 'UK', 'USA', 'II', 'III', 'IV', 'OK', 'NR', 'LGBTQ2+', 'LIUNA']);

// ---------------------------------------------------------------- helpers

// Elements are built with createElement/createTextNode only: data never goes in as markup.
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
  return e;
}

function titleCase(s) {
  if (!s) return '';
  let t = s.trim();
  const m = t.match(/^(.*), (THE|A|AN)$/i);
  if (m) t = m[2] + ' ' + m[1];
  const parts = t.split(/(\s+)/);
  const first = parts.findIndex(x => !/^\s+$/.test(x));
  let prev = '';
  return parts.map((w, i) => {
    if (/^\s+$/.test(w)) return w;
    const after = prev;
    prev = w;
    if (KEEP.has(w)) return w;
    const lower = w.toLowerCase();
    if (i !== first && SMALL.has(lower) && !after.endsWith(':')) return lower;
    return lower.replace(/(^|[-("“])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());
  }).join('');
}

function places(s) {
  return (s || '').split(',').map(x => x.trim()).filter(Boolean)
    .map(x => (KEEP.has(x) ? x : titleCase(x))).join(', ');
}

function ts(str) {
  const [day, time] = str.split('T');
  const [y, mo, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return { day, y, mo, d, hh, mm, min: hh * 60 + mm };
}
function fmtDay(day) {
  const [y, mo, d] = day.split('-').map(Number);
  return `${DOW[new Date(y, mo - 1, d).getDay()]} ${MON[mo - 1]} ${d}`;
}
function fmtMin(total) {
  const m = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60), mm = m % 60;
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
}
const fmtTime = str => fmtMin(ts(str).min);
function fmtDur(min) {
  const h2 = Math.floor(min / 60), m = min % 60;
  return h2 ? (m ? `${h2} h ${m} min` : `${h2} h`) : `${m} min`;
}
const money = cents => '$' + (cents / 100).toFixed(cents % 100 ? 2 : 0);
const fmtInt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const SHORT = { rt: 'RT', metacritic: 'Metacritic', imdb: 'IMDb', tmdb: 'TMDB' };

// "RT 96% · Metacritic 70 · Cannes · Taste +1.1: Miles Teller" (low-weight sources left out)
function reasonLine(w) {
  if (!w) return '';
  const bits = w.critics.filter(c => !c.minor).map(c => `${SHORT[c.source] || c.name} ${c.value}`)
    .concat(w.tags.map(t => titleCase(t.label)));
  if (w.taste.nudge) bits.push(`Taste ${w.taste.nudge > 0 ? '+' : ''}${w.taste.nudge.toFixed(1)}: ${(w.taste.because[0] || '').replace(/ \([+-]\d+\)$/, '')}`);
  return bits.join(' · ');
}

// What a tile says about a film's score. A film with nothing behind its number (no critic scores, no festival
// tags, no taste match) is "Unrated" rather than a default 50; tags-only scores are marked as such.
const isUnrated = w => !w || (w.confidence < 0.15 && !w.tags.length && !w.taste.nudge);

function tileScore(w) {
  if (!w) return { chip: null, text: '' };
  const thin = w.confidence < 0.15;
  if (isUnrated(w)) return { chip: h('span', { class: 'scorechip none', title: 'No critic scores or festival tags yet' }, 'Unrated'), text: '' };
  const why = reasonLine(w);
  return {
    chip: h('span', { class: 'scorechip' + (thin ? ' thin' : ''), title: w.coverage }, Math.round(w.score)),
    text: thin ? 'Festival tags only' + (why ? ': ' + why : '') : why,
  };
}

function whyCard(w) {
  if (!w) return null;
  const sec = (title, list) => h('div', { class: 'why-sec' }, h('h4', null, title), h('ul', { class: 'why-list' }, list));
  const parts = [];
  if (w.critics.length) {
    parts.push(sec('Critics and audiences', w.critics.map(c => h('li', null,
      h('span', null, c.name, c.minor ? h('span', { class: 'badge' }, 'barely counts') : null),
      h('span', { class: 'v' }, c.value + (c.votes ? ` · ${fmtInt(c.votes)} votes` : ''))))));
  } else {
    parts.push(h('p', { class: 'meta' }, 'No critic scores yet, so this score rests on festival tags alone.'));
  }
  if (w.tags.length) {
    parts.push(sec('Festival picks', w.tags.map(t => h('li', null, h('span', null, titleCase(t.label)), h('span', { class: 'v' }, '+' + t.points)))));
  }
  if (w.taste.nudge) {
    parts.push(sec('Your taste', w.taste.because.map(b => h('li', null, h('span', null, b.replace(/ \([+-]\d+\)$/, '')),
      h('span', { class: 'v' }, (b.match(/\(([+-]\d+)\)$/) || [])[1] || '')))));
    parts.push(h('p', { class: 'meta' }, `Moves the score ${w.taste.nudge > 0 ? '+' : ''}${w.taste.nudge.toFixed(1)}. Based on films you've ranked with the same people.`));
  }
  return h('section', { class: 'whycard' },
    h('div', { class: 'why-head' },
      h('div', { class: 'why-score' }, Math.round(w.score)),
      h('div', null, h('div', { class: 'why-cov' }, w.coverage), h('div', { class: 'meta' }, `Confidence ${Math.round(w.confidence * 100)}%`))),
    parts);
}

// One badge per source, each in that source's own style: Rotten Tomatoes critics (tomato), Metacritic (coloured
// metascore tile), IMDb (yellow tag with a star), TMDB (percent ring). The server picks the good/mixed/bad band.
// (RT's own audience score has no open source, so the audience badges are IMDb and TMDB, and say so.)
function ratingBadge(r, big) {
  const title = `${r.name} ${r.kind.toLowerCase()} ${r.value}` + (r.votes ? ` (${fmtInt(r.votes)} votes)` : '');
  const px = big ? 30 : 18;
  let mark;
  if (r.source === 'rt') {
    mark = [h('img', { src: `/icons/tomato-${r.band === 'good' ? 'fresh' : 'rotten'}.svg?v=1`, alt: '', width: px, height: px }), h('span', { class: 'rb-n' }, r.value)];
  } else if (r.source === 'metacritic') {
    mark = h('span', { class: 'rb-mc ' + r.band }, r.value);
  } else if (r.source === 'imdb') {
    mark = h('span', { class: 'rb-imdb' }, h('img', { src: '/icons/imdb-star.svg?v=1', alt: '', width: big ? 16 : 12, height: big ? 16 : 12 }), h('b', null, r.value));
  } else {
    mark = h('span', { class: 'rb-tmdb ' + r.band, style: `--p:${r.score}` }, h('b', null, String(r.score)));
  }
  return h('span', { class: 'rb rb-' + r.source + (big ? ' big' : ''), title }, mark, big ? h('span', { class: 'rb-l' }, `${r.name} ${r.kind.toLowerCase()}`) : null);
}

function badges(o, big) {
  const list = (o.ratings || []).map(r => ratingBadge(r, big));
  return list.length ? h('div', { class: 'bdgs' + (big ? ' big' : '') }, list) : null;
}

function poster(src, title, cls) {
  return src
    ? h('img', { class: 'poster ' + cls, src, alt: '', loading: 'lazy' })
    : h('div', { class: 'poster none ' + cls, 'aria-hidden': 'true' }, (title || '?').trim().charAt(0).toUpperCase());
}

const cleanTags = tags => (tags || []).map(t => t.label).filter(l => l && !/^\d+$/.test(l));

const cache = {};
async function api(path) {
  if (cache[path]) return cache[path];
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + ' ' + r.status);
  const d = await r.json();
  if (path === '/api/festival' || path === '/api/films') cache[path] = d;
  return d;
}

function screen(...kids) {
  app.replaceChildren(...kids.flat(Infinity).filter(Boolean));
}

function chip(label, on, onclick, extra) {
  return h('button', { type: 'button', class: 'chip' + (on ? ' on' : '') + (extra ? ' ' + extra : ''), onclick }, label);
}

// ---------------------------------------------------------------- views

async function plansView() {
  const [fest, plans] = await Promise.all([api('/api/festival'), api('/api/plans')]);
  if (plans.plans.length) {
    return screen(
      h('h2', null, 'Your best days'),
      h('p', { class: 'note' }, 'Ranked across your trip days.'),
      plans.plans.map((p, i) => planTicket(p, i === 0)),
      optionLinks(fest));
  }
  const trip = fest.days.filter(d => d.candidate);
  screen(
    h('h2', null, 'Your trip days'),
    h('p', { class: 'note' }, 'Ranked day plans appear here once scoring is built. Until then, these are the days you can go.'),
    trip.map(d => h('a', { class: 'ticket', href: '#/schedule/' + d.day },
      h('div', { class: 'main' },
        h('h3', null, fmtDay(d.day)),
        h('p', { class: 'line' }, `${d.films} films across ${d.sessions} screenings`)),
      h('div', { class: 'stub' },
        h('div', { class: 'big' }, d.sessions),
        h('div', { class: 'cap' }, 'screenings')))),
    optionLinks(fest));
}

function optionLinks(fest) {
  return [
    h('h2', null, 'See every option'),
    h('p', { class: 'note' }, 'All the film combinations that work for a day, with the paths that lead to the same choices joined up.'),
    h('div', { class: 'chips' }, fest.days.filter(d => d.candidate).map(d => h('a', { class: 'chip trip', href: '#/paths/' + d.day }, fmtDay(d.day))))];
}

function planTicket(p, top) {
  const titles = p.items.map(i => titleCase(i.title)).join(', ');
  const first = p.items[0], last = p.items[p.items.length - 1];
  const span = first && last ? `${fmtTime(first.starts_at)} to ${fmtMin(ts(last.starts_at).min + (last.runtime_min || 0))}` : '';
  return h('a', { class: 'ticket' + (top ? ' top' : ''), href: '#/plan/' + p.id },
    h('div', { class: 'main' },
      h('h3', null, fmtDay(p.day)),
      h('p', { class: 'line' }, titles),
      h('p', { class: 'line' }, [span, p.cost_cents != null ? money(p.cost_cents) : ''].filter(Boolean).join(' · '))),
    h('div', { class: 'stub' },
      h('div', { class: 'big' }, p.rank),
      h('div', { class: 'cap' }, top ? 'top pick' : 'rank')));
}

async function planView(id) {
  const data = await api('/api/plans');
  const p = data.plans.find(x => String(x.id) === String(id));
  if (!p) return screen(h('a', { class: 'back', href: '#/plans' }, '← Plans'), h('p', { class: 'empty' }, 'That plan is gone. Head back to the list.'));
  const events = [];
  p.items.forEach((it, i) => {
    const st = ts(it.starts_at), end = st.min + (it.runtime_min || 0);
    if (i > 0) {
      const prev = p.items[i - 1];
      const gapStart = ts(prev.starts_at).min + (prev.runtime_min || 0);
      const gap = st.min - gapStart;
      if (gap > 0) {
        const lunch = Math.min(st.min, 870) - Math.max(gapStart, 690) >= 45;
        const dinner = Math.min(st.min, 1200) - Math.max(gapStart, 990) >= 45;
        events.push(h('div', { class: 'ev free' }, h('h3', null,
          `${fmtDur(gap)} free${lunch ? ': lunch' : dinner ? ': dinner' : ''}`)));
      }
    }
    events.push(h('div', { class: 'ev' }, h('div', { class: 'evrow' },
      poster(it.poster, titleCase(it.title), 'xs'),
      h('div', { class: 'evbody' },
        h('div', { class: 'tm' }, `${fmtMin(st.min)} \u2013 ${fmtMin(end)}`),
        h('h3', null, h('a', { href: '#/film/' + it.film_id }, titleCase(it.title))),
        h('p', { class: 'meta' }, it.venue),
        badges(it, false),
        it.why ? h('p', { class: 'meta why-line' }, `Score ${Math.round(it.why.score)}`, reasonLine(it.why) ? ' \u00b7 ' + reasonLine(it.why) : '') : null,
        it.note ? h('p', { class: 'meta' }, it.note) : null))));
  });
  screen(
    h('a', { class: 'back', href: '#/plans' }, '← Plans'),
    h('h2', null, fmtDay(p.day)),
    h('p', { class: 'note' }, [`#${p.rank}`, p.cost_cents != null ? money(p.cost_cents) : ''].filter(Boolean).join(' · ')),
    h('a', { class: 'back', href: '#/paths/' + p.day }, 'See every option for this day →'),
    h('div', { class: 'tl' }, events),
    p.summary ? h('div', { class: 'why' }, p.summary) : null);
}

// ---------------------------------------------------------------- every option (branching view)

// A day's valid lineups (best first) drawn as rows of poster tiles, one row per film slot. Lines join the films
// that can follow each other. Films that lead to exactly the same next films share a dot: the paths merge there.
// Picking a film (or moving the "free from" time) narrows the lineups, so forks and merges are worked out
// from what is still live. The server only supplies lineups and sessions.
const pathState = {};
const BCOL = ['#7a2f22', '#a8741a', '#3d5a6c', '#5a6b3a'];
let relayout = null;
let openTile = null;
const PX_MIN = 1.5;      // pixels per minute on the every-option time axis
const HEAD = 62;         // height of the building headers above the time axis
const MIN_BLOCK = 104;   // a film is never drawn shorter than this, so its poster and buttons stay usable

// Score badge on a poster: colour runs red to green with the score; the top percentile (server's `glow` flag) glows;
// a film with nothing behind its number gets a muted dash instead of a default 50.
function scoreColor(score) {
  const t = Math.max(0, Math.min(1, (score - 45) / 40));
  return `hsl(${Math.round(8 + t * 112)} 62% 34%)`;
}
function scoreBadge(n) {
  if (isUnrated(n.why)) return h('span', { class: 'pbadge none', title: 'No critic scores or festival tags yet' }, '–');
  const col = scoreColor(n.why.score), thin = n.why.confidence < 0.15;
  return h('span', { class: 'pbadge' + (n.glow ? ' glow' : '') + (thin ? ' thin' : ''), title: (n.glow ? 'Top-rated at the festival. ' : '') + n.why.coverage,
    style: `background:${col};--glow:${col}` }, Math.round(n.why.score));
}

function svgEl(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  return e;
}

// Buildings left to right by walking distance: the two furthest apart at the ends, the rest in order from the left end,
// so a building in the middle really is between the others.
function orderBuildings(bs, walk) {
  const d = (a, b) => walk[[a, b].sort().join(' | ')] ?? 99;
  if (bs.length < 3) return bs.slice();
  let ends = [bs[0], bs[1]];
  bs.forEach(a => bs.forEach(b => { if (a < b && d(a, b) > d(ends[0], ends[1])) ends = [a, b]; }));
  const mid = bs.filter(x => !ends.includes(x)).sort((x, y) => d(ends[0], x) - d(ends[0], y));
  return [ends[0], ...mid, ends[1]];
}

async function pathsView(dayArg) {
  const fest = await api('/api/festival');
  const trip = fest.days.filter(d => d.candidate).map(d => d.day);
  const day = trip.includes(dayArg) ? dayArg : trip[0];
  const data = await api('/api/paths?day=' + day);
  const nodes = Object.fromEntries(data.nodes.map(n => [n.session_id, n]));
  const walk = data.buffers.walk, walkM = data.buffers.walk_m || {};
  const pairKey = (a, b) => [a, b].sort().join(' | ');
  const walkMin = (a, b) => (a === b ? 0 : walk[pairKey(a, b)] ?? (data.buffers.fallback - data.buffers.same));
  const buildings = orderBuildings([...new Set(data.nodes.map(n => n.building))].sort(), walk);
  const bcol = b => BCOL[buildings.indexOf(b) % BCOL.length];
  const st = pathState[day] || (pathState[day] = { picks: [], t: null, show: data.default_show, all: false });
  const starts = data.nodes.map(n => n.start);
  const tMin = Math.floor(Math.min(...starts, 1440) / 30) * 30, tMax = Math.max(...starts, 0);
  const scroller = h('div', { class: 'pscroll' });
  const sum = h('div', { class: 'psum' });
  const cursorEl = h('span', { class: 'pcur' });
  const slider = h('input', { type: 'range', min: tMin, max: tMax, step: 5, value: st.t == null ? tMin : st.t, 'aria-label': 'Free from' });
  const showEl = h('div', { class: 'chips' });
  const allBtn = h('button', { type: 'button', class: 'chip', onclick: () => { st.all = !st.all; render(); } }, 'All lines');

  const baseOf = () => data.lineups.slice(0, st.show);
  const has = (L, p) => p.every(x => L.s.includes(x));
  const afterStart = L => st.t == null || L.s.every(s => nodes[s].start >= st.t);

  function pick(sid) {
    let p = st.picks.includes(sid) ? st.picks.filter(x => x !== sid) : st.picks.concat(sid);
    if (!baseOf().some(L => has(L, p))) p = [sid];  // a pick that clashes replaces the old ones
    st.picks = p;
    if (p.length) st.t = null;
    render();
  }
  function startAt(t) { st.t = t; st.picks = []; render(); }

  // The plans you could still make if you picked this film (on top of what is already picked, unless that clashes).
  function consequence(sid) {
    let p = st.picks.includes(sid) ? st.picks : st.picks.concat(sid);
    let Ls = baseOf().filter(L => has(L, p) && (p.length > 1 || afterStart(L)));
    if (!Ls.length) Ls = baseOf().filter(L => has(L, [sid]));
    return Ls;
  }

  function render() {
    openTile = null;
    let pinSid = null, hoverSid = null;
    allBtn.classList.toggle('on', st.all);
    const base = baseOf();
    const picked = st.picks.length > 0;
    const live = base.filter(L => has(L, st.picks) && (picked || afterStart(L)));
    const liveSet = new Set(live.flatMap(L => L.s));
    const cursor = picked ? Math.max(...st.picks.map(s => nodes[s].end)) : st.t;
    cursorEl.textContent = cursor == null ? 'Any start time' : (picked ? 'Free again at ' : 'Starting from ') + fmtMin(cursor);
    slider.value = cursor == null ? tMin : Math.min(tMax, Math.max(tMin, cursor));

    // Across: one column group per building, nearest buildings next to each other and the space between them as wide
    // as the walk. Down: a real time axis, a film is a block as tall as it runs, so a line leaves where a film ends.
    const ids = [...new Set(base.flatMap(L => L.s))].sort((a, b) => nodes[a].start - nodes[b].start || nodes[a].end - nodes[b].end || a - b);
    const t0 = Math.floor(Math.min(...ids.map(i => nodes[i].start), 1440) / 60) * 60;
    const tEnd = Math.ceil(Math.max(...ids.map(i => nodes[i].end), 0) / 60) * 60;
    const y = t => HEAD + Math.round((t - t0) * PX_MIN);
    const laneOf = {}, blockH = {}, col = {};
    let laneBase = 0, gapPx = 0;
    buildings.forEach((b, gi) => {
      if (gi) gapPx += Math.round(30 + walkMin(buildings[gi - 1], b) * 14);
      const ends = [];  // end of the last block in each lane; films showing at once in one building take the next lane
      ids.filter(i => nodes[i].building === b).forEach(id => {
        const n = nodes[id];
        blockH[id] = Math.max(MIN_BLOCK, Math.round((n.end - n.start) * PX_MIN));
        let k = ends.findIndex(e => e <= n.start * PX_MIN);
        if (k < 0) { k = ends.length; ends.push(0); }
        ends[k] = n.start * PX_MIN + blockH[id];
        laneOf[id] = k;
      });
      col[b] = { laneBase, lanes: Math.max(1, ends.length), gapPx };
      laneBase += col[b].lanes;
    });
    const canvas = h('div', { class: 'pcanvas' + (st.all ? ' all' : ''), style: `--lanes:${laneBase};--gaps:${gapPx}px;height:${y(tEnd) + 24}px` });
    const unit = '(var(--lw) + var(--lg))';

    buildings.forEach((b, gi) => {
      const c = col[b];
      canvas.appendChild(h('div', { class: 'pband', style: `--bc:${bcol(b)};left:calc(var(--ax) + ${c.laneBase} * ${unit} + ${c.gapPx}px - var(--lg) / 2);width:calc(${c.lanes} * ${unit})` },
        h('div', { class: 'pbandh' }, b)));
      if (gi) {
        const pv = col[buildings[gi - 1]], m = walkMin(buildings[gi - 1], b), mm = walkM[pairKey(buildings[gi - 1], b)];
        canvas.appendChild(h('div', { class: 'pwalk', style: `left:calc(var(--ax) + ${pv.laneBase + pv.lanes} * ${unit} + ${pv.gapPx}px - var(--lg) / 2);width:${c.gapPx - pv.gapPx}px` },
          h('span', null, `${m} min walk`), mm ? h('small', null, `${mm} m`) : null));
      }
    });
    for (let t = t0; t <= tEnd; t += 60) {
      canvas.appendChild(h('div', { class: 'pgrid', style: `top:${y(t)}px` }));
      canvas.appendChild(h('button', { type: 'button', class: 'paxl', style: `top:${y(t)}px`, title: 'Start your day here', onclick: () => startAt(t) }, fmtMin(t).replace(':00', '')));
    }
    if (cursor != null && !picked) canvas.appendChild(h('div', { class: 'pshade', style: `top:${HEAD}px;height:${Math.max(0, y(cursor) - HEAD)}px` }));

    const tileEls = {};
    // Hover (or tap) a film: the plans you could still make light up with their routes, every film you could no longer
    // see go grey.
    const applyFocus = () => {
      const sid = hoverSid ?? pinSid;
      canvas.classList.toggle('focused', sid != null);
      let lit = null, pairSet = null;
      if (sid != null) {
        const Ls = consequence(sid);
        lit = new Set(Ls.flatMap(L => L.s));
        pairSet = new Set(Ls.flatMap(L => L.s.slice(0, -1).map((a, i) => a + '>' + L.s[i + 1])));
      }
      for (const [k, el] of Object.entries(tileEls)) el.classList.toggle('unrel', lit != null && !lit.has(+k));
      if (!canvas.querySelectorAll) return;
      canvas.querySelectorAll('.pw').forEach(g => {
        const a = +g.getAttribute('data-a'), b = +g.getAttribute('data-b');
        const mine = pairSet != null && pairSet.has(a + '>' + b);
        g.classList.toggle('focus', mine);
        g.classList.toggle('pre', mine && nodes[b].start <= nodes[sid].start);
        g.classList.toggle('adj', mine && (a === sid || b === sid));
      });
    };

    ids.forEach(sid => {
      const n = nodes[sid], on = st.picks.includes(sid), alive = liveSet.has(sid);
      const key = titleCase(n.title), c = col[n.building];
      const t = h('div', { class: 'ptile' + (on ? ' on' : '') + (alive ? '' : ' dead'), 'data-k': String(sid), 'data-start': n.start, 'data-end': n.end, 'data-building': n.building,
        style: `left:calc(var(--ax) + ${c.laneBase + laneOf[sid]} * ${unit} + ${c.gapPx}px);top:${y(n.start)}px;height:${blockH[sid]}px` },
        poster(n.poster, key, 'pt'),
        h('div', { class: 'pcap' }, h('b', null, key), h('span', null, `${fmtMin(n.start)} – ${fmtMin(n.end)}`)),
        scoreBadge(n),
        on ? h('div', { class: 'pmark' }, 'Picked') : null,
        h('div', { class: 'pover' },
          h('div', { class: 'phome' }, 'Home about ' + fmtMin(n.end + data.drive_min)),
          badges(n, false),
          h('button', { type: 'button', class: 'ppick', 'aria-pressed': on ? 'true' : 'false', onclick: e => { if (e) e.stopPropagation(); pick(sid); } }, on ? 'Release' : 'Pick'),
          h('a', { class: 'pgo', href: '#/film/' + n.film_id, onclick: e => { if (e) e.stopPropagation(); } }, 'Film page')));
      t.setAttribute('role', 'button');
      t.setAttribute('tabindex', '0');
      t.setAttribute('aria-label', `${key}, ${n.building}, ${fmtMin(n.start)} to ${fmtMin(n.end)}: show options`);
      const toggle = () => {
        if (openTile) openTile.classList.remove('open');
        if (pinSid === sid) { pinSid = null; openTile = null; } else { pinSid = sid; t.classList.add('open'); openTile = t; }
        applyFocus();
      };
      t.addEventListener('click', toggle);
      t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      t.addEventListener('mouseenter', () => { hoverSid = sid; applyFocus(); });
      t.addEventListener('mouseleave', () => { hoverSid = null; applyFocus(); });
      tileEls[sid] = t;
      canvas.appendChild(t);
    });
    if (cursor != null) canvas.appendChild(h('div', { class: 'pnow', style: `top:${y(cursor)}px` }, h('span', null, (picked ? 'Free again at ' : 'Starting from ') + fmtMin(cursor))));

    // every line is a pair of consecutive films in some plan; only the live ones count for "All lines"
    const pairs = [], livePairs = new Set();
    base.forEach(L => L.s.slice(0, -1).forEach((a, i) => { const k = a + '>' + L.s[i + 1]; if (!pairs.includes(k)) pairs.push(k); }));
    live.forEach(L => L.s.slice(0, -1).forEach((a, i) => livePairs.add(a + '>' + L.s[i + 1])));
    canvas.setAttribute('data-edges', pairs.join(' '));
    scroller.replaceChildren(canvas);
    relayout = () => { edges(canvas, pairs, livePairs, st.picks, nodes, walkMin); applyFocus(); };

    const best = live[0];
    const lines = [];
    if (!live.length) lines.push(h('p', { class: 'note' }, 'No full plan fits this. Move the time earlier, or tap Release on a picked film.'));
    else {
      const full = st.picks.length >= 3;
      lines.push(h('p', { class: 'note' }, full ? 'Your plan' : `${live.length} ${live.length === 1 ? 'plan' : 'plans'} still possible. Best from here:`));
      lines.push(h('div', { class: 'why' },
        best.s.map((sid, k) => [k ? h('div', { class: 'meta gap' }, `${nodes[sid].start - nodes[best.s[k - 1]].end} min between${nodes[sid].building !== nodes[best.s[k - 1]].building ? `, including a ${walkMin(nodes[sid].building, nodes[best.s[k - 1]].building)} min walk` : ''}`) : null,
          h('div', null, `${fmtMin(nodes[sid].start)} – ${fmtMin(nodes[sid].end)}  `, h('a', { href: '#/film/' + nodes[sid].film_id }, titleCase(nodes[sid].title)), ` · ${nodes[sid].building}`)]),
        h('div', { class: 'meta' }, `Score ${best.score.toFixed(1)} · ${money(best.cost)} · ${best.changes ? best.changes + ' building change' + (best.changes > 1 ? 's' : '') : 'all in one building'} · home about ${fmtMin(nodes[best.s[best.s.length - 1]].end + data.drive_min)}`)));
    }
    sum.replaceChildren(...lines);
    showEl.replaceChildren(
      chip(`Top ${data.default_show}`, st.show === data.default_show, () => setShow(data.default_show)),
      chip(`Top ${data.more_show}`, st.show === data.more_show, () => setShow(data.more_show)),
      chip(`Everything (${data.lineups.length})`, st.show === data.lineups.length, () => setShow(data.lineups.length)));
    if (window.requestAnimationFrame) window.requestAnimationFrame(() => relayout && relayout());
  }

  function setShow(n) { st.show = Math.min(n, data.lineups.length); st.picks = []; render(); }
  slider.addEventListener('input', () => startAt(+slider.value));

  screen(
    h('a', { class: 'back', href: '#/plans' }, '← Plans'),
    h('h2', null, 'Every option: ' + fmtDay(day)),
    h('div', { class: 'chips' }, trip.map(d => chip(fmtDay(d), d === day, () => { location.hash = '#/paths/' + d; }, 'trip'))),
    h('p', { class: 'note' }, 'One column per building, the closest ones side by side, and the gap between them as wide as the walk. Time runs down the page and a film is as tall as it runs. Hover or tap a film: the plans you could still make light up with their routes, and every film you could no longer see goes grey. Tap an hour to start your day there, or drag the slider.'),
    h('div', { class: 'pbar' }, cursorEl, slider, allBtn,
      h('button', { type: 'button', class: 'chip', onclick: () => { st.picks = []; st.t = null; render(); } }, 'Reset')),
    scroller, sum, h('p', { class: 'meta' }, 'Show:'), showEl,
    data.skipped.length ? h('div', { class: 'why skipped' }, h('div', { class: 'meta' }, `${data.skipped.length} of this day's ${data.skipped.length + data.nodes.length} screenings are in no plan:`),
      data.skipped.map(x => h('div', { class: 'meta' }, `${fmtMin(x.start)} – ${fmtMin(x.end)} `, h('a', { href: '#/film/' + x.film_id }, titleCase(x.title)), `: ${x.reason}.`))) : null);
  render();
}

// The routes, measured from the DOM (browser only: needs layout). Each is an elbow with rounded corners from the bottom of
// a film down to the top of a later one, ending in an arrow, with a halo so it reads over a poster. The pill says the
// break (and the walk if the building changes). Which lines show is decided by applyFocus and the All lines chip.
function edges(canvas, pairs, livePairs, picks, nodes, walkMin) {
  if (!canvas.getBoundingClientRect || !document.createElementNS) return;
  const box = canvas.getBoundingClientRect();
  const at = {};
  canvas.querySelectorAll('.ptile').forEach(el => { at[el.dataset.k] = el; });
  const svg = svgEl('svg', { class: 'pedges', width: box.width, height: box.height, 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  const mk = svgEl('marker', { id: 'parr', viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' });
  mk.appendChild(svgEl('path', { d: 'M1 1L9 5L1 9z', fill: 'context-stroke' }));
  defs.appendChild(mk);
  svg.appendChild(defs);
  const route = (x1, y1, x2, y2) => {
    if (Math.abs(x1 - x2) < 1) return { d: `M${x1} ${y1}V${y2}`, lx: x1, ly: (y1 + y2) / 2 };
    const ym = y1 + Math.max(20, Math.min(46, (y2 - y1) / 2)), dir = x2 > x1 ? 1 : -1;
    const r = Math.max(0, Math.min(10, Math.abs(x2 - x1) / 2, ym - y1 - 2, y2 - ym - 2));
    return { d: `M${x1} ${y1}V${ym - r}Q${x1} ${ym} ${x1 + dir * r} ${ym}H${x2 - dir * r}Q${x2} ${ym} ${x2} ${ym + r}V${y2}`, lx: (x1 + x2) / 2, ly: ym };
  };
  const labels = [];
  pairs.forEach(k => {
    const [a, b] = k.split('>');
    const ra = at[a].getBoundingClientRect(), rb = at[b].getBoundingClientRect();
    const x1 = ra.left + ra.width / 2 - box.left, y1 = ra.bottom - box.top, x2 = rb.left + rb.width / 2 - box.left, y2 = rb.top - box.top;
    const live = livePairs.has(k), hi = live && (picks.includes(+a) || picks.includes(+b));
    const { d, lx, ly } = route(x1, y1, x2, y2);
    const na = nodes[a], nb = nodes[b], gap = nb.start - na.end, wk = walkMin(na.building, nb.building);
    const g = svgEl('g', { class: 'pw' + (live ? ' live' : '') + (hi ? ' hi' : ''), 'data-a': a, 'data-b': b });
    g.appendChild(svgEl('path', { d, class: 'pwh' }));
    g.appendChild(svgEl('path', { d, class: 'pe', 'marker-end': 'url(#parr)' }));
    g.appendChild(svgEl('circle', { cx: x1, cy: y1, r: 4, class: 'pd' }));
    const lab = svgEl('g', { class: 'pl', transform: `translate(${lx} ${ly})` });
    const rect = svgEl('rect', { rx: 9, ry: 9 });
    const txt = svgEl('text', { 'text-anchor': 'middle', dy: '0.35em' });
    txt.textContent = `${gap} min` + (wk ? ` · ${wk} min walk` : '');
    lab.appendChild(rect);
    lab.appendChild(txt);
    g.appendChild(lab);
    svg.appendChild(g);
    labels.push([rect, txt]);
  });
  const old = canvas.querySelector('.pedges');
  if (old) old.remove();
  canvas.appendChild(svg);
  labels.forEach(([rect, txt]) => {
    const bb = txt.getBBox();
    rect.setAttribute('x', bb.x - 7); rect.setAttribute('y', bb.y - 3); rect.setAttribute('width', bb.width + 14); rect.setAttribute('height', bb.height + 6);
  });
}

const filmState = { day: 'trip', q: '', genre: '', sort: 'az' };
const SORTS = [['az', 'A to Z'], ['score', 'Highest score'], ['time', 'Earliest showtime']];

async function filmsView() {
  const [fest, data] = await Promise.all([api('/api/festival'), api('/api/films')]);
  const tripDays = fest.days.filter(d => d.candidate).map(d => d.day);
  const genres = [...new Set(data.films.map(f => (f.genre || '').trim()).filter(Boolean))].sort();
  const listEl = h('div');
  const countEl = h('p', { class: 'count' });
  const sortSel = h('select', { 'aria-label': 'Sort films', class: 'sortsel' }, SORTS.map(([v, l]) => h('option', { value: v }, l)));
  sortSel.value = filmState.sort;
  const chipsEl = h('div', { class: 'chips' });
  const search = h('input', { type: 'search', placeholder: 'Search titles', 'aria-label': 'Search titles', value: filmState.q });
  const sel = h('select', { 'aria-label': 'Genre' }, h('option', { value: '' }, 'All genres'),
    genres.map(g => h('option', { value: g }, g)));
  sel.value = filmState.genre;

  const daySet = () => (filmState.day === 'all' ? null : filmState.day === 'trip' ? tripDays : [filmState.day]);

  function update() {
    const days = daySet();
    const q = filmState.q.trim().toLowerCase();
    const rows = data.films.filter(f => {
      if (filmState.genre && (f.genre || '').trim() !== filmState.genre) return false;
      if (q && !f.title.toLowerCase().includes(q)) return false;
      return !days || f.sessions.some(s => days.includes(s.starts_at.slice(0, 10)));
    }).map(f => ({ f, title: titleCase(f.title) }));
    // the earliest showtime inside the chosen days; "Unrated" films always sink below real scores
    const firstShow = f => f.sessions.filter(x => !days || days.includes(x.starts_at.slice(0, 10))).map(x => x.starts_at).sort()[0] || '9999';
    const az = (a, b) => a.title.localeCompare(b.title);
    const cmp = {
      az,
      score: (a, b) => (isUnrated(a.f.why) - isUnrated(b.f.why)) || ((b.f.score || 0) - (a.f.score || 0)) || az(a, b),
      time: (a, b) => firstShow(a.f).localeCompare(firstShow(b.f)) || az(a, b),
    }[filmState.sort] || az;
    rows.sort(cmp);
    chipsEl.replaceChildren(
      chip('Trip days', filmState.day === 'trip', () => { filmState.day = 'trip'; update(); }),
      chip('All days', filmState.day === 'all', () => { filmState.day = 'all'; update(); }),
      ...tripDays.map(d => chip(fmtDay(d), filmState.day === d, () => { filmState.day = d; update(); }, 'trip')));
    countEl.textContent = `${rows.length} ${rows.length === 1 ? 'film' : 'films'}`;
    listEl.replaceChildren(...(rows.length ? rows.map(r => filmCard(r.f, r.title, days)) :
      [h('p', { class: 'empty' }, 'No films match. Try another day or clear the search.')]));
  }
  search.addEventListener('input', () => { filmState.q = search.value; update(); });
  sel.addEventListener('change', () => { filmState.genre = sel.value; update(); });
  sortSel.addEventListener('change', () => { filmState.sort = sortSel.value; update(); });
  screen(h('h2', null, 'Films'), chipsEl, h('div', { class: 'row' }, search, sel), h('div', { class: 'countrow' }, countEl, sortSel), listEl);
  update();
}

function filmCard(f, title, days) {
  const ts = tileScore(f.why);
  const shown = f.sessions.filter(s => !days || days.includes(s.starts_at.slice(0, 10)));
  const chips = shown.slice(0, 4).map(s => h('span', { class: 'sess' }, `${fmtDay(s.starts_at.slice(0, 10))} · ${fmtTime(s.starts_at)} · ${s.building || s.venue}`));
  if (shown.length > 4) chips.push(h('span', { class: 'sess' }, `+${shown.length - 4} more`));
  const meta = [f.runtime_min ? `${f.runtime_min} min` : '', places(f.country), (f.genre || '').trim()].filter(Boolean).join(' · ');
  return h('a', { class: 'film', href: '#/film/' + f.id },
    poster(f.poster, title, 'sm'),
    h('div', { class: 'film-body' },
      h('h3', null, h('span', null, title), ts.chip),
      h('p', { class: 'meta' }, meta), badges(f, false),
      ts.text ? h('p', { class: 'meta why-line' }, ts.text) : null, chips,
      cleanTags(f.tags).slice(0, 3).map(t => h('span', { class: 'tag' }, titleCase(t)))));
}

async function filmView(id) {
  const [fest, f] = await Promise.all([api('/api/festival'), api('/api/films/' + encodeURIComponent(id))]);
  const trip = new Set(fest.days.filter(d => d.candidate).map(d => d.day));
  const meta = [f.runtime_min ? `${f.runtime_min} min` : '', places(f.country), (f.genre || '').trim(), f.rating].filter(Boolean).join(' · ');
  const syn = h('p', { class: 'syn clamp' }, f.synopsis || '');
  const more = h('button', { type: 'button', class: 'more', onclick: () => {
    const open = syn.classList.toggle('clamp');
    more.textContent = open ? 'Read more' : 'Show less';
  } }, 'Read more');
  const long = (f.synopsis || '').length > 320;
  if (!long) syn.classList.remove('clamp');
  screen(
    h('a', { class: 'back', href: '#/films' }, '← Films'),
    h('div', { class: 'detail' },
      h('div', { class: 'hero' },
        poster(f.poster, titleCase(f.title), 'lg'),
        h('div', { class: 'hero-body' },
          h('h2', null, titleCase(f.title)),
          h('p', { class: 'meta' }, meta),
          badges(f, true),
          cleanTags(f.tags).map(t => h('span', { class: 'tag' }, titleCase(t))))),
      f.director ? h('p', { class: 'meta' }, 'Directed by ' + f.director) : null,
      f.cast && f.cast.length ? h('p', { class: 'meta' }, 'With ' + f.cast.join(', ')) : null,
      f.synopsis ? syn : null, long ? more : null,
      whyCard(f.why),
      h('h2', null, 'Showtimes'),
      h('ul', { class: 'shows' }, f.sessions.map(s => {
        const day = s.starts_at.slice(0, 10);
        return h('li', null,
          h('div', null,
            h('div', { class: 'when' }, `${fmtDay(day)} · ${fmtTime(s.starts_at)}`, trip.has(day) ? h('span', { class: 'badge' }, 'trip day') : null),
            h('div', { class: 'where' }, s.venue)));
      }))));
}

let scheduleDay = null;

async function scheduleView(day) {
  const fest = await api('/api/festival');
  const trip = fest.days.filter(d => d.candidate).map(d => d.day);
  const all = fest.days.map(d => d.day);
  scheduleDay = all.includes(day) ? day : (all.includes(scheduleDay) ? scheduleDay : (trip[0] || all[0]));
  const data = await api('/api/sessions?day=' + scheduleDay);
  const groups = {};
  data.sessions.forEach(s => { (groups[s.building || s.venue] = groups[s.building || s.venue] || []).push(s); });
  screen(
    h('h2', null, 'Schedule'),
    h('div', { class: 'chips' }, all.map(d => chip(fmtDay(d), d === scheduleDay,
      () => { location.hash = '#/schedule/' + d; }, trip.includes(d) ? 'trip' : ''))),
    Object.keys(groups).sort().map(b => [
      h('h3', { class: 'bldg' }, b),
      groups[b].map(s => h('a', { class: 'slot', href: '#/film/' + s.film_id },
        h('div', { class: 't' }, fmtTime(s.starts_at),
          h('small', null, 'to ' + fmtMin(ts(s.starts_at).min + (s.runtime_min || 0)))),
        h('div', null, h('div', { class: 'n' }, titleCase(s.title)), h('div', { class: 'v' }, s.venue))))]),
    data.sessions.length ? null : h('p', { class: 'empty' }, 'Nothing is screening this day.'));
}

// ---------------------------------------------------------------- router

const routes = [
  [/^#\/plans$/, plansView, 'plans'],
  [/^#\/plan\/(\d+)$/, planView, 'plans'],
  [/^#\/paths(?:\/(\d{4}-\d{2}-\d{2}))?$/, pathsView, 'plans'],
  [/^#\/films$/, filmsView, 'films'],
  [/^#\/film\/(ST\d+)$/, filmView, 'films'],
  [/^#\/schedule(?:\/(\d{4}-\d{2}-\d{2}))?$/, scheduleView, 'schedule'],
];

async function route() {
  const hash = location.hash || '#/plans';
  app.classList.toggle('wide', /^#\/paths/.test(hash));
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    try { await fn(m[1]); } catch (e) {
      screen(h('p', { class: 'empty' }, "Couldn't load that. Check your connection and refresh."));
    }
    window.scrollTo(0, 0);
    return;
  }
  location.hash = '#/plans';
}

api('/api/festival').then(d => {
  if (d.festival) document.getElementById('fest').textContent = d.festival.name;
}).catch(() => {});
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { if (relayout) relayout(); });
route();
})();
