/*
  CopilotPullQuote — the amber-left-border "Copilot recommends" card.

  This is the visual grammar for the LLM's role on the cockpit surface:
    - amber accent = it belongs to the copilot, not the operator
    - "Copilot recommends" eyebrow makes advisory intent unambiguous
    - the recommendation is a short imperative sentence
    - evidence chips beneath cite the source records the LLM used

  The design is deliberate about honesty: the LLM never produces the risk
  score, forecast, or optimisation plan (see docs/03_prd.md §5 "LLM
  boundaries"). This component reinforces that split by never rendering
  numeric outputs — only prose + citations.
*/

type Props = Readonly<{
  recommendation: string;
  evidence?: string[];
  timestamp?: string;
  modelLabel?: string;
}>;

import { useAppStore } from "../stores/appStore";

export function CopilotPullQuote({
  recommendation,
  evidence = [],
  timestamp,
  modelLabel,
}: Props) {
  const storeLabel = useAppStore((s) => s.llm?.label);
  const effectiveLabel = modelLabel ?? (storeLabel ? `${storeLabel} · structured` : "loading…");
  return (
    <div
      className="border-l-2 border-[color:var(--color-signature)] py-[2px] pl-[14px]"
      data-testid="copilot-pull-quote"
      role="note"
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="sgw-lbl text-[color:var(--color-signature)]">Copilot recommends</span>
        {timestamp && (
          <span className="sgw-mono text-[9.5px] text-[color:var(--color-faint)]">
            · {timestamp}
          </span>
        )}
      </div>
      <div className="text-[16px] font-medium leading-[1.4]">{recommendation}</div>
      {evidence.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {evidence.map((e) => (
            <span
              key={e}
              className="sgw-mono rounded-[3px] border border-[color:var(--color-border)] px-1.5 py-[2px] text-[10px] text-[color:var(--color-subtle)]"
            >
              {e}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 text-[9.5px] text-[color:var(--color-faint)]">
        <span className="sgw-mono">{effectiveLabel}</span> · advisory · schema-validated
      </div>
    </div>
  );
}
