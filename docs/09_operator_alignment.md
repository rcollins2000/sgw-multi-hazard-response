# Operator alignment · preference calibration + corrective nudges

**Status:** Landed 2026-07-19.
**Companion:** [docs/08_scenario_agent.md](08_scenario_agent.md)
**Code:** [backend/src/sgw_platform/alignment/](../backend/src/sgw_platform/alignment/)

## The question this answers

Every AI recommendation the platform makes is advisory. The operator can Accept, Override, or Defer, and they can leave a reason. Without a feedback loop those decisions are just audit-log rows — the model never learns whether its recommendations matched the operator's judgement.

The alignment layer closes that loop.

But it does NOT do full reinforcement learning, and framing it that way to a reviewer would be misleading. This doc explains what it is, what it isn't, and why the tighter framing is deliberate.

## What it is (in one sentence)

A bounded, interpretable, per-feature adjustment on top of the base preventative-priority score, fit by logistic regression against `(asset features, was_deferred_or_overridden)` drawn from the append-only audit log.

The technical name that fits best is **preference calibration** (Christiano et al. 2017 lineage) implemented as **RLHF-lite** — the same *pattern* as ChatGPT's alignment (reward model shaped by human preferences, applied as a policy nudge), but with orders of magnitude less data, simpler math, and a much narrower job.

## Why it's NOT full reinforcement learning

Four reasons, in order of importance.

### 1. No reward signal beyond the immediate operator response

Full RL needs a *reward* — an outcome that materialises AFTER the agent acts, so the model can learn `action → world → outcome → reward`. In this domain the ground-truth reward is *"did the asset actually fail?"*, which materialises weeks or months later, often never (a preventatively-maintained asset never fails). The operator's Accept/Defer response is a **preference**, not a reward — it says "I would have chosen differently", not "your recommendation was wrong in the world".

Treating a preference as a reward is a category error. It works in RLHF-flavoured LLM training because the preference is *itself* the target ("humans prefer these outputs"); it does not work when the real target is unrelated to the preference ("was the asset failure preventable?").

### 2. No exploration/exploitation

RL requires the agent to sometimes take a suboptimal action to learn about the space. Here the agent recommends preventative maintenance on real utility infrastructure. Deliberately recommending a low-priority asset to see how the operator reacts is unacceptable — the whole point of the platform is that recommendations are safe defaults.

Without exploration, the classical RL guarantees (convergence, sample efficiency) don't apply. We would be doing "RL" in name only.

### 3. Sample regime

Modest RL setups (contextual bandits, tabular Q-learning) need on the order of thousands of interactions. Realistic operator decision volume for a utility platform is tens per operator per week. In the demo it's a handful. Fitting a policy on that data would produce noise, not learning.

Logistic regression on 8 features with tens of samples is at the safe edge of statistical honesty — enough to detect a directional signal, not enough to pretend we're doing anything sophisticated.

### 4. Regulatory + audit posture

The AECOM PRD ([docs/03_prd.md](03_prd.md)) explicitly requires that every recommendation is advisory, explainable, and audit-logged. RL policies are notoriously hard to explain (why did the agent take this action?). A bounded logistic-regression nudge is trivially inspectable — you can point at the eight learned weights on the Governance page and describe exactly what the layer would do to any future asset.

Shipping "reinforcement learning" that the operator cannot audit would break the design principles the whole platform stands on.

## What it is, precisely

The layer is three things composed:

- **A preference model** — sklearn `LogisticRegression` fit on `(asset_features, y=1 if operator deferred or overrode else 0)`. Class-balanced to keep the rare-event target from washing out.
- **A calibration signal** — `P(operator defers | features) ∈ [0, 1]`.
- **A corrective nudge** — `adjustment = -β · (2p − 1)`, bounded to `|Δ| ≤ β = 0.15`. Applied additively to the base preventative-priority score, then clamped to `[0, 1]`.

The base score is untouched. The nudge is layered on the display + ranking. If you disable the layer, priorities revert to the underlying `P(failure) × consequence` formula.

## Design principles

Each was a deliberate call — none of these are defaults.

| Principle           | Implementation                                                             | Why                                                                                                        |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Bounded**         | `\|adjustment\| ≤ β = 0.15`                                                | A bad retrain cannot make the ranking diverge. Alignment can nudge, never flip.                            |
| **Interpretable**   | LogReg + StandardScaler → coefficients directly comparable                 | Every weight visible on Governance page. Operator can point at what the model learned.                     |
| **Auditable**       | Version = SHA1 of training data                                            | Any change in training set bumps version transparently — you can trace a nudge back to the decisions.      |
| **Reversible**      | `POST /api/alignment/retrain` re-fits from scratch                         | Operator can correct a drift by adding contradicting decisions and forcing retrain.                        |
| **Composable**      | Adjustment applied on top of base score, not replacing it                  | Base risk model + alignment layer stay independent. Governance can audit each separately.                  |
| **Dormant by default** | Refuses to fit under `min_samples=8` OR fewer than 2 unique labels     | Prevents the layer from emitting noise before there's real signal. Badge shows `ALIGN · DORMANT` honestly. |
| **Small-data safe** | `class_weight="balanced"` + L2 regularisation                             | Prevents the model from collapsing to majority class or overfitting the ~10-30 sample regime.              |
| **Async retrain**   | `asyncio.Lock` around every fit                                            | Concurrent decisions don't race; the training set is always a consistent snapshot.                         |

## Data flow

