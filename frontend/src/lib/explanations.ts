/*
  Catalog of explainer copy for every AI-produced surface in the cockpit
  and drill-down. Each entry has the same four sections so the operator
  builds a consistent mental model:

    · model       — which model family produces the visible output
    · purpose     — the one operator-facing job of the surface
    · howToRead   — the interpretive rules (colours, thresholds, layout)
    · confidence  — how uncertainty is expressed and what the current value means

  These strings ARE the demo's "Explain" content. Keeping them centralised
  makes them reviewable in one PR and prevents drift between the popovers
  and the docs. Each is intentionally short (~4 sentences per section) —
  the popover is 340px wide and shouldn't scroll.
*/

export type SurfaceKey =
  | "risk_score"
  | "preventative_priority"
  | "confidence_meter"
  | "copilot_recommendation"
  | "feature_drivers"
  | "water_forecast"
  | "mini_map"
  | "watchlist"
  | "timeline_spine"
  | "live_baseline"
  | "model_provenance"
  | "feature_contributions"
  | "dependency_cascade"
  | "evidence_citations"
  | "scenario_analysis"
  | "alignment_layer";

export type ExplanationCard = Readonly<{
  title: string;
  model: string;
  purpose: string;
  howToRead: string;
  confidence: string;
  /** Short source-of-truth reference — a module or endpoint the reader can grep for. */
  provenance: string;
}>;

