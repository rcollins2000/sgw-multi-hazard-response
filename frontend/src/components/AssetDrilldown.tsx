import { useEffect, useState } from "react";
import {
  api,
  PERSONAS,
  type AssetDetail,
  type Explanation,
  type ModelGovernance,
  type PersonaKey,
  type WaterLevelForecast,
} from "../lib/api";
import { prettyAssetType, prettyRegion, riskColor } from "../lib/labels";
import { useAppStore } from "../stores/appStore";
import type { SurfaceKey } from "../lib/explanations";
import { RiskBadge } from "./RiskBadge";
import { HITLPanel } from "./HITLPanel";
import { AgentChat } from "./AgentChat";
import { WaterLevelChart } from "./WaterLevelChart";
import { ExplainPopover } from "./ExplainPopover";

// Real crosswalk now arrives on `detail.crosswalk` from `asset_id_crosswalk`.
// The frontend-synthesised version (hashCode-based) was deleted 2026-07-19.

// Curated selection of top features to render as signed attribution bars.
// Value formatting matches the raw column names from the feature builder.
const FEATURE_DISPLAY: Record<string, { label: string; fmt: (v: unknown) => string; adverse: (v: unknown) => number }> = {
  min_dist_to_surge_zone_m: {
    label: "Dist. to surge zone",
    fmt: (v) => (typeof v === "number" ? `${(v / 1000).toFixed(2)} km` : "—"),
    // Closer to surge → higher risk. Normalise around 5km reference.
    adverse: (v) => (typeof v === "number" ? Math.max(-1, Math.min(1, (5000 - v) / 5000)) : 0),
  },
  ground_elevation_ft: {
    label: "Ground elevation",
    fmt: (v) => (typeof v === "number" ? `${v.toFixed(1)} ft` : "—"),
    adverse: (v) => (typeof v === "number" ? Math.max(-1, Math.min(1, (10 - v) / 10)) : 0),
  },
  recent_scada_warnings: {
    label: "Recent SCADA warnings",
    fmt: (v) => String(v ?? 0),
    adverse: (v) => (typeof v === "number" ? Math.min(1, v / 6) : 0),
  },
  within_hurricane_cone: {
    label: "Within forecast cone",
    fmt: (v) => (v ? "yes" : "no"),
    adverse: (v) => (v ? 0.9 : -0.1),
  },
  criticality_rating: {
    label: "Criticality rating",
    fmt: (v) => (typeof v === "number" ? `${v} / 5` : "—"),
    adverse: (v) => (typeof v === "number" ? (v - 3) / 2 : 0),
  },
  overdue_work_orders: {
    label: "Overdue work orders",
    fmt: (v) => String(v ?? 0),
    adverse: (v) => (typeof v === "number" ? Math.min(1, v / 4) : 0),
  },
  min_dist_to_flood_zone_m: {
    label: "Dist. to flood zone",
    fmt: (v) => (typeof v === "number" ? `${(v / 1000).toFixed(2)} km` : "—"),
    adverse: (v) => (typeof v === "number" ? Math.max(-1, Math.min(1, (5000 - v) / 5000)) : 0),
  },
  recent_high_severity_reports: {
    label: "High-severity reports",
    fmt: (v) => String(v ?? 0),
    adverse: (v) => (typeof v === "number" ? Math.min(1, v / 3) : 0),
  },
};

