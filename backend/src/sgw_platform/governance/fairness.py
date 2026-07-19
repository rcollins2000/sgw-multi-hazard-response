"""Regional / domain fairness auditing on the risk-scoring model.

Demographic-parity + equal-opportunity gaps — reuses the framework from the
user's Module 7 Adult Income work.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class FairnessMetrics:
    group_column: str
    per_group: pd.DataFrame  # columns: group, positive_rate, base_rate, tpr
    demographic_parity_gap: float  # max positive_rate - min positive_rate across groups
    equal_opportunity_gap: float  # max TPR - min TPR across groups (needs y_true)


def audit(
    features: pd.DataFrame,
    y_score: pd.Series,
    y_true: pd.Series | None = None,
    group_column: str = "region",
    threshold: float = 0.5,
) -> FairnessMetrics:
    df = features.copy()
    df["_score"] = y_score.values
    df["_pred"] = (y_score.values >= threshold).astype(int)
    if y_true is not None:
        df["_y"] = y_true.values

    rows = []
    for group, g in df.groupby(group_column):
        row: dict[str, float | str] = {
            "group": group,
            "positive_rate": float(g["_pred"].mean()),
            "base_rate": float(g["_y"].mean()) if y_true is not None else float("nan"),
            "tpr": float("nan"),
            "n": int(len(g)),
        }
        if y_true is not None:
            positives = g[g["_y"] == 1]
            if len(positives) > 0:
                row["tpr"] = float(positives["_pred"].mean())
        rows.append(row)

    per_group = pd.DataFrame(rows)
    dp_gap = float(per_group["positive_rate"].max() - per_group["positive_rate"].min())
    if y_true is not None and per_group["tpr"].notna().sum() >= 2:
        eo_gap = float(per_group["tpr"].dropna().max() - per_group["tpr"].dropna().min())
    else:
        eo_gap = float("nan")

    return FairnessMetrics(
        group_column=group_column,
        per_group=per_group,
        demographic_parity_gap=dp_gap,
        equal_opportunity_gap=eo_gap,
    )
