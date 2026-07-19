import type { AssetSummary } from "./api";

/*
  Preventative-priority score for live mode.

  In DEBBY 2024 REPLAY mode the platform ranks assets by hazard-conditional
  failure probability — a hurricane is imminent, the operator's job is
  storm response. In LIVE NWS mode there is (usually) no active severe
  hazard, so ranking by raw risk_score alone hides the "which of these
  should we actually improve?" question that maintenance planners live in.

  The preventative score answers that question with a bounded, explainable
  combination:

      preventative_priority = 0.55 · P(failure)  +  0.45 · consequence

  where the *consequence* term is the operator-visible impact if the asset
  did fail — bigger blast-radius clusters + higher criticality + larger
  service population all raise it. Everything is normalised to [0, 1] so the
  final score can be colour-mapped with the same risk ramp used everywhere
  else in the app. This is a demo-time proxy; a production version would
  swap in the model-registered consequence estimator.

  IMPORTANT: this is derived on the frontend from what /api/assets already
  serves. It does NOT invent risk — the failure probability is verbatim
  from the calibrated LightGBM output. Only the consequence weighting is
  new, and it's explicitly labelled as such in the ExplainPopover copy.
*/

const WEIGHT_PROB = 0.55;
const WEIGHT_CONSEQUENCE = 0.45;

// Service-population reference for log-scaling. Assets below this population
// contribute proportionally less; assets above saturate softly.
const POP_REFERENCE = 100_000;

// Cluster-size reference — Louvain clusters larger than this saturate.
const CLUSTER_SIZE_REFERENCE = 12;

export type PreventativeScore = {
  priority: number; // 0..1
  probability: number; // 0..1 (the raw failure probability)
  consequence: number; // 0..1 (the derived consequence component)
  drivers: PreventativeDriver[];
};

export type PreventativeDriver = {
  key: string;
  label: string;
  valueStr: string;
  weight: number; // 0..1 relative contribution to the priority score
};

/**
 * Cluster sizes come from the ranked list itself — count assets by
 * `blast_radius_cluster` and cache. This is cheap for the demo footprint
 * (~200 assets) and avoids a backend round-trip for a UI-only ranking.
 */
export function computeClusterSizes(assets: AssetSummary[]): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const a of assets) {
    if (a.blast_radius_cluster == null) continue;
    sizes.set(a.blast_radius_cluster, (sizes.get(a.blast_radius_cluster) ?? 0) + 1);
  }
  return sizes;
}

export function computePreventativeScore(
  asset: AssetSummary,
  clusterSizes: Map<number, number>,
): PreventativeScore {
  const probability = clamp01(asset.risk_score);

  const criticalityScore = clamp01((asset.criticality_rating - 1) / 4);
  const populationScore = asset.service_population
    ? clamp01(Math.log10(1 + asset.service_population) / Math.log10(1 + POP_REFERENCE))
    : 0.1;
  const clusterScore = asset.blast_radius_cluster != null
    ? clamp01((clusterSizes.get(asset.blast_radius_cluster) ?? 1) / CLUSTER_SIZE_REFERENCE)
    : 0.15;

  const consequence = clamp01(
    0.45 * criticalityScore + 0.35 * populationScore + 0.2 * clusterScore,
  );

  const priority = clamp01(WEIGHT_PROB * probability + WEIGHT_CONSEQUENCE * consequence);

  const drivers: PreventativeDriver[] = [
    {
      key: "probability",
      label: "Failure probability",
      valueStr: probability.toFixed(2),
      weight: WEIGHT_PROB * probability,
    },
    {
      key: "criticality",
      label: "Criticality rating",
      valueStr: `${asset.criticality_rating} / 5`,
      weight: WEIGHT_CONSEQUENCE * 0.45 * criticalityScore,
    },
    {
      key: "population",
      label: "Service population",
      valueStr: asset.service_population?.toLocaleString() ?? "—",
      weight: WEIGHT_CONSEQUENCE * 0.35 * populationScore,
    },
    {
      key: "cluster",
      label: "Blast-radius cluster size",
      valueStr:
        asset.blast_radius_cluster != null
          ? `${clusterSizes.get(asset.blast_radius_cluster) ?? 1} assets · #${asset.blast_radius_cluster}`
          : "—",
      weight: WEIGHT_CONSEQUENCE * 0.2 * clusterScore,
    },
  ];
  // Normalise the driver weights so they sum to the priority — makes the bar
  // widths add up in the UI without extra scaling gymnastics.
  const total = drivers.reduce((a, d) => a + d.weight, 0) || 1;
  for (const d of drivers) d.weight = d.weight / total;

  return { priority, probability, consequence, drivers };
}

/**
 * Rank a set of assets by preventative priority. Returns a sorted copy
 * paired with each asset's score, so callers can drive lists + charts
 * from one array.
 */
export function rankByPreventative(
  assets: AssetSummary[],
): { asset: AssetSummary; score: PreventativeScore }[] {
  const sizes = computeClusterSizes(assets);
  return assets
    .map((asset) => ({ asset, score: computePreventativeScore(asset, sizes) }))
    .sort((a, b) => b.score.priority - a.score.priority);
}

/**
 * Client-side sentence template used when the backend hasn't returned an
 * LLM recommendation for a preventative candidate yet. Keeps the pull-quote
 * populated during first paint. The real LLM output (when it arrives via
 * /api/assets/{id}/explanation) still overwrites this.
 */
export function fallbackPreventativeRecommendation(
  asset: AssetSummary,
  score: PreventativeScore,
): string {
  const p = (score.probability * 100).toFixed(0);
  const c = (score.consequence * 100).toFixed(0);
  return (
    `Prioritise a preventative work order for ${asset.asset_name} — ` +
    `combined failure probability (${p}%) × consequence (${c}%) ranks highest ` +
    `across the SGW footprint. Confirm the pre-conditions with the maintenance planner ` +
    `before dispatching a crew.`
  );
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