export const EXPLANATIONS: Record<SurfaceKey, ExplanationCard> = {
  risk_score: {
    title: "Calibrated failure probability · 72h",
    model:
      "LightGBM gradient-boosted classifier with isotonic calibration. Random Forest baseline kept for methodological comparison. See the Governance tab for training metrics.",
    purpose:
      "Estimates the probability a single asset fails in the next 72 hours, conditional on hazard type, severity, and region. It is a ranking + prioritisation signal — the platform never actuates on it directly.",
    howToRead:
      "≥ 0.75 = critical (rose), 0.50–0.75 = high (orange), 0.30–0.50 = moderate (amber), < 0.30 = low (slate). The ± band is the isotonic-calibration confidence interval — a wider band means less certainty.",
    confidence:
      "Isotonic calibration makes the score a real probability: across N assets scored 0.80, ~80% will fail on average. Brier tracks calibration; ROC-AUC tracks discrimination. Both are live on the Governance tab.",
    provenance: "models/risk.py · lgbm-cal-v1",
  },

  preventative_priority: {
    title: "Preventative priority · failure × consequence",
    model:
      "Two components: (1) the calibrated failure probability from the LightGBM risk model — verbatim, no re-scoring — and (2) a consequence weighting derived on the frontend from criticality rating (45%), service population (35%), and blast-radius cluster size (20%). Combined 55 / 45 into a single 0..1 ranking score.",
    purpose:
      "When no severe hazard is active (LIVE NWS mode with no cone), 'highest risk right now' is the wrong question — every score compresses toward baseline. The preventative priority answers the maintenance-planner question instead: which asset should we improve NEXT to buy down the most future harm?",
    howToRead:
      "Score ramp matches the risk badge: ≥ 0.75 critical, 0.50–0.75 high, 0.30–0.50 moderate. The drivers list beneath the hero shows how much of the priority came from failure probability vs each consequence factor — the bars sum to the priority.",
    confidence:
      "Probability inherits the calibration of the underlying risk model (Brier + reliability diagrams on the Governance tab). Consequence is a policy weighting — the 45 / 35 / 20 split is a starting weight; production would tune it against SGW's actual maintenance-outcome data.",
    provenance: "lib/priority.ts · computePreventativeScore()",
  },

  confidence_meter: {
    title: "Confidence meter",
    model:
      "Discrete visualisation of two derived signals: (a) how far the calibrated probability sits from 0.5 — 'prediction strength' — and (b) how tight the calibration CI is around it.",
    purpose:
      "Communicates the CLASS of confidence at a glance — very low / low / medium / high / very high — so the operator doesn't have to read the numeric CI to judge whether to trust the score.",
    howToRead:
      "5 lit = model is confident (strong probability, tight band). 0 = essentially at chance. Never accept a critical asset with confidence < 3 without asking the copilot to elaborate or checking evidence.",
    confidence:
      "The meter IS the confidence signal — it's a display of uncertainty, not the source of it. For a numeric value, read the ± band next to the score.",
    provenance: "components/ConfidenceMeter.tsx · meterLevelFromProbability()",
  },

  copilot_recommendation: {
    title: "Copilot recommendation",
    model:
      "Ollama Cloud gpt-oss:120b with schema-validated Pydantic structured output. The LLM never produces risk scores, forecasts, or optimisation plans — it narrates over structured retrieval and cites evidence.",
    purpose:
      "Distills the ranked evidence + model outputs into an imperative recommendation the operator can Accept, Override, or Defer. Every recommendation is advisory — a human-in-the-loop must act on it.",
    howToRead:
      "The amber left border marks LLM territory. Evidence chips beneath the sentence link to the source records the LLM cited. If a citation doesn't resolve to a real record it's a hallucination — report it.",
    confidence:
      "The LLM does NOT attach a confidence to its own output — the surrounding calibrated score + confidence meter are the right signals. If the LLM's recommendation ever conflicts with the score, trust the score.",
    provenance: "explain/schemas.py · explain/retrieval.py",
  },

  feature_drivers: {
    title: "\"Why it's #1 today\" drivers",
    model:
      "Not SHAP. Global feature importances from the trained LightGBM model, multiplied by the asset's own feature values (normalised for direction). An interpretable proxy for signed contribution.",
    purpose:
      "Answers the follow-up 'why this asset?' by naming the three or four features pushing risk up hardest right now. Feature importances come from the model; magnitudes come from the asset.",
    howToRead:
      "Bar length = magnitude of contribution to risk. Colour = severity band (rose = critical driver, orange = high, amber = moderate). Green would appear only if a feature were protective.",
    confidence:
      "Ordering is stable — feature importance is a fixed property of the trained model. Per-asset magnitudes update as feature values refresh. For exact per-asset attribution, run the SHAP pipeline on the Governance tab.",
    provenance: "lib/asset.ts · buildDrivers",
  },

  water_forecast: {
    title: "Water-level forecast · Charleston Harbor 8665530",
    model:
      "Meta Prophet with weather features as exogenous regressors + semi-diurnal (M2) tidal seasonality. The 80% forecast band is Prophet's uncertainty interval. Anomalies = residuals outside the band.",
    purpose:
      "Two AI capabilities in one chart: forecasting the next 24 h of water level, and Prophet-residual anomaly detection on live observations. Drives the SCADA-side risk uplift for coastal assets.",
    howToRead:
      "Cyan = observed. Dashed grey = forecast. Grey band = 80% interval. Amber circles = residual anomalies. Observed consistently above the band = the storm is arriving faster than forecast — expect risk uplift.",
    confidence:
      "Debby-window validation: MAPE 0.18, band coverage 0.58 vs 0.80 nominal (Prophet's uncertainty tends conservative). Observations poll every 6 min from NOS CO-OPS; Prophet re-fits per request.",
    provenance: "models/forecast.py · adapters/coops.py · polling.py",
  },

  mini_map: {
    title: "Map — cone + risk-scaled asset dots",
    model:
      "Vector rendering of the NHC forecast cone + best-track + asset dots sized by calibrated risk. Colour ramp matches the risk badge across the app. In LIVE mode the cone + track are hidden (no active storm).",
    purpose:
      "Situational context in a single glance — where the storm is, where our high-risk assets sit relative to it, and how spatial they are.",
    howToRead:
      "Amber shaded polygon = NHC forecast cone. Amber line = best-track. Dots = assets, size ∝ risk. EXPAND ↗ opens the full react-leaflet map with tile layers + hazard zones + interactive drill-down.",
    confidence:
      "Cone geometry is per-advisory from the NHC feed (currently a curated Debby overlay; NHC GIS adapter is the planned live source, listed on the Data Sources popover). Risk-score currency matches the /api/assets poll cadence.",
    provenance: "pages/CockpitPage.tsx · MiniMap",
  },

  watchlist: {
    title: "Watchlist · ranked by risk",
    model:
      "Same calibrated LightGBM scores as the hero. Sorted descending. Renders ranks 2..N alongside the currently-focused priority-decision asset.",
    purpose:
      "Context for the priority-decision surface: what's next if the operator defers or overrides the current #1? Click a row to refocus the cockpit on that asset.",
    howToRead:
      "The bar + score match the risk-badge ramp app-wide. Region is shown in mono so a scan for coastal-vs-inland is fast. Rank number is the asset's global position in the sorted list.",
    confidence:
      "Identical to the hero score — this is a projection of the same model output, not a separate model. Confidence for any row equals the confidence meter you'd see if you focused it.",
    provenance: "pages/CockpitPage.tsx · Rail",
  },

  timeline_spine: {
    title: "Operational timeline",
    model:
      "Composite: NHC advisory ticks + model firing timestamps (e.g. 'Tide↑band' = when Prophet residuals first crossed the 80% band) + operational deadlines + forecast peaks. In DEBBY 2024 REPLAY it anchors on landfall; in LIVE NWS mode it anchors on 'now' and shows recent alerts + upcoming maintenance windows.",
    purpose:
      "Anchors every AI capability in time. Answers: when did the model fire? When must the operator decide? When will the physical event peak (or when is the next maintenance window)?",
    howToRead:
      "Amber playhead = Now. In storm mode a red vertical marks Landfall and amber shading is the elapsed response window. In live mode the shading is disabled and the spine reads as a rolling operational window (past 7 days ← now → next 30 days).",
    confidence:
      "Past events (before Now) are timestamped facts and have full confidence. Future events inherit the underlying forecast's uncertainty (storm surge peak in replay; scheduled-maintenance drift in live).",
    provenance: "components/TimelineSpine.tsx",
  },

  live_baseline: {
    title: "Baseline operational picture",
    model:
      "Not a model — an operational-state summary of the currently-polling NWS + CO-OPS feeds plus the preventative-priority ranking of assets by failure probability × consequence.",
    purpose:
      "Replaces the storm-response 'T-minus to landfall' framing when there is no severe hazard active. Answers: 'nothing is on fire, so what should we improve next?' — the maintenance-planner question.",
    howToRead:
      "Left of the spine: recent NWS alert ticks + model-firing timestamps from the last 7 days. Right of the spine: upcoming scheduled maintenance windows + model-retrain dates. Amber playhead = Now.",
    confidence:
      "Live-mode confidence is inherited from the source feeds — the NWS + CO-OPS pollers report their own freshness in the Data Sources popover.",
    provenance: "pages/CockpitPage.tsx · LiveBaseline",
  },

  model_provenance: {
    title: "Model provenance",
    model:
      "Registry of the model artefact + evaluation metrics that produced this asset's score, plus the graph-model modularity for the Louvain clustering that determined its blast-radius cluster.",
    purpose:
      "Traceability. Every recommendation should be attributable to a specific model version, feature set, and evaluation-metric set. Required for model-risk review.",
    howToRead:
      "ROC-AUC = discrimination (0.5 random, 1.0 perfect). Brier = calibration quality (lower better). Cluster is the Louvain blast-radius group — assets in the same cluster tend to fail together.",
    confidence:
      "The version string is the source-of-truth for regenerating this exact result. Every audit-log row also carries this version so decisions are always attributable.",
    provenance: "governance/model_versions · audit_log.model_version",
  },

  feature_contributions: {
    title: "Feature contributions to risk",
    model:
      "Signed by feature-value direction × global feature importance. NOT SHAP — computing per-asset SHAP requires running the model with a background dataset, deferred to the Governance page.",
    purpose:
      "Attributes the score to interpretable inputs so the operator can sanity-check: does this ranking match my domain intuition? Ordering is stable across assets; magnitude is asset-specific.",
    howToRead:
      "Right of centre = pushes risk up (colour by magnitude). Left of centre = protective. Feature values shown in mono on the left; magnitude on the right. Log-odds units.",
    confidence:
      "Attribution is directionally correct but not exact. For regulatory review, run explain/shap.py (on the Governance page) to get true per-asset SHAP values with a background sample.",
    provenance: "components/AssetDrilldown.tsx · FeatureRow",
  },

  dependency_cascade: {
    title: "Cascading dependency chain",
    model:
      "networkx BFS traversal over the declarative asset_dependencies graph, plus Louvain community detection which assigns a blast-radius cluster ID to each asset (modularity ~0.90 on the SGW graph).",
    purpose:
      "Names the downstream consequences of this asset failing — the difference between 'a substation is at risk' and 'a substation whose failure would knock a hospital offline is at risk'.",
    howToRead:
      "Left-to-right is upstream → downstream. The self node is bordered in rose; critical endpoints (hospitals, water plants) in dark red. Cluster ID (◆) groups assets that would fail together.",
    confidence:
      "Graph traversal is deterministic — 100% confidence in the chain given the edges. Underlying dependency edges are declarative and require data-steward validation.",
    provenance: "graph/dependency.py · graph/blast_radius.py",
  },

  evidence_citations: {
    title: "Cited source records",
    model:
      "Structured retrieval — the LLM copilot is only allowed to cite IDs from this list. Grounding constraint enforced by explain/retrieval.py; a hallucinated ID would fail the schema validator.",
    purpose:
      "Grounds the LLM. Every claim in the copilot recommendation traces back to a source record — alert, work order, sensor reading, or field report — that the operator can open and verify.",
    howToRead:
      "Grouped by kind (alerts / work_orders / sensor_readings / field_reports). Click a chip to open the source record. Empty groups just mean no evidence of that kind is available for this asset.",
    confidence:
      "Evidence is the source-of-truth. 100% confidence in the citations themselves; the LLM narrative that uses them is advisory (see the Copilot recommendation explainer).",
    provenance: "explain/retrieval.py",
  },

  scenario_analysis: {
    title: "Scenario analysis · agent run",
    model:
      "Multi-model composition: (1) the LLM (gpt-oss:120b) parses the operator's directive into a typed ScenarioSpec, (2) the same trained LightGBM risk model runs against a mutated feature frame, (3) networkx BFS supplies cascade depths, (4) the LLM narrates the ranked impacts + drafts a recommendation citing evidence IDs.",
    purpose:
      "Answers 'what would happen if X?' with the same models that produce the live picture. Lets the operator stress-test resilience against a hypothetical hurricane, replay a historic event against today's asset registry, or find the worst single-asset cascade under baseline conditions.",
    howToRead:
      "Ranked impacts show baseline vs scenario score + delta. The recommendation is one imperative sentence the operator can Accept / Override / Comment on. The scenario_id is the audit-log key — every run is traceable.",
    confidence:
      "The risk model's calibration carries over; the scenario is a controlled perturbation of the model's inputs, not a re-training. Feature perturbations (surge_lift_pct, within_cone_ratio) are documented in the ScenarioSpec and reproducible.",
    provenance: "scenarios/runner.py · parser.py · report.py",
  },

  alignment_layer: {
    title: "Operator alignment · preference learning",
    model:
      "Small sklearn LogisticRegression fitted on (asset features, was_deferred_or_overridden) drawn from the audit log. StandardScaler-normalised so the coefficients are directly comparable, class-balanced so rare defer events aren't washed out. Deliberately NOT full reinforcement learning — this is a bounded corrective nudge, not policy optimisation.",
    purpose:
      "Learns from every Accept / Defer / Override the operator makes. When the same feature pattern keeps getting deferred, the layer lowers priority on similar assets in future ranking rounds; when it keeps getting accepted, it boosts slightly. This closes the loop between the operator's judgement and the ranking model.",
    howToRead:
      "The badge shows ALIGN · version + sample count once ≥ 8 decisions have been recorded. The retrain button (↻) forces a fresh fit against the full audit history. Per-decision adjustment is capped at ±β (0.15) — the base priority never moves more than 15pp because of the alignment layer alone.",
    confidence:
      "Bounded by design: |adjustment| ≤ β. Fit-quality (train-set accuracy) is exposed on the Governance page; with tens of samples this is directionally useful but not a true CV metric. If the operator wants to invalidate the layer, POST /api/alignment/retrain with corrective decisions.",
    provenance: "sgw_platform/alignment/model.py · service.py",
  },
};
