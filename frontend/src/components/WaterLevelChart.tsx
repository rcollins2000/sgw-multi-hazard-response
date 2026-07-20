import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WaterLevelForecast } from "../lib/api";

// Recharts point payload for the composed chart. `null` gaps hide the series
// for time buckets where that value doesn't exist (observed only spans history).
type ChartPoint = {
  t: number;
  label: string;
  observed: number | null;
  yhat: number | null;
  band: [number, number] | null;
  anomaly: number | null;
  /** Only populated in DEBBY/IDALIA replay mode: what the water level ACTUALLY
   *  did during the forecast window, so the reader can see the surge exceed
   *  the model's forecast in the same view. */
  actual: number | null;
};

export function WaterLevelChart({
  forecast,
  compact = false,
  height,
}: Readonly<{ forecast: WaterLevelForecast | null; compact?: boolean; height?: number }>) {
  const h = height ?? (compact ? 120 : 220);
  if (!forecast) {
    return (
      <div
        className="flex items-center justify-center text-[11px] italic text-[color:var(--color-muted-foreground)]"
        style={{ height: h }}
      >
        Forecast unavailable — start the Prophet model on the Charleston Harbor gauge to populate this chart.
      </div>
    );
  }

  const data = buildChartData(forecast);
  const nowT = data.find((d) => d.observed === null)?.t ?? 0;

  return (
    <div>
      {!compact && (
        <div className="mb-1 flex flex-wrap gap-3 text-[9.5px] text-[color:var(--color-muted-foreground)]">
          <LegendPill color="#38bdf8">Observed</LegendPill>
          <LegendPill color="#94a3b8" dashed>
            Forecast
          </LegendPill>
          <LegendPill color="#94a3b833" filled>
            80% band
          </LegendPill>
          {forecast.actual_continuation.length > 0 && (
            <LegendPill color="#e0245e">Actual (replay)</LegendPill>
          )}
          <LegendPill color="#f5a524" dot>
            Anomaly
          </LegendPill>
        </div>
      )}
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart
          data={data}
          margin={compact ? { top: 4, right: 4, bottom: 0, left: 0 } : { top: 8, right: 8, bottom: 4, left: 4 }}
        >
          {!compact && <CartesianGrid stroke="#1a1a1d" vertical={false} />}
          <XAxis
            dataKey="label"
            interval="preserveStartEnd"
            hide={compact}
            tick={{ fill: "#525252", fontSize: 9, fontFamily: "ui-monospace, monospace" }}
            axisLine={{ stroke: "#1a1a1d" }}
            tickLine={{ stroke: "#1a1a1d" }}
          />
          <YAxis
            width={compact ? 0 : 38}
            hide={compact}
            tick={{ fill: "#525252", fontSize: 9, fontFamily: "ui-monospace, monospace" }}
            axisLine={{ stroke: "#1a1a1d" }}
            tickLine={{ stroke: "#1a1a1d" }}
            tickFormatter={(v: number) => `${v.toFixed(1)}ft`}
          />
          <Tooltip
            contentStyle={{
              background: "#0d0d10",
              border: "1px solid #262626",
              borderRadius: 6,
              fontSize: 11,
            }}
            labelStyle={{ color: "#e5e5e5" }}
            itemStyle={{ color: "#cbd5e1" }}
          />
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill="#94a3b8"
            fillOpacity={0.18}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="yhat"
            stroke="#94a3b8"
            strokeWidth={1.6}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="observed"
            stroke="#38bdf8"
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          {/* Actual continuation (DEBBY/IDALIA replay only) — solid rose
              line that overlays the forecast segment. In LIVE mode every
              point on this series is null and Recharts renders nothing. */}
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#e0245e"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Scatter dataKey="anomaly" fill="#f5a524" shape="circle" />
          <ReferenceLine
            x={data.find((d) => d.t === nowT)?.label}
            stroke="#f5a524"
            strokeDasharray="3 3"
            label={compact ? undefined : { value: "NOW", fill: "#f5a524", fontSize: 9, position: "top" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {!compact && (
        <div className="mt-1 text-[10px] leading-[1.45] text-[color:var(--color-muted-foreground)]">
          Observed points falling outside the 80% forecast band are flagged as{" "}
          <span className="font-semibold text-[color:var(--color-anomaly)]">Prophet-residual anomalies</span> and drive the SCADA-side risk uplift.
        </div>
      )}
    </div>
  );
}

function buildChartData(forecast: WaterLevelForecast): ChartPoint[] {
  // Observed history is left un-banded — the band only exists on the forecast
  // segment where Prophet emits {yhat_lower, yhat_upper}. Anomalies are the
  // top-K points (default 4) whose residual against a rolling-median trend
  // is largest — this stops a whole storm-surge history looking like one
  // giant anomaly.
  const history = forecast.history_tail;
  const fc = forecast.forecast;

  // Rolling median with a 12-point window ≈ 1h at 6-min cadence. Robust to
  // spikes; the residual is what we score for outlier ranking.
  const residuals = rollingResiduals(history.map((p) => p.y), 12);
  const topK = Math.min(4, history.length);
  const anomalyIdx = new Set<number>();
  if (topK > 0) {
    const ranked = residuals
      .map((r, i) => ({ i, r: Math.abs(r) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, topK)
      // Suppress trivially small residuals — no point flagging noise as an
      // anomaly if the whole window is quiet.
      .filter((x) => x.r > 0.25);
    for (const x of ranked) anomalyIdx.add(x.i);
  }

  // Actual-continuation lookup keyed by minute so we can align it with the
  // forecast rows even when the sample cadences differ (forecast is hourly,
  // actual is sampled at ~30-min from the fixture).
  const actualByMinute = new Map<number, number>();
  for (const p of forecast.actual_continuation) {
    const t = new Date(p.ds).getTime();
    const bucket = Math.round(t / (60 * 1000));
    actualByMinute.set(bucket, p.y);
  }
  const nearestActual = (dsIso: string): number | null => {
    const bucket = Math.round(new Date(dsIso).getTime() / (60 * 1000));
    // ±60 min tolerance so the ~30-min-sampled actual lines up with hourly fc
    for (let d = 0; d <= 60; d++) {
      if (actualByMinute.has(bucket + d)) return actualByMinute.get(bucket + d)!;
      if (actualByMinute.has(bucket - d)) return actualByMinute.get(bucket - d)!;
    }
    return null;
  };

  const points: ChartPoint[] = [];
  let idx = 0;
  for (let i = 0; i < history.length; i++) {
    const p = history[i];
    const label = new Date(p.ds).toISOString().slice(11, 16);
    points.push({
      t: idx++,
      label,
      observed: p.y,
      yhat: null,
      band: null,
      anomaly: anomalyIdx.has(i) ? p.y : null,
      actual: null,
    });
  }
  for (const p of fc) {
    const label = new Date(p.ds).toISOString().slice(11, 16);
    points.push({
      t: idx++,
      label,
      observed: null,
      yhat: p.yhat,
      band: [p.yhat_lower, p.yhat_upper],
      anomaly: null,
      actual: nearestActual(p.ds),
    });
  }
  return points;
}

function rollingResiduals(ys: number[], window: number): number[] {
  const out = new Array<number>(ys.length).fill(0);
  const half = Math.floor(window / 2);
  for (let i = 0; i < ys.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(ys.length, i + half + 1);
    const slice = ys.slice(lo, hi).sort((a, b) => a - b);
    const median = slice[Math.floor(slice.length / 2)];
    out[i] = ys[i] - median;
  }
  return out;
}

function LegendPill({
  color,
  children,
  dashed,
  filled,
  dot,
}: Readonly<{
  color: string;
  children: React.ReactNode;
  dashed?: boolean;
  filled?: boolean;
  dot?: boolean;
}>) {
  return (
    <span className="flex items-center gap-1">
      {dot ? (
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      ) : filled ? (
        <span className="inline-block h-2 w-2.5" style={{ background: color }} />
      ) : (
        <span
          className="inline-block w-2.5"
          style={{
            height: 2,
            background: dashed ? undefined : color,
            borderTop: dashed ? `2px dashed ${color}` : undefined,
          }}
        />
      )}
      <span>{children}</span>
    </span>
  );
}
