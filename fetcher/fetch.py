#!/usr/bin/env python3
"""
Fed dashboard fetcher.

Pulls US inflation, labour, growth, rates, policy-pricing and positioning
data from public sources (FRED, NY/Cleveland/Atlanta Fed, CFTC, Treasury,
BLS/BEA calendars), plus Fed funds futures and SOFR OIS from Refinitiv when
credentials are configured. Derives the metrics the dashboard reads, and
writes them to data/*.json only when something actually changed.

Every source is fetched independently: one that fails is logged, recorded in
meta.sources, and the previous values for it are kept, so a single outage
never blanks a panel.

Usage:
    python fetcher/fetch.py            # fetch, diff, write if changed
    python fetcher/fetch.py --force    # write even with no change
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fetcher import fed, flows, fred, markets, net as http, refinitiv  # noqa: E402

log = http.log

MONTHLY_START = "2014-01-01"   # a year before the charts start, for y/y
DAILY_START = "2018-01-01"
WEEKLY_START = "2018-01-01"

FRED_MONTHLY = {
    "cpi_idx": "CPIAUCSL",
    "core_cpi_idx": "CPILFESL",
    "core_services_idx": "CUSR0000SASLE",
    "supercore_idx": "CUSR0000SASL2RS",
    "shelter_idx": "CUSR0000SAH1",
    "pce_idx": "PCEPI",
    "core_pce_idx": "PCEPILFE",
    "payrolls_lvl": "PAYEMS",
    "unemployment": "UNRATE",
    "unemployed_lvl": "UNEMPLOY",
    "openings_lvl": "JTSJOL",
    "ahe_idx": "CES0500000003",
    "atl_wage": "FRBATLWGT3MMAUMHWGO",
    "retail_lvl": "RSAFS",
    "retail_ex_lvl": "RSXFS",
    "ip_idx": "INDPRO",
    "philly": "GACDFSA066MSFRBPHI",
    "empire": ["GACDISA066MSFRBNY", "GACDINA066MSFRBNY"],
}
FRED_QUARTERLY = {
    "gdp_growth": "A191RL1Q225SBEA",
    "eci_idx": "ECIALLCIV",
    "gdpnow": "GDPNOW",
}
FRED_WEEKLY = {
    "icsa": "ICSA",
    "ccsa": "CCSA",
}
FRED_DAILY = {
    "ust_3m": "DGS3MO",
    "ust_6m": "DGS6MO",
    "ust_1y": "DGS1",
    "ust_2y": "DGS2",
    "ust_5y": "DGS5",
    "ust_10y": "DGS10",
    "ust_30y": "DGS30",
    "real_10y": "DFII10",
    "be_5y": "T5YIE",
    "be_10y": "T10YIE",
    "be_5y5y": "T5YIFR",
    "sofr": "SOFR",
    "effr": "EFFR",
    "ff_upper": "DFEDTARU",
    "ff_lower": "DFEDTARL",
    "kw_tp10": "THREEFYTP10",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    """Pretty-print, except long row arrays go one compact row per line —
    small files, and a day's refresh still shows up as a readable diff."""
    path.parent.mkdir(parents=True, exist_ok=True)

    def dump(value: Any, indent: int) -> str:
        pad = " " * indent
        if isinstance(value, dict) and value:
            inner = ",\n".join(f'{pad} {json.dumps(k)}: {dump(v, indent + 1)}' for k, v in value.items())
            return "{\n" + inner + "\n" + pad + "}"
        if isinstance(value, list) and len(value) > 20 and all(isinstance(v, dict) for v in value):
            rows = ",\n".join(pad + " " + json.dumps(v, ensure_ascii=False, separators=(",", ":")) for v in value)
            return "[\n" + rows + "\n" + pad + "]"
        return json.dumps(value, ensure_ascii=False)

    path.write_text(dump(payload, 0) + "\n", encoding="utf-8")


