"""Small HTTP layer shared by every source module.

Standard library only. Every request retries with exponential backoff because
the sources here (FRED, the regional Feds, CFTC, Treasury) all throw the odd
502/timeout, and one flaky request shouldn't cost a whole day's refresh.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# Several of the public-sector sites here (BLS in particular) reject requests
# that don't look like a browser, so send an ordinary one and say who we are.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36 fed-dashboard/1.0 "
    "(+https://github.com/charlestseng777/fed-dashboard)"
)
TIMEOUT = 60
RETRIES = 3


def log(msg: str) -> None:
    print(f"[fetch] {msg}", flush=True)


def get(url: str, headers: dict[str, str] | None = None, retries: int = RETRIES) -> bytes:
    merged = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    merged.update(headers or {})
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=merged)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last = exc
            # 4xx other than rate limiting won't get better on retry.
            if 400 <= exc.code < 500 and exc.code != 429:
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = exc
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def get_text(url: str, headers: dict[str, str] | None = None) -> str:
    return get(url, headers).decode("utf-8-sig", errors="replace")


def get_json(url: str, headers: dict[str, str] | None = None) -> Any:
    return json.loads(get_text(url, {"Accept": "application/json", **(headers or {})}))


def post_form(url: str, fields: dict[str, str], headers: dict[str, str] | None = None) -> Any:
    body = urllib.parse.urlencode(fields).encode("utf-8")
    merged = {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    merged.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=merged, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Auth errors carry a useful JSON body; surface it (never the request).
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"POST {url} -> {exc.code}: {detail}") from None
