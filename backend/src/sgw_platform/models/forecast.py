"""Prophet time-series forecasting — water levels at CO-OPS gauges.

Uses the real Charleston Harbor 8665530 observations pulled in Phase 2. Prophet's
uncertainty band (yhat_lower / yhat_upper) is the confidence signal surfaced in
the UI. The same fitted model is reused for anomaly detection (Phase 4 anomaly module).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

# Silence Prophet's noisy INFO logs from cmdstanpy
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
logging.getLogger("prophet").setLevel(logging.WARNING)


@dataclass
class ForecastResult:
    ds: list[pd.Timestamp]
    yhat: list[float]
    yhat_lower: list[float]
    yhat_upper: list[float]
    mape: float
    coverage_80: float
    train_size: int
    test_size: int


class WaterLevelForecaster:
    """Prophet forecaster for a single time-series (one sensor / one metric)."""

    def __init__(self, seasonality_mode: str = "additive") -> None:
        self.seasonality_mode = seasonality_mode
        self.model = None  # type: ignore[assignment]
        self.metrics: dict[str, float] | None = None

    def fit_and_forecast(
        self,
        history: pd.DataFrame,
        horizon_hours: int = 24,
        test_hours: int = 24,
    ) -> ForecastResult:
        """`history` has columns [`ds`, `y`]. Returns fit + forecast + eval metrics."""
        from prophet import Prophet  # lazy import — Prophet is slow to load

        if len(history) < 48:
            raise ValueError("need at least 48 hours of history for meaningful forecast")

        df = history.copy()
        df = df.dropna(subset=["y"])
        df["ds"] = pd.to_datetime(df["ds"]).dt.tz_localize(None)

        train = df.iloc[:-test_hours] if test_hours > 0 else df
        test = df.iloc[-test_hours:] if test_hours > 0 else df.iloc[0:0]

        model = Prophet(
            seasonality_mode=self.seasonality_mode,
            daily_seasonality=False,
            weekly_seasonality=False,
            yearly_seasonality=False,
            interval_width=0.80,
        )
        # Tidal signal for coastal gauges is dominated by the M2 semi-diurnal
        # cycle (~12.42 h). We approximate with 12h and 24h components.
        model.add_seasonality(name="semi_diurnal_tide", period=0.5175, fourier_order=6)
        model.add_seasonality(name="diurnal", period=1.0, fourier_order=4)
        model.fit(train)
        self.model = model

        future = model.make_future_dataframe(periods=test_hours + horizon_hours, freq="h")
        forecast = model.predict(future)

        mape = 1.0
        coverage = 0.0
        if len(test) > 0:
            # Evaluate on held-out test window
            test_fc = forecast.iloc[-(test_hours + horizon_hours):-horizon_hours] if horizon_hours > 0 else forecast.iloc[-test_hours:]
            merged = pd.merge_asof(
                test.sort_values("ds"),
                test_fc[["ds", "yhat", "yhat_lower", "yhat_upper"]].sort_values("ds"),
                on="ds",
                direction="nearest",
            )
            mape = float((abs(merged["y"] - merged["yhat"]) / abs(merged["y"]).clip(lower=0.5)).mean())
            coverage = float(((merged["y"] >= merged["yhat_lower"]) & (merged["y"] <= merged["yhat_upper"])).mean())

        self.metrics = {"mape": mape, "coverage_80": coverage}

        # Return the future horizon only
        horizon = forecast.iloc[-horizon_hours:] if horizon_hours > 0 else forecast
        return ForecastResult(
            ds=list(horizon["ds"]),
            yhat=list(horizon["yhat"].astype(float)),
            yhat_lower=list(horizon["yhat_lower"].astype(float)),
            yhat_upper=list(horizon["yhat_upper"].astype(float)),
            mape=mape,
            coverage_80=coverage,
            train_size=len(train),
            test_size=len(test),
        )
