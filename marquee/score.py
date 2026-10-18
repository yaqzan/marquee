"""Film scores: a pedigree prior shrunk toward critic sources by how much real data there is.

score = (sum(w_i * s_i) + prior_weight * P) / (sum(w_i) + prior_weight)      P = prior + pedigree points
confidence = sum(w_i) / (sum(w_i) + prior_weight)

With no critic data the score is just P and confidence is 0 ("unrated" on the site). A source's weight is
its configured weight times votes / (votes + half_votes), so a score from twelve IMDb votes counts for
almost nothing. The taste nudge is bounded by `taste_nudge_max` and applies only to films with a taste fit
(a director or top-billed actor the owner has ranked films for; see taste.py).
"""

from __future__ import annotations

import json

from .wiff import now


def pedigree(codes: list[str], cfg: dict) -> tuple[float, list[str]]:
    table = cfg["score"]["pedigree"]
    hit = [c for c in codes if c in table]
    return float(sum(table[c] for c in hit)), hit


def source_weight(source: str, votes: int | None, cfg: dict) -> float:
    s = cfg["score"]["sources"].get(source)
    if not s:
        return 0.0
    half = s.get("half_votes", 0)
    trust = 1.0 if not half else (votes or 0) / ((votes or 0) + half)
    return s["weight"] * trust


def score_film(codes: list[str], ratings: list[dict], cfg: dict, taste: float = 0.0, because: list[str] | None = None) -> dict:
    sc = cfg["score"]
    points, hit = pedigree(codes, cfg)
    prior = sc["prior"] + points
    used, wsum, ssum = [], 0.0, 0.0
    for r in ratings:
        w = source_weight(r["source"], r.get("votes"), cfg)
        if w <= 0:
            continue
        wsum += w
        ssum += w * r["score"]
        used.append({"source": r["source"], "score": r["score"], "votes": r.get("votes"), "weight": round(w, 3)})
    pw = sc["prior_weight"]
    base = (ssum + pw * prior) / (wsum + pw)
    nudge = max(-1.0, min(1.0, taste)) * sc["taste_nudge_max"]
    return {"score": round(base + nudge, 2), "confidence": round(wsum / (wsum + pw), 3),
            "parts": {"prior": prior, "pedigree_codes": hit, "sources": used, "taste_nudge": round(nudge, 2),
                      "taste_because": because or []}}


def score_all(conn, cfg: dict, taste: dict | None = None) -> int:
    """(Re)compute film_score for every film still in the feed. Scores are derived, so they are rebuilt freely."""
    codes: dict[str, list[str]] = {}
    for r in conn.execute("SELECT film_id, code FROM film_tag"):
        codes.setdefault(r["film_id"], []).append(r["code"])
    ratings: dict[str, list[dict]] = {}
    for r in conn.execute("SELECT film_id, source, score, votes FROM film_rating"):
        ratings.setdefault(r["film_id"], []).append(dict(r))
    at = now()
    n = 0
    for f in conn.execute("SELECT id FROM film WHERE removed_at IS NULL").fetchall():
        t = (taste or {}).get(f["id"])
        res = score_film(codes.get(f["id"], []), ratings.get(f["id"], []), cfg,
                         taste=t["fit"] if t else 0.0, because=t["because"] if t else None)
        conn.execute("INSERT INTO film_score(film_id, score, confidence, parts, scored_at) VALUES (?,?,?,?,?) "
                     "ON CONFLICT(film_id) DO UPDATE SET score=excluded.score, confidence=excluded.confidence, "
                     "parts=excluded.parts, scored_at=excluded.scored_at",
                     (f["id"], res["score"], res["confidence"], json.dumps(res["parts"]), at))
        n += 1
    return n
