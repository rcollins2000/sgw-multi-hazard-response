import { useEffect, useRef } from "react";
import { dataSourcesApi, type DataSource, type DataSourcesResponse } from "../lib/api";
import { fmtRelative } from "../lib/labels";
import { usePoll } from "../lib/usePoll";

/*
  DataSourcesPopover — the "everything powering the current view" panel.

  What it does differently from the v1 static popover:
    - Polls /api/data-sources every 15s so LIVE feeds show real freshness
      (last-poll ISO + relative time; the backend reports its own cadence
      so we don't hardcode "60s" in two places)
    - Groups by kind — LIVE / ARCHIVED / STATIC-REF / SYNTHETIC / TRAINED / PLANNED.
      Planned is rendered dimmed so the operator sees the honest roadmap.
    - The "current build-time count" text on the NWS/CO-OPS entries has been
      replaced with "last poll returned N rows" — the honest signal.
*/

const KIND_STYLES: Record<DataSource["kind"], { fg: string; bg: string; label: string }> = {
  live: { fg: "#3fd47a", bg: "#0f2419", label: "LIVE" },
  archived: { fg: "#c4b5fd", bg: "#1e123a", label: "ARCHIVED" },
  static_ref: { fg: "#7dd3fc", bg: "#0c2536", label: "STATIC REF" },
  synthetic: { fg: "#f5a524", bg: "#33280a", label: "SYNTHETIC" },
  trained: { fg: "#93c5fd", bg: "#082f49", label: "TRAINED" },
  planned: { fg: "#8b9199", bg: "#14171b", label: "PLANNED" },
};

const KIND_ORDER: DataSource["kind"][] = [
  "live",
  "archived",
  "static_ref",
  "trained",
  "synthetic",
  "planned",
];

export function DataSourcesPopover({ onClose }: Readonly<{ onClose: () => void }>) {
  const { data, error } = usePoll<DataSourcesResponse>(dataSourcesApi, 15_000);
  const sources = data?.sources ?? [];
  const grouped = KIND_ORDER.map((k) => ({ kind: k, items: sources.filter((s) => s.kind === k) }));
  const panelRef = useRef<HTMLDialogElement>(null);

  // Backdrop click + ESC dismissal wired at the document level so the DOM
  // stays semantically clean (no click-handler on a non-interactive div,
  // no e.stopPropagation() dance). Keyboard + pointer users get the same
  // dismissal behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && panelRef.current && !panelRef.current.contains(t)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[900] bg-black/60" aria-hidden>
      <dialog
        ref={panelRef}
        open
        aria-modal="true"
        aria-labelledby="data-sources-title"
        className="mx-auto mt-16 max-h-[85vh] max-w-[820px] overflow-y-auto rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-6 text-[color:var(--color-foreground)]"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="data-sources-title" className="text-[18px] font-bold">Data sources</h2>
            <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
              Every feed powering the current view — with provenance, kind, and (for live feeds)
              real poller freshness. Planned sources are on the roadmap but not yet integrated.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close data sources"
            className="cursor-pointer text-[color:var(--color-muted-foreground)]"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded border border-[color:var(--color-critical)] bg-[color:var(--color-critical)]/10 p-3 text-[12px] text-[color:var(--color-critical)]">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {grouped
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <KindGroup key={g.kind} kind={g.kind} items={g.items} />
            ))}
        </div>

        <p className="mt-4 border-t border-[color:var(--color-border-2)] pt-3 text-[10.5px] text-[color:var(--color-faint)]">
          Live feeds are polled by <span className="sgw-mono">sgw_platform.polling</span>. This panel
          itself polls <span className="sgw-mono">/api/data-sources</span> every 15s so the
          "updated N seconds ago" chips stay honest.
        </p>
      </dialog>
    </div>
  );
}

function KindGroup({
  kind,
  items,
}: Readonly<{ kind: DataSource["kind"]; items: DataSource[] }>) {
  const style = KIND_STYLES[kind];
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold"
          style={{ color: style.fg, background: style.bg }}
        >
          {style.label}
        </span>
        <span className="sgw-mono text-[10px] text-[color:var(--color-faint)]">
          {items.length} feed{items.length === 1 ? "" : "s"}
        </span>
        <div className="h-px flex-1 bg-[color:var(--color-border-2)]" />
      </div>
      <div className="space-y-2">
        {items.map((s) => (
          <SourceCard key={s.id} source={s} planned={kind === "planned"} />
        ))}
      </div>
    </div>
  );
}