def r(value: float | None, places: int = 2) -> float | None:
    return None if value is None else round(value + 0.0, places)


def to_monthly(series: dict[str, float]) -> dict[str, float]:
    """FRED monthly dates are the 1st of the month; key by 'YYYY-MM'.
    For anything denser, keep the last observation in each month."""
    out: dict[str, float] = {}
    for d in sorted(series):
        out[d[:7]] = series[d]
    return out


def shift(key: str, months: int) -> str:
    y, m = int(key[:4]), int(key[5:7])
    t = y * 12 + (m - 1) + months
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def pct_change(s: dict[str, float], key: str, months: int) -> float | None:
    a, b = s.get(key), s.get(shift(key, -months))
    if a is None or not b:
        return None
    return (a / b - 1) * 100


def annualised(s: dict[str, float], key: str, months: int) -> float | None:
    a, b = s.get(key), s.get(shift(key, -months))
    if a is None or not b:
        return None
    return ((a / b) ** (12 / months) - 1) * 100


def quarter_key(iso: str) -> str:
    return f"{iso[:4]}-Q{(int(iso[5:7]) - 1) // 3 + 1}"


# --------------------------------------------------------------------------
# panels
# --------------------------------------------------------------------------

def build_monthly(raw: dict[str, dict[str, float]], daily_ff: dict[str, dict]) -> list[dict]:
    m = {k: to_monthly(v) for k, v in raw.items()}
    months = sorted({k for s in m.values() for k in s if k >= "2015-01"})

    # Month-end policy range from the daily target series.
    ff_upper = {d[:7]: row["ff_upper"] for d, row in sorted(daily_ff.items()) if row.get("ff_upper") is not None}
    ff_lower = {d[:7]: row["ff_lower"] for d, row in sorted(daily_ff.items()) if row.get("ff_lower") is not None}

    unrate = m.get("unemployment", {})
    avg3 = {}
    for k in sorted(unrate):
        vals = [unrate.get(shift(k, -i)) for i in range(3)]
        if all(v is not None for v in vals):
            avg3[k] = sum(vals) / 3

    rows = []
    for k in months:
        payrolls = m["payrolls_lvl"]
        chg = None
        if k in payrolls and shift(k, -1) in payrolls:
            chg = payrolls[k] - payrolls[shift(k, -1)]
        chg3 = None
        if all(shift(k, -i) in payrolls for i in range(4)):
            chg3 = (payrolls[k] - payrolls[shift(k, -3)]) / 3

        sahm = None
        if k in avg3:
            prior = [avg3[shift(k, -i)] for i in range(1, 13) if shift(k, -i) in avg3]
            if len(prior) == 12:
                sahm = avg3[k] - min(prior)

        openings = m["openings_lvl"].get(k)
        unemployed = m["unemployed_lvl"].get(k)
        upper, lower = ff_upper.get(k), ff_lower.get(k)
        mid = (upper + lower) / 2 if upper is not None and lower is not None else None
        core_pce = pct_change(m["core_pce_idx"], k, 12)

        rows.append({
            "date": k,
            "headline_cpi": r(pct_change(m["cpi_idx"], k, 12)),
            "core_cpi": r(pct_change(m["core_cpi_idx"], k, 12)),
            "core_cpi_3m": r(annualised(m["core_cpi_idx"], k, 3)),
            "core_cpi_mom": r(pct_change(m["core_cpi_idx"], k, 1), 3),
            "core_services": r(pct_change(m["core_services_idx"], k, 12)),
            "supercore": r(pct_change(m["supercore_idx"], k, 12)),
            "supercore_3m": r(annualised(m["supercore_idx"], k, 3)),
            "shelter": r(pct_change(m["shelter_idx"], k, 12)),
            "headline_pce": r(pct_change(m["pce_idx"], k, 12)),
            "core_pce": r(core_pce),
            "core_pce_3m": r(annualised(m["core_pce_idx"], k, 3)),
            "core_pce_6m": r(annualised(m["core_pce_idx"], k, 6)),
            "payrolls": r(chg, 0),
            "payrolls_3m": r(chg3, 0),
            "unemployment": r(unrate.get(k), 1),
            "sahm": r(sahm),
            "openings": r(openings / 1000 if openings else None, 2),        # millions
            "v_u": r(openings / unemployed if openings and unemployed else None),
            "ahe": r(pct_change(m["ahe_idx"], k, 12)),
            "ahe_3m": r(annualised(m["ahe_idx"], k, 3)),
            "atl_wage": r(m["atl_wage"].get(k), 1),
            "retail": r(pct_change(m["retail_lvl"], k, 12)),
            "retail_mom": r(pct_change(m["retail_lvl"], k, 1)),
            "retail_ex_mom": r(pct_change(m["retail_ex_lvl"], k, 1)),
            "ip": r(pct_change(m["ip_idx"], k, 12)),
            "ip_mom": r(pct_change(m["ip_idx"], k, 1)),
            "philly": r(m["philly"].get(k), 1),
            "empire": r(m["empire"].get(k), 1),
            "ff_upper": upper,
            "ff_lower": lower,
            "ff_mid": r(mid, 3),
            "real_rate": r(mid - core_pce if mid is not None and core_pce is not None else None),
        })

    # Drop trailing months that carry nothing but the policy rate.
    while rows and all(v is None for key, v in rows[-1].items()
                       if key not in ("date", "ff_upper", "ff_lower", "ff_mid")):
        rows.pop()

    keys = [k for k in rows[0] if k != "date"] if rows else []
    for i, row in enumerate(rows):
        prev = rows[i - 1] if i else {}
        row["mom"] = {k: r(row[k] - prev[k]) if row.get(k) is not None and prev.get(k) is not None else None
                      for k in keys}
    return rows


