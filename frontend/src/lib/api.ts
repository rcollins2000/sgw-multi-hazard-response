const API = "/api";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export type AssetSummary = {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  utility_domain: string;
  region: string;
  latitude: number;
  longitude: number;
  criticality_rating: number;
  service_population: number | null;
  risk_score: number;
  risk_level: "low" | "moderate" | "high" | "critical";
  blast_radius_cluster: number | null;
  within_hurricane_cone: boolean;
  // Operator-alignment layer nudge (see docs/09_operator_alignment.md).
  // alignment_adjustment is zero when the layer is dormant.
  alignment_p_defer: number;
  alignment_adjustment: number;
  aligned_score: number;
};

export type CrosswalkEntry = { sys: string; id: string };

export type AssetDetail = AssetSummary & {
  condition_score: number | null;
  flood_zone: string | null;
  ground_elevation_ft: number | null;
  backup_power: string | null;
  features: Record<string, unknown>;
  cascade: { downstream: string; depth: number; consequence: string }[];
  evidence: Record<string, string[]>;
  crosswalk: CrosswalkEntry[];
};

export type Explanation = {
  asset_id: string;
  risk_level: string;
  recommended_action: string;
  reasoning_summary: string[];
  uncertainties: string[];
  evidence: string[];
  human_approval_required: boolean;
};

export type Alert = {
  alert_id: string;
  hazard_type: string;
  severity: string;
  urgency: string;
  issued_at: string;
  expires_at: string;
  headline: string;
};

export type AuditEntry = {
  id: number;
  timestamp: string;
  user: string;
  action_type: string;
  subject_id: string;
  current_hash: string;
};

export type FairnessReport = {
  group_column: string;
  demographic_parity_gap: number;
  equal_opportunity_gap: number;
  per_group: {
    group: string;
    positive_rate: number;
    base_rate: number;
    tpr: number;
    n: number;
  }[];
};

export type ModelGovernance = {
  risk_model: { version: string; metrics: Record<string, number>; top_features: Record<string, number> };
  graph: { n_nodes?: number; n_edges?: number; n_clusters?: number; modularity?: number };
};

export type Briefing = {
  briefing: {
    headline: string;
    situation_summary: string;
    top_risks: string[];
    recorded_actions: string[];
    recommended_actions: string[];
    outlook: string;
  };
  snapshot: {
    critical_assets: number;
    high_assets: number;
    population_at_risk: number;
    active_alerts: number;
    hazard_types: string[];
  };
  audit: { current_hash: string };
};

export type StatusResponse = {
  ready: boolean;
  error: string | null;
  training_report: {
    risk?: { model_version: string; metrics: Record<string, number>; top_features: Record<string, number> };
    graph?: { n_nodes: number; n_edges: number; n_clusters: number; modularity: number };
  };
  llm: {
    provider: "openai" | "ollama";
    model: string;
    /** Short display string — the actual model name, no chrome. */
    label: string;
  };
};

// ------------------------------ scenario agent ------------------------------

export type ScenarioKind = "replay" | "synthesised" | "worst_case_cascade";

export type ScenarioSpec = {
  kind: ScenarioKind;
  label: string;
  hazard_type?: string | null;
  severity?: string | null;
  region_focus?: string | null;
  horizon_days?: number | null;
  reference_event?: string | null;
  surge_lift_pct?: number | null;
  within_cone_ratio?: number | null;
  notes?: string | null;
  /**
   * LLM-picked (or preset-attached) map path template key. Fixed enum defined
   * server-side; the frontend uses it to select which storm cone/track to
   * render on the ScenariosPage map.
   */
  path_template_hint?: string | null;
};

export type ScenarioImpact = {
  asset_id: string;
  asset_name: string;
  region: string;
  utility_domain: string;
  baseline_score: number;
  scenario_score: number;
  delta: number;
  consequence: number;
  ranked_priority: number;
  cascade_depth: number;
  cluster: number | null;
};

export type ScenarioReport = {
  scenario_id: string;
  spec: ScenarioSpec;
  generated_at: string;
  ranked_impacts: ScenarioImpact[];
  total_assets_impacted: number;
  summary: string;
  recommendation: string;
  evidence: string[];
  audit_hash: string;
};

