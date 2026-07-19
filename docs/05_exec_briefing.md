# Executive briefing — Multi-Hazard Readiness & Response

**Audience:** SGW senior leadership and decision-makers
**Author:** Reuben Collins
**Date:** 2026-07-19
**Status:** v1.0 — drafted after the MVP demo was validated end-to-end, so every claim below is anchored to something the prototype actually does
**Length:** 2–3 pages. Appendix A maps this briefing onto a presentation deck.

> **How to read the figures.** Every number in this briefing carries a provenance mark, mirroring the platform's own data-source labelling: **●** measured (real, from the prototype or public data), **◐** demonstrated (working in the prototype on disclosed mock/replay data), **○** illustrative target (pending validation against SGW's own data).

---

## 1. Strategic business value

During a severe-weather event today, SGW's operational picture lives in the operator's short-term memory. Asset data, maintenance history, live telemetry and crew status sit in four separately procured systems with four different asset identifiers, and external weather intelligence arrives piecemeal — so assembling "what is happening, to which assets, with which crews available" takes an experienced operator 15–20 minutes ○ across four to seven screens, at exactly the moment minutes matter most.

The platform changes that posture from reactive to proactive. It unifies the fragmented data into a single operational picture, applies the right analytical tool to each sub-problem — risk scoring per asset under the specific hazard, water-level and demand forecasting with uncertainty, anomaly detection on live telemetry, optimised crew pre-positioning, cascading-impact analysis — and explains every recommendation in plain language with cited evidence. Target: a full operational picture in under 3 minutes ○, and preventative work orders raised up to 48 hours earlier ○ in the pre-event window, when crews and materials are still cheap to move.

Three pressures make this a now-decision rather than a someday-decision: climate-driven event frequency across SGW's SC/GA/NC footprint (8M+ residents ●); insurers and public utility commissions increasingly requiring *demonstrable* resilience posture, not assurances; and the fact that unplanned outages, storm overtime and reactive maintenance are SGW's largest controllable cost lines.

**The operating principle, stated up front because it drives adoption and regulatory acceptance: the AI is a copilot, never an autopilot.** It never takes an operational action. Every recommendation is advisory, arrives with visible confidence and cited evidence, and requires a named human in the appropriate role to accept, override or defer — with every decision captured in a tamper-evident audit ledger. This is a decision-support platform, not a chatbot and not automation.

This is not a concept: a working prototype ran Hurricane Debby (August 2024) end-to-end on real NOAA data — 2,880 real water-level observations ●, live weather alerts polled every 60 seconds ● (24 active at the last demo run ●), through recommendation → operator decision → immutable audit entry ◐, backed by 63 automated tests ●.

## 2. Financial implications & ROI

**Where the money goes today.** Four controllable drivers: storm restoration and overtime; unplanned-outage customer-hours (with regulatory and reputational exposure attached); the reactive-maintenance premium — emergency work routinely costs a multiple of the same work done planned; and insurance premiums that keep rising when resilience cannot be evidenced.

**Where the platform moves the needle** (12-month post-MVP targets ○, from the PRD):

| Lever | Target |
|---|---|
| Avoided outage customer-hours per major event | −20% |
| Lead time on preventative work orders during events | +48 h |
| Crew utilisation in the pre-event window | +25% |
| Mean time to restore during storm events | −15% |

**Illustrative payback logic** — figures are deliberately order-of-magnitude and pending SGW cost data; validating them is week one of the engagement. For a utility of SGW's scale, assume two to three major events per season and a mid-eight-figure annual controllable spend across storm response and reactive maintenance. Hitting the target ranges above is worth low-to-mid seven figures per season; an MVP build plus first-year run is a mid-seven-figure investment — payback inside the first full storm season, with the routine-maintenance workflow (the same ranking and feedback machinery, running 365 days a year) compounding the return outside storm season.

