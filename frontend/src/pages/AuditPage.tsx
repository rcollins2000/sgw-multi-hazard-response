import { useEffect, useMemo, useState } from "react";
import { api, type AuditEntry } from "../lib/api";

const ACTION_STYLES: Record<string, { color: string; bg: string }> = {
  operator_accept: { color: "#86efac", bg: "#0f2a19" },
  operator_override: { color: "#fca5a5", bg: "#2a0f0f" },
  operator_comment: { color: "#93c5fd", bg: "#0b1220" },
  explanation_generated: { color: "#c4b5fd", bg: "#1e123a" },
  briefing_generated: { color: "#c4b5fd", bg: "#1e123a" },
};

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.audit(500).then(setEntries).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return entries;
    const q = filter.toLowerCase();
    return entries.filter(
      (e) =>
        e.action_type.toLowerCase().includes(q) ||
        e.subject_id.toLowerCase().includes(q) ||
        e.user.toLowerCase().includes(q) ||
        e.current_hash.toLowerCase().includes(q),
    );
  }, [filter, entries]);

  function download(kind: "csv" | "json") {
    let blob: Blob;
    if (kind === "json") {
      blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    } else {
      const cols: (keyof AuditEntry)[] = ["id", "timestamp", "user", "action_type", "subject_id", "current_hash"];
      const rows = [
        cols.join(","),
        ...filtered.map((r) =>
          cols
            .map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`)
            .join(","),
        ),
      ];
      blob = new Blob([rows.join("\n")], { type: "text/csv" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sgw_audit_log.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (error)
    return <div className="p-8 text-[color:var(--color-critical)]">{error}</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold">Audit log</h1>
            <p className="mt-1 max-w-[720px] text-[12.5px] leading-[1.5] text-[color:var(--color-muted-foreground)]">
              Append-only ledger with a SHA-256 hash chain. Every recommendation, LLM call, and operator decision is
              recorded with model version, evidence IDs, and reason. UPDATE / DELETE are blocked at the database
              trigger level — no edit affordances exist.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => download("csv")}
              className="cursor-pointer rounded-md border border-[#2a2a2e] bg-[color:var(--color-border-3)] px-3 py-1.5 text-[11.5px] text-[#d4d4d4]"
            >
              Export CSV
            </button>
            <button
              onClick={() => download("json")}
              className="cursor-pointer rounded-md border border-[#2a2a2e] bg-[color:var(--color-border-3)] px-3 py-1.5 text-[11.5px] text-[#d4d4d4]"
            >
              Export JSON
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by actor / action / subject / hash…"
            className="flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] px-3 py-2 text-[12.5px] text-[#e5e5e5] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)]"
          />
          <span className="whitespace-nowrap text-[11px] text-[color:var(--color-subtle)]">
            {filtered.length} of {entries.length} entries
          </span>
        </div>

        <div className="mt-3.5 overflow-hidden rounded-lg border border-[color:var(--color-border)]">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-[color:var(--color-panel-3)] text-[9.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Timestamp (UTC)</th>
                <th className="px-3 py-2 text-left">Actor</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Hash</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const s = ACTION_STYLES[e.action_type] ?? { color: "#a3a3a3", bg: "#1a1a1d" };
                return (
                  <tr
                    key={e.id}
                    className="border-t border-[color:var(--color-border-3)] align-top hover:bg-[color:var(--color-muted)]/20"
                  >
                    <td className="sgw-num px-3 py-2 text-[color:var(--color-faint)]">{e.id}</td>
                    <td className="sgw-mono px-3 py-2">
                      {new Date(e.timestamp).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="sgw-mono px-3 py-2 text-[#e5e5e5]">{e.user}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-block rounded px-1.5 py-[2px] text-[9.5px] font-semibold"
                        style={{ background: s.bg, color: s.color }}
                      >
                        {e.action_type}
                      </span>
                    </td>
                    <td className="sgw-mono px-3 py-2">{e.subject_id}</td>
                    <td className="sgw-mono px-3 py-2 text-[color:var(--color-subtle)]">
                      {e.current_hash.slice(0, 12)}…
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--color-muted-foreground)]">
                    {filter.trim()
                      ? `No entries match “${filter}”.`
                      : "No audit-log entries yet. Every operator action + LLM call will append here."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[10.5px] leading-[1.6] text-[color:var(--color-faint)]">
          Each entry references the previous entry’s hash — any tamper attempt breaks the chain. Verified end-to-end by{" "}
          <span className="sgw-mono rounded bg-[color:var(--color-border-3)] px-1 py-[1px]">
            audit.verifier.verify_chain()
          </span>
          . New decisions from every operator action — cockpit, drilldown, scenarios, crew plan, briefing — append here in real time.
        </p>
      </div>
    </div>
  );
}
