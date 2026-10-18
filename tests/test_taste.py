"""Taste model: shrinkage, per-film fit, and that the backtest finds a real signal and not a leave-one-out artifact."""

import random
import unittest

from marquee import taste


def row(elo, directors=(), cast=()):
    return {"elo_score": elo, "title": "t"}, {"dir": list(directors), "cast": list(cast)}


class TestFit(unittest.TestCase):
    def test_effect_is_shrunk_toward_zero(self):
        rows = [row(1000), row(1000), row(1000), row(1200, ["Ana"])]     # owner mean = 1050
        eff = taste.fit(rows, k=3.0)
        self.assertAlmostEqual(eff["dir:Ana"], (1200 - 1050) / (1 + 3.0))

    def test_film_fit_uses_only_known_people_and_clips(self):
        eff = {"dir:Ana": 50.0, "cast:Bo": -400.0}
        self.assertIsNone(taste.film_fit(eff, ["Zed"], ["Yan"], 100))
        r = taste.film_fit(eff, ["Ana"], ["Yan"], 100)
        self.assertAlmostEqual(r["fit"], 0.5)
        self.assertEqual(r["because"], ["Ana (+50)"])
        self.assertEqual(taste.film_fit(eff, [], ["Bo"], 100)["fit"], -1.0)


class TestCrossValidation(unittest.TestCase):
    def test_finds_a_real_signal(self):
        rnd = random.Random(1)
        rows = []
        for d in range(10):                      # ten directors with four films each; Elo follows the director
            for _ in range(4):
                rows.append(row(800 + 40 * d + rnd.uniform(-5, 5), [f"D{d}"]))
        rho, covered = taste.cv_rho(rows, lambda i, m: set(taste.people(m)))
        self.assertGreater(rho, 0.8)
        self.assertGreater(covered, 30)

    def test_a_shared_label_with_noise_is_no_signal(self):
        # 60 films all tagged with one person, Elo is noise: nothing should look predictive in either direction
        # (naive leave-one-out category means, centred on the overall mean, report a strongly negative rho here).
        rnd = random.Random(2)
        rows = [row(rnd.uniform(800, 1200), ["Same"]) for _ in range(60)]
        rho, _ = taste.cv_rho(rows, lambda i, m: set(taste.people(m)), seeds=3)
        self.assertLess(abs(rho), 0.3)

    def test_spearman_handles_ties(self):
        self.assertAlmostEqual(taste.spearman([1, 2, 2, 3], [10, 20, 20, 30]), 1.0)


if __name__ == "__main__":
    unittest.main()