def build_quarterly(raw: dict[str, dict[str, float]]) -> list[dict]:
    gdp = raw.get("gdp_growth", {})
    eci = raw.get("eci_idx", {})
    now = raw.get("gdpnow", {})
    quarters = sorted({quarter_key(d) for s in (gdp, eci, now) for d in s if d >= "2015-01-01"})
    eci_q = {quarter_key(d): v for d, v in eci.items()}
    rows = []
    for q in quarters:
        y, n = int(q[:4]), int(q[-1])
        prev = f"{y - 1}-Q{n}"
        eci_yoy = (eci_q[q] / eci_q[prev] - 1) * 100 if q in eci_q and prev in eci_q else None
        rows.append({
            "quarter": q,
            "gdp_growth": r(next((v for d, v in gdp.items() if quarter_key(d) == q), None), 1),
            "gdpnow": r(next((v for d, v in now.items() if quarter_key(d) == q), None), 2),
            "eci": r(eci_yoy),
        })
    return rows


def build_weekly(raw: dict[str, dict[str, float]]) -> list[dict]:
    icsa, ccsa = raw.get("icsa", {}), raw.get("ccsa", {})
    dates = sorted(icsa)
    rows = []
    for i, d in enumerate(dates):
        window = [icsa[x] for x in dates[max(0, i - 3):i + 1]]
        rows.append({
            "date": d,
            "icsa": r(icsa[d] / 1000, 0),
            "icsa_4w": r(sum(window) / len(window) / 1000, 1) if len(window) == 4 else None,
            "ccsa": r(ccsa[d] / 1000, 0) if d in ccsa else None,
        })
    return rows


