"""Positioning and flows: CFTC Traders in Financial Futures, Treasury auctions."""

from __future__ import annotations

import statistics
import urllib.parse
from datetime import date

from fetcher import http

# CFTC Traders in Financial Futures, futures only (Socrata dataset).
CFTC_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"

# Contract market codes and an approximate DV01 per contract (USD per 1bp).
# The DV01s are round, representative figures for the cheapest-to-deliver /
# contract spec — good enough to put contracts on a common risk footing for
# a crowding read, not for hedging. Edit config if you want live values.
CONTRACTS = [
    {"id": "ff", "code": "045601", "label": "30-day Fed funds", "dv01": 41.67, "group": "stir"},
    {"id": "sr3", "code": "134741", "label": "3M SOFR", "dv01": 25.0, "group": "stir"},
    {"id": "tu", "code": "042601", "label": "2Y T-note", "dv01": 38.0, "group": "ust"},
    {"id": "fv", "code": "044601", "label": "5Y T-note", "dv01": 45.0, "group": "ust"},
    {"id": "ty", "code": "043602", "label": "10Y T-note", "dv01": 62.0, "group": "ust"},
    {"id": "tn", "code": "043607", "label": "Ultra 10Y", "dv01": 90.0, "group": "ust"},
    {"id": "us", "code": "020601", "label": "T-bond", "dv01": 130.0, "group": "ust"},
    {"id": "ub", "code": "020604", "label": "Ultra T-bond", "dv01": 220.0, "group": "ust"},
]

ZSCORE_WEEKS = 156  # 3 years


def _num(raw) -> float | None:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def cftc_positioning(start: str) -> dict:
    codes = ",".join(f"'{c['code']}'" for c in CONTRACTS)
    query = {
        "$where": f"cftc_contract_market_code in({codes}) AND report_date_as_yyyy_mm_dd >= '{start}'",
        "$order": "report_date_as_yyyy_mm_dd",
        "$limit": "50000",
    }
    rows = http.get_json(f"{CFTC_URL}?{urllib.parse.urlencode(query)}")
    if not rows:
        raise RuntimeError("CFTC query returned no rows")

    by_code = {c["code"]: c for c in CONTRACTS}
    series: dict[str, dict[str, dict]] = {c["id"]: {} for c in CONTRACTS}
    for row in rows:
        spec = by_code.get(str(row.get("cftc_contract_market_code", "")).strip())
        if not spec:
            continue
        day = str(row.get("report_date_as_yyyy_mm_dd", ""))[:10]
        oi = _num(row.get("open_interest_all"))
        lev = _net(row, "lev_money_positions_long", "lev_money_positions_short")
        am = _net(row, "asset_mgr_positions_long", "asset_mgr_positions_short")
        dealer = _net(row, "dealer_positions_long_all", "dealer_positions_short_all")
        series[spec["id"]][day] = {
            "oi": round(oi) if oi is not None else None,
            "lev_net": lev,
            "am_net": am,
            "dealer_net": dealer,
            "lev_pct_oi": round(100 * lev / oi, 2) if lev is not None and oi else None,
        }

    dates = sorted({d for s in series.values() for d in s})
    weekly = []
    for d in dates:
        row: dict = {"date": d}
        lev_dv01 = am_dv01 = 0.0
        have_ust = False
        for spec in CONTRACTS:
            point = series[spec["id"]].get(d)
            if not point:
                continue
            row[f"{spec['id']}_lev"] = point["lev_net"]
            row[f"{spec['id']}_am"] = point["am_net"]
            row[f"{spec['id']}_dealer"] = point["dealer_net"]
            row[f"{spec['id']}_lev_pct"] = point["lev_pct_oi"]
            if spec["group"] == "ust" and point["lev_net"] is not None and point["am_net"] is not None:
                have_ust = True
                lev_dv01 += point["lev_net"] * spec["dv01"]
                am_dv01 += point["am_net"] * spec["dv01"]
        if have_ust:
            # $ millions per bp
            row["ust_lev_dv01"] = round(lev_dv01 / 1e6, 2)
            row["ust_am_dv01"] = round(am_dv01 / 1e6, 2)
        weekly.append({k: v for k, v in row.items() if v is not None})

    latest = []
    for spec in CONTRACTS:
        pts = [series[spec["id"]][d] for d in sorted(series[spec["id"]])]
        if not pts:
            continue
        cur = pts[-1]
        prev = pts[-2] if len(pts) > 1 else None
        latest.append({
            "id": spec["id"], "label": spec["label"], "group": spec["group"],
            "lev_net": cur["lev_net"], "am_net": cur["am_net"], "dealer_net": cur["dealer_net"],
            "oi": cur["oi"], "lev_pct_oi": cur["lev_pct_oi"],
            "lev_change": _diff(cur["lev_net"], prev and prev["lev_net"]),
            "am_change": _diff(cur["am_net"], prev and prev["am_net"]),
            "lev_z": _zscore([p["lev_net"] for p in pts]),
            "am_z": _zscore([p["am_net"] for p in pts]),
            "lev_pctile": _pctile([p["lev_net"] for p in pts]),
            "dv01": spec["dv01"],
        })

    agg = {}
    for key in ("ust_lev_dv01", "ust_am_dv01"):
        vals = [r[key] for r in weekly if r.get(key) is not None]
        if vals:
            agg[key] = {"latest": vals[-1], "z": _zscore(vals), "pctile": _pctile(vals)}

    return {
        "as_of": dates[-1] if dates else None,
        "contracts": [{k: c[k] for k in ("id", "label", "group", "dv01")} for c in CONTRACTS],
        "weekly": weekly,
        "latest": latest,
        "aggregate": agg,
    }


