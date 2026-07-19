import { useMemo } from "react";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip } from "react-leaflet";
import type { AssetSummary } from "../lib/api";
import { prettyAssetType, prettyRegion, riskColor } from "../lib/labels";
import "leaflet/dist/leaflet.css";

/*
  CockpitMiniMap — a small, always-legible map for the cockpit right rail.

  Two modes:
    · storm mode  (DEBBY REPLAY) — draws the NHC cone + track over the SGW
                                    footprint and overlays the top-N at-risk
                                    assets as dots sized by preventative
                                    priority.
    · live  mode  — no cone. Zooms out to the SC/GA/NC footprint and shows the
                     top-N preventative-priority assets so the operator can see
                     WHERE their attention is being drawn (and can eyeball
                     whether clusters are geographically concentrated).

  Uses the same react-leaflet + OSM tile stack as OperationalMap, but with all
  interactivity disabled — this is a summary tile, not a working map. Clicking
  the "expand" affordance in CockpitPage brings up the full OperationalMap.
*/

// Debby cone + track — matches the design bundle & the historic NHC track.
// Format is [lat, lon] for leaflet (opposite of GeoJSON's [lon, lat]).
const DEBBY_CONE_LATLON: [number, number][] = [
  [24.5, -84.5],
  [24.5, -82.5],
  [32.0, -80.0],
  [34.0, -78.0],
  [35.5, -76.0],
  [35.8, -77.5],
  [33.0, -79.5],
  [30.0, -82.0],
  [28.0, -84.5],
];
const DEBBY_TRACK_LATLON: [number, number][] = [
  [25.0, -83.5],
  [27.5, -84.0],
  [29.6, -83.4],
  [31.0, -82.5],
  [32.0, -81.5],
  [32.7, -80.2],
  [34.0, -78.5],
];

type Props = {
  assets: AssetSummary[];
  mode: "live" | "storm";
  /** How many assets to render as dots. Kept small so the tile stays legible. */
  topN?: number;
};

export function CockpitMiniMap({ assets, mode, topN = 18 }: Readonly<Props>) {
  const storm = mode === "storm";
  const dots = useMemo(() => assets.slice(0, topN), [assets, topN]);
  const center: [number, number] = storm ? [31.5, -80.5] : [33.5, -80.8];
  const zoom = storm ? 5.4 : 6.4;

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-[color:var(--color-border-2)]"
      style={{ height: 180 }}
      data-testid="cockpit-mini-map"
    >
      <MapContainer
        center={center}
        zoom={zoom}
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

        {storm && (
          <>
            <Polygon
              positions={DEBBY_CONE_LATLON}
              pathOptions={{
                color: "#f5a524",
                fillColor: "#f5a524",
                fillOpacity: 0.14,
                weight: 1.2,
                dashArray: "5 4",
              }}
            />
            <Polyline
              positions={DEBBY_TRACK_LATLON}
              pathOptions={{ color: "#f5a524", weight: 2.4 }}
            />
          </>
        )}

        {dots.map((a) => {
          const c = riskColor(a.risk_level);
          return (
            <CircleMarker
              key={a.asset_id}
              center={[a.latitude, a.longitude]}
              radius={Math.max(2.5, a.risk_score * 4.5)}
              pathOptions={{
                color: "#0a0a0f",
                fillColor: c,
                fillOpacity: 0.9,
                weight: 1,
              }}
            >
              <Tooltip direction="top" opacity={0.9} sticky>
                <div className="text-[11px]">
                  <div className="font-medium">{a.asset_name}</div>
                  <div className="opacity-70">
                    {prettyAssetType(a.asset_type)} · {prettyRegion(a.region)}
                  </div>
                  <div className="sgw-num mt-0.5">
                    Risk {a.risk_score.toFixed(2)} · {a.risk_level}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend chip — anchored bottom-left, non-interactive */}
      <div className="pointer-events-none absolute bottom-1 left-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded bg-[color:var(--color-panel)]/85 px-1.5 py-1 text-[9px] text-[color:var(--color-muted-foreground)] backdrop-blur">
        {storm ? (
          <>
            <LegendChip color="#f5a524" label="NHC cone" dashed />
            <LegendChip color="#f5a524" label="Track" solid />
            <LegendChip color="#e0245e" label="Critical" dot />
            <LegendChip color="#f5a524" label="High" dot />
          </>
        ) : (
          <>
            <LegendChip color="#e0245e" label="Critical" dot />
            <LegendChip color="#f5a524" label="High" dot />
            <LegendChip color="#93c5fd" label="Moderate" dot />
          </>
        )}
      </div>

      {/* Mode chip — top-right */}
      <div className="pointer-events-none absolute right-1 top-1 rounded bg-[color:var(--color-panel)]/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.6px] text-[color:var(--color-muted-foreground)] backdrop-blur">
        {storm ? "DEBBY 2024 replay" : "LIVE · SGW footprint"}
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
