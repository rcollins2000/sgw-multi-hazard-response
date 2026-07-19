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

      <p className="mt-6 text-xs text-[color:var(--color-muted-foreground)]">
        Note: risk labels are synthesised from features for the fictional utility. Documented as such in the training report.
        Production replaces with real historical incident joins.
      </p>
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