Two structural points leadership should note. First, the data-integration layer produces ROI before any AI runs: resolving the "which system is right?" problem is an immediate operational saving. Second, we will report an *operator override rate* with a target band of 15–25% ○ — too low signals blind trust, too high signals no value. We measure whether your people *should* trust the platform, not just whether they use it.

## 3. Delivery roadmap and dependencies

**Phase 1 (months 0–6) — Pre-event MVP on SGW data.** Harden the prototype against SGW's real asset registry, maintenance history and telemetry; one-region pilot; all four hazards (hurricane, flood, heatwave, wildfire). The first deliverable is the data foundation — ID crosswalk, data-quality flags, freshness metadata — which pays for itself independently.

**Phase 2 (months 6–12) — During-event triage.** Live telemetry anomaly response; integration of accepted recommendations into SGW's existing maintenance system (work-order creation) and crew dispatch; higher-fidelity forecast feeds.

**Phase 3 (months 12–18) — Post-event and full footprint.** Damage assessment from post-event aerial imagery (computer vision); restoration sequencing; expansion across the full SC/GA/NC footprint.

**What SGW must invest even if AECOM delivers the AI layer:** data access and a named data steward from day one; integration effort on the GIS and maintenance-system side; and — deliberately scheduled as work, not assumed — NOC change management: operator training, trust-building, and the authority model for who accepts what. The platform degrades gracefully if data quality is below assumption (wider uncertainty bands, more human review, never silent failure), but the roadmap is honest that data maturity is the pacing item.

## 4. Governance & compliance

The platform is designed to survive an audit, not just a demo.

- **Human in the loop, non-negotiable.** Crew dispatch is confirmed by a field supervisor; asset shutdown by the NOC controller; preventative work orders by the maintenance planner. The AI cannot accept its own recommendation.
- **Immutable audit ledger.** Every recommendation (with model version and the evidence that fed it), every operator action (with reason), every model retraining event — append-only, cryptographically chained, exportable for regulators, retained ≥ 7 years ◐.
- **Model risk management.** Calibration, drift and regional fairness are monitored continuously with thresholds that trigger review and sign-off — including fairness across coastal/inland and urban/rural service areas, so the model cannot quietly under-serve one population ◐.
- **Bounded learning.** The platform learns from operator decisions through a deliberately constrained, fully inspectable mechanism: every learned weight is visible on the governance dashboard, the correction is capped so it can nudge but never flip a priority, and it is reversible on demand. We chose this over opaque "reinforcement learning" precisely because regulated infrastructure demands explainable adaptation ◐.
- **Language-model boundaries.** The LLM narrates, explains and drafts; it never produces a risk score, forecast or dispatch plan. Its outputs are schema-constrained and logged.
- **Regulatory frame.** NERC CIP alignment for grid-side obligations, state PUC reporting, SOC 2 infrastructure controls, and model governance aligned to the NIST AI Risk Management Framework ○ (stated alignment, not certification, at MVP).

**When the AI is wrong** — and sometimes it will be: confidence is always visible, the operator always has override authority with one click, every override is logged and feeds model improvement, and low-quality input data widens the stated uncertainty rather than producing confident nonsense.

## 5. Scalability

The MVP is one workflow in one region, but the chassis is deliberately general:

- **Across regions.** The same platform with region-specific model recalibration. Weather-provider adapters isolate the NOAA dependency, so non-US deployment (Met Office, ECMWF, JMA) is integration work, not a rebuild.
- **Across infrastructure domains.** Grid → water → wastewater → transport: the asset-risk / dependency / crew-optimisation pattern transfers; only the domain data changes.
- **Across workflows.** Pre-event readiness (MVP) → during-event triage → post-event damage assessment → routine maintenance prioritisation. The last is the quiet giant: the identical ranking, explanation and feedback loop runs year-round, so the platform earns its keep between storms.

---

## Talking points if asked

