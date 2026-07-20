import { useEffect, useState } from "react";
import { api, type AssetSummary, type Briefing } from "../lib/api";

const REGION_ORDER: { key: string; label: string; hazard: string; hazBadge: { color: string; bg: string } }[] = [
  { key: "COAST_EAST", label: "Coastal East (SC)", hazard: "Surge + coastal flood", hazBadge: { color: "#38bdf8", bg: "#082f49" } },
  { key: "LOWER_DELTA", label: "Lower Delta (GA)", hazard: "Coastal flood", hazBadge: { color: "#38bdf8", bg: "#082f49" } },
  { key: "INLAND_NORTH", label: "Inland North (NC)", hazard: "Heat / wind", hazBadge: { color: "#f5a524", bg: "#33280a" } },
];

export function BriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.assets({ limit: 500 }).then(setAssets).catch(console.error);
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    setSentHash(null);
    setSendError(null);
    try {
      const b = await api.generateBriefing();
      setBriefing(b);
      setDraft(b.briefing.situation_summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!briefing || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.sendBriefing({
        briefing_hash: briefing.audit.current_hash,
        edited_summary: draft,
      });
      setSentHash(res.audit_hash);
    } catch (e) {
      // Honest failure — never fabricate the audit hash. Operator must retry.
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const regionAgg = REGION_ORDER.map((r) => {
    const inRegion = assets.filter((a) => a.region === r.key);
    return {
      ...r,
      critical: inRegion.filter((a) => a.risk_level === "critical").length,
      high: inRegion.filter((a) => a.risk_level === "high").length,
      water: inRegion.filter((a) => a.utility_domain === "Water").length,
      electric: inRegion.filter((a) => a.utility_domain === "Electric").length,
      waste: inRegion.filter((a) => a.utility_domain === "Wastewater").length,
    };
  });

  const totals = {
    critical: regionAgg.reduce((a, r) => a + r.critical, 0),
    high: regionAgg.reduce((a, r) => a + r.high, 0),
    water: regionAgg.reduce((a, r) => a + r.water, 0),
    electric: regionAgg.reduce((a, r) => a + r.electric, 0),
    waste: regionAgg.reduce((a, r) => a + r.waste, 0),
  };

  const populationAtRisk = assets
    .filter((a) => a.risk_score >= 0.6)
    .reduce((acc, a) => acc + (a.service_population ?? 0), 0);

  // Customer-hours at risk = sum(service_population × failure_prob) × 24h.
  // Real computation from `/api/assets` rather than a stage-managed literal.
  // 24h is a conservative outage-duration assumption; production would
  // replace it with the operator's true SLA target per asset class.
  const customerHoursAtRisk = assets.reduce(
    (acc, a) => acc + (a.service_population ?? 0) * a.risk_score * 24,
    0,
  );
  const formatBigNumber = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(Math.round(n));
  };

  const kpis = [
    {
      label: "Customer-hours at risk",
      value: assets.length > 0 ? formatBigNumber(customerHoursAtRisk) : "—",
      sub: "Σ(pop × P(fail)) × 24h",
      color: "#e0245e",
    },
    { label: "Population at risk", value: populationAtRisk.toLocaleString(), sub: "affected service area", color: "#f5a524" },
    { label: "Critical + high assets", value: `${totals.critical + totals.high}`, sub: "region-wide", color: "#93c5fd" },
    { label: "Active alerts", value: `${briefing?.snapshot.active_alerts ?? 0}`, sub: "in current window", color: "#fafafa" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold">Executive briefing</h1>
            <p className="mt-1 max-w-[640px] text-[12.5px] leading-[1.5] text-[color:var(--color-muted-foreground)]">
              Regional roll-up for leadership, drafted from the live operational picture. Every figure below traces to
              a cited aggregate.
            </p>
          </div>
          <span className="sgw-mono whitespace-nowrap text-[10px] text-[color:var(--color-faint)]">
            BRIEF-{new Date().toISOString().slice(0, 10).replace(/-/g, "")}-01
          </span>
        </div>

        {!briefing && (
          <button
            onClick={generate}
            disabled={busy}
            className="mt-6 cursor-pointer rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-primary-foreground)] disabled:opacity-50"
          >
            {busy ? "Generating with gpt-oss:120b…" : "Generate briefing (gpt-oss:120b)"}
          </button>
        )}
        {error && (
          <div className="mt-4 rounded border border-[color:var(--color-critical)] bg-[color:var(--color-critical)]/10 p-3 text-[12px] text-[color:var(--color-critical)]">
            Briefing generation failed: {error}
          </div>
        )}

        {/* KPI tiles */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-3.5">
              <div className="text-[10.5px] text-[color:var(--color-subtle)]">{k.label}</div>
              <div className="sgw-num mt-1 text-[26px] font-bold" style={{ color: k.color }}>
                {k.value}
              </div>
              <div className="mt-0.5 text-[10px] text-[color:var(--color-faint)]">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Regional aggregate table */}
        <div className="mt-4 overflow-hidden rounded-lg border border-[color:var(--color-border)]">
          <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] px-3.5 py-2.5 text-[10px] font-medium uppercase tracking-[0.6px] text-[color:var(--color-subtle)]">
            Assets at risk by region, domain &amp; dominant hazard
          </div>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#0e0e11] text-[9.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
                <th className="px-3.5 py-2 text-left">Region</th>
                <th className="px-2 py-2 text-right">Critical</th>
                <th className="px-2 py-2 text-right">High</th>
                <th className="px-2 py-2 text-right">Water</th>
                <th className="px-2 py-2 text-right">Electric</th>
                <th className="px-2 py-2 text-right">Wastewater</th>
                <th className="px-3.5 py-2 text-left">Dominant hazard</th>
              </tr>
            </thead>
            <tbody>
              {regionAgg.map((r) => (
                <tr key={r.key} className="border-t border-[color:var(--color-border-3)]">
                  <td className="px-3.5 py-2.5 text-[#ededed]">{r.label}</td>
                  <td className="sgw-num px-2 py-2.5 text-right" style={{ color: "#e0245e" }}>
                    {r.critical}
                  </td>
                  <td className="sgw-num px-2 py-2.5 text-right" style={{ color: "#f2711c" }}>
                    {r.high}
                  </td>
                  <td className="sgw-num px-2 py-2.5 text-right">{r.water}</td>
                  <td className="sgw-num px-2 py-2.5 text-right">{r.electric}</td>
                  <td className="sgw-num px-2 py-2.5 text-right">{r.waste}</td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className="inline-block rounded border px-1.5 py-[1px] text-[10px] font-semibold"
                      style={{ borderColor: `${r.hazBadge.color}77`, background: r.hazBadge.bg, color: r.hazBadge.color }}
                    >
                      {r.hazard}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-[color:var(--color-border)] bg-[#0e0e11] font-bold">
                <td className="px-3.5 py-2.5">Total</td>
                <td className="sgw-num px-2 py-2.5 text-right" style={{ color: "#e0245e" }}>
                  {totals.critical}
                </td>
                <td className="sgw-num px-2 py-2.5 text-right" style={{ color: "#f2711c" }}>
                  {totals.high}
                </td>
                <td className="sgw-num px-2 py-2.5 text-right">{totals.water}</td>
                <td className="sgw-num px-2 py-2.5 text-right">{totals.electric}</td>
                <td className="sgw-num px-2 py-2.5 text-right">{totals.waste}</td>
                <td className="px-3.5 py-2.5 text-[11px] font-normal text-[color:var(--color-subtle)]">
                  Surge + coastal flood dominant
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* LLM draft */}
        {briefing && (
          <div className="mt-4 overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)]">
            <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded border border-[color:var(--color-storm-border)] bg-[color:var(--color-storm-bg)] px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.6px] text-[#c4b5fd]">
                  Copilot draft
                </span>
                <span className="sgw-mono text-[10px] text-[color:var(--color-subtle)]">
                  gpt-oss:120b · schema-validated
                </span>
              </div>
              <button
                onClick={generate}
                disabled={busy}
                className="cursor-pointer rounded-md border border-[#1e3a5f] bg-[#0b1220] px-2.5 py-1.5 text-[11.5px] text-[color:var(--color-primary-ink)] disabled:opacity-50"
              >
                ↻ Regenerate
              </button>
            </div>
            <div className="p-3.5">
              <div className="mb-2">
                <div className="text-[11px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">Headline</div>
                <div className="mt-0.5 text-[15px] font-semibold">{briefing.briefing.headline}</div>
              </div>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSentHash(null);
                  setSendError(null);
                }}
                className="min-h-[132px] w-full resize-y rounded-lg border border-[color:var(--color-border)] bg-[#0a0a0d] p-3 font-[inherit] text-[13px] leading-[1.6] text-[#e5e5e5] outline-none"
              />

              {briefing.briefing.top_risks.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[10.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
                    Top risks (cited)
                  </div>
                  <ul className="ml-4 list-disc space-y-1 text-[12.5px]">
                    {briefing.briefing.top_risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
                    <span>Recorded actions</span>
                    <span
                      className="rounded bg-[color:var(--color-success)]/20 px-1.5 py-[1px] text-[9px] font-semibold text-[color:var(--color-success)]"
                      title="From audit log"
                    >
                      audit
                    </span>
                  </div>
                  {briefing.briefing.recorded_actions.length === 0 ? (
                    <div className="text-[12px] italic text-[color:var(--color-muted-foreground)]">
                      No operator actions recorded in this briefing window.
                    </div>
                  ) : (
                    <ul className="ml-4 list-disc space-y-1 text-[12px]">
                      {briefing.briefing.recorded_actions.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
                    <span>Recommended actions</span>
                    <span
                      className="rounded bg-[color:var(--color-primary)]/20 px-1.5 py-[1px] text-[9px] font-semibold text-[color:var(--color-primary-ink)]"
                      title="LLM proposals — coordinator decides"
                    >
                      advisory · LLM
                    </span>
                  </div>
                  <ul className="ml-4 list-disc space-y-1 text-[12px]">
                    {briefing.briefing.recommended_actions.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 border-t border-[color:var(--color-border-2)] pt-3">
                <div className="mb-1.5 text-[10.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
                  Outlook
                </div>
                <p className="text-[13px] leading-[1.55]">{briefing.briefing.outlook}</p>
              </div>

              <div className="mt-3.5 flex items-center justify-between border-t border-[color:var(--color-border-2)] pt-3">
                <span className="text-[10.5px] text-[color:var(--color-subtle)]">
                  Send writes a{" "}
                  <span className="sgw-mono">briefing_sent</span>{" "}
                  row to the append-only audit log · chained off generation hash{" "}
                  <span className="sgw-mono">{briefing.audit.current_hash.slice(0, 12)}…</span>{" "}
                  · downstream delivery to email / Teams / SharePoint is Phase 4.
                </span>
                <button
                  onClick={send}
                  disabled={sending || sentHash !== null}
                  className="cursor-pointer rounded-md border px-3.5 py-1.5 text-[12px] font-semibold"
                  style={{
                    borderColor: sentHash ? "#166534" : "#1e40af",
                    background: sentHash ? "#0f2a19" : "var(--color-primary-2)",
                    color: sentHash ? "#86efac" : "#fff",
                  }}
                >
                  {sending
                    ? "Sending…"
                    : sentHash
                      ? `✓ Sent & logged · ${sentHash.slice(0, 8)}`
                      : "Send to leadership"}
                </button>
              </div>
              {sendError && (
                <div className="mt-2 rounded border border-[color:var(--color-critical)] bg-[color:var(--color-critical)]/10 px-3 py-2 text-[11px] text-[color:var(--color-critical)]">
                  Send failed — briefing was NOT logged. Please retry: {sendError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
