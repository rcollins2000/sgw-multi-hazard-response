# SGW Demo — how to run

> **Looking for the demo narration script?** See [demo/walkthrough.md](walkthrough.md) — an
> 18-scene end-to-end script covering every AI capability with the "what / why / worthwhile /
> limitations / HITL touch point" framing for stakeholders. This README is the runbook that
> gets the stack up so the walkthrough can be recorded.



## One-time setup (~3 min)

### PowerShell (Windows — recommended for this project)

Run each line separately (PowerShell doesn't use bash's `\` line continuation):

```powershell
docker compose up -d postgres

cd backend
uv sync --all-extras
.venv\Scripts\python.exe -m alembic upgrade head          # 3 migrations
.venv\Scripts\python.exe -m scripts.generate_mock_data    # 210 assets + 14k SCADA + 300 WOs
.venv\Scripts\python.exe -m scripts.seed_from_raw         # load into Postgres
.venv\Scripts\python.exe -m scripts.pull_noaa_fixtures    # real Debby+Idalia water levels + tracks + NWS alerts
.venv\Scripts\python.exe -m scripts.seed_noaa_fixtures    # weather+tracks into Postgres

cd ..\frontend
pnpm install
```

### bash / git-bash / macOS / Linux

```bash
docker compose up -d postgres
cd backend && uv sync --all-extras \
  && .venv/Scripts/python.exe -m alembic upgrade head \
  && .venv/Scripts/python.exe -m scripts.generate_mock_data \
  && .venv/Scripts/python.exe -m scripts.seed_from_raw \
  && .venv/Scripts/python.exe -m scripts.pull_noaa_fixtures \
  && .venv/Scripts/python.exe -m scripts.seed_noaa_fixtures
cd ../frontend && pnpm install
```

(On Linux/macOS replace `.venv/Scripts/python.exe` with `.venv/bin/python`.)

## Run the demo (two terminals)

**Terminal 1 — backend (blocks; leave running):**
```powershell
cd backend
.venv\Scripts\python.exe -m uvicorn sgw_platform.api.main:app --reload
```

**Terminal 2 — frontend (blocks; leave running):**
```powershell
cd frontend
pnpm dev
```

Open http://localhost:5173.

- Backend starts on port 8000 (or 8001 if 8000 is taken).
- Model training runs in the background at startup; `/api/status` reports `ready: true` after ~10s. The sidebar of the dashboard shows this live.
- Frontend proxies `/api/*` → `http://localhost:8000`, so the frontend hits `/api/status`, `/api/assets`, etc. directly.

## Demo scenario walkthrough (v2 Storm Cockpit)

The UI is the **Storm Cockpit**. The landing screen surfaces "what does AI recommend I do right now?" as its single job. Point at, in order:

1. **Command bar (top-left)** — SGW brand + "Storm Cockpit" + `LIVE NWS ↔ DEBBY 2024 REPLAY` mode toggle. In demo mode the storm label reads "Hurricane Debby · AL042024 · Cat 1".
2. **Platform status strip (thin row under the command bar)** — models ready pill + `risk model lgbm-cal-v1` + `ROC-AUC 0.804` + `Brier 0.175` + `graph mod. 0.901` + `copilot the copilot LLM`. All values are live from `/api/status`.
3. **Countdown** — "54h 12m UNTIL LANDFALL" — the framing that anchors the entire cockpit.
4. **TimelineSpine** — 72-hour ribbon with event dots for `Adv 15`, `Surge W`, `Tide↑band`, `Crew go`, `WO lock`, `Peak surge`; the amber **Now** playhead and red **Landfall** vertical show where we are in the response window.
5. **Priority decision (focus lane)** — Ashley River Pumping Station (top-risk asset) rendered as the hero:
   - ID row with the fragmented-on-purpose source-system crosswalk (`SGW-WAT-CO0002 · GIS-WAT-0002 · MAX-… · SCADA-WAT-CO0002`)
   - Big calibrated score `0.91 ±.05` in rose
   - 5-block **ConfidenceMeter** (level 4/5, "high")
6. **CopilotPullQuote** — amber-left-border card, "Copilot recommends" eyebrow. Renders the LLM's recommended action + evidence chips + "the copilot LLM · structured · advisory · schema-validated" footer. This is the visual grammar that keeps the LLM as *copilot, never producer*.
7. **"Why it's #1 today"** — driver bars for `Distance to surge zone`, `Ground elevation`, `SCADA residual anomaly`, `Criticality rating`. Ordered by global feature importance (`/api/governance/model`), sized + coloured by per-asset feature values.
8. **Water-level sparkline (Charleston Harbor 8665530)** — observed (cyan) vs Prophet forecast (dashed grey) + 80% band + Prophet-residual anomaly points (amber).
9. **Action bar** — `Accept & task crew` (primary amber) · `Override` · `Defer to #2`. Accept posts `POST /api/decisions`, backend writes to the SHA-256-chained `audit_log`, the UI renders `✓ Accepted · crew tasked · logged to audit <hash>`.
10. **Rail — Live threat map** — compact SVG with the NHC cone, forecast track, and coloured asset dots. `EXPAND ↗` routes to the full-screen react-leaflet view (formerly the v1 "Situational Overview").
11. **Rail — Watchlist by risk** — rank 2-N. Click any row to **refocus** the cockpit on that asset (drivers, score, copilot recommendation all reload for the new focus).

Every other screen (Full map, Crew plan, Briefing, Audit, Governance) is reachable via the top nav. Their content is unchanged from v1 — see the top-level [README.md](../README.md) for the endpoint-by-endpoint story.

### Scenario agent walkthrough (Scenarios nav item)

The **Scenarios** tab surfaces the agent — see [docs/08_scenario_agent.md](../docs/08_scenario_agent.md) for the full pipeline. Demo the three flows in this order:

1. **Preset chip: "Cat 3 @ Charleston +30d"** — click it. Backend short-circuits the LLM parser (`PRESET_SPECS['cat3_charleston_30d']`), mutates the coastal-asset features, calls the trained risk model, and returns a `ScenarioReport`. UI shows the **resolved ScenarioSpec** panel (kind, severity, region, horizon, surge lift, cone ratio) — the operator sees exactly what the agent decided before reading the impacts.
2. **Ranked impacts** — top-N assets with `baseline`, `Δ`, and `scenario_score` bars in the same visual grammar as the cockpit watchlist. Every row is deterministic given the spec.
3. **Copilot recommendation** — amber pull-quote with the LLM-drafted imperative recommendation and evidence chips. **Every evidence ID is guaranteed to be in the ranked impacts** (hallucinated IDs are dropped server-side).
4. **HITL panel** — Accept & queue work orders / Override / Comment. Accept posts `POST /api/scenarios/{id}/decision`, writes `scenario_accept` to the append-only audit log, and shows the `✓ Scenario accept · logged to audit <hash>` pill.
5. **Free-text directive** — for the second run, paste something like *"What if a Cat 4 hurricane made landfall at Savannah in 21 days?"* into the directive textarea and Run. The LLM parses to a fresh `ScenarioSpec` (real endpoint calls the copilot LLM; falls back to a neutral synthesised spec if parsing fails). Same UI, LLM-parsed spec instead of preset.
6. **"Worst single-asset cascade" preset** — shows the third scenario kind. No hazard perturbation; ranking is `preventative_priority × cascade_depth`. Answers the maintenance-planner "what's our worst blind spot?" question.

Every scenario run + every operator decision writes to the audit log — visible under the **Audit** tab.

## What's real, what's mocked

**Real:**
- the LLM (Ollama the copilot LLM default, OpenAI swappable via `LLM_PROVIDER`) responses (live LLM calls with structured JSON output validated via Pydantic)
- **NWS active alerts — polled live every 60 s** for SC/GA/NC via `api.weather.gov`. Upserted by `alert_id` into `weather_alerts`. Rows expired > 24h are swept.
- **NOS CO-OPS Charleston Harbor water levels (gauge 8665530) — polled live every 6 min** (matches upstream cadence). Rolling 48h buffer with `source='NOS_COOPS:live_8665530'`. Prophet re-fits per `/api/forecasts/water-level` call.
- **Archived NOAA data (retained for stress tests + cold-start fallback):** 1,680 water-level observations from Hurricane Debby (Aug 3–9, 2024) and 1,200 from Idalia (Aug 28 – Sep 1, 2023). Used as the risk-model stress-test window and as the sparkline fallback for the first 6 min after boot.
- Prophet forecast fit against real Debby water levels with semi-diurnal tidal seasonality (MAPE 0.18, 80% band coverage 0.58)
- OR-Tools VRP crew pre-positioning using Haversine distance + Guided Local Search
- Louvain community detection on the real dependency graph (modularity 0.90 across 26 clusters)
- Fairness auditing (demographic parity + equal opportunity) across regions
- Postgres 16 + PostGIS 3.4 spatial joins (assets × hazard zones × hurricane cones)

**Mocked / synthetic:**
- 210 assets across SC/GA/NC (deterministic, seed=42)
- Work orders, inspection history, SCADA sensor readings, field reports, incidents, outages, crews
- Placeholder hazard zone polygons (real Digital Coast / NHC SLOSH clips deferred to Phase 2)
- Hurricane cones for Debby + Idalia (hand-curated from public landfall paths; real NHC forecast cone shapefiles deferred to Phase 2)
- Risk-scoring labels — synthesised from features because no real historical failure labels exist for a fictional utility. Documented as synthetic in the training report; production replaces with real historical incident joins.

## Numbers to reference in the video

- 33 tests all green: 3 unit + 21 integration + 7 model evals + 1 LLM-live + 1 frontend
- Postgres schema: 22 tables + 7 monthly `sensor_readings` partitions + 1 materialised view + 6 append-only triggers + 4 GiST spatial indexes
- Ingested: 210 assets, 300 work orders, 500 inspections, 14,448 SCADA readings, 130 dependency edges, 210 crosswalk rows, 2,880 real weather observations, 24 active NWS alerts, 2 hurricane tracks
- Models: risk (LightGBM v2 regressor + RF baseline · real probability calibration is Phase 2), forecasting (Prophet with M2 tidal seasonality · 80% nominal band, ~54% empirical coverage disclosed on Governance), anomaly (Prophet-residual + rolling-median outlier ranking), optimisation (OR-Tools VRP + Guided Local Search), graph (networkx BFS + Louvain), fairness auditing, operator-preference alignment layer (supervised preference learning, bounded corrective nudge)
- LLM: Ollama the copilot LLM or OpenAI (swappable via `LLM_PROVIDER`), structured output via schema-in-prompt-AND-format pattern, Pydantic validation + retry
- Audit: SHA-256 hash chain across every AI recommendation and operator action; UPDATE/DELETE blocked at trigger level
