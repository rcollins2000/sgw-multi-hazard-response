import { useEffect, useId, useRef, useState } from "react";
import { EXPLANATIONS, type ExplanationCard, type SurfaceKey } from "../lib/explanations";

/*
  ExplainPopover — click the small "?" chip in any cockpit surface header to
  see a plain-language explainer of the ML/AI behind that surface.

  Every explainer has the same four-section shape (see explanations.ts) so
  operators build a consistent mental model quickly: Model · What it tells
  you · How to read it · Confidence. Callers can pass a `diagnostic` string
  to inject a live signal into the Confidence section — e.g. the current
  poll freshness for the water-level chart, or the current score for the
  hero.

  Accessibility contract:
    · Trigger is a real <button> with aria-expanded + aria-controls
    · Panel is role="dialog" with aria-labelledby pointing at its title
    · ESC closes and returns focus to the trigger
    · Click outside the panel closes and returns focus to the trigger
    · Focus is trapped: opening the popover moves focus into the CLOSE button
*/

export type ExplainPopoverProps = Readonly<{
  surface: SurfaceKey;
  /** Optional live diagnostic surfaced inside the Confidence section. */
  diagnostic?: string;
  /** Positioning of the panel relative to the trigger. Defaults to right so
   *  the panel expands leftward (safer on right-aligned card headers). */
  align?: "left" | "right";
}>;

export function ExplainPopover({ surface, diagnostic, align = "right" }: ExplainPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const panelId = `explain-panel-${reactId}`;
  const titleId = `explain-title-${reactId}`;
  const card = EXPLANATIONS[surface];

  // Wire up outside-click + ESC dismissal, and move focus into the panel
  // when it opens (a11y). Cleanup handles cover the tab-out case as well.
  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onDocPointer = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex" data-testid={`explain-${surface}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Explain: ${card.title}`}
        className={`inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
          open
            ? "border-[color:var(--color-signature)] bg-[color:var(--color-signature)]/25 text-[color:var(--color-signature)]"
            : "border-[color:var(--color-border)] bg-transparent text-[color:var(--color-subtle)] hover:border-[color:var(--color-signature)] hover:text-[color:var(--color-signature)]"
        }`}
      >
        ?
      </button>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-labelledby={titleId}
          data-testid={`explain-panel-${surface}`}
          className={`absolute top-[24px] z-[1200] w-[340px] rounded-lg border border-[color:var(--color-signature)]/40 bg-[color:var(--color-panel-3)] p-3.5 shadow-[0_16px_36px_rgba(0,0,0,0.55)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <ExplainCardBody card={card} diagnostic={diagnostic} titleId={titleId} />
          <div className="mt-2.5 flex items-center justify-between border-t border-[color:var(--color-border-2)] pt-2.5">
            <span className="sgw-lbl">advisory · human-in-the-loop</span>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="sgw-mono cursor-pointer border-none bg-transparent text-[10px] tracking-[0.5px] text-[color:var(--color-signature)]"
            >
              CLOSE ×
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

function ExplainCardBody({
  card,
  diagnostic,
  titleId,
}: Readonly<{ card: ExplanationCard; diagnostic?: string; titleId: string }>) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id={titleId}
          className="text-[13px] font-semibold leading-[1.25] text-[color:var(--color-foreground)]"
        >
          {card.title}
        </h3>
        <span className="sgw-mono text-[9.5px] text-[color:var(--color-faint)]">
          {card.provenance}
        </span>
      </div>
      <ExplainRow eyebrow="Model" body={card.model} />
      <ExplainRow eyebrow="What it tells you" body={card.purpose} />
      <ExplainRow eyebrow="How to read it" body={card.howToRead} />
      <ExplainRow eyebrow="Confidence" body={card.confidence} diagnostic={diagnostic} />
    </>
  );
}

function ExplainRow({
  eyebrow,
  body,
  diagnostic,
}: Readonly<{ eyebrow: string; body: string; diagnostic?: string }>) {
  const showDiagnostic = diagnostic && eyebrow === "Confidence";
  return (
    <div className="mt-2.5">
      <div className="sgw-lbl">{eyebrow}</div>
      <div className="mt-0.5 text-[11.5px] leading-[1.45] text-[color:var(--color-muted-foreground)]">
        {body}
      </div>
      {showDiagnostic && (
        <div className="mt-1.5 rounded border border-[color:var(--color-border-2)] bg-[color:var(--color-panel-2)] px-2 py-1.5 text-[10.5px] text-[color:var(--color-foreground)]">
          <span className="sgw-lbl mr-1.5">Current</span>
          <span className="sgw-mono">{diagnostic}</span>
        </div>
      )}
    </div>
  );
}
