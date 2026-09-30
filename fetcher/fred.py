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

from fetcher import net as http

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


def many(ids: dict[str, str | list[str]], start: str, status: dict) -> dict[str, dict[str, float]]:
    """Fetch {name: sid} concurrently. A value may be a list of candidate ids
    (FRED occasionally renames series); the first that returns data wins.
    Failures are logged and recorded in `status` rather than raised, so one
    dead series can't sink the run."""
    results: dict[str, dict[str, float]] = {}

    def one(item):
        name, sids = item
        error = None
        for sid in ([sids] if isinstance(sids, str) else sids):
            try:
                data = series(sid, start)
                if data:
                    return name, sid, data, None
            except Exception as exc:  # noqa: BLE001 - recorded, not swallowed
                error = str(exc)
        return name, sids if isinstance(sids, str) else sids[0], {}, error or "no data"

    with ThreadPoolExecutor(max_workers=6) as pool:
        for name, sid, data, error in pool.map(one, ids.items()):
            results[name] = data
            if error:
                http.log(f"FRED {sid} failed: {error}")
                status[f"fred:{sid}"] = {"ok": False, "error": error[:200]}
            else:
                last = max(data) if data else None
                status[f"fred:{sid}"] = {"ok": bool(data), "last": last}
    return results


RELEASE_DATES_URL = ("https://api.stlouisfed.org/fred/releases/dates?api_key={key}&file_type=json"
                     "&realtime_start={start}&realtime_end={end}"
                     "&include_release_dates_with_no_data=true&limit=1000&sort_order=asc")


def release_dates(start: str, end: str) -> list[tuple[str, str]]:
    """Scheduled release dates [(date, release_name)] from FRED's release
    calendar. Needs FRED_API_KEY (free); returns [] without one."""
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        return []
    payload = http.get_json(RELEASE_DATES_URL.format(key=urllib.parse.quote(key), start=start, end=end))
    return [(d["date"], d.get("release_name", "")) for d in payload.get("release_dates", [])]
