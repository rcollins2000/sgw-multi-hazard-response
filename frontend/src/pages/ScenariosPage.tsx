import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AssetSummary,
  type PresetKey,
  type ScenarioImpact,
  type ScenarioPresets,
  type ScenarioReport,
} from "../lib/api";
import { prettyRegion, riskColor, riskLevelOf } from "../lib/labels";
import { CopilotPullQuote } from "../components/CopilotPullQuote";
import { ExplainPopover } from "../components/ExplainPopover";
import { ScenariosMap } from "../components/ScenariosMap";
import {
  PRESET_TO_TEMPLATE,
  STORM_TEMPLATES,
  resolveTemplateFromDirective,
  resolveTemplateFromSpec,
  type StormPathTemplate,
} from "../lib/stormPaths";

/*
  ScenariosPage — the agent surface.

  Two input paths:
    · a preset chip (LLM parser skipped, ScenarioSpec loaded from a hardcoded
      constant on the backend)
    · a free-text directive (LLM parses to a ScenarioSpec)

  Both hit POST /api/scenarios/run which returns a ScenarioReport. We render:
    · the resolved ScenarioSpec so operators see what the LLM decided
    · a ranked-impacts list (same visual grammar as the cockpit watchlist)
    · a CopilotPullQuote with the recommendation
    · a HITL row that posts to /api/scenarios/{id}/decision

  Every AI-produced surface has an ExplainPopover attached so the reader can
  understand what the model + agent did to arrive here.
*/

const PRESET_CHIPS: { key: PresetKey; label: string; blurb: string }[] = [
  {
    key: "replay_debby",
    label: "Replay Debby (2024)",
    blurb: "Historic overlay · Cat-1 landfall + Charleston Harbor surge",
  },
  {
    key: "replay_idalia",
    label: "Replay Idalia (2023)",
    blurb: "Historic overlay · Cat-3 landfall against today's assets",
  },
  {
    key: "cat3_charleston_30d",
    label: "Cat 3 @ Charleston +30d",
    blurb: "Synthesised hazard layers from HURDAT2-shaped climatology",
  },
  {
    key: "worst_case_cascade",
    label: "Worst single-asset cascade",
    blurb: "Rank assets by priority × downstream cascade depth",
  },
];

