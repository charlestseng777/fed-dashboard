"""Federal Reserve System sources that aren't on FRED (or aren't timely there).

- NY Fed ACM term premium (daily, xls)
- Cleveland Fed inflation nowcast (JSON behind their nowcasting page)
- FOMC meeting calendar (scraped from federalreserve.gov)
- Board press releases / speeches (RSS)
"""

from __future__ import annotations

import html
import io
import json
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

from fetcher import net as http

ACM_URL = "https://www.newyorkfed.org/medialibrary/media/research/data_indicators/ACMTermPremium.xls"

CLEVELAND_URLS = [
    "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json",
    "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_quarter.json",
]

FOMC_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"

FEEDS = {
    "monetary": "https://www.federalreserve.gov/feeds/press_monetary.xml",
    "speeches": "https://www.federalreserve.gov/feeds/speeches.xml",
}

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"])}


# --------------------------------------------------------------------------
# ACM term premium
# --------------------------------------------------------------------------

def acm_term_premium(start: str) -> dict[str, dict[str, float]]:
    """Daily ACM 10Y (and 2Y/5Y) term premium and risk-neutral yield.

    Returns {'YYYY-MM-DD': {'acm_tp10': .., 'acm_rn10': .., ...}}.
    """
    import xlrd  # imported lazily: only this source needs it

    book = xlrd.open_workbook(file_contents=http.get(ACM_URL))
    wanted = {"ACMTP10": "acm_tp10", "ACMRNY10": "acm_rn10",
              "ACMTP05": "acm_tp5", "ACMTP02": "acm_tp2"}

    best: dict[str, dict[str, float]] = {}
    for sheet in book.sheets():
        if sheet.nrows < 10:
            continue
        header = [str(c.value).strip().upper() for c in sheet.row(0)]
        if "DATE" not in header or "ACMTP10" not in header:
            continue
        di = header.index("DATE")
        cols = {wanted[h]: header.index(h) for h in wanted if h in header}
        out: dict[str, dict[str, float]] = {}
        for r in range(1, sheet.nrows):
            cell = sheet.cell(r, di)
            iso = _xls_date(cell, book.datemode)
            if not iso or iso < start:
                continue
            row = {}
            for name, ci in cols.items():
                try:
                    row[name] = round(float(sheet.cell_value(r, ci)), 3)
                except (TypeError, ValueError):
                    pass
            if row:
                out[iso] = row
        # The workbook carries daily and monthly sheets — keep the densest.
        if len(out) > len(best):
            best = out
    if not best:
        raise RuntimeError("ACM workbook: no sheet with DATE/ACMTP10 columns")
    return best


def _xls_date(cell, datemode) -> str | None:
    import xlrd

    if cell.ctype == xlrd.XL_CELL_DATE or isinstance(cell.value, float):
        try:
            return xlrd.xldate_as_datetime(cell.value, datemode).date().isoformat()
        except Exception:  # noqa: BLE001
            return None
    text = str(cell.value).strip()
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------
# Cleveland Fed inflation nowcast
# --------------------------------------------------------------------------

def cleveland_nowcast() -> dict:
    """Latest Cleveland Fed nowcasts.

    The nowcasting page is driven by FusionCharts JSON: a list of chart
    objects, one per target period, each with named series whose last
    non-null point is the current nowcast. Parsed defensively — only the
    series names and the final value are relied on.
    """
    result: dict = {"monthly": [], "quarterly": []}
    for url, bucket, keep in zip(CLEVELAND_URLS, ("monthly", "quarterly"), (2, 2)):
        payload = http.get_json(url)
        charts = payload if isinstance(payload, list) else [payload]
        entries = []
        for chart in charts:
            meta = chart.get("chart", {}) if isinstance(chart, dict) else {}
            period = _clean(meta.get("subcaption") or meta.get("caption") or "")
            values: dict[str, float] = {}
            actual = False
            for ds in (chart.get("dataset") or []) if isinstance(chart, dict) else []:
                name = _clean(ds.get("seriesname", ""))
                points = [p.get("value") for p in ds.get("data", []) if isinstance(p, dict)]
                points = [float(p) for p in points if p not in (None, "")]
                if not name or not points:
                    continue
                # "Actual …" series are the official print once it's out —
                # a period that has them is history, not a nowcast.
                if name.lower().startswith("actual"):
                    actual = True
                    continue
                values[name] = round(points[-1], 2)
            if values:
                entries.append({"period": _period_label(period), "sort": _period_key(period),
                                "values": values, "final": actual})
        entries.sort(key=lambda e: e["sort"])
        live = [e for e in entries if not e["final"]] or entries
        result[bucket] = [{"period": e["period"], "values": e["values"]} for e in live[-keep:]][::-1]
    if not result["monthly"] and not result["quarterly"]:
        raise RuntimeError("Cleveland nowcast JSON had no recognisable series")
    return result


MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