def build_daily(raw: dict[str, dict[str, float]], acm: dict[str, dict]) -> list[dict]:
    dates = sorted(set(raw.get("ust_10y", {})) | set(raw.get("sofr", {})))
    dates = [d for d in dates if d >= DAILY_START]
    rows = []
    upper = lower = None
    for d in dates:
        row: dict[str, Any] = {"date": d}
        for key in FRED_DAILY:
            v = raw.get(key, {}).get(d)
            row[key] = r(v, 3) if v is not None else None
        # The target range only prints on change days in some vintages — carry it.
        upper = row["ff_upper"] if row["ff_upper"] is not None else upper
        lower = row["ff_lower"] if row["ff_lower"] is not None else lower
        row["ff_upper"], row["ff_lower"] = upper, lower

        t2, t5, t10, t30 = (row[k] for k in ("ust_2y", "ust_5y", "ust_10y", "ust_30y"))
        row["s2s10"] = r((t10 - t2) * 100, 1) if t10 is not None and t2 is not None else None
        row["s5s30"] = r((t30 - t5) * 100, 1) if t30 is not None and t5 is not None else None
        ref = row["effr"]
        row["priced_12m_proxy"] = (r((row["ust_1y"] - ref) * 100, 1)
                                   if row["ust_1y"] is not None and ref is not None else None)
        a = acm.get(d, {})
        row["acm_tp10"] = a.get("acm_tp10")
        row["acm_rn10"] = a.get("acm_rn10")
        rows.append(row)
    rows = [row for row in rows if any(row[k] is not None for k in ("ust_10y", "sofr", "effr"))]
    # Nulls are the norm here (weekends of one series, gaps in another) —
    # omit them rather than ship thousands of explicit nulls.
    return [{k: v for k, v in row.items() if v is not None} for row in rows]


def rate_decisions(daily: list[dict]) -> list[dict]:
    out = []
    prev = None
    for row in daily:
        cur = row.get("ff_upper")
        if cur is None:
            continue
        if prev is not None and cur != prev:
            out.append({"date": row["date"], "from": prev, "to": cur,
                        "change_bp": round((cur - prev) * 100)})
        prev = cur
    return out


def latest_value(rows: list[dict], key: str) -> tuple[Any, str | None]:
    for row in reversed(rows):
        if row.get(key) is not None:
            return row[key], row.get("date") or row.get("quarter")
    return None, None


def value_ago(rows: list[dict], key: str, days: int) -> float | None:
    """Value of a daily series `days` calendar days before its latest print."""
    val, when = latest_value(rows, key)
    if when is None:
        return None
    cutoff = (date.fromisoformat(when) - timedelta(days=days)).isoformat()
    for row in reversed(rows):
        if row["date"] <= cutoff and row.get(key) is not None:
            return row[key]
    return None


def proxy_pricing(daily: list[dict], meetings: list[dict], today: date) -> dict:
    """Without futures data, read the priced path off the bill/2Y curve.
    Crude — bills carry a supply premium and an SOFR/T-bill basis — and
    labelled as such in the UI."""
    effr, _ = latest_value(daily, "effr")
    points = []
    for key, label, months in (("sofr", "SOFR (o/n)", 0), ("ust_3m", "3M bill", 3),
                               ("ust_6m", "6M bill", 6), ("ust_1y", "1Y bill", 12),
                               ("ust_2y", "2Y note", 24)):
        v, when = latest_value(daily, key)
        if v is not None:
            points.append({"tenor": label, "months": months, "rate": v, "date": when,
                           "vs_effr_bp": r((v - effr) * 100, 1) if effr is not None else None})
    return {
        "source": "proxy",
        "as_of": today.isoformat(),
        "reference_rate": effr,
        "meetings": [],
        "curve": points,
        "note": "Proxy: Treasury bill / 2Y yields vs EFFR. Add Refinitiv credentials "
                "for the Fed funds futures meeting path and SOFR OIS curve.",
    }


