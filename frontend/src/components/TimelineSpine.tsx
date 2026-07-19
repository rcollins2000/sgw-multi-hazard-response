/*
  TimelineSpine — the signature horizontal timeline for the cockpit.

  Renders a 72-hour window (default -54h ... +18h) with:
    - hour ticks along the bottom edge
    - discrete event markers (advisory, surge warning, tide-band, crew go,
      WO lock, peak surge) positioned by hour offset
    - a "Landfall" vertical marker
    - a "Now" playhead with soft glow
    - a subtle pre-now amber shade to communicate the "already in it" band

  All positions are computed from `spanHoursBefore` and `spanHoursAfter`
  props so the same component can drive different scenarios or windows.
  The event list is pure data — no fixture is hardcoded here, callers pass
  the events they want to show.
*/

export type SpineEvent = {
  /** hours relative to NOW (negative = past, positive = future) */
  t: number;
  /** short label rendered under the dot */
  short: string;
  /** full title used in the tooltip / aria label */
  title: string;
  /** hex or css colour for the dot fill */
  color: string;
  /** "50%" for round, "1px" for square marker */
  shape?: "50%" | "1px";
};

type Props = Readonly<{
  events: SpineEvent[];
  /** Omit for LIVE mode where there's no landfall marker. */
  landfallHours?: number;
  spanHoursBefore?: number;
  spanHoursAfter?: number;
  hourTicks?: number[];
  /** When true, dim the pre-Now amber shading (LIVE mode has no active
   *  storm-response window to communicate). */
  disablePreNowShade?: boolean;
  /** Screen-reader label; defaults to "Landfall countdown timeline". */
  ariaLabel?: string;
  /** Formatter for hour-tick labels. Defaults to `-Nh` / `0` / `+Nh`. */
  formatTick?: (t: number) => string;
}>;

const DEFAULT_TICKS = [-54, -42, -30, -18, -6, 6, 18];

export function TimelineSpine({
  events,
  landfallHours,
  spanHoursBefore = 54,
  spanHoursAfter = 18,
  hourTicks = DEFAULT_TICKS,
  disablePreNowShade = false,
  ariaLabel = "Landfall countdown timeline",
  formatTick,
}: Props) {
  const span = spanHoursBefore + spanHoursAfter;
  const pct = (t: number) => ((t + spanHoursBefore) / span) * 100;
  const nowPct = pct(0);
  const landfallPct = landfallHours != null ? pct(landfallHours) : null;

  // Stagger overlapping event labels — if two events land within 8% of each
  // other, push the second row down. Iterative to handle small clusters.
  let prevPct = -99;
  let prevAlt = false;
  const eventsWithLayout = events.map((e) => {
    const p = pct(e.t);
    const alt = p - prevPct < 8 ? !prevAlt : false;
    prevAlt = alt;
    prevPct = p;
    return { ...e, pct: p, labelOffset: alt ? "15px" : "0px" };
  });

  return (
    <div
      className="relative h-[96px] border-y border-[color:var(--color-border)] bg-[linear-gradient(90deg,#0c0e11,#0e1013)]"
      role="figure"
      aria-label={ariaLabel}
      data-testid="timeline-spine"
    >
      {/* Amber shade for pre-now portion — "we're already in the response window".
         Disabled in LIVE mode where there is no active response window. */}
      {!disablePreNowShade && (
        <div
          className="absolute inset-y-0 left-0 bg-[color:var(--color-signature)]/[.04]"
          style={{ width: `${nowPct}%` }}
          aria-hidden
        />
      )}

      {/* Landfall marker (storm mode only) */}
      {landfallPct != null && (
        <>
          <div
            className="absolute inset-y-0 w-[1.5px] bg-[color:var(--color-critical)]"
            style={{ left: `${landfallPct}%` }}
            aria-hidden
          />
          <div
            className="absolute top-[5px] -translate-x-1/2"
            style={{ left: `${landfallPct}%` }}
          >
            <span className="sgw-lbl text-[color:var(--color-critical)]">Landfall</span>
          </div>
        </>
      )}

      {/* Now playhead */}
      <div
        className="absolute inset-y-0 w-[1.5px] bg-[color:var(--color-signature)] shadow-[0_0_10px_var(--color-signature)]"
        style={{ left: `${nowPct}%` }}
        aria-hidden
      />
      <div
        className="absolute top-[5px] -translate-x-1/2"
        style={{ left: `${nowPct}%` }}
      >
        <span className="sgw-lbl text-[color:var(--color-signature)]">Now</span>
      </div>

      {/* Event ticks */}
      {eventsWithLayout.map((e, i) => (
        <div
          key={`${e.short}-${i}`}
          title={e.title}
          aria-label={e.title}
          className="absolute top-[26px] flex -translate-x-1/2 cursor-default flex-col items-center gap-[3px]"
          style={{ left: `${e.pct}%` }}
        >
          <span
            className="h-[7px] w-[7px] border border-[color:var(--color-background)]"
            style={{
              background: e.color,
              borderRadius: e.shape ?? "50%",
            }}
          />
          <span
            className="sgw-mono whitespace-nowrap text-[8.5px] text-[color:var(--color-faint)]"
            style={{ marginTop: e.labelOffset }}
          >
            {e.short}
          </span>
        </div>
      ))}

      {/* Hour ticks along the bottom */}
      {hourTicks.map((t) => (
        <div
          key={t}
          className="absolute bottom-1 -translate-x-1/2"
          style={{ left: `${pct(t)}%` }}
        >
          <span className="sgw-mono text-[9px] text-[color:var(--color-faint)]">
            {(formatTick ?? formatHourTick)(t)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatHourTick(t: number): string {
  if (t === 0) return "0";
  if (t < 0) return `${t}h`;
  return `+${t}h`;
}

/** Optional formatter for live-mode timelines where units are days. */
export function formatDayTick(t: number): string {
  const days = Math.round(t / 24);
  if (days === 0) return "0";
  if (days < 0) return `${days}d`;
  return `+${days}d`;
}
