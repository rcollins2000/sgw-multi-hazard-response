import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type AssetDetail,
  type AssetSummary,
  type Explanation,
  type ModelGovernance,
  type WaterLevelForecast,
} from "../lib/api";
import { usePoll } from "../lib/usePoll";
import { fmtRelative, prettyAssetType, prettyRegion, riskColor, riskLevelOf } from "../lib/labels";
import { buildDrivers, type DriverRow } from "../lib/asset";
import {
  fallbackPreventativeRecommendation,
  rankByPreventative,
  type PreventativeScore,
} from "../lib/priority";
import { useAppStore } from "../stores/appStore";
import { TimelineSpine, type SpineEvent, formatDayTick } from "../components/TimelineSpine";
import { ConfidenceMeter, meterLevelFromProbability } from "../components/ConfidenceMeter";
import { CopilotPullQuote } from "../components/CopilotPullQuote";
import { WaterLevelChart } from "../components/WaterLevelChart";
import { CockpitMiniMap } from "../components/CockpitMiniMap";
import { ExplainPopover } from "../components/ExplainPopover";
import { AgentChat } from "../components/AgentChat";
import type { SurfaceKey } from "../lib/explanations";

/*
  CockpitPage — the "one decision at a time" landing surface.

  Layout:

    ┌─── Countdown + stats + TimelineSpine ─────────────────────────┐
    │                                                               │
    ├─── Focus lane (fills) ─────────────────┬── Rail (340px) ──────┤
    │  Priority decision (hero asset)        │  Mini-map            │
    │  · IDs · elevation · surge dist        │  · cone + track      │
    │  Score + confidence meter              │  · asset dots        │
    │  Copilot pull-quote (LLM)              │                      │
    │  "Why it's #1" drivers                 │  Watchlist (rank 2+) │
    │  Water-level sparkline                 │                      │
    │  Action bar (Accept / Override / Defer)│                      │
    └────────────────────────────────────────┴──────────────────────┘

  The cockpit's single job is to answer: "what does AI recommend right
  now, and what should I do about it?" Every element on this page maps to
  that question — either as the recommendation itself, its evidence, or
  the operator's action affordance.
*/

// ---- Debby-scenario constants ------------------------------------------------
// Display constants for DEBBY 2024 REPLAY. In LIVE NWS mode with no cone
// these are replaced by the LIVE_EVENTS list and the "no current threats"
// baseline banner.

const LANDFALL_HOURS = 6;
const COUNTDOWN_HOURS = 54;
const COUNTDOWN_MINUTES = 12;

const DEBBY_EVENTS: SpineEvent[] = [
  { t: -52, short: "Adv 15", title: "NHC Advisory 15 issued", color: "#f5a524", shape: "1px" },
  { t: -30, short: "Surge W", title: "Storm Surge Warning issued", color: "#38bdf8" },
  { t: -9, short: "Tide↑band", title: "Tide crossed 80% forecast band", color: "#f5a524" },
  { t: -6, short: "Crew go", title: "Crew pre-position deadline", color: "#e8eaed", shape: "1px" },
  { t: -2, short: "WO lock", title: "Preventative work-order lock", color: "#8b9199", shape: "1px" },
  { t: 12, short: "Peak surge", title: "Projected peak surge" , color: "#e0245e" },
];

// LIVE NWS mode timeline — anchored at Now, showing a rolling operational
// window (past 7 days ← now → next 30 days).
//
// These are demo defaults so the timeline reads as populated on first paint.
// In production these tick events come from:
//   · NWS alerts issued in the last N days      (weather_alerts)
//   · Model firing timestamps                    (predictions.timestamp)
//   · Scheduled maintenance windows              (work_orders.scheduled_for)
//   · Model retrain / calibration events         (model_versions.trained_at)
const LIVE_EVENTS: SpineEvent[] = [
  { t: -156, short: "Adv retire", title: "Last active NWS advisory expired", color: "#8b9199" },
  { t: -72, short: "Model fit", title: "Prophet re-fit on Charleston Harbor tide", color: "#38bdf8" },
  { t: -24, short: "Anomaly", title: "SCADA residual anomaly detected + cleared", color: "#f5a524" },
  { t: -6, short: "Retrain", title: "Scheduled model retrain", color: "#93c5fd", shape: "1px" },
  { t: 48, short: "Sched. maint.", title: "Ashley River PS · scheduled preventative window", color: "#3fd47a", shape: "1px" },
  { t: 168, short: "Cluster #7 audit", title: "Louvain cluster #7 dependency review", color: "#c4b5fd", shape: "1px" },
  { t: 360, short: "Retrain", title: "Scheduled LightGBM retrain + fairness audit", color: "#93c5fd", shape: "1px" },
];
const LIVE_SPAN_BEFORE = 168;   // 7 days back
const LIVE_SPAN_AFTER = 720;    // 30 days ahead
const LIVE_HOUR_TICKS = [-168, -72, -24, 0, 24, 72, 168, 336, 720];

