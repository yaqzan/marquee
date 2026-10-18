"""Marquee: curates festival day trips. Today: the Windsor International Film Festival (WIFF)."""

from __future__ import annotations

import tomllib
from pathlib import Path

__version__ = "0.1.0"

ROOT = Path(__file__).resolve().parent.parent
PKG_DIR = Path(__file__).resolve().parent
STATE_DIR = PKG_DIR / "state"
RAW_DIR = STATE_DIR / "raw"
DB_PATH = STATE_DIR / "marquee.sqlite"
WEB_DIR = ROOT / "web"
CONFIG_FILE = PKG_DIR / "config.toml"
LOCAL_CONFIG_FILE = ROOT / "config.local.toml"


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_config(local: Path | None = LOCAL_CONFIG_FILE) -> dict:
    """config.toml, with config.local.toml merged over it when present."""
    cfg = tomllib.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    if local is not None and Path(local).exists():
        cfg = _merge(cfg, tomllib.loads(Path(local).read_text(encoding="utf-8")))
    return cfg