function SourceCard({ source, planned }: Readonly<{ source: DataSource; planned: boolean }>) {
  return (
    <div
      className={`rounded border border-[color:var(--color-border-3)] bg-[color:var(--color-panel-3)] p-3 ${
        planned ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium">{source.label}</span>
        <span className="sgw-mono text-[10.5px] text-[color:var(--color-subtle)]">
          {source.provider}
        </span>
      </div>
      {source.cadence && (
        <div className="sgw-mono mt-1 text-[10px] text-[color:var(--color-subtle)]">
          cadence · {source.cadence}
        </div>
      )}
      <div className="mt-1.5 text-[11.5px] leading-[1.55] text-[color:var(--color-muted-foreground)]">
        {source.detail}
      </div>
      {source.freshness && <FreshnessRow freshness={source.freshness} />}
    </div>
  );
}

/**
 * Discrete health state derived from a poller's freshness struct. Named
 * explicitly (HEALTHY / STALE / PENDING / FAILED) so the state is
 * screen-reader legible and doesn't rely on colour alone.
 *
 *   healthy  — last poll succeeded within 2× the configured cadence
 *   stale    — last poll succeeded but the age exceeds 2× the cadence
 *   pending  — no successful poll yet AND no error (cold start)
 *   failed   — last cycle raised an error
 */
type HealthState = "healthy" | "stale" | "pending" | "failed";

function healthStateOf(f: NonNullable<DataSource["freshness"]>): HealthState {
  if (f.last_error) return "failed";
  if (!f.last_success) return "pending";
  const ageMs = Date.now() - new Date(f.last_success).getTime();
  const staleThresholdMs = Math.max(60_000, f.cadence_seconds * 1000 * 2);
  return ageMs > staleThresholdMs ? "stale" : "healthy";
}

const HEALTH_STYLES: Record<HealthState, { label: string; fg: string; bg: string }> = {
  healthy: { label: "HEALTHY", fg: "#3fd47a", bg: "#0f2419" },
  stale: { label: "STALE", fg: "#f5a524", bg: "#33280a" },
  pending: { label: "PENDING", fg: "#93c5fd", bg: "#082f49" },
  failed: { label: "FAILED", fg: "#fca5a5", bg: "#2a0f0f" },
};

function freshnessLabel(f: NonNullable<DataSource["freshness"]>): string {
  if (f.last_success) return `updated ${fmtRelative(f.last_success)}`;
  if (f.last_error) return "waiting after error";
  return "first poll pending";
}

function FreshnessRow({ freshness }: Readonly<{ freshness: NonNullable<DataSource["freshness"]> }>) {
  const state = healthStateOf(freshness);
  const style = HEALTH_STYLES[state];
  return (
    <output
      className="mt-2 flex flex-wrap items-center gap-2 border-t border-[color:var(--color-border-2)] pt-2 text-[10px]"
      aria-label={`Poller ${state}`}
    >
      <span
        className="sgw-mono rounded px-1.5 py-[1px] text-[9px] font-bold tracking-[0.4px]"
        style={{ color: style.fg, background: style.bg }}
      >
        {style.label}
      </span>
      <span className="sgw-mono text-[color:var(--color-muted-foreground)]">
        {freshnessLabel(freshness)}
      </span>
      <span className="sgw-mono text-[color:var(--color-faint)]">
        · {freshness.cycle_count} cycle{freshness.cycle_count === 1 ? "" : "s"} · last returned{" "}
        {freshness.last_row_count} row{freshness.last_row_count === 1 ? "" : "s"}
      </span>
      {freshness.last_error && (
        <span
          className="sgw-mono ml-1 text-[color:var(--color-critical)]"
          title={freshness.last_error}
        >
          · {truncate(freshness.last_error, 40)}
        </span>
      )}
    </output>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
