import { riskColor } from "../lib/labels";

const BG: Record<string, string> = {
  critical: "#3f0d1e",
  high: "#3a1c0a",
  moderate: "#33280a",
  low: "#1e293b",
};

export function RiskBadge({ level, score }: Readonly<{ level: string; score?: number }>) {
  const color = riskColor(level);
  const bg = BG[level] ?? BG.low;
  return (
    <span
      className="sgw-num inline-flex items-center gap-1.5 rounded-[5px] border px-1.5 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.4px]"
      style={{ borderColor: `${color}88`, background: bg, color }}
    >
      <span>{level}</span>
      {score !== undefined && <span className="opacity-80">{score.toFixed(2)}</span>}
    </span>
  );
}