// ---- component ---------------------------------------------------------------

// Poll cadences chosen to match the backend NOAA pollers:
//   - assets  → 30s (model scores change slowly; frequent enough to reflect
//                    poller-driven risk uplift from new alerts / anomalies)
//   - forecast → 5min (CO-OPS gauge upstream cadence is 6min; server poller
//                       is 6min; anything tighter would just refit Prophet
//                       against the same data)
const ASSETS_POLL_MS = 30_000;
const FORECAST_POLL_MS = 300_000;

export function CockpitPage({ onExpandMap }: Readonly<{ onExpandMap: () => void }>) {
  const [gov, setGov] = useState<ModelGovernance | null>(null);
  const focusedAssetId = useAppStore((s) => s.focusedAssetId);
  const setFocusedAsset = useAppStore((s) => s.setFocusedAsset);
  const mode = useAppStore((s) => s.mode);
  const isLive = mode === "live";

  // Governance snapshot loads once — model version + feature importances
  // only change when the trainer runs, which is once per boot.
  useEffect(() => {
    api.modelGovernance().then(setGov).catch(console.error);
  }, []);

  const { data: assetsData } = usePoll(() => api.assets({ limit: 500 }), ASSETS_POLL_MS);
  const assets = useMemo(() => assetsData ?? [], [assetsData]);

  // Mode-aware forecast source:
  //   · LIVE — pull from the rolling CO-OPS live buffer (poller writes
  //     `NOS_COOPS:live_8665530` every 6 min).
  //   · DEBBY REPLAY — pull the archived Aug-2024 window so the sparkline
  //     shows the actual storm-surge signal, not the calm current tide.
  const forecastSource = isLive ? "live" : "NOS_COOPS:debby_2024";
  const { data: forecast, updatedAt: forecastUpdatedAt } = usePoll<WaterLevelForecast | null>(
    () => api.waterLevelForecast(forecastSource).catch(() => null),
    FORECAST_POLL_MS,
    [forecastSource],
  );

  // Two sort orders coexist, both now incorporating the operator-alignment
  // nudge (bounded ±β=0.15) so the watchlist reflects the layer's learned
  // preferences — not just the base model output:
  //   · storm mode → sort by aligned_score (= risk_score + alignment_adjustment)
  //   · live  mode → sort by (preventative_priority + alignment_adjustment)
  // Both reduce to the base sort when the alignment layer is dormant.
  const preventative = useMemo(() => rankByPreventative(assets), [assets]);
  const preventativeByAssetId = useMemo(() => {
    const map = new Map<string, PreventativeScore>();
    for (const p of preventative) map.set(p.asset.asset_id, p.score);
    return map;
  }, [preventative]);

  const ranked = useMemo(() => {
    if (isLive) return preventative.map((p) => p.asset);
    // Storm mode: server already sorted /api/assets by aligned_score. Keep
    // that order — no client-side re-sort needed.
    return [...assets];
  }, [assets, isLive, preventative]);

  // Resolve which asset the cockpit is focused on. Falls back to the top-risk
  // asset when the store's focusedAssetId is null or no longer in the list.
  const focusAsset = useMemo(() => {
    if (focusedAssetId) {
      const hit = ranked.find((a) => a.asset_id === focusedAssetId);
      if (hit) return hit;
    }
    return ranked[0];
  }, [ranked, focusedAssetId]);

  const critical = ranked.filter((a) => a.risk_level === "critical").length;
  const high = ranked.filter((a) => a.risk_level === "high").length;
  const popAtRisk = useMemo(
    () =>
      ranked
        .filter((a) => a.risk_score >= 0.6)
        .reduce((acc, a) => acc + (a.service_population ?? 0), 0),
    [ranked],
  );
  // Preventative-priority stats for live mode — count how many assets sit
  // above each priority band.
  const preventativeCounts = useMemo(() => {
    let crit = 0;
    let hi = 0;
    for (const p of preventative) {
      if (p.score.priority >= 0.75) crit++;
      else if (p.score.priority >= 0.5) hi++;
    }
    return { crit, hi };
  }, [preventative]);

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="cockpit-page">
      {/* header + stats + timeline */}
      <section className="shrink-0 px-5 pt-3 pb-4">
        <div className="mb-3 flex flex-wrap items-end gap-5">
          {isLive ? (
            <LiveBaseline preventativeCandidateCount={preventativeCounts.crit + preventativeCounts.hi} />
          ) : (
            <Countdown />
          )}
          <div className="flex-1" />
          <div className="flex gap-6 pb-1.5">
            {isLive ? (
              <>
                <StatTile label="Preventative · critical" value={String(preventativeCounts.crit)} color="#e0245e" />
                <StatTile label="Preventative · high" value={String(preventativeCounts.hi)} color="#f2711c" />
                <StatTile
                  label="Pop. served"
                  value={fmtCompactNumber(popAtRisk)}
                  color="#c8ccd2"
                />
              </>
            ) : (
              <>
                <StatTile label="Critical" value={String(critical)} color="#e0245e" />
                <StatTile label="High" value={String(high)} color="#f2711c" />
                <StatTile label="Pop. at risk" value={fmtCompactNumber(popAtRisk)} color="#c8ccd2" />
              </>
            )}
          </div>
          <div className="pb-1.5">
            <ExplainPopover
              surface={isLive ? "live_baseline" : "timeline_spine"}
              align="right"
              diagnostic={
                isLive
                  ? `Baseline mode · rolling window −7d → +30d · ${LIVE_EVENTS.length} events`
                  : `Now = 0h · Landfall = +${LANDFALL_HOURS}h · window ${DEBBY_EVENTS.length} discrete events`
              }
            />
          </div>
        </div>
        {isLive ? (
          <TimelineSpine
            events={LIVE_EVENTS}
            spanHoursBefore={LIVE_SPAN_BEFORE}
            spanHoursAfter={LIVE_SPAN_AFTER}
            hourTicks={LIVE_HOUR_TICKS}
            disablePreNowShade
            formatTick={formatDayTick}
            ariaLabel="Rolling operational timeline"
          />
        ) : (
          <TimelineSpine events={DEBBY_EVENTS} landfallHours={LANDFALL_HOURS} />
        )}
      </section>

      {/* body */}
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden px-5 pb-5">
        <FocusLane
          asset={focusAsset}
          gov={gov}
          forecast={forecast}
          forecastUpdatedAt={forecastUpdatedAt}
          isLive={isLive}
          preventativeScore={focusAsset ? preventativeByAssetId.get(focusAsset.asset_id) ?? null : null}
          onDefer={() => deferToNext(ranked, focusAsset, setFocusedAsset)}
        />
        <Rail
          ranked={ranked}
          onFocus={(id) => setFocusedAsset(id)}
          onExpandMap={onExpandMap}
          isLive={isLive}
          preventativeByAssetId={preventativeByAssetId}
        />
      </div>
    </div>
  );
}

