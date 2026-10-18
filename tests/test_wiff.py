"""Importer traps: swapped date/time fields, ticket products, idempotency, withdrawal guard."""

import json
import sqlite3
import unittest

from marquee import load_config, store, wiff


def session(sid, film, date, time, screen=1, name="Kelly - Capitol Theatre"):
    return {"Id": sid, "FilmId": film, "ScreenId": screen, "Status": "Open",
            "SalesCutOffTime": "", "resolved_time": date, "resolved_date": time,  # WIFF swaps these
            "screens": [{"Id": screen, "Name": name}]}


def film(fid, title, sessions, genre="Drama"):
    return {"Id": fid, "Title": title, "Genre": genre, "Duration": 90, "NationalCode": "CANADA",
            "Attributes": ["0000000147"], "_FilmSessions": sessions}


def payload(*films):
    return json.dumps({"status": "success", "films": list(films)}).encode()


def fresh():
    conn = store.connect(":memory:")
    return conn, load_config(local=None)


class TestWiff(unittest.TestCase):
    def test_start_uses_swapped_fields(self):
        start, note = wiff.parse_start(session(1, "ST1", "Sat Oct 31", "9:00 am"), 2026)
        self.assertEqual(start, "2026-10-31T09:00")
        start, _ = wiff.parse_start(session(2, "ST1", "Sun Nov 1", "11:20 pm"), 2026)
        self.assertEqual(start, "2026-11-01T23:20")

    def test_start_falls_back_to_cutoff(self):
        s = session(3, "ST1", "garbage", "garbage")
        s["SalesCutOffTime"] = "2026-11-07T15:30:00"
        self.assertEqual(wiff.parse_start(s, 2026)[0], "2026-11-07T15:30")

    def test_products_are_skipped_and_import_is_idempotent(self):
        conn, cfg = fresh()
        raw = payload(
            film("ST100", "NEVERMAN", [session(10, "ST100", "Sat Oct 31", "9:00 am")]),
            film("ST200", "2026 FESTIVAL PASS", [session(20, "ST200", "Sun Nov 8", "11:00 pm", 9, "PASSHOLDER")],
                 genre="Alternative Content"))
        res = wiff.import_payload(conn, cfg, raw)
        self.assertEqual((res["films"], res["sessions"], res["skipped"]), (1, 1, 1))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM venue").fetchone()[0], 1)
        res = wiff.import_payload(conn, cfg, raw)
        self.assertEqual(res["changes"], 0)

    def test_withdrawal_and_return(self):
        conn, cfg = fresh()
        a = film("ST1", "A", [session(1, "ST1", "Sat Oct 31", "9:00 am"), session(2, "ST1", "Sat Oct 31", "1:00 pm")])
        wiff.import_payload(conn, cfg, payload(a))
        a1 = film("ST1", "A", [session(1, "ST1", "Sat Oct 31", "9:00 am")])
        wiff.import_payload(conn, cfg, payload(a1))
        gone = conn.execute("SELECT removed_at FROM session WHERE id=2").fetchone()[0]
        self.assertIsNotNone(gone)
        wiff.import_payload(conn, cfg, payload(a))
        self.assertIsNone(conn.execute("SELECT removed_at FROM session WHERE id=2").fetchone()[0])
        kinds = {r[0] for r in conn.execute("SELECT kind FROM change")}
        self.assertTrue({"baseline", "session_removed", "session_returned"} <= kinds)

    def test_tiny_payload_withdraws_nothing(self):
        conn, cfg = fresh()
        many = [film(f"ST{i}", f"F{i}", [session(i, f"ST{i}", "Sat Oct 31", "9:00 am")]) for i in range(1, 11)]
        wiff.import_payload(conn, cfg, payload(*many))
        res = wiff.import_payload(conn, cfg, payload(many[0]))  # a truncated response
        self.assertTrue(any("withdrawals skipped" in n for n in res["notes"]))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM session WHERE removed_at IS NOT NULL").fetchone()[0], 0)

    def test_tag_options_parse(self):
        html = ('<select name="film_programming" id="x"><option value="-">Categories</option>'
                '<option value="0000000259">CANNES</option></select>'
                '<select name="film_region"><option value="0000000147">Canadian</option></select>')
        self.assertEqual(wiff.parse_tags(html), [("0000000259", "CANNES", "category"), ("0000000147", "Canadian", "culture")])


if __name__ == "__main__":
    unittest.main()
