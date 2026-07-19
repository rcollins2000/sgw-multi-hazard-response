import { useState } from "react";
import { api } from "../lib/api";

/*
  HITLPanel — reason box + Accept / Override / Comment buttons.

  The caller wraps this in whatever container / section header it wants —
  this component intentionally does NOT render its own "Operator decision"
  title so the two callsites (AssetDrilldown, and any future embed) can
  own their own section chrome.

  Override + Comment both REQUIRE a reason. Accept does not — accepting an
  advisory recommendation is the default operator flow and doesn't need a
  justification beyond the audit-log entry itself. Override + Comment DO
  need a justification for the audit trail (see CLAUDE.md — "every operator
  action logged with reason").
*/

export function HITLPanel({ assetId, onDecided }: { assetId: string; onDecided?: (hash: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [lastHash, setLastHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "accept" | "override" | "comment") {
    setBusy(true);
    setError(null);
    try {
      const res = await api.decide({ asset_id: assetId, action, reason: reason || undefined });
      setLastHash(res.audit_hash);
      onDecided?.(res.audit_hash);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const reasonMissing = !reason.trim();

  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)] p-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason / comment (required for Override & Comment)"
        rows={2}
        className="mb-2 w-full resize-none rounded bg-[color:var(--color-background)] p-2 text-sm outline-none focus:ring-1 focus:ring-[color:var(--color-primary)]"
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => decide("accept")}
          className="rounded bg-[color:var(--color-success)]/20 px-3 py-1.5 text-sm text-[color:var(--color-success)] hover:bg-[color:var(--color-success)]/30 disabled:opacity-50"
        >
          Accept
        </button>
        <button
          disabled={busy || reasonMissing}
          onClick={() => decide("override")}
          className="rounded bg-[color:var(--color-critical)]/20 px-3 py-1.5 text-sm text-[color:var(--color-critical)] hover:bg-[color:var(--color-critical)]/30 disabled:opacity-50"
        >
          Override
        </button>
        <button
          disabled={busy || reasonMissing}
          onClick={() => decide("comment")}
          className="rounded bg-[color:var(--color-primary)]/20 px-3 py-1.5 text-sm text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/30 disabled:opacity-50"
        >
          Comment
        </button>
      </div>
      {lastHash && (
        <div className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
          Audit hash: <span className="font-mono">{lastHash.slice(0, 16)}…</span>
        </div>
      )}
      {error && <div className="mt-2 text-xs text-[color:var(--color-critical)]">{error}</div>}
    </div>
  );
}
