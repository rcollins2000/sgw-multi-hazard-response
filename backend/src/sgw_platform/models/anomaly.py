"""Prophet-residual anomaly detection.

Reuses the fitted Prophet forecast model. Anomaly score is the normalised residual
magnitude relative to the uncertainty band width — one model, two uses.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class AnomalyResult:
    ds: list[pd.Timestamp]
    y: list[float]
    yhat: list[float]
    residual: list[float]
    anomaly_score: list[float]
    is_anomaly: list[bool]


def detect_anomalies_from_prophet_fit(
    history: pd.DataFrame,
    model,  # Prophet
    band_multiplier: float = 1.0,
) -> AnomalyResult:
    """Return residual-based anomaly signal for the training window.

    - `history` — [`ds`, `y`] as fed to `model.fit`
    - `model` — a fitted Prophet model
    - `band_multiplier` — how many band-widths beyond yhat_upper/lower to flag
    """
    df = history.copy()
    df["ds"] = pd.to_datetime(df["ds"]).dt.tz_localize(None)
    forecast = model.predict(df[["ds"]])
    merged = df.merge(forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]], on="ds")

    band_width = (merged["yhat_upper"] - merged["yhat_lower"]).clip(lower=1e-3)
    residual = merged["y"] - merged["yhat"]
    score = (residual / band_width).abs()

    is_anomaly = (merged["y"] > (merged["yhat_upper"] + band_multiplier * band_width * 0.5)) | (
        merged["y"] < (merged["yhat_lower"] - band_multiplier * band_width * 0.5)
    )

    return AnomalyResult(
        ds=list(merged["ds"]),
        y=list(merged["y"].astype(float)),
        yhat=list(merged["yhat"].astype(float)),
        residual=list(residual.astype(float)),
        anomaly_score=list(score.astype(float)),
        is_anomaly=list(is_anomaly.astype(bool)),
    )
