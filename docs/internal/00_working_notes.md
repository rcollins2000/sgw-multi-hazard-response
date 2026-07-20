# Working notes & decision log

Running scratchpad. Newest decisions on top. Keep the *reasoning*, not just the conclusion.

---

## 2026-07-19 — Operator alignment layer: preference calibration, NOT reinforcement learning

User asked for "reinforcement learning to improve model prioritisation". Considered four framings before shipping.

**Framings considered:**
1. **Full RL** — policy gradient over recommendation actions with operator response as reward. Rejected: no reward signal (operator preference ≠ downstream outcome), no exploration-tolerant environment (real utility infrastructure), sample regime three orders of magnitude short (tens of decisions vs thousands needed), audit posture demands interpretability.
2. **Contextual bandit** — online policy over asset-recommendation arms. Same rejection reasons as full RL; also introduces exploration risk on real infrastructure.
3. **Preference calibration / RLHF-lite** — logistic regression on `(features, deferred_or_overridden)` producing `P(defer)`, applied as bounded additive nudge. **Shipped.**
4. **Rule-based post-hoc adjustment** — hand-crafted rules from defer reasons. Rejected: doesn't scale, still needs a training signal.

**Design decisions:**
- **β = 0.15 hard cap** on nudge magnitude. Alignment can nudge, never flip. Layer stays advisory, base score stays the primary ranking signal.
- **`min_samples = 8`** with `nunique(labels) ≥ 2` gate. Under those thresholds the layer stays `ALIGN · DORMANT` and adjustment is zero. Prevents emitting noise before there's real signal.
- **`RETRAIN_EVERY_N = 3`** — auto-retrain cadence tight enough that the demo shows the loop closing in a single interactive session, loose enough that the operator sees stable behaviour between decisions.
- **Version = SHA1 of training data** — any change bumps the version transparently. Auditable model provenance.
- **Async lock around fit** — concurrent decisions don't race.
- **Reason text captured, not yet used for training** — LLM-classified reason buckets as additional features is the obvious Phase-2 extension. Deferred to keep the demo pipeline honest about what's real.

**Endpoints:** `GET /api/alignment`, `POST /api/alignment/retrain`, `GET /api/alignment/adjustments?asset_ids=…`.

**Frontend surfaces:** header badge (`ALIGN · v6ed50e63 · 11n`), cockpit `aligned ↑/↓` chip on the priority score, training-signal hint under the action bar, Governance page section with diverging feature-weight bars. All four have `?` explain popovers pointing at [docs/09_operator_alignment.md](09_operator_alignment.md).

**Full doc:** [docs/09_operator_alignment.md](09_operator_alignment.md) — explains why not full RL, what it is precisely, design principles, limitations, HITL touch points.

**Demo framing:** demo/walkthrough.md (kept local, gitignored) §8 covers this capability with the "why RL is the wrong name" narrative.

---

## 2026-07-17 — Slices 1–4: live/demo separation, provenance, streaming agent with tools, map fly-to, personas

Four concurrent slices requested by user. All shipped and verified end-to-end via Playwright.

### Slice 1 — Live vs demo separation + provenance + human-readable names
- **Mode toggle in header** — `LIVE NWS` vs `DEBBY 2024 REPLAY`, persisted in Zustand store. Live mode hides historic hurricane cones on the map + shows honest "No active tropical cyclone · risk features include historic cone overlays" copy. Demo mode restores the "Hurricane Debby AL042024 T-minus 54h 12m" scenario framing. One or the other — not both silently mixed.
- **Data sources popover** — `GET /api/data-sources` returns 8 sources with kind badges (LIVE / ARCHIVED / SYNTHETIC / TRAINED) + provider + detail. Every source powering the current view is disclosed with its provenance. Access via header "Data sources" button.
- **Human-readable asset names** — already in `assets.asset_name`; now surfaced in the top-20 cards, map popovers, and drilldown title (e.g. "Coastal East (SC) Electrical Substation 032" instead of raw ID prefix).

### Slice 2 — Streaming agent with tool calls
- **New backend module** `backend/src/sgw_platform/explain/agent.py` — Ollama tool-calling loop with four narrowly-scoped tools:
  - `lookup_asset(asset_id)` — full attributes + current risk features
  - `cascade_from(asset_id)` — networkx BFS downstream chain
  - `noaa_alerts_now(state?)` — active NWS alerts
  - `model_explainer()` — plain-language model summary + honest limitations (uses features + baseline + fictional-data caveats)
- **New endpoint** `POST /api/agent/chat/stream` — SSE stream with event types: `token`, `tool_call`, `tool_result`, `final`, `error`. FastAPI StreamingResponse; agent loop iterates until no more tool calls.
- **Frontend `AgentChat` component** — chat panel embedded in the asset drilldown. Renders tool-call badges as they fire (`✓ lookup_asset(SGW-ELE-CO0031)`), streams the assistant response token-by-token, extracts a `RECOMMENDATION: …` prefix if present and shows an **Execute →** button that writes to the audit log via `POST /api/decisions` with the persona's user attribution.
- **Canned questions** for quick starts: "Why is this asset flagged?", "What's downstream?", "How does the model work?" (triggers `model_explainer` tool), "What NWS alerts are active?".
- **Verified in Playwright** — agent called `lookup_asset(SGW-ELE-CO0031)` twice, then produced a markdown-table analytical answer citing hurricane cone, flood zone AE + 11ft elevation, and 9 recent SCADA warnings. Follow-up question "what action should the field crew take?" triggered a `RECOMMENDATION:` with three specific steps (sandbags, SCADA inspection, document conditions).

### Slice 3 — Interactive map
- **Fly-to-selected** — `FlyToAsset` helper uses react-leaflet's `useMap` hook; when an asset is clicked in the list, the map flies to it at zoom 10 minimum. Smooth 0.6s duration.
- **Historic-cones visibility gated by mode** — `showHistoricCones` prop on `OperationalMap`, driven by the store. Live mode: no cones. Demo mode: Debby + Idalia cones + tracks + storm-name tooltips.