def _period_key(text: str) -> tuple:
    """'2026-9' / '2026:Q3' / '2026 Q3' -> sortable tuple."""
    m = re.search(r"(\d{4})\D*?(Q?)(\d{1,2})", text)
    if not m:
        return (0, 0)
    return (int(m.group(1)), int(m.group(3)) * (3 if m.group(2) else 1))


def _period_label(text: str) -> str:
    m = re.search(r"(\d{4})\D*?(Q?)(\d{1,2})", text)
    if not m:
        return text
    year, q, n = m.group(1), m.group(2), int(m.group(3))
    if q:
        return f"{year} Q{n}"
    return f"{MONTH_NAMES[n - 1]} {year}" if 1 <= n <= 12 else text


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(text)))).strip()


# --------------------------------------------------------------------------
# FOMC calendar
# --------------------------------------------------------------------------

def fomc_calendar(fallback_path: Path) -> list[dict]:
    """Meeting decision dates (second day), scraped, with a config fallback.

    Returns [{'date': 'YYYY-MM-DD', 'sep': bool}], sorted.
    """
    try:
        meetings = _scrape_fomc()
        if meetings:
            return meetings
    except Exception as exc:  # noqa: BLE001
        http.log(f"FOMC calendar scrape failed, using config: {exc}")
    return json.loads(fallback_path.read_text())["meetings"]


def _scrape_fomc() -> list[dict]:
    page = http.get_text(FOMC_CALENDAR_URL)
    out: list[dict] = []
    # Split the page into per-year panels on their headings.
    parts = re.split(r"(\d{4}) FOMC Meetings", page)
    for i in range(1, len(parts) - 1, 2):
        year = int(parts[i])
        body = parts[i + 1]
        months = re.findall(r'fomc-meeting__month[^>]*>\s*(?:<strong>)?([^<]+)', body)
        dates = re.findall(r'fomc-meeting__date[^>]*>\s*([^<]+)', body)
        for mtext, dtext in zip(months, dates):
            mtext, dtext = mtext.strip(), dtext.strip()
            if "notation" in dtext.lower() or "unscheduled" in dtext.lower():
                continue
            names = [m.strip().lower() for m in mtext.split("/")]
            days = re.findall(r"\d+", dtext)
            if not days or names[-1] not in MONTHS:
                continue
            month = MONTHS[names[-1]]
            try:
                d = date(year, month, int(days[-1]))
            except ValueError:
                continue
            out.append({"date": d.isoformat(), "sep": "*" in dtext})
    uniq = {m["date"]: m for m in out}
    return sorted(uniq.values(), key=lambda m: m["date"])


# --------------------------------------------------------------------------
# Press releases / speeches
# --------------------------------------------------------------------------

def fed_news(limit: int = 12) -> list[dict]:
    items: list[dict] = []
    for kind, url in FEEDS.items():
        try:
            root = ET.fromstring(http.get(url))
        except Exception as exc:  # noqa: BLE001
            http.log(f"Fed feed {kind} failed: {exc}")
            continue
        for item in root.iter("item"):
            title = _clean(item.findtext("title") or "")
            link = (item.findtext("link") or "").strip()
            when = item.findtext("pubDate") or ""
            try:
                iso = parsedate_to_datetime(when).date().isoformat()
            except (TypeError, ValueError):
                iso = None
            if title and link:
                items.append({"kind": kind, "title": title, "url": link, "date": iso})
    items.sort(key=lambda x: x["date"] or "", reverse=True)
    return items[:limit]


# --------------------------------------------------------------------------
# Release calendar (BLS/BEA iCal feeds + rule-based weekly items)
# --------------------------------------------------------------------------

ICS_FEEDS = {
    "BLS": "https://www.bls.gov/schedule/news_release/bls.ics",
    "BEA": "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics",
}

# Map a release title fragment to what the dashboard calls it.
RELEASE_MATCH = [
    ("Consumer Price Index", "CPI", "BLS"),
    ("Employment Situation", "Payrolls & unemployment", "BLS"),
    ("Job Openings and Labor Turnover", "JOLTS job openings", "BLS"),
    ("Employment Cost Index", "Employment Cost Index", "BLS"),
    ("Producer Price Index", "PPI", "BLS"),
    ("Personal Income and Outlays", "PCE inflation", "BEA"),
    ("Gross Domestic Product", "GDP", "BEA"),
    ("Advance Monthly Sales for Retail", "Retail sales", "Census"),
    ("Industrial Production and Capacity Utilization", "Industrial production", "Fed Board"),
]


