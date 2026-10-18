"""Enrichment against fake API responses (the documented TMDB / OMDb shapes). No network, no keys."""

import unittest

from marquee import enrich, load_config, store

CFG = {**load_config(local=None), "keys": {"tmdb": "k", "omdb": "k"}}
CFG["enrich"] = {**CFG["enrich"], "sleep_s": 0}


def fake(routes, calls=None):
    def getj(url, headers=None):
        if calls is not None:
            calls.append(url)
        for frag, resp in routes.items():
            if frag in url:
                return resp if isinstance(resp, tuple) else (200, resp)
        return 404, {}
    return getj


SEARCH = {"results": [
    {"id": 1, "title": "Coward", "release_date": "2009-01-01"},                   # too old
    {"id": 2, "title": "Coward", "original_title": "Lâche", "release_date": "2025-05-20"},
    {"id": 3, "title": "Coward", "release_date": "2026-02-01"}]}


def det(runtime, imdb="tt100", director="Lukas Dhont"):
    return {"runtime": runtime, "imdb_id": imdb, "vote_average": 7.2, "vote_count": 340,
            "credits": {"crew": [{"job": "Director", "name": director}, {"job": "Writer", "name": "X"}]}}


class TestMatch(unittest.TestCase):
    def film(self, title="COWARD", run=120):
        return {"title": title, "runtime_min": run}

    def test_runtime_picks_the_right_candidate(self):
        g = fake({"/search/movie": SEARCH, "/movie/2": det(95, "tt2"), "/movie/3": det(121, "tt3")})
        m = enrich.match_tmdb(self.film(), "k", CFG, g)
        self.assertEqual((m["match"], m["tmdb_id"], m["imdb_id"], m["director"], m["year"]), ("runtime", 3, "tt3", "Lukas Dhont", 2026))
        self.assertEqual((m["tmdb_rating"], m["tmdb_votes"]), (72.0, 340))

    def test_lone_exact_title_is_a_weaker_match(self):
        one = {"results": [{"id": 2, "title": "Coward", "release_date": "2025-05-20"}]}
        g = fake({"/search/movie": one, "/movie/2": det(90)})
        self.assertEqual(enrich.match_tmdb(self.film(), "k", CFG, g)["match"], "title")

    def test_no_match_is_none_with_a_reason(self):
        g = fake({"/search/movie": {"results": [{"id": 1, "title": "Coward", "release_date": "2009-01-01"}]}})
        m = enrich.match_tmdb(self.film(), "k", CFG, g)
        self.assertEqual(m["match"], "none")
        self.assertIn("no recent TMDB hit", m["note"])

    def test_trailing_article_and_jwt_header(self):
        self.assertEqual(enrich.search_title("DEBUT, THE"), "THE DEBUT")
        seen = {}
        def g(url, headers=None):
            seen.update(headers or {}); return 200, {"results": []}
        enrich.match_tmdb(self.film(), "eyJabc", CFG, g)
        self.assertEqual(seen.get("Authorization"), "Bearer eyJabc")

    def test_throttle_and_bad_key_stop_the_run(self):
        with self.assertRaises(enrich.Stop):
            enrich.match_tmdb(self.film(), "k", CFG, fake({"/search/movie": (429, {})}))
        with self.assertRaises(enrich.Stop):
            enrich.match_tmdb(self.film(), "k", CFG, fake({"/search/movie": (401, {})}))


class TestOmdb(unittest.TestCase):
    def test_parse_formats_and_na(self):
        body = {"Response": "True", "Metascore": "78", "imdbRating": "7.4", "imdbVotes": "12,345",
                "Ratings": [{"Source": "Internet Movie Database", "Value": "7.4/10"},
                            {"Source": "Rotten Tomatoes", "Value": "91%"}]}
        got = {r["source"]: r for r in enrich.parse_omdb(body)}
        self.assertEqual((got["metacritic"]["score"], got["rt"]["score"], got["imdb"]["score"], got["imdb"]["votes"]),
                         (78.0, 91.0, 74.0, 12345))
        self.assertEqual(enrich.parse_omdb({"Response": "True", "Metascore": "N/A", "imdbRating": "N/A", "Ratings": []}), [])
        self.assertEqual(enrich.parse_omdb({"Response": "False", "Error": "Incorrect IMDb ID."}), [])

    def test_daily_limit_message_stops(self):
        with self.assertRaises(enrich.Stop):
            enrich.fetch_omdb("tt1", "k", fake({"omdbapi": (200, {"Response": "False", "Error": "Request limit reached!"})}))


class TestRun(unittest.TestCase):
    def db(self):
        conn = store.connect(":memory:")
        conn.execute("INSERT INTO festival VALUES ('wiff-2026','W','2026-10-29','2026-11-08','x')")
        for i, (t, r) in enumerate([("COWARD", 120), ("NOWHERE", 80)], 1):
            conn.execute("INSERT INTO film(id, festival, title, runtime_min, first_seen, last_seen) VALUES (?,?,?,?,?,?)",
                         (f"ST{i}", "wiff-2026", t, r, "t", "t"))
        return conn

    def test_walks_once_stores_ratings_and_does_not_repeat(self):
        conn, calls = self.db(), []
        routes = {"query=NOWHERE": {"results": []}, "/search/movie": SEARCH, "/movie/2": det(95), "/movie/3": det(121, "tt3"),
                  "omdbapi": {"Response": "True", "Metascore": "80", "imdbRating": "7.0", "imdbVotes": "900", "Ratings": []}}
        st = enrich.run(conn, CFG, getj=fake(routes, calls), sleep=lambda s: None)
        self.assertEqual((st["matched"], st["unmatched"], st["omdb"]), (1, 1, 1))
        got = {r["source"]: r["score"] for r in conn.execute("SELECT source, score FROM film_rating WHERE film_id='ST1'")}
        self.assertEqual(got, {"tmdb": 72.0, "metacritic": 80.0, "imdb": 70.0})
        n = len(calls)
        enrich.run(conn, CFG, getj=fake(routes, calls), sleep=lambda s: None)
        self.assertEqual(len(calls), n, "a second run must not look anything up again")

    def test_throttle_keeps_what_was_stored(self):
        conn = self.db()
        routes = {"query=NOWHERE": (429, {}), "/search/movie": SEARCH, "/movie/2": det(95), "/movie/3": det(121, "tt3"),
                  "omdbapi": {"Response": "True", "Metascore": "80", "Ratings": []}}
        st = enrich.run(conn, CFG, getj=fake(routes), sleep=lambda s: None)
        self.assertIn("throttling", st["stopped"])
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM film_meta").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
