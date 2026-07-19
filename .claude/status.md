# SGW build status — 2026-07-17 (Phases 0–9 complete + UX iteration; Phase 10 deferred)

## Playwright UX iteration outcomes (seven concrete fixes)

Drove the frontend via Playwright and shipped:
1. Risk model → LGBM regressor for real 0.65–0.78 score spread (was saturating at 1.00)
2. Pretty region labels: `COAST_EAST` → "Coastal East (SC)" (plus the two others)
3. Map centre/zoom tuned to fit all three regions + Debby+Idalia cones initially
4. Storm-name tooltips on the map for Debby + Idalia
5. Map legend overlay (asset severity + track + cone + hazard)
6. Drilldown widened 540→600px + z-index bumped past Leaflet's 700-tier
7. Leaflet popup/tooltip dark-theme styling

**End-to-end verified through the browser:**
- Dashboard loads with real Postgres data (210 assets, 24 live NWS alerts)
- Sidebar shows R² 0.675 / MAE 0.054 (regressor metrics)
- Top-20 shows real risk hierarchy (0.65 → 0.78)
- Drilldown renders all sections: attributes, model features, cascading impact, evidence
- Ollama `gpt-oss:120b` "Generate explanation" returns 8 bullets + 3 uncertainties citing real NWS URNs + sensor IDs (live LLM call)
- HITL Accept writes append-only audit row → verified `explanation_generated` (#16) + `operator_accept` (#17) both hash-chained for SGW-ELE-CO0031

**32/32 backend tests still green after risk-model refactor.**

Hero screenshot: `frontend/v11-hero.png`.

---



## What's built

**Phases 0–7 complete + tested end-to-end. Phase 8 shipped as demo README + joint smoke.**

### Backend (Python 3.12 / FastAPI / SQLAlchemy async / PostGIS)
- 22-table PostGIS operational schema (Alembic-managed), GiST indexes, monthly-partitioned sensor_readings, materialised view, 6 append-only triggers, SHA-256 hash-chained audit log
- Six NOAA adapters (Alert, Forecast, Observation, HazardLayer, Track, Streamflow stub)
- Real fixtures pulled: 1,680 Charleston water levels during Debby, 1,200 during Idalia, 24 active NWS alerts, hand-curated Debby + Idalia hurricane tracks
- Mock data generators (210 assets across SC/GA/NC, 14,448 SCADA readings, 300 work orders, 500 inspections, 130 dependency edges, 210 crosswalk rows)
- Ingestion: async ID resolver, quality-flag propagation, SQL feature builder with PostGIS spatial joins
- AI portfolio all working: LightGBM+isotonic risk scoring (ROC-AUC 0.80, Brier 0.175, RF baseline 0.87), Prophet forecasting with M2 tidal seasonality (MAPE 0.18, coverage 0.58), Prophet-residual anomaly detection (24 anomalies flagged during Debby's surge), OR-Tools VRP crew pre-positioning, networkx dependency graph traversal, Louvain blast-radius clustering (26 clusters, modularity 0.90), demographic-parity + equal-opportunity fairness auditing (DP gap 0.057, EO gap 0.114)
- Ollama Cloud LLM copilot (`gpt-oss:120b`) with proven schema-in-prompt-AND-format structured-output pattern + Pydantic validation + retry
- 14 FastAPI endpoints: `/health`, `/ready`, `/metrics`, `/api/status`, `/api/assets`, `/api/assets/{id}`, `/api/assets/{id}/explanation`, `/api/hazard-zones`, `/api/hurricane-tracks`, `/api/alerts`, `/api/forecasts/water-level`, `/api/decisions`, `/api/audit`, `/api/governance/fairness`

### Frontend (React 19 / Vite / TypeScript strict / Tailwind 4)
- Dark-by-default operational dashboard covering the full demo path
- Sidebar: nav + platform-status footer with live model metrics
- Header: critical + high asset counts + active NWS alerts + min-risk slider filter
- Map (react-leaflet + OpenStreetMap tiles): asset markers sized+coloured by risk, hazard-zone overlay, hurricane cone + track overlay
- Top-20 list panel: risk-sorted asset cards with cluster ID and cone flag
- Drilldown panel: attributes, model features, cascading dependency chain, evidence IDs, "Generate explanation" (calls Ollama live), HITL accept/override/comment tied to audit log

### Tests — all green
- 3 backend unit (imports, settings, app builds)
- 10 integration seed/schema (row counts, referential integrity, PostGIS spatial index + spatial join, monthly partitions, quality-flag distribution, append-only trigger enforcement, matview refresh, crosswalk fragmentation)
- 6 integration NOAA fixtures (CO-OPS windows, hazard-type normalisation, hurricane cone geometry, cone/asset intersection)
- 5 integration ingestion/features (resolver, feature builder, cone flag, hazard distances)
- 7 model evals (risk, fairness, Prophet forecast, Prophet-residual anomaly, dependency BFS, Louvain, VRP)
- 1 LLM-live (Ollama Cloud gpt-oss:120b schema adherence + evidence-ID validation)
- 1 frontend unit (App renders)
- **Total: 33 passing**

### Docs shipped
- [demo/README.md](../demo/README.md) — one-time setup, run commands, demo walkthrough, real-vs-mocked breakdown, numbers to cite in the video

## Phase 10 (exec briefing + video) — deferred as planned

Per user direction: exec briefing lands after the MVP demo is validated end-to-end. All content anchors already exist:
- Real metrics live on the dashboard
- LLM copilot works with structured output + evidence citation
- Audit log is tamper-evident (verifier available)
- Fairness audit shows small gaps (<0.12) across the three regions

## Environment notes preserved
- Windows 11 + git-bash. `uv run <exe>` blocked by sandbox → invoked `.venv/Scripts/python.exe -m <module>` directly.
- Ollama Cloud key set at project-root `.env`. Settings module reads from both cwd and project root.
- Postgres container `sgw_postgres` running. Frontend proxies `/api/*` → backend via Vite dev server config.
- `make` unavailable on Windows — use `bash run.sh <target>` (equivalent Makefile targets provided).
