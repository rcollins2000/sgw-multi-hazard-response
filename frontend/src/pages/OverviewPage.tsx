import { useEffect, useMemo, useState } from "react";
import { api, type Alert, type AssetSummary, type PersonaKey } from "../lib/api";
import { usePoll } from "../lib/usePoll";
import { fmtRelative, prettyRegion, riskColor } from "../lib/labels";
import { OperationalMap } from "../components/OperationalMap";
import { AssetDrilldown } from "../components/AssetDrilldown";
import { RiskBadge } from "../components/RiskBadge";
import { useAppStore } from "../stores/appStore";

// Poll cadences — match the backend NOAA pollers exactly so the frontend
// picks up new state within one upstream cycle.
const ALERTS_POLL_MS = 60_000; // NWS alerts poller runs every 60s server-side
const ASSETS_POLL_MS = 30_000; // asset scores are model-derived + change slowly

export function OverviewPage({ persona }: Readonly<{ persona: PersonaKey }>) {
  const [hazard, setHazard] = useState<GeoJSON.FeatureCollection | null>(null);
  const [tracks, setTracks] = useState<GeoJSON.FeatureCollection | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [minRisk, setMinRisk] = useState(0);

  const { data: assetsData } = usePoll(
    () => api.assets({ limit: 500, minRisk }),
    ASSETS_POLL_MS,
    [minRisk],
  );
  const assets = assetsData ?? [];

  const { data: alertsData, updatedAt: alertsUpdatedAt } = usePoll(
    () => api.alerts(),
    ALERTS_POLL_MS,
  );
  const alerts = alertsData ?? [];

  useEffect(() => {
    api
      .hazardZones()
      .then((d) => setHazard(d as unknown as GeoJSON.FeatureCollection))
      .catch(console.error);
    api
      .hurricaneTracks()
      .then((d) => setTracks(d as unknown as GeoJSON.FeatureCollection))
      .catch(console.error);
  }, []);

  const critical = assets.filter((a) => a.risk_level === "critical").length;
  const high = assets.filter((a) => a.risk_level === "high").length;
  const activeAlerts = alerts.filter((a) => new Date(a.expires_at) > new Date());
  const populationAtRisk = useMemo(
    () =>
      assets
        .filter((a) => a.risk_score >= 0.6)
        .reduce((acc, a) => acc + (a.service_population ?? 0), 0),
    [assets],
  );
  const ranked = useMemo(() => [...assets].sort((a, b) => b.risk_score - a.risk_score), [assets]);

  return (
    <div className="flex h-full flex-col">
      {/* aggregate strip */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] px-4.5 py-2.5">
        <div className="flex gap-6">
          <AggregateTile label="Assets flagged (region-wide)">
            <span style={{ color: riskColor("critical") }}>{critical}</span>{" "}
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]">critical</span>
            <span className="ml-2" style={{ color: riskColor("high") }}>
              {high}
            </span>{" "}
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]">high</span>
          </AggregateTile>
          <AggregateTile label="Active advisories">
            {activeAlerts.length}{" "}
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]">NWS / NHC / CO-OPS</span>
          </AggregateTile>
          <AggregateTile label="Population at risk">
            <span className="sgw-num">{populationAtRisk.toLocaleString()}</span>
          </AggregateTile>
        </div>
        <div className="flex items-center gap-2.5">
          <label className="text-[11px] text-[color:var(--color-muted-foreground)]">Min risk</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={minRisk}
            onChange={(e) => setMinRisk(parseFloat(e.target.value))}
            className="w-[120px]"
          />
          <span className="sgw-mono w-8 text-right text-[12px]">{minRisk.toFixed(2)}</span>
        </div>
      </div>

      {/* 3-column body */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: hazard alert stack */}
        <div className="w-[300px] shrink-0 overflow-y-auto border-r border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
              Active hazard advisories
            </div>
            {alertsUpdatedAt && (
              <span
                className="sgw-mono text-[9px] text-[color:var(--color-faint)]"
                title={`Last poll: ${alertsUpdatedAt}`}
              >
                live · updated {fmtRelative(alertsUpdatedAt)}
              </span>
            )}
          </div>
          {activeAlerts.length === 0 && (
            <div className="text-[11px] italic text-[color:var(--color-muted-foreground)]">
              No active advisories in the current window.
            </div>
          )}
          {activeAlerts.map((a) => (
            <AlertCard key={a.alert_id} alert={a} />
          ))}
        </div>

        {/* CENTER: map */}
        <div className="min-w-0 flex-1">
          <OperationalMap
            assets={assets}
            hazardZones={hazard}
            hurricaneTracks={tracks}
            onSelectAsset={setSelected}
            selectedAsset={selected ? assets.find((a) => a.asset_id === selected) ?? null : null}
            showHistoricCones={useAppStore.getState().mode === "demo_debby"}
          />
        </div>

        {/* RIGHT: ranked at-risk assets */}
        <div className="w-[344px] shrink-0 overflow-y-auto border-l border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
              Ranked at-risk assets
            </span>
            <span className="sgw-mono text-[10px] text-[color:var(--color-faint)]">
              {ranked.length} shown
            </span>
          </div>
          {ranked.slice(0, 40).map((a) => (
            <RankedAssetRow key={a.asset_id} asset={a} onOpen={() => setSelected(a.asset_id)} />
          ))}
        </div>
      </div>

      {selected && (
        <AssetDrilldown assetId={selected} persona={persona} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ------------------------------ subcomponents ------------------------------

function AggregateTile({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
        {label}
      </div>
      <div className="text-[17px] font-bold">{children}</div>
    </div>
  );
}

const SEVERITY_STYLES: Record<string, { color: string; bg: string }> = {
  Extreme: { color: "#a78bfa", bg: "#2e1065" },
  Severe: { color: "#38bdf8", bg: "#082f49" },
  Moderate: { color: "#7dd3fc", bg: "#0c2536" },
  Minor: { color: "#7dd3fc", bg: "#0c2536" },
  Unknown: { color: "#94a3b8", bg: "#1e293b" },
};

function AlertCard({ alert }: Readonly<{ alert: Alert }>) {
  const sev = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.Unknown;
  return (
    <div
      className="mb-2 rounded-lg border p-2.5"
      style={{ borderColor: `${sev.color}33`, background: "#0f0f13" }}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span
          className="sgw-mono inline-block rounded border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[0.4px]"
          style={{ borderColor: `${sev.color}88`, background: sev.bg, color: sev.color }}
        >
          {alert.severity}
        </span>
        <span className="sgw-mono text-[9.5px] text-[color:var(--color-subtle)]">
          {fmtRelative(alert.issued_at)}
        </span>
      </div>
      <div className="mt-1.5 text-[12.5px] font-semibold leading-[1.35] text-[#ededed]">
        {alert.headline}
      </div>
      <div className="mt-1 text-[11px] leading-[1.4] text-[color:var(--color-muted-foreground)]">
        {alert.hazard_type} · {alert.urgency}
      </div>
      <div className="mt-1.5 flex items-center justify-between border-t border-[color:var(--color-border-2)] pt-1.5">
        <span className="sgw-mono text-[9.5px] text-[color:var(--color-subtle)]">
          Expires {new Date(alert.expires_at).toISOString().slice(11, 16)}Z
        </span>
        <span className="sgw-mono text-[9.5px] text-[color:var(--color-faint)]">{alert.alert_id}</span>
      </div>
    </div>
  );
}

// Human-readable factor chips derived from asset attributes.
function factorsFor(asset: AssetSummary): string[] {
  const tags: string[] = [];
  if (asset.within_hurricane_cone) tags.push("in cone");
  if (asset.criticality_rating >= 4) tags.push("high criticality");
  if (asset.utility_domain === "Water") tags.push("water-side");
  if (asset.utility_domain === "Electric") tags.push("electric-side");
  if (asset.utility_domain === "Wastewater") tags.push("wastewater");
  return tags.slice(0, 3);
}

function RankedAssetRow({
  asset,
  onOpen,
}: Readonly<{ asset: AssetSummary; onOpen: () => void }>) {
  const color = riskColor(asset.risk_level);
  const scorePct = Math.round(asset.risk_score * 100);
  return (
    <button
      onClick={onOpen}
      aria-label={`Drill down · ${asset.asset_name} · ${asset.risk_level} ${asset.risk_score.toFixed(2)}`}
      className="mb-2 block w-full cursor-pointer rounded-lg border border-[color:var(--color-border-2)] bg-[color:var(--color-panel-3)] p-2.5 text-left transition hover:border-[color:var(--color-primary)]/60"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="sgw-mono text-[10px] text-[#8b8b8b]">{asset.asset_id}</span>
        <RiskBadge level={asset.risk_level} score={asset.risk_score} />
      </div>
      <div className="mt-1 text-[12.5px] leading-[1.3] text-[#ededed]">{asset.asset_name}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="h-1 flex-1 overflow-hidden rounded-sm bg-[color:var(--color-border-2)]">
          <div className="h-full" style={{ width: `${scorePct}%`, background: color }} />
        </div>
        <span className="sgw-mono text-[9px] text-[color:var(--color-subtle)]">
          {prettyRegion(asset.region)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {asset.blast_radius_cluster !== null && (
          <span className="sgw-mono rounded border border-[#334155] bg-[#1e293b] px-1.5 py-[1px] text-[9px] text-[#94a3b8]">
            ◆ cluster {asset.blast_radius_cluster}
          </span>
        )}
        {factorsFor(asset).map((f) => (
          <span
            key={f}
            className="rounded border border-[#2a2a2e] bg-[color:var(--color-border-3)] px-1.5 py-[1px] text-[9px] text-[#cbd5e1]"
          >
            {f}
          </span>
        ))}
      </div>
    </button>
  );
}
