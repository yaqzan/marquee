"""WIFF schedule: fetch from the festival's own public schedule action, then import into SQLite.

The site's schedule panel POSTs `get_film_schedule_films` to admin-ajax.php with a nonce printed in the
page's HTML. With session_date=all-festival-films one call returns every film and every session
(239 films / 302 sessions in 2026). We never touch Veezi's purchase pages (Cloudflare-gated).

WIFF's payload has two traps, handled in `parse_start`:
  - resolved_time holds the DATE ("Sat Oct 31") and resolved_date holds the TIME ("9:00 am").
  - Filtering by one date is unreliable (Nov 1 returned every day), so we never ask per date.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime
from html import unescape
from pathlib import Path

from . import RAW_DIR

NONCE_RE = re.compile(r'<div[^>]*\bdata-nonce="([0-9a-f]+)"[^>]*class="festival-schedule-', re.S)
SELECT_RE = re.compile(r'<select[^>]*\bname="(film_programming|film_region)"[^>]*>(.*?)</select>', re.S)
OPTION_RE = re.compile(r'<option value="(\d+)">([^<]*)</option>')
GROUPS = {"film_programming": "category", "film_region": "culture"}


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- fetch

def _request(url: str, ua: str, timeout: int, data: bytes | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def fetch_schedule(cfg: dict) -> tuple[bytes, str]:
    """Two requests: the schedule page (for the nonce and the tag labels), then the schedule action.
    Returns (raw JSON bytes, page HTML)."""
    f, fc = cfg["festival"], cfg["fetch"]
    base = f["site_url"].rstrip("/")
    _, page = _request(base + f["schedule_page"], fc["user_agent"], fc["timeout_s"])
    html = page.decode("utf-8", "replace")
    m = NONCE_RE.search(html)
    if not m:
        raise RuntimeError("schedule nonce not found in the page (site markup changed?)")
    body = urllib.parse.urlencode({
        "action": f["ajax_action"], "nonce": m.group(1),
        "session_date": f["ajax_session_date"], "is_festival_on": "on", "offset": "0",
    }).encode()
    _, raw = _request(base + f["ajax_path"], fc["user_agent"], fc["timeout_s"], data=body)
    return raw, html


def save_raw(raw: bytes, html: str) -> tuple[Path, str]:
    """Keep every distinct snapshot (named by content hash) so an import can be replayed."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(raw).hexdigest()
    path = RAW_DIR / f"schedule-{sha[:12]}.json"
    if not path.exists():
        path.write_bytes(raw)
        (RAW_DIR / f"schedule-{sha[:12]}.html").write_text(html, encoding="utf-8")
    return path, sha


# ---------------------------------------------------------------- parse

def parse_tags(html: str) -> list[tuple[str, str, str]]:
    """(code, label, group) from the Categories and Culture filter dropdowns."""
    out = []
    for name, inner in SELECT_RE.findall(html):
        for code, label in OPTION_RE.findall(inner):
            out.append((code, unescape(label).strip(), GROUPS[name]))
    return out


def parse_start(session: dict, year: int) -> tuple[str, str | None]:
    """Local start 'YYYY-MM-DDTHH:MM', and a note when it disagrees with the sales cut-off time."""
    cutoff = session.get("SalesCutOffTime") or ""
    try:
        # resolved_time is the date and resolved_date is the time: WIFF's field names are swapped
        dt = datetime.strptime(f"{session['resolved_time']} {year} {session['resolved_date']}",
                               "%a %b %d %Y %I:%M %p")
    except (KeyError, ValueError):
        if not cutoff:
            raise
        return cutoff[:16], "start taken from SalesCutOffTime"
    start = dt.strftime("%Y-%m-%dT%H:%M")
    return start, (None if not cutoff or cutoff[:16] == start else f"cutoff {cutoff[:16]} != start")


# ---------------------------------------------------------------- import

