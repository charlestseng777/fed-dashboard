"""Refinitiv / LSEG Data Platform (RDP) adapter for policy pricing.

Optional. Runs only when credentials are present in the environment (set them
as GitHub Actions secrets — never commit them):

  Service account (preferred, LSEG "v2" client credentials):
      REFINITIV_CLIENT_ID, REFINITIV_CLIENT_SECRET
  Or legacy user login ("v1" password grant):
      REFINITIV_USERNAME, REFINITIV_PASSWORD, REFINITIV_APP_KEY

An Eikon/Workspace desktop App Key on its own is not enough: it authenticates
through the locally running Workspace app, which a CI runner doesn't have.

RICs are configurable in config/refinitiv.json in case your entitlements use
different chains.
"""

from __future__ import annotations

import calendar
import json
import os
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

from fetcher import http

BASE = "https://api.refinitiv.com"
TOKEN_V1 = f"{BASE}/auth/oauth2/v1/token"
TOKEN_V2 = f"{BASE}/auth/oauth2/v2/token"
SNAPSHOT = f"{BASE}/data/pricing/snapshots/v1/"
HISTORY = f"{BASE}/data/historical-pricing/v1/views/interday-summaries/{{ric}}"

PRICE_FIELDS = ["SETTLE", "TRDPRC_1", "HST_CLOSE", "PRIMACT_1", "CF_LAST", "BID", "ASK"]


def configured() -> bool:
    env = os.environ
    return bool(
        (env.get("REFINITIV_CLIENT_ID") and env.get("REFINITIV_CLIENT_SECRET"))
        or (env.get("REFINITIV_USERNAME") and env.get("REFINITIV_PASSWORD") and env.get("REFINITIV_APP_KEY"))
    )


def _token() -> str:
    env = os.environ
    if env.get("REFINITIV_CLIENT_ID") and env.get("REFINITIV_CLIENT_SECRET"):
        payload = http.post_form(TOKEN_V2, {
            "grant_type": "client_credentials",
            "client_id": env["REFINITIV_CLIENT_ID"],
            "client_secret": env["REFINITIV_CLIENT_SECRET"],
            "scope": "trapi",
        })
    else:
        payload = http.post_form(TOKEN_V1, {
            "grant_type": "password",
            "username": env["REFINITIV_USERNAME"],
            "password": env["REFINITIV_PASSWORD"],
            "client_id": env["REFINITIV_APP_KEY"],
            "scope": "trapi",
            "takeExclusiveSignOnControl": "true",
        })
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("RDP token response had no access_token")
    return token


def _snapshot(token: str, rics: list[str]) -> dict[str, float]:
    query = urllib.parse.urlencode({"universe": ",".join(rics), "fields": ",".join(PRICE_FIELDS)})
    payload = http.get_json(f"{SNAPSHOT}?{query}", {"Authorization": f"Bearer {token}"})
    out: dict[str, float] = {}
    for item in payload if isinstance(payload, list) else payload.get("data", []):
        ric = (item.get("Key") or {}).get("Name", "").lstrip("/")
        fields = item.get("Fields") or {}
        value = _pick(fields)
        if ric and value is not None:
            out[ric] = value
    return out


def _pick(fields: dict) -> float | None:
    for name in ("SETTLE", "TRDPRC_1", "PRIMACT_1", "CF_LAST", "HST_CLOSE"):
        v = fields.get(name)
        if isinstance(v, (int, float)):
            return float(v)
    bid, ask = fields.get("BID"), fields.get("ASK")
    if isinstance(bid, (int, float)) and isinstance(ask, (int, float)):
        return (bid + ask) / 2
    return None


def _history(token: str, ric: str, start: str) -> dict[str, float]:
    query = urllib.parse.urlencode({"interval": "P1D", "start": start, "fields": "TRDPRC_1,SETTLE,MID_PRICE,BID,ASK"})
    url = HISTORY.format(ric=urllib.parse.quote(ric, safe="")) + f"?{query}"
    payload = http.get_json(url, {"Authorization": f"Bearer {token}"})
    block = payload[0] if isinstance(payload, list) and payload else payload
    headers = [h.get("name") for h in block.get("headers", [])]
    out: dict[str, float] = {}
    for row in block.get("data", []):
        rec = dict(zip(headers, row))
        day = str(rec.get("DATE", ""))[:10]
        v = _pick(rec) or rec.get("MID_PRICE")
        if day and isinstance(v, (int, float)):
            out[day] = float(v)
    return out