export function AssetDrilldown({
  assetId,
  persona,
  onClose,
}: Readonly<{ assetId: string; persona: PersonaKey; onClose: () => void }>) {
  const llmLabel = useAppStore((s) => s.llm?.label ?? "loading…");
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [gov, setGov] = useState<ModelGovernance | null>(null);
  const [forecast, setForecast] = useState<WaterLevelForecast | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explLoading, setExplLoading] = useState(false);
  const [explError, setExplError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setExplanation(null);
    setExplError(null);
    api.asset(assetId).then(setDetail).catch(console.error);
  }, [assetId]);

  useEffect(() => {
    api.modelGovernance().then(setGov).catch(console.error);
    api.waterLevelForecast().then(setForecast).catch(() => setForecast(null));
  }, []);

  async function fetchExplanation() {
    setExplLoading(true);
    setExplError(null);
    try {
      const res = await api.explanation(assetId);
      setExplanation(res.explanation);
    } catch (e) {
      setExplError(String(e));
    } finally {
      setExplLoading(false);
    }
  }

  if (!detail) {
    return (
      <>
        <div onClick={onClose} className="fixed inset-0 z-[900] bg-black/70" />
        <div className="fixed inset-y-0 right-0 z-[1000] flex w-[640px] max-w-[94vw] flex-col overflow-y-auto border-l border-[color:var(--color-border)] bg-[color:var(--color-background)] p-5 shadow-2xl">
          <div className="text-[color:var(--color-muted-foreground)]">Loading {assetId}…</div>
        </div>
      </>
    );
  }

  const c = riskColor(detail.risk_level);
  const ciWidth = 8; // ±0.08 nominal — backend doesn't currently expose per-asset CI, use a display constant
  const ciLoPct = Math.max(0, (detail.risk_score - ciWidth / 100) * 100);
  const ciWidPct = Math.min(100 - ciLoPct, (ciWidth / 100) * 2 * 100);
  const scorePct = detail.risk_score * 100;

  const crosswalk = detail.crosswalk;
  const featureRows = buildFeatureContributions(detail.features, gov);
  const chain = buildCascadeChain(detail);
  const personaName = PERSONAS.find((p) => p.key === persona)?.name ?? "";

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[900] bg-black/70" />
      <div className="fixed inset-y-0 right-0 z-[1000] w-[640px] max-w-[94vw] overflow-y-auto border-l border-[color:var(--color-border)] bg-[#0a0a0c] shadow-[-24px_0_60px_#000000cc]">
        <div className="p-5">
          {/* header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="sgw-mono text-[11px] text-[#8b8b8b]">{detail.asset_id}</span>
                <RiskBadge level={detail.risk_level} score={detail.risk_score} />
              </div>
              <h2 className="mt-1 text-[19px] font-bold">{detail.asset_name}</h2>
              <div className="mt-0.5 text-[12px] text-[color:var(--color-muted-foreground)]">
                {prettyAssetType(detail.asset_type)} · {prettyRegion(detail.region)} · {detail.utility_domain}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer border-none bg-transparent text-[18px] leading-none text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
            >
              ✕
            </button>
          </div>

          {/* ID crosswalk */}
          <SectionCard className="mt-3">
            <SectionLabel>Resolved source-system crosswalk</SectionLabel>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {crosswalk.map((x) => (
                <span
                  key={x.sys}
                  className="sgw-mono rounded border border-[#2a2a2e] bg-[color:var(--color-border-3)] px-1.5 py-[2px] text-[10.5px] text-[#cbd5e1]"
                >
                  <span className="text-[color:var(--color-subtle)]">{x.sys}:</span> {x.id}
                </span>
              ))}
              <span className="text-[13px] text-[color:var(--color-primary)]">→</span>
              <span className="sgw-mono rounded border border-[#2563eb] bg-[color:var(--color-primary-2)] px-1.5 py-[2px] text-[10.5px] text-white">
                canonical {detail.asset_id}
              </span>
            </div>
          </SectionCard>

          {/* score + provenance */}
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <SectionCard>
              <SectionLabel
                explainSurface="risk_score"
                explainDiagnostic={`${detail.risk_score.toFixed(2)} (${detail.risk_level}) ±0.0${ciWidth}`}
              >
                Calibrated failure probability · 72h
              </SectionLabel>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className="sgw-num text-[34px] font-extrabold leading-none"
                  style={{ color: c }}
                >
                  {detail.risk_score.toFixed(2)}
                </span>
                <span className="sgw-mono text-[12px] text-[color:var(--color-muted-foreground)]">
                  ±0.0{ciWidth}
                </span>
              </div>
              <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-sm bg-[color:var(--color-border-2)]">
                <div
                  className="absolute top-0 bottom-0"
                  style={{ left: `${ciLoPct}%`, width: `${ciWidPct}%`, background: `${c}33` }}
                />
                <div
                  className="absolute -top-0.5 -bottom-0.5 w-0.5"
                  style={{ left: `${scorePct}%`, background: c }}
                />
              </div>
              <div className="mt-1.5 text-[9.5px] text-[color:var(--color-faint)]">
                ±.05 nominal band · v2 regressor
              </div>
            </SectionCard>
            <SectionCard>
              <SectionLabel
                explainSurface="model_provenance"
                explainDiagnostic={`${gov?.risk_model.version ?? "—"} · ROC-AUC ${gov?.risk_model.metrics?.roc_auc?.toFixed(3) ?? "—"} · Brier ${gov?.risk_model.metrics?.brier?.toFixed(3) ?? "—"}`}
              >
                Model provenance
              </SectionLabel>
              <div className="sgw-mono mt-1 space-y-1 text-[11.5px]">
                <ProvenanceRow k="version" v={gov?.risk_model.version ?? "—"} />
                <ProvenanceRow k="ROC-AUC" v={gov?.risk_model.metrics?.roc_auc?.toFixed(3) ?? "—"} />
                <ProvenanceRow k="Brier" v={gov?.risk_model.metrics?.brier?.toFixed(3) ?? "—"} />
                <ProvenanceRow k="cluster" v={detail.blast_radius_cluster !== null ? `◆ Louvain #${detail.blast_radius_cluster}` : "—"} highlight />
                <ProvenanceRow k="cone" v={detail.within_hurricane_cone ? "yes" : "no"} />
              </div>
            </SectionCard>
          </div>

          {/* feature contributions */}
          <SectionCard className="mt-3">
            <div className="flex items-center justify-between">
              <SectionLabel
                explainSurface="feature_contributions"
                explainDiagnostic={`${featureRows.length} features attributed · signed by feature value`}
              >
                Contributing factors → risk
              </SectionLabel>
              <span className="text-[9px] text-[color:var(--color-faint)]">
                signed by feature value · not SHAP
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {featureRows.map((f) => (
                <FeatureRow key={f.key} row={f} />
              ))}
            </div>
          </SectionCard>

          {/* forecast chart */}
          <SectionCard className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <SectionLabel
                explainSurface="water_forecast"
                explainDiagnostic={
                  forecast
                    ? `${forecast.is_live ? "LIVE" : "REPLAY"} · ${forecast.history_points} history points`
                    : "Forecast unavailable"
                }
              >
                Water-level forecast · Charleston Harbor 8665530
              </SectionLabel>
              <span className="sgw-mono text-[9px] text-[color:var(--color-faint)]">
                Prophet · exogenous weather
              </span>
            </div>
            <WaterLevelChart forecast={forecast} />
          </SectionCard>

          {/* dependency chain */}
          <SectionCard className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel
                explainSurface="dependency_cascade"
                explainDiagnostic={`◆ Cluster ${detail.blast_radius_cluster ?? "—"} · ${detail.cascade.length} downstream nodes · BFS depth 3`}
              >
                Cascading dependency chain
              </SectionLabel>
              <span className="text-[9px] text-[#94a3b8]">
                ◆ Cluster {detail.blast_radius_cluster ?? "—"} · {detail.cascade.length} downstream · BFS depth 3
              </span>
            </div>
            <div className="flex items-stretch gap-0">
              {chain.map((n, i) => (
                <div key={n.id + i} className="flex flex-1 items-center">
                  <ChainNode node={n} />
                  {i < chain.length - 1 && (
                    <div className="shrink-0 px-1 text-[16px] text-[color:var(--color-primary)]">→</div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* evidence */}
          <SectionCard className="mt-3">
            <SectionLabel
              explainSurface="evidence_citations"
              explainDiagnostic={`${Object.values(detail.evidence).reduce((a, ids) => a + ids.length, 0)} records cited across ${Object.keys(detail.evidence).length} kinds`}
            >
              Evidence · cited source records
            </SectionLabel>
            <div className="mt-2 space-y-1.5">
              {Object.entries(detail.evidence).map(([kind, ids]) => (
                <div key={kind} className="flex items-baseline gap-2">
                  <span className="w-[92px] shrink-0 text-[10px] text-[color:var(--color-subtle)]">
                    {kind}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {ids.length === 0 ? (
                      <span className="text-[10px] italic text-[color:var(--color-faint)]">(none)</span>
                    ) : (
                      ids.map((i) => (
                        <span
                          key={i}
                          className="sgw-mono rounded border border-[#1e3a5f] bg-[#0b1220] px-1.5 py-[2px] text-[10px] text-[#93c5fd]"
                        >
                          {i.length > 24 ? i.slice(0, 24) + "…" : i}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* copilot */}
          <div className="mt-3 rounded-lg border border-[color:var(--color-storm-border)] bg-[#150d24] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded border border-[color:var(--color-storm-border)] bg-[color:var(--color-storm-bg)] px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.6px] text-[#c4b5fd]">
                  AI copilot
                </span>
                <span className="sgw-mono text-[9.5px] text-[#8b8b8b]">
                  {llmLabel} · structured
                </span>
              </div>
              <span className="text-[9px] text-[#c4b5fd]">schema-validated</span>
            </div>

            {!explanation && (
              <button
                onClick={fetchExplanation}
                disabled={explLoading}
                className="cursor-pointer rounded bg-[color:var(--color-primary)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-primary-foreground)] disabled:opacity-50"
              >
                {explLoading ? "Generating…" : "Generate explanation"}
              </button>
            )}
            {explError && (
              <div className="mt-2 text-[11px] text-[color:var(--color-critical)]">{explError}</div>
            )}
            {explanation && (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                    Recommended action
                  </div>
                  <div className="text-[13px] font-semibold leading-[1.4] text-[#f5f5f5]">
                    {explanation.recommended_action}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                    Reasoning
                  </div>
                  {explanation.reasoning_summary.map((r) => (
                    <div
                      key={r}
                      className="mb-1.5 flex gap-1.5 text-[12px] leading-[1.45] text-[#e5e5e5]"
                    >
                      <span className="text-[color:var(--color-storm)]">•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
                {explanation.uncertainties.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                      Stated uncertainties
                    </div>
                    {explanation.uncertainties.map((u) => (
                      <div
                        key={u}
                        className="mb-1 flex gap-1.5 text-[11.5px] leading-[1.45] text-[#cbd5e1]"
                      >
                        <span className="text-[color:var(--color-anomaly)]">△</span>
                        <span>{u}</span>
                      </div>
                    ))}
                  </div>
                )}
                {explanation.evidence.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                      Cites
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {explanation.evidence.map((e) => (
                        <span
                          key={e}
                          className="sgw-mono rounded border border-[#1e3a5f] bg-[#0b1220] px-1.5 py-[2px] text-[9.5px] text-[#93c5fd]"
                        >
                          {e.length > 26 ? e.slice(0, 26) + "…" : e}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* AI copilot agent chat — streaming + tool calls + inline execute */}
          <SectionCard className="mt-3">
            <SectionLabel>
              AI copilot · agent chat{personaName ? ` · ${personaName}` : ""}
            </SectionLabel>
            <div className="mt-2 h-[380px]">
              <AgentChat assetId={detail.asset_id} />
            </div>
          </SectionCard>

          {/* HITL action row */}
          <SectionCard className="mt-3 mb-1">
            <SectionLabel>
              Operator decision · human-in-the-loop{personaName ? ` · ${personaName}` : ""}
            </SectionLabel>
            <div className="mt-2">
              <HITLPanel assetId={detail.asset_id} />
            </div>
            <div className="mt-2 text-[9.5px] text-[color:var(--color-faint)]">
              Every action writes to the append-only audit log with actor, model version, evidence IDs, and SHA-256 chain hash.
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

// ------------------------------ subcomponents ------------------------------

function SectionCard({
  children,
  className = "",
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return (
    <div
      className={`rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3 ${className}`}
    >
      {children}
    </div>
  );
}

function SectionLabel({
  children,
  explainSurface,
  explainDiagnostic,
}: Readonly<{
  children: React.ReactNode;
  explainSurface?: SurfaceKey;
  explainDiagnostic?: string;
}>) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-[9.5px] font-medium uppercase tracking-[0.6px] text-[color:var(--color-subtle)]">
        {children}
      </div>
      {explainSurface && (
        <ExplainPopover surface={explainSurface} align="left" diagnostic={explainDiagnostic} />
      )}
    </div>
  );
}

function ProvenanceRow({
  k,
  v,
  highlight = false,
}: Readonly<{ k: string; v: React.ReactNode; highlight?: boolean }>) {
  return (
    <div className="flex justify-between leading-[1.6]">
      <span className="text-[color:var(--color-subtle)]">{k}</span>
      <span className={highlight ? "text-[color:var(--color-primary-ink)]" : "text-[#d4d4d4]"}>{v}</span>
    </div>
  );
}

type FeatureRowData = {
  key: string;
  label: string;
  valueStr: string;
  contribution: number; // -1..1
};

function buildFeatureContributions(
  features: Record<string, unknown>,
  gov: ModelGovernance | null,
): FeatureRowData[] {
  const topFeatures = gov?.risk_model.top_features ?? {};
  const rows: FeatureRowData[] = [];
  const orderedKeys = Object.entries(topFeatures)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map((e) => e[0]);
  const keys = orderedKeys.length ? orderedKeys : Object.keys(FEATURE_DISPLAY);

  for (const key of keys) {
    const cfg = FEATURE_DISPLAY[key];
    if (!cfg) continue;
    const raw = features[key];
    if (raw === undefined || raw === null) continue;
    const importance = topFeatures[key] ?? 0.1;
    const contribution = cfg.adverse(raw) * (0.5 + Math.min(1, importance * 2));
    rows.push({
      key,
      label: cfg.label,
      valueStr: cfg.fmt(raw),
      contribution: Math.max(-1, Math.min(1, contribution)),
    });
    if (rows.length >= 7) break;
  }
  return rows;
}

function FeatureRow({ row }: Readonly<{ row: FeatureRowData }>) {
  const pos = row.contribution >= 0;
  const width = Math.abs(row.contribution) * 50;
  const barColor = pos ? "#e0245e" : "#22c55e";
  return (
    <div className="grid grid-cols-[150px_1fr_46px] items-center gap-2">
      <div className="text-[11px] text-[#d4d4d4]">
        {row.label} <span className="sgw-mono text-[9.5px] text-[color:var(--color-subtle)]">{row.valueStr}</span>
      </div>
      <div className="relative h-3.5 rounded-sm bg-[#0a0a0d]">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#2a2a2e]" />
        <div
          className="absolute top-0.5 bottom-0.5"
          style={{
            [pos ? "left" : "right"]: "50%",
            width: `${width}%`,
            background: barColor,
            borderRadius: pos ? "0 3px 3px 0" : "3px 0 0 3px",
          }}
        />
      </div>
      <div className="sgw-mono text-right text-[10.5px]" style={{ color: barColor }}>
        {pos ? "+" : ""}
        {row.contribution.toFixed(2)}
      </div>
    </div>
  );
}

type ChainNodeData = {
  role: string;
  name: string;
  id: string;
  impact: string;
  impactColor: string;
  kind: "up" | "self" | "down" | "end";
};

function buildCascadeChain(detail: AssetDetail): ChainNodeData[] {
  const self: ChainNodeData = {
    role: "This asset",
    name: detail.asset_name,
    id: detail.asset_id,
    impact: detail.utility_domain,
    impactColor: riskColor(detail.risk_level),
    kind: "self",
  };
  const first = detail.cascade[0];
  const second = detail.cascade[1];
  const nodes: ChainNodeData[] = [self];
  if (first) {
    nodes.push({
      role: "Downstream",
      name: first.downstream,
      id: first.downstream,
      impact: first.consequence || "Service interruption",
      impactColor: "#f5a524",
      kind: "down",
    });
  }
  if (second) {
    nodes.push({
      role: "Critical endpoint",
      name: second.downstream,
      id: second.downstream,
      impact: second.consequence || "Service interruption",
      impactColor: "#e0245e",
      kind: "end",
    });
  }
  return nodes;
}

function ChainNode({ node }: Readonly<{ node: ChainNodeData }>) {
  const border = node.kind === "self" ? "#e0245e" : node.kind === "end" ? "#7f1d1d" : "#262626";
  const bg = node.kind === "self" ? "#1a0d14" : node.kind === "end" ? "#160c0c" : "#101013";
  // When name and id are the same string (e.g. cascade endpoint returns only
  // the downstream asset_id and no human-readable name), avoid rendering the
  // same text twice at two different truncation lengths — show the ID once.
  const showIdSeparately = node.name !== node.id;
  return (
    <div
      className="min-w-0 flex-1 rounded-lg border p-2.5"
      style={{ borderColor: border, background: bg }}
    >
      <div className="text-[8.5px] uppercase tracking-[0.4px] text-[color:var(--color-subtle)]">
        {node.role}
      </div>
      <div className="mt-0.5 text-[11.5px] font-semibold leading-[1.2] text-[#ededed]">
        {truncate(node.name, 28)}
      </div>
      {showIdSeparately && (
        <div className="sgw-mono mt-1 text-[9px] text-[#8b8b8b]">{truncate(node.id, 20)}</div>
      )}
      <div className="mt-1 text-[9px]" style={{ color: node.impactColor }}>
        {node.impact}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