export type PresetKey =
  | "replay_idalia"
  | "replay_debby"
  | "cat3_charleston_30d"
  | "worst_case_cascade";

export type ScenarioPresets = { presets: Record<PresetKey, ScenarioSpec> };

export type WaterLevelForecast = {
  source: string;
  /** Optional: the caller's requested source (before fallback resolution). */
  requested_source?: string;
  /** True when the resolved source is the live poller buffer (NOS_COOPS:live_*). */
  is_live?: boolean;
  history_points: number;
  history_tail: { ds: string; y: number }[];
  forecast: { ds: string; yhat: number; yhat_lower: number; yhat_upper: number }[];
};

export const api = {
  status: () => j<StatusResponse>(`${API}/status`),
  assets: (opts: { limit?: number; region?: string; minRisk?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.region) params.set("region", opts.region);
    if (opts.minRisk !== undefined) params.set("min_risk", String(opts.minRisk));
    return j<AssetSummary[]>(`${API}/assets?${params}`);
  },
  asset: (id: string) => j<AssetDetail>(`${API}/assets/${id}`),
  explanation: (id: string) =>
    j<{ explanation: Explanation; audit: { current_hash: string } }>(`${API}/assets/${id}/explanation`),
  hazardZones: () =>
    j<{ type: string; features: { properties: Record<string, unknown>; geometry: unknown }[] }>(
      `${API}/hazard-zones`,
    ),
  hurricaneTracks: () =>
    j<{ type: string; features: { properties: Record<string, unknown>; geometry: unknown }[] }>(
      `${API}/hurricane-tracks`,
    ),
  alerts: () => j<Alert[]>(`${API}/alerts`),
  waterLevelForecast: (source = "NOS_COOPS:debby_2024", horizonHours = 24) =>
    j<WaterLevelForecast>(`${API}/forecasts/water-level?source=${source}&horizon_hours=${horizonHours}`),
  audit: (limit = 25) => j<AuditEntry[]>(`${API}/audit?limit=${limit}`),
  auditVerify: () =>
    j<{ ok: boolean; rows_checked: number; first_bad_row_id: number | null; algo: string }>(
      `${API}/audit/verify`,
    ),
  fairness: () => j<FairnessReport>(`${API}/governance/fairness`),
  modelGovernance: () => j<ModelGovernance>(`${API}/governance/model`),
  generateBriefing: () =>
    j<Briefing>(`${API}/briefing/generate`, { method: "POST", headers: { "Content-Type": "application/json" } }),
  sendBriefing: (body: { briefing_hash: string; edited_summary: string; user?: string }) =>
    j<{ ok: boolean; audit_hash: string }>(`${API}/briefing/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: "operator", distribution: "leadership", ...body }),
    }),
  decide: (body: {
    asset_id: string;
    action: string;
    reason?: string;
    user?: string;
    // Decision-time context — captured server-side so the audit log records
    // what was on screen, not what the model would compute now.
    base_score?: number;
    aligned_score?: number;
    alignment_adjustment?: number;
  }) =>
    j<{ ok: boolean; audit_hash: string }>(`${API}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: "operator", ...body }),
    }),
  scenarioPresets: () => j<ScenarioPresets>(`${API}/scenarios/presets`),
  runScenario: (body: { directive?: string; preset?: PresetKey; user?: string }) =>
    j<ScenarioReport>(`${API}/scenarios/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: "operator", ...body }),
    }),
  scenarioDecide: (
    scenarioId: string,
    body: { action: string; reason?: string; user?: string },
  ) =>
    j<{ ok: boolean; audit_hash: string }>(
      `${API}/scenarios/${encodeURIComponent(scenarioId)}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: "operator", ...body }),
      },
    ),
};

// ------------------------------ persona (frontend-only) ------------------------------

export type PersonaKey = "noc" | "emergency" | "field" | "maintenance";

