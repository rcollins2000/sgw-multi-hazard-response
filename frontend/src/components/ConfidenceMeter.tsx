/*
  ConfidenceMeter — 5-block discrete indicator.

  Discretising confidence is deliberate: the calibrated score already lives
  next to this meter as a continuous number, so the meter's job is to convey
  the *class* (very low / low / medium / high / very high) at a glance.
  Anything more granular would compete with the numeric display.

  `level` is 0–5 (5 = fully lit). Callers derive it from a probability, the
  width of the calibration interval, or Brier-style confidence — that
  mapping lives in the caller so the primitive stays visual.
*/

type Props = Readonly<{
  level: 0 | 1 | 2 | 3 | 4 | 5;
  label?: string;
  align?: "left" | "right";
}>;

const LABEL_BY_LEVEL: Record<number, string> = {
  0: "Very low",
  1: "Low",
  2: "Medium",
  3: "Medium",
  4: "High",
  5: "Very high",
};

export function ConfidenceMeter({ level, label, align = "left" }: Props) {
  const lit = "#f5a524";
  const dim = "#3a2f14";
  const displayLabel = label ?? `Confidence · ${LABEL_BY_LEVEL[level].toLowerCase()}`;
  return (
    <div
      className={`inline-flex flex-col ${align === "right" ? "items-end" : "items-start"}`}
      data-testid="confidence-meter"
      role="meter"
      aria-label={displayLabel}
      aria-valuenow={level}
      aria-valuemin={0}
      aria-valuemax={5}
    >
      <div className="flex gap-[2px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-[5px] w-4 rounded-[1px]"
            style={{ background: i < level ? lit : dim }}
          />
        ))}
      </div>
      <span className="sgw-lbl mt-[5px]">{displayLabel}</span>
    </div>
  );
}

/**
 * Map a calibrated probability + confidence-interval half-width into a
 * discrete 0–5 meter level. Narrow intervals over stronger predictions
 * light more blocks. Intentionally simple — this is a demo primitive.
 */
export function meterLevelFromProbability(prob: number, ciHalfWidth = 0.08): 0 | 1 | 2 | 3 | 4 | 5 {
  const strength = Math.max(prob, 1 - prob);
  const tightness = Math.max(0, 1 - ciHalfWidth / 0.2);
  const combined = 0.6 * strength + 0.4 * tightness;
  if (combined >= 0.9) return 5;
  if (combined >= 0.78) return 4;
  if (combined >= 0.65) return 3;
  if (combined >= 0.52) return 2;
  if (combined >= 0.35) return 1;
  return 0;
}
