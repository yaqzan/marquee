"""Poster cache: WIFF's own poster per film (the Veezi image named in the schedule feed), downloaded once,
shrunk to a small JPEG with Pillow, and served from /poster/<film id>.

The originals run up to 4 MB, far too heavy for a phone, so each is resized to `[posters] width` and stored in
marquee/state/posters/ (gitignored). Walk once, then incremental (owner rule for every fetcher): a film is
fetched only if it has no cached poster or its poster URL changed. Without Pillow the 125 px standard
variant is stored as-is. A 429/403 stops the run so the next one cools down.
"""

from __future__ import annotations

import hashlib
import io
import os
import time
import urllib.error
import urllib.request

from . import STATE_DIR
from .enrich import Stop
from .wiff import now

POSTER_DIR = STATE_DIR / "posters"


def get_bytes(url: str, ua: str, timeout: int, max_bytes: int) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read(max_bytes + 1)
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise Stop(f"poster host answered {e.code}; stopping so the next run cools down") from e
        raise
    if len(data) > max_bytes:
        raise ValueError(f"poster larger than {max_bytes} bytes")
    return data


def to_jpeg(data: bytes, width: int, quality: int) -> tuple[bytes, int, int]:
    """Any image -> a progressive JPEG at most `width` wide (transparency flattened onto white)."""
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    if im.mode in ("RGBA", "LA", "P"):
        rgba = im.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.split()[-1])
        im = flat
    else:
        im = im.convert("RGB")
    if im.width > width:
        im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return out.getvalue(), im.width, im.height


def run(conn, cfg: dict, limit: int | None = None, getb=get_bytes, sleep=time.sleep) -> dict:
    pc, ua = cfg["posters"], cfg["fetch"]["user_agent"]
    try:
        import PIL  # noqa: F401
        pil = True
    except ImportError:
        pil = False
    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    todo = conn.execute(
        "SELECT f.id, f.poster_url FROM film f LEFT JOIN film_poster p ON p.film_id = f.id "
        "WHERE f.removed_at IS NULL AND f.poster_url IS NOT NULL AND (p.film_id IS NULL OR p.src_url != f.poster_url) "
        "ORDER BY f.id").fetchall()
    stats = {"fetched": 0, "failed": 0, "stopped": None, "pillow": pil}
    try:
        for f in todo[:limit]:
            sleep(pc["sleep_s"])
            # the feed's URL asks for the high-res original; without Pillow take the small standard one
            url = f["poster_url"] if pil else f["poster_url"].replace("&isHighRes=true", "")
            try:
                raw = getb(url, ua, 30, pc["max_bytes"])
                if pil:
                    data, w, h = to_jpeg(raw, pc["width"], pc["quality"])
                else:
                    data, w, h = raw, None, None
            except Stop:
                raise
            except Exception:  # noqa: BLE001 - one bad poster must not end the walk; it is retried next run
                stats["failed"] += 1
                continue
            name = f"{f['id']}.jpg" if pil else f"{f['id']}.img"
            tmp = POSTER_DIR / (name + ".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, POSTER_DIR / name)
            conn.execute("INSERT INTO film_poster(film_id, src_url, file, sha8, width, height, fetched_at) VALUES (?,?,?,?,?,?,?) "
                         "ON CONFLICT(film_id) DO UPDATE SET src_url=excluded.src_url, file=excluded.file, sha8=excluded.sha8, "
                         "width=excluded.width, height=excluded.height, fetched_at=excluded.fetched_at",
                         (f["id"], f["poster_url"], name, hashlib.sha256(data).hexdigest()[:8], w, h, now()))
            conn.commit()
            stats["fetched"] += 1
    except Stop as s:
        conn.commit()
        stats["stopped"] = str(s)
    return stats
