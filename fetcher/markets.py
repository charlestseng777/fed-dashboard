"""Market prices from Yahoo Finance's public chart endpoint.

Unofficial and unauthenticated: it needs no login (so it never touches the
Refinitiv session) but Yahoo can change or rate-limit it without notice. The
fetcher treats it as best-effort and falls back to Refinitiv, then to the
previous run's values.
"""

from __future__ import annotations

import time
import urllib.parse
from datetime import datetime, timedelta, timezone

from fetcher import net as http

CHART_HOSTS = ("query2.finance.yahoo.com", "query1.finance.yahoo.com")
CHART_URL = "https://{host}/v8/finance/chart/{symbol}?{query}"
# Yahoo rate-limits (429) anything that doesn't look like a plain browser;
# the bare UA below is what its own web client effectively sends.
YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"}
STOOQ_URL = "https://stooq.com/q/d/l/?s={symbol}&i=d&d1={d1}"


def yahoo_daily_closes(symbol: str, start: str) -> dict[str, float]:
    """{'YYYY-MM-DD': close} for one Yahoo symbol from `start` to today."""
    t0 = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp())
    t1 = int(time.time()) + 86400
    query = urllib.parse.urlencode({"period1": t0, "period2": t1, "interval": "1d",
                                    "events": "history", "includeAdjustedClose": "false"})
    payload, errors = None, []
    for host in CHART_HOSTS:
        try:
            payload = http.get_json(CHART_URL.format(host=host, symbol=urllib.parse.quote(symbol), query=query),
                                    YAHOO_HEADERS)
            break
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{host}: {exc}")
    if payload is None:
        raise RuntimeError("; ".join(errors)[:300])
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(f"Yahoo {symbol}: {chart['error']}")
    result = (chart.get("result") or [None])[0]
    if not result:
        raise RuntimeError(f"Yahoo {symbol}: empty result")

    # Timestamps are the session open in UTC; shift by the exchange's offset
    # so each close lands on its own trading date.
    offset = timedelta(seconds=(result.get("meta") or {}).get("gmtoffset") or 0)
    stamps = result.get("timestamp") or []
    closes = (((result.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
    out: dict[str, float] = {}
    for ts, close in zip(stamps, closes):
        if close is None:
            continue
        day = (datetime.fromtimestamp(ts, tz=timezone.utc) + offset).date().isoformat()
        out[day] = round(float(close), 2)
    if not out:
        raise RuntimeError(f"Yahoo {symbol}: no closes returned")
    return out


def stooq_daily_closes(symbol: str, start: str) -> dict[str, float]:
    """{'YYYY-MM-DD': close} from Stooq's public CSV download (e.g. 'xauusd')."""
    text = http.get_text(STOOQ_URL.format(symbol=symbol, d1=start.replace("-", "")))
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines or not lines[0].lower().startswith("date"):
        raise RuntimeError(f"Stooq {symbol}: unexpected response {lines[:1]}")
    header = [h.strip().lower() for h in lines[0].split(",")]
    di, ci = header.index("date"), header.index("close")
    out: dict[str, float] = {}
    for ln in lines[1:]:
        parts = ln.split(",")
        try:
            out[parts[di]] = round(float(parts[ci]), 2)
        except (IndexError, ValueError):
            continue
    if not out:
        raise RuntimeError(f"Stooq {symbol}: no rows")
    return out
