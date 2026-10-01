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

import base64
import calendar
import json
import os
import time
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

from fetcher import net as http

BASE = "https://api.refinitiv.com"
TOKEN_V1 = f"{BASE}/auth/oauth2/v1/token"
TOKEN_V2 = f"{BASE}/auth/oauth2/v2/token"
SNAPSHOT = f"{BASE}/data/pricing/snapshots/v1/"
HISTORY = f"{BASE}/data/historical-pricing/v1/views/interday-summaries/{{ric}}"

PRICE_FIELDS = ["SETTLE", "TRDPRC_1", "HST_CLOSE", "PRIMACT_1", "CF_LAST", "BID", "ASK"]


def configured() -> bool:
    env = os.environ
    if env.get("REFINITIV_DISABLED", "").lower() == "true":
        return False
    return bool(
        (env.get("REFINITIV_CLIENT_ID") and env.get("REFINITIV_CLIENT_SECRET"))
        or (env.get("REFINITIV_USERNAME") and env.get("REFINITIV_PASSWORD") and env.get("REFINITIV_APP_KEY"))
    )


def _login() -> dict:
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
            # Never take over the session: "true" would sign the account's
            # owner out of Workspace every time the workflow runs. With
            # "false", RDP refuses the login instead if the account is busy,
            # and the fetcher keeps the previous day's pricing.
            "takeExclusiveSignOnControl": "false",
        })
    if not payload.get("access_token"):
        raise RuntimeError("RDP token response had no access_token")
    return payload


_SESSION: dict = {}


def _token(attempts: int = 3, wait_s: int = 90) -> str:
    """Log in, retrying while the account's single session is held by
    something else — usually the sibling dashboard's nightly run, which
    starts within minutes of this one and signs out when it's done."""
    for attempt in range(attempts):
        try:
            payload = _login()
            _SESSION.clear()
            _SESSION.update(payload)
            return payload["access_token"]
        except RuntimeError as exc:
            if "quota" not in str(exc).lower() or attempt == attempts - 1:
                raise
            http.log(f"RDP session busy; retrying in {wait_s}s ({attempt + 1}/{attempts - 1})")
            time.sleep(wait_s)
    raise RuntimeError("unreachable")


def release() -> None:
    """Sign out: revoke the refresh token so the session is freed now rather
    than when it expires. Best-effort — failure only means the session lapses
    on its own later."""
    token = _SESSION.get("refresh_token") or _SESSION.get("access_token")
    client = os.environ.get("REFINITIV_APP_KEY") or os.environ.get("REFINITIV_CLIENT_ID")
    _SESSION.clear()
    if not token or not client:
        return
    basic = base64.b64encode(f"{client}:".encode()).decode()
    try:
        http.post_form(f"{BASE}/auth/oauth2/v1/revoke", {"token": token},
                       {"Authorization": f"Basic {basic}"})
        http.log("RDP session released")
    except Exception as exc:  # noqa: BLE001
        http.log(f"RDP sign-out failed (session will expire on its own): {exc}")


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


def _history(token: str, ric: str, start: str, count: int = 1000) -> dict[str, float]:
    # No field list: a field the licence doesn't cover fails the whole request.
    # RDP returns only 20 rows unless asked for more.
    query = urllib.parse.urlencode({"interval": "P1D", "start": start, "count": str(count)})
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


def _last_closes(token: str, rics: list[str], start: str) -> dict[str, float]:
    out: dict[str, float] = {}
    errors = []
    for ric in rics:
        try:
            hist = _history(token, ric, start)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{ric}: {exc}")
            continue
        if hist:
            out[ric] = hist[max(hist)]
    if errors:
        http.log(f"RDP history failed for {len(errors)} RIC(s); first: {errors[0]}")
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
    first = min(by_month) if by_month else None
    for (y, m) in sorted(futures):
        # Until the first upcoming meeting the rate is known (today's EFFR);
        # the current month's contract also averages in days already past,
        # possibly before an earlier decision, so it must not reset `rate`.
        if first is None or (y, m) < first:
            continue
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
    try:
        return _policy_pricing(config_path, meetings, effr, today, history_start)
    finally:
        release()


def _policy_pricing(config_path: Path, meetings: list[str], effr: float | None, today: date,
                    history_start: str) -> dict:
    cfg = json.loads(config_path.read_text())
    token = _token()

    ff_rics = [f"{cfg['fed_funds_root']}c{i}" for i in range(1, cfg.get("fed_funds_contracts", 13) + 1)]
    ois = cfg.get("sofr_ois", {})
    rics = ff_rics + list(ois.values())
    try:
        snap = _snapshot(token, rics)
        method = "snapshot"
    except RuntimeError as exc:
        # Many RDP licences cover historical pricing but not the real-time
        # snapshot service (403). Yesterday's close is fine for a daily page.
        http.log(f"RDP snapshot unavailable ({exc}); using historical pricing")
        snap = _last_closes(token, rics, (today - timedelta(days=10)).isoformat())
        method = "historical"
    if not snap:
        raise RuntimeError("RDP returned no prices for any RIC")

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

    # Spot gold for the inflation-compensation chart, in the same session.
    # Popped out of this dict by fetch.py and merged into the daily panel.
    gold = {}
    try:
        gold = _history(token, cfg.get("gold", "XAU="), cfg.get("gold_start", "2018-01-01"), count=4000)
        http.log(f"RDP gold: {len(gold)} daily closes" + (f", latest {max(gold)}" if gold else ""))
    except Exception as exc:  # noqa: BLE001
        http.log(f"RDP gold history failed: {exc}")

    # Daily history of the 1Y and 2Y SOFR OIS points for the near-term
    # expectations chart (popped out and merged into the daily panel too).
    ois_history: dict[str, dict[str, float]] = {}
    for key, tenor in (("ois_1y", "1Y"), ("ois_2y", "2Y")):
        ric = ois.get(tenor)
        if not ric:
            continue
        try:
            ois_history[key] = _history(token, ric, cfg.get("ois_history_start", "2018-05-01"), count=4000)
            http.log(f"RDP {ric}: {len(ois_history[key])} daily closes")
        except Exception as exc:  # noqa: BLE001
            http.log(f"RDP {ric} history failed: {exc}")

    return {
        "ois_history": ois_history,
        "gold_history": gold,
        "source": "refinitiv",
        "method": method,
        "as_of": today.isoformat(),
        "reference_rate": effr,
        "meetings": path,
        "futures_strip": strip,
        "sofr_ois": curve,
        "priced_12m_history": history,
    }
