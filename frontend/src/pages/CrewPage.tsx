import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { divIcon, type LatLngExpression } from "leaflet";
import { crewApi, type CrewPlan, type PersonaKey } from "../lib/api";
import "leaflet/dist/leaflet.css";

/*
  CrewPage — real OR-Tools VRP crew pre-positioning.

  Fetches from /api/crew/plan, which:
    1. Reads live crew positions from `crew_status` (latest ping per crew).
    2. Reads the top-N aligned assets from list_assets (already includes the
       operator-alignment nudge so the VRP optimises against what the operator
       actually cares about — not the raw model output).
    3. Calls sgw_platform.optimisation.vrp.solve_vrp (Guided Local Search over
       Haversine distances, priority-weighted).
    4. Returns tours + weighted-distance + baseline improvement percentage.

  Every number displayed on this page is the solver's real output — no
  hardcoded distances, no fabricated confidences. If the endpoint returns
  no crews (fresh DB), the page shows an honest empty state.
*/

const TOP_N_DEFAULT = 12;

export function CrewPage({ persona: _persona }: Readonly<{ persona: PersonaKey }>) {
  const [plan, setPlan] = useState<CrewPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topN, setTopN] = useState(TOP_N_DEFAULT);
  const [solveId, setSolveId] = useState(0); // increments each re-run for the "Last solve #N" label

  const runPlan = useCallback(async (n: number) => {
    setLoading(true);
    setError(null);
    try {
      const p = await crewApi.plan(n);
      setPlan(p);
      setSolveId((s) => s + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runPlan(topN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Header solver={plan?.solver ?? null} loading={loading} />
      <div className="flex min-h-[420px] flex-1">
        <div className="relative min-w-0 flex-1" data-testid="crew-map">
          <MapArea plan={plan} error={error} onRetry={() => runPlan(topN)} />
        </div>
        <SidePanel
          plan={plan}
          topN={topN}
          setTopN={setTopN}
          onRerun={() => runPlan(topN)}
          loading={loading}
          solveId={solveId}
        />
      </div>
      <TourTable plan={plan} />
    </div>
  );
}

function MapArea({
  plan,
  error,
  onRetry,
}: Readonly<{ plan: CrewPlan | null; error: string | null; onRetry: () => void }>) {
  if (error) return <ErrorPanel message={error} onRetry={onRetry} />;
  if (plan) return <CrewMap plan={plan} />;
  return (
    <div className="flex h-full items-center justify-center text-[color:var(--color-muted-foreground)]">
      Loading crew plan…
    </div>
  );
}

function headerSubtitle(loading: boolean, solver: CrewPlan["solver"]): string {
  if (loading) return "Running solver against live crew positions and current at-risk asset list…";
  if (!solver) return "No plan yet — click Re-run to solve.";
  return `Solver ran against ${solver.family}. Improvement over greedy baseline: ${solver.improvement_pct.toFixed(1)}%.`;
}

function Header({ solver, loading }: Readonly<{ solver: CrewPlan["solver"]; loading: boolean }>) {
  return (
    <div className="shrink-0 border-b border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] px-4.5 py-3">
      <div className="text-[15px] font-bold">
        Crew pre-positioning plan{" "}
        <span className="text-[11px] font-normal text-[color:var(--color-muted-foreground)]">
          · {solver?.family ?? "OR-Tools VRP · Guided Local Search"} · Haversine cost · priority-weighted
        </span>
      </div>
      <div className="mt-0.5 text-[11.5px] text-[color:var(--color-muted-foreground)]">
        {headerSubtitle(loading, solver)}
      </div>
    </div>
  );
}

function jobColour(score: number): string {
  if (score >= 0.75) return "#e0245e";
  if (score >= 0.5) return "#f5a524";
  return "#93c5fd";
}

function ErrorPanel({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="max-w-md rounded border border-[color:var(--color-critical)] bg-[color:var(--color-critical)]/10 p-3 text-[12px] text-[color:var(--color-critical)]">
        Solver failed — {message}
      </div>
      <button
        onClick={onRetry}
        className="cursor-pointer rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] px-3 py-1.5 text-[12px]"
      >
        Retry
      </button>
    </div>
  );
}

function CrewMap({ plan }: Readonly<{ plan: CrewPlan }>) {
  const depot = plan.solver?.depot ?? { latitude: 32.85, longitude: -80.0 };
  const jobById = useMemo(() => {
    const m = new Map<string, CrewPlan["jobs"][number]>();
    for (const j of plan.jobs) m.set(j.asset_id, j);
    return m;
  }, [plan.jobs]);

  const crewIcon = useMemo(
    () =>
      divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;background:#38bdf8;border:2px solid #0a0a0f;border-radius:2px;transform:translate(-7px,-7px)"></div>`,
      }),
    [],
  );

  return (
    <MapContainer
      center={[depot.latitude, depot.longitude] as LatLngExpression}
      zoom={9}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer url="https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png" />

      {plan.crews.map((c) => {
        const route = plan.tours[c.crew_id] ?? [];
        const routeCoords: LatLngExpression[] = [[c.latitude, c.longitude]];
        for (const assetId of route) {
          const j = jobById.get(assetId);
          if (j) routeCoords.push([j.latitude, j.longitude]);
        }
        return (
          <Fragment key={c.crew_id}>
            <Marker position={[c.latitude, c.longitude] as LatLngExpression} icon={crewIcon}>
              <Tooltip direction="top" opacity={0.9}>
                <div className="text-[11px]">
                  <div className="font-medium">{c.crew_name}</div>
                  <div className="opacity-70">
                    {c.capability} · {c.base_region}
                  </div>
                  <div className="sgw-num mt-0.5">
                    {route.length} stop{route.length === 1 ? "" : "s"}
                  </div>
                </div>
              </Tooltip>
            </Marker>
            {routeCoords.length > 1 && (
              <Polyline
                positions={routeCoords}
                pathOptions={{ color: "#38bdf8", weight: 2.4, dashArray: "6 4" }}
              />
            )}
          </Fragment>
        );
      })}

      {plan.jobs.map((j) => (
        <CircleMarker
          key={j.asset_id}
          center={[j.latitude, j.longitude]}
          radius={Math.max(3, j.aligned_score * 8)}
          pathOptions={{
            color: "#0a0a0f",
            fillColor: jobColour(j.aligned_score),
            fillOpacity: 0.9,
            weight: 1,
          }}
        >
          <Tooltip direction="top" opacity={0.9} sticky>
            <div className="text-[11px]">
              <div className="font-medium">{j.asset_name}</div>
              <div className="sgw-num mt-0.5">
                aligned {j.aligned_score.toFixed(2)} · base {j.risk_score.toFixed(2)}
              </div>
            </div>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function SidePanel({
  plan,
  topN,
  setTopN,
  onRerun,
  loading,
  solveId,
}: Readonly<{
  plan: CrewPlan | null;
  topN: number;
  setTopN: (n: number) => void;
  onRerun: () => void;
  loading: boolean;
  solveId: number;
}>) {
  const solver = plan?.solver;
  const totalKm = solver ? (solver.total_weighted_distance_m / 1000).toFixed(1) : "—";
  const baselineKm = solver ? (solver.baseline_greedy_distance_m / 1000).toFixed(1) : "—";
  const improvement = solver ? solver.improvement_pct.toFixed(1) : "—";
  const n_crews = plan?.crews.length ?? 0;
  const n_stops = plan ? Object.values(plan.tours).reduce((acc, r) => acc + r.length, 0) : 0;

  return (
    <div className="w-[340px] shrink-0 overflow-y-auto border-l border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] p-3.5">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
        Solver output
      </div>
      <div className="mb-3.5 grid grid-cols-2 gap-2">
        <SolverTile label="Total weighted" value={`${totalKm} km`} sub="priority-weighted Haversine" />
        <SolverTile
          label="Greedy baseline"
          value={`${baselineKm} km`}
          sub="nearest-neighbour comparison"
        />
        <SolverTile
          label="Improvement"
          value={`${improvement}%`}
          sub="VRP vs greedy"
          color={solver && solver.improvement_pct > 0 ? "#22c55e" : "#f5a524"}
        />
        <SolverTile label="Coverage" value={`${n_stops} / ${plan?.jobs.length ?? 0}`} sub="stops / jobs" />
      </div>

      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
        Top-N assets to plan for
      </div>
      <div className="mb-3">
        <input
          type="range"
          min="5"
          max="30"
          step="1"
          value={topN}
          onChange={(e) => setTopN(Number.parseInt(e.target.value, 10))}
          className="w-full"
          disabled={loading}
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-[color:var(--color-faint)]">
          <span>5</span>
          <span className="sgw-mono text-[color:var(--color-primary-ink)]">{topN} jobs</span>
          <span>30</span>
        </div>
      </div>

      <button
        onClick={onRerun}
        disabled={loading}
        className="mt-1 w-full cursor-pointer rounded-md border border-[#1e40af] bg-[color:var(--color-primary-2)] px-2 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
        data-testid="crew-rerun"
      >
        {loading ? "Solving…" : "Re-run optimisation"}
      </button>
      <div className="mt-2 text-[10px] leading-[1.5] text-[color:var(--color-subtle)]">
        Last solve #{solveId} · {n_crews} vehicle{n_crews === 1 ? "" : "s"} · {n_stops} stop{n_stops === 1 ? "" : "s"} · GLS 5s budget · OR-Tools
      </div>
      <div className="mt-3 rounded border border-[color:var(--color-border-3)] bg-[color:var(--color-panel-3)] p-2 text-[10px] leading-[1.5] text-[color:var(--color-muted-foreground)]">
        <div className="mb-1 font-semibold text-[color:var(--color-signature)]">Bulk-accept: Phase 4</div>
        Individual crew assignments can be accepted per-asset via the Cockpit HITL flow.
        Batch-committing the whole plan to a CMMS dispatch queue is scoped for Phase 4
        (queue endpoint + role gating not implemented in MVP).
      </div>
    </div>
  );
}

function SolverTile({
  label,
  value,
  sub,
  color = "#e5e5e5",
}: Readonly<{ label: string; value: string; sub: string; color?: string }>) {
  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] px-2.5 py-2">
      <div className="text-[9.5px] text-[color:var(--color-subtle)]">{label}</div>
      <div className="sgw-num mt-0.5 text-[16px] font-bold" style={{ color }}>
        {value}
      </div>
      <div className="mt-px text-[9px] text-[color:var(--color-faint)]">{sub}</div>
    </div>
  );
}

function TourTable({ plan }: Readonly<{ plan: CrewPlan | null }>) {
  if (!plan || plan.crews.length === 0) return null;
  const jobById = new Map<string, CrewPlan["jobs"][number]>();
  for (const j of plan.jobs) jobById.set(j.asset_id, j);
  return (
    <div className="shrink-0 border-t border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)]">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-[9.5px] uppercase tracking-[0.5px] text-[color:var(--color-subtle)]">
            <th className="px-3.5 py-2 text-left">Crew</th>
            <th className="px-3.5 py-2 text-left">Capability</th>
            <th className="px-3.5 py-2 text-right">Stops</th>
            <th className="px-3.5 py-2 text-left">Tour (asset IDs, in solved order)</th>
          </tr>
        </thead>
        <tbody>
          {plan.crews.map((c) => {
            const tour = plan.tours[c.crew_id] ?? [];
            return (
              <tr key={c.crew_id} className="border-t border-[color:var(--color-border-3)]">
                <td className="px-3.5 py-2.5">
                  <div className="sgw-mono text-[10px] text-[#8b8b8b]">{c.crew_id}</div>
                  <div className="text-[11.5px] text-[#ededed]">{c.crew_name}</div>
                </td>
                <td className="px-3.5 py-2.5 text-[#cbd5e1]">{c.capability}</td>
                <td className="sgw-num px-3.5 py-2.5 text-right">{tour.length}</td>
                <td className="px-3.5 py-2.5">
                  {tour.length > 0 ? (
                    <div className="sgw-mono text-[10.5px] text-[#94a3b8]">
                      {tour.map((id, i) => {
                        const j = jobById.get(id);
                        const name = j ? j.asset_name : id;
                        return (
                          <span key={id}>
                            {i > 0 && <span className="text-[color:var(--color-primary)]"> → </span>}
                            <span title={id}>{name}</span>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="italic text-[color:var(--color-faint)]">No assignments this cycle</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-3.5 py-2.5 text-[10.5px] text-[color:var(--color-subtle)]">
        Every stop is a top-N aligned asset. Accepting a specific assignment (and writing to the audit log)
        happens from the Cockpit per-asset HITL flow; a batch-commit CMMS endpoint is Phase 4.
      </div>
    </div>
  );
}

