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
      plans.plans.map((p, i) => planTicket(p, i === 0)));
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
        h('div', { class: 'cap' }, 'screenings')))));
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
    h('div', { class: 'tl' }, events),
    p.summary ? h('div', { class: 'why' }, p.summary) : null);
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
  [/^#\/films$/, filmsView, 'films'],
  [/^#\/film\/(ST\d+)$/, filmView, 'films'],
  [/^#\/schedule(?:\/(\d{4}-\d{2}-\d{2}))?$/, scheduleView, 'schedule'],
];

async function route() {
  const hash = location.hash || '#/plans';
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
route();
})();
