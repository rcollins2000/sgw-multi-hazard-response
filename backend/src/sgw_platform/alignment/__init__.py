"""Operator-alignment (supervised preference learning) module.

Turns every Accept/Override/Defer decision into a labelled preference sample
and fits a small logistic regression on top of the base risk features. The
learned "P(operator defers | features)" acts as a bounded nudge on the base
preventative-priority score:

    adjusted_priority = base_priority − β · (2·P(defer | features) − 1)

This is deliberately NOT reinforcement learning:
    · no reward shaping — operator preference is not the same signal as
      "did the asset fail?"
    · no exploration/exploitation — real utility infrastructure cannot host
      the kind of stochastic policy exploration RL requires
    · no policy gradient — logistic regression trained offline in mini-batches
    · adjustment is bounded by β (default 0.15) so a bad retrain cannot
      make the model diverge

The pattern is preference calibration (Christiano et al. 2017 lineage). It
sits in the same family as RLHF but with orders of magnitude less data,
simpler math, and a much narrower job — a bounded corrective nudge, not a
policy replacement. See docs/13_operator_alignment.md for the full framing.

For the demo the honest framing is: "the platform learns from your decisions,
within safe bounds, and the alignment layer is inspectable in Governance."
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