export function ScenariosPage() {
  const [presets, setPresets] = useState<ScenarioPresets["presets"] | null>(null);
  const [directive, setDirective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ScenarioReport | null>(null);
  const [decision, setDecision] = useState<{ action: string; hash: string } | null>(null);
  const [reason, setReason] = useState("");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  // Storm-path template driving the map. Set from preset click OR from a
  // resolved ScenarioSpec (backend response). Kept in state so a free-text run
  // that resolves to a known template still lights up the map.
  const [template, setTemplate] = useState<StormPathTemplate | null>(null);
  const [provenance, setProvenance] = useState<
    "historic" | "synthesised" | "llm_inferred" | "no_path"
  >("no_path");

  const assetsById = useMemo(() => {
    const m = new Map<string, AssetSummary>();
    for (const a of assets) m.set(a.asset_id, a);
    return m;
  }, [assets]);

  useEffect(() => {
    api
      .scenarioPresets()
      .then((p) => setPresets(p.presets))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api
      .assets({ limit: 500 })
      .then(setAssets)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function runPreset(preset: PresetKey) {
    setBusy(true);
    setError(null);
    setDecision(null);
    // Prime the map from the preset before the backend responds so the map
    // renders instantly rather than snapping in after the round-trip.
    const templateKey = PRESET_TO_TEMPLATE[preset];
    const tpl = templateKey ? STORM_TEMPLATES[templateKey] : null;
    setTemplate(tpl);
    setProvenance(
      preset === "replay_idalia" || preset === "replay_debby"
        ? "historic"
        : preset === "worst_case_cascade"
          ? "no_path"
          : "synthesised",
    );
    try {
      const r = await api.runScenario({ preset });
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runDirective() {
    if (!directive.trim()) return;
    setBusy(true);
    setError(null);
    setDecision(null);
    // Prime the map from keyword-match on the directive so the reader sees a
    // path immediately. If the LLM parses to a different reference_event the
    // effect below will overwrite this once report arrives.
    const guessed = resolveTemplateFromDirective(directive);
    if (guessed) {
      setTemplate(guessed);
      setProvenance(guessed.key.startsWith("hurricane_") ? "historic" : "synthesised");
    } else {
      setTemplate(null);
      setProvenance("no_path");
    }
    try {
      const r = await api.runScenario({ directive });
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Once a report arrives, prefer the spec-derived template (LLM chose a
  // reference_event or path_template_hint we know about) over the pre-primed
  // one from the button click / keyword guess.
  //
  // Provenance rule:
  //   · If the LLM populated path_template_hint on a directive run, provenance
  //     is "llm_inferred" (the reader sees "LLM-inferred cone").
  //   · If it's a preset, provenance is already set at click time.
  //   · Historic/synthesised buckets otherwise.
  useEffect(() => {
    if (!report) return;
    const specTpl = resolveTemplateFromSpec(report.spec);
    if (!specTpl) return;
    setTemplate(specTpl);
    // Directives (kind !== preset origin) that resulted in an LLM-populated
    // path_template_hint get the "llm_inferred" badge — this distinguishes
    // "the operator clicked Replay Idalia" from "the LLM decided this
    // directive best matches the Idalia template".
    const camePickedByLLM =
      report.spec.path_template_hint != null && !directive.length
        ? false // preset click had directive="" — leave provenance as set at click time
        : report.spec.path_template_hint != null;
    if (camePickedByLLM) {
      setProvenance("llm_inferred");
      return;
    }
    setProvenance(
      specTpl.key.startsWith("hurricane_")
        ? "historic"
        : specTpl.key === "worst_case_cascade"
          ? "no_path"
          : "synthesised",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  async function decide(action: "accept" | "override" | "comment") {
    if (!report) return;
    if (action !== "accept" && !reason.trim()) return;
    try {
      const res = await api.scenarioDecide(report.scenario_id, {
        action,
        reason: reason.trim() || undefined,
      });
      setDecision({ action, hash: res.audit_hash });
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1120px] p-6" data-testid="scenarios-page">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-bold">Scenario analysis</h1>
              <ExplainPopover
                surface="scenario_analysis"
                align="left"
                diagnostic={report ? `Last run · ${report.scenario_id}` : "No run yet"}
              />
              <span
                className="rounded border border-[color:var(--color-signature)]/40 bg-[color:var(--color-signature)]/10 px-2 py-[2px] text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[color:var(--color-signature)]"
                title="Scenario results are a controlled feature perturbation of the trained risk model, not a real-time forecast."
              >
                Stress test · not a live forecast
              </span>
            </div>
            <p className="mt-1 max-w-[720px] text-[12.5px] leading-[1.5] text-[color:var(--color-muted-foreground)]">
              Ask the platform what would happen under a hypothetical — the LLM parses your directive
              into a typed scenario, the risk model runs against a mutated feature frame, and the
              agent narrates the ranked impacts. Every run writes to the audit log.
            </p>
          </div>
          {report && (
            <span className="sgw-mono whitespace-nowrap text-[10px] text-[color:var(--color-faint)]">
              {report.scenario_id}
            </span>
          )}
        </div>

        {/* preset chips */}
        <div className="mt-5 grid gap-2.5 md:grid-cols-4">
          {PRESET_CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => runPreset(c.key)}
              disabled={busy}
              data-testid={`preset-${c.key}`}
              className="cursor-pointer rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3.5 text-left transition hover:border-[color:var(--color-signature)] disabled:opacity-50"
            >
              <div className="sgw-lbl text-[color:var(--color-signature)]">preset</div>
              <div className="mt-1 text-[13.5px] font-semibold">{c.label}</div>
              <div className="mt-1 text-[11px] leading-[1.4] text-[color:var(--color-muted-foreground)]">
                {c.blurb}
              </div>
            </button>
          ))}
        </div>

        {/* free-text directive */}
        <div className="mt-4 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3.5">
          <div className="sgw-lbl">Or type a directive</div>
          <textarea
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            placeholder='e.g. "What if a Cat 4 hurricane made landfall at Savannah in 21 days?"'
            className="mt-2 min-h-[70px] w-full resize-y rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-2)] p-2.5 text-[12.5px] text-[color:var(--color-foreground)] outline-none"
            data-testid="scenario-directive"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10.5px] text-[color:var(--color-faint)]">
              LLM parses to a typed ScenarioSpec (schema-validated); ambiguous inputs fall back to a
              neutral synthesised run.
            </span>
            <button
              onClick={runDirective}
              disabled={busy || directive.trim().length === 0}
              className="cursor-pointer rounded-md border-none bg-[color:var(--color-signature)] px-3.5 py-1.5 text-[12px] font-semibold text-[color:var(--color-signature-ink)] disabled:opacity-50"
              data-testid="scenario-run"
            >
              {busy ? "Running…" : "Run scenario →"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded border border-[color:var(--color-critical)] bg-[color:var(--color-critical)]/10 p-3 text-[12px] text-[color:var(--color-critical)]">
            {error}
          </div>
        )}

        {/* result */}
        {report && (
          <div className="mt-6" data-testid="scenario-report">
            <ScenariosMap
              template={template}
              impacts={report.ranked_impacts}
              assetsById={assetsById}
              provenance={provenance}
              height={380}
            />
            <div className="mt-4">
              <ScenarioSpecPanel report={report} presets={presets} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1.35fr_1fr]">
              <ImpactsList
                impacts={report.ranked_impacts}
                totalImpacted={report.total_assets_impacted}
              />
              <div className="space-y-3">
                <CopilotPullQuote
                  recommendation={report.recommendation}
                  evidence={report.evidence}
                  modelLabel="scenario agent · gpt-oss:120b"
                />
                <SummaryPanel summary={report.summary} />
                <HitlPanel
                  decision={decision}
                  reason={reason}
                  setReason={setReason}
                  onDecide={decide}
                  auditHash={report.audit_hash}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- subpanels --------------------------------------------------------------

function ScenarioSpecPanel({
  report,
  presets,
}: Readonly<{ report: ScenarioReport; presets: ScenarioPresets["presets"] | null }>) {
  const spec = report.spec;
  const isPreset = presets
    ? Object.values(presets).some((p) => p.label === spec.label)
    : false;
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3.5">
      <div className="flex items-center gap-2">
        <span className="sgw-lbl text-[color:var(--color-signature)]">Resolved ScenarioSpec</span>
        <span className="sgw-mono text-[10px] text-[color:var(--color-faint)]">
          · kind: {spec.kind}
        </span>
        {isPreset && (
          <span className="rounded border border-[color:var(--color-signature)]/40 bg-[color:var(--color-signature)]/10 px-1.5 py-[1px] text-[9px] font-semibold text-[color:var(--color-signature)]">
            PRESET
          </span>
        )}
      </div>
      <div className="mt-1.5 text-[14px] font-semibold">{spec.label}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11.5px] md:grid-cols-4">
        <SpecKv k="hazard" v={spec.hazard_type ?? "—"} />
        <SpecKv k="severity" v={spec.severity ?? "—"} />
        <SpecKv k="region" v={spec.region_focus ?? "—"} />
        <SpecKv k="horizon" v={spec.horizon_days != null ? `${spec.horizon_days}d` : "—"} />
        {spec.surge_lift_pct != null && (
          <SpecKv k="surge lift" v={`${(spec.surge_lift_pct * 100).toFixed(0)}%`} />
        )}
        {spec.within_cone_ratio != null && (
          <SpecKv k="cone ratio" v={`${(spec.within_cone_ratio * 100).toFixed(0)}%`} />
        )}
        {spec.reference_event && <SpecKv k="reference" v={spec.reference_event} />}
        <SpecKv k="impacted" v={String(report.total_assets_impacted)} />
      </div>
      {spec.notes && (
        <div className="mt-2 text-[11px] italic text-[color:var(--color-muted-foreground)]">
          {spec.notes}
        </div>
      )}
    </div>
  );
}

function SpecKv({ k, v }: Readonly<{ k: string; v: string }>) {
  return (
    <div className="flex justify-between gap-2">
      <span className="sgw-mono text-[color:var(--color-subtle)]">{k}</span>
      <span className="sgw-mono text-[color:var(--color-foreground)]">{v}</span>
    </div>
  );
}

function ImpactsList({
  impacts,
  totalImpacted,
}: Readonly<{ impacts: ScenarioImpact[]; totalImpacted: number }>) {
  const materiallyUplifted = impacts.filter((i) => i.delta > 0.05).length;
  const largestDelta = impacts.reduce((max, i) => Math.max(max, i.delta), 0);
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="sgw-lbl text-[color:var(--color-signature)]">Ranked impacts</span>
        <ExplainPopover
          surface="preventative_priority"
          align="left"
          diagnostic={`${impacts.length} assets ranked · scenario_score dominates the ordering`}
        />
      </div>
      {impacts.length === 0 ? (
        <div className="italic text-[color:var(--color-muted-foreground)]">
          No assets impacted under this scenario.
        </div>
      ) : (
        <>
          {/* One-line executive summary of the scenario's overall reach — helps
              operators and reviewers grok the result before scanning the table. */}
          <div
            className="mb-2.5 rounded border border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] px-2.5 py-1.5 text-[11px] text-[color:var(--color-muted-foreground)]"
            data-testid="scenario-summary-line"
          >
            <span className="sgw-num text-[color:var(--color-foreground)]">{totalImpacted}</span>
            {" assets impacted · "}
            <span className="sgw-num text-[color:var(--color-signature)]">
              {materiallyUplifted}
            </span>
            {" materially uplifted (Δ > 0.05) · largest uplift "}
            <span className="sgw-num text-[color:var(--color-signature)]">
              +{largestDelta.toFixed(2)}
            </span>
          </div>
          <div className="-mx-1" data-testid="scenario-impacts">
            {impacts.map((i, rank) => (
              <ImpactRow key={i.asset_id} impact={i} rank={rank + 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ImpactRow({ impact, rank }: Readonly<{ impact: ScenarioImpact; rank: number }>) {
  const level = riskLevelOf(impact.scenario_score);
  const color = riskColor(level);
  // Small deltas round to "0.00" at 2 decimal places which reads as "no change"
  // even when it is a change. Bucket into three visually distinct states so the
  // reader sees material uplift, minimal change, and downside separately.
  const abs = Math.abs(impact.delta);
  const kind: "material" | "trace" | "flat" | "down" =
    impact.delta >= 0.05
      ? "material"
      : impact.delta >= 0.003
        ? "trace"
        : impact.delta <= -0.003
          ? "down"
          : "flat";
  const deltaLabel =
    kind === "flat"
      ? "no change"
      : (impact.delta > 0 ? "+" : "") + impact.delta.toFixed(abs < 0.05 ? 3 : 2);
  const deltaColor =
    kind === "material" ? color : kind === "trace" ? "#f5a524" : kind === "down" ? "#3fd47a" : "#6b7280";
  return (
    <div className="flex items-center gap-3 border-b border-[color:var(--color-border-3)] px-1 py-2 last:border-none">
      <span className="sgw-mono sgw-num w-4 text-[11px] text-[color:var(--color-faint)]">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-[color:var(--color-foreground)]">
          {impact.asset_name}
        </div>
        <div className="sgw-mono mt-px text-[9px] text-[color:var(--color-faint)]">
          {impact.asset_id} · {prettyRegion(impact.region)} · {impact.utility_domain}
        </div>
      </div>
      <div className="text-right text-[10.5px]">
        <div className="sgw-mono text-[color:var(--color-subtle)]">
          base {impact.baseline_score.toFixed(2)}
        </div>
        <div className="sgw-mono" style={{ color: deltaColor }}>
          {deltaLabel}
        </div>
      </div>
      <div className="h-1.5 w-14 overflow-hidden rounded-sm bg-[color:var(--color-panel-2)]">
        <div
          className="h-full"
          style={{ width: `${impact.scenario_score * 100}%`, background: color }}
        />
      </div>
      <span className="sgw-mono sgw-num w-9 text-right text-[13px]" style={{ color }}>
        {impact.scenario_score.toFixed(2)}
      </span>
    </div>
  );
}

function SummaryPanel({ summary }: Readonly<{ summary: string }>) {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3.5">
      <div className="sgw-lbl text-[color:var(--color-signature)]">Narrative</div>
      <div className="mt-1.5 text-[12.5px] leading-[1.55] text-[color:var(--color-foreground)]">
        {summary}
      </div>
    </div>
  );
}

function HitlPanel({
  decision,
  reason,
  setReason,
  onDecide,
  auditHash,
}: Readonly<{
  decision: { action: string; hash: string } | null;
  reason: string;
  setReason: (v: string) => void;
  onDecide: (action: "accept" | "override" | "comment") => void;
  auditHash: string;
}>) {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3.5">
      <div className="sgw-lbl text-[color:var(--color-signature)]">
        Operator decision · human-in-the-loop
      </div>
      {decision ? (
        <div
          className="mt-2 flex items-center gap-2 rounded-md border border-[#1c4a30] bg-[#0f2419] px-3 py-2 text-[12.5px] font-semibold text-[color:var(--color-success)]"
          data-testid="scenario-decided"
        >
          <span aria-hidden>✓</span>
          <span>Scenario {decision.action} · logged to audit</span>
          <span className="sgw-mono text-[10px] font-normal opacity-80">
            {decision.hash.slice(0, 12)}
          </span>
        </div>
      ) : (
        <>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason / comment (required for override or comment)"
            className="mt-2 min-h-[52px] w-full resize-y rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-2)] p-2 text-[12px] outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onDecide("accept")}
              className="flex-1 cursor-pointer rounded-md border-none bg-[color:var(--color-signature)] px-3 py-2 text-[12px] font-semibold text-[color:var(--color-signature-ink)]"
              data-testid="scenario-accept"
            >
              Accept &amp; queue work orders
            </button>
            <button
              onClick={() => onDecide("override")}
              disabled={!reason.trim()}
              className="cursor-pointer rounded-md border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-[12px] text-[color:var(--color-muted-foreground)] disabled:opacity-40"
            >
              Override
            </button>
            <button
              onClick={() => onDecide("comment")}
              disabled={!reason.trim()}
              className="cursor-pointer rounded-md border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-[12px] text-[color:var(--color-subtle)] disabled:opacity-40"
            >
              Comment
            </button>
          </div>
          <div className="mt-2 text-[9.5px] text-[color:var(--color-faint)]">
            Every action writes to the append-only audit log · scenario hash {auditHash.slice(0, 12)}
          </div>
        </>
      )}
    </div>
  );
}