// ---- big pieces --------------------------------------------------------------

function Countdown() {
  return (
    <div>
      <div className="sgw-lbl">Projected landfall · SC/GA coast</div>
      <div className="mt-0.5 flex items-baseline gap-0.5">
        <span className="sgw-num text-[52px] font-light leading-[0.9] tracking-[-1px]">
          {COUNTDOWN_HOURS}
        </span>
        <span className="sgw-mono mx-2 my-0 ml-0.5 mr-2 text-[16px] text-[color:var(--color-subtle)]">
          h
        </span>
        <span className="sgw-num text-[52px] font-light leading-[0.9] tracking-[-1px]">
          {String(COUNTDOWN_MINUTES).padStart(2, "0")}
        </span>
        <span className="sgw-mono ml-0.5 text-[16px] text-[color:var(--color-subtle)]">m</span>
        <span className="sgw-lbl ml-3 text-[color:var(--color-signature)]">until landfall</span>
      </div>
    </div>
  );
}

function LiveBaseline({
  preventativeCandidateCount,
}: Readonly<{ preventativeCandidateCount: number }>) {
  return (
    <div>
      <div className="sgw-lbl">Baseline operational picture · SC / GA / NC</div>
      <div className="mt-0.5 flex items-baseline gap-3">
        <span
          className="sgw-num text-[42px] font-light leading-[0.95] tracking-[-0.5px] text-[color:var(--color-success)]"
          data-testid="live-baseline-title"
        >
          No active severe hazards
        </span>
        <span className="sgw-lbl text-[color:var(--color-subtle)]">
          · {preventativeCandidateCount} preventative candidates ranked
        </span>
      </div>
      <div className="mt-1 text-[11.5px] text-[color:var(--color-muted-foreground)]">
        Ranking assets by <span className="sgw-mono">P(failure) × consequence</span> — the maintenance-planner question.
      </div>
    </div>
  );
}