def strip_generated(payload: Any) -> Any:
    if isinstance(payload, dict):
        return {k: strip_generated(v) for k, v in payload.items()
                if k not in ("generated_at", "sources", "as_of_run")}
    return payload


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="write even if unchanged")
    args = parser.parse_args()

    today = date.today()
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    status: dict[str, dict] = {}

    prev_meta = load_json(DATA_DIR / "meta.json", {}) or {}
    prev_pos = load_json(DATA_DIR / "positioning.json", {}) or {}

    def attempt(name: str, fn, fallback):
        try:
            value = fn()
            status[name] = {"ok": True}
            return value
        except Exception as exc:  # noqa: BLE001 - recorded in meta.sources
            log(f"{name} failed: {exc}")
            status[name] = {"ok": False, "error": str(exc)[:200]}
            return fallback

    log("FRED …")
    raw_m = fred.many(FRED_MONTHLY, MONTHLY_START, status)
    raw_q = fred.many(FRED_QUARTERLY, MONTHLY_START, status)
    raw_w = fred.many(FRED_WEEKLY, WEEKLY_START, status)
    raw_d = fred.many(FRED_DAILY, DAILY_START, status)

    if not raw_d.get("ust_10y") or not raw_m.get("core_cpi_idx"):
        log("Core FRED series missing — refusing to overwrite data with a partial set.")
        return 1

    log("NY Fed ACM term premium …")
    acm = attempt("nyfed:acm", lambda: fed.acm_term_premium(DAILY_START), {})
    if not acm:
        # Keep yesterday's term premium rather than blank the chart.
        old_daily = load_json(DATA_DIR / "daily.json", {}) or {}
        acm = {row["date"]: {"acm_tp10": row.get("acm_tp10"), "acm_rn10": row.get("acm_rn10")}
               for row in old_daily.get("observations", []) if row.get("acm_tp10") is not None}

    daily = build_daily(raw_d, acm)
    daily_by_date = {row["date"]: row for row in daily}
    monthly = build_monthly(raw_m, daily_by_date)
    quarterly = build_quarterly(raw_q)
    weekly = build_weekly(raw_w)
    decisions = rate_decisions(daily)

    log("FOMC calendar …")
    meetings = fed.fomc_calendar(CONFIG_DIR / "fomc.json")
    status["fed:fomc_calendar"] = {"ok": bool(meetings)}

    log("Cleveland Fed nowcast …")
    cleveland = attempt("clevelandfed:nowcast", fed.cleveland_nowcast,
                        (prev_meta.get("nowcasts") or {}).get("cleveland"))

    log("Policy pricing …")
    effr, _ = latest_value(daily, "effr")
    pricing = None
    if refinitiv.configured():
        pricing = attempt("refinitiv:policy_pricing",
                          lambda: refinitiv.policy_pricing(
                              CONFIG_DIR / "refinitiv.json",
                              [m["date"] for m in meetings], effr, today,
                              (today - timedelta(days=400)).isoformat()),
                          None)
    else:
        status["refinitiv:policy_pricing"] = {"ok": False, "error": "no credentials configured"}
    if pricing is None and (prev_meta.get("policy_pricing") or {}).get("source") == "refinitiv":
        # Login refused (e.g. the account is signed in to Workspace) or this
        # was a manual run told to skip Refinitiv: keep the last futures
        # pricing, flagged stale in the footer, rather than drop to the proxy.
        pricing = {**prev_meta["policy_pricing"], "stale": True}
    if pricing is None:
        pricing = proxy_pricing(daily, meetings, today)

    # Gold: Yahoo Finance COMEX front-month futures (no login needed), then
    # Refinitiv spot XAU= from the pricing session, then the last stored
    # closes. Merged into the daily panel.
    refinitiv_gold = pricing.pop("gold_history", None) or {}
    log("Gold (Yahoo Finance) …")
    gold = attempt("yahoo:gold", lambda: markets.yahoo_daily_closes("GC=F", DAILY_START), {})
    status["gold_source"] = {"ok": True, "source": "yahoo" if gold else ("refinitiv" if refinitiv_gold else "previous")}
    if not gold:
        gold = refinitiv_gold
    if not gold:
        old_daily = load_json(DATA_DIR / "daily.json", {}) or {}
        gold = {row["date"]: row["gold"] for row in old_daily.get("observations", []) if row.get("gold") is not None}
    for row in daily:
        g = gold.get(row["date"])
        if g is not None:
            row["gold"] = round(g, 2)

    log("CFTC positioning …")
    positioning = attempt("cftc:tff", lambda: flows.cftc_positioning(WEEKLY_START), prev_pos or None)

    log("Treasury auctions …")
    auctions = attempt("treasury:auctions",
                       lambda: flows.treasury_auctions(today, (today - timedelta(days=500)).isoformat()),
                       prev_meta.get("auctions"))

    log("Fed news + release calendar …")
    news = attempt("fed:news", fed.fed_news, prev_meta.get("fed_news", []))
    releases = attempt("calendars", lambda: fed.upcoming_releases(meetings, today, fred.release_dates),
                       prev_meta.get("upcoming_releases", []))

    # ---- headline snapshot ------------------------------------------------
    latest_month = next((row["date"] for row in reversed(monthly) if row.get("core_cpi") is not None), None)
    snap = {}
    for key in ("ust_2y", "ust_5y", "ust_10y", "ust_30y", "s2s10", "s5s30", "acm_tp10", "acm_rn10",
                "be_5y", "be_10y", "be_5y5y", "real_10y", "sofr", "effr", "ff_upper", "ff_lower",
                "priced_12m_proxy", "gold"):
        val, when = latest_value(daily, key)
        snap[key] = {"value": val, "date": when,
                     "chg_1w": r(val - v1, 3) if val is not None and (v1 := value_ago(daily, key, 7)) is not None else None,
                     "chg_1m": r(val - v2, 3) if val is not None and (v2 := value_ago(daily, key, 30)) is not None else None}

    gdpnow_val, gdpnow_q = latest_value(quarterly, "gdpnow")

    meta = {
        "generated_at": now,
        "latest_month": latest_month,
        "latest_daily": daily[-1]["date"] if daily else None,
        "snapshot": snap,
        "fomc": {
            "meetings": [m for m in meetings if m["date"] >= f"{today.year - 1}-01-01"],
            "next": next((m for m in meetings if m["date"] >= today.isoformat()), None),
            "decisions": decisions,
        },
        "nowcasts": {
            "cleveland": cleveland,
            "gdpnow": {"quarter": gdpnow_q, "value": gdpnow_val},
        },
        "quarterly": quarterly,
        "policy_pricing": pricing,
        "auctions": auctions,
        "fed_news": news,
        "upcoming_releases": releases,
        "notes": (load_json(CONFIG_DIR / "notes.json", {}) or {}).get("entries", []),
        "events": (load_json(CONFIG_DIR / "events.json", {}) or {}).get("events", []),
        "sources": status,
    }

    outputs = {
        "monthly.json": {"generated_at": now, "observations": monthly},
        "weekly.json": {"generated_at": now, "observations": weekly},
        "daily.json": {"generated_at": now, "observations": daily},
        "positioning.json": {"generated_at": now, **(positioning or {})},
        "meta.json": meta,
    }

    changed = [name for name, payload in outputs.items()
               if strip_generated(load_json(DATA_DIR / name)) != strip_generated(json.loads(json.dumps(payload)))]
    if not changed and not args.force:
        log("No data changes — nothing written.")
        return 0

    for name, payload in outputs.items():
        write_json(DATA_DIR / name, payload)
    failed = sorted(k for k, v in status.items() if not v.get("ok"))
    log(f"Wrote {len(outputs)} files (changed: {', '.join(changed) or 'forced'}).")
    log(f"Latest month {latest_month}, latest daily {meta['latest_daily']}, "
        f"pricing source {pricing['source']}.")
    if failed:
        log(f"{len(failed)} source(s) unavailable this run: {', '.join(failed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