### Slice 4 — Persona switcher
- **`PersonaKey` + `PERSONAS` list** already established in `lib/api.ts` — extended with `defaultPage` + `focus` fields. Four personas (NOC / EMG / FLD / MTN) with distinct user IDs (`j.okafor`, `s.hale`, `m.reyes`, `d.chen`).
- **Persona toggle in header** — NOC / EMG / FLD / MTN abbrev buttons, active persona highlighted. Zustand-backed.
- **User attribution** — when the agent-chat Execute button writes to the audit log, `persona.user` is passed as the operator. Every action in the audit table now carries the persona-appropriate actor name.

### What's out of scope (documented as Phase 2)
- Full RBAC gating capabilities per persona (currently the UX shifts but any persona can execute)
- Real MCP server exposing tools rather than direct Python function bindings
- Executed decisions reaching into external CMMS / dispatch (currently the decision is captured in the audit log; downstream integration is deferred)
- Real NHC shapefile parsing for live storm cones (currently hand-curated fixtures only)
- Agent memory across sessions (currently per-conversation only)

### Verified screenshots
- `frontend/v20-live-mode.png` — live mode dashboard, no hurricane cones
- `frontend/v21-data-sources.png` — provenance popover with 8 sources
- `frontend/v24-demo-mode.png` — Debby replay mode, cone visible, T-minus countdown
- `frontend/v25-agent-chat.png` — agent tool call + analytical answer
- `frontend/v26-agent-recommendation.png` — RECOMMENDATION prefix + inline execute path

---

## 2026-07-17 — Briefing v2 — four honesty fixes applied

User audit of the first briefing surfaced four real problems. All fixed and verified via Playwright.

**Fix 1 — Recorded vs recommended actions.** The v1 schema had a single `actions_underway` field that the LLM filled with plausible but fabricated actions. Split into two fields with strong descriptions:
- `recorded_actions` — must be derived STRICTLY from audit log context supplied in the prompt; empty list if none
- `recommended_actions` — LLM proposals, always imperative-verbed, clearly advisory

Backend endpoint now queries `audit_log WHERE action_type IN ('operator_accept', 'operator_override', 'operator_comment') ORDER BY id DESC LIMIT 8` and formats each into the context. UI renders them in two side-by-side columns with badges — green *"from audit log"* vs blue *"advisory · LLM"*.

**Fix 2 — Correct asset type names.** v1 sent only `asset_id` to the LLM; it guessed types from the prefix, calling `SGW-MAJ-CO0029` a "major facility" (actually a Major Pipeline) and `SGW-EME-LO0005` an "emergency" (actually an Emergency Generator). Now sending `asset_type_label` (pretty-printed `_pretty_asset_type()`) in the top-risks context. Verified: LLM now says "Electrical Substation", "Water Pumping Station", "Major Pipeline", "Water Treatment Plant", "Transmission Line Segment", "Emergency Generator".

**Fix 3 — Pretty region labels.** v1 sent raw enum codes (`COAST_EAST`, `LOWER_DELTA`). Now sending `region_label` (pretty) via `_pretty_region()`. LLM output says "Coastal East (SC)" and "Lower Delta (GA)" throughout.

**Fix 4 — Cone honesty.** Several top-risk assets carry `within_hurricane_cone=1` from the Debby/Idalia historic fixtures baked into the risk model. v1 either invented an active hurricane or ignored the flag entirely. Now:
- Every top-risk item carries `within_hurricane_cone` boolean
- Context includes an aggregate count + explicit note: *"These are stress-test overlays derived from the historic Hurricane Debby (Aug 2024) and Hurricane Idalia (Aug 2023) forecast cones baked into the risk model — they influence risk scores but do NOT indicate an active hurricane."*
- System prompt tells the LLM to disclose the overlay explicitly and not to claim an active hurricane unless the alerts show one

