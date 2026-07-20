import { useEffect, useState } from "react";
import { api, type StatusResponse } from "./lib/api";
import { fmtLondonClock } from "./lib/labels";
import { CockpitPage } from "./pages/CockpitPage";
import { OverviewPage } from "./pages/OverviewPage";
import { CrewPage } from "./pages/CrewPage";
import { GovernancePage } from "./pages/GovernancePage";
import { AuditPage } from "./pages/AuditPage";
import { BriefingPage } from "./pages/BriefingPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { useAppStore } from "./stores/appStore";
import { DataSourcesPopover } from "./components/DataSourcesPopover";
import { AlignmentBadge } from "./components/AlignmentBadge";

/*
  App shell — v2 "Storm Cockpit".

  Layout is a single vertical stack:
    ┌────────────────────────────────────────────────────────────────┐
    │  CommandBar  (SGW · storm label · nav · mode toggle · clock)   │
    ├────────────────────────────────────────────────────────────────┤
    │  Screen                                                        │
    └────────────────────────────────────────────────────────────────┘

  The sidebar from v1 was intentionally removed — the cockpit's thesis is
  "one decision at a time", and a persistent left sidebar diluted that.
  Platform status is surfaced as a tiny chip in the command bar's overflow
  row, not a persistent panel.
*/

type Screen = "cockpit" | "map" | "scenarios" | "crew" | "briefing" | "audit" | "governance";

