"""Taste from people: directors and top-billed cast of the titles the owner has ranked in Arbiter.

Validated by `marquee backtest` (10-fold cross-validation against Arbiter Elo): director+cast rho ~0.26, while
genre / country / decade / keywords carry no signal. So the model is one number per person: the shrunk mean
Elo of the ranked films they appear in, relative to the owner's average. A WIFF film's taste fit is the mean
over its people who also appear in a ranked film (None if nobody does), scaled by `taste_scale_elo` and
clipped to [-1, 1]; `score.py` turns that into a bounded nudge.

Arbiter is read live over its public read API (`[arbiter] url` in config.local.toml); the TMDB credits of
the ranked titles are cached in marquee/state/arbiter_tmdb.json and only missing titles are fetched.
"""

from __future__ import annotations

import collections
import json
import math
import random
import time
import urllib.request

from . import STATE_DIR, enrich

CACHE = STATE_DIR / "arbiter_tmdb.json"


# ---------------------------------------------------------------- stats

def ranks(x: list[float]) -> list[float]:
    order = sorted(range(len(x)), key=lambda i: x[i])
    out = [0.0] * len(x)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and x[order[j + 1]] == x[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def pearson(a: list[float], b: list[float]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a))
    sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb) if sa and sb else float("nan")


def spearman(a: list[float], b: list[float]) -> float:
    return pearson(ranks(a), ranks(b))


# ---------------------------------------------------------------- data

def load_items(url: str) -> list[dict]:
    items = []
    for kind in ("movie", "documentary"):
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/rank/leaderboard?type={kind}", timeout=30) as r:
            items += json.loads(r.read())["items"]
    return [i for i in items if i.get("elo_score") is not None]


def ranked(cfg: dict, getj=enrich.get_json, sleep=time.sleep) -> list[tuple[dict, dict]]:
    """[(arbiter item, {'dir': [...], 'cast': [...]})] for every ranked title TMDB knows."""
    url = cfg.get("arbiter", {}).get("url")
    key = cfg.get("keys", {}).get("tmdb")
    if not url or not key:
        raise RuntimeError('needs [arbiter] url and [keys] tmdb in config.local.toml')
    items = load_items(url)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    for n, i in enumerate(x for x in items if x.get("tmdb_id") and str(x["tmdb_id"]) not in cache):
        sleep(cfg["enrich"]["sleep_s"] / 2)
        d = enrich.tmdb_get(f"/movie/{i['tmdb_id']}", key, getj, append_to_response="credits")
        crew = (d.get("credits") or {}).get("crew") or []
        cache[str(i["tmdb_id"])] = {"dir": [c["name"] for c in crew if c.get("job") == "Director"], "cast": enrich.top_cast(d)}
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache), encoding="utf-8")
    return [(i, cache[str(i["tmdb_id"])]) for i in items if str(i.get("tmdb_id")) in cache]


# ---------------------------------------------------------------- model

def people(m: dict, kinds=("dir", "cast")) -> list[str]:
    return [f"{k}:{x}" for k in kinds for x in m.get(k, [])]


def fit(rows: list[tuple[dict, dict]], k: float = 3.0) -> dict[str, float]:
    """feature -> shrunk mean Elo relative to the owner's mean (k pseudo-counts of zero)."""
    y = [i["elo_score"] for i, _ in rows]
    mu = sum(y) / len(y)
    tot: dict[str, float] = collections.defaultdict(float)
    cnt: collections.Counter = collections.Counter()
    for (i, m), v in zip(rows, y):
        for f in people(m):
            tot[f] += v - mu
            cnt[f] += 1
    return {f: tot[f] / (cnt[f] + k) for f in tot}


def film_fit(effects: dict[str, float], directors: list[str], cast: list[str], scale: float) -> dict | None:
    hits = [(f, effects[f]) for f in people({"dir": directors, "cast": cast}) if f in effects]
    if not hits:
        return None
    mean = sum(e for _, e in hits) / len(hits)
    return {"fit": max(-1.0, min(1.0, mean / scale)),
            "because": [f"{f.split(':', 1)[1]} ({e:+.0f})" for f, e in sorted(hits, key=lambda h: -abs(h[1]))[:3]]}


def wiff_fits(conn, cfg: dict, effects: dict[str, float]) -> dict[str, dict]:
    scale = cfg["score"]["taste_scale_elo"]
    out = {}
    for r in conn.execute("SELECT film_id, director, cast_json FROM film_meta WHERE match != 'none'"):
        d = [x.strip() for x in (r["director"] or "").split(",") if x.strip()]
        res = film_fit(effects, d, json.loads(r["cast_json"] or "[]"), scale)
        if res:
            out[r["film_id"]] = res
    return out


# ---------------------------------------------------------------- validation

def cv_rho(rows, featfn, folds: int = 10, seeds: int = 5, k: float = 3.0) -> tuple[float, int]:
    """Mean Spearman of out-of-fold predictions vs Elo over `seeds` shuffles, and films with any prediction.
    Cross-validation, not leave-one-out: exact LOO on category means forces a negative correlation inside a
    group (each film's prediction is the group total minus its own score), which fakes a failing signal."""
    y = [i["elo_score"] for i, _ in rows]
    feats = [featfn(i, m) for i, m in rows]
    rhos, covered = [], 0
    for seed in range(seeds):
        idx = list(range(len(rows)))
        random.Random(seed).shuffle(idx)
        pred, cov = [0.0] * len(rows), [False] * len(rows)
        for f in range(folds):
            test = set(idx[f::folds])
            train = [j for j in idx if j not in test]
            mu = sum(y[j] for j in train) / len(train)
            tot: dict[str, float] = collections.defaultdict(float)
            cnt: collections.Counter = collections.Counter()
            for j in train:
                for x in feats[j]:
                    tot[x] += y[j] - mu
                    cnt[x] += 1
            for j in test:
                e = [tot[x] / (cnt[x] + k) for x in feats[j] if cnt[x]]
                if e:
                    pred[j], cov[j] = sum(e) / len(e), True
        rhos.append(spearman(pred, y))
        covered = sum(cov)
    return sum(rhos) / len(rhos), covered
