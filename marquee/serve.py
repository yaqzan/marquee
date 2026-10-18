"""The public server: web/ plus a read-only JSON API over the SQLite database, on 127.0.0.1 only.

Read-only by design (no auth, no input surface): GET and HEAD, nothing else. The database is opened
read-only per request, so nothing here can write.
"""

from __future__ import annotations

import json
import mimetypes
import re
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import DB_PATH, WEB_DIR, __version__, load_config, store

HOST, PORT = "127.0.0.1", 5007
STALE_HOURS = 72  # a schedule older than this means refreshes are failing (WIFF edits it during the run)
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILM_RE = re.compile(r"^ST\d+$")
SOURCE_NAMES = {"metacritic": "Metacritic", "rt": "Rotten Tomatoes", "imdb": "IMDb", "tmdb": "TMDB"}


def _conn() -> sqlite3.Connection:
    return store.connect(DB_PATH, readonly=True)


def _rows(conn, sql: str, args: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args)]


def health() -> dict:
    """Always 200 while the server is up (the watchdog restarts on anything else); `stale` says whether
    the data is fresh."""
    out = {"ok": True, "version": __version__, "last_fetch": None, "age_hours": None,
           "films": None, "sessions": None, "stale": True}
    try:
        with _conn() as c:
            row = c.execute("SELECT fetched_at FROM fetch_log WHERE http_status=200 ORDER BY id DESC LIMIT 1").fetchone()
            out["films"] = c.execute("SELECT COUNT(*) FROM film WHERE removed_at IS NULL").fetchone()[0]
            out["sessions"] = c.execute("SELECT COUNT(*) FROM session WHERE removed_at IS NULL").fetchone()[0]
    except sqlite3.Error:
        return out
    if row:
        age = (datetime.now().astimezone() - datetime.fromisoformat(row[0])).total_seconds() / 3600
        out.update(last_fetch=row[0], age_hours=round(age, 1), stale=age >= STALE_HOURS)
    return out


def _value(source: str, score: float) -> str:
    return f"{score:.0f}%" if source == "rt" else f"{score:.0f}" if source == "metacritic" else f"{score / 10:.1f}"


def score_view(c, cfg: dict, film_id: str, labels: dict | None = None) -> dict | None:
    """The film's score and why: critic scores used, festival tags (with points), the people behind a taste nudge."""
    r = c.execute("SELECT score, confidence, parts FROM film_score WHERE film_id=?", (film_id,)).fetchone()
    if not r:
        return None
    parts = json.loads(r["parts"])
    labels = labels if labels is not None else {x["code"]: x["label"] for x in c.execute("SELECT code, label FROM tag")}
    ped = cfg["score"]["pedigree"]
    critics = [{"source": x["source"], "name": SOURCE_NAMES.get(x["source"], x["source"]), "value": _value(x["source"], x["score"]),
                "votes": x.get("votes"), "minor": x["weight"] < 0.25} for x in parts["sources"]]
    tags = [{"label": labels.get(code, code), "points": ped.get(code, 0)} for code in parts["pedigree_codes"]]
    nudge = parts.get("taste_nudge", 0)
    conf = r["confidence"]
    reasons = [f"{x['name']} {x['value']}" for x in critics if not x["minor"]] + [t["label"] for t in tags]
    if nudge:
        reasons.append(f"Taste {nudge:+.1f}: " + ", ".join(parts.get("taste_because", [])[:2]))
    return {"score": r["score"], "confidence": conf,
            "coverage": "Festival tags only" if conf < 0.15 else "Some critic scores" if conf < 0.5 else "Well covered",
            "base": cfg["score"]["prior"], "critics": critics, "tags": tags,
            "taste": {"nudge": nudge, "because": parts.get("taste_because", [])}, "reasons": reasons}


def festival(c) -> dict:
    cfg = load_config()
    fest = _rows(c, "SELECT * FROM festival ORDER BY starts_on DESC LIMIT 1")
    if not fest:
        return {"festival": None}
    cand = set(cfg["plan"]["candidate_days"])
    days = _rows(c, "SELECT substr(s.starts_at,1,10) AS day, COUNT(*) AS sessions, COUNT(DISTINCT s.film_id) AS films "
                    "FROM session s WHERE s.removed_at IS NULL GROUP BY day ORDER BY day")
    for d in days:
        d["candidate"] = d["day"] in cand
    venues = _rows(c, "SELECT screen_id, name, building FROM venue ORDER BY building, name")
    return {"festival": fest[0], "days": days, "venues": venues}


SESSION_COLS = ("s.id AS session_id, s.film_id, s.starts_at, s.status, v.screen_id, v.name AS venue, "
                "v.building, f.title, f.runtime_min")


