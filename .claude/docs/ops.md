# Ops

Standard machine pattern (Harbinger/GameNight): one port, own tunnel, 5-min watchdog.

- **Server**: `py -3.11 -u -m marquee serve`, stdlib ThreadingHTTPServer on 127.0.0.1:5007. Serves `web/`
  and the JSON API. GET/HEAD only (POST answers 501), path traversal refused, everything no-cache.
  `/api/health` answers 200 whenever the server is up; `stale: true` means the last good fetch is over
  72 h old. A change to `serve.py` needs `server.ps1 restart -Service marquee`. Cloudflare turns `no-cache`
  on web/ files into a 4 h cache, so bump the `?v=` on the CSS/JS URLs in `index.html` when they change
  (web.md). Static files are read per request: no restart for a web/ change.
- **server.ps1**: `marquee-api` + `marquee-tunnel` (alias `marquee`), added 2026-10-18 (backup
  `server.ps1.bak-marquee`).
- **Tunnel**: `marquee` (created 2026-10-18), hostname `marquee.yaqzan.dev`. Config
  `ops/cloudflared-config.yml` is gitignored; the repo ships `cloudflared-config.example.yml`.
  The probe tool in the Claude session gets Cloudflare error 1010; use curl with a browser UA to test publicly.
- **Tasks**: `ops/windows/install-tasks.ps1 -Controller C:\Development\server.ps1` registers "Marquee
  Watchdog" (every 5 min; unelevated it falls back to schtasks). There is no scheduled fetch: refresh is
  on demand (`marquee fetch`).
