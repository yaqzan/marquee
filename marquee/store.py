"""SQLite store: schema and connections. Everything the site shows is read from here."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import DB_PATH, STATE_DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS festival (
    slug       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    starts_on  TEXT NOT NULL,
    ends_on    TEXT NOT NULL,
    site_url   TEXT NOT NULL
);

-- One row per screen WIFF reports. building groups screens for walking time.
CREATE TABLE IF NOT EXISTS venue (
    screen_id  INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    building   TEXT
);

-- Filter codes from the schedule page: group_name is 'category' or 'culture'.
CREATE TABLE IF NOT EXISTS tag (
    code       TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS film (
    id           TEXT PRIMARY KEY,          -- WIFF/Veezi film id, e.g. ST00004238
    festival     TEXT NOT NULL REFERENCES festival(slug),
    title        TEXT NOT NULL,             -- as WIFF prints it (ALL CAPS)
    short_name   TEXT,
    synopsis     TEXT,
    genre        TEXT,
    rating       TEXT,                      -- age rating, e.g. STC, NR, R
    status       TEXT,
    runtime_min  INTEGER,
    country      TEXT,                      -- WIFF's NationalCode, e.g. CANADA
    language     TEXT,
    poster_url   TEXT,
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    removed_at   TEXT                       -- set when a fetch no longer lists the film
);

CREATE TABLE IF NOT EXISTS film_tag (
    film_id TEXT NOT NULL REFERENCES film(id) ON DELETE CASCADE,
    code    TEXT NOT NULL,                  -- tag.code; unknown codes are kept, label resolved later
    PRIMARY KEY (film_id, code)
);

CREATE TABLE IF NOT EXISTS session (
    id           INTEGER PRIMARY KEY,       -- Veezi session id
    film_id      TEXT NOT NULL REFERENCES film(id) ON DELETE CASCADE,
    screen_id    INTEGER NOT NULL REFERENCES venue(screen_id),
    starts_at    TEXT NOT NULL,             -- local festival time, ISO 'YYYY-MM-DDTHH:MM'
    sales_cutoff TEXT,
    status       TEXT,                      -- WIFF's: Open, Closed, ...
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    removed_at   TEXT                       -- set when a fetch no longer lists the session
);
CREATE INDEX IF NOT EXISTS session_day ON session(substr(starts_at, 1, 10));
CREATE INDEX IF NOT EXISTS session_film ON session(film_id);

-- Enrichment: who made the film and where it was matched (TMDB), and the critic scores found for it.
CREATE TABLE IF NOT EXISTS film_meta (
    film_id    TEXT PRIMARY KEY REFERENCES film(id) ON DELETE CASCADE,
    tmdb_id    INTEGER,
    imdb_id    TEXT,
    director   TEXT,
    year       INTEGER,
    match      TEXT NOT NULL,               -- 'runtime', 'title', 'none' (how the TMDB match was made)
    note       TEXT,
    fetched_at TEXT NOT NULL,               -- the TMDB lookup
    omdb_at    TEXT                         -- the OMDb lookup (own daily budget); NULL = not yet
);
CREATE TABLE IF NOT EXISTS film_rating (
    film_id    TEXT NOT NULL REFERENCES film(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,               -- metacritic, rt, imdb, tmdb
    score      REAL NOT NULL,               -- normalised to 0-100
    votes      INTEGER,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (film_id, source)
);
-- The computed score and the parts it came from (rebuilt by `marquee plan`).
CREATE TABLE IF NOT EXISTS film_score (
    film_id    TEXT PRIMARY KEY REFERENCES film(id) ON DELETE CASCADE,
    score      REAL NOT NULL,
    confidence REAL NOT NULL,               -- 0 = pedigree prior only, toward 1 = mostly real sources
    parts      TEXT NOT NULL,               -- JSON: prior, pedigree tags, sources used
    scored_at  TEXT NOT NULL
);

-- Every network fetch, for the min-interval guard and for knowing how fresh the data is.
CREATE TABLE IF NOT EXISTS fetch_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at TEXT NOT NULL,
    source     TEXT NOT NULL,
    http_status INTEGER,
    films      INTEGER,
    sessions   INTEGER,
    sha256     TEXT,
    raw_path   TEXT,
    note       TEXT
);

-- What an import changed: film_added, session_added, session_removed, session_moved, ...
CREATE TABLE IF NOT EXISTS change (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     TEXT NOT NULL,
    kind   TEXT NOT NULL,
    ref    TEXT NOT NULL,
    detail TEXT
);

-- Day-plan packages (built by the planner; empty until it exists).
CREATE TABLE IF NOT EXISTS plan (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    festival    TEXT NOT NULL REFERENCES festival(slug),
    day         TEXT NOT NULL,              -- 'YYYY-MM-DD'
    rank        INTEGER NOT NULL,           -- 1 = best across the festival's candidate days
    score       REAL,
    cost_cents  INTEGER,
    summary     TEXT,
    built_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_item (
    plan_id    INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    session_id INTEGER NOT NULL REFERENCES session(id),
    note       TEXT,
    PRIMARY KEY (plan_id, position)
);
"""


def connect(path: Path = DB_PATH, readonly: bool = False) -> sqlite3.Connection:
    """Read-write by default (creating the schema); readonly for the public server."""
    if readonly:
        conn = sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True)
    else:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
