"""py -3.11 -m marquee fetch|import|show|serve

fetch    pull the WIFF schedule (2 requests), keep the raw snapshot, import into the database
import   re-import a saved snapshot (marquee/state/raw/schedule-*.json), no network
enrich   match films to TMDB and pull critic scores from OMDb (needs [keys] in config.local.toml)
posters  cache each film's WIFF poster locally (resized); only new or changed ones are fetched
backtest does critic score or a taste model predict the owner's Arbiter ranking? (Spearman)
plan     score every film, then find and store the best lineup per candidate day (ranked)
show     print what the database holds, per day and venue
serve    the public site on 127.0.0.1:5007
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from . import RAW_DIR, backtest, enrich, load_config, planner, posters, score, store, taste, wiff


def cmd_fetch(args) -> int:
    cfg = load_config()
    conn = store.connect()
    min_gap = cfg["fetch"]["min_interval_minutes"]
    last = conn.execute("SELECT fetched_at FROM fetch_log WHERE http_status=200 ORDER BY id DESC LIMIT 1").fetchone()
    if last and not args.force:
        age = (datetime.now().astimezone() - datetime.fromisoformat(last[0])).total_seconds() / 60
        if age < min_gap:
            print(f"last fetch {age:.0f} min ago (< {min_gap}); use --force to fetch again")
            return 0
    try:
        raw, html = wiff.fetch_schedule(cfg)
    except Exception as e:  # keep the previous data; record the failure
        conn.execute("INSERT INTO fetch_log(fetched_at, source, http_status, note) VALUES (?,?,?,?)",
                     (wiff.now(), "wiff-ajax", None, f"failed: {e}"))
        conn.commit()
        print(f"fetch failed: {e}", file=sys.stderr)
        return 1
    path, sha = wiff.save_raw(raw, html)
    res = wiff.import_payload(conn, cfg, raw, html)
    conn.execute("INSERT INTO fetch_log(fetched_at, source, http_status, films, sessions, sha256, raw_path, note) "
                 "VALUES (?,?,?,?,?,?,?,?)",
                 (wiff.now(), "wiff-ajax", 200, res["films"], res["sessions"], sha, path.name, "; ".join(res["notes"]) or None))
    conn.commit()
    print(f"imported {res['films']} films, {res['sessions']} sessions, {res['changes']} changes"
          + (f" ({res['skipped']} non-film rows skipped)" if res["skipped"] else ""))
    for n in res["notes"]:
        print("  note:", n)
    return 0


def cmd_import(args) -> int:
    cfg = load_config()
    conn = store.connect()
    p = Path(args.file) if args.file else max(RAW_DIR.glob("schedule-*.json"), key=lambda f: f.stat().st_mtime)
    html_p = p.with_suffix(".html")
    res = wiff.import_payload(conn, cfg, p.read_bytes(), html_p.read_text(encoding="utf-8") if html_p.exists() else None)
    conn.commit()
    print(f"{p.name}: {res['films']} films, {res['sessions']} sessions, {res['changes']} changes")
    for n in res["notes"]:
        print("  note:", n)
    return 0


def cmd_show(_args) -> int:
    conn = store.connect()
    print("films:", conn.execute("SELECT COUNT(*) FROM film WHERE removed_at IS NULL").fetchone()[0],
          " sessions:", conn.execute("SELECT COUNT(*) FROM session WHERE removed_at IS NULL").fetchone()[0])
    cand = set(load_config()["plan"]["candidate_days"])
    for r in conn.execute("SELECT substr(starts_at,1,10) d, COUNT(*) n FROM session WHERE removed_at IS NULL GROUP BY d ORDER BY d"):
        print(f"  {r['d']}  {r['n']:3d} sessions" + ("   <- candidate day" if r["d"] in cand else ""))
    for r in conn.execute("SELECT v.name, v.building, COUNT(s.id) n FROM venue v LEFT JOIN session s "
                          "ON s.screen_id=v.screen_id AND s.removed_at IS NULL GROUP BY v.screen_id ORDER BY v.name"):
        print(f"  {r['name']:<28} {r['building'] or '(no building)':<18} {r['n']} sessions")
    last = conn.execute("SELECT fetched_at, http_status, note FROM fetch_log ORDER BY id DESC LIMIT 1").fetchone()
    print("last fetch:", dict(last) if last else "never")
    return 0


def cmd_enrich(args) -> int:
    cfg = load_config()
    conn = store.connect()
    st = enrich.run(conn, cfg, limit=args.limit)
    print(f"matched {st['matched']}, unmatched {st['unmatched']}, cast backfilled {st['backfilled']}, OMDb lookups {st['omdb']}")
    if st["stopped"]:
        print("stopped:", st["stopped"])
        return 1
    return 0


def cmd_posters(args) -> int:
    st = posters.run(store.connect(), load_config(), limit=args.limit)
    print(f"posters fetched {st['fetched']}, failed {st['failed']}" + ("" if st["pillow"] else " (no Pillow: stored the small variant)"))
    if st["stopped"]:
        print("stopped:", st["stopped"])
        return 1
    return 0


def cmd_backtest(_args) -> int:
    cfg = load_config()
    gate = cfg["score"]["taste_min_rho"]
    for label, rho, n, used in backtest.run(cfg):
        print(f"{label:<40} rho {rho:6.3f}  n={n:<4} " + ("clears the gate" if rho >= gate else f"below {gate}")
              + ("   <- drives the taste nudge" if used else ""))
    print(f"taste_nudge_max is {cfg['score']['taste_nudge_max']} (config [score]); keep it above 0 only while the people signal clears the gate")
    return 0


def cmd_plan(args) -> int:
    cfg = load_config()
    conn = store.connect()
    fits: dict = {}
    if cfg["score"]["taste_nudge_max"]:
        try:  # Arbiter is read live; if it is unreachable the plan is built without the taste nudge
            fits = taste.wiff_fits(conn, cfg, taste.fit(taste.ranked(cfg)))
            print(f"taste: {len(fits)} films share a director or lead actor with something you ranked")
        except Exception as e:  # noqa: BLE001
            print(f"taste: skipped ({e})")
    print(f"scored {score.score_all(conn, cfg, fits)} films")
    days = planner.build(conn, cfg, [args.day] if args.day else None)
    conn.commit()
    if not days:
        print("no valid lineup on any candidate day")
        return 1
    for d in days:
        b = d["best"]
        print(f"#{d['rank']} {d['day']}  score {b['score']}  ${b['cost'] // 100}  changes {b['changes']}  conf {b['confidence']}")
        for alt, tag in [(b, "*")] + [(a, " ") for a in d["alts"]]:
            print(f"   {tag} {alt['score']:5.1f}  " + "  |  ".join(
                f"{planner.fmt(c.start)} {c.title.title()[:28]} ({c.building.split()[0]})" for c in alt["lineup"]))
    return 0


def cmd_serve(_args) -> int:
    from . import serve
    serve.serve()
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="marquee", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--force", action="store_true", help="ignore the min-interval guard")
    f.set_defaults(fn=cmd_fetch)
    i = sub.add_parser("import")
    i.add_argument("file", nargs="?", help="a saved snapshot; default the newest")
    i.set_defaults(fn=cmd_import)
    en = sub.add_parser("enrich")
    en.add_argument("--limit", type=int, help="look up at most this many new films this run")
    en.set_defaults(fn=cmd_enrich)
    po = sub.add_parser("posters")
    po.add_argument("--limit", type=int, help="fetch at most this many posters this run")
    po.set_defaults(fn=cmd_posters)
    sub.add_parser("backtest").set_defaults(fn=cmd_backtest)
    pl = sub.add_parser("plan")
    pl.add_argument("--day", help="only this day (YYYY-MM-DD); other days' plans are replaced too, so omit normally")
    pl.set_defaults(fn=cmd_plan)
    sub.add_parser("show").set_defaults(fn=cmd_show)
    sub.add_parser("serve").set_defaults(fn=cmd_serve)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
