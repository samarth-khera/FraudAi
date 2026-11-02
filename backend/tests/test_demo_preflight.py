"""scripts/demo_preflight.py: compressed requests, one retry for a response cut off in transit, and no AI endpoint.

Seen against the free Render instance on 2026-11-02: long uncompressed HTTP/1.1 responses were occasionally cut off
part-way (the server had logged 200), and the preflight ended with an http.client.IncompleteRead traceback.
"""
import gzip
import http.client
import importlib.util
import io
import json
import urllib.error
import urllib.request
from email.message import Message
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "demo_preflight.py"
spec = importlib.util.spec_from_file_location("demo_preflight", SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

BASE = "https://backend.example"
PAYLOAD = {"victim_assessment": {"label": "Potential victim"}, "investigation": {"ai_analysis": {"state": "disabled"}}}


def _headers(encoding=None):
    h = Message()
    if encoding:
        h["Content-Encoding"] = encoding
    return h


class FakeResponse:
    def __init__(self, raw, status=200, encoding="gzip", cut_off=False):
        self._raw, self.status, self.headers, self._cut = raw, status, _headers(encoding), cut_off

    def read(self):
        if self._cut:
            raise http.client.IncompleteRead(self._raw[:100], len(self._raw) - 100)
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _gz(obj):
    return gzip.compress(json.dumps(obj).encode())


def test_a_response_cut_off_once_is_requested_again_and_succeeds(monkeypatch):
    seen = []

    def urlopen(req, timeout):
        seen.append(req)
        return FakeResponse(_gz(PAYLOAD), cut_off=len(seen) == 1)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    status, _, payload = preflight.call(BASE, "/api/v2/dynamic-investigations", "POST", {"account_id": "FS-1", "dataset_id": "forensic-scenarios"})
    assert (status, payload) == (200, PAYLOAD)
    assert len(seen) == 2


def test_a_response_cut_off_every_time_is_reported_plainly_not_raised(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: FakeResponse(_gz(PAYLOAD), cut_off=True))
    status, _, payload = preflight.call(BASE, "/api/v2/datasets")
    assert status == 0
    assert "cut off in transit" in payload and "IncompleteRead" in payload


def test_requests_ask_for_gzip_and_decode_it(monkeypatch):
    seen = []

    def urlopen(req, timeout):
        seen.append(req)
        return FakeResponse(_gz({"status": "ok"}))

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert preflight.call(BASE, "/health")[2] == {"status": "ok"}
    assert seen[0].get_header("Accept-encoding") == "gzip"


def test_an_uncompressed_answer_is_read_as_it_is(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: FakeResponse(json.dumps({"status": "ok"}).encode(), encoding=None))
    assert preflight.call(BASE, "/health")[:3:2] == (200, {"status": "ok"})


def test_a_compressed_error_body_is_decoded(monkeypatch):
    def urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", _headers("gzip"), io.BytesIO(_gz({"error": {"code": "not_found"}})))

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    status, _, payload = preflight.call(BASE, "/api/v2/datasets/forensic-scenarios/accounts/FS-NOTREAL1")
    assert (status, payload) == (404, {"error": {"code": "not_found"}})


@pytest.mark.parametrize("path", ["/api/v2/dynamic-investigations/explanation", "/api/v2/investigations/explanation"])
def test_the_preflight_never_calls_an_ai_explanation_endpoint(monkeypatch, path):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: pytest.fail("no request may be sent"))
    with pytest.raises(ValueError):
        preflight.call(BASE, path, "POST", {"account_id": "FS-1"})