# --------------------------------------------------------------------------
# Meeting-by-meeting path from Fed funds futures (the CME FedWatch method)
# --------------------------------------------------------------------------

def _month_iter(start: date, count: int):
    y, m = start.year, start.month
    for _ in range(count):
        yield y, m
        m += 1
        if m > 12:
            y, m = y + 1, 1


def meeting_path(futures: dict[tuple[int, int], float], meetings: list[str], current_rate: float,
                 today: date) -> list[dict]:
    """Each Fed funds contract settles on the average EFFR over its month.
    Walking forward month by month, a month with a meeting splits into
    pre- and post-meeting days: avg = (d*pre + (N-d)*post)/N, solved for post.
    A month without a meeting pins the rate at that month's implied average.
    """
    rate = current_rate
    path = []
    by_month = {}
    for iso in meetings:
        d = date.fromisoformat(iso)
        if d >= today:
            by_month[(d.year, d.month)] = d
    for (y, m) in sorted(futures):
        implied = 100 - futures[(y, m)]
        meeting = by_month.get((y, m))
        n = calendar.monthrange(y, m)[1]
        if meeting:
            # Decision takes effect the day after the meeting ends.
            d = meeting.day
            if n - d <= 0:
                continue
            post = (implied * n - rate * d) / (n - d)
            # Very late-month meetings amplify noise; fall back to next month.
            nxt = (y, m + 1) if m < 12 else (y + 1, 1)
            if n - d < 5 and nxt in futures:
                post = 100 - futures[nxt]
            path.append({"date": meeting.isoformat(), "implied_rate": round(post, 3),
                         "change_bp": round((post - rate) * 100, 1),
                         "cumulative_bp": round((post - current_rate) * 100, 1)})
            rate = post
        else:
            rate = implied
    return path


def policy_pricing(config_path: Path, meetings: list[str], effr: float | None, today: date,
                   history_start: str) -> dict:
    cfg = json.loads(config_path.read_text())
    token = _token()

    ff_rics = [f"{cfg['fed_funds_root']}c{i}" for i in range(1, cfg.get("fed_funds_contracts", 13) + 1)]
    ois = cfg.get("sofr_ois", {})
    snap = _snapshot(token, ff_rics + list(ois.values()))

    futures: dict[tuple[int, int], float] = {}
    strip = []
    for i, ((y, m), ric) in enumerate(zip(_month_iter(today.replace(day=1), len(ff_rics)), ff_rics)):
        price = snap.get(ric)
        if price is None:
            continue
        futures[(y, m)] = price
        strip.append({"month": f"{y:04d}-{m:02d}", "ric": ric, "price": round(price, 4),
                      "implied_rate": round(100 - price, 3)})

    if effr is None and strip:
        effr = strip[0]["implied_rate"]
    path = meeting_path(futures, meetings, effr, today) if effr is not None else []

    curve = []
    for tenor, ric in ois.items():
        if ric in snap:
            curve.append({"tenor": tenor, "ric": ric, "rate": round(snap[ric], 3)})

    # History of the change priced over the strip (far contract minus front
    # contract, in bp; negative = cuts priced), so the chart can show how the
    # path has been repriced over time.
    history = {}
    try:
        near = _history(token, ff_rics[0], history_start)
        far = _history(token, ff_rics[-1], history_start)
        for d in sorted(set(near) & set(far)):
            history[d] = round((near[d] - far[d]) * 100, 1)
    except Exception as exc:  # noqa: BLE001
        http.log(f"RDP history failed (snapshot still used): {exc}")

    return {
        "source": "refinitiv",
        "as_of": today.isoformat(),
        "reference_rate": effr,
        "meetings": path,
        "futures_strip": strip,
        "sofr_ois": curve,
        "priced_12m_history": history,
    }
