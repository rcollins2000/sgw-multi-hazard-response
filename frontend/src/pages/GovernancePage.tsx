import { useEffect, useState } from "react";
import {
  alignmentApi,
  api,
  type AlignmentState,
  type FairnessReport,
  type ModelGovernance,
} from "../lib/api";
import { fmtRelative, prettyRegion } from "../lib/labels";

export function GovernancePage() {
  const [gov, setGov] = useState<ModelGovernance | null>(null);
  const [fair, setFair] = useState<FairnessReport | null>(null);
  const [alignment, setAlignment] = useState<AlignmentState | null>(null);
  const [alignmentBusy, setAlignmentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.modelGovernance(), api.fairness()])
      .then(([g, f]) => {
        setGov(g);
        setFair(f);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    alignmentApi
      .state()
      .then(setAlignment)
      .catch(() => setAlignment(null));
  }, []);

  const retrainAlignment = async () => {
    setAlignmentBusy(true);
    try {
      const next = await alignmentApi.retrain();
      setAlignment(next);
    } finally {
      setAlignmentBusy(false);
    }
  };

  if (error) return <PageError message={error} />;
  if (!gov || !fair) return <PageLoading />;

  const topFeatures = Object.entries(gov.risk_model.top_features).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxImportance = topFeatures[0]?.[1] ?? 1;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader
        title="Governance"
        subtitle="Model risk, fairness auditing, and calibration monitoring for the risk-scoring pipeline."
      />

      <section className="mt-8 grid grid-cols-2 gap-4">
        <Card title="Risk model">
          <Kv k="Version" v={gov.risk_model.version} />
          {Object.entries(gov.risk_model.metrics).map(([k, v]) => (
            <Kv key={k} k={k} v={typeof v === "number" ? v.toFixed(3) : String(v)} />
          ))}
        </Card>
        <Card title="Dependency graph">
          <Kv k="Nodes" v={gov.graph.n_nodes ?? "—"} />
          <Kv k="Edges" v={gov.graph.n_edges ?? "—"} />
          <Kv k="Louvain clusters" v={gov.graph.n_clusters ?? "—"} />
          <Kv k="Modularity" v={gov.graph.modularity?.toFixed(3) ?? "—"} />
        </Card>
      </section>

      <section className="mt-6">
        <Card title="Top feature importances">
          <div className="space-y-2">
            {topFeatures.map(([name, value]) => (
              <div key={name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-mono">{name}</span>
                  <span className="tabular-nums opacity-70">{(value * 100).toFixed(1)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-[color:var(--color-muted)]">
                  <div
                    className="h-full bg-[color:var(--color-primary)]"
                    style={{ width: `${(value / maxImportance) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card title={`Regional fairness — grouped by ${fair.group_column}`}>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <Metric
              label="Demographic parity gap"
              value={fair.demographic_parity_gap.toFixed(3)}
              alert={fair.demographic_parity_gap > 0.2}
              hint="Gap in flagged-rate across groups (max − min). Target < 0.20."
            />
            <Metric
              label="Equal opportunity gap"
              value={Number.isFinite(fair.equal_opportunity_gap) ? fair.equal_opportunity_gap.toFixed(3) : "—"}
              alert={fair.equal_opportunity_gap > 0.2}
              hint="Gap in true-positive rate across groups. Target < 0.20."
            />
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-[color:var(--color-border)] text-xs uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
              <tr>
                <th className="pb-2 text-left">Group</th>
                <th className="pb-2 text-right">n</th>
                <th className="pb-2 text-right">Positive rate</th>
                <th className="pb-2 text-right">Base rate</th>
                <th className="pb-2 text-right">TPR</th>
              </tr>
            </thead>
            <tbody>
              {fair.per_group.map((g) => (
                <tr key={g.group} className="border-b border-[color:var(--color-border)] last:border-none">
                  <td className="py-2">{prettyRegion(g.group)}</td>
                  <td className="py-2 text-right tabular-nums">{g.n}</td>
                  <td className="py-2 text-right tabular-nums">{g.positive_rate.toFixed(3)}</td>
                  <td className="py-2 text-right tabular-nums">{g.base_rate.toFixed(3)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {Number.isFinite(g.tpr) ? g.tpr.toFixed(3) : "—"}
                  </td>
                </tr>
              ))}
              {fair.per_group.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-[color:var(--color-muted-foreground)]">
                    No group breakdown available — fairness auditor has not run against this dataset yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="mt-6">
        <Card
          title="Operator-alignment layer · preference learning"
        >
          <AlignmentSection state={alignment} busy={alignmentBusy} onRetrain={retrainAlignment} />
        </Card>
      </section>

      <p className="mt-6 text-xs text-[color:var(--color-muted-foreground)]">
        Note: risk labels are synthesised from features for the fictional utility. Documented as such in the training report.
        Production replaces with real historical incident joins.
      </p>
    </div>
  );
}

function AlignmentSection({
  state,
  busy,
  onRetrain,
}: Readonly<{
  state: AlignmentState | null;
  busy: boolean;
  onRetrain: () => void;
}>) {
  if (!state) {
    return (
      <div className="text-sm text-[color:var(--color-muted-foreground)]">
        Alignment endpoint unreachable — the layer is currently dormant.
      </div>
    );
  }
  const report = state.report;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kv k="Fitted" v={state.is_fitted ? "yes" : "no"} />
        <Kv k="β (max nudge)" v={state.beta.toFixed(2)} />
        <Kv k="Decisions seen" v={state.n_decisions_seen} />
        <Kv k="Trained at n" v={state.n_decisions_at_last_train} />
        {report && (
          <>
            <Kv k="Version" v={report.version} />
            <Kv k="Samples" v={`${report.n_samples} (${report.n_defers} defer · ${report.n_accepts} accept)`} />
            <Kv k="Fit score" v={report.fit_score.toFixed(2)} />
            <Kv k="Trained" v={fmtRelative(report.trained_at)} />
          </>
        )}
      </div>
      {report ? (
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
            Feature weights (StandardScaler space)
          </div>
          <div className="space-y-1.5">
            {Object.entries(report.feature_weights)
              .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
              .map(([name, w]) => {
                const positive = w >= 0;
                const magnitude = Math.min(1, Math.abs(w));
                return (
                  <div key={name} className="grid grid-cols-[240px_1fr_60px] items-center gap-2 text-xs">
                    <span className="font-mono text-[color:var(--color-muted-foreground)]">{name}</span>
                    <div className="relative h-1.5 overflow-hidden rounded bg-[color:var(--color-muted)]">
                      <div
                        className="absolute top-0 h-full"
                        style={{
                          left: positive ? "50%" : `${50 - magnitude * 50}%`,
                          width: `${magnitude * 50}%`,
                          background: positive ? "#f5a524" : "#3fd47a",
                        }}
                      />
                      <div className="absolute top-0 left-1/2 h-full w-px bg-[color:var(--color-border)]" />
                    </div>
                    <span className="font-mono tabular-nums text-right" style={{ color: positive ? "#f5a524" : "#3fd47a" }}>
                      {positive ? "+" : ""}
                      {w.toFixed(3)}
                    </span>
                  </div>
                );
              })}
          </div>
          <div className="mt-2 text-[11px] leading-[1.5] text-[color:var(--color-muted-foreground)]">
            Positive weight (amber) → higher feature value increases P(defer). Negative (green) → higher value increases P(accept).
            Weights are in StandardScaler-normalised space so magnitudes are directly comparable.
          </div>
        </div>
      ) : (
        <div className="text-sm text-[color:var(--color-muted-foreground)]">
          Model is dormant — waiting for at least {state.min_samples} operator decisions with distinct outcomes.
          {" "}Log a mix of Accepts and Defers on the cockpit and the layer will fit automatically.
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onRetrain}
          disabled={busy}
          className="cursor-pointer rounded border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          data-testid="alignment-retrain-governance"
        >
          {busy ? "Retraining…" : "Force retrain"}
        </button>
        <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
          Reads every operator_* audit row, joins to STATE.features by asset_id, fits sklearn LogisticRegression.
        </span>
      </div>
    </div>
  );
}

function Card({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30 p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function Kv({ k, v }: Readonly<{ k: string; v: React.ReactNode }>) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-[color:var(--color-muted-foreground)]">{k}</span>
      <span className="text-right font-mono text-xs">{v}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  alert,
  hint,
}: Readonly<{ label: string; value: string; alert: boolean; hint: string }>) {
  return (
    <div className="rounded border border-[color:var(--color-border)] p-3">
      <div className="text-xs text-[color:var(--color-muted-foreground)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${alert ? "text-[color:var(--color-critical)]" : "text-[color:var(--color-success)]"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{hint}</div>
    </div>
  );
}

function PageHeader({ title, subtitle }: Readonly<{ title: string; subtitle: string }>) {
  return (
    <div>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-1 text-[color:var(--color-muted-foreground)]">{subtitle}</p>
    </div>
  );
}

function PageLoading() {
  return <div className="p-8 text-[color:var(--color-muted-foreground)]">Loading…</div>;
}

function PageError({ message }: Readonly<{ message: string }>) {
  return <div className="p-8 text-[color:var(--color-critical)]">{message}</div>;
}