const NAV: { key: Screen; label: string }[] = [
  { key: "cockpit", label: "Cockpit" },
  { key: "map", label: "Full map" },
  { key: "scenarios", label: "Scenarios" },
  { key: "crew", label: "Crew plan" },
  { key: "briefing", label: "Briefing" },
  { key: "audit", label: "Audit" },
  { key: "governance", label: "Governance" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("cockpit");
  // Persona lives in the store so pages can read it, but the UI switcher is
  // gone — the persona-specific views weren't populated enough to justify the
  // header real-estate. The store still defaults to 'noc' so downstream
  // components that condition on persona keep working.
  const persona = useAppStore((s) => s.persona);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [clock, setClock] = useState(fmtLondonClock());
  const [showSources, setShowSources] = useState(false);
  const setLlm = useAppStore((s) => s.setLlm);

  useEffect(() => {
    const load = () =>
      api
        .status()
        .then((s) => {
          setStatus(s);
          if (s.llm) setLlm(s.llm);
        })
        .catch(console.error);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [setLlm]);

  useEffect(() => {
    const t = setInterval(() => setClock(fmtLondonClock()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[color:var(--color-background)]">
      <CommandBar
        screen={screen}
        setScreen={setScreen}
        clock={clock}
        mode={mode}
        setMode={setMode}
        status={status}
        openSources={() => setShowSources(true)}
      />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {screen === "cockpit" && <CockpitPage onExpandMap={() => setScreen("map")} />}
        {screen === "map" && <OverviewPage persona={persona} />}
        {screen === "scenarios" && <ScenariosPage />}
        {screen === "crew" && <CrewPage persona={persona} />}
        {screen === "briefing" && <BriefingPage />}
        {screen === "audit" && <AuditPage />}
        {screen === "governance" && <GovernancePage />}
      </main>
      {showSources && <DataSourcesPopover onClose={() => setShowSources(false)} />}
    </div>
  );
}

// ------------------------------ command bar ------------------------------

function CommandBar({
  screen,
  setScreen,
  clock,
  mode,
  setMode,
  status,
  openSources,
}: Readonly<{
  screen: Screen;
  setScreen: (s: Screen) => void;
  clock: { time: string; zone: "BST" | "GMT" };
  mode: "live" | "demo_debby";
  setMode: (m: "live" | "demo_debby") => void;
  status: StatusResponse | null;
  openSources: () => void;
}>) {
  const isDemo = mode === "demo_debby";
  const risk = status?.training_report.risk;
  const graph = status?.training_report.graph;

  return (
    <header className="shrink-0 border-b border-[color:var(--color-border)] bg-[color:var(--color-panel)]">
      {/* Row 1 — brand + storm label · nav · mode toggle + clock (top-right) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 rounded-full bg-[color:var(--color-signature)] shadow-[0_0_12px_var(--color-signature)]"
              style={{ animation: "sgwpulse 2s infinite" }}
              aria-hidden
            />
            <span className="text-[14px] font-semibold tracking-[0.3px]">SGW</span>
            <span className="sgw-lbl text-[color:var(--color-subtle)]">Storm Cockpit</span>
          </div>
          <div className="h-[22px] w-px bg-[color:var(--color-border)]" />
          {isDemo ? (
            <div className="flex items-baseline gap-2.5">
              <span className="text-[14px] font-semibold">Hurricane Debby</span>
              <span className="sgw-mono text-[11px] text-[color:var(--color-subtle)]">
                AL042024 · Cat 1
              </span>
            </div>
          ) : (
            <span className="sgw-mono text-[11px] text-[color:var(--color-subtle)]">
              Live NWS feed · SC / GA / NC
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex gap-0.5" role="navigation" aria-label="Primary">
            {NAV.map((n) => {
              const active = screen === n.key;
              return (
                <button
                  key={n.key}
                  onClick={() => setScreen(n.key)}
                  aria-current={active ? "page" : undefined}
                  className={`sgw-mono cursor-pointer whitespace-nowrap rounded-md border-none px-2.5 py-1.5 text-[10.5px] font-medium tracking-[0.5px] ${
                    active
                      ? "bg-[color:var(--color-muted)] text-[color:var(--color-signature)]"
                      : "bg-transparent text-[color:var(--color-subtle)] hover:text-[color:var(--color-foreground)]"
                  }`}
                >
                  {n.label}
                </button>
              );
            })}
          </nav>
          <div className="h-[22px] w-px bg-[color:var(--color-border)]" />
          <div
            className="inline-flex rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] p-[2px]"
            role="group"
            aria-label="Data source mode"
          >
            <button
              onClick={() => setMode("live")}
              aria-pressed={!isDemo}
              className={`sgw-mono cursor-pointer rounded px-2 py-[3px] text-[10px] font-bold tracking-[0.3px] ${
                !isDemo
                  ? "bg-[color:var(--color-success)]/25 text-[color:var(--color-success)]"
                  : "text-[color:var(--color-muted-foreground)]"
              }`}
            >
              ● LIVE
            </button>
            <button
              onClick={() => setMode("demo_debby")}
              aria-pressed={isDemo}
              className={`sgw-mono cursor-pointer rounded px-2 py-[3px] text-[10px] font-bold tracking-[0.3px] ${
                isDemo
                  ? "bg-[color:var(--color-signature)]/20 text-[color:var(--color-signature)]"
                  : "text-[color:var(--color-muted-foreground)]"
              }`}
              title="Replay Hurricane Debby (Aug 2024)"
            >
              DEBBY DEMO
            </button>
          </div>
          <AlignmentBadge />
          <div
            className="sgw-mono flex items-center gap-1.5 text-[12px] text-[color:var(--color-subtle)]"
            aria-label={`Europe/London clock ${clock.time} ${clock.zone}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-success)]"
              style={{ animation: "sgwblink 1.6s infinite" }}
              aria-hidden
            />
            {clock.time} {clock.zone}
          </div>
        </div>
      </div>

      {/* Row 2 — tiny platform-status strip (was the sidebar footer in v1) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] px-4 py-1.5 text-[10.5px] text-[color:var(--color-muted-foreground)]">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status?.ready ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-warning)]"
            }`}
          />
          <span>{platformStatusLabel(status)}</span>
        </div>
        <StatusChip k="risk model" v={risk?.model_version ?? "—"} />
        <StatusChip k="ROC-AUC" v={fmtMetric(risk?.metrics, "roc_auc")} />
        <StatusChip k="Brier" v={fmtMetric(risk?.metrics, "brier")} />
        <StatusChip k="graph mod." v={graph?.modularity?.toFixed(3) ?? "—"} />
        <StatusChip k="copilot" v={status?.llm?.label ?? "—"} />
        <div className="ml-auto">
          <button
            onClick={openSources}
            className="sgw-mono cursor-pointer rounded border border-[color:var(--color-border)] bg-transparent px-2 py-[3px] text-[10px] tracking-[0.5px] text-[color:var(--color-subtle)] hover:border-[color:var(--color-signature)] hover:text-[color:var(--color-signature)]"
          >
            DATA SOURCES ↗
          </button>
        </div>
      </div>
    </header>
  );
}

// ------------------------------ helpers ------------------------------

function StatusChip({ k, v }: Readonly<{ k: string; v: React.ReactNode }>) {
  return (
    <span className="sgw-mono">
      <span className="text-[color:var(--color-faint)]">{k}</span>
      <span className="ml-1 text-[color:var(--color-muted-foreground)]">{v}</span>
    </span>
  );
}

function fmtMetric(metrics: Record<string, number> | undefined, key: string): string {
  const v = metrics?.[key];
  if (typeof v !== "number") return "—";
  return v.toFixed(3);
}

function platformStatusLabel(status: StatusResponse | null): string {
  if (status?.ready) return "Models ready";
  if (status?.error) return "Error";
  return "Loading models…";
}
