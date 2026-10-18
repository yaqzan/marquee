"""Backtest: does a signal predict the owner's taste? Target = Arbiter Elo for the movies and docs they have
ranked (Arbiter's public read API; its URL is `[arbiter] url` in config.local.toml).

Reports Spearman rho for: Plex critic score, Plex audience score, and a leave-one-out genre/country/decade
taste model, then how adding that taste model to the critic score changes the fit. A signal earns weight in
config [score] only if it clears `taste_min_rho` here.
"""

from __future__ import annotations

import collections
import json
import math
import urllib.request


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


def load_items(url: str) -> list[dict]:
    items = []
    for kind in ("movie", "documentary"):
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/rank/leaderboard?type={kind}", timeout=30) as r:
            items += json.loads(r.read())["items"]
    return [i for i in items if i.get("elo_score") is not None]


def features(i: dict) -> list[str]:
    f = ["g:" + g for g in i.get("genres") or []] + ["c:" + c for c in i.get("countries") or []]
    if i.get("year"):
        f.append(f"d:{i['year'] // 10 * 10}")
    return f


def taste_loo(items: list[dict], k: float = 5.0) -> list[float]:
    """Each title predicted from every OTHER title's feature effects (shrunk by k pseudo-counts)."""
    y = [i["elo_score"] for i in items]
    mu = sum(y) / len(y)
    tot: dict[str, float] = collections.defaultdict(float)
    cnt: collections.Counter = collections.Counter()
    for it in items:
        for f in features(it):
            tot[f] += it["elo_score"] - mu
            cnt[f] += 1
    out = []
    for it in items:
        fs = features(it)
        eff = [(tot[f] - (it["elo_score"] - mu)) / (cnt[f] - 1 + k) for f in fs]
        out.append(sum(eff) / len(eff) if eff else 0.0)
    return out


def run(cfg: dict) -> list[tuple[str, float, int]]:
    url = cfg.get("arbiter", {}).get("url")
    if not url:
        raise SystemExit('Set [arbiter] url = "http://127.0.0.1:<port>" in config.local.toml')
    items = load_items(url)
    y = [i["elo_score"] for i in items]
    rows = []
    for key, label in (("critic_rating", "Plex critic score"), ("audience_rating", "Plex audience score")):
        sub = [i for i in items if i.get(key)]
        rows.append((label, spearman([i[key] for i in sub], [i["elo_score"] for i in sub]), len(sub)))
    rows.append(("Taste model: genre/country/decade (leave-one-out)", spearman(taste_loo(items), y), len(items)))
    return rows
