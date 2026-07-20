/*
  Frontend-only asset helpers.

  Per-asset SHAP-style attribution is not surfaced by the model layer yet —
  we blend the global feature importances (`/api/governance/model`) with
  per-asset feature values so the drivers list reads coherently. This is a
  *visual* attribution, clearly labelled as such in the UI.

  The source-system crosswalk (GIS / CMMS / SCADA / FieldOps IDs) used to be
  synthesised here by hashing the asset_id. It's now served from the real
  `asset_id_crosswalk` table on `AssetDetail.crosswalk` — the synthesised
  version has been deleted so we can't accidentally show fabricated IDs.
*/

export type Crosswalk = { sys: string; id: string }[];

// -------------- driver-row rendering shared between cockpit + drilldown ----

export type DriverRow = {
  key: string;
  label: string;
  valueStr: string;
  /** -1..1 signed magnitude — positive = pushes risk up */
  contribution: number;
  color: string;
};

type FeatureCfg = {
  label: string;
  fmt: (v: unknown) => string;
  /** returns -1..1, positive = adverse (raises risk) */
  adverse: (v: unknown) => number;
};

export const FEATURE_DISPLAY: Record<string, FeatureCfg> = {
  min_dist_to_surge_zone_m: {
    label: "Distance to surge zone",
    fmt: (v) => (typeof v === "number" ? `${(v / 1000).toFixed(2)}km` : "—"),
    adverse: (v) => (typeof v === "number" ? clamp((5000 - v) / 5000) : 0),
  },
  ground_elevation_ft: {
    label: "Ground elevation",
    fmt: (v) => (typeof v === "number" ? `${v.toFixed(1)}ft` : "—"),
    adverse: (v) => (typeof v === "number" ? clamp((10 - v) / 10) : 0),
  },
  recent_scada_warnings: {
    label: "SCADA residual anomaly",
    fmt: (v) => (v ? `${v} warn` : "0"),
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
    label: "Distance to flood zone",
    fmt: (v) => (typeof v === "number" ? `${(v / 1000).toFixed(2)}km` : "—"),
    adverse: (v) => (typeof v === "number" ? clamp((5000 - v) / 5000) : 0),
  },
  recent_high_severity_reports: {
    label: "High-severity reports",
    fmt: (v) => String(v ?? 0),
    adverse: (v) => (typeof v === "number" ? Math.min(1, v / 3) : 0),
  },
};

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/**
 * Build a small ordered list of drivers to display next to the calibrated
 * score. Global feature importances from `/api/governance/model` set the
 * ordering; per-asset feature values set the magnitude and sign.
 */
export function buildDrivers(
  features: Record<string, unknown>,
  topFeatures: Record<string, number>,
  max = 4,
): DriverRow[] {
  const orderedKeys = Object.entries(topFeatures)
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0]);
  const rows: DriverRow[] = [];
  for (const key of orderedKeys) {
    const cfg = FEATURE_DISPLAY[key];
    if (!cfg) continue;
    const raw = features[key];
    if (raw === undefined || raw === null) continue;
    const importance = topFeatures[key] ?? 0.1;
    const contribution = clamp(cfg.adverse(raw) * (0.5 + Math.min(1, importance * 2)));
    rows.push({
      key,
      label: cfg.label,
      valueStr: cfg.fmt(raw),
      contribution,
      color: contributionColor(contribution),
    });
    if (rows.length >= max) break;
  }
  return rows;
}

function contributionColor(c: number): string {
  const abs = Math.abs(c);
  if (c >= 0) {
    if (abs >= 0.75) return "#e0245e";
    if (abs >= 0.5) return "#f2711c";
    return "#f5a524";
  }
  return "#3fd47a";
}