- **"Why not just buy an off-the-shelf risk platform?"** — Existing products optimise for either weather or asset or workforce, rarely all three, and rarely with the level of explainability the operator role demands. AECOM's differentiator is the integration and the operational fit.
- **"What happens when the AI is wrong?"** — Every recommendation is advisory. Confidence is visible. Overrides are logged and feed back into model improvement. Failure modes are documented in the PRD.
- **"Why this workflow first?"** — Pre-storm gives the longest lead time, the highest decision leverage, and the most tractable data. It's where AI-enabled decision support beats current tools most clearly.
- **"What if we don't have the data quality assumed?"** — The roadmap has an explicit data-foundation workstream. The pre-storm MVP degrades gracefully with lower-quality data (broader confidence bands, more human review) rather than failing.
- **"Is the learning loop reinforcement learning?"** — Deliberately not. It is bounded preference calibration: interpretable, auditable, reversible, and capped so it can never flip a critical priority. Full RL is inappropriate here — no ethical exploration space, sparse decision volume, and an audit posture that demands explainability. (Technical detail: [docs/13_operator_alignment.md](13_operator_alignment.md).)

---

## Appendix A — presentation deck plan (12 slides)

One slide per row; the deck is a compression of §§1–5 above and stays consistent with the demo because every ●/◐ figure comes from it.

| # | Slide | Headline | Key content / figures |
|---|---|---|---|
| 1 | Title | "From four screens and twenty minutes to one screen and three minutes — before the storm makes landfall." | Cockpit hero screenshot; AECOM · date |
| 2 | Why now | Three pressures have converged to make operational resilience a board-level issue | Climate exposure (8M+ residents ●, four hazards); insurer/PUC scrutiny; controllable cost lines. Visual: footprint map + real Debby 2024 track ● |
| 3 | The problem today | During an event, the operational picture lives in the operator's memory, not in a system | 4 system families, 4 asset ID schemes, 4–7 screens; 15–20 min to a full picture ○ |
| 4 | What we propose | One platform that unifies, predicts, explains — and keeps your people in command | Unify → Predict → Explain → Decide diagram. Callout: copilot, never autopilot |
| 5 | What changes on the ground | 72 hours before landfall, your teams act instead of assembling data | Before/after table: <3 min picture ○ · +48h lead time ○ · optimised pre-positioning ◐ · briefings in seconds ◐. Four personas band |
| 6 | Proof, not promises | A working prototype ran Hurricane Debby end-to-end | 210 assets ◐ · 2,880 real observations ● · 24 live alerts ● · 63 tests green ●. Screenshot strip: cockpit / scenarios / audit |
| 7 | Financial implications | The return comes from converting emergency spend into planned spend | Cost drivers vs levers table (all ○); boxed illustrative payback logic; override-rate trust band 15–25% ○ |
| 8 | Delivery roadmap | Value in six months; each phase funds confidence in the next | 0–6 / 6–12 / 12–18 phase bar; dependencies band incl. SGW-side investments |
| 9 | Governance & compliance | Built to survive an audit, not just a demo | HITL · immutable ledger ◐ · model risk management ◐ · NERC CIP / PUC / NIST AI RMF ○; "when the AI is wrong" box |
| 10 | Scalability | One operational chassis — more regions, more domains, more workflows | Three-axis graphic; provider portability; routine maintenance as the year-round workload |
| 11 | Risks & mitigations | What could go wrong, and what we've already done about it | Data quality · rare-event history · operator adoption · model drift — each with mitigation |
| 12 | Next steps | A 90-day mobilisation to validate the numbers on SGW's own data | Asks: data access + steward; 15 min with an ops director (three scoping questions from the PRD §2); executive sponsor for change management |

**Appendix slides (hold for Q&A):** A1 AI capability portfolio with the "what it does NOT do" column (PRD §5); A2 simplified architecture; A3 success-metrics table with baselines marked TBD (PRD §9); A4 top-7 assumptions (PRD §2).

**Numbers deliberately kept out of the deck:** model-internal metrics (they belong on the Governance page and in technical Q&A, not in front of executives) and any figure whose provenance mark would be missing.
