"""Poster cache: resize + flatten, walk-once behaviour, retry of failures, stop on a throttle."""

import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from marquee import load_config, posters, store
from marquee.enrich import Stop

CFG = {**load_config(local=None)}
CFG["posters"] = {**CFG["posters"], "sleep_s": 0}


def png(w=800, h=1200, alpha=False) -> bytes:
    im = Image.new("RGBA" if alpha else "RGB", (w, h), (255, 0, 0, 0) if alpha else (200, 30, 30))
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


class TestToJpeg(unittest.TestCase):
    def test_shrinks_and_keeps_aspect(self):
        data, w, h = posters.to_jpeg(png(800, 1200), 360, 80)
        self.assertEqual((w, h), (360, 540))
        self.assertEqual(data[:3], b"\xff\xd8\xff")

    def test_never_upscales_and_flattens_transparency(self):
        data, w, h = posters.to_jpeg(png(100, 150, alpha=True), 360, 80)
        self.assertEqual((w, h), (100, 150))
        px = Image.open(io.BytesIO(data)).convert("RGB").getpixel((50, 75))
        self.assertGreater(min(px), 240)   # transparent red became white, not black or red


class TestRun(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = posters.POSTER_DIR
        posters.POSTER_DIR = Path(self.tmp.name)
        self.conn = store.connect(":memory:")
        self.conn.execute("INSERT INTO festival VALUES ('wiff-2026','W','2026-10-29','2026-11-08','x')")
        for i in (1, 2):
            self.conn.execute("INSERT INTO film(id, festival, title, poster_url, first_seen, last_seen) VALUES (?,?,?,?,?,?)",
                              (f"ST{i}", "wiff-2026", f"F{i}", f"http://x/p{i}?isHighRes=true", "t", "t"))

    def tearDown(self):
        posters.POSTER_DIR = self.old
        self.tmp.cleanup()

    def test_walks_once_and_refetches_only_a_changed_url(self):
        calls = []
        def getb(url, ua, timeout, max_bytes):
            calls.append(url)
            return png()
        st = posters.run(self.conn, CFG, getb=getb, sleep=lambda s: None)
        self.assertEqual((st["fetched"], st["failed"]), (2, 0))
        self.assertTrue((Path(self.tmp.name) / "ST1.jpg").exists())
        posters.run(self.conn, CFG, getb=getb, sleep=lambda s: None)
        self.assertEqual(len(calls), 2, "a second run must not download anything again")
        self.conn.execute("UPDATE film SET poster_url = 'http://x/new?isHighRes=true' WHERE id = 'ST2'")
        posters.run(self.conn, CFG, getb=getb, sleep=lambda s: None)
        self.assertEqual(len(calls), 3)
        self.assertIn("new", calls[-1])

    def test_a_bad_image_is_counted_and_retried_not_fatal(self):
        n = {"i": 0}
        def getb(url, ua, timeout, max_bytes):
            n["i"] += 1
            return b"not an image" if "p1" in url else png()
        st = posters.run(self.conn, CFG, getb=getb, sleep=lambda s: None)
        self.assertEqual((st["fetched"], st["failed"]), (1, 1))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM film_poster").fetchone()[0], 1)

    def test_throttle_stops_the_run_and_keeps_earlier_posters(self):
        def getb(url, ua, timeout, max_bytes):
            if "p2" in url:
                raise Stop("poster host answered 429")
            return png()
        st = posters.run(self.conn, CFG, getb=getb, sleep=lambda s: None)
        self.assertEqual(st["fetched"], 1)
        self.assertIn("429", st["stopped"])


if __name__ == "__main__":
    unittest.main()
