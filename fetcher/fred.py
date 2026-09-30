"""FRED (St. Louis Fed) series.

Uses the public fredgraph.csv download, which needs no API key. If
FRED_API_KEY is set, the JSON API is used instead — it is rate-limited more
generously and less likely to be throttled from a shared CI runner.
"""

from __future__ import annotations

import csv
import io
import os
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from fetcher import http

CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}"
API_URL = ("https://api.stlouisfed.org/fred/series/observations?series_id={sid}"
           "&observation_start={start}&file_type=json&api_key={key}")


def _parse_value(raw: str | None) -> float | None:
    if raw is None:
        return None
    raw = raw.strip()
    if raw in ("", ".", "NA", "#N/A"):
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def series(sid: str, start: str) -> dict[str, float]:
    """Return {'YYYY-MM-DD': value} for one FRED series, missing values dropped."""
    key = os.environ.get("FRED_API_KEY", "").strip()
    out: dict[str, float] = {}
    if key:
        payload = http.get_json(API_URL.format(sid=sid, start=start, key=urllib.parse.quote(key)))
        for obs in payload.get("observations", []):
            value = _parse_value(obs.get("value"))
            if value is not None:
                out[obs["date"]] = value
        return out

    text = http.get_text(CSV_URL.format(sid=sid, start=start))
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or len(header) < 2:
        raise RuntimeError(f"FRED {sid}: unexpected CSV header {header!r}")
    for row in reader:
        if len(row) < 2:
            continue
        value = _parse_value(row[1])
        if value is not None:
            out[row[0][:10]] = value
    return out


def many(ids: dict[str, str], start: str, status: dict) -> dict[str, dict[str, float]]:
    """Fetch {name: sid} concurrently. Failures are logged and recorded in
    `status` rather than raised, so one dead series can't sink the run."""
    results: dict[str, dict[str, float]] = {}

    def one(item):
        name, sid = item
        try:
            return name, series(sid, start), None
        except Exception as exc:  # noqa: BLE001 - recorded, not swallowed
            return name, {}, str(exc)

    with ThreadPoolExecutor(max_workers=6) as pool:
        for name, data, error in pool.map(one, ids.items()):
            results[name] = data
            sid = ids[name]
            if error:
                http.log(f"FRED {sid} failed: {error}")
                status[f"fred:{sid}"] = {"ok": False, "error": error[:200]}
            else:
                last = max(data) if data else None
                status[f"fred:{sid}"] = {"ok": bool(data), "last": last}
    return results