def _net(row: dict, long_key: str, short_key: str) -> float | None:
    lo, sh = _num(row.get(long_key)), _num(row.get(short_key))
    return None if lo is None or sh is None else round(lo - sh)


def _diff(a, b):
    return None if a is None or b is None else a - b


def _zscore(values: list) -> float | None:
    window = [v for v in values[-ZSCORE_WEEKS:] if v is not None]
    if len(window) < 26:
        return None
    sd = statistics.pstdev(window)
    return round((window[-1] - statistics.fmean(window)) / sd, 2) if sd else None


def _pctile(values: list) -> float | None:
    window = [v for v in values[-ZSCORE_WEEKS:] if v is not None]
    if len(window) < 26:
        return None
    cur = window[-1]
    return round(100 * sum(v <= cur for v in window) / len(window))


# --------------------------------------------------------------------------
# Treasury auctions (Fiscal Data API)
# --------------------------------------------------------------------------

AUCTIONS_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
AUCTION_FIELDS = [
    "cusip", "security_type", "security_term", "auction_date", "issue_date",
    "high_yield", "bid_to_cover_ratio", "offering_amt", "total_accepted",
    "primary_dealer_accepted", "direct_bidder_accepted", "indirect_bidder_accepted",
    "reopening", "tips", "floating_rate",
]
COUPON_TYPES = {"Note", "Bond"}


def treasury_auctions(today: date, since: str) -> dict:
    query = {
        "fields": ",".join(AUCTION_FIELDS),
        "filter": f"auction_date:gte:{since}",
        "sort": "-auction_date",
        "page[size]": "1000",
    }
    payload = http.get_json(f"{AUCTIONS_URL}?{urllib.parse.urlencode(query, safe=':,[]')}")
    rows = payload.get("data", [])
    if not rows:
        raise RuntimeError("Fiscal Data auctions query returned no rows")

    coupons = []
    for r in rows:
        if r.get("security_type") not in COUPON_TYPES:
            continue
        if (r.get("tips") or "").lower() == "yes" or (r.get("floating_rate") or "").lower() == "yes":
            continue
        accepted = _num(r.get("total_accepted"))
        entry = {
            "date": r.get("auction_date"),
            "term": r.get("security_term"),
            "type": r.get("security_type"),
            "reopening": (r.get("reopening") or "").lower() == "yes",
            "size_bn": _bn(r.get("offering_amt")),
            "high_yield": _num(r.get("high_yield")),
            "btc": _num(r.get("bid_to_cover_ratio")),
            "dealer_pct": _share(r.get("primary_dealer_accepted"), accepted),
            "indirect_pct": _share(r.get("indirect_bidder_accepted"), accepted),
            "direct_pct": _share(r.get("direct_bidder_accepted"), accepted),
        }
        coupons.append(entry)

    coupons.sort(key=lambda x: x["date"])
    done = [c for c in coupons if c["high_yield"] is not None]
    upcoming = [c for c in coupons if c["high_yield"] is None and c["date"] >= today.isoformat()]

    # Compare each result to the average of the previous six auctions of the
    # same tenor — the usual "vs recent average" read for demand.
    history: dict[str, list[dict]] = {}
    for c in done:
        prior = history.setdefault(_tenor(c["term"]), [])
        window = prior[-6:]
        for field in ("btc", "dealer_pct", "indirect_pct"):
            vals = [p[field] for p in window if p[field] is not None]
            c[f"{field}_avg6"] = round(statistics.fmean(vals), 2) if len(vals) >= 3 else None
        prior.append(c)

    return {"recent": list(reversed(done[-20:])), "upcoming": upcoming[:12]}


def _tenor(term: str | None) -> str:
    """'9-Year 10-Month' reopenings bucket with the 10-Year."""
    import re
    m = re.match(r"(\d+)-Year(?:\s+(\d+)-Month)?", term or "")
    if not m:
        return term or ""
    years = int(m.group(1)) + (1 if m.group(2) and int(m.group(2)) >= 6 else 0)
    return f"{years}-Year"


def _bn(raw) -> float | None:
    v = _num(raw)
    return None if v is None else round(v / 1e9, 1)


def _share(part, total) -> float | None:
    p = _num(part)
    return None if p is None or not total else round(100 * p / total, 1)
