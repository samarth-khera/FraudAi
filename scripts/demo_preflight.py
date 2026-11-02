"""One-shot demo preflight: wakes the backend and warms what a live demo touches first, then reports timings.

    python scripts/demo_preflight.py --base-url https://<your-backend>.onrender.com
    python scripts/demo_preflight.py --base-url http://127.0.0.1:8000 --account FS-DE98A61C

Run it once, a few minutes before a demonstration. It is not a keep-alive: it sends a fixed, small set of read-only
requests and exits, and it never schedules anything. It never calls an AI explanation endpoint (no Gemini request),
never writes, and needs no credentials. Standard library only.

What it does, in order:
1. GET /health until the server answers (a sleeping free-tier instance can take 40-90 s to start).
2. GET /api/v2/models/status and /api/v2/datasets.
3. GET the sample accounts of each dataset (computed once, then cached on the server).
4. One dynamic investigation per dataset (loads the models and warms the database pages), on the first suggested
   sample account or on --account. Investigations are computed and discarded; nothing is stored.
Exit status: 0 when every step answered, 1 otherwise.
"""

from __future__ import annotations

import argparse
import gzip
import http.client
import json
import sys
import time
import urllib.error
import urllib.request

FORBIDDEN = ("/explanation",)  # the preflight must never reach the AI analyst
ATTEMPTS = 2  # every request here is a read, so a transfer cut off in transit is simply asked for once more


def _body(raw: bytes, headers) -> bytes:
    return gzip.decompress(raw) if raw and (headers.get("Content-Encoding") or "").lower() == "gzip" else raw


def call(base: str, path: str, method: str = "GET", body: dict | None = None, timeout: float = 120.0) -> tuple[int, float, object]:
    if any(f in path for f in FORBIDDEN):
        raise ValueError("the preflight never calls an AI explanation endpoint")
    data = json.dumps(body).encode() if body is not None else None
    # gzip makes a large investigation about 11x smaller on the wire. Long uncompressed HTTP/1.1 responses from the
    # free host were occasionally cut off in transit (the server had answered 200), which used to end the preflight
    # with a traceback.
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "gzip"})
    t0 = time.perf_counter()
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw, status = _body(r.read(), r.headers), r.status
            break
        except urllib.error.HTTPError as e:
            raw, status = _body(e.read(), e.headers), e.code
            break
        except http.client.HTTPException as e:  # e.g. IncompleteRead: the connection closed part-way through the body
            if attempt == ATTEMPTS:
                return 0, time.perf_counter() - t0, f"response cut off in transit {ATTEMPTS} times ({type(e).__name__}); run the preflight again"
            print(f"     ({path}: response cut off in transit; asking once more)", flush=True)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            return 0, time.perf_counter() - t0, str(getattr(e, "reason", e))
    try:
        payload = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        payload = raw[:200].decode(errors="replace")
    return status, time.perf_counter() - t0, payload


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base-url", required=True, help="backend origin, e.g. https://example.onrender.com")
    ap.add_argument("--account", help="forensic-scenarios account to investigate (default: the first suggested sample)")
    ap.add_argument("--wake-timeout", type=float, default=180.0, help="seconds to wait for /health (cold start)")
    a = ap.parse_args()
    base = a.base_url.rstrip("/")
    ok = True
    rows: list[tuple[str, int, float, str]] = []

    def record(name: str, status: int, seconds: float, note: str = "") -> None:
        nonlocal ok
        ok = ok and status == 200
        rows.append((name, status, seconds, note))
        print(f"{'OK  ' if status == 200 else 'FAIL'} {name:<46} {status:>3} {seconds:7.2f} s  {note}", flush=True)

    # 1. wake
    t0, status, payload = time.perf_counter(), 0, None
    while time.perf_counter() - t0 < a.wake_timeout:
        status, _, payload = call(base, "/health", timeout=60)
        if status == 200:
            break
        time.sleep(5)
    record("GET /health (wake)", status, time.perf_counter() - t0,
           f"writes: {payload.get('write_access')}" if isinstance(payload, dict) else str(payload)[:80])
    if status != 200:
        print("The backend did not answer; nothing else was tried.")
        return 1

    # 2. status and datasets
    s, dt, p = call(base, "/api/v2/models/status")
    im = p.get("investigation_models") if isinstance(p, dict) else None
    record("GET /api/v2/models/status", s, dt, f"investigation models ready: {im.get('ready')}" if im else "")
    s, dt, p = call(base, "/api/v2/datasets")
    datasets = [d["dataset_id"] for d in p] if s == 200 and isinstance(p, list) else []
    record("GET /api/v2/datasets", s, dt, ", ".join(f"{d['dataset_id']}={d.get('model_support')}" for d in p) if datasets else "")

    # 3. samples (first call computes, second must be the cached answer)
    first_sample: dict[str, str] = {}
    for ds in datasets:
        for attempt in ("compute", "cached"):
            s, dt, p = call(base, f"/api/v2/datasets/{ds}/sample-accounts")
            accounts = [x["account_id"] for x in p.get("accounts", [])] if isinstance(p, dict) else []
            if accounts:
                first_sample.setdefault(ds, accounts[0])
            record(f"GET sample-accounts {ds} ({attempt})", s, dt, ", ".join(accounts[:3]))

    # 4. one investigation per dataset (models load on the first one)
    for ds in datasets:
        account = a.account if (a.account and ds == "forensic-scenarios") else first_sample.get(ds)
        if not account:
            record(f"POST dynamic investigation {ds}", 0, 0.0, "no account to investigate")
            continue
        s, dt, p = call(base, "/api/v2/dynamic-investigations", "POST", {"account_id": account, "dataset_id": ds}, timeout=180)
        note = ""
        if isinstance(p, dict) and "victim_assessment" in p:
            note = f"{account}: {p['victim_assessment']['label']}; AI analyst: {p['investigation']['ai_analysis']['state']}"
        record(f"POST dynamic investigation {ds}", s, dt, note)

    print("\nReady for the demo." if ok else "\nSome steps failed: check the backend before presenting.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
