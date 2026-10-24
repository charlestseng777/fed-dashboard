"""US Treasury daily yield curves, used to close FRED's publication lag.

FRED's H.15 series (DGS*, DFII*, and the breakevens derived from them) post
a day's values the following afternoon US time, so an early-morning UK run
would always be a day behind, and two days behind after a weekend. The
Treasury publishes the same par (CMT) and real yield curves on the evening of
the day itself, so its latest dates are appended where FRED has no value yet.
FRED's history is never overwritten; the two agree because FRED republishes
the Treasury's CMT curve.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime

from fetcher import net as http

URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
       "daily-treasury-rates.csv/{year}/all?type={kind}&field_tdr_date_value={year}&page&_format=csv")

NOMINAL = {"ust_3m": "3 Mo", "ust_6m": "6 Mo", "ust_1y": "1 Yr", "ust_2y": "2 Yr",
           "ust_5y": "5 Yr", "ust_10y": "10 Yr", "ust_30y": "30 Yr"}
REAL = {"real_5y": "5 YR", "real_10y": "10 YR"}


def _curve(kind: str, columns: dict[str, str], years: list[int]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for year in years:
        text = http.get_text(URL.format(year=year, kind=kind))
        for row in csv.DictReader(io.StringIO(text)):
            try:
                d = datetime.strptime(row["Date"], "%m/%d/%Y").date().isoformat()
            except (KeyError, ValueError):
                continue
            for key, col in columns.items():
                try:
                    out.setdefault(key, {})[d] = float(row[col])
                except (KeyError, TypeError, ValueError):
                    continue
    return out


def latest_curves(today: date) -> dict[str, dict[str, float]]:
    """{key: {date: value}} for this year and last (covers early January)."""
    years = [today.year - 1, today.year]
    data = _curve("daily_treasury_yield_curve", NOMINAL, years)
    data.update(_curve("daily_treasury_real_yield_curve", REAL, years))
    return data


def fill_gap(raw_d: dict[str, dict[str, float]], treasury: dict[str, dict[str, float]]) -> list[str]:
    """Append Treasury values for dates after FRED's last print, per series,
    and derive breakevens (nominal - real, FRED's own T5YIE/T10YIE
    definition) for those dates. Returns the dates added."""
    added: set[str] = set()
    for key in list(NOMINAL) + ["real_10y"]:
        src = treasury.get(key, {})
        fred_series = raw_d.setdefault(key, {})
        last = max(fred_series) if fred_series else ""
        for d, v in src.items():
            if d > last:
                fred_series[d] = v
                added.add(d)
    for be, nom, real in (("be_5y", "ust_5y", "real_5y"), ("be_10y", "ust_10y", "real_10y")):
        series = raw_d.setdefault(be, {})
        last = max(series) if series else ""
        for d in sorted(treasury.get(real, {})):
            n, r = raw_d.get(nom, {}).get(d), treasury[real].get(d)
            if d > last and n is not None and r is not None:
                series[d] = round(n - r, 3)
    return sorted(added)