function StatTile({ label, value, color }: Readonly<{ label: string; value: string; color: string }>) {
  return (
    <div>
      <div className="sgw-lbl">{label}</div>
      <div className="sgw-num mt-px text-[22px] font-normal" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

// ---- focus lane -------------------------------------------------------------

function FocusLane({
  asset,
  gov,
  forecast,
  forecastUpdatedAt,
  isLive,
  preventativeScore,
  onDefer,
}: Readonly<{
  asset: AssetSummary | undefined;
  gov: ModelGovernance | null;
  forecast: WaterLevelForecast | null;
  forecastUpdatedAt: string | null;
  isLive: boolean;
  preventativeScore: PreventativeScore | null;
  onDefer: () => void;
}>) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [decided, setDecided] = useState<{ action: string; hash: string } | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const explanationCache = useRef<Map<string, Explanation>>(new Map());

  const assetId = asset?.asset_id;
  useEffect(() => {
    setDetail(null);
    setDecided(null);
    setDecideError(null);
    // Close the chat when the focused asset CHANGES, not on every asset
    // poll — the parent's ASSETS_POLL_MS refetch creates a new AssetSummary
    // object with the same asset_id, so we depend on asset_id (the actual
    // identity) rather than the object reference.
    setChatOpen(false);
    if (!assetId) return;
    api.asset(assetId).then(setDetail).catch(console.error);
    // Alignment adjustment now comes directly on the AssetSummary from
    // /api/assets — no separate fetch needed. The parent CockpitPage polls
    // /api/assets on the ASSETS_POLL_MS cadence, which is how the aligned
    // priority stays in sync after every retrain.
  }, [assetId]);

  // Only fetch the storm-response LLM recommendation in Debby replay mode.
  // In LIVE mode we render the preventative-maintenance fallback template
  // (see fallbackPreventativeRecommendation) — using the storm-flavoured LLM
  // output alongside a "No active severe hazards" headline would read as broken.
  useEffect(() => {
    if (!assetId || isLive) {
      setExplanation(null);
      setExplanationError(null);
      setExplanationLoading(false);
      return;
    }
    const cached = explanationCache.current.get(assetId);
    if (cached) {
      setExplanation(cached);
      setExplanationError(null);
      setExplanationLoading(false);
      return;
    }
    setExplanation(null);
    setExplanationError(null);
    setExplanationLoading(true);
    api
      .explanation(assetId)
      .then((res) => {
        explanationCache.current.set(assetId, res.explanation);
        setExplanation(res.explanation);
      })
      .catch((e) => setExplanationError(e instanceof Error ? e.message : String(e)))
      .finally(() => setExplanationLoading(false));
  }, [assetId, isLive]);

  if (!asset) {
    return (
      <div className="flex flex-1 items-center justify-center text-[color:var(--color-muted-foreground)]">
        Loading operational picture…
      </div>
    );
  }

  // In live mode the hero displays the preventative priority; in storm mode
  // it displays the hazard-conditional failure probability. Everything else
  // (crosswalk, forecast, cascade) is identical.
  const baseScore =
    isLive && preventativeScore ? preventativeScore.priority : asset.risk_score;
  // Operator-alignment nudge — comes directly on the AssetSummary now
  // (bounded ±β=0.15 server-side, zero when the layer is dormant). We clamp
  // the final display to [0, 1] so the hero never overflows the risk-level
  // colour ramp when a strongly-boosted asset ends up over 1.0.
  const alignmentDelta = asset.alignment_adjustment ?? 0;
  const alignPDefer = asset.alignment_p_defer ?? 0;
  const displayScore = Math.max(0, Math.min(1, baseScore + alignmentDelta));
  const displayLevel = riskLevelOf(displayScore);
  const scoreColor = riskColor(displayLevel);
  const meter = meterLevelFromProbability(displayScore, 0.05);
  // Real crosswalk from /api/assets/{id} — arrives on `detail` when the
  // parallel fetch completes. Empty until then, which is fine — the row
  // renders `asset_id · <IDs>` and just omits the IDs before detail arrives.
  const crosswalk = detail?.crosswalk ?? [];
  const modelDrivers = detail && gov
    ? buildDrivers(detail.features, gov.risk_model.top_features, 4)
    : [];
  // In live mode replace the model-derived drivers with the preventative
  // decomposition (failure prob + criticality + population + cluster).
  const drivers: DriverRow[] =
    isLive && preventativeScore
      ? preventativeScore.drivers.map((d) => ({
          key: d.key,
          label: d.label,
          valueStr: d.valueStr,
          contribution: d.weight,
          color: riskColor(riskLevelOf(d.weight * 2)), // amplify so single-driver bars still colour-code
        }))
      : modelDrivers;
  const modelVersion = gov?.risk_model.version ?? "lgbm-cal-v1";
  const cluster = asset.blast_radius_cluster;

  async function decide(action: "accept" | "override" | "defer"): Promise<boolean> {
    if (!asset) return false;
    setDecideError(null);
    try {
      const res = await api.decide({
        asset_id: asset.asset_id,
        action,
        reason:
          action === "override"
            ? "Operator override from cockpit."
            : action === "defer"
              ? "Operator deferred from cockpit."
              : undefined,
        base_score: baseScore,
        aligned_score: displayScore,
        alignment_adjustment: alignmentDelta,
      });
      setDecided({ action, hash: res.audit_hash });
      return true;
    } catch (e) {
      // Honest failure state — the platform's whole thesis is auditability, so
      // never fabricate a hash "for demo continuity". The operator MUST retry.
      const msg = e instanceof Error ? e.message : String(e);
      setDecideError(msg);
      return false;
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto pr-6">
      <SectionHeader label="Priority decision" trailing="1 of ranked flagged assets" />

      {/* hero row: identity + score */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="sgw-mono text-[11px] text-[color:var(--color-subtle)]">
            {asset.asset_id}
            <span className="text-[color:var(--color-faint)]">
              {" · "}
              {crosswalk
                .filter((x) => x.sys !== "FieldOps")
                .map((x) => x.id)
                .join(" · ")}
            </span>
          </div>
          <div
            className="mt-1 text-[30px] font-semibold leading-[1.05] tracking-[-0.4px]"
            data-testid="cockpit-hero-name"
          >
            {asset.asset_name}
          </div>
          <div className="mt-1 text-[13px] text-[color:var(--color-subtle)]">
            {prettyAssetType(asset.asset_type)} · {prettyRegion(asset.region)}
            {detail?.ground_elevation_ft != null && ` · ${detail.ground_elevation_ft.toFixed(1)} ft elevation`}
            {typeof detail?.features?.min_dist_to_surge_zone_m === "number" &&
              ` · ${((detail.features.min_dist_to_surge_zone_m as number) / 1000).toFixed(2)} km from surge zone`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="sgw-lbl">
              {isLive ? "Preventative priority" : "Failure prob · 72h"}
            </span>
            <ExplainPopover
              surface={isLive ? "preventative_priority" : "risk_score"}
              align="right"
              diagnostic={
                isLive && preventativeScore
                  ? `priority ${displayScore.toFixed(2)} = P(failure) ${preventativeScore.probability.toFixed(2)} × consequence ${preventativeScore.consequence.toFixed(2)}`
                  : `${asset.risk_score.toFixed(2)} (${asset.risk_level}) · ±0.05 nominal band`
              }
            />
          </div>
          <div className="mt-0.5 flex items-baseline justify-end gap-1.5">
            <span
              className="sgw-num text-[44px] font-light leading-[0.9]"
              style={{ color: scoreColor }}
              data-testid="cockpit-hero-score"
            >
              {displayScore.toFixed(2)}
            </span>
            {!isLive && (
              <span
                className="sgw-mono text-[13px] text-[color:var(--color-subtle)]"
                title="Nominal display band on the v2 regressor. Real per-prediction uncertainty (e.g. quantile regression) is Phase 2 — see docs/13_operator_alignment.md and the risk-score explainer popover."
              >
                ±.05 nom
              </span>
            )}
          </div>
          {Math.abs(alignmentDelta) >= 0.005 && (
            <AlignmentDeltaChip base={baseScore} delta={alignmentDelta} pDefer={alignPDefer} />
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <ConfidenceMeter level={meter} align="right" />
            <ExplainPopover
              surface="confidence_meter"
              align="right"
              diagnostic={`${meter} / 5 blocks lit`}
            />
          </div>
        </div>
      </div>

      {/* recommended action (LLM) */}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="sgw-lbl text-[color:var(--color-signature)]">Copilot recommendation</span>
          <ExplainPopover
            surface="copilot_recommendation"
            align="left"
            diagnostic={
              isLive
                ? "Preventative-maintenance recommendation (rule-based)"
                : explanation
                  ? `Cites ${explanation.evidence.length} evidence records`
                  : explanationLoading
                    ? "Generating…"
                    : "Awaiting first draft"
            }
          />
        </div>
        {/* LIVE mode → deterministic preventative recommendation from
            lib/priority.ts. Storm mode → LLM-drafted advisory. Keeping the
            two paths visually identical (same CopilotPullQuote) so the demo
            reads consistently across modes. */}
        {isLive && preventativeScore ? (
          <CopilotPullQuote
            recommendation={fallbackPreventativeRecommendation(asset, preventativeScore)}
            evidence={[]}
            modelLabel="preventative-priority engine · rule-based"
          />
        ) : (
          <>
            {explanationLoading && !explanation && (
              <div
                className="sgw-mono text-[11px] italic text-[color:var(--color-faint)]"
                aria-live="polite"
              >
                Generating recommendation with gpt-oss:120b…
              </div>
            )}
            {explanationError && !explanation && (
              <div className="text-[11px] text-[color:var(--color-critical)]">
                Copilot recommendation unavailable: {explanationError}
              </div>
            )}
            {explanation && (
              <CopilotPullQuote
                recommendation={explanation.recommended_action}
                evidence={explanation.evidence.slice(0, 4)}
              />
            )}
          </>
        )}
      </div>

      {/* drivers */}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="sgw-lbl">
            {isLive ? "Priority decomposition" : "Why it's #1 today"}
          </span>
          <ExplainPopover
            surface={isLive ? "preventative_priority" : "feature_drivers"}
            align="left"
            diagnostic={
              drivers.length
                ? `Top driver: ${drivers[0]?.label} (${drivers[0]?.valueStr})`
                : "Loading"
            }
          />
        </div>
        {drivers.length === 0 && (
          <div className="sgw-mono text-[11px] italic text-[color:var(--color-faint)]">
            Loading driver contributions…
          </div>
        )}
        {drivers.map((d) => (
          <DriverBar key={d.key} row={d} />
        ))}
      </div>

      {/* tide sparkline */}
      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="sgw-lbl">
              Charleston Harbor 8665530 · water level
              {forecast?.is_live ? " · LIVE" : forecast ? " · REPLAY" : ""}
            </span>
            <ExplainPopover
              surface="water_forecast"
              align="left"
              diagnostic={
                forecast
                  ? `${forecast.is_live ? "LIVE" : "REPLAY"} · ${forecast.history_points} history points${
                      forecastUpdatedAt ? " · updated " + fmtRelative(forecastUpdatedAt) : ""
                    }`
                  : "Forecast unavailable"
              }
            />
          </div>
          <span className="sgw-mono flex items-center gap-2 text-[10px] text-[color:var(--color-signature)]">
            {forecast && (
              <>
                <span title="80% nominal band · empirical held-out coverage 0.54 on Debby (see Governance). Anomalies use the rolling-median residual, independent of the band width.">
                  above 80% nominal band · Prophet-residual anomalies
                </span>
                {forecastUpdatedAt && (
                  <span
                    className="text-[color:var(--color-faint)]"
                    title={`Last poll: ${forecastUpdatedAt}`}
                  >
                    · updated {fmtRelative(forecastUpdatedAt)}
                  </span>
                )}
              </>
            )}
          </span>
        </div>
        <div className="rounded-md border border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] p-1">
          <WaterLevelChart forecast={forecast} compact height={120} />
        </div>
      </div>

      {/* Honest decision-failure banner. The audit chain is the whole trust
          story — if the POST fails we tell the operator, we don't fabricate
          a hash and pretend the write happened. */}
      {decideError && !decided && (
        <div
          className="mt-4 flex items-center gap-2.5 rounded-md border border-[color:var(--color-critical)] bg-[color:var(--color-critical)]/10 px-3 py-2 text-[12px] text-[color:var(--color-critical)]"
          role="alert"
          data-testid="cockpit-decide-error"
        >
          <span aria-hidden>⚠</span>
          <span>Decision was NOT written to the audit log — {decideError}. Please retry.</span>
        </div>
      )}

      {/* action bar */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-[color:var(--color-border)] pt-4.5">
        {decided ? (
          <div
            className="flex items-center gap-2.5 rounded-md border border-[#1c4a30] bg-[#0f2419] px-4.5 py-2.5 text-[14px] font-semibold text-[color:var(--color-success)]"
            data-testid="cockpit-decided"
          >
            <span aria-hidden>✓</span>
            <span>{decidedLabel(decided.action)}</span>
            <span className="sgw-mono text-[11px] font-normal opacity-80">{decided.hash.slice(0, 12)}</span>
          </div>
        ) : (
          <>
            <button
              onClick={() => decide("accept")}
              className="cursor-pointer rounded-md border-none bg-[color:var(--color-signature)] px-5 py-2.5 text-[14px] font-semibold text-[color:var(--color-signature-ink)]"
              data-testid="cockpit-accept"
            >
              {isLive ? "Accept & queue work order" : "Accept & task crew"}
            </button>
            <button
              onClick={() => decide("override")}
              className="cursor-pointer rounded-md border border-[color:var(--color-border)] bg-transparent px-4.5 py-2.5 text-[14px] font-medium text-[color:var(--color-muted-foreground)]"
              data-testid="cockpit-override"
            >
              Override
            </button>
            <button
              onClick={async () => {
                // Defer is a REAL training signal for the alignment layer, so
                // it must POST to /api/decisions before we refocus. If the
                // POST fails, we surface the error (see the alert banner
                // above) and DO NOT refocus — a decision that wasn't logged
                // is a decision that didn't happen.
                const ok = await decide("defer");
                if (ok) onDefer();
              }}
              className="cursor-pointer rounded-md border border-[color:var(--color-border)] bg-transparent px-4.5 py-2.5 text-[14px] text-[color:var(--color-subtle)]"
              data-testid="cockpit-defer"
            >
              {isLive ? "Defer to next candidate" : "Defer to #2"}
            </button>
            <button
              onClick={() => setChatOpen((v) => !v)}
              aria-expanded={chatOpen}
              aria-controls="cockpit-asset-chat"
              className={`cursor-pointer rounded-md border px-4 py-2.5 text-[13px] font-medium ${
                chatOpen
                  ? "border-[color:var(--color-signature)] bg-[color:var(--color-signature)]/10 text-[color:var(--color-signature)]"
                  : "border-[color:var(--color-border)] bg-transparent text-[color:var(--color-muted-foreground)]"
              }`}
              data-testid="cockpit-discuss"
            >
              {chatOpen ? "Close copilot chat ↓" : "Discuss with copilot ↑"}
            </button>
          </>
        )}
        <div className="flex-1" />
        <span className="sgw-mono text-[10px] text-[color:var(--color-faint)]">
          {modelVersion} · gpt-oss:120b{cluster !== null ? ` · ◆ cluster #${cluster}` : ""}
        </span>
      </div>

      {!decided && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[color:var(--color-faint)]">
          <span aria-hidden>↺</span>
          <span>
            Every decision trains the operator-alignment model — your Defer / Override
            reasons update how similar assets are prioritised next time.
          </span>
          <ExplainPopover surface="alignment_layer" align="left" diagnostic="Preference-learning loop" />
        </div>
      )}

      {chatOpen && (
        <div
          id="cockpit-asset-chat"
          className="mt-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-2)] p-3"
          data-testid="cockpit-asset-chat"
          style={{ height: 340 }}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="sgw-lbl text-[color:var(--color-signature)]">
              Asset copilot · {asset.asset_name}
            </div>
            <span className="sgw-mono text-[10px] text-[color:var(--color-faint)]">
              memory scoped to {asset.asset_id} · agent has tool access to model + cascade + alerts
            </span>
          </div>
          {/* Keying by asset_id forces a fresh conversation when focus changes so
              the agent's memory never bleeds across assets. */}
          <div className="h-[calc(100%-24px)]">
            <AgentChat key={asset.asset_id} assetId={asset.asset_id} />
          </div>
        </div>
      )}
    </div>
  );
}

function decidedLabel(action: string): string {
  if (action === "accept") return "Accepted · logged to audit";
  if (action === "override") return "Overridden · logged to audit";
  return "Recorded · logged to audit";
}

function DriverBar({ row }: Readonly<{ row: DriverRow }>) {
  const pct = Math.max(6, Math.abs(row.contribution) * 100);
  return (
    <div className="grid grid-cols-[200px_1fr_52px] items-center gap-3 border-t border-[color:var(--color-border-2)] py-[7px]">
      <span className="text-[13px] text-[color:var(--color-muted-foreground)]">{row.label}</span>
      <div className="h-1.5 overflow-hidden rounded-sm bg-[color:var(--color-panel-3)]">
        <div className="h-full" style={{ width: `${pct}%`, background: row.color }} />
      </div>
      <span className="sgw-mono text-right text-[11px]" style={{ color: row.color }}>
        {row.valueStr}
      </span>
    </div>
  );
}

// ---- rail --------------------------------------------------------------------

function Rail({
  ranked,
  onFocus,
  onExpandMap,
  isLive,
  preventativeByAssetId,
}: Readonly<{
  ranked: AssetSummary[];
  onFocus: (id: string) => void;
  onExpandMap: () => void;
  isLive: boolean;
  preventativeByAssetId: Map<string, PreventativeScore>;
}>) {
  return (
    <div className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-[color:var(--color-border)] pl-6">
      <SectionHeader
        label={isLive ? "Operational map" : "Live threat map"}
        explainSurface="mini_map"
        explainDiagnostic={
          isLive
            ? `${ranked.length} assets on map · no active hurricane cone`
            : `${ranked.length} assets on map · Debby forecast cone`
        }
        trailing={
          <button
            onClick={onExpandMap}
            className="sgw-mono cursor-pointer border-none bg-transparent text-[9.5px] tracking-[1px] text-[color:var(--color-signature)]"
            data-testid="cockpit-expand-map"
          >
            EXPAND ↗
          </button>
        }
      />
      <CockpitMiniMap assets={ranked} mode={isLive ? "live" : "storm"} />

      <div className="mt-4">
        <SectionHeader
          label={isLive ? "Watchlist · preventative priority" : "Watchlist · by risk"}
          explainSurface={isLive ? "preventative_priority" : "watchlist"}
          explainDiagnostic={`${Math.max(0, ranked.length - 1)} candidates behind the focused asset`}
        />
      </div>
      <div className="-mx-2 flex-1 overflow-y-auto" data-testid="cockpit-watchlist">
        {ranked.slice(1, 20).map((a, i) => {
          const prev = isLive ? preventativeByAssetId.get(a.asset_id) : null;
          const value = prev ? prev.priority : a.risk_score;
          const level = isLive ? riskLevelOf(value) : a.risk_level;
          const color = riskColor(level);
          return (
            <button
              key={a.asset_id}
              onClick={() => onFocus(a.asset_id)}
              aria-label={`Focus cockpit on ${a.asset_name} · score ${value.toFixed(2)}`}
              className="watch-row flex w-full cursor-pointer items-center gap-[11px] border-b border-[color:var(--color-border-3)] bg-transparent px-2 py-2.5 text-left"
            >
              <span className="sgw-mono sgw-num w-4 text-[11px] text-[color:var(--color-faint)]">
                {i + 2}
              </span>
              <div className="min-w-0 flex-1">
                <div className="wr-name truncate text-[12.5px] text-[color:var(--color-muted-foreground)]">
                  {a.asset_name}
                </div>
                <div className="sgw-mono mt-px text-[9px] text-[color:var(--color-faint)]">
                  {a.asset_id} · {prettyRegion(a.region)}
                </div>
              </div>
              <div className="h-1.5 w-11 overflow-hidden rounded-sm bg-[color:var(--color-panel-3)]">
                <div className="h-full" style={{ width: `${value * 100}%`, background: color }} />
              </div>
              <span
                className="sgw-mono sgw-num w-8 text-right text-[13px]"
                style={{ color }}
              >
                {value.toFixed(2)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- alignment delta chip ---------------------------------------------------

/** Renders next to the priority score when the operator-alignment layer has
 * applied a non-trivial nudge. The chip shows: base score → adjusted score,
 * with the P(defer) signal that produced it. */
function AlignmentDeltaChip({
  base,
  delta,
  pDefer,
}: Readonly<{ base: number; delta: number; pDefer: number | null }>) {
  const isBoost = delta > 0;
  const label = isBoost ? "aligned ↑" : "aligned ↓";
  const color = isBoost ? "#3fd47a" : "#f5a524";
  const arrow = `${base.toFixed(2)} → ${(base + delta).toFixed(2)}`;
  const pStr = pDefer != null ? `P(defer)=${pDefer.toFixed(2)}` : "";
  return (
    <div
      className="mt-1 flex items-center justify-end gap-1.5 text-[10px]"
      data-testid="cockpit-alignment-delta"
      title={`Operator-alignment layer moved the score ${delta > 0 ? "+" : ""}${delta.toFixed(3)} · ${pStr}`}
    >
      <span className="sgw-mono rounded px-1.5 py-[1px] text-[9px] font-bold tracking-[0.4px]" style={{ color, background: `${color}22` }}>
        {label}
      </span>
      <span className="sgw-mono text-[color:var(--color-subtle)]">
        {arrow} <span className="text-[color:var(--color-faint)]">({delta > 0 ? "+" : ""}{delta.toFixed(3)})</span>
      </span>
      <ExplainPopover surface="alignment_layer" align="right" diagnostic={pStr} />
    </div>
  );
}

// ---- small primitives -------------------------------------------------------

function SectionHeader({
  label,
  trailing,
  explainSurface,
  explainDiagnostic,
}: Readonly<{
  label: string;
  trailing?: React.ReactNode;
  /** Attach a ? explain button next to the label. */
  explainSurface?: SurfaceKey;
  /** Live diagnostic string forwarded into the explainer's Confidence section. */
  explainDiagnostic?: string;
}>) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="sgw-lbl text-[color:var(--color-signature)]">{label}</span>
      {explainSurface && (
        <ExplainPopover surface={explainSurface} align="left" diagnostic={explainDiagnostic} />
      )}
      <div className="h-px flex-1 bg-[color:var(--color-border)]" />
      {typeof trailing === "string" ? (
        <span className="sgw-mono text-[10px] text-[color:var(--color-faint)]">{trailing}</span>
      ) : (
        trailing
      )}
    </div>
  );
}

function fmtCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function deferToNext(
  ranked: AssetSummary[],
  current: AssetSummary | undefined,
  setFocus: (id: string | null) => void,
): void {
  if (!current) return;
  const idx = ranked.findIndex((a) => a.asset_id === current.asset_id);
  if (idx < 0 || idx >= ranked.length - 1) return;
  setFocus(ranked[idx + 1].asset_id);
}
