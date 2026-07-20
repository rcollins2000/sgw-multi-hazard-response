import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExplainPopover } from "./ExplainPopover";
import { EXPLANATIONS, type SurfaceKey } from "../lib/explanations";

/*
  Tests cover the three axes that would show up as UX regressions:
    · a11y contract (aria-expanded flips, role=dialog, aria-labelledby wired)
    · dismissal paths (ESC, close button, click outside)
    · catalog integrity (every SurfaceKey has non-empty content)
*/

describe("ExplainPopover", () => {
  it("renders the trigger with the surface title in its aria-label", () => {
    render(<ExplainPopover surface="risk_score" />);
    const btn = screen.getByRole("button", { name: /Explain: Hazard-conditional risk score/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on click and exposes a role=dialog with the surface title", () => {
    render(<ExplainPopover surface="water_forecast" />);
    const trigger = screen.getByRole("button", { name: /Explain: Water-level forecast/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(/Water-level forecast/i);
    expect(dialog).toHaveTextContent(/Prophet/);
  });

  it("closes on ESC and returns focus to the trigger", () => {
    render(<ExplainPopover surface="confidence_meter" />);
    const trigger = screen.getByRole("button", { name: /Explain: Confidence meter/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on the CLOSE × button", () => {
    render(<ExplainPopover surface="copilot_recommendation" />);
    fireEvent.click(screen.getByRole("button", { name: /Explain: Copilot recommendation/i }));
    fireEvent.click(screen.getByRole("button", { name: /CLOSE/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on outside pointer down", () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <ExplainPopover surface="mini_map" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Explain: Map — cone/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the diagnostic string inside the Confidence section", () => {
    render(<ExplainPopover surface="risk_score" diagnostic="0.91 (critical) ±0.05" />);
    fireEvent.click(screen.getByRole("button", { name: /Explain: Hazard-conditional risk score/i }));
    expect(screen.getByText(/0.91 \(critical\)/)).toBeInTheDocument();
  });
});

describe("EXPLANATIONS catalog", () => {
  const KEYS: SurfaceKey[] = [
    "risk_score",
    "preventative_priority",
    "confidence_meter",
    "copilot_recommendation",
    "feature_drivers",
    "water_forecast",
    "mini_map",
    "watchlist",
    "timeline_spine",
    "live_baseline",
    "model_provenance",
    "feature_contributions",
    "dependency_cascade",
    "evidence_citations",
    "scenario_analysis",
    "alignment_layer",
  ];

  it.each(KEYS)("has non-empty content for surface %s", (key) => {
    const card = EXPLANATIONS[key];
    expect(card).toBeDefined();
    for (const field of ["title", "model", "purpose", "howToRead", "confidence", "provenance"] as const) {
      expect(card[field], `field ${field} must be non-empty`).toBeTruthy();
      expect(card[field].length).toBeGreaterThan(4);
    }
  });
});