**v2 briefing output** (verified via Playwright, `frontend/v18-briefing-v2-final.png`):
- Headline: *"Heatwave pressures high-risk grid and water assets serving 5 million residents"*
- Situation: *"Active National Weather Service alerts indicate a heatwave across the service area. SG Water faces 41 high-risk assets affecting nearly 5 million people, with 25 of those assets flagged by historic hurricane cone stress-tests (Debby 2024, Idalia 2023) but no active hurricane. The heatwave elevates operational strain on power and water infrastructure."*
- Top risks: each named by correct asset type + pretty region + explicit `— within historic hurricane cone (stress-test overlay)` when applicable
- Recorded actions: real audit rows (Reuben's earlier accepts with `reason: pre-position crew immediately`)
- Recommended actions: LLM-proposed, all imperatives ("Pre-position...", "Monitor...", "Escalate...")
- Outlook: *"...heatwave is expected to persist over the next 24 hours..."* — grounded in the actual alert types, not hurricane

Schema bumped to `briefing-v2` in the audit prompt_version field for traceability.

---

## 2026-07-17 — Governance / Audit / Briefing pages built

Sidebar nav items were placeholder divs — user flagged. All three now real pages, verified end-to-end via Playwright.

**New backend endpoints:**
- `POST /api/briefing/generate` — assembles operational picture (critical / high counts + population-at-risk aggregation + top-10 assets + active alerts + hazard types) and calls Ollama Cloud with the `ExecutiveBriefing` schema. Writes `briefing_generated` audit row with SHA-256 hash chain.
- `GET /api/governance/model` — returns risk-model version + metrics + top feature importances + dependency-graph stats.

**Frontend:**
- `App.tsx` refactored — extracted `DashboardPage` component, sidebar nav wired to `page` state, `NavItem` is a proper `<button>` now.
- `pages/GovernancePage.tsx` — Risk model card (version + all metrics + baseline), Dependency graph card (nodes/edges/clusters/modularity), Top feature importances with bar chart, Fairness section with demographic-parity + equal-opportunity metrics + per-group table.
- `pages/AuditPage.tsx` — Filterable table with color-coded action badges (accept green, override red, comment blue, LLM/briefing purple), timestamp / user / subject / hash columns.
- `pages/BriefingPage.tsx` — "Generate briefing" button hits Ollama live, renders snapshot stats + LLM output (headline, situation summary, top risks, actions underway, outlook).

**One bug caught by Playwright:** `/api/briefing/generate` returned 500 the first time. Root cause: `service_population` had NaN values for control-centre assets, and `int(nan)` raises. Fixed with `pd.isna` guard + `.fillna(0)` on the column. On the second try Ollama returned a real briefing: *"Heatwave and multiple NWS alerts threaten nearly 5 million customers across coastal and delta regions"* — real headline, real numbers (24 alerts, 41 high assets, 4,980,136 population at risk), real top-risk asset IDs cited by name.

**Screenshots:**
- `frontend/v12-governance.png` — model metrics + feature importances + fairness
- `frontend/v13-audit.png` — 19 audit rows with color-coded actions
- `frontend/v16-briefing-full.png` — Ollama-drafted briefing rendered

---

## 2026-07-17 — UX iteration via Playwright: seven concrete improvements landed

Drove the frontend with Playwright end-to-end and shipped seven improvements based on what the browser actually rendered:

1. **Risk model switched from classifier+isotonic to LGBM regressor.** Every top-20 asset was showing `CRITICAL 1.00` — the isotonic calibration on binary synthetic labels saturates near 1.0. New continuous synthesised probability + `LGBMRegressor` + `RandomForestRegressor` baseline gives a real score spread (0.65 → 0.78 across top-20 on this dataset). Sidebar now shows R² and MAE (0.675 / 0.054) instead of ROC-AUC / Brier. Test threshold updated: `mae < 0.15`, `r² > 0.60`, `scores.std() > 0.10`.
2. **Pretty-printed region labels.** `COAST_EAST` → "Coastal East (SC)", `LOWER_DELTA` → "Lower Delta (GA)", `INLAND_NORTH` → "Inland North (NC)". New `frontend/src/lib/labels.ts` with `prettyRegion()` + `prettyAssetType()`. Applied to top-20 list + drilldown subtitle.
3. **Map centre + zoom re-anchored to the SGW footprint** — `[33.3, -80.5]` at zoom 7 shows Charlotte (Inland NC) + Charleston (Coastal SC) + Brunswick (Lower Delta GA) + Debby/Idalia cones in the initial viewport.
4. **Hurricane storm labels on the map.** Debby + Idalia track lines carry permanent tooltips (dark red pills, `.storm-label` CSS). Removed the `(track)` suffix visually but kept the name.
5. **Map legend added** — bottom-left overlay showing critical/high/moderate/low asset dots + hurricane track + cone + hazard zone conventions. No more guessing what colours mean.
6. **Drilldown widened to 600px + z-index bumped to 1000.** Was 540px at `z-50`, which put it *behind* Leaflet's internal control layer (Leaflet uses z-indexes 200–700 across its panes). Symptom: label text on the left side of the drilldown looked "clipped" (actually being covered by Leaflet's transparent tile layer). Fixed by lifting drilldown above the map's stacking context.
7. **Leaflet dark-theme tweaks** — popups and tooltips styled to match the dashboard theme in `index.css`.

**End-to-end verified via Playwright:**
- Dashboard loads, sidebar shows R² 0.675 / MAE 0.054 platform metrics live
- Top-20 shows real risk spread (0.65 → 0.78) + region + cluster + "in cone" flag
- Clicking asset opens 600px drilldown with attributes / model features / cascade / evidence
- "Generate explanation" hits Ollama Cloud `gpt-oss:120b` live — returned 8 bullet reasoning + 3 uncertainty bullets citing real NWS URNs (`urn:oid:2.49.0.1.840…`) + sensor IDs (`SNS-CO0031-00/01`)
- Accept button writes to Postgres audit log → verified rows #16 (`explanation_generated`) + #17 (`operator_accept`) both for `SGW-ELE-CO0031`, distinct SHA-256 hashes

**32/32 backend tests still passing after the risk model refactor.**

Hero screenshot: `frontend/v11-hero.png` — full dashboard + Charleston major pipeline drilldown with the LLM-explanation section ready to fire.

---

## 2026-07-17 — MVP prototype complete: Phases 0–7 tested end-to-end

All phases through frontend now working. See .claude/status.md (kept local, gitignored) for the full gate report and [demo/README.md](../demo/README.md) for how to run the demo.

**Working live against real APIs / real fixtures:**
- Postgres 16 + PostGIS 3.4 with 22 tables + partitions + materialised view + hash-chained audit
- Real Charleston Harbor 8665530 water-level observations (1,680 during Debby, 1,200 during Idalia)
- 24 currently-active NWS alerts pulled at build time
- Prophet forecast on real Debby water levels — MAPE 0.18, 80% band coverage 0.58 (M2 tidal seasonality was the unlock)
- Prophet-residual anomaly detection flagging 24 anomalies during Debby's surge
- LightGBM + isotonic calibration risk scoring (ROC-AUC 0.80), RF baseline for methodological rigour
- OR-Tools VRP crew pre-positioning with Guided Local Search
- Louvain blast-radius clustering — 26 clusters, modularity 0.90 across 130 dependency edges
- Fairness auditing across regions (DP gap 0.057, EO gap 0.114)
- Ollama Cloud `gpt-oss:120b` LLM copilot with schema-in-prompt-AND-format pattern, Pydantic validation, retry-on-failure, evidence-ID grounding
- FastAPI backend, 14 endpoints, structured JSON logging, Prometheus /metrics, SHA-256 hash-chained audit log with append-only Postgres triggers
- React 19 dashboard: dark theme, MapContainer with asset markers + hurricane cones + hazard overlay, top-20 risk-sorted list, drilldown with attributes + features + cascade + evidence + LLM explanation + HITL accept/override/comment

**33/33 tests passing** across unit / integration / model evals / LLM-live / frontend.

**Deferred to Phase 10 (user-driven):** exec briefing + 5–10 minute video walkthrough.

**Known limitations honestly documented:**
- Hazard-zone polygons are placeholders; real Digital Coast / NHC SLOSH clips deferred to Phase 2
- Hurricane cones are hand-curated from public landfall paths; live NHC shapefile parsing deferred to Phase 2
- Risk labels are synthesised from features (fictional utility → no real failure history); documented as such in every training report and in the demo README

