import { useEffect, useMemo, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { AssetSummary } from "../lib/api";
import { prettyAssetType, prettyRegion, riskColor } from "../lib/labels";
import { MapLegend } from "./MapLegend";
import "leaflet/dist/leaflet.css";

function FlyToAsset({ asset }: Readonly<{ asset: AssetSummary | null }>) {
  const map = useMap();
  useEffect(() => {
    if (!asset) return;
    map.flyTo([asset.latitude, asset.longitude], Math.max(map.getZoom(), 10), { duration: 0.6 });
  }, [asset, map]);
  return null;
}

type LayerKey = "storm" | "flood" | "heat" | "weather";

type LayerCfg = { key: LayerKey; label: string; swatch: string; on: boolean };

const DEFAULT_LAYERS: LayerCfg[] = [
  { key: "storm", label: "NHC cone & track", swatch: "#a78bfa", on: true },
  { key: "flood", label: "Flood / surge zones", swatch: "#38bdf8", on: true },
  { key: "heat", label: "Asset risk heatmap", swatch: "#e0245e", on: true },
  { key: "weather", label: "Weather (radar)", swatch: "#64748b", on: false },
];

type Props = {
  assets: AssetSummary[];
  hazardZones?: GeoJSON.FeatureCollection | null;
  hurricaneTracks?: GeoJSON.FeatureCollection | null;
  onSelectAsset: (id: string) => void;
  selectedAsset?: AssetSummary | null;
  showHistoricCones?: boolean;
};

export function OperationalMap({ assets, hazardZones, hurricaneTracks, onSelectAsset, selectedAsset, showHistoricCones = true }: Readonly<Props>) {
  const [layers, setLayers] = useState<LayerCfg[]>(DEFAULT_LAYERS);
  const on = useMemo(() => Object.fromEntries(layers.map((l) => [l.key, l.on])) as Record<LayerKey, boolean>, [layers]);

  // Centre such that all three SGW regions (coastal SC, coastal GA, inland NC)
  // fit within the initial viewport at zoom 7.
  const center: [number, number] = [33.3, -80.5];

  return (
    <div className="relative h-full w-full">
      <MapContainer center={center} zoom={7} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution="© OpenStreetMap contributors"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {on.flood && hazardZones && (
          <GeoJSON
            key="hazard"
            data={hazardZones as GeoJSON.GeoJsonObject}
            style={() => ({ color: "#38bdf8", weight: 1, fillOpacity: 0.08, dashArray: "3 2" })}
          />
        )}

        {on.storm && showHistoricCones && hurricaneTracks && (
          <GeoJSON
            key="tracks"
            data={hurricaneTracks as GeoJSON.GeoJsonObject}
            style={(f) =>
              (f?.properties as { kind?: string } | undefined)?.kind === "cone"
                ? {
                    color: "#a78bfa",
                    weight: 1,
                    fillOpacity: 0.08,
                    dashArray: "6 4",
                  }
                : { color: "#a78bfa", weight: 2.5 }
            }
            onEachFeature={(feat, layer) => {
              const props = feat.properties as { storm_name?: string; kind?: string } | undefined;
              if (props?.storm_name && props.kind === "track") {
                layer.bindTooltip(`Hurricane ${props.storm_name}`, {
                  permanent: true,
                  direction: "center",
                  className: "storm-label",
                });
              }
            }}
          />
        )}

        {on.heat &&
          assets.map((a) => (
            <CircleMarker
              key={a.asset_id}
              center={[a.latitude, a.longitude]}
              radius={Math.max(4, a.risk_score * 14)}
              pathOptions={{
                color: riskColor(a.risk_level),
                fillColor: riskColor(a.risk_level),
                fillOpacity: 0.75,
                weight: 1.25,
              }}
              eventHandlers={{ click: () => onSelectAsset(a.asset_id) }}
            >
              <Tooltip direction="top" opacity={0.9} sticky>
                <div className="text-xs">
                  <div className="font-medium">{a.asset_name}</div>
                  <div className="opacity-70">
                    {prettyAssetType(a.asset_type)} · {prettyRegion(a.region)}
                  </div>
                  <div className="mt-0.5 sgw-num">
                    Risk {a.risk_score.toFixed(2)} · {a.risk_level}
                  </div>
                </div>
              </Tooltip>
              <Popup>
                <div className="text-sm">
                  <div className="font-medium">{a.asset_name}</div>
                  <div className="text-xs opacity-70">
                    {a.asset_id} · {prettyAssetType(a.asset_type)}
                  </div>
                  <div className="mt-1 sgw-num">
                    Risk: {a.risk_score.toFixed(2)} ({a.risk_level})
                  </div>
                  <button
                    onClick={() => onSelectAsset(a.asset_id)}
                    className="mt-2 text-xs text-blue-500 underline"
                  >
                    Drill down →
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          ))}

        <FlyToAsset asset={selectedAsset ?? null} />
      </MapContainer>

      {/* Layer control */}
      <div className="absolute right-3 top-3 z-[500] min-w-[168px] rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel)]/95 p-2.5 backdrop-blur">
        <div className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
          Map layers
        </div>
        {layers.map((l, i) => (
          <label
            key={l.key}
            className="flex cursor-pointer items-center gap-2 py-[3px] text-[11.5px] text-[#d4d4d4]"
          >
            <input
              type="checkbox"
              checked={l.on}
              onChange={() =>
                setLayers((prev) => prev.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))
              }
              className="accent-[color:var(--color-primary)]"
            />
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: l.swatch }}
            />
            <span>{l.label}</span>
          </label>
        ))}
      </div>

      <MapLegend />
    </div>
  );
}
