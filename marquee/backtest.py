"""Backtest: which signals predict the owner's taste? Target = Arbiter Elo for the movies and docs they have
ranked (Arbiter's public read API; `[arbiter] url` in config.local.toml). Out-of-fold Spearman rho; a signal
earns weight in config [score] only if it clears `taste_min_rho`. See taste.cv_rho for why this is
cross-validation and not leave-one-out.
"""

from __future__ import annotations

from . import taste


def run(cfg: dict) -> list[tuple[str, float, int, bool]]:
    """-> [(label, rho, films scored, is the signal the planner uses)]"""
    rows = taste.ranked(cfg)
    items = [i for i, _ in rows]
    out = []
    for key, label in (("critic_rating", "Plex critic score"), ("audience_rating", "Plex audience score")):
        sub = [i for i in items if i.get(key)]
        out.append((label, taste.spearman([i[key] for i in sub], [i["elo_score"] for i in sub]), len(sub), False))

    def generic(i, m):
        f = {"g:" + g for g in i.get("genres") or []} | {"c:" + c for c in i.get("countries") or []}
        return f | ({f"d:{i['year'] // 10 * 10}"} if i.get("year") else set())

    for label, fn, used in (
            ("Genre + country + decade", generic, False),
            ("Director", lambda i, m: set(taste.people(m, ("dir",))), False),
            ("Top-billed cast", lambda i, m: set(taste.people(m, ("cast",))), False),
            ("Director + cast", lambda i, m: set(taste.people(m)), True)):
        rho, n = taste.cv_rho(rows, fn)
        out.append((label + " (10-fold CV)", rho, n, used))
    return out
