"""Smoke-test the web UI without a browser: py -3.11 ops/web_smoke.py

Copies the database to a temp dir, seeds a test plan on Sat Nov 7, serves it on 127.0.0.1:5099 and runs
ops/web_smoke.mjs (the real web/marquee.js against a stub DOM, every route). The live database and site
are never touched. Needs node. Run it after any change to web/ or the plan API.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 5099
FILMS = [("EXTRAVAGANT WAYS TO SAY GOODBYE", "09:00"), ("COWARD", "13:00"), ("FJORD", "18:25")]


def seed(db: Path) -> None:
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("DELETE FROM plan")  # the scratch copy only: start from a known plan set
    conn.execute("INSERT INTO plan(festival, day, rank, score, cost_cents, summary, built_at) "
                 "VALUES ('wiff-2026', '2026-11-07', 1, 0.9, 5700, 'Test plan: three films, two in one building.', 'test')")
    pid = conn.execute("SELECT MAX(id) FROM plan").fetchone()[0]
    for pos, (title, at) in enumerate(FILMS, 1):
        row = conn.execute("SELECT s.id FROM session s JOIN film f ON f.id = s.film_id "
                           "WHERE f.title = ? AND s.starts_at = ?", (title, f"2026-11-07T{at}")).fetchone()
        if row is None:
            sys.exit(f"seed: no session for {title} at {at}; the schedule moved, update FILMS")
        conn.execute("INSERT INTO plan_item(plan_id, position, session_id) VALUES (?,?,?)", (pid, pos, row[0]))
    conn.execute("INSERT INTO plan(festival, day, rank, cost_cents, built_at) VALUES ('wiff-2026', '2026-11-08', 2, 5700, 'test')")
    conn.commit()
    conn.close()


def main() -> int:
    live = ROOT / "marquee" / "state" / "marquee.sqlite"
    if not live.exists():
        sys.exit("no database; run `py -3.11 -m marquee fetch` first")
    tmp = Path(tempfile.mkdtemp(prefix="marquee-smoke-"))
    db = tmp / "smoke.sqlite"
    src, dst = sqlite3.connect(live), sqlite3.connect(db)
    src.backup(dst)  # a consistent copy even while the live server has the file open
    src.close()
    dst.close()
    seed(db)
    code = (f"import sys; sys.path.insert(0, {str(ROOT)!r}); import marquee.serve as s; from pathlib import Path; "
            f"s.DB_PATH = Path({str(db)!r}); s.serve(port={PORT})")
    proc = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=1).read()
                break
            except OSError:
                time.sleep(0.25)
        else:
            sys.exit("scratch server did not start")
        return subprocess.call(["node", str(ROOT / "ops" / "web_smoke.mjs")], env={**__import__("os").environ, "BASE": f"http://127.0.0.1:{PORT}"})
    finally:
        proc.terminate()  # only the process started here
        proc.wait(timeout=10)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
