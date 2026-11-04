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

// Rotten Tomatoes style badges: tomato for critics, popcorn for audiences. The server says fresh or not.
// (RT's own audience score has no open source, so the audience badge is IMDb, else TMDB, and says which.)
function badges(o, big) {
  const size = big ? 30 : 18;
  const one = (kind, fresh, value, label, title) => h('span', { class: 'bdg', title },
    h('img', { src: `/icons/${kind}-${fresh ? (kind === 'tomato' ? 'fresh' : 'full') : (kind === 'tomato' ? 'rotten' : 'spilled')}.svg?v=1`,
      alt: '', width: size, height: size }),
    h('span', { class: 'bdg-n' }, value + '%'),
    big ? h('span', { class: 'bdg-l' }, label) : null);
  const bits = [];
  if (o.rt) bits.push(one('tomato', o.rt.fresh, o.rt.score, 'Critics', 'Rotten Tomatoes critics ' + o.rt.score + '%'));
  if (o.audience) bits.push(one('popcorn', o.audience.fresh, o.audience.score, 'Audience (' + o.audience.source + ')', 'Audience score from ' + o.audience.source));
  return bits.length ? h('div', { class: 'bdgs' + (big ? ' big' : '') }, bits) : null;
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
const SLOTS = ['First film', 'Second film', 'Third film'];
let relayout = null;
let openTile = null;

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

async function pathsView(dayArg) {
  const fest = await api('/api/festival');
  const trip = fest.days.filter(d => d.candidate).map(d => d.day);
  const day = trip.includes(dayArg) ? dayArg : trip[0];
  const data = await api('/api/paths?day=' + day);
  const nodes = Object.fromEntries(data.nodes.map(n => [n.session_id, n]));
  const buildings = [...new Set(data.nodes.map(n => n.building))].sort();
  const bcol = b => BCOL[buildings.indexOf(b) % BCOL.length];
  const st = pathState[day] || (pathState[day] = { picks: [null, null, null], t: null, show: data.default_show });
  const firstStarts = data.nodes.map(n => n.start);
  const tMin = Math.floor(Math.min(...firstStarts, 1440) / 30) * 30, tMax = Math.max(...firstStarts, 0);
  const wrap = h('div', { class: 'pwrap' });
  const sum = h('div', { class: 'psum' });
  const cursorEl = h('span', { class: 'pcur' });
  const slider = h('input', { type: 'range', min: tMin, max: tMax, step: 5, value: st.t == null ? tMin : st.t, 'aria-label': 'Free from' });
  const showEl = h('div', { class: 'chips' });
  const baseOf = () => data.lineups.slice(0, st.show);
  const consistent = (L, p) => p.every((x, j) => !x || L.s[j] === x);

  function pick(i, sid) {
    const p = st.picks.slice();
    if (p[i] === sid) p[i] = null;
    else {
      p[i] = sid;
      if (!baseOf().some(L => consistent(L, p))) { p.fill(null); p[i] = sid; }  // a pick that clashes replaces the old ones
    }
    st.picks = p;
    if (p.some(Boolean)) st.t = null;
    render();
  }

  function render() {
    const base = baseOf();
    const picked = st.picks.some(Boolean);
    const live = base.filter(L => consistent(L, st.picks) && (picked || st.t == null || L.s.every(s => nodes[s].start >= st.t)));
    const liveAt = [0, 1, 2].map(i => new Set(live.map(L => L.s[i])));
    const lastEnd = Math.max(0, ...st.picks.filter(Boolean).map(s => nodes[s].end));
    const cursor = picked ? lastEnd : st.t;
    cursorEl.textContent = cursor == null ? 'Free from any time' : (picked ? 'Free again at ' : 'Free from ') + fmtMin(cursor);
    slider.value = cursor == null ? tMin : Math.min(tMax, Math.max(tMin, cursor));

    const rows = [0, 1, 2].map(i => {
      const ids = [...new Set(base.map(L => L.s[i]))].sort((a, b) => nodes[a].start - nodes[b].start || a - b);
      const a = ids.length ? fmtMin(nodes[ids[0]].start) : '', z = ids.length ? fmtMin(nodes[ids[ids.length - 1]].start) : '';
      const span = a === z ? 'at ' + a : `${a} to ${z}`;
      return h('section', { class: 'prow' },
        h('h3', null, SLOTS[i], h('small', null, span)),
        h('div', { class: 'ptiles' }, ids.map(sid => {
          const n = nodes[sid], on = st.picks[i] === sid, alive = liveAt[i].has(sid);
          const key = titleCase(n.title);
          const frame = h('div', { class: 'pframe', role: 'button', tabindex: '0', 'aria-label': `${key}: show options` },
            poster(n.poster, key, 'pt'), scoreBadge(n),
            on ? h('div', { class: 'pmark' }, 'Picked') : null,
            h('div', { class: 'pover' },
              h('button', { type: 'button', class: 'ppick', 'aria-pressed': on ? 'true' : 'false', onclick: e => { e.stopPropagation(); pick(i, sid); } }, on ? 'Release' : 'Pick'),
              h('a', { class: 'pgo', href: '#/film/' + n.film_id, onclick: e => e.stopPropagation() }, 'Film page')));
          const t = h('div', { class: 'ptile' + (on ? ' on' : '') + (alive ? '' : ' dead'), 'data-k': i + ':' + sid }, frame,
            h('div', { class: 'ptime' }, h('span', { class: 'bdot', style: 'background:' + bcol(n.building) }), fmtMin(n.start), h('small', null, 'ends ' + fmtMin(n.end))),
            h('a', { class: 'pname', href: '#/film/' + n.film_id }, key));
          const toggle = () => {
            if (openTile && openTile !== t) openTile.classList.remove('open');
            t.classList.toggle('open');
            openTile = t.classList.contains('open') ? t : null;
          };
          frame.addEventListener('click', toggle);
          frame.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
          return t;
        })));
    });
    wrap.replaceChildren(...rows.flatMap((r, i) => (i ? [h('div', { class: 'pgap' }), r] : [r])));
    relayout = () => edges(wrap, live, st.picks);

    const best = live[0];
    const lines = [];
    if (!live.length) lines.push(h('p', { class: 'note' }, 'No full plan fits this. Move the time earlier or tap Pick again to release a film.'));
    else {
      const full = st.picks.every(Boolean);
      lines.push(h('p', { class: 'note' }, full ? 'Your plan' : `${live.length} ${live.length === 1 ? 'plan' : 'plans'} still possible. Best from here:`));
      lines.push(h('div', { class: 'why' },
        best.s.map((sid, k) => [k ? h('div', { class: 'meta gap' }, `${nodes[sid].start - nodes[best.s[k - 1]].end} min between${nodes[sid].building !== nodes[best.s[k - 1]].building ? ', and a walk' : ''}`) : null,
          h('div', null, `${fmtMin(nodes[sid].start)} – ${fmtMin(nodes[sid].end)}  `, h('a', { href: '#/film/' + nodes[sid].film_id }, titleCase(nodes[sid].title)), ` · ${nodes[sid].building}`)]),
        h('div', { class: 'meta' }, `Score ${best.score.toFixed(1)} · ${money(best.cost)} · ${best.changes ? best.changes + ' building change' + (best.changes > 1 ? 's' : '') : 'all in one building'}`)));
    }
    sum.replaceChildren(...lines);
    showEl.replaceChildren(
      chip(`Top ${data.default_show}`, st.show === data.default_show, () => setShow(data.default_show)),
      chip(`Top ${data.more_show}`, st.show === data.more_show, () => setShow(data.more_show)),
      chip(`Everything (${data.lineups.length})`, st.show === data.lineups.length, () => setShow(data.lineups.length)));
    if (window.requestAnimationFrame) window.requestAnimationFrame(() => relayout && relayout());
  }

  function setShow(n) { st.show = Math.min(n, data.lineups.length); st.picks = [null, null, null]; render(); }
  slider.addEventListener('input', () => { st.t = +slider.value; st.picks = [null, null, null]; render(); });

  screen(
    h('a', { class: 'back', href: '#/plans' }, '← Plans'),
    h('h2', null, 'Every option: ' + fmtDay(day)),
    h('div', { class: 'chips' }, trip.map(d => chip(fmtDay(d), d === day, () => { location.hash = '#/paths/' + d; }, 'trip'))),
    h('p', { class: 'note' }, 'Each row is a film slot. Lines join films that can follow each other with time to get out, grab popcorn and walk over. Where lines meet in a dot, those films lead to the same choices. Tap a poster for the film, Pick to lock it in.'),
    h('div', { class: 'pbar' }, cursorEl, slider,
      h('button', { type: 'button', class: 'chip', onclick: () => { st.picks = [null, null, null]; st.t = null; render(); } }, 'Reset')),
    h('div', { class: 'pleg' }, buildings.map(b => h('span', null, h('span', { class: 'bdot', style: 'background:' + bcol(b) }), b))),
    wrap, sum, h('p', { class: 'meta' }, 'Show:'), showEl);
  render();
}

// Lines between the tiles of neighbouring rows (browser only: needs layout). Live pairs only.
function edges(wrap, live, picks) {
  if (!wrap.getBoundingClientRect || !document.createElementNS) return;
  const box = wrap.getBoundingClientRect();
  const at = {};
  wrap.querySelectorAll('.ptile').forEach(el => { at[el.dataset.k] = el; });
  const svg = svgEl('svg', { class: 'pedges', width: box.width, height: box.height, 'aria-hidden': 'true' });
  const top = k => { const r = at[k].getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.top - box.top]; };
  const bot = k => { const r = at[k].getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.bottom - box.top]; };
  const curve = (a, b, hi) => svg.appendChild(svgEl('path', { d: `M${a[0]} ${a[1]}C${a[0]} ${(a[1] + b[1]) / 2} ${b[0]} ${(a[1] + b[1]) / 2} ${b[0]} ${b[1]}`, class: 'pe' + (hi ? ' hi' : '') }));
  for (const i of [0, 1]) {
    const succ = new Map();
    live.forEach(L => { if (!succ.has(L.s[i])) succ.set(L.s[i], new Set()); succ.get(L.s[i]).add(L.s[i + 1]); });
    const groups = new Map();
    for (const [a, set] of succ) { const sig = [...set].sort((x, y) => x - y).join(); groups.set(sig, (groups.get(sig) || []).concat(a)); }
    for (const [sig, members] of groups) {
      const outs = sig.split(',').map(Number);
      if (members.length < 2) { members.forEach(a => outs.forEach(b => curve(bot(i + ':' + a), top((i + 1) + ':' + b), picks[i] === a || picks[i + 1] === b))); continue; }
      const src = members.map(a => bot(i + ':' + a)), dst = outs.map(b => top((i + 1) + ':' + b));
      const jx = [...src, ...dst].reduce((s, p) => s + p[0], 0) / (src.length + dst.length);
      const jy = (Math.max(...src.map(p => p[1])) + Math.min(...dst.map(p => p[1]))) / 2;
      const hiIn = members.some(a => picks[i] === a);
      members.forEach((a, k) => curve(src[k], [jx, jy], picks[i] === a));
      outs.forEach((b, k) => curve([jx, jy], dst[k], hiIn || picks[i + 1] === b));
      svg.appendChild(svgEl('circle', { cx: jx, cy: jy, r: 5, class: 'pj' + (hiIn ? ' hi' : '') }));
    }
  }
  const old = wrap.querySelector('.pedges');
  if (old) old.remove();
  wrap.insertBefore(svg, wrap.firstChild);
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