---

## 2026-07-17 — LLM provider swap: Ollama Cloud primary, OpenAI fallback

User asked to swap from OpenAI to Ollama Cloud for the initial LLM integration. Rationale: cheaper for iteration, open-weights model (`gpt-oss:120b`), user already has an `OLLAMA_API_KEY`. Kept OpenAI as fallback behind a `LLM_PROVIDER` env var so we can swap without code changes if needed.

**Smoke-tested end-to-end in Phase 0:**
1. Plain chat with `gpt-oss:120b` at `https://ollama.com` + Bearer auth → responds correctly (`pong` when asked).
2. Structured output via `format=<json_schema>` alone → **model invented its own schema** (returned `alert_message`, `category`, `location`, `wind_speed_mph`, `storm_surge_ft` instead of the required `hazard_type`, `severity`, `confidence`).
3. Structured output with `format=<json_schema>` **AND** the schema echoed in the system prompt → strict adherence (`{"hazard_type": "hurricane", "severity": "high", "confidence": 0.9}`).

**Locked pattern for Phase 5:** Pydantic → derive JSON schema → pass schema in *both* `format=` AND system prompt → validate with Pydantic → retry once on validation failure with corrective feedback → escalate on second failure. Documented in CLAUDE.md (kept local, gitignored) LLM section.

**Also lands in Phase 0:**
- `ollama>=0.6.2` added to backend deps
- `.env.example` restructured: `LLM_PROVIDER=ollama` default; `OLLAMA_API_KEY`, `OLLAMA_HOST`, `OLLAMA_MODEL` for primary; `OPENAI_*` for fallback
- `settings.py` now looks for `.env` in **both** the current working directory AND project root — the `.env` at `technical_challenge/.env` was previously invisible to a backend-directory `uv run` invocation
- Ollama fields on `Settings`: `llm_provider`, `ollama_api_key`, `ollama_host`, `ollama_model`

**Consequence for Phase 5 estimate:** unchanged. The provider abstraction adds ~30 minutes of design + implementation, and the retry-on-validation pattern was going to be needed anyway.

---

## 2026-07-17 — Phase 1 gate: PASS. Postgres schema, seed, integration tests all green.

**13/13 tests passing across unit + integration.** Ruff clean. Mypy clean.

**What ships in Phase 1:**
- **Alembic migration 002** — 22 tables, 8 monthly `sensor_readings` partitions, materialised view `operational_risk_snapshot`, 6 append-only triggers (`audit_log`, `predictions`, `operator_decisions`), GiST spatial indexes on all geometry columns, `pgcrypto` extension for future hash operations
- **SQLAlchemy 2.x async models** — all 20 aggregates in `backend/src/sgw_platform/db/models/{assets,maintenance,operations,field,weather,graph,audit}.py`, `Mapped[]` typed, JSONB for semi-structured payloads
- **Mock data generator** — `backend/scripts/generate_mock_data.py`, 210 assets across SC/GA/NC, seeded, reproducible, includes hidden anomaly-truth file
- **Seed loader** — `backend/scripts/seed_from_raw.py`, idempotent TRUNCATE+load, ~3s on the dev dataset
- **Integration tests** — `backend/tests/integration/test_seed_and_schema.py`, 10 tests covering row counts, referential integrity, PostGIS spatial indexes + spatial joins, monthly partitions, quality-flag distribution, append-only trigger enforcement, materialised view refresh, crosswalk fragmentation invariant

**Design choices worth logging:**
- **Loop lifecycle fixture** — `backend/tests/integration/conftest.py` disposes the SQLAlchemy engine per test to work around pytest-asyncio creating a fresh event loop per test (default). Without this, the second test errors with "Event loop is closed" because the engine's asyncpg connection pool holds a reference to the previous loop.
- **Ruff per-file ignores** in `pyproject.toml`:
  - `scripts/**` — `B008` (typer.Option in defaults is idiomatic)
  - `src/**/models/*.py` — `RUF012` (SQLAlchemy `__table_args__` is not a `ClassVar`)
  - `tests/**` — `B`, `SIM`, `RUF002` (docstring em-dash)
- **Trigger + materialised view SQL** — each `CREATE TRIGGER` and `CREATE INDEX` in its own `op.execute()` because asyncpg does not multi-statement in a single query.
- **`sensor_readings` partitioning** — 7 monthly partitions covering 2026-06 → 2026-12 + 2027-01. Adjust via new migration as scenarios extend beyond that window.
- **SonarLint / SonarQube warnings** (IDE-only) about cognitive complexity + unused loop indices — acknowledged but not blocking; ruff is the authoritative linter per CLAUDE.md.

**Ratholes avoided:**
- Did NOT try to autogenerate the migration — hand-wrote it because PostGIS types, partitioning, and triggers all need explicit `op.execute()` control.
- Did NOT integrate testcontainers-postgres yet — using the docker-compose Postgres directly for the dev-loop test. testcontainers is the plan for CI (added to dev deps already).
- Did NOT wire the backend `/api/*` routes yet — they land in Phase 6 on top of the models built here.

**Checkpoint:** .claude/status.md (kept local, gitignored) has the full gate report + Phase 2+ scope reality. Recommending a commit here before starting Phase 2 — Phase 0 + Phase 1 together are a substantial, testable milestone.

---

## 2026-07-17 — Phase 0 gate: PASS. Scaffold built end-to-end.

Backend + frontend + Postgres+PostGIS all green. Full gate results in .claude/status.md (kept local, gitignored).

**Notable choices under time pressure:**
- **Frontend TypeScript version:** Vite scaffold gave us TS 6.0.3 (newer than expected). Tests + build + typecheck all clean, so keeping.
- **`test` config in vite.config.ts** — needed `defineConfig` from `vitest/config` not `vite` for the merged types. Trivial fix.
- **Windows-specific: `make` unavailable** — added `run.sh` bash wrapper so git-bash users get the same targets. `uv run <exe>` blocked in this sandbox with "Access is denied" — using `.venv/Scripts/python.exe -m <module>` directly. Documented in `.claude/status.md`.
- **Frontend theme colours** defined in `@theme` block in `index.css` for Tailwind v4 native support. Dark by default (NOC-friendly).
- **Full `docker compose up` for all three services deferred** — postgres via compose verified working, backend + frontend Dockerfiles present but not exercised end-to-end. Local dev flow (uvicorn + pnpm dev) is the primary path. Docker build can be validated later without holding up progress.