def films(c, q: dict) -> dict:
    where, args = ["f.removed_at IS NULL"], []
    if "q" in q:
        where.append("(f.title LIKE ? OR f.synopsis LIKE ?)")
        args += [f"%{q['q'][0]}%"] * 2
    if "genre" in q:
        where.append("f.genre = ?")
        args.append(q["genre"][0])
    if "country" in q:
        where.append("f.country = ?")
        args.append(q["country"][0])
    if "tag" in q:
        where.append("EXISTS (SELECT 1 FROM film_tag t WHERE t.film_id=f.id AND t.code=?)")
        args.append(q["tag"][0])
    if "day" in q and DAY_RE.match(q["day"][0]):
        where.append("EXISTS (SELECT 1 FROM session s WHERE s.film_id=f.id AND s.removed_at IS NULL "
                     "AND substr(s.starts_at,1,10)=?)")
        args.append(q["day"][0])
    rows = _rows(c, "SELECT f.id, f.title, f.genre, f.country, f.runtime_min, f.rating, f.language, f.poster_url "
                    f"FROM film f WHERE {' AND '.join(where)} ORDER BY f.title", tuple(args))
    tags = {}
    for r in c.execute("SELECT t.film_id, t.code, COALESCE(g.label, t.code) AS label FROM film_tag t "
                       "LEFT JOIN tag g ON g.code=t.code"):
        tags.setdefault(r["film_id"], []).append({"code": r["code"], "label": r["label"]})
    sc = {x["film_id"]: x for x in c.execute("SELECT film_id, score, confidence FROM film_score")}
    for r in rows:
        r["score"] = sc[r["id"]]["score"] if r["id"] in sc else None
        r["confidence"] = sc[r["id"]]["confidence"] if r["id"] in sc else None
        r["tags"] = tags.get(r["id"], [])
        r["sessions"] = _rows(c, "SELECT s.id AS session_id, s.starts_at, s.status, v.name AS venue, v.building "
                                 "FROM session s JOIN venue v ON v.screen_id=s.screen_id "
                                 "WHERE s.film_id=? AND s.removed_at IS NULL ORDER BY s.starts_at", (r["id"],))
    return {"films": rows}


def film(c, fid: str) -> dict | None:
    rows = _rows(c, "SELECT * FROM film WHERE id=?", (fid,))
    if not rows:
        return None
    out = rows[0]
    out["tags"] = _rows(c, "SELECT t.code, COALESCE(g.label, t.code) AS label, g.group_name FROM film_tag t "
                           "LEFT JOIN tag g ON g.code=t.code WHERE t.film_id=?", (fid,))
    meta = c.execute("SELECT director, cast_json, year, match FROM film_meta WHERE film_id=?", (fid,)).fetchone()
    out["director"] = meta["director"] if meta else None
    out["cast"] = json.loads(meta["cast_json"] or "[]") if meta else []
    out["year"] = meta["year"] if meta else None
    out["why"] = score_view(c, load_config(), fid)
    out["sessions"] = _rows(c, "SELECT s.id AS session_id, s.starts_at, s.status, v.name AS venue, v.building "
                               "FROM session s JOIN venue v ON v.screen_id=s.screen_id "
                               "WHERE s.film_id=? AND s.removed_at IS NULL ORDER BY s.starts_at", (fid,))
    return out


def sessions(c, day: str) -> dict:
    return {"day": day, "sessions": _rows(
        c, f"SELECT {SESSION_COLS} FROM session s JOIN film f ON f.id=s.film_id JOIN venue v ON v.screen_id=s.screen_id "
           "WHERE s.removed_at IS NULL AND f.removed_at IS NULL AND substr(s.starts_at,1,10)=? ORDER BY s.starts_at", (day,))}


def plans(c, day: str | None) -> dict:
    where, args = "", ()
    if day:
        where, args = "WHERE p.day=?", (day,)
    out = _rows(c, f"SELECT p.id, p.day, p.rank, p.score, p.cost_cents, p.summary, p.built_at FROM plan p {where} "
                   "ORDER BY p.rank", args)
    cfg = load_config()
    labels = {x["code"]: x["label"] for x in c.execute("SELECT code, label FROM tag")}
    for p in out:
        p["items"] = _rows(c, f"SELECT i.position, i.note, {SESSION_COLS} FROM plan_item i "
                              "JOIN session s ON s.id=i.session_id JOIN film f ON f.id=s.film_id "
                              "JOIN venue v ON v.screen_id=s.screen_id WHERE i.plan_id=? ORDER BY i.position", (p["id"],))
        for it in p["items"]:
            it["why"] = score_view(c, cfg, it["film_id"], labels)
    return {"plans": out}


def api(path: str, q: dict) -> tuple[int, dict]:
    try:
        with _conn() as c:
            if path == "/api/festival":
                return 200, festival(c)
            if path == "/api/films":
                return 200, films(c, q)
            m = re.match(r"^/api/films/([^/]+)$", path)
            if m:
                data = film(c, m.group(1)) if FILM_RE.match(m.group(1)) else None
                return (200, data) if data else (404, {"error": "no such film"})
            if path == "/api/sessions":
                day = q.get("day", [""])[0]
                return (200, sessions(c, day)) if DAY_RE.match(day) else (400, {"error": "day=YYYY-MM-DD required"})
            if path == "/api/plans":
                day = q.get("day", [""])[0]
                return 200, plans(c, day if DAY_RE.match(day) else None)
    except sqlite3.Error:
        return 503, {"error": "no data yet"}
    return 404, {"error": "not found"}


class Handler(BaseHTTPRequestHandler):
    server_version = "marquee"

    def _send(self, code: int, body: bytes, ctype: str, cache: str = "no-cache"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj: dict):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):  # noqa: N802
        parts = urlsplit(self.path)
        path = parts.path
        if path == "/api/health":
            return self._json(200, health())
        if path.startswith("/api/"):
            code, obj = api(path, parse_qs(parts.query))
            return self._json(code, obj)
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        if "." not in rel.rsplit("/", 1)[-1]:
            rel += ".html"
        target = (WEB_DIR / rel).resolve()
        if WEB_DIR.resolve() not in target.parents or not target.is_file():
            return self._send(404, b"Not found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    do_HEAD = do_GET

    def log_message(self, fmt, *args):
        pass


def serve(host: str = HOST, port: int = PORT) -> None:
    print(f"marquee serving http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
