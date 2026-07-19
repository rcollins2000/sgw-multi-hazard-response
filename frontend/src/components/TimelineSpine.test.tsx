import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimelineSpine, type SpineEvent } from "./TimelineSpine";

/*
  TimelineSpine tests focus on positional math and semantics, not styling.
  The spine's positions are derived — a regression would show up as
  wrong event ordering or wrong Landfall/Now placement.
*/

const EVENTS: SpineEvent[] = [
  { t: -40, short: "A", title: "Advisory issued", color: "#f5a524" },
  { t: -6, short: "Crew", title: "Crew pre-position deadline", color: "#e8eaed" },
  { t: 12, short: "Peak", title: "Peak surge", color: "#e0245e" },
];

function positionOf(el: HTMLElement): number {
  // "left: 42.5%" → 42.5
  const match = el.style.left.match(/([\d.]+)%/);
  return match ? parseFloat(match[1]) : NaN;
}

describe("TimelineSpine", () => {
  it("renders all events with descriptive titles and the fixed markers", () => {
    render(<TimelineSpine events={EVENTS} landfallHours={6} />);
    expect(screen.getByLabelText("Advisory issued")).toBeInTheDocument();
    expect(screen.getByLabelText("Crew pre-position deadline")).toBeInTheDocument();
    expect(screen.getByLabelText("Peak surge")).toBeInTheDocument();
    expect(screen.getByText("Landfall")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("places Now < Landfall < future events on the horizontal axis", () => {
    render(<TimelineSpine events={EVENTS} landfallHours={6} />);
    const now = screen.getByText("Now").parentElement as HTMLElement;
    const landfall = screen.getByText("Landfall").parentElement as HTMLElement;
    const peak = screen.getByLabelText("Peak surge") as HTMLElement;
    expect(positionOf(now)).toBeLessThan(positionOf(landfall));
    expect(positionOf(landfall)).toBeLessThan(positionOf(peak));
  });

  it("respects the aria-label for the whole spine so it's discoverable to AT", () => {
    render(<TimelineSpine events={EVENTS} landfallHours={6} />);
    expect(screen.getByRole("figure", { name: /countdown timeline/i })).toBeInTheDocument();
  });
});