def import_payload(conn, cfg: dict, raw: bytes, html: str | None = None) -> dict:
    """Upsert the payload. Rows the payload no longer lists get removed_at (never deleted); rows that
    return clear it. Every difference lands in `change`. Idempotent: the same payload twice adds nothing."""
    data = json.loads(raw)
    if data.get("status") != "success" or not isinstance(data.get("films"), list):
        raise RuntimeError(f"unexpected payload: status={data.get('status')!r}")
    f = cfg["festival"]
    slug, year = f["slug"], int(f["starts_on"][:4])
    at = now()
    log: list[tuple[str, str, str]] = []
    notes: list[str] = []

    conn.execute("INSERT INTO festival(slug, name, starts_on, ends_on, site_url) VALUES (?,?,?,?,?) "
                 "ON CONFLICT(slug) DO UPDATE SET name=excluded.name, starts_on=excluded.starts_on, "
                 "ends_on=excluded.ends_on, site_url=excluded.site_url",
                 (slug, f["name"], f["starts_on"], f["ends_on"], f["site_url"]))

    if html:
        for code, label, group in parse_tags(html):
            conn.execute("INSERT INTO tag(code, label, group_name) VALUES (?,?,?) "
                         "ON CONFLICT(code) DO UPDATE SET label=excluded.label, group_name=excluded.group_name",
                         (code, label, group))

    baseline = conn.execute("SELECT COUNT(*) FROM film WHERE festival=?", (slug,)).fetchone()[0] == 0
    seen_films: set[str] = set()
    seen_sessions: set[int] = set()
    skipped = 0
    prod = cfg.get("products", {})
    prod_re = re.compile(prod["title_re"]) if prod.get("title_re") else None
    for fl in data["films"]:
        fid = fl.get("Id") or ""
        is_product = bool(prod_re and fl.get("Genre") == prod.get("genre") and prod_re.search(fl.get("Title") or ""))
        if not fid.startswith("ST") or is_product:  # tickets and passes are not films
            skipped += 1
            continue
        seen_films.add(fid)
        old = conn.execute("SELECT removed_at FROM film WHERE id=?", (fid,)).fetchone()
        if old is None:
            log.append(("film_added", fid, fl.get("Title", "")))
        elif old["removed_at"]:
            log.append(("film_returned", fid, fl.get("Title", "")))
        conn.execute(
            "INSERT INTO film(id, festival, title, short_name, synopsis, genre, rating, status, runtime_min, "
            "country, language, poster_url, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, short_name=excluded.short_name, "
            "synopsis=excluded.synopsis, genre=excluded.genre, rating=excluded.rating, status=excluded.status, "
            "runtime_min=excluded.runtime_min, country=excluded.country, language=excluded.language, "
            "poster_url=excluded.poster_url, last_seen=excluded.last_seen, removed_at=NULL",
            (fid, slug, fl.get("Title") or "", fl.get("ShortName"), (fl.get("Synopsis") or "").strip() or None,
             fl.get("Genre"), fl.get("Rating"), fl.get("Status"), fl.get("Duration"),
             fl.get("NationalCode"), fl.get("AudioLanguage"), fl.get("FilmPosterUrl"), at, at))
        conn.execute("DELETE FROM film_tag WHERE film_id=?", (fid,))
        conn.executemany("INSERT OR IGNORE INTO film_tag(film_id, code) VALUES (?,?)",
                         [(fid, c) for c in fl.get("Attributes") or []])

        for s in fl.get("_FilmSessions") or []:
            sid = int(s["Id"])
            seen_sessions.add(sid)
            start, note = parse_start(s, year)
            if note:
                notes.append(f"session {sid}: {note}")
            screen = (s.get("screens") or [{}])[0]
            conn.execute("INSERT INTO venue(screen_id, name, building) VALUES (?,?,?) "
                         "ON CONFLICT(screen_id) DO UPDATE SET name=excluded.name, building=excluded.building",
                         (screen.get("Id", s["ScreenId"]), screen.get("Name", f"screen {s['ScreenId']}"),
                          cfg.get("venues", {}).get(screen.get("Name"))))
            prev = conn.execute("SELECT starts_at, screen_id, removed_at FROM session WHERE id=?", (sid,)).fetchone()
            if prev is None:
                log.append(("session_added", str(sid), f"{fid} {start} screen {s['ScreenId']}"))
            else:
                if prev["starts_at"] != start or prev["screen_id"] != s["ScreenId"]:
                    log.append(("session_moved", str(sid),
                                f"{prev['starts_at']} screen {prev['screen_id']} -> {start} screen {s['ScreenId']}"))
                if prev["removed_at"]:
                    log.append(("session_returned", str(sid), f"{fid} {start}"))
            conn.execute(
                "INSERT INTO session(id, film_id, screen_id, starts_at, sales_cutoff, status, first_seen, last_seen) "
                "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET film_id=excluded.film_id, "
                "screen_id=excluded.screen_id, starts_at=excluded.starts_at, sales_cutoff=excluded.sales_cutoff, "
                "status=excluded.status, last_seen=excluded.last_seen, removed_at=NULL",
                (sid, fid, s["ScreenId"], start, s.get("SalesCutOffTime"), s.get("Status"), at, at))

    # Withdrawn: held before, not listed now. A partial payload would withdraw everything, so refuse
    # to withdraw when the payload is implausibly small next to what we hold.
    held_f = {r[0] for r in conn.execute("SELECT id FROM film WHERE festival=? AND removed_at IS NULL", (slug,))}
    held_s = {r[0] for r in conn.execute(
        "SELECT s.id FROM session s JOIN film f ON f.id=s.film_id WHERE f.festival=? AND s.removed_at IS NULL", (slug,))}
    gone_f, gone_s = held_f - seen_films, held_s - seen_sessions
    if held_s and len(seen_sessions) < 0.5 * len(held_s):
        notes.append(f"payload has {len(seen_sessions)} sessions vs {len(held_s)} held: withdrawals skipped")
        gone_f, gone_s = set(), set()
    for fid in gone_f:
        conn.execute("UPDATE film SET removed_at=? WHERE id=?", (at, fid))
        log.append(("film_removed", fid, ""))
    for sid in gone_s:
        conn.execute("UPDATE session SET removed_at=? WHERE id=?", (at, sid))
        log.append(("session_removed", str(sid), ""))

    if baseline:  # the first import is the baseline, not 540 "added" rows
        log = [("baseline", slug, f"{len(seen_films)} films, {len(seen_sessions)} sessions")]
    conn.executemany("INSERT INTO change(at, kind, ref, detail) VALUES (?,?,?,?)", [(at, *c) for c in log])
    return {"films": len(seen_films), "sessions": len(seen_sessions), "skipped": skipped,
            "changes": len(log), "notes": notes}
