import { useEffect, useState } from "react";
import { alignmentApi, type AlignmentState } from "../lib/api";
import { fmtRelative } from "../lib/labels";
import { ExplainPopover } from "./ExplainPopover";

/*
  AlignmentBadge — surfaces the operator-alignment (preference-learning) layer
  in the header. Three visual states:

    · DORMANT  — model has fewer than min_samples decisions; nudge is zero.
    · TRAINED  — model is fitted; badge shows version + sample count.
    · TRAINING — a retrain is in-flight.

  Clicking the badge opens the explain popover so the operator can read
  what the layer does + which features it has learned to weight.
*/

const POLL_MS = 15_000;

export function AlignmentBadge() {
  const [state, setState] = useState<AlignmentState | null>(null);
  const [retraining, setRetraining] = useState(false);

  const fetchOnce = () => {
    alignmentApi
      .state()
      .then(setState)
      .catch(() => {
        /* silent — the badge just shows dormant if the endpoint is unreachable */
      });
  };

  useEffect(() => {
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const onRetrain = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (retraining) return;
    setRetraining(true);
    try {
      const next = await alignmentApi.retrain();
      setState(next);
    } catch {
      /* ignore */
    } finally {
      setRetraining(false);
    }
  };

  const fitted = state?.is_fitted ?? false;
  const report = state?.report;
  const label = retraining
    ? "TRAINING…"
    : fitted && report
      ? `ALIGN · ${report.version.slice(6)}`
      : "ALIGN · DORMANT";
  const trained = fitted && report;

  const diagnostic = state
    ? trained
      ? `${report.n_samples} samples · ${report.n_defers} defers · ${report.n_accepts} accepts · trained ${fmtRelative(report.trained_at)}`
      : `${state.n_decisions_seen}/${state.min_samples} decisions collected — model stays dormant until threshold`
    : "Alignment state unavailable";

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`inline-flex items-center gap-1.5 rounded border px-2 py-[3px] text-[10px] font-semibold tracking-[0.4px] ${
          trained
            ? "border-[color:var(--color-signature)]/40 bg-[color:var(--color-signature)]/10 text-[color:var(--color-signature)]"
            : "border-[color:var(--color-border)] bg-transparent text-[color:var(--color-muted-foreground)]"
        }`}
        title={diagnostic}
        data-testid="alignment-badge"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            trained ? "bg-[color:var(--color-signature)]" : "bg-[color:var(--color-faint)]"
          }`}
          aria-hidden
        />
        <span className="sgw-mono">{label}</span>
        {trained && (
          <span className="sgw-mono text-[9px] font-normal opacity-70">
            {report.n_samples}n
          </span>
        )}
        <ExplainPopover surface="alignment_layer" align="left" diagnostic={diagnostic} />
        <button
          onClick={onRetrain}
          disabled={retraining}
          title="Force a retrain against every operator decision on record"
          className="ml-0.5 cursor-pointer border-none bg-transparent text-[9px] text-[color:var(--color-subtle)] disabled:opacity-40"
          data-testid="alignment-retrain"
        >
          {retraining ? "…" : "↻"}
        </button>
      </div>
    </div>
  );
}
