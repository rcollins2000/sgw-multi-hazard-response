"""Hazard-conditional asset risk scoring — LightGBM regressor + RF baseline.

Because the mock dataset has no real historical failure labels, we synthesise a
proxy label from features (criticality × hazard proximity × recent stress) at
training time — the label generation is deterministic, documented, and marked as
synthetic in the training report. In production this is replaced by real
historical incident/failure joins.

We regress against a continuous score rather than classifying against a binary
label so the operator UI shows a real risk spread (0..1) instead of every asset
saturating at 1.0.
"""

from __future__ import annotations

from dataclasses import dataclass

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split


FEATURE_COLUMNS = [
    "criticality_rating",
    "condition_score",
    "service_population",
    "ground_elevation_ft",
    "has_backup_power",
    "min_dist_to_flood_zone_m",
    "min_dist_to_surge_zone_m",
    "min_dist_to_wildfire_zone_m",
    "min_dist_to_heat_zone_m",
    "open_work_orders",
    "overdue_work_orders",
    "inspections_last_year",
    "avg_recent_condition",
    "days_since_last_inspection",
    "recent_high_severity_reports",
    "recent_scada_warnings",
    "within_active_alert_area",
    "within_hurricane_cone",
]


def synthesise_probabilities(features: pd.DataFrame, hazard_type: str = "hurricane") -> pd.Series:
    """Continuous synthetic risk probability in [0, 1] — replaces real historical labels.

    Higher risk when: high criticality, low condition, near hazards, overdue work,
    recent SCADA warnings, in hurricane cone. Documented as synthetic in every
    training report so operators/reviewers do not mistake it for real ground truth.
    """
    f = features.fillna(
        {
            "condition_score": 70,
            "avg_recent_condition": 70,
            "days_since_last_inspection": 180,
            "service_population": 0,
            "min_dist_to_flood_zone_m": 50_000,
            "min_dist_to_surge_zone_m": 50_000,
            "min_dist_to_wildfire_zone_m": 50_000,
            "min_dist_to_heat_zone_m": 50_000,
            "ground_elevation_ft": 20,
        }
    )

    def proximity(dist_col: str) -> pd.Series:
        return np.exp(-f[dist_col].astype(float) / 30_000.0)

    prox_flood = proximity("min_dist_to_flood_zone_m")
    prox_surge = proximity("min_dist_to_surge_zone_m")
    prox_wildfire = proximity("min_dist_to_wildfire_zone_m")

    if hazard_type == "hurricane":
        prox_score = 0.6 * prox_surge + 0.3 * prox_flood + 0.1 * prox_wildfire
    elif hazard_type == "flood":
        prox_score = 0.7 * prox_flood + 0.3 * prox_surge
    elif hazard_type == "wildfire":
        prox_score = prox_wildfire
    else:
        prox_score = 0.25 * (prox_flood + prox_surge + prox_wildfire + proximity("min_dist_to_heat_zone_m"))

    condition_factor = (100 - f["condition_score"].astype(float)) / 100
    ops_stress = (
        0.35 * (f["overdue_work_orders"].astype(float) / 3).clip(0, 1)
        + 0.25 * (f["recent_scada_warnings"].astype(float) / 10).clip(0, 1)
        + 0.20 * (f["recent_high_severity_reports"].astype(float) / 3).clip(0, 1)
        + 0.20 * (f["days_since_last_inspection"].astype(float) / 365).clip(0, 1)
    )
    cone_boost = f["within_hurricane_cone"].astype(float) * 0.15
    alert_boost = f["within_active_alert_area"].astype(float) * 0.05

    criticality_weight = (f["criticality_rating"].astype(float) / 5) * 0.4 + 0.4

    raw = criticality_weight * (0.6 * prox_score + 0.4 * condition_factor + 0.5 * ops_stress) + cone_boost + alert_boost
    rng = np.random.default_rng(seed=42)
    raw = raw + rng.normal(0, 0.05, size=len(f))
    # Sigmoid transform → smooth spread across [0, 1] centred on the median.
    prob = 1 / (1 + np.exp(-4 * (raw - raw.median())))
    return prob.clip(0.01, 0.99).astype(float)


def synthesise_labels(features: pd.DataFrame, hazard_type: str = "hurricane") -> pd.Series:
    """Binary threshold at 0.5 for fairness auditing (needs positives/negatives)."""
    return (synthesise_probabilities(features, hazard_type) > 0.5).astype(int)


@dataclass
class TrainingReport:
    model_family: str
    model_version: str
    label_source: str
    metrics: dict[str, float]
    feature_importance: dict[str, float]


class RiskScoringModel:
    """LightGBM regressor on a continuous synthesised probability + RF baseline.

    Regression gives us a real distribution of risk scores (0..1) — the classifier
    approach saturates near 1.0 on binary synthetic labels, which hides the risk
    hierarchy the operator needs to see.
    """

    def __init__(self, hazard_type: str = "hurricane") -> None:
        self.hazard_type = hazard_type
        self.model: lgb.LGBMRegressor | None = None
        self.baseline: RandomForestRegressor | None = None
        self.report: TrainingReport | None = None

    def fit(self, features: pd.DataFrame) -> TrainingReport:
        X = features[FEATURE_COLUMNS].fillna(-1).astype(float)
        y = synthesise_probabilities(features, hazard_type=self.hazard_type)

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)

        self.model = lgb.LGBMRegressor(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.05,
            random_state=42,
            verbosity=-1,
        )
        self.model.fit(X_train, y_train)

        self.baseline = RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1)
        self.baseline.fit(X_train, y_train)

        pred = self.model.predict(X_test)
        baseline_pred = self.baseline.predict(X_test)

        metrics = {
            "mae": float(mean_absolute_error(y_test, pred)),
            "r2": float(r2_score(y_test, pred)),
            "baseline_mae": float(mean_absolute_error(y_test, baseline_pred)),
            "baseline_r2": float(r2_score(y_test, baseline_pred)),
            "target_mean": float(y_train.mean()),
            "target_std": float(y_train.std()),
            "n_train": int(len(y_train)),
            "n_test": int(len(y_test)),
        }

        importances = self.model.feature_importances_.astype(float)
        importances = importances / (importances.sum() or 1.0)
        importance = dict(zip(FEATURE_COLUMNS, importances, strict=True))

        self.report = TrainingReport(
            model_family="hazard_risk",
            model_version=f"lgbm-reg-v2-{self.hazard_type}",
            label_source="synthetic_continuous_from_features_documented",
            metrics=metrics,
            feature_importance={k: float(v) for k, v in importance.items()},
        )
        return self.report

    def predict_proba(self, features: pd.DataFrame) -> pd.Series:
        if self.model is None:
            raise RuntimeError("call fit() first")
        X = features[FEATURE_COLUMNS].fillna(-1).astype(float)
        pred = self.model.predict(X).clip(0.0, 1.0)
        return pd.Series(pred, index=features.index, name=f"risk_{self.hazard_type}")