```
Operator Accept/Override/Defer (with optional reason)
       │
       ▼
POST /api/decisions ──► operator_decisions + audit_log rows
       │
       ▼
maybe_retrain(session)  (called after every write)
       │
       ▼ (every N=3 decisions)
retrain_now(session)
       │
       ▼
SELECT subject_id, action_type, payload->>'reason' FROM audit_log
       │  WHERE action_type LIKE 'operator_%'
       ▼
Label per asset: latest decision (defer/override=1, accept=0)
       │
       ▼
Join to STATE.features on asset_id  →  X, y
       │
       ▼
StandardScaler + LogisticRegression.fit(class_weight='balanced')
       │
       ▼
FitReport { version, weights, intercept, fit_score }  →  ALIGNMENT_STATE
       │
       ▼
GET /api/alignment/adjustments?asset_ids=... ──► per-asset (p_defer, adjustment)
       │
       ▼
Cockpit renders `aligned ↑/↓` chip · Governance renders feature-weight bars
```

## Endpoints

| Verb | Path                                            | Purpose                                                                            |
| ---- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET  | `/api/alignment`                                | Current state — is it fitted, sample count, feature weights, version.              |
| POST | `/api/alignment/retrain`                        | Force a retrain against every `operator_*` audit row. Returns the new state.       |
| GET  | `/api/alignment/adjustments?asset_ids=a,b,c`    | Per-asset (`p_defer`, `adjustment`). Zero-adjustment when the layer is dormant.    |

## Limitations (be honest about these)

The demo does not hide these — the explain popover and Governance page both call them out.

1. **Sample-size regime.** With ~10-30 decisions we can detect a directional preference; we cannot claim statistical significance. `fit_score` is training-set accuracy, which is optimistic. Production would need cross-validation.
2. **No temporal decay.** An operator's decision from three months ago counts the same as one from this morning. Preferences shift over time; the layer currently does not.
3. **Single-operator model.** All operators contribute to the same model. If two operators have different judgement, the model averages them — not what you want in a shared-tenancy production deployment.
4. **Reason text is stored but unused for training.** The operator writes a reason (`"already inspected"`, `"cost prohibitive"`, `"seasonal"`) — the alignment model currently only reads the numerical asset features. LLM-classified reason buckets as additional categorical features are the obvious next step.
5. **Gameable by an adversarial operator.** A determined operator could shift priorities in any direction by making biased decisions. Mitigation: the layer is bounded (β=0.15), auditable (every decision is in `audit_log`), and reversible (force retrain against corrected decisions).
6. **Can amplify bias in operator judgement.** If the operator systematically defers assets in one region, the layer learns "that region gets deferred" and reinforces the bias. The fairness auditor ([docs/06_data_model.md](06_data_model.md) §fairness) is the counterweight — it evaluates the *base* model; a Phase-2 extension would evaluate the *aligned* model too.
7. **Cold-start.** The layer is dormant until ≥ 8 decisions with mixed outcomes. In a fresh deployment the operator sees `ALIGN · DORMANT` for the first few sessions. This is honest but visually less compelling.

## Human-in-the-loop touch points

The alignment layer never *replaces* the operator's judgement. Every touch point below still requires a human.

- **Accept / Override / Defer** — every decision is HITL. The layer only learns because the operator decides.
- **Reason text** — captured on Override / Defer, stored in `audit_log`, surfaced in the Audit page. The operator's reasoning is preserved for future review.
- **Force retrain button** — a person has to press it (or wait for the N-decision auto-retrain). The model does not silently update.
- **Bounded correction** — `|Δ| ≤ β` means the layer cannot flip a Critical asset to Low. The operator still sees the base score and the alignment nudge separately (`0.84 → 0.78`). If the two disagree materially, that itself is a signal for the operator to investigate.
- **Explain popover** — every alignment surface has a `?` button that opens a four-section explainer (`Model / Purpose / How to read / Confidence`). The operator can inspect exactly what the layer is doing before acting on it.
- **Governance page** — feature weights visible as diverging bars, positive (defer-increasing) in amber, negative (accept-increasing) in green. Any operator or auditor can point at what the layer has learned.

## Value to stakeholders

Framed for the AECOM reviewer + a utility operations manager.

- **The platform learns from every decision.** Not just logs them. That's the difference between a static ML model and a system that adapts to how the operator actually works.
- **It stays advisory.** The alignment nudge is bounded, layered on top of the base model, and never flips a critical recommendation to safe. The operator retains final authority — this is a co-pilot pattern, not automation.
- **It's inspectable.** Every weight is visible. If the layer learns something the operator disagrees with (e.g., systematically deprioritising a region), it shows up in the Governance panel and can be corrected with retraining.
- **It's honest about its limits.** The badge reads `ALIGN · DORMANT` when there isn't enough data. Fit-quality is exposed. The layer never pretends to be something it isn't.

## Where next (deferred)

1. **LLM reason-bucketing** — pass the free-text reason through the platform's structured-output LLM to produce categorical labels (`already_inspected`, `cost_prohibitive`, `seasonal`, `not_critical`, `other`); one-hot into the LR feature vector.
2. **Temporal decay** — exponential-decay weighting on training samples so recent decisions carry more weight.
3. **Per-operator + per-persona models** — separate LR per operator OR per persona role (NOC / Emergency / Field / Maintenance).
4. **Held-out evaluation** — track a rolling holdout set so `fit_score` is a real generalisation estimate, not a train-set optimism metric.
5. **Fairness audit for the aligned model** — extend the existing fairness auditor to score the alignment layer's regional distribution.
