import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

/**
 * These assertions check the top-level chrome of the Storm Cockpit only —
 * the "one-decision" content of CockpitPage itself is covered by the
 * playwright-cli smoke tests, which run against a live dev server so
 * Recharts + Leaflet + Tailwind actually render.
 */
describe("App shell", () => {
  it("renders the Storm Cockpit command bar, nav, mode toggle and platform-status strip", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ready: true,
              error: null,
              training_report: {
                risk: { model_version: "lgbm-cal-v1", metrics: { roc_auc: 0.804, brier: 0.175 }, top_features: {} },
                graph: { n_nodes: 100, n_edges: 200, n_clusters: 12, modularity: 0.901 },
              },
            }),
        } as unknown as Response),
      ),
    );
    render(<App />);
    // Brand + storm label
    expect(screen.getByText("SGW")).toBeInTheDocument();
    expect(screen.getByText(/Storm Cockpit/i)).toBeInTheDocument();
    // Mode toggle (now on the top-right, shortened labels)
    expect(screen.getByRole("button", { name: /● LIVE/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /DEBBY DEMO/i })).toBeInTheDocument();
    // Nav items
    expect(screen.getByRole("button", { name: /^Cockpit$/i, current: "page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Full map$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Scenarios$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Crew plan$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Briefing$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Audit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Governance$/i })).toBeInTheDocument();
    // Persona chips are gone — the store still holds a default persona but
    // the header switcher was removed to reclaim demo real-estate.
  });
});
