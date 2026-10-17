"""Dataset validation + EDA report generator.

Usage (from repo root):
    python -m ml.eda [--data PATH] [--out-dir ml/reports]

Writes eda_report.json and eda_report.md containing only values observed in the data.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from ml.config import RAW_DATA_PATH, REPORT_DIR
from ml.data_validation import DataValidationError, file_sha256, profile_csv, validation_issues


def render_markdown(p: dict[str, Any], errors: list[str], warnings: list[str]) -> str:
    cd = p["class_distribution"]
    L = [
        "# PaySim EDA & Validation Report",
        "",
        "_All numbers below were computed from the actual CSV by `ml/eda.py`._",
        "",
        f"- File: `{Path(p['path']).name}` ({p['file_size_bytes']:,} bytes)",
        f"- SHA-256: `{p.get('sha256', 'n/a')}`",
        f"- Rows: **{p['rows']:,}**; columns: {', '.join(p['columns'])}",
        f"- Duplicate rows: **{p['duplicate_rows']:,}** ({p['duplicate_method']})",
        f"- Missing values: {sum(p['missing_values'].values()):,} total "
        f"({'none' if not any(p['missing_values'].values()) else p['missing_values']})",
        "",
        "## Target (`isFraud`)",
        f"- Legitimate (0): {cd['legitimate_0']:,}",
        f"- Fraud (1): {cd['fraud_1']:,}",
        f"- Fraud prevalence: **{p['fraud_prevalence']:.6%}**",
        f"- Imbalance: {p['imbalance_ratio_legit_per_fraud']:.1f} legitimate per fraud",
        "",
        "## Transaction types",
        "| type | rows | fraud | fraud rate |",
        "|---|---:|---:|---:|",
    ]
    for t, d in p["type_distribution"].items():
        L.append(f"| {t} | {d['rows']:,} | {d['fraud']:,} | {d['fraud_rate']:.4%} |")
    f = p["isFlaggedFraud"]
    s = p["step"]
    a = p["amount"]
    b = p["balance_quirks"]
    L += [
        "",
        "## `isFlaggedFraud` (excluded from features)",
        f"- Rows flagged: {f['flagged_rows']:,}; flagged AND fraud: {f['flagged_and_fraud']:,}; "
        f"fraud rows NOT flagged: {f['fraud_rows_not_flagged']:,}",
        "",
        "## Time (`step`, 1 step = 1 hour)",
        f"- Range {s['min']}–{s['max']}, {s['distinct_steps']} distinct steps, "
        f"sorted ascending in file: {s['sorted_ascending']}",
        "",
        "## Amount",
        f"- min {a['min']:,.2f}, max {a['max']:,.2f}, negative rows {a['negative']}, zero rows {a['zero']}",
        f"- mean amount: legitimate {a['mean_legit']:,.2f}, fraud {a['mean_fraud']:,.2f}",
        "",
        "## Balance patterns relevant to leakage assessment",
        f"- Rows with destination old & new balance both 0 and amount > 0: "
        f"legit {b['dest_balances_both_zero_with_positive_amount']['legit']:,}, "
        f"fraud {b['dest_balances_both_zero_with_positive_amount']['fraud']:,}",
        f"- Rows with newbalanceOrig == 0: legit {b['newbalanceOrig_zero']['legit']:,}, "
        f"fraud {b['newbalanceOrig_zero']['fraud']:,}",
        "",
        "## Validation outcome",
        f"- Errors: {errors or 'none'}",
        f"- Warnings: {warnings or 'none'}",
    ]
    return "\n".join(L) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=RAW_DATA_PATH)
    ap.add_argument("--out-dir", type=Path, default=REPORT_DIR)
    args = ap.parse_args(argv)
    try:
        profile = profile_csv(args.data)
    except DataValidationError as exc:
        print(f"VALIDATION FAILED: {exc}", file=sys.stderr)
        return 2
    profile["sha256"] = file_sha256(args.data)
    errors, warnings = validation_issues(profile)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "eda_report.json").write_text(json.dumps(
        {**profile, "validation_errors": errors, "validation_warnings": warnings}, indent=2))
    (args.out_dir / "eda_report.md").write_text(render_markdown(profile, errors, warnings))
    print((args.out_dir / "eda_report.md").read_text())
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
