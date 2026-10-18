"""Enrichment: match each WIFF film to TMDB (directors, imdb id, audience score), then OMDb for Metacritic,
Rotten Tomatoes and IMDb. Keys live in config.local.toml [keys] (gitignored); nothing runs without them.

Matching is by runtime, because WIFF gives no year: search TMDB by title, keep recent candidates, fetch their
details, take the one whose runtime is within `runtime_tolerance_min` of WIFF's. A lone exact-title recent hit
with no runtime match is accepted as a weaker 'title' match; anything else is 'none' and retried later.

Walk fully once, then incremental (owner rule for every fetcher): a film with film_meta is not looked up again
(a 'none' only after `retry_none_days`); OMDb has its own daily budget and resumes where it stopped.
A 429 stops the run so the next run cools down; it is never retried in a loop.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

from .wiff import now

TMDB = "https://api.themoviedb.org/3"
OMDB = "https://www.omdbapi.com/"


class Stop(Exception):
    """A throttle or a rejected key: end the run, keep what was stored."""


def get_json(url: str, headers: dict | None = None, timeout: int = 30) -> tuple[int, dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "Marquee/0.1", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except ValueError:
            return e.code, {}


def search_title(title: str) -> str:
    t = title.strip()
    m = re.match(r"^(.*), (THE|A|AN)$", t, re.I)
    return f"{m.group(2)} {m.group(1)}" if m else t


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", search_title(s).lower())


def _check(status: int, what: str) -> None:
    if status == 429:
        raise Stop(f"{what} is throttling (429); stopping so the next run cools down")
    if status in (401, 403):
        raise Stop(f"{what} rejected the key ({status}); check config.local.toml [keys]")


def tmdb_get(path: str, key: str, getj, **params) -> dict:
    headers, q = {}, dict(params)
    if key.startswith("eyJ"):  # the v4 read-access token is a JWT
        headers["Authorization"] = "Bearer " + key
    else:
        q["api_key"] = key
    status, body = getj(f"{TMDB}{path}?{urllib.parse.urlencode(q)}", headers)
    _check(status, "TMDB")
    return body if status == 200 else {}


def match_tmdb(film: dict, key: str, cfg: dict, getj=get_json, sleep=lambda s: None) -> dict:
    """-> {match, tmdb_id, imdb_id, director, year, tmdb_rating, tmdb_votes, note}"""
    e = cfg["enrich"]
    out = {"match": "none", "tmdb_id": None, "imdb_id": None, "director": None, "cast": [], "year": None,
           "tmdb_rating": None, "tmdb_votes": None, "note": None}
    res = tmdb_get("/search/movie", key, getj, query=search_title(film["title"]), include_adult="false").get("results", [])
    cands = [r for r in res if (r.get("release_date") or "0000")[:4].isdigit()
             and int((r.get("release_date") or "0000")[:4]) >= e["min_year"]][:5]
    if not cands:
        out["note"] = f"no recent TMDB hit among {len(res)} results"
        return out
    pick, how = None, None
    details = {}
    for r in cands:
        sleep(e["sleep_s"])
        d = tmdb_get(f"/movie/{r['id']}", key, getj, append_to_response="credits,external_ids")
        details[r["id"]] = d
        rt = d.get("runtime")
        if film.get("runtime_min") and rt and abs(rt - film["runtime_min"]) <= e["runtime_tolerance_min"]:
            pick, how = r, "runtime"
            break
    if pick is None:
        exact = [r for r in cands if norm(r.get("title") or "") == norm(film["title"])
                 or norm(r.get("original_title") or "") == norm(film["title"])]
        if len(exact) == 1:
            pick, how = exact[0], "title"
    if pick is None:
        out["note"] = f"{len(cands)} recent candidates, none with runtime near {film.get('runtime_min')}"
        return out
    d = details[pick["id"]]
    crew = (d.get("credits") or {}).get("crew") or []
    out.update(match=how, tmdb_id=pick["id"],
               imdb_id=d.get("imdb_id") or (d.get("external_ids") or {}).get("imdb_id") or None,
               director=", ".join(c["name"] for c in crew if c.get("job") == "Director") or None,
               cast=top_cast(d),
               year=int(pick["release_date"][:4]),
               tmdb_rating=round(d["vote_average"] * 10, 1) if d.get("vote_count") else None,
               tmdb_votes=d.get("vote_count"))
    return out


def top_cast(details: dict, n: int = 4) -> list[str]:
    return [c["name"] for c in ((details.get("credits") or {}).get("cast") or [])[:n]]


def parse_omdb(body: dict) -> list[dict]:
    """OMDb -> [{source, score 0-100, votes}]. 'N/A' and missing fields are skipped."""
    if body.get("Response") != "True":
        return []
    out = []
    ms = body.get("Metascore")
    if ms and ms != "N/A":
        out.append({"source": "metacritic", "score": float(ms), "votes": None})
    for r in body.get("Ratings") or []:
        if r.get("Source") == "Rotten Tomatoes" and r.get("Value", "").endswith("%"):
            out.append({"source": "rt", "score": float(r["Value"][:-1]), "votes": None})
    imdb = body.get("imdbRating")
    if imdb and imdb != "N/A":
        votes = body.get("imdbVotes", "").replace(",", "")
        out.append({"source": "imdb", "score": round(float(imdb) * 10, 1), "votes": int(votes) if votes.isdigit() else None})
    return out


def fetch_omdb(imdb_id: str, key: str, getj=get_json) -> list[dict]:
    status, body = getj(f"{OMDB}?{urllib.parse.urlencode({'i': imdb_id, 'apikey': key})}", {})
    if status == 429 or (status == 401) or "limit reached" in str(body.get("Error", "")).lower():
        raise Stop("OMDb daily limit or key problem: " + str(body.get("Error", status)))
    return parse_omdb(body) if status == 200 else []


def _store_rating(conn, film_id: str, r: dict, at: str) -> None:
    conn.execute("INSERT INTO film_rating(film_id, source, score, votes, fetched_at) VALUES (?,?,?,?,?) "
                 "ON CONFLICT(film_id, source) DO UPDATE SET score=excluded.score, votes=excluded.votes, "
                 "fetched_at=excluded.fetched_at", (film_id, r["source"], r["score"], r["votes"], at))


def run(conn, cfg: dict, limit: int | None = None, getj=get_json, sleep=time.sleep) -> dict:
    keys = cfg.get("keys", {})
    if not keys.get("tmdb") or not keys.get("omdb"):
        raise SystemExit("Add your keys to config.local.toml:\n[keys]\ntmdb = \"...\"\nomdb = \"...\"")
    e = cfg["enrich"]
    stats = {"matched": 0, "unmatched": 0, "omdb": 0, "backfilled": 0, "stopped": None}
    cutoff = (datetime.now().astimezone() - timedelta(days=e["retry_none_days"])).isoformat(timespec="seconds")
    todo = conn.execute(
        "SELECT f.id, f.title, f.runtime_min FROM film f LEFT JOIN film_meta m ON m.film_id = f.id "
        "WHERE f.removed_at IS NULL AND (m.film_id IS NULL OR (m.match = 'none' AND m.fetched_at < ?)) "
        "ORDER BY f.title", (cutoff,)).fetchall()
    try:
        for f in todo[:limit]:
            sleep(e["sleep_s"])
            m = match_tmdb(dict(f), keys["tmdb"], cfg, getj, sleep)
            at = now()
            conn.execute("INSERT INTO film_meta(film_id, tmdb_id, imdb_id, director, cast_json, year, match, note, fetched_at) "
                         "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(film_id) DO UPDATE SET tmdb_id=excluded.tmdb_id, "
                         "imdb_id=excluded.imdb_id, director=excluded.director, cast_json=excluded.cast_json, "
                         "year=excluded.year, match=excluded.match, note=excluded.note, fetched_at=excluded.fetched_at",
                         (f["id"], m["tmdb_id"], m["imdb_id"], m["director"], json.dumps(m["cast"]), m["year"],
                          m["match"], m["note"], at))
            if m["tmdb_rating"] is not None:
                _store_rating(conn, f["id"], {"source": "tmdb", "score": m["tmdb_rating"], "votes": m["tmdb_votes"]}, at)
            stats["matched" if m["match"] != "none" else "unmatched"] += 1
            conn.commit()
        # Films matched before cast was stored: one credits call each, once.
        for b in conn.execute("SELECT film_id, tmdb_id FROM film_meta WHERE match != 'none' AND tmdb_id IS NOT NULL "
                              "AND cast_json IS NULL").fetchall():
            sleep(e["sleep_s"])
            d = tmdb_get(f"/movie/{b['tmdb_id']}", keys["tmdb"], getj, append_to_response="credits")
            conn.execute("UPDATE film_meta SET cast_json = ? WHERE film_id = ?", (json.dumps(top_cast(d)), b["film_id"]))
            stats["backfilled"] += 1
            conn.commit()
        used = 0
        pending = conn.execute("SELECT m.film_id, m.imdb_id FROM film_meta m JOIN film f ON f.id = m.film_id "
                               "WHERE f.removed_at IS NULL AND m.imdb_id IS NOT NULL AND m.omdb_at IS NULL").fetchall()
        for p in pending:
            if used >= e["omdb_daily_budget"]:
                stats["stopped"] = f"OMDb budget {e['omdb_daily_budget']} used; run again tomorrow"
                break
            sleep(e["sleep_s"])
            at = now()
            for r in fetch_omdb(p["imdb_id"], keys["omdb"], getj):
                _store_rating(conn, p["film_id"], r, at)
            conn.execute("UPDATE film_meta SET omdb_at = ? WHERE film_id = ?", (at, p["film_id"]))
            used += 1
            stats["omdb"] += 1
            conn.commit()
    except Stop as s:
        conn.commit()
        stats["stopped"] = str(s)
    return stats
