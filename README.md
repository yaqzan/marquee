# Marquee

Curates festival day trips. It pulls a festival's film schedule into SQLite, serves a read-only site and
JSON API over it, and (next) ranks the best 3-film day for the days you can go.

First festival: the [Windsor International Film Festival](https://windsorfilmfestival.com) 2026.

## Run it

```
py -3.11 -m marquee fetch     # pull the schedule (2 requests) into marquee/state/marquee.sqlite
py -3.11 -m marquee show      # what it holds
py -3.11 -m marquee serve     # http://127.0.0.1:5007
```

Python 3.11, standard library only. Festival, dates, venues and candidate days live in
`marquee/config.toml`; put your own overrides in `config.local.toml` (gitignored).

To publish through a Cloudflare tunnel, copy `ops/cloudflared-config.example.yml` to
`ops/cloudflared-config.yml` and fill in your own tunnel.

## API

`/api/health`, `/api/festival`, `/api/films`, `/api/films/<id>`, `/api/sessions?day=YYYY-MM-DD`, `/api/plans`.

Notes for contributors are in `CLAUDE.md` and `.claude/docs/`.
