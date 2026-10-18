"""Day-plan optimizer: the best 3-film lineup for each candidate day, ranked across days.

A day has about 30 sessions, so every valid lineup is enumerated (depth-first, films in start order) and the
best kept; no solver. A lineup is valid when:
  - each film starts after the previous one ends plus the walking buffer (small inside a building, larger
    between buildings), and no film repeats;
  - the first film starts no earlier than `earliest_start` and the last ends by `latest_end` (home by 1 am);
  - total runtime is within `max_total_runtime_min`;
  - a free block of `meal_min_gap_min` fits inside BOTH the lunch and the dinner window (free time = the
    gap between films less the walking buffer, plus the time before the first and after the last).
Lineup score = mean film score minus `diversity_weight` * mean pairwise similarity (same genre, shared country).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from itertools import combinations

from .wiff import now


def hhmm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def fmt(minutes: float) -> str:
    m = int(round(minutes)) % 1440
    return f"{(m // 60) % 12 or 12}:{m % 60:02d} {'am' if m < 720 else 'pm'}"


@dataclass(frozen=True)
class Cand:
    session_id: int
    film_id: str
    title: str
    starts_at: str
    start: int
    end: int
    building: str
    genre: str
    countries: frozenset
    premium: bool
    score: float
    confidence: float
    codes: tuple


def load_day(conn, cfg: dict, day: str) -> list[Cand]:
    p = cfg["plan"]
    rows = conn.execute(
        "SELECT s.id sid, s.film_id, s.starts_at, f.title, f.runtime_min, f.genre, f.country, "
        "v.building, v.name venue, COALESCE(fs.score, ?) score, COALESCE(fs.confidence, 0) conf "
        "FROM session s JOIN film f ON f.id = s.film_id JOIN venue v ON v.screen_id = s.screen_id "
        "LEFT JOIN film_score fs ON fs.film_id = f.id "
        "WHERE s.removed_at IS NULL AND f.removed_at IS NULL AND substr(s.starts_at, 1, 10) = ? "
        "ORDER BY s.starts_at, s.id", (cfg["score"]["prior"], day)).fetchall()
    codes: dict[str, list[str]] = {}
    for r in conn.execute("SELECT film_id, code FROM film_tag"):
        codes.setdefault(r["film_id"], []).append(r["code"])
    out = []
    for r in rows:
        start = hhmm(r["starts_at"][11:16])
        if start < hhmm(p["earliest_start"]):
            continue
        cs = codes.get(r["film_id"], [])
        out.append(Cand(
            session_id=r["sid"], film_id=r["film_id"], title=r["title"], starts_at=r["starts_at"], start=start,
            end=start + (r["runtime_min"] or 120), building=r["building"] or r["venue"],
            genre=(r["genre"] or "").strip().lower(),
            countries=frozenset(c.strip().lower() for c in (r["country"] or "").split(",") if c.strip()),
            premium=p["premium_tag_code"] in cs, score=r["score"], confidence=r["conf"], codes=tuple(cs)))
    return out


def buffer(a: Cand, b: Cand, p: dict) -> int:
    return p["buffer_same_building_min"] if a.building == b.building else p["buffer_between_buildings_min"]


def similarity(a: Cand, b: Cand) -> float:
    return min(1.0, 0.5 * (a.genre != "" and a.genre == b.genre) + 0.5 * bool(a.countries & b.countries))


def meals_ok(lineup: list[Cand], p: dict) -> bool:
    inf = 10 ** 6
    segs = [(-inf, lineup[0].start)]
    segs += [(a.end, b.start - buffer(a, b, p)) for a, b in zip(lineup, lineup[1:])]
    segs.append((lineup[-1].end, inf))
    for lo, hi in (p["lunch_window"], p["dinner_window"]):
        ws, we = hhmm(lo), hhmm(hi)
        if max(max(0, min(e, we) - max(s, ws)) for s, e in segs) < p["meal_min_gap_min"]:
            return False
    return True


def cost_cents(lineup: list[Cand], p: dict) -> int:
    singles = sum(p["price_premium_cents"] if c.premium else p["price_single_cents"] for c in lineup)
    if len(lineup) == 3 and all(c.premium for c in lineup):
        return min(singles, p["price_premium_3pack_cents"])
    return singles


def lineup_valid(lineup: list[Cand], p: dict) -> bool:
    return (lineup[-1].end <= hhmm(p["latest_end"])
            and sum(c.end - c.start for c in lineup) <= p["max_total_runtime_min"]
            and meals_ok(lineup, p))


def evaluate(lineup: list[Cand], cfg: dict) -> dict:
    p, sc = cfg["plan"], cfg["score"]
    mean = sum(c.score for c in lineup) / len(lineup)
    pairs = list(combinations(lineup, 2))
    sim = sum(similarity(a, b) for a, b in pairs) / len(pairs) if pairs else 0.0
    changes = sum(a.building != b.building for a, b in zip(lineup, lineup[1:]))
    return {"lineup": lineup, "score": round(mean - sc["diversity_weight"] * sim, 2), "mean": round(mean, 2),
            "similarity": round(sim, 2), "changes": changes, "cost": cost_cents(lineup, p),
            "confidence": round(sum(c.confidence for c in lineup) / len(lineup), 3)}


def best_lineups(cands: list[Cand], cfg: dict, top: int = 3) -> list[dict]:
    p = cfg["plan"]
    n = p["films_per_day"]
    found: list[dict] = []

    def rec(chosen: list[Cand], from_i: int):
        if len(chosen) == n:
            if lineup_valid(chosen, p):
                found.append(evaluate(list(chosen), cfg))
            return
        for i in range(from_i, len(cands)):
            c = cands[i]
            if chosen:
                prev = chosen[-1]
                if c.film_id in {x.film_id for x in chosen} or c.start < prev.end + buffer(prev, c, p):
                    continue
            chosen.append(c)
            rec(chosen, i + 1)
            chosen.pop()

    rec([], 0)
    found.sort(key=lambda r: (-r["score"], r["changes"], r["cost"], r["lineup"][0].start))
    return found[:top]


def summary(res: dict, cfg: dict, labels: dict[str, str]) -> str:
    p = cfg["plan"]
    ln = res["lineup"]
    drive = p["drive_hours"] * 60
    leave = ln[0].start - p["arrival_buffer_min"] - drive
    home = ln[-1].end + drive
    tags: dict[str, int] = {}
    for c in ln:
        for code in c.codes:
            if code in cfg["score"]["pedigree"]:
                name = " ".join(w if w in ("WIFF", "TV") else w.capitalize() for w in labels.get(code, code).split())
                tags[name] = tags.get(name, 0) + 1
    parts = [f"{len(ln)} films from {fmt(ln[0].start)} to {fmt(ln[-1].end)}, "
             + ("all in one building." if res["changes"] == 0 else
                f"{res['changes']} building change{'s' if res['changes'] > 1 else ''}."),
             f"Leave {p.get('home_label', 'home')} by {fmt(leave)}, back about {fmt(home)}."]
    if tags:
        parts.append("Festival picks: " + ", ".join(f"{k}{' x' + str(v) if v > 1 else ''}" for k, v in tags.items()) + ".")
    parts.append(f"${res['cost'] // 100} at the single-ticket price.")
    if res["confidence"] < 0.5:
        parts.append("Ranked on festival tags only for now; critic scores are not in yet.")
    return " ".join(parts)


def build(conn, cfg: dict, days: list[str] | None = None) -> list[dict]:
    """Best lineup per day, ranked, written to plan / plan_item (derived data, rebuilt freely)."""
    days = days or cfg["plan"]["candidate_days"]
    slug = cfg["festival"]["slug"]
    labels = {r["code"]: r["label"] for r in conn.execute("SELECT code, label FROM tag")}
    per_day = []
    for day in days:
        top = best_lineups(load_day(conn, cfg, day), cfg)
        if top:
            per_day.append({"day": day, "best": top[0], "alts": top[1:]})
    per_day.sort(key=lambda d: (-d["best"]["score"], d["best"]["cost"], d["day"]))
    conn.execute("DELETE FROM plan WHERE festival = ?", (slug,))
    at = now()
    for rank, d in enumerate(per_day, 1):
        b = d["best"]
        cur = conn.execute("INSERT INTO plan(festival, day, rank, score, cost_cents, summary, built_at) VALUES (?,?,?,?,?,?,?)",
                           (slug, d["day"], rank, b["score"], b["cost"], summary(b, cfg, labels), at))
        for pos, c in enumerate(b["lineup"], 1):
            note = "Premium screening" if c.premium else None
            conn.execute("INSERT INTO plan_item(plan_id, position, session_id, note) VALUES (?,?,?,?)",
                         (cur.lastrowid, pos, c.session_id, note))
        d["rank"] = rank
    return per_day
