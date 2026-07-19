export const REGION_LABEL: Record<string, string> = {
  COAST_EAST: "Coastal East (SC)",
  LOWER_DELTA: "Lower Delta (GA)",
  INLAND_NORTH: "Inland North (NC)",
};

export function prettyRegion(code: string): string {
  return REGION_LABEL[code] ?? code;
}

export function prettyAssetType(t: string): string {
  return t
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Colourblind-safe amber → rose ramp (matches the design bundle).
export const RISK_COLOR: Record<string, string> = {
  critical: "#e0245e",
  high: "#f2711c",
  moderate: "#f5a524",
  low: "#64748b",
};

export function riskColor(level: string): string {
  return RISK_COLOR[level] ?? RISK_COLOR.low;
}

export function riskLevelOf(score: number): "critical" | "high" | "moderate" | "low" {
  if (score >= 0.75) return "critical";
  if (score >= 0.5) return "high";
  if (score >= 0.3) return "moderate";
  return "low";
}

export function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const ms = Date.now() - then;
  if (ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h ${mm}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtUtcClock(d: Date = new Date()): string {
  return (
    String(d.getUTCHours()).padStart(2, "0") +
    ":" +
    String(d.getUTCMinutes()).padStart(2, "0") +
    ":" +
    String(d.getUTCSeconds()).padStart(2, "0")
  );
}
