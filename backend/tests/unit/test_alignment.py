"""Unit tests for the operator-alignment (supervised preference learning) module.

Covers the three invariants that keep the layer safe for production:

    1. **Dormant → zero adjustment.** Before enough decisions have been
       recorded, the model refuses to fit and `predict_batch` returns
       zero-adjustment predictions for every asset.
    2. **Fitted → bounded by β.** Once fitted, every adjustment satisfies
       `|adjustment| ≤ β`. This is the load-bearing safety property —
       operators + auditors depend on it.
    3. **Sample-gate honesty.** `fit()` refuses to run when there are too
       few samples OR only one distinct label, and returns None instead
       of silently emitting noise.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from sgw_platform.alignment.model import (
    ALIGNMENT_FEATURES,
    OperatorAlignmentModel,
)


def _make_features(n: int, seed: int = 42) -> pd.DataFrame:
    """Build a synthetic feature frame with the right column set. Values are
    drawn from a fixed RNG so tests are deterministic."""
    rng = np.random.default_rng(seed)
    data = {
        "min_dist_to_flood_zone_m": rng.uniform(0, 20_000, size=n),
        "min_dist_to_surge_zone_m": rng.uniform(0, 20_000, size=n),
        "min_dist_to_wildfire_zone_m": rng.uniform(0, 20_000, size=n),
        "condition_score": rng.uniform(1, 5, size=n),
        "avg_recent_condition": rng.uniform(1, 5, size=n),
        "criticality_rating": rng.integers(1, 5, size=n),
        "service_population": rng.integers(1_000, 100_000, size=n),
        "ground_elevation_ft": rng.uniform(0, 100, size=n),
    }
    return pd.DataFrame(data)


def _make_labels(n: int, ratio_defer: float = 0.4) -> pd.Series:
    """Deterministic label vector — first ratio_defer of the rows are defers."""
    n_defers = int(n * ratio_defer)
    return pd.Series([1] * n_defers + [0] * (n - n_defers))


# --------------------------------------------------------------------------- #
# 1. Dormant → zero adjustment
# --------------------------------------------------------------------------- #


def test_dormant_model_returns_zero_adjustment() -> None:
    model = OperatorAlignmentModel()
    assert not model.is_fitted

    features = _make_features(5)
    preds = model.predict_batch(features, ["a", "b", "c", "d", "e"])

    assert len(preds) == 5
    for p in preds:
        assert p.p_defer == 0.0
        assert p.adjustment == 0.0


# --------------------------------------------------------------------------- #
# 2. Fitted → bounded by β
# --------------------------------------------------------------------------- #


def test_fitted_adjustment_is_bounded_by_beta() -> None:
    beta = 0.15
    model = OperatorAlignmentModel(beta=beta)

    features = _make_features(30)
    labels = _make_labels(30, ratio_defer=0.5)

    report = model.fit(features, labels)
    assert report is not None
    assert model.is_fitted

    preds = model.predict_batch(features, [f"asset-{i}" for i in range(30)])
    for p in preds:
        # Load-bearing safety invariant — the operator + reviewer both depend
        # on this being true no matter what the LR coefficients look like.
        assert abs(p.adjustment) <= beta + 1e-9, (
            f"adjustment {p.adjustment} exceeded β={beta} for {p.asset_id}"
        )


def test_beta_of_zero_yields_zero_adjustments_even_when_fitted() -> None:
    """Sanity check the β cap: setting β=0 disables the nudge entirely
    without breaking the fit or the predict path."""
    model = OperatorAlignmentModel(beta=0.0)
    features = _make_features(20)
    labels = _make_labels(20)

    model.fit(features, labels)
    preds = model.predict_batch(features, [f"asset-{i}" for i in range(20)])
    assert all(p.adjustment == 0.0 for p in preds)


# --------------------------------------------------------------------------- #
# 3. Sample-gate honesty — refuse to fit when there's no signal
# --------------------------------------------------------------------------- #


def test_fit_refuses_under_min_samples() -> None:
    model = OperatorAlignmentModel(min_samples=8)
    features = _make_features(5)
    labels = _make_labels(5)

    report = model.fit(features, labels)
    assert report is None
    assert not model.is_fitted


def test_fit_refuses_with_single_label_class() -> None:
    """If every recorded decision is accept, there's nothing to learn from —
    the model must refuse rather than emit a constant prediction."""
    model = OperatorAlignmentModel()
    features = _make_features(15)
    labels = pd.Series([0] * 15)  # all accepts

    report = model.fit(features, labels)
    assert report is None
    assert not model.is_fitted


def test_fit_reports_sample_counts() -> None:
    """The FitReport surfaces sample counts + version so the Governance page
    can inspect exactly what the model was trained on."""
    model = OperatorAlignmentModel()
    features = _make_features(20)
    labels = _make_labels(20, ratio_defer=0.3)

    report = model.fit(features, labels)
    assert report is not None
    assert report.n_samples == 20
    assert report.n_defers == 6  # 30% of 20
    assert report.n_accepts == 14
    assert report.version.startswith("align-v")
    assert set(report.feature_weights.keys()) == set(ALIGNMENT_FEATURES)


# --------------------------------------------------------------------------- #
# Predict ordering — ensure results are returned in the requested order
# --------------------------------------------------------------------------- #


def test_predict_batch_preserves_input_order() -> None:
    """predict_batch must return predictions in the same order as the input
    asset_ids so callers can zip 1:1 with their own data."""
    model = OperatorAlignmentModel()
    features = _make_features(10)
    labels = _make_labels(10)
    model.fit(features, labels)

    ids = [f"asset-{i}" for i in range(10)]
    preds = model.predict_batch(features, ids)
    assert [p.asset_id for p in preds] == ids


# --------------------------------------------------------------------------- #
# Parametrised sanity checks
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("beta", [0.05, 0.15, 0.30])
def test_bound_holds_across_beta_values(beta: float) -> None:
    model = OperatorAlignmentModel(beta=beta)
    features = _make_features(25)
    labels = _make_labels(25)
    model.fit(features, labels)

    preds = model.predict_batch(features, [f"a-{i}" for i in range(25)])
    for p in preds:
        assert abs(p.adjustment) <= beta + 1e-9
