# 6-day plan to 2026-07-20 submission

> **Note:** the *technical execution plan* now lives at [PLAN.md](../PLAN.md) — phase-gated, tested, autonomous. This file is the *calendar view* mapping those phases across the days remaining before submission. Read PLAN.md for what to build; read this for when.

**Phase-to-calendar mapping (from [PLAN.md](../PLAN.md)):**

| Day | Phases |
|---|---|
| Wednesday 2026-07-15 | PRD v1.0 drafted ✓; Phase 0 (scaffold + tooling) |
| Thursday 2026-07-16 | Phase 1 (mock data) + Phase 2 (NOAA fixtures) |
| Friday 2026-07-17 | Phase 3 (ingestion) + Phase 4 (AI models) start |
| Saturday 2026-07-18 | Phase 4 finish + Phase 5 (LLM) + Phase 6 (backend) + Phase 7 (frontend) start |
| Sunday 2026-07-19 | Phase 7 finish + Phase 8 (demo flow) + Phase 9 (docs) + Phase 10 (exec briefing + video) |
| Monday 2026-07-20 | Submit before end of day |

Exec briefing (§05) is deliberately deferred to Phase 10 per user direction — it's drafted after the demo exists so both artefacts tell the same story.

---

## Original per-day plan (superseded by PLAN.md — retained for reference)

Working backwards from Monday 2026-07-20. Assumes ~4–6 focused hours per day; front-load harder thinking, back-load polish and video.

## Guiding rules
- **Docs before code.** Prototype exists to prove the PRD's claims. Building code first risks the code driving the story.
- **Freeze scope after Day 2.** Any addition after Wednesday is a Phase-2 item in the roadmap, not a change to MVP.
- **End each day with a check-in note** in `00_working_notes.md` — what shifted, what's now unknown, what tomorrow starts with.
- **Video is unforgiving.** Reserve most of Sunday for it.

## Day-by-day

### Tuesday 2026-07-14 (today) — Framing lock-in
- [x] Read brief, capture insights, set up docs scaffold
- [ ] Finalise MVP workflow decision (confirm or adjust the pre-storm recommendation)
- [ ] Sanity-check assumptions register — is anything missing?
- [ ] Sketch the PRD outline (headings + one-line intent per section) — do not draft content yet
- [ ] Sketch the exec briefing outline (headings + one-line intent per section)
- [ ] End-of-day: is the story coherent across PRD sections and exec briefing sections? If not, fix framing before writing.

### Wednesday 2026-07-15 — PRD draft
- [ ] Draft PRD sections 1–5 (problem, assumptions, users/workflows, functional/non-functional, AI capabilities)
- [ ] Draft PRD sections 6–9 (architecture, data, security/governance, success metrics/MVP)
- [ ] First-pass architecture diagram (rough sketch; refine after prototype exists)
- [ ] End-of-day: PRD is complete-but-rough. Not polished.

### Thursday 2026-07-16 — Exec briefing + prototype scaffold + NOAA fixtures (part 1)
- [ ] Morning: draft executive briefing end-to-end (short — 2–3 pages)
- [ ] Afternoon block 1: set up prototype repo, synthetic-data generation for internal sources (GIS assets, CMMS work orders, SCADA), environment
- [ ] Afternoon block 2 (~3–4 h): **NOAA fixture wiring** — see [08_external_data_sources.md](08_external_data_sources.md)
  - CO-OPS Charleston Harbor 8665530 water levels → `observations.csv` (~1 h)
  - Digital Coast flood exposure + NHC SLOSH MOM clipped to SC/GA/NC → `hazard_zones.geojson` (~2–3 h)
- [ ] Choose UI stack (Streamlit if speed matters most; Next.js if the demo will suffer from Streamlit's map limitations)
- [ ] Get a single asset flowing through: load → risk score → display

### Friday 2026-07-17 — Prototype core + NOAA fixtures (part 2)
- [ ] Morning block (~3 h): **NOAA fixture wiring** — remainder
  - NHC forecast cones — **Debby (primary) + Idalia (validation)** → `hurricane_track_debby.geojson`, `hurricane_track_idalia.geojson` (~1–2 h)
  - SPC/CPC outlook polygon for heatwave scenario (~1 h)
  - NCEI Storm Events filtered to Southeastern US → `historical_events.csv` (~1–2 h)
- [ ] Train hazard-conditional risk scoring model on the joined dataset, calibrate, evaluate
- [ ] Wire the map + ranked list + drill-down (real Digital Coast + SLOSH polygons visible)
- [ ] LLM explanation call with structured output, evidence citations pointing to real source IDs
- [ ] Accept/override + audit log
- [ ] End-of-day: end-to-end path works, even if ugly

### Saturday 2026-07-18 — Prototype polish + optimisation
- [ ] Crew pre-positioning optimisation (OR-Tools or heuristic — whichever is faster)
- [ ] Feature-importance surfacing in UI
- [ ] Confidence indicator
- [ ] README with setup instructions, architecture, assumptions, limitations
- [ ] Final architecture diagram → back-populate into PRD
- [ ] Trim, tighten, and cross-reference all docs — consistency pass

### Sunday 2026-07-19 — Video + final review
- [ ] Write demo script (5–10 min: problem → workflow → live demo → AI capabilities → limitations → path to production)
- [ ] Record demo — expect 3–5 takes
- [ ] Cross-check that PRD, exec briefing, prototype README and demo tell the *same* story
- [ ] Package everything: repo, docs, sample data, video link
- [ ] Sleep on it

### Monday 2026-07-20 — Submit
- [ ] Morning: final read-through with fresh eyes
- [ ] Submit before end of day

## Contingency budget
- If Wednesday PRD slips: cut exec briefing to Friday morning
- If Friday prototype core slips: drop the optimisation step (surface it as Phase 2 in roadmap), keep risk scoring + explanation + UI
- Never cut: assumptions register, audit log / HITL affordance, one architecture diagram, video

## After submission — interview prep
The live session is separate; don't spend prep time on it until submission is in. Reserve 2 evenings later that week for:
- 30-min presentation deck (reuse content from exec briefing + PRD)
- Q&A dry-run — anticipate trade-off questions (build-vs-buy on the LLM, on-prem vs. cloud, what happens when the model is wrong, why not just rules)
