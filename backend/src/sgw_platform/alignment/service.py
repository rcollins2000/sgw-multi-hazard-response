"""Alignment-service — reads audit_log for operator decisions, joins the
subject_id back to the STATE.features frame, and hands the resulting
(X, y) to OperatorAlignmentModel.

Retrain policy:
    · manual — POST /api/alignment/retrain (returns the fresh FitReport)
    · automatic — after every RETRAIN_EVERY_N decisions written to audit_log

Both entry points share the same code path; only the trigger differs.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from sgw_platform.alignment.model import (
    ALIGNMENT_FEATURES,
    AlignmentPrediction,
    OperatorAlignmentModel,
)
from sgw_platform.observability.logging import get_logger

log = get_logger("alignment.service")

RETRAIN_EVERY_N = 3
"""Auto-retrain after every N new decisions — small so the demo shows the
model updating within a single interactive session."""


@dataclass
class AlignmentState:
    """Public, JSON-serialisable snapshot of the alignment layer."""

    model: OperatorAlignmentModel = field(default_factory=OperatorAlignmentModel)
    n_decisions_seen: int = 0
    """Total operator decisions written since backend startup."""
    n_decisions_at_last_train: int = 0
    """Snapshot at the last successful retrain — the delta drives auto-retrain."""
    retrain_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def to_dict(self) -> dict[str, Any]:
        return {
            "beta": self.model.beta,
            "min_samples": self.model.min_samples,
            "is_fitted": self.model.is_fitted,
            "n_decisions_seen": self.n_decisions_seen,
            "n_decisions_at_last_train": self.n_decisions_at_last_train,
            "features_used": ALIGNMENT_FEATURES,
            "report": self.model.report.to_dict() if self.model.report else None,
        }


ALIGNMENT_STATE = AlignmentState()


async def _load_training_data(session: AsyncSession) -> tuple[pd.DataFrame, pd.Series] | None:
    """Read operator_* audit rows, join to STATE.features by asset_id."""
    from sgw_platform.api.state import STATE

    if STATE.features is None or STATE.features.empty:
        log.warning("alignment.no_features")
        return None

    # Pull every operator_* action ever logged. The payload JSON has
    # asset_id + action + reason. We deliberately re-read the whole
    # history each retrain — with tens/hundreds of rows this is trivial
    # and it keeps the training set consistent with what the audit page
    # shows the operator.
    result = await session.execute(
        text(
            "SELECT subject_id, action_type, payload->>'reason' AS reason "
            "FROM audit_log "
            "WHERE action_type LIKE 'operator_%' "
            "AND subject_id <> '' "
            "ORDER BY id"
        )
    )
    rows = list(result.mappings().all())
    if not rows:
        return None

    # Label: 1 = defer/override (operator disagreed), 0 = accept (operator
    # agreed). Comments are neither — treat them as accepts for now since
    # the operator didn't reject the recommendation.
    labels_by_asset: dict[str, int] = {}
    for r in rows:
        aid = r["subject_id"]
        action = r["action_type"].removeprefix("operator_")
        y = 1 if action in {"defer", "override"} else 0
        # Take the most recent decision per asset — operators can change
        # their mind and the latest signal is the load-bearing one.
        labels_by_asset[aid] = y

    # STATE.features has asset_id as a column, not the index. We snapshot
    # to an asset_id-indexed frame here to make joining cleaner.
    features_df = STATE.features.set_index("asset_id", drop=False)
    keep = [aid for aid in labels_by_asset if aid in features_df.index]
    if not keep:
        log.warning("alignment.no_join_match", n_labels=len(labels_by_asset))
        return None

    X = features_df.loc[keep, ALIGNMENT_FEATURES].copy()
    y = pd.Series([labels_by_asset[a] for a in keep], index=keep)
    return X, y


async def retrain_now(session: AsyncSession) -> dict[str, Any]:
    """Force a retrain regardless of cadence — used by POST /api/alignment/retrain
    and by tests. Returns the resulting state dict."""
    async with ALIGNMENT_STATE.retrain_lock:
        data = await _load_training_data(session)
        if data is None:
            log.info("alignment.retrain.insufficient_data")
            return ALIGNMENT_STATE.to_dict()
        X, y = data
        report = ALIGNMENT_STATE.model.fit(X, y)
        if report is None:
            log.info("alignment.retrain.fit_declined", n=len(X))
        else:
            ALIGNMENT_STATE.n_decisions_at_last_train = ALIGNMENT_STATE.n_decisions_seen
            log.info(
                "alignment.retrain.ok",
                version=report.version,
                n_samples=report.n_samples,
                n_defers=report.n_defers,
                fit_score=report.fit_score,
            )
    return ALIGNMENT_STATE.to_dict()


async def maybe_retrain(session: AsyncSession) -> None:
    """Called from the /api/decisions endpoint after every write.

    Only actually retrains when the caller has accumulated at least
    RETRAIN_EVERY_N decisions since the last successful fit. Failures are
    swallowed so a bad retrain never breaks the decide endpoint."""
    ALIGNMENT_STATE.n_decisions_seen += 1
    delta = ALIGNMENT_STATE.n_decisions_seen - ALIGNMENT_STATE.n_decisions_at_last_train
    if delta < RETRAIN_EVERY_N:
        return
    try:
        await retrain_now(session)
    except Exception as exc:  # noqa: BLE001
        log.warning("alignment.retrain.exception", error=str(exc))


def predict_adjustments(asset_ids: list[str]) -> list[AlignmentPrediction]:
    """Look up the alignment adjustment for each asset — zero-adjustment
    fallback when the model isn't fitted or the asset isn't in STATE.features."""
    from sgw_platform.api.state import STATE

    if STATE.features is None:
        return [
            AlignmentPrediction(asset_id=a, p_defer=0.0, adjustment=0.0)
            for a in asset_ids
        ]

    features_df = STATE.features.set_index("asset_id", drop=False)
    present = [a for a in asset_ids if a in features_df.index]
    missing = [a for a in asset_ids if a not in features_df.index]

    if present:
        subframe = features_df.loc[present, ALIGNMENT_FEATURES]
        preds = ALIGNMENT_STATE.model.predict_batch(subframe, present)
    else:
        preds = []
    for a in missing:
        preds.append(AlignmentPrediction(asset_id=a, p_defer=0.0, adjustment=0.0))
    # Return in the requested order so callers can zip 1:1
    by_id = {p.asset_id: p for p in preds}
    return [by_id[a] for a in asset_ids]
