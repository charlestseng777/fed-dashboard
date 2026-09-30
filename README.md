# Fed Dashboard

A US rates dashboard built around one question: **what is the FOMC reacting to,
and what is the market pricing it to do?** It is the US counterpart of the
[UK inflation & monetary policy dashboard](https://github.com/charlestseng777/UK-inflation-and-monetary-policy),
with the same look and the same daily GitHub Actions → GitHub Pages pipeline.

Live site: `https://charlestseng777.github.io/fed-dashboard/`

## What it tracks

| Category | Series | Source |
|---|---|---|
| Inflation | Core/headline CPI, supercore, shelter, core/headline PCE (y/y, 3m and 6m annualised), Cleveland Fed inflation nowcast, 5Y / 10Y / 5y5y breakevens | FRED (BLS, BEA), Cleveland Fed |
| Labour | Nonfarm payrolls, unemployment, Sahm indicator, JOLTS openings, openings per unemployed, weekly initial and continuing claims, average hourly earnings, Atlanta Fed wage tracker | FRED (BLS, DoL, Atlanta Fed) |
| Growth | Retail sales, industrial production, Philly Fed and Empire State manufacturing surveys, GDPNow, real GDP | FRED (Census, Fed Board, BEA, Atlanta Fed) |
| Policy pricing | Fed funds futures meeting-by-meeting path and SOFR OIS curve (**Refinitiv, if configured**); otherwise a bill-curve proxy (1Y bill − EFFR) | Refinitiv / FRED |
| Treasury market | 2Y, 5Y, 10Y, 30Y, 2s10s, 5s30s, ACM term premium and expected-path split, Kim-Wright term premium, 10Y real yield, SOFR, EFFR | FRED (H.15), NY Fed |
| Positioning & flows | CFTC Traders in Financial Futures: leveraged funds / asset managers / dealers for Fed funds, SOFR and 2Y–Ultra bond futures, DV01-weighted, with 3-year z-scores and percentiles; Treasury coupon auction results vs the 6-auction average plus the announced calendar; dealer/client commentary (hand-kept) | CFTC, Treasury Fiscal Data, `config/notes.json` |

The **Fed watch** panel and scorecard tag each category hawkish, dovish or neutral
using fixed thresholds that are printed on the page. The logic is in
`web/src/lib/fedwatch.js`.

### What isn't scraped, and why

- **ISM Manufacturing/Services** are licensed (FRED removed them in 2016). The
  Philly Fed and Empire State surveys stand in for them.
- **CME FedWatch / Fed funds futures and SOFR OIS** need a data licence. They are
  pulled from Refinitiv when credentials are configured (see below); otherwise
  the page shows a clearly labelled Treasury-bill proxy.
- **Dealer/client commentary** is private. Add it by hand to `config/notes.json`
  (the format is described in the file). It appears on the next refresh.

## Refinitiv (optional)

Add these as **repository secrets** (Settings → Secrets and variables → Actions),
never in a file:

- Service account (preferred): `REFINITIV_CLIENT_ID`, `REFINITIV_CLIENT_SECRET`
- or a user login: `REFINITIV_USERNAME`, `REFINITIV_PASSWORD`, `REFINITIV_APP_KEY`

An Eikon/Workspace **App Key alone is not enough**, because it authenticates
through the Workspace desktop app, which a CI runner doesn't have. The RICs
used (`FFc1`…`FFc13`, `USDSROIS*=`) are in `config/refinitiv.json` if your
entitlements differ.

`FRED_API_KEY` (free) is also optional. Without it, the key-free CSV
endpoint is used.

## How it runs

`.github/workflows/update-data.yml` runs once each weekday at 23:45 UK time,
after that day's US data, FOMC and market closes. Cron is UTC, so there are two
slots (22:45 and 23:45 UTC) and a gate step lets through only the one that
lands at 23:45 UK time in the current season. Each run:

1. `python fetcher/fetch.py` pulls every source. Each source is independent: one
   that fails keeps its previous values and is flagged in the page footer.
2. If anything changed, it commits `data/*.json`.
3. It builds `web/` and publishes it to the `gh-pages` branch.

In the repo settings, set Pages to deploy from the `gh-pages` branch. To force a
refresh, go to Actions → Update data → Run workflow and tick **force**.

## Local development

```bash
pip install -r fetcher/requirements.txt
python fetcher/fetch.py
npm --prefix web install
npm --prefix web run dev
```

Not investment advice.
