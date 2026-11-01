"""Datasets an investigation can be run against. Each is a separate V2-schema ledger; they are never mixed.

* ``demo-ledger``: the ledger the rest of the API uses (data_source.py; synthetic demo ledger by default, or an
  authorized institution ledger when configured).
* ``forensic-scenarios``: the forensic scenario ledger (ml/forensics/generator.py, seed 303), built by
  scripts/build_forensic_ledger.py. Its scenario roles exist for evaluation only and are never read here.

An account ID is looked up only inside the chosen dataset. Nothing here can discover real-world accounts.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy.orm import Session, sessionmaker

try:
    from app.db.v2.session import PROJECT_ROOT, get_v2_engine
    from app.services.v2 import data_source
except ModuleNotFoundError:
    from backend.app.db.v2.session import PROJECT_ROOT, get_v2_engine
    from backend.app.services.v2 import data_source

FORENSIC_DB_FILE = PROJECT_ROOT / "data" / "v3_forensic_scenarios.db"
FORENSIC_SOURCE_KIND = data_source.SYNTHETIC_FORENSIC


@dataclass(frozen=True)
class DatasetSpec:
    dataset_id: str
    title: str
    description: str
    evaluation_labels_note: str
    # Whether the v3 models were validated on data from this dataset's generator. When not, their outputs are shown for
    # reference only and are never used as evidence, trace seeds or role support.
    models_validated: bool = False
    model_note: str = ""
    # Dataset-level distribution check (ml/forensics/distribution_shift.py -> ml/reports/distribution_shift.json; a test
    # checks these values agree with the report). None means the dataset was never checked: models are then unsupported.
    distribution_check: Optional[dict] = None

    @property
    def model_support(self) -> str:
        """Explicit support state for the models on this dataset:
        - validated_in_distribution: validated on this generator family AND its behaviour inputs match the training data;
        - unsupported_distribution_shift: the behaviour inputs differ from the training data (out of distribution);
        - unsupported_not_checked: never validated or never checked. Unsupported means reference only, never evidence."""
        dc = self.distribution_check
        if dc is None:
            return "unsupported_not_checked"
        if not all(dc[m]["in_distribution"] for m in ("transaction_model", "account_model")):
            return "unsupported_distribution_shift"
        return "validated_in_distribution" if self.models_validated else "unsupported_not_checked"


DATASETS: dict[str, DatasetSpec] = {
    "demo-ledger": DatasetSpec(
        "demo-ledger", "FraudShield demo ledger",
        "The ledger used across FraudShield: 10,000 synthetic accounts over 90 days with five planted scenarios "
        "(sample case FS-2001 lives here). Account IDs look like ACC-000001.",
        "Scenario labels exist in the file for model evaluation and are never read by an investigation.",
        models_validated=False,
        # Investigator-facing (QA-12). Sources: ml/reports/distribution_shift.json (PSI > 0.25 per input) and
        # ml/reports/data_quality_v3.json (precision on this ledger).
        model_note="Out of distribution: the v3 models were trained on data from a different synthetic generator, and this "
                   "ledger's behaviour differs clearly from that training data (9 of the transaction model's 29 behaviour inputs "
                   "and 10 of the account model's 14). On this ledger only about 1 in 100 transfers or accounts the models flagged "
                   "was part of a scenario (precision 1.1% and 1.3%). Their outputs are shown for reference only; findings rest on "
                   "the fixed rules and recorded facts.",
        distribution_check={"transaction_model": {"in_distribution": False, "behaviour_inputs_psi_over_0_25": 9, "behaviour_inputs": 29},
                            "account_model": {"in_distribution": False, "behaviour_inputs_psi_over_0_25": 10, "behaviour_inputs": 14}}),
    "forensic-scenarios": DatasetSpec(
        "forensic-scenarios", "Forensic scenario ledger",
        "A separate synthetic ledger generated with documented scenario patterns (direct scams, mule chains, splits, "
        "consolidation, loops, several victims, account takeover, legitimate look-alikes). No model was trained on it. "
        "Account IDs look like FS-1A2B3C4D.",
        "Each account's scenario role is stored for evaluation only and is never read by an investigation.",
        models_validated=True,
        model_note="Same synthetic generator family as the models' training data, but a different seed and population: no account "
                   "here was seen in training, and its behaviour matches the training data on every model input. This supports the "
                   "models only for this synthetic generator family.",
        distribution_check={"transaction_model": {"in_distribution": True, "behaviour_inputs_psi_over_0_25": 0, "behaviour_inputs": 29},
                            "account_model": {"in_distribution": True, "behaviour_inputs_psi_over_0_25": 0, "behaviour_inputs": 14}}),
}


def forensic_database_url() -> str:
    return os.environ.get("FRAUDSHIELD_FORENSIC_DATABASE_URL") or f"sqlite:///{FORENSIC_DB_FILE}"


class DatasetRegistry:
    """Opens sessions per dataset. Tests replace it through the FastAPI dependency ``get_dataset_registry``."""

    def __init__(self, forensic_url: Optional[str] = None):
        self._forensic_url = forensic_url
        self._makers: dict[str, sessionmaker] = {}

    def forensic_url(self) -> str:
        return self._forensic_url or forensic_database_url()

    def available(self, dataset_id: str) -> tuple[bool, str]:
        if dataset_id == "demo-ledger":
            return True, ""
        url = self.forensic_url()
        if url.startswith("sqlite:///") and not Path(url[len("sqlite:///"):]).exists():
            return False, ("The forensic scenario ledger has not been built on this server. "
                           "Build it with scripts/build_forensic_ledger.py.")
        return True, ""

    def open(self, dataset_id: str) -> Session:
        if dataset_id not in self._makers:
            self._makers[dataset_id] = sessionmaker(bind=get_v2_engine(self.forensic_url()), autoflush=False)
        return self._makers[dataset_id]()

    def describe(self, dataset_id: str, db: Session) -> dict:
        """Source description in the same shape as data_source.describe (raises DataSourceUnavailable)."""
        if dataset_id == "demo-ledger":
            return data_source.describe(db)
        cfg = data_source.DataSourceConfig(FORENSIC_SOURCE_KIND, "FraudShield forensic scenario ledger (generator seed 303)",
                                           self.forensic_url(), None)
        info = data_source.describe(db, cfg)
        info["is_synthetic"], info["real_bank_data"] = True, False
        info["freshness_note"] = ("Static synthetic snapshot regenerated from a fixed seed when the server is built. "
                                  "'Data as of' is the latest synthetic transaction time.")
        info["disclosure"] = "Synthetic forensic scenario data. No real customers, accounts or bank transactions are involved."
        return info


_registry = DatasetRegistry()


def get_dataset_registry() -> DatasetRegistry:
    return _registry


SessionFactory = Callable[[], Session]
