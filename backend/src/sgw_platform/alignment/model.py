"""Operator-alignment model — the ML core of the preference-learning loop.

Trains a logistic regression on top of asset features with the target being
"operator later deferred or overrode a recommendation for this asset". The
learned probability is used as a corrective nudge on the base priority score.

Deliberately small + interpretable:
    · sklearn LogisticRegression with L2 regularisation
    · StandardScaler pre-normalises features so the coefficients are
      directly comparable → feeds the Governance UI's feature-weights table
    · balanced class weights (defer events are rare relative to accepts,
      so we upweight defers to keep the model from collapsing to "always 0")

Small-data safety valve: training refuses to fit on fewer than 8 rows OR
fewer than 2 unique labels — insufficient signal is honestly reported and
the alignment layer stays dormant rather than emitting noise.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler


# The subset of asset features the alignment model conditions on. Kept
# explicit (not `df.columns`) so the model can't accidentally start using
# an ID column or a leaked target.
ALIGNMENT_FEATURES: list[str] = [
    "min_dist_to_flood_zone_m",
    "min_dist_to_surge_zone_m",
    "min_dist_to_wildfire_zone_m",
    "condition_score",
    "avg_recent_condition",
    "criticality_rating",
    "service_population",
    "ground_elevation_ft",
]


@dataclass
class AlignmentPrediction:
    """Per-asset alignment output."""

    asset_id: str
    p_defer: float
    """P(operator would defer/override) — in [0, 1]."""
    adjustment: float
    """Signed nudge applied to the base priority score, on [−β, +β].
    Positive → operator has been accepting similar assets → boost priority.
    Negative → operator has been rejecting similar assets → lower priority.
    Formula: -β · (2p − 1)."""


@dataclass
class FitReport:
    """Snapshot of a training run — surfaced in the Governance page."""

    version: str
    n_samples: int
    n_defers: int
    n_accepts: int
    trained_at: datetime
    feature_weights: dict[str, float]
    intercept: float
    # Simple holdout accuracy on the training data — with N in the tens we
    # can't do a real cross-validation, but the fit-quality signal is still
    # useful to expose.
    fit_score: float

    def top_weights(self, k: int = 5) -> list[tuple[str, float]]:
        return sorted(
            self.feature_weights.items(), key=lambda kv: abs(kv[1]), reverse=True
        )[:k]

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "n_samples": self.n_samples,
            "n_defers": self.n_defers,
            "n_accepts": self.n_accepts,
            "trained_at": self.trained_at.isoformat(),
            "feature_weights": self.feature_weights,
            "intercept": self.intercept,
            "fit_score": self.fit_score,
        }


@dataclass
class OperatorAlignmentModel:
    """Wraps a fitted LogisticRegression + its StandardScaler."""

    beta: float = 0.15
    """Maximum magnitude of the nudge — |adjustment| ≤ β."""

    min_samples: int = 8

    _model: LogisticRegression | None = field(default=None, init=False)
    _scaler: StandardScaler | None = field(default=None, init=False)
    report: FitReport | None = field(default=None, init=False)

    @property
    def is_fitted(self) -> bool:
        return self._model is not None

    def fit(self, features: pd.DataFrame, labels: pd.Series) -> FitReport | None:
        """Train on `(features, labels)`. Returns None + logs a soft warning
        when data is insufficient — the caller is expected to keep the model
        dormant in that case."""
        if len(features) < self.min_samples:
            return None
        if labels.nunique() < 2:
            return None

        X = features[ALIGNMENT_FEATURES].to_numpy(dtype=float)
        y = labels.to_numpy(dtype=int)

        # Simple mean-imputation for any NaNs — the training set is small
        # enough that a heavy imputer is unnecessary; we just want the
        # model to fit without crashing.
        col_means = np.nanmean(X, axis=0)
        idx = np.where(np.isnan(X))
        X[idx] = np.take(col_means, idx[1])

        scaler = StandardScaler().fit(X)
        Xs = scaler.transform(X)

        model = LogisticRegression(
            C=1.0, penalty="l2", class_weight="balanced", max_iter=200
        )
        model.fit(Xs, y)

        # Score on training data as a lightweight signal — with tens of
        # samples this is optimistic but still useful directionally.
        fit_score = float(model.score(Xs, y))

        weights = dict(zip(ALIGNMENT_FEATURES, model.coef_[0].tolist(), strict=True))
        intercept = float(model.intercept_[0])

        # Version = SHA1 of a stable serialisation of the training data —
        # any change in inputs bumps the version transparently.
        h = hashlib.sha1()
        h.update(features[ALIGNMENT_FEATURES].round(4).to_csv(index=False).encode())
        h.update(labels.to_csv(index=False).encode())
        version = "align-v" + h.hexdigest()[:8]

        report = FitReport(
            version=version,
            n_samples=int(len(features)),
            n_defers=int((y == 1).sum()),
            n_accepts=int((y == 0).sum()),
            trained_at=datetime.now(UTC),
            feature_weights=weights,
            intercept=intercept,
            fit_score=fit_score,
        )

        self._model = model
        self._scaler = scaler
        self.report = report
        return report

    def predict_batch(
        self, features: pd.DataFrame, asset_ids: pd.Series | list[str]
    ) -> list[AlignmentPrediction]:
        """Return the alignment adjustment for a batch of assets. Falls
        back to zero-adjustment when the model isn't fitted."""
        ids = list(asset_ids)
        if not self.is_fitted or self._scaler is None or self._model is None:
            return [AlignmentPrediction(asset_id=a, p_defer=0.0, adjustment=0.0) for a in ids]

        X = features[ALIGNMENT_FEATURES].to_numpy(dtype=float)
        col_means = np.nanmean(X, axis=0)
        idx = np.where(np.isnan(X))
        X[idx] = np.take(col_means, idx[1])
        Xs = self._scaler.transform(X)

        proba = self._model.predict_proba(Xs)[:, 1]
        # Signed nudge — proba above 0.5 pulls priority DOWN (the operator
        # has been rejecting similar assets). We scale linearly by β so the
        # magnitude never exceeds β.
        adjustments = -self.beta * (2.0 * proba - 1.0)
        return [
            AlignmentPrediction(asset_id=a, p_defer=float(p), adjustment=float(adj))
            for a, p, adj in zip(ids, proba, adjustments, strict=True)
        ]
