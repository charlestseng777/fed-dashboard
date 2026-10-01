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

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{query}"


def yahoo_daily_closes(symbol: str, start: str) -> dict[str, float]:
    """{'YYYY-MM-DD': close} for one Yahoo symbol from `start` to today."""
    t0 = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp())
    t1 = int(time.time()) + 86400
    query = urllib.parse.urlencode({"period1": t0, "period2": t1, "interval": "1d",
                                    "events": "history", "includeAdjustedClose": "false"})
    payload = http.get_json(CHART_URL.format(symbol=urllib.parse.quote(symbol), query=query))
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
