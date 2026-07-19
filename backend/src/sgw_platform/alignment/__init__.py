"""Operator-alignment (preference-learning / RLHF-lite) module.

Turns every Accept/Override/Defer decision into a labelled preference sample
and fits a small logistic-regression on top of the base risk features. The
learned "P(operator defers | features)" acts as a nudge on the base
preventative-priority score:

    adjusted_priority = base_priority − β · P(defer | features)

This is deliberately NOT full reinforcement learning:
    · no reward shaping, no exploration/exploitation trade-off
    · no policy gradient — logistic regression trained offline in mini-batches
    · adjustment is bounded by β (default 0.15) so a bad alignment run
      cannot make the model diverge

For the demo the framing is honest: "the platform learns from your decisions,
within safe bounds, and the alignment layer is inspectable in Governance".
"""

from sgw_platform.alignment.model import AlignmentPrediction, OperatorAlignmentModel
from sgw_platform.alignment.service import (
    AlignmentState,
    ALIGNMENT_STATE,
    maybe_retrain,
    predict_adjustments,
    retrain_now,
)

__all__ = [
    "AlignmentPrediction",
    "AlignmentState",
    "ALIGNMENT_STATE",
    "OperatorAlignmentModel",
    "maybe_retrain",
    "predict_adjustments",
    "retrain_now",
]
