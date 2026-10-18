"""Planner rules: ticket cost, walking buffers, meal windows, the late cut-off, no repeated film."""

import unittest

from marquee import load_config, planner, score
from marquee.planner import Cand, best_lineups, cost_cents, hhmm, meals_ok

CFG = load_config(local=None)
P = CFG["plan"]


def c(n, start, run, bldg="A", film=None, premium=False, genre="drama", country="x", sc=60.0):
    s = hhmm(start)
    return Cand(session_id=n, film_id=film or f"ST{n}", title=f"F{n}", starts_at=f"2026-11-07T{start}", start=s,
                end=s + run, building=bldg, genre=genre, countries=frozenset({country}), premium=premium,
                score=sc, confidence=0.0, codes=())


class TestCost(unittest.TestCase):
    def test_singles_and_premium(self):
        self.assertEqual(cost_cents([c(1, "09:00", 90), c(2, "13:00", 90), c(3, "18:00", 90)], P), 5700)
        self.assertEqual(cost_cents([c(1, "09:00", 90, premium=True), c(2, "13:00", 90), c(3, "18:00", 90)], P), 7800)

    def test_premium_three_pack_only_when_cheaper(self):
        three = [c(i, t, 90, premium=True) for i, t in enumerate(("09:00", "13:00", "18:00"), 1)]
        self.assertEqual(cost_cents(three, P), 9900)  # 3 x $40 = $120 > $99 pack


class TestRules(unittest.TestCase):
    def test_meal_windows(self):
        ok = [c(1, "09:00", 90), c(2, "13:00", 90), c(3, "18:30", 90)]
        self.assertTrue(meals_ok(ok, P))
        no_lunch = [c(1, "10:00", 120), c(2, "12:10", 120), c(3, "18:30", 90)]  # back to back across lunch
        self.assertFalse(meals_ok(no_lunch, P))
        no_dinner = [c(1, "09:00", 90), c(2, "13:00", 90), c(3, "16:35", 150)]  # film through the dinner window
        self.assertFalse(meals_ok(no_dinner, P))

    def test_walking_buffer_between_buildings(self):
        a = c(1, "09:00", 90, "A")                       # ends 10:30
        too_soon = c(2, "10:40", 90, "B")                # 10 min, needs 15 across buildings
        fine = c(3, "10:45", 90, "B")
        same = c(4, "10:35", 90, "A")                    # 5 min inside a building is enough
        late = c(5, "19:00", 90, "A")
        mid = c(6, "13:00", 90, "A")
        got = best_lineups([a, too_soon, fine, same, mid, late], CFG, top=50)
        for r in got:
            for x, y in zip(r["lineup"], r["lineup"][1:]):
                self.assertGreaterEqual(y.start, x.end + planner.buffer(x, y, P))
        pairs = {(r["lineup"][0].session_id, r["lineup"][1].session_id) for r in got}
        self.assertNotIn((1, 2), pairs)

    def test_latest_end_and_no_repeats(self):
        cands = [c(1, "09:00", 90), c(2, "13:00", 90), c(3, "18:30", 90, film="ST1"),   # same film as session 1
                 c(4, "20:30", 130)]                                                     # ends 22:40: ok
        got = best_lineups(cands, CFG)
        self.assertTrue(all(len({x.film_id for x in r["lineup"]}) == 3 for r in got))
        late = [c(1, "09:00", 90), c(2, "13:00", 90), c(3, "21:30", 90)]                 # ends 23:00
        self.assertEqual(best_lineups(late, CFG), [])

    def test_diversity_prefers_unlike_films(self):
        same = [c(1, "09:00", 90, genre="doc", country="ca"), c(2, "13:00", 90, genre="doc", country="ca"),
                c(3, "18:30", 90, genre="doc", country="ca")]
        mixed = [c(4, "09:00", 90, genre="doc", country="ca"), c(5, "13:00", 90, genre="comedy", country="fr"),
                 c(6, "18:30", 90, genre="drama", country="jp")]
        a = best_lineups(same, CFG)[0]["score"]
        b = best_lineups(mixed, CFG)[0]["score"]
        self.assertLess(a, b)


class TestScore(unittest.TestCase):
    def test_no_data_is_the_pedigree_prior(self):
        r = score.score_film(["0000000259"], [], CFG)         # Cannes
        self.assertEqual(r["score"], 58.0)
        self.assertEqual(r["confidence"], 0.0)

    def test_critics_pull_the_score_and_thin_votes_barely_count(self):
        strong = score.score_film([], [{"source": "metacritic", "score": 90, "votes": None}], CFG)
        self.assertGreater(strong["score"], 70)
        self.assertGreater(strong["confidence"], 0.5)
        thin = score.score_film([], [{"source": "imdb", "score": 90, "votes": 5}], CFG)
        self.assertLess(thin["score"] - 50, 1.0)
        self.assertLess(thin["confidence"], 0.05)

    def test_taste_nudge_is_bounded_and_can_be_switched_off(self):
        top = CFG["score"]["taste_nudge_max"]
        self.assertEqual(score.score_film([], [], CFG, taste=1.0)["score"], 50.0 + top)
        self.assertEqual(score.score_film([], [], CFG, taste=9.0)["score"], 50.0 + top)   # clipped to +1
        self.assertEqual(score.score_film([], [], CFG, taste=-9.0)["score"], 50.0 - top)
        off = {**CFG, "score": {**CFG["score"], "taste_nudge_max": 0.0}}
        self.assertEqual(score.score_film([], [], off, taste=1.0)["score"], 50.0)


if __name__ == "__main__":
    unittest.main()
