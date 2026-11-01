"""Investigator-facing number formatting shared by the V2 services."""

from __future__ import annotations


def inr(x: float) -> str:
    """Indian digit grouping (₹2,50,000), matching the frontend; paise only when present."""
    sign, x = ("-" if x < 0 else ""), abs(round(x, 2))
    whole, paise = divmod(round(x * 100), 100)
    digits = str(whole)
    head, tail = digits[:-3], digits[-3:]
    groups = [head[max(0, i - 2):i] for i in range(len(head), 0, -2)][::-1]
    grouped = ",".join(groups + [tail]) if head else tail
    return f"{sign}₹{grouped}" + (f".{paise:02d}" if paise else "")