export const PERSONAS: {
  key: PersonaKey;
  name: string;
  abbr: string;
  user: string;
  defaultPage: "dashboard" | "governance" | "audit" | "briefing";
  focus: string;
}[] = [
  { key: "noc", name: "NOC Operations Controller", abbr: "NOC", user: "j.okafor", defaultPage: "dashboard", focus: "Live map + all at-risk assets" },
  { key: "emergency", name: "Emergency Response Coordinator", abbr: "EMG", user: "s.hale", defaultPage: "briefing", focus: "Cross-region briefing + cascading impact" },
  { key: "field", name: "Field Operations Supervisor", abbr: "FLD", user: "m.reyes", defaultPage: "dashboard", focus: "Assets requiring dispatch (in-cone or high SCADA warnings)" },
  { key: "maintenance", name: "Maintenance Planner", abbr: "MTN", user: "d.chen", defaultPage: "dashboard", focus: "Assets with overdue work orders" },
];

// ------------------------------ data sources + agent ------------------------------

export type PollerFreshness = {
  cadence_seconds: number;
  last_success: string | null;
  last_error: string | null;
  cycle_count: number;
  last_row_count: number;
};

export type DataSource = {
  id: string;
  label: string;
  kind: "live" | "archived" | "synthetic" | "trained" | "static_ref" | "planned";
  provider: string;
  detail: string;
  /** Only present when `kind === "live"` — human-readable cadence string. */
  cadence?: string;
  /** Only present when `kind === "live"` — last-poll telemetry. */
  freshness?: PollerFreshness;
};

export type DataSourcesResponse = { generated_at: string; sources: DataSource[] };

export const dataSourcesApi = () => j<DataSourcesResponse>(`${API}/data-sources`);

// ------------------------------ operator alignment ------------------------------
//
// Preference-learning loop: each Accept / Override / Defer is a labelled
// sample. A small logistic regression predicts P(operator would defer | asset
// features) and its output nudges the base preventative-priority score.
//
// The alignment layer is a nudge, not a replacement. Adjustment magnitude is
// bounded by β (0.15) so a bad retrain cannot make the model diverge.

export type AlignmentReport = {
  version: string;
  n_samples: number;
  n_defers: number;
  n_accepts: number;
  trained_at: string;
  feature_weights: Record<string, number>;
  intercept: number;
  fit_score: number;
};

export type AlignmentState = {
  beta: number;
  min_samples: number;
  is_fitted: boolean;
  n_decisions_seen: number;
  n_decisions_at_last_train: number;
  features_used: string[];
  report: AlignmentReport | null;
};

export type AlignmentAdjustment = {
  asset_id: string;
  p_defer: number;
  adjustment: number;
};

// ------------------------------ crew planning (real OR-Tools VRP) ------------

export type CrewPlanCrew = {
  crew_id: string;
  crew_name: string;
  capability: string;
  base_region: string;
  latitude: number;
  longitude: number;
};

export type CrewPlanJob = {
  asset_id: string;
  asset_name: string;
  latitude: number;
  longitude: number;
  aligned_score: number;
  risk_score: number;
};

export type CrewPlanSolver = {
  family: string;
  total_weighted_distance_m: number;
  baseline_greedy_distance_m: number;
  improvement_pct: number;
  depot: { latitude: number; longitude: number };
};

export type CrewPlan = {
  crews: CrewPlanCrew[];
  jobs: CrewPlanJob[];
  tours: Record<string, string[]>;
  solver: CrewPlanSolver | null;
};

export const crewApi = {
  plan: (topN = 15) => j<CrewPlan>(`${API}/crew/plan?top_n=${topN}`),
};

export const alignmentApi = {
  state: () => j<AlignmentState>(`${API}/alignment`),
  retrain: () => j<AlignmentState>(`${API}/alignment/retrain`, { method: "POST" }),
  adjustments: (assetIds: string[]) =>
    j<{ adjustments: AlignmentAdjustment[] }>(
      `${API}/alignment/adjustments?asset_ids=${encodeURIComponent(assetIds.join(","))}`,
    ),
};

export type AgentEvent =
  | { type: "token"; data: string }
  | { type: "tool_call"; data: { name: string; arguments: Record<string, unknown> } }
  | { type: "tool_result"; data: { name: string; result: unknown } }
  | { type: "final"; data: { content: string } }
  | { type: "error"; data: { message: string } };

export async function streamAgent(
  body: { messages: { role: string; content: string }[]; asset_id?: string | null },
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const res = await fetch(`${API}/agent/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`agent/chat → ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith("data:")) continue;
      const payload = chunk.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        onEvent(JSON.parse(payload) as AgentEvent);
      } catch {
        /* skip malformed */
      }
    }
  }
}
