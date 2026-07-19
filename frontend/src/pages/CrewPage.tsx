import { Fragment, useMemo, useState } from "react";
import { MapContainer, Polyline, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import { PERSONAS, type PersonaKey } from "../lib/api";
import { useAppStore } from "../stores/appStore";
import "leaflet/dist/leaflet.css";

type Crew = {
  id: string;
  name: string;
  tag: string;
  capability: string;
  cur: [number, number]; // [lat, lon]
  prop: [number, number];
  from: string;
  to: string;
  eta: string;
  covered: number;
  confBase: number;
};

const CREWS: Crew[] = [
  {
    id: "CREW-CO-000",
    name: "Coastal East (SC) Response 1-1",
    tag: "1",
    capability: "Line clearance",
    cur: [32.7718, -80.0848],
    prop: [32.66, -80.01],
    from: "US-17 / Rantowles",
    to: "Ashley River PS",
    eta: "38 min",
    covered: 4,
    confBase: 0.86,
  },
  {
    id: "CREW-CO-001",
    name: "Coastal East (SC) Response 1-2",
    tag: "2",
    capability: "Water quality",
    cur: [32.9773, -80.0652],
    prop: [32.775, -79.94],
    from: "Goose Creek yard",
    to: "Battery PS",
    eta: "31 min",
    covered: 3,
    confBase: 0.81,
  },
  {
    id: "CREW-CO-004",
    name: "Coastal East (SC) Response 1-5",
    tag: "5",
    capability: "High-voltage electrical",
    cur: [32.8965, -79.7829],
    prop: [32.8, -79.93],
    from: "Mt Pleasant staging",
    to: "Peninsula Substation",
    eta: "24 min",
    covered: 5,
    confBase: 0.9,
  },
];

const WEIGHT_HINTS: Record<string, string> = {
  cov: "Maximise critical/high assets within reach",
  travel: "Penalise long repositioning drives",
  shift: "Keep crews inside 06:00–18:00 window",
};

export function CrewPage({ persona }: Readonly<{ persona: PersonaKey }>) {
  const isLive = useAppStore((s) => s.mode) === "live";
  const [weights, setWeights] = useState({ cov: 0.7, travel: 0.5, shift: 0.85 });
  const [planAccepted, setPlanAccepted] = useState(false);
  const [rerunCount, setRerunCount] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const covPct = Math.round(62 + weights.cov * 32 - weights.travel * 6);
  const maxTravel = Math.round(58 - weights.travel * 26);
  const unmet = Math.max(0, Math.round(5 - weights.cov * 5));
  const shift = weights.shift >= 0.8 ? "100%" : "92%";

  const crews = useMemo(
    () =>
      CREWS.map((c) => {
        const conf = Math.min(0.97, c.confBase + (weights.cov - 0.7) * 0.1);
        return { ...c, conf };
      }),
    [weights.cov],
  );

  const personaLabel = PERSONAS.find((p) => p.key === persona)?.name ?? "";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* header */}
      <div className="shrink-0 border-b border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] px-4.5 py-3">
        <div className="text-[15px] font-bold">
          Crew pre-positioning plan{" "}
          <span className="text-[11px] font-normal text-[color:var(--color-muted-foreground)]">
            · OR-Tools VRP + Guided Local Search · Haversine cost
          </span>
        </div>
        <div className="mt-0.5 text-[11.5px] text-[color:var(--color-muted-foreground)]">
          {isLive
            ? "Proposed placements cover the highest-priority preventative work orders, respecting shift-hour windows and travel time from current crew locations."
            : "Proposed placements optimise coverage of critical / high assets before T-48h, respecting shift windows and travel time from current staging."}
        </div>
      </div>

      {/* map + constraints */}
      <div className="flex min-h-[420px] flex-1">
        {/* map */}
        <div className="relative min-w-0 flex-1">
          <MapContainer center={[32.85, -80.0]} zoom={9} className="h-full w-full" scrollWheelZoom>
            <TileLayer
              attribution="© OpenStreetMap contributors"
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {crews.map((c) => (
              <Fragment key={c.id + rerunCount}>
                <Polyline positions={[c.cur, c.prop]} pathOptions={{ color: "#3b82f6", weight: 2, dashArray: "6 4" }} />
                <Rectangle
                  bounds={[
                    [c.cur[0] - 0.02, c.cur[1] - 0.02],
                    [c.cur[0] + 0.02, c.cur[1] + 0.02],
                  ]}
                  pathOptions={{ color: "#64748b", weight: 1.5, dashArray: "4 3", fillOpacity: 0.1 }}
                >
                  <Tooltip direction="top" opacity={0.9}>
                    <div className="text-xs">
                      <div className="font-medium">{c.name}</div>
                      <div className="opacity-70">Current: {c.from}</div>
                    </div>
                  </Tooltip>
                </Rectangle>
                <Rectangle
                  bounds={[
                    [c.prop[0] - 0.022, c.prop[1] - 0.022],
                    [c.prop[0] + 0.022, c.prop[1] + 0.022],
                  ]}
                  pathOptions={{ color: "#93c5fd", weight: 1.5, fillColor: "#1d4ed8", fillOpacity: 0.9 }}
                >
                  <Tooltip direction="top" opacity={0.95}>
                    <div className="text-xs">
                      <div className="font-medium">
                        Crew #{c.tag} · proposed → {c.to}
                      </div>
                      <div className="opacity-70 sgw-num">
                        ETA {c.eta} · covers {c.covered} · conf {c.conf.toFixed(2)}
                      </div>
                    </div>
                  </Tooltip>
                </Rectangle>
              </Fragment>
            ))}
          </MapContainer>

          <div className="absolute bottom-3 left-3 z-[500] rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel)]/95 px-3 py-2.5 text-[10.5px] text-[#d4d4d4] backdrop-blur">
            <div className="mb-1 flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-[3px]"
                style={{ border: "1.5px dashed #64748b" }}
              />
              Current position
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-[3px]"
                style={{ background: "#1d4ed8", border: "1.5px solid #93c5fd" }}
              />
              Proposed placement
            </div>
          </div>
        </div>

        {/* constraints panel */}
        <div className="w-[340px] shrink-0 overflow-y-auto border-l border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] p-3.5">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
            Plan constraints
          </div>
          <div className="mb-3.5 grid grid-cols-2 gap-2">
            <ConstraintTile
              label="Coverage"
              value={`${covPct}%`}
              sub="critical + high assets"
              color={covPct >= 80 ? "#22c55e" : "#f5a524"}
            />
            <ConstraintTile
              label="Max travel"
              value={`${maxTravel} min`}
              sub="longest reposition"
              color={maxTravel <= 45 ? "#22c55e" : "#f5a524"}
            />
            <ConstraintTile
              label="Shift respect"
              value={shift}
              sub="within 06:00–18:00"
              color="#22c55e"
            />
            <ConstraintTile
              label="Unmet demand"
              value={String(unmet)}
              sub="assets uncovered"
              color={unmet === 0 ? "#22c55e" : "#f2711c"}
            />
          </div>

          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
            Objective trade-offs
          </div>
          {(["cov", "travel", "shift"] as const).map((k) => (
            <div key={k} className="mb-3">
              <div className="mb-1 flex justify-between text-[11.5px]">
                <span className="text-[#d4d4d4]">
                  {k === "cov" ? "Coverage priority" : k === "travel" ? "Travel-time penalty" : "Shift-hour respect"}
                </span>
                <span className="sgw-mono text-[color:var(--color-primary-ink)]">
                  {weights[k].toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={weights[k]}
                onChange={(e) => setWeights({ ...weights, [k]: parseFloat(e.target.value) })}
                className="w-full"
              />
              <div className="mt-0.5 text-[9.5px] text-[color:var(--color-faint)]">{WEIGHT_HINTS[k]}</div>
            </div>
          ))}

          <button
            onClick={() => setRerunCount((c) => c + 1)}
            className="mt-1 w-full cursor-pointer rounded-md border border-[#1e40af] bg-[color:var(--color-primary-2)] px-2 py-2 text-[12.5px] font-semibold text-white"
          >
            Re-run optimisation
          </button>
          <div className="mt-2 text-[10px] leading-[1.5] text-[color:var(--color-subtle)]">
            Last solve #{rerunCount + 1} · 3 vehicles · 9 stops · GLS 400ms budget · Solver by OR-Tools
          </div>
        </div>
      </div>

      {/* plan table */}
      <div className="shrink-0 border-t border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)]">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
              <th className="px-3.5 py-2 text-left">Crew</th>
              <th className="px-3.5 py-2 text-left">Capability</th>
              <th className="px-3.5 py-2 text-left">From → To</th>
              <th className="px-3.5 py-2 text-right">ETA</th>
              <th className="px-3.5 py-2 text-right">Assets covered</th>
              <th className="px-3.5 py-2 text-right">Confidence</th>
              <th className="px-3.5 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {crews.map((c) => (
              <tr key={c.id} className="border-t border-[color:var(--color-border-3)]">
                <td className="px-3.5 py-2.5">
                  <div className="sgw-mono text-[10px] text-[#8b8b8b]">{c.id}</div>
                  <div className="text-[11.5px] text-[#ededed]">{c.name}</div>
                </td>
                <td className="px-3.5 py-2.5 text-[#cbd5e1]">{c.capability}</td>
                <td className="sgw-mono px-3.5 py-2.5">
                  <span className="text-[#94a3b8]">{c.from}</span>{" "}
                  <span className="text-[color:var(--color-primary)]">→</span>{" "}
                  <span className="text-[#e5e5e5]">{c.to}</span>
                </td>
                <td className="sgw-num px-3.5 py-2.5 text-right">{c.eta}</td>
                <td className="sgw-num px-3.5 py-2.5 text-right">{c.covered}</td>
                <td className="px-3.5 py-2.5 text-right">
                  <span
                    className="sgw-num"
                    style={{ color: c.conf >= 0.85 ? "#22c55e" : c.conf >= 0.7 ? "#f5a524" : "#f2711c" }}
                  >
                    {c.conf.toFixed(2)}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 text-right">
                  <button
                    onClick={() => setOverrides({ ...overrides, [c.id]: true })}
                    disabled={overrides[c.id]}
                    className="cursor-pointer rounded-md border border-[#2a2a2e] bg-[color:var(--color-border-3)] px-2.5 py-1 text-[10.5px] text-[#94a3b8] disabled:opacity-60"
                  >
                    {overrides[c.id] ? "Overridden" : "Override"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-[color:var(--color-border-3)] px-3.5 py-2.5">
          <span className="text-[11px] text-[color:var(--color-subtle)]">
            Accepting writes the plan + each assignment to the append-only audit log{personaLabel ? ` as ${personaLabel}` : ""}.
          </span>
          <button
            onClick={() => setPlanAccepted(true)}
            disabled={planAccepted}
            className="cursor-pointer rounded-md border px-4 py-2 text-[12.5px] font-semibold"
            style={{
              borderColor: planAccepted ? "#166534" : "#1e40af",
              background: planAccepted ? "#0f2a19" : "var(--color-primary-2)",
              color: planAccepted ? "#86efac" : "#fff",
            }}
          >
            {planAccepted ? "✓ Plan accepted & logged" : "Accept plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConstraintTile({
  label,
  value,
  sub,
  color,
}: Readonly<{ label: string; value: string; sub: string; color: string }>) {
  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] px-2.5 py-2">
      <div className="text-[9.5px] text-[color:var(--color-subtle)]">{label}</div>
      <div className="sgw-num mt-0.5 text-[18px] font-bold" style={{ color }}>
        {value}
      </div>
      <div className="mt-px text-[9px] text-[color:var(--color-faint)]">{sub}</div>
    </div>
  );
}