**Files added in Phase 0** (partial list — see git status for full):
- `backend/pyproject.toml`, `backend/alembic.ini`, `backend/alembic/{env.py,versions/001_postgis_extension.py}`
- `backend/src/sgw_platform/{__init__,settings}.py`
- `backend/src/sgw_platform/db/{base,session}.py`
- `backend/src/sgw_platform/observability/{logging,metrics}.py`
- `backend/src/sgw_platform/api/main.py`
- `backend/tests/unit/test_smoke.py`
- `backend/Dockerfile`, `backend/README.md`
- `frontend/*` — Vite React TS scaffold + Tailwind v4 + shadcn primitives + react-leaflet + TanStack Query + Zustand + Zod + testing libs
- `infra/postgres/init.sql`, `run.sh`

Advancing to Phase 1.

---

## 2026-07-15 — Persistence upgrade: PostgreSQL 16 + PostGIS 3.4; LLM model = gpt-5.6

**Two decisions:**

1. **Persistence: PostgreSQL 16 + PostGIS 3.4 in place of SQLite.** User raised the data-engineering maturity question. Postgres+PostGIS is the industry standard for utility geospatial workloads — real utilities run on it, SQLite is not credible at SGW scale. Adds ~1–2 h to Phase 0 (docker service + SQLAlchemy async + Alembic + initial migration) and pays back with:
   - Spatial queries via PostGIS + GiST indexes (sub-second "which assets fall within this surge polygon")
   - JSONB for LLM outputs and semi-structured payloads
   - Declarative partitioning on `sensor_readings` for scale storytelling
   - Materialised view for `operational_risk_snapshot`
   - Append-only tables (`audit_log`, `predictions`, `operator_decisions`) enforced by trigger + hash chain

   Architecture story tightens too: raw files under `data/raw/` represent the fragmented source systems (source-of-truth for what SGW's real systems would emit); Postgres is the platform's canonical operational store. Ingestion adapters read from raw and write canonical to Postgres. That split is a cleaner narrative than "everything lives in files."

2. **LLM model: `gpt-5.6`.** User's call — the model name is past my January 2026 training cutoff so I'm trusting current-model knowledge. If the API rejects the model string at build time we swap it.

**Files updated:**
- CLAUDE.md (kept local, gitignored) — stack now names Postgres + PostGIS + SQLAlchemy 2 (async) + Alembic + asyncpg + testcontainers-postgres + geoalchemy2 + Shapely; data-engineering conventions section added; LLM model `gpt-5.6`
- [PLAN.md](../PLAN.md) — Build decisions table, repo target structure (added `backend/alembic/`, `backend/src/sgw_platform/db/`), Phase 0 (Alembic + PostGIS init), Phase 1 (Postgres schema with partitioning + triggers + materialised view + seed loader), Phase 3 (ingestion writes canonical data to Postgres), Phase 6 (audit log now Postgres append-only + trigger + hash chain)
- [docker-compose.yml](../docker-compose.yml) — postgres (postgis/postgis:16-3.4) + backend + frontend with health checks; optional Prometheus + Grafana profile
- [.env.example](../.env.example) — added `POSTGRES_*` + `DATABASE_URL`; consolidated `OPENAI_MODEL=gpt-5.6`; removed `AUDIT_DB_PATH`
- [Makefile](../Makefile) — added `db-up`, `db-migrate`, `db-downgrade`, `db-reset`, `db-seed`, `db-shell`
- [docs/05_architecture.md](05_architecture.md) — new Persistence layer section explaining Postgres + PostGIS rationale
- [docs/03_prd.md](03_prd.md) §6 layered view — added `[Persistence]` layer

**What did not change:** the AI capability portfolio, the multi-hazard scope, the workflow, the six-adapter Hazard Data family, the LLM boundaries. Persistence is an implementation choice under the architecture, not an architectural rethink.

---

## 2026-07-15 — Build scaffold + autonomous execution plan committed

**New artefacts at repo root:**
- CLAUDE.md (kept local, gitignored) — project instructions with locked stack, non-negotiable design principles, conventions, subagent usage, escalation triggers
- [PLAN.md](../PLAN.md) — 10-phase execution plan, each with objective / deliverables / steps / tests / gate. Designed for autonomous execution without step-by-step user approval.
- [.claude/agents/](../.claude/agents/) — three subagents:
  - `test-orchestrator` — runs test suites + model evals, reports structured pass/fail with metrics
  - `dev-tracker` — reads PLAN.md + inspects repo → writes `.claude/status.md` with phase progress + blockers
  - `demo-scribe` — populates `demo/walkthrough.md` scene-by-scene as features ship, produces `demo/script.md` for the video
- [Makefile](../Makefile) — canonical commands: `install`, `dev`, `test`, `evals`, `fixtures`, `data-mock`, `train`, `demo`, `build`, `clean`
- [.env.example](../.env.example) — env template (OpenAI key, log level, audit DB, NOAA cache dir, CORS origins, feature flags)

**Build-time decisions locked in CLAUDE.md / PLAN.md:**
- Python 3.12 + `uv` + FastAPI + Pydantic v2 + structlog + prometheus-client
- LightGBM (risk) + Prophet (forecast + residual anomaly) + OR-Tools (VRP) + networkx + python-louvain
- SQLite append-only audit log with SHA-256 hash chain for tamper-evidence
- React 18 + Vite + TypeScript strict + Tailwind + shadcn/ui + react-leaflet + TanStack Query + Zustand
- Vitest + React Testing Library + Playwright
- OpenAI SDK v1+; `gpt-4o-mini` default, `gpt-4o` for high-stakes; structured outputs via `response_format`
- Docker-compose for local dev orchestration; no cloud infra in MVP
- Dark mode default (NOC-friendly); WCAG 2.1 AA target

**Exec briefing deferred to Phase 10** per user direction — drafted after the MVP demo exists so both artefacts tell the same story. [docs/04_exec_briefing.md](04_exec_briefing.md) header updated to flag this.

**Plan calendar mapping** — Phases 0–9 land Wed–Sun; Phase 10 (exec briefing + video) lands Sunday; Monday for final review + submission. See [docs/03_plan.md](03_plan.md) for the calendar view.

---

## 2026-07-15 — PRD v1.0 drafted

Full PRD in [03_prd.md](03_prd.md). Draws on every prior artefact:
- Problem framing and business context from initial notes
- 7 load-bearing assumptions with "if wrong" clauses from the register
- Four primary personas + anchor pre-event workflow from MVP workflow doc
- 20 functional requirements + non-functional table
- Portfolio of 8 AI capabilities, each with "does NOT do" + "human validation" columns
- Layered architecture + six-adapter Hazard Data family
- Data quality risks and mitigations table
- NERC CIP / SOC 2 / NIST AI RMF governance frame
- Non-negotiable HITL with role-specific accept/override paths
- Fairness auditing methodology in governance section
- LLM boundaries stated as non-negotiable
- Operational success metrics (not just model AUC)
- Ordered delivery priorities (1–10)
- Concrete Phase 2 and Phase 3 additions

Next up (Thursday): Executive briefing + prototype scaffold + first NOAA fixture pulls per [03_plan.md](03_plan.md).

---

## 2026-07-14 — AI portfolio scoped to defensible techniques (evidence-based)

Two Explore-agent surveys of the parent `Apprenticeship_Work` repo. Only include techniques with genuine prior applied work — interview stress is not the time to defend a technique learned yesterday.

**Confirmed defensible ground (with evidence pointers):**

| Technique | Prior evidence | Application in SGW |
|---|---|---|
| Gradient-boosted classifier | Confirmed direct comfort | Hazard-conditional risk scoring |
| Time-series forecasting — **Prophet + ARIMA/SARIMAX** with exogenous regressors | Module 3.05, 3.06 — bicycle rental Prophet with temperature exogenous, seasonality tuning, 25-fold CV | Water-level / demand / stress forecasting with weather as exogenous |
| **GRU with exogenous variables** for time series | Module 6.05 | Phase 2 deep-learning forecasting upgrade path |
| OR-Tools (Vehicle Routing / Guided Local Search) | Module 7.06 — TSP with Haversine + Guided Local Search + folium | Crew pre-positioning (VRP is a native OR-Tools solver) |
| networkx graph techniques — bipartite graphs, centrality, one-hop expansion | Module 7.05 — entitlements portal + supply chain | Dependency-graph cascading impact |
| **Louvain community detection** | Module 7.05 — real applied work on 1,040-user × 56-app entitlements graph | Failure blast-radius clustering on `asset_dependencies` |
| Random Forest, KNN, LogReg, SVM, Decision Trees, Naive Bayes — all tuned + evaluated | Module 3.08–3.10 | RF as baseline vs. GBM for methodological rigour |
| Clustering — K-means, hierarchical, DBSCAN + silhouette/CH/DB metrics | Module 3.11 | Available if needed; DBSCAN is one option (C) for SCADA anomaly detection |
| Dimensionality reduction — PCA, LDA, t-SNE, UMAP | Module 3.12 | High-dim SCADA feature reduction (Phase 2) |
| Deep learning — MLP, CNN, ResNet, RNN, LSTM | Module 6.01–6.04 | Phase 2 forecasting upgrade (GRU/LSTM); CV for post-event imagery (Phase 3) |
| Fairness auditing — demographic parity / equal opportunity | Module 7.07 — Adult Income | Governance section: regional / domain / demographic fairness on the risk model |
| LLM | Confirmed direct comfort | Copilot explanation layer |

**Confirmed gap:** anomaly detection specifically (Isolation Forest / autoencoder / one-class SVM / z-score / IQR) has no direct prior. Three defensible options are on the table:

- **A. Statistical (rolling z-score / IQR)** — 15 lines of pandas; defensible on first principles; not tied to prior but doesn't need to be
- **B. Prophet-residual anomaly detection** — Prophet gives expected value + uncertainty band; readings outside the band are anomalies. Uses existing Prophet prior; elegant story ("one model, two uses"); recommended
- **C. DBSCAN density-based** — outliers labelled -1; uses existing DBSCAN prior; less standard than A or B for streaming SCADA

**Decision: Option B — Prophet-residual anomaly detection.** For each SCADA sensor stream we fit a Prophet model with weather features as exogenous regressors (same technique as the forecasting layer), then flag readings that fall outside the model's uncertainty band. Anomaly score = normalised residual magnitude relative to the interval width. One model, two uses — the same Prophet that predicts the sensor's expected trajectory identifies when reality diverges from expectation.

**Interview defence for this choice:** *"We deliberately re-use the Prophet forecasting layer for anomaly detection because (a) the expected value + uncertainty interval is already there, (b) interpretability is critical for a regulated utility — operators can see why a reading is flagged as anomalous against a forecasted expectation, and (c) it doesn't add a new model family to the governance surface. Isolation Forest and autoencoder-based detection are documented Phase 2 upgrades if the residual approach plateaus."*

Phase 2 upgrade path (Isolation Forest / autoencoder) remains documented in the PRD with honest framing that statistical / model-residual baselines are more interpretable for a regulated utility.

**Rejected from portfolio (no prior, hard to defend cold):**
- Isolation Forest / autoencoder as MVP technique — moved to Phase 2 upgrade
- Object detection / segmentation beyond CNN classification — kept in Phase 3 with NGS imagery

Portfolio in [02_mvp_workflow.md](02_mvp_workflow.md) updated. PRD §5 and §8 updated. See table above for what each interview question ("why this technique?") can honestly point back to.

---

## 2026-07-14 — Storm scenario locked: Debby (primary) + Idalia (validation)

**Primary demo scenario: Hurricane Debby (August 2024).** Cat 1 landfall FL Big Bend, slow-moving, historic multi-day rainfall over GA and SC. Chosen because it thematically justifies the multi-hazard framing — it's genuinely a hurricane *and* an inland flash-flood event, which matches the platform's whole thesis in one storm and mirrors the `hazard_type: flash_flood` example in [06_data_model.md §3](06_data_model.md). Slow-moving 72h+ evolution matches the demo window. Sets up Phase 2 NWM story naturally.

**Validation reference: Hurricane Idalia (August 2023).** Cat 3 FL Big Bend landfall, tracked NE through GA into SC; Charleston Harbor gauge (8665530) recorded near-record surge. Referenced in the demo as a validation case — "here's how the platform would have scored Charleston substations during Idalia's surge; here's how it scores them under Debby." Costs almost nothing (one extra archived cone + one extra CO-OPS window) and adds the surge visual that Debby alone doesn't headline.

**Rejected: Hurricane Ian (Sep 2022).** Genuine SC landfall as Cat 1, but public perception is a Florida storm; two-landfall track complicates the demo narrative; SC segment is a footnote in most reviewers' mental model.

**Impact on wiring plan:** Friday's NOAA fixture block (Task 3 in [07_external_data_sources.md](07_external_data_sources.md)) pulls two NHC cones (Debby primary + Idalia validation) and two CO-OPS windows at Charleston Harbor 8665530. Total effort unchanged (~2 h across both storms).

---

## 2026-07-14 — NOAA data stack expansion + adapter family

Third correction of the day. Framing the external weather integration as just "NWS API" was under-selling — NOAA is a much broader geospatial estate and several sub-agencies plug the honest gaps I flagged earlier:

- **Storm surge** — NHC SLOSH MOM (static) + real-time surge polygons during active storms
- **Hurricane track** — NHC forecast cone (shapefile per advisory)
- **Real tide observations** — NOS CO-OPS gauges (Charleston Harbor 8665530 anchor)
- **Coastal flood exposure** — Digital Coast (Web Mercator/state plane/Albers → reproject at ingest)
- **Heatwave + severe-storm risk gradients** — SPC / CPC outlooks (not just NWS Red Flag / Heat Advisory triggers)
- **Historical base rates** — NCEI Storm Events (back to 1950, filterable to Southeastern US)
- **Phase 2: inland streamflow** — NWM via `water.noaa.gov` derived products; natural fit for a water utility
- **Phase 2: high-resolution forecast grids** — NCEP HRRR / GFS on public S3
- **Wildfire perimeters** — out of NOAA scope; NIFC/InciWeb is the source. Honest framing.

**Architectural consequence:** the "Weather adapter" widens into a **six-adapter Hazard Data family** — Alert, Forecast, Observation, HazardLayer, Track (hurricane-specific), Streamflow (Phase 2). Each hazard type composes the same adapters differently. Isolates provider choice behind an interface, so non-US deployment (Met Office, ECMWF, JMA) is a config concern.

**Demo consequences:**
- Real Charleston Harbor water-level data during an archived storm event (Ian / Idalia / Debby) — biggest single credibility upgrade for the demo. Beats any synthetic curve.
- Real Digital Coast + SLOSH polygons the risk model spatially joins to. Real FEMA AE flood zone around Charleston, real Cat-3 surge extent.
- No live NHC surge in July when there's no active cyclone — SLOSH MOM is the always-available static layer. State this explicitly in the PRD.

**Plan consequence:** 6–8 hours of NOAA fixture wiring inserted into Thursday afternoon / Friday morning slots — see [03_plan.md](03_plan.md). Doesn't displace anything; delivers real feeds into the mock in place of hand-drawn polygons.

**Full source registry:** new doc [07_external_data_sources.md](07_external_data_sources.md).

---

## 2026-07-14 — Reframe: multi-hazard + fragmentation-by-design

Two mid-session corrections landed:

**(1) Multi-hazard, not storm-only.** The brief names four hazards (hurricane, flood, heatwave, wildfire) across *coastal and inland* regions. Framing the MVP as "storm readiness" under-served inland exposure and the heatwave/wildfire half of the case. The MVP is now the **Multi-Hazard Readiness & Response** workflow — same pre-event/early-onset phase scope, but the risk scoring is now **hazard-conditional** (given hazard type + severity + region, produce per-asset risk with contributing factors specific to that hazard family).

Key technical corollary: external hazard classification comes from NOAA/NWS/NHC/USGS/state agencies — SGW's platform consumes classified alerts. Building a classifier from raw weather would be reinventing NOAA badly. The AI value-add is *conditional on hazard type*, not in classifying the hazard itself. A **multi-source hazard-onset detector** (SCADA anomalies + weather + geography) is a Phase 2 stretch that *complements* external alerts.

The demo scenario stays a 72-hour hurricane + flash-flood on the coast (best narrative), but the platform capability is multi-hazard. In the demo we should reference how the same platform would handle a wildfire or heatwave scenario, even if we don't demo those live.

**(2) Fragmentation-by-design in the mock dataset.** The brief's stated pain is data fragmentation across GIS, maintenance, weather, field-ops and control systems. A clean pre-joined mock would hide the integration problem. New assumption E3 in the register: the mock has multiple formats (GeoJSON, CSV, JSON), different asset IDs per source system (crosswalk table required), realistic sensor quality flags, free-text field-report notes. The prototype's ingestion + ID-resolution layer is a technical-maturity signal in its own right, before any AI is invoked.

Data spec is now first-class: [06_data_model.md](06_data_model.md).

**Impact on plan:** no new day added — Wednesday's PRD draft leverages the data model directly (concrete field-level references make the requirements sharper), and Thursday's prototype scaffold uses the folder layout as-is.

---

## 2026-07-14 — Initial framing

### What the case actually asks
Not "build the platform." Instead: **demonstrate structured thinking under ambiguity, product judgement, technical breadth beyond LLMs, and stakeholder-tailored communication.** The prototype is a *proof of one workflow*, not the whole product. The PRD and exec briefing are the primary artifacts; the prototype exists to make them credible.

### Key insights before drafting anything
1. **8M residents are beneficiaries, not users.** Users are SGW operational staff (NOC controllers, emergency coordinators, field supervisors, maintenance planners). This has to be stated as Assumption #1 because it reshapes every requirement downstream — UX, security posture, deployment model, success metrics.
2. **The brief keeps saying "decision-support platform," not "assistant" or "copilot."** Building a chatbot-first product would miss the intent. The product is an operational dashboard powered by forecasting / anomaly detection / optimisation / predictive ML, with a natural-language copilot layer as a secondary capability.
3. **"AI beyond LLMs" is explicitly assessed.** Any submission that leans only on RAG/LLM plumbing will underperform against a submission that shows forecasting, anomaly detection, and optimisation stitched together with an LLM explainability layer on top.
4. **Ambiguity is a signal, not a bug.** The assumptions register is a first-class deliverable — not an appendix. Reviewers are looking for *which* assumptions I make, *why*, and *what would change* if they were wrong.

### Strategic call: one workflow, three narratives
Pick **one MVP workflow** and use it as the spine of all three deliverables + presentation. See [02_mvp_workflow.md](02_mvp_workflow.md) for the selection and the alternatives considered.

### What "creative AI use case" means here
Not "novel LLM prompt." Creative = **the right combination of AI techniques applied to a real operational pain**, where the AI does something a rules-based system cannot (multi-variable forecasting, spatial-temporal risk scoring, constrained optimisation with explainable trade-offs). Creative also means **an honest system design** — knowing where AI *shouldn't* be, and where a human must decide.

### What "technical maturity" looks like in the deliverables
- The PRD names concrete failure modes (drift, false positives, forecast bias by region, sparse-label problem for rare events) and how they're mitigated
- The architecture shows where humans intervene, where the model's confidence is surfaced, and how the system fails safely
- The exec briefing includes ranges and confidence, not point estimates
- The prototype has documented limitations, not hidden ones
- Success metrics are operational (MTTR, avoided outages, crew utilisation) — not model metrics (AUC, F1)

---

## Decision log

| Date | Decision | Reasoning | Reversible? |
|---|---|---|---|
| 2026-07-14 | MVP workflow: Multi-Hazard Readiness & Response, scoped to pre-event / early-onset phase (hurricane, flood, heatwave, wildfire; coastal + inland) | Aligns with the full brief scope, hazard-conditional risk scoring is a stronger technical story than one-off models, and the same platform generalises across hazards | Yes, until architecture is drafted |
| 2026-07-14 | Mock dataset is fragmented on purpose (multiple formats, ID crosswalk, sensor quality flags) | The brief's stated pain *is* data fragmentation. A clean dataset would hide the integration challenge and miss a chance to demonstrate technical maturity in ingestion / ID-resolution / data-quality handling | Low cost to revisit |
| 2026-07-14 | Hazard classification comes from external upstream sources (NWS/NHC/USGS); SGW's AI value-add is hazard-conditional asset risk scoring | Reinventing NOAA's classifiers would be worse and slower than integrating them. A multi-source hazard-onset detector remains as a Phase 2 stretch | Low cost to revisit |
| 2026-07-14 | Full NOAA stack (NWS + NHC + NOS CO-OPS + Digital Coast + SPC/CPC + NCEI) for MVP; NWM + HRRR + NGS + NIFC deferred to Phase 2/3 | Naming specific NOAA sub-agencies signals domain awareness; using real observations + real hazard polygons upgrades demo credibility materially | Yes, adapter pattern makes source swaps cheap |
| 2026-07-14 | SGW reference footprint is SC/GA/NC (coastal + inland) | Exemplifies all four hazards in one contiguous region with excellent NOAA coverage (Digital Coast, NHC SLOSH, Charleston Harbor 8665530 gauge) | Yes, other footprints use same adapters + different hazard-layer fixtures |
| 2026-07-14 | Weather ingestion decomposes into six adapters (Alert / Forecast / Observation / HazardLayer / Track / Streamflow) | Provider choice becomes a config concern; non-US deployment (Met Office / ECMWF / JMA) swaps implementations without touching AI or UI | Yes but the interface will be load-bearing once code is written |
| 2026-07-14 | Users = SGW operational staff, not residents | See insight #1 above | Low cost to revisit |
| 2026-07-14 | Product form: operational dashboard first, copilot second | Brief says "decision-support platform," not "assistant" | Yes |
| 2026-07-14 | Docs-first workflow: PRD → exec briefing → prototype | The prototype exists to prove the PRD's claims. Building code before the PRD risks the code driving the story instead of the other way around | Yes but expensive after day 3 |
| 2026-07-19 | Exec briefing (docs/05) drafted v1.0 with ●/◐/○ provenance marks on every figure; deck plan embedded as Appendix A | Phase 10 as planned — drafted after the demo was validated so both artefacts tell the same story. Provenance marks mirror the platform's own data-source labelling so the deck can't overclaim | Yes |
| 2026-07-19 | Purged stale v1 risk-model claims from demo narration (walkthrough scenes 2, 4, 14 + numbers block): "isotonic calibration / ROC-AUC 0.80 / Brier 0.18" → lgbm-reg-v2 MAE/R² labelled as pipeline-validation metrics on synthetic labels; Crew page narrated as preview of the backend solver, not a live run | The v1→v2 classifier→regressor pivot left artefacts describing a calibrated classifier that no longer exists; narration must match shipped code or the audit story collapses. Remaining code-side fix: `routes.py` provenance string + regenerate `training_report.json` | Yes |
| 2026-07-19 | PRD portfolio extended to nine capabilities — operator alignment (preference calibration) added as #9, matching docs/02 + docs/13 | The alignment layer shipped in code and docs/13 but was missing from the PRD's locked portfolio, violating docs-and-code-in-lockstep | Yes |

## Open questions to resolve before drafting PRD

- What specific weather data source assumption? (NOAA GFS + regional NWS products vs. commercial provider)
- What SCADA/asset data model to assume? (Common Information Model — IEC 61970 — is a defensible assumption)
- Where do I draw the line on scope for the "response" phase in the MVP? (Recommendation: MVP is pre-storm only; response phase is Phase 2 in the roadmap)
- Cloud or on-prem deployment assumption? (Hybrid — cloud for training/inference, on-prem edge for NOC continuity during outages, defensible for a US utility with FERC/NERC oversight)
