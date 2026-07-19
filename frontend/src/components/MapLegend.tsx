export function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel)]/95 px-3 py-2.5 text-xs backdrop-blur">
      <div className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.7px] text-[color:var(--color-subtle)]">
        Asset risk (calibrated)
      </div>
      <div className="flex gap-3">
        <div className="flex flex-col gap-1">
          <LegendDot color="#e0245e" label="Critical ≥ .75" />
          <LegendDot color="#f2711c" label="High .50–.75" />
        </div>
        <div className="flex flex-col gap-1">
          <LegendDot color="#f5a524" label="Moderate .30–.50" />
          <LegendDot color="#64748b" label={"Low < .30"} />
        </div>
      </div>
      <div className="mt-1.5 text-[9.5px] text-[color:var(--color-faint)]">
        Marker size ∝ risk · colourblind-safe amber→rose ramp
      </div>
    </div>
  );
}

function LegendDot({ color, label }: Readonly<{ color: string; label: string }>) {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] text-[#d4d4d4]">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
