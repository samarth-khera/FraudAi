"""Render a model card from computed metrics (no hardcoded numbers)."""

from __future__ import annotations

from typing import Any


def _row(name: str, r: dict[str, Any]) -> str:
    t = r["test"]
    cm = t["confusion_matrix"]
    pr = f"{t['pr_auc']:.4f}" if t["pr_auc"] is not None else "n/a"
    roc = f"{t['roc_auc']:.4f}" if t["roc_auc"] is not None else "n/a"
    return (f"| {name} | {r['feature_set']} | {r['threshold_selection']['threshold']:.4f} | "
            f"{t['precision']:.4f} | {t['recall']:.4f} | {t['f1']:.4f} | {pr} | {roc} | "
            f"{cm['tp']:,} / {cm['fp']:,} / {cm['fn']:,} / {cm['tn']:,} | "
            f"{t['false_positive_rate']:.6f} |")


def render_model_card(metrics: dict[str, Any], schema: dict[str, Any]) -> str:
    sel = metrics["selected_model"]
    sp = metrics["split"]
    ds = metrics["dataset"]
    sm = metrics["models"][sel]
    t = sm["test"]
    L = [
        "# Model Card — FraudShield AI transaction risk model (v1)",
        "",
        "## Intended use",
        "Decision support that scores a transaction's fraud risk to help prioritise HUMAN review. "
        "It must not freeze/unfreeze accounts automatically, and a high score is not evidence "
        "that an account owner is a scammer.",
        "",
        "## Data",
        f"- PaySim synthetic mobile-money simulation (NOT real customers): {ds['rows']:,} rows, "
        f"{ds['fraud_rows']:,} fraud ({ds['fraud_prevalence']:.4%}).",
        f"- Dataset SHA-256: `{ds['sha256']}`",
        f"- Chronological split on `step`: train steps ≤ {sp['train_max_step']} "
        f"({sp['train_rows']:,} rows, {sp['train_fraud']:,} fraud); validation ≤ {sp['val_max_step']} "
        f"({sp['val_rows']:,}, {sp['val_fraud']:,}); test > {sp['val_max_step']} "
        f"({sp['test_rows']:,}, {sp['test_fraud']:,}).",
        "",
        "## Selected model",
        f"- **{sel}** — {sm['description']}",
        f"- Feature set: `{schema['feature_set']}`. Inputs: {', '.join(schema['required_input_columns'])}.",
        f"- Engineered features: {', '.join(schema['engineered_model_features'])}.",
        f"- Threshold {sm['threshold_selection']['threshold']:.6f} chosen on VALIDATION data only "
        f"(strategy `{sm['threshold_selection']['strategy']}`).",
        "- Imbalance handled with class weighting / scale_pos_weight (training data only).",
        "",
        "## Excluded columns",
    ]
    L += [f"- `{c}`: {why}" for c, why in schema["excluded_columns"].items()]
    L += [
        "",
        "## Leakage and availability",
        schema["availability_note"],
        "Balance-change features must be confirmed available at prediction time before use. "
        "`newbalanceOrig`/`newbalanceDest` are written after the transaction executes; the "
        "`xgboost_with_post_balance` row below exists only to quantify how much they would inflate results.",
        "",
        "## Held-out TEST results (thresholds frozen from validation)",
        "| model | feature set | threshold | precision | recall | F1 | PR-AUC | ROC-AUC | TP / FP / FN / TN | FPR |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|---:|",
    ]
    L += [_row(n, r) for n, r in metrics["models"].items()]
    L += [
        "",
        f"Selected model at its threshold on test: precision {t['precision']:.4f}, recall {t['recall']:.4f}, "
        f"false-positive rate {t['false_positive_rate']:.6f}, test fraud prevalence {t['fraud_prevalence']:.6%}.",
        "",
        "## Trade-off",
        "Lowering the threshold catches more fraud (higher recall) but flags more legitimate "
        "transactions (more false positives, lower precision), each of which costs analyst time "
        "and can inconvenience an innocent customer. Raising it does the reverse. Because fraud is "
        "extremely rare, even a tiny false-positive rate produces many false alerts in absolute numbers.",
        "",
        "## Limitations",
        "- PaySim is simulated; fraud patterns (e.g. only TRANSFER and CASH_OUT) reflect the simulator and "
        "results may not transfer to real banking data.",
        "- Single time-ordered split; no cross-validation, calibration or drift analysis yet.",
        "- No account-history/graph features yet; raw account IDs are deliberately not used.",
        "- Not validated for fairness or production deployment.",
    ]
    return "\n".join(L) + "\n"
