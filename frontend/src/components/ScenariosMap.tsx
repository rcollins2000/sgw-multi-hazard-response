import { useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { divIcon, type LatLngExpression } from "leaflet";
import type { AssetSummary, ScenarioImpact } from "../lib/api";
import type { StormPathTemplate } from "../lib/stormPaths";
import { riskColor, riskLevelOf } from "../lib/labels";
import "leaflet/dist/leaflet.css";

/*
  ScenariosMap — the map above ScenariosPage impacts.

  Shows:
    · SGW footprint tiles
    · Cone polygon (dashed amber) — if the template has one
    · Track polyline (solid amber) — if the template has one
    · Landfall marker — labelled
    · Top-K impacted assets as circle markers, sized by scenario_score

  This map is READ-ONLY — interactive zoom/pan is disabled so the demo view
  is deterministic. The tile is centred + zoomed to fit the storm-path bounds
  (falling back to SGW footprint when no path exists — e.g. worst_case_cascade).

  Provenance chip lives bottom-left so the reader always knows what the path
  is (historic replay vs synthesised composite vs LLM-inferred).
*/

type Provenance = "historic" | "synthesised" | "llm_inferred" | "no_path";

type Props = {
  template: StormPathTemplate | null;
  impacts: ScenarioImpact[];
  /** Asset lookup so we can position impact dots on the map. */
  assetsById: Map<string, AssetSummary>;
  provenance: Provenance;
  height?: number;
  /** Highest-priority K dots we plot to keep the map legible. */
  topK?: number;
};

const PROVENANCE_LABEL: Record<Provenance, string> = {
  historic: "Historic replay · NHC track",
  synthesised: "Synthesised composite · HURDAT2-shaped",
  llm_inferred: "LLM-inferred cone · directive-derived",
  no_path: "No hazard footprint · cascade-only scenario",
};

export function ScenariosMap({
  template,
  impacts,
  assetsById,
  provenance,
  height = 380,
  topK = 30,
}: Readonly<Props>) {
  const dots = useMemo(() => {
    const out: {
      impact: ScenarioImpact;
      asset: AssetSummary;
    }[] = [];
    for (const imp of impacts.slice(0, topK)) {
      const asset = assetsById.get(imp.asset_id);
      if (asset) out.push({ impact: imp, asset });
    }
    return out;
  }, [impacts, assetsById, topK]);

  const bounds = useMemo(() => {
    if (template && template.cone.length > 0) {
      const lats = template.cone.map((p) => p[0]);
      const lons = template.cone.map((p) => p[1]);
      return {
        center: [
          (Math.max(...lats) + Math.min(...lats)) / 2,
          (Math.max(...lons) + Math.min(...lons)) / 2,
        ] as [number, number],
        zoom: 5.4,
      };
    }
    return { center: [32.5, -81.0] as [number, number], zoom: 6.4 };
  }, [template]);

  const landfallIcon = useMemo(
    () =>
      divIcon({
        className: "",
        html: `<div style="
          width: 16px; height: 16px; border-radius: 50%;
          background: #f5a524; border: 2px solid #fff; box-shadow: 0 0 0 2px #f5a52466;
          transform: translate(-8px,-8px);
        "></div>`,
      }),
    [],
  );

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-[color:var(--color-border)]"
      style={{ height }}
      data-testid="scenarios-map"
    >
      <MapContainer
        center={bounds.center}
        zoom={bounds.zoom}
        className="h-full w-full"
        zoomControl={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        dragging={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer url="https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png" />

        {template && template.cone.length > 0 && (
          <Polygon
            positions={template.cone as LatLngExpression[]}
            pathOptions={{
              color: "#f5a524",
              fillColor: "#f5a524",
              fillOpacity: 0.12,
              weight: 1.2,
              dashArray: "5 4",
            }}
          />
        )}
        {template && template.track.length > 0 && (
          <Polyline
            positions={template.track as LatLngExpression[]}
            pathOptions={{ color: "#f5a524", weight: 2.6 }}
          />
        )}
        {template && template.track.length > 0 && (
          <Marker position={template.landfall as LatLngExpression} icon={landfallIcon}>
            <Tooltip direction="top" opacity={0.9} permanent>
              <span className="text-[10px] font-semibold">
                Landfall · {template.name}
                {template.saffir_simpson ? ` · ${template.saffir_simpson}` : ""}
              </span>
            </Tooltip>
          </Marker>
        )}

        {dots.map(({ impact, asset }) => {
          const level = riskLevelOf(impact.scenario_score);
          const c = riskColor(level);
          return (
            <CircleMarker
              key={impact.asset_id}
              center={[asset.latitude, asset.longitude]}
              radius={Math.max(4, impact.scenario_score * 10)}
              pathOptions={{ color: c, fillColor: c, fillOpacity: 0.85, weight: 1 }}
            >
              <Tooltip direction="top" opacity={0.9} sticky>
                <div className="text-[11px]">
                  <div className="font-medium">{impact.asset_name}</div>
                  <div className="opacity-70">{impact.utility_domain}</div>
                  <div className="sgw-num mt-0.5">
                    scenario {impact.scenario_score.toFixed(2)} · Δ+{impact.delta.toFixed(2)}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Provenance chip (bottom-left, non-interactive) */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-[color:var(--color-panel)]/85 px-2 py-1 text-[10px] text-[color:var(--color-muted-foreground)] backdrop-blur">
        <div className="font-semibold uppercase tracking-[0.6px]">{PROVENANCE_LABEL[provenance]}</div>
        {template?.note && <div className="mt-0.5 max-w-[420px] italic">{template.note}</div>}
      </div>

      {/* Legend chip (bottom-right) */}
      <div className="pointer-events-none absolute bottom-2 right-2 flex flex-wrap items-center gap-x-2 rounded bg-[color:var(--color-panel)]/85 px-2 py-1 text-[10px] text-[color:var(--color-muted-foreground)] backdrop-blur">
        {template && template.cone.length > 0 && (
          <>
            <LegendChip color="#f5a524" label="Cone" dashed />
            <LegendChip color="#f5a524" label="Track" solid />
          </>
        )}
        <LegendChip color="#e0245e" label="Critical" dot />
        <LegendChip color="#f5a524" label="High" dot />
      </div>

      {/* Stress-test warning chip (top-right) */}
      <div className="pointer-events-none absolute right-2 top-2 rounded border border-[color:var(--color-signature)]/40 bg-[color:var(--color-signature)]/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[color:var(--color-signature)]">
        Stress test · not a live forecast
      </div>
    </div>
  );
}

function LegendChip({
  color,
  label,
  dashed,
  solid,
  dot,
}: Readonly<{ color: string; label: string; dashed?: boolean; solid?: boolean; dot?: boolean }>) {
  return (
    <span className="flex items-center gap-1">
      {dot ? (
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      ) : (
        <span
          className="inline-block w-3"
          style={{
            height: 2,
            background: solid ? color : undefined,
            borderTop: dashed ? `2px dashed ${color}` : undefined,
          }}
        />
      )}
      <span>{label}</span>
    </span>
  );
}
