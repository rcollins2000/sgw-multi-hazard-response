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

/** Retained for backwards compatibility; new code should use `fmtLondonClock`. */
export function fmtUtcClock(d: Date = new Date()): string {
  return (
    String(d.getUTCHours()).padStart(2, "0") +
    ":" +
    String(d.getUTCMinutes()).padStart(2, "0") +
    ":" +
    String(d.getUTCSeconds()).padStart(2, "0")
  );
}

/** Wall-clock in Europe/London — GMT in winter, BST in summer, DST handled by
 *  Intl. Returned as HH:MM:SS. The suffix ("BST"/"GMT") is derived from
 *  `Intl.DateTimeFormat` so it never diverges from the actual offset. */
export function fmtLondonClock(d: Date = new Date()): { time: string; zone: "BST" | "GMT" } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const time = `${map.hour ?? "00"}:${map.minute ?? "00"}:${map.second ?? "00"}`;
  const zone = (map.timeZoneName === "BST" ? "BST" : "GMT") as "BST" | "GMT";
  return { time, zone };
}