def upcoming_releases(meetings: list[dict], today: date, fred_calendar=None,
                      horizon_days: int = 45) -> list[dict]:
    end = today + timedelta(days=horizon_days)
    found: dict[str, dict] = {}

    def consider(when: date, title: str, source: str | None) -> None:
        for fragment, label, src in RELEASE_MATCH:
            if (source is None or src == source) and fragment.lower() in title.lower():
                if label not in found or when.isoformat() < found[label]["date"]:
                    found[label] = {"id": label, "label": label, "date": when.isoformat(), "source": src}

    for source, url in ICS_FEEDS.items():
        try:
            text = http.get_text(url)
        except Exception as exc:  # noqa: BLE001
            http.log(f"{source} calendar failed: {exc}")
            continue
        for event in text.split("BEGIN:VEVENT")[1:]:
            summary = _ics_field(event, "SUMMARY")
            start = _ics_field(event, "DTSTART")
            if not summary or not start:
                continue
            digits = re.sub(r"\D", "", start)[:8]
            try:
                when = datetime.strptime(digits, "%Y%m%d").date()
            except ValueError:
                continue
            if today <= when <= end:
                consider(when, summary, source)

    # FRED's release calendar covers every agency (and isn't bot-blocked the
    # way bls.gov is), so use it to fill whatever the iCal feeds missed.
    if fred_calendar:
        try:
            for iso, name in fred_calendar(today.isoformat(), end.isoformat()):
                consider(date.fromisoformat(iso), name, None)
        except Exception as exc:  # noqa: BLE001
            http.log(f"FRED release calendar failed: {exc}")

    # Weekly claims: every Thursday.
    d = today + timedelta(days=(3 - today.weekday()) % 7)
    found["claims"] = {"id": "claims", "label": "Initial jobless claims", "date": d.isoformat(), "source": "DoL"}
    # CFTC Commitments of Traders: Fridays.
    d = today + timedelta(days=(4 - today.weekday()) % 7)
    found["cot"] = {"id": "cot", "label": "CFTC positioning (COT)", "date": d.isoformat(), "source": "CFTC"}

    nxt = next((m for m in meetings if m["date"] >= today.isoformat()), None)
    if nxt:
        found["fomc"] = {"id": "fomc", "label": "FOMC decision" + (" + SEP" if nxt.get("sep") else ""),
                         "date": nxt["date"], "source": "Federal Reserve"}

    return sorted(found.values(), key=lambda x: x["date"])


def _ics_field(event: str, name: str) -> str | None:
    # Unfold continuation lines, then match NAME or NAME;PARAMS.
    unfolded = re.sub(r"\r?\n[ \t]", "", event)
    m = re.search(rf"^{name}(?:;[^:\r\n]*)?:(.*)$", unfolded, re.MULTILINE)
    return m.group(1).strip() if m else None


# --------------------------------------------------------------------------
# Fed Board fitted yield curves (Gürkaynak-Sack-Wright)
# --------------------------------------------------------------------------

GSW_NOMINAL_URL = "https://www.federalreserve.gov/data/yield-curve-tables/feds200628.csv"
GSW_TIPS_URL = "https://www.federalreserve.gov/data/yield-curve-tables/feds200805.csv"


def gsw_columns(url: str, columns: dict[str, str], start: str) -> dict[str, dict[str, float]]:
    """Selected columns from one of the Board's fitted-curve CSVs.

    The files open with a block of description lines; the data header is the
    first line starting 'Date,'. Returns {'YYYY-MM-DD': {name: value}} for
    rows on or after `start`, with 'NA'/blank cells skipped.
    """
    text = http.get_text(url)
    lines = text.splitlines()
    try:
        head = next(i for i, ln in enumerate(lines) if ln.strip().lower().startswith("date,"))
    except StopIteration:
        raise RuntimeError(f"{url.rsplit('/', 1)[-1]}: no 'Date,' header line") from None
    header = [h.strip().upper() for h in lines[head].split(",")]
    idx = {name: header.index(col.upper()) for name, col in columns.items() if col.upper() in header}
    missing = [col for name, col in columns.items() if name not in idx]
    if missing:
        raise RuntimeError(f"{url.rsplit('/', 1)[-1]}: columns not found {missing}")

    out: dict[str, dict[str, float]] = {}
    for ln in lines[head + 1:]:
        parts = ln.split(",")
        day = parts[0].strip()
        if len(day) != 10 or day < start:
            continue
        row = {}
        for name, i in idx.items():
            try:
                v = parts[i].strip()
                if v and v.upper() != "NA":
                    row[name] = round(float(v), 3)
            except (IndexError, ValueError):
                continue
        if row:
            out[day] = row
    if not out:
        raise RuntimeError(f"{url.rsplit('/', 1)[-1]}: no rows since {start}")
    return out


def near_term_expectations(start: str) -> dict[str, dict[str, float]]:
    """1y1y Treasury forward (nominal GSW SVEN1F01) and 2Y zero-coupon TIPS
    breakeven (GSW BKEVEN02), merged by date."""
    nominal = gsw_columns(GSW_NOMINAL_URL, {"fwd_1y1y": "SVEN1F01"}, start)
    tips = gsw_columns(GSW_TIPS_URL, {"be_2y": "BKEVEN02"}, start)
    merged: dict[str, dict[str, float]] = {}
    for src in (nominal, tips):
        for day, row in src.items():
            merged.setdefault(day, {}).update(row)
    return merged
