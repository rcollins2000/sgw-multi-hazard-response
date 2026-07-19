import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfidenceMeter, meterLevelFromProbability } from "./ConfidenceMeter";

describe("ConfidenceMeter", () => {
  it("renders as an accessible role=meter with 0–5 bounds", () => {
    render(<ConfidenceMeter level={4} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "4");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
  });

  it("shows the appropriate label for the level", () => {
    render(<ConfidenceMeter level={5} />);
    expect(screen.getByText(/very high/i)).toBeInTheDocument();
  });

  it("accepts a custom label override", () => {
    render(<ConfidenceMeter level={2} label="Custom label" />);
    expect(screen.getByText("Custom label")).toBeInTheDocument();
  });
});

describe("meterLevelFromProbability", () => {
  it("returns high levels for strong, tight predictions", () => {
    expect(meterLevelFromProbability(0.91, 0.05)).toBeGreaterThanOrEqual(4);
  });
  it("returns low levels for ambiguous, wide predictions", () => {
    expect(meterLevelFromProbability(0.51, 0.2)).toBeLessThanOrEqual(2);
  });
  it("stays within 0..5", () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const lv = meterLevelFromProbability(p, 0.1);
      expect(lv).toBeGreaterThanOrEqual(0);
      expect(lv).toBeLessThanOrEqual(5);
    }
  });
});
