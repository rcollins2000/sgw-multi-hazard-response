# External hazard & weather data — source registry

## Design principle

**NOAA is the reference federal data stack.** The platform integrates the entire NOAA geospatial estate, not just `api.weather.gov`. This is what a real US utility would do, and reflects the maturity a mixed-audience reviewer would expect.

The ingestion layer isolates provider choice behind a **six-adapter Hazard Data family** (see [06_architecture.md](06_architecture.md)). Non-US deployment (Met Office, ECMWF, JMA, national grids) swaps adapter implementations without touching the risk scoring, optimisation or UI layers. This is stated as an assumption ([01_assumptions.md A6](01_assumptions.md)).

All sources below are public-domain federal data. Attribution recommended in the UI footer: *"Weather and geospatial data: NOAA (NWS, NHC, NOS CO-OPS, Digital Coast, SPC/CPC, NCEI). Wildfire perimeters: NIFC/InciWeb (Phase 2)."*

---

## Source registry

| # | Source | What it provides | Access | SGW component | Phase |
|---|---|---|---|---|---|
| 1 | **NWS API** (api.weather.gov) | Active alerts, gridded forecasts, station observations | JSON REST, no key | `alerts.json`, `forecasts.json`, `observations.csv` | MVP |
| 2 | **NHC GIS** (nhc.noaa.gov/gis) | Hurricane forecast cone, wind-speed probability, SLOSH MOM storm surge inundation, real-time surge scenarios during active storms | Shapefile / KMZ / WMS per advisory | `hazard_zones.geojson` (SLOSH), new `hurricane_track.geojson` (cone) | MVP |
| 3 | **NOS CO-OPS Tides & Currents** (api.tidesandcurrents.noaa.gov) | Real observed water levels, tide predictions, coastal meteorology at NOAA gauges | JSON REST, no key | `observations.csv` — real coastal water levels alongside NWS station obs | MVP |
| 4 | **Digital Coast** (coast.noaa.gov) | Pre-computed coastal flood exposure, sea-level-rise scenarios, coastal LIDAR/DEM, land cover | Shapefile / GeoTIFF, ArcGIS REST | Seeds `hazard_zones.geojson` with real exposure polygons for SC/GA/NC coast | MVP (offline fixtures) |
| 5 | **SPC & CPC outlooks** | SPC severe-storm risk polygons, CPC heat/drought outlooks | Shapefile / KMZ, daily | Hazard layer for heatwave and severe-storm scenarios | MVP |
| 6 | **nowCOAST** (nowcoast.noaa.gov) | Aggregator: warnings polygons, precipitation, SST, coastal flood, aviation. OGC services. | WMS / WFS / ArcGIS REST | Backup / cross-check layer for the map UI | Phase 2 |
| 7 | **National Water Model (NWM)** | 2.7 km continental streamflow forecast (short / medium / long-range) | NetCDF on AWS S3 (`s3://noaa-nwm-pds`), also `water.noaa.gov` derived products | Inland flood streamflow forecasting — natural fit for a water utility | Phase 2 |
| 8 | **NCEI Storm Events Database** | Historical events with geospatial + damage fields, back to 1950 | CSV bulk download | `data/reference/historical_events.csv` — training features and base-rate priors for hazard-conditional risk scoring | MVP |
| 9 | **NCEP HRRR / GFS** | High-resolution gridded numerical weather prediction (HRRR = 3 km hourly) | GRIB2 on AWS S3 (`noaa-hrrr-bdp-pds`) | Higher-fidelity forecast features than NWS `/gridpoints` if the scoring model wants raw grids | Phase 2 |
| 10 | **NGS Emergency Response Imagery** | Post-storm aerial imagery over affected areas | GeoTIFF / tile services | Feeds the deferred Alt-3 post-event damage assessment workflow (CV) | Phase 3 |
| — | **NIFC / InciWeb** (non-NOAA) | Wildfire perimeters | KML / ArcGIS REST | Perimeter source — wildfire is out of NOAA scope for perimeters; SPC fire-weather + NWS Red Flag together give risk-gradient + trigger | Phase 2 (perimeter), MVP (risk-gradient via SPC) |

---

## Per-source operational notes

### NHC — hurricane track and surge
- **SLOSH MOM** (Maximum of Maximums) is a **static** inundation layer, always available, per basin — this is what MVP consumes for surge exposure.
- **NHC real-time surge polygon** exists only while an active tropical cyclone is spun up. Advisories update on a fixed cadence (roughly 5-hourly during active storms).
- **PRD must state explicitly:** "surge exposure is available continuously via SLOSH MOM; real-time NHC surge scenarios are only available during active advisories." This prevents anyone expecting live surge in a July demo when there's no active storm.
- **For the demo scenario:** use **Debby (August 2024) as the primary reference storm** and **Idalia (August 2023) as a validation-case reference**. NHC keeps GIS archives — pull one cone per storm + one advisory each as static fixtures. Rationale in [00_working_notes.md](00_working_notes.md).

### NOS CO-OPS — water levels
- **Anchor gauge for demo: Charleston Harbor (8665530).** Add one inland reference gauge for cross-check.
- Real tide/water-level data during a real recent coastal event is the single biggest credibility upgrade for the demo. Beats any synthetic curve.
- JSON REST, no auth. Pull one week around the archived storm's landfall.

### Digital Coast — coastal flood exposure
- Ships in **various projections** (Web Mercator, state plane, Albers). Reproject to WGS84 once at ingest.
- Statewide packages can be **hundreds of MB**. Clip to SGW footprint (SC/GA/NC) offline before committing anything. Repo `.gitignore` already flags large files.
- Combined with `asset_dependencies.csv` this produces cascading-impact-under-real-geographic-risk — a demo moment.

### NWM — inland streamflow
- Data volume is large. **Don't run NWM live for MVP.** Even Phase 2 should consume aggregated reach-level streamflow via `water.noaa.gov` derived products, not raw NetCDF.
- Framing this as Phase 2 is intentional: it shows domain-awareness of what a water utility should be piped into, without over-committing the MVP.

### NCEI Storm Events — historical baseline
- Filter to Southeastern US, hazard types matching the four in scope (hurricane, flood, heatwave, wildfire proxies).
- Feeds base-rate / historical-failure features into the hazard-conditional risk model. Also useful for calibration.

### NOAA Open Data on AWS
- Anonymous public S3. Boto3 requires `Config(signature_version=UNSIGNED)`, or use HTTPS S3 endpoints directly.
- Different access pattern from typical REST fetch — worth calling out in the ingestion adapter README.

### License and attribution
- Federal, public domain, no license restrictions.
- Attribution recommended, not required. UI footer as above.

---

## 6-day wiring plan (Thursday–Friday sprint)

Ordered by ROI. Total budget ≈ 6–8 hours; fits within existing Thursday afternoon / Friday morning slots without displacing anything in [03_plan.md](03_plan.md).

| # | Task | Effort | Delivers |
|---|---|---|---|
| 1 | CO-OPS Charleston Harbor 8665530 water levels — **two windows: Debby (Aug 2024) primary + Idalia (Aug 2023) validation** + one inland reference → `observations.csv` | ~1 h | Real observed water levels in the demo + surge validation case |
| 2 | Clip Digital Coast flood-exposure + NHC SLOSH MOM surge to SC/GA/NC footprint → `hazard_zones.geojson` fixtures | ~2–3 h | Real FEMA AE + real Cat-3 surge polygons the risk model spatially joins to |
| 3 | NHC forecast cones — **Debby (primary) + Idalia (validation)** → `hurricane_track_debby.geojson`, `hurricane_track_idalia.geojson` | ~1–2 h | Realistic hurricane tracks for the demo; validation case shows the same platform reasoning about a different storm |
| 4 | SPC / CPC outlook polygon for the heatwave scenario → hazard layer fixture | ~1 h | Real risk-gradient polygon for the heatwave demo variant |
| 5 | NCEI Storm Events filtered to Southeastern US → `data/reference/historical_events.csv` | ~1–2 h | Historical base-rate features for the risk model |

Everything numbered 6–10 in the source registry (nowCOAST, NWM, HRRR live, NGS imagery, NIFC perimeters) goes into the **PRD Phase 2** with concrete provider names. That's the "credible path from prototype → production" made specific.

---

## Framing wins for the exec briefing

- **"We integrate the entire NOAA stack, not just weather.gov"** — name-drop NHC, CO-OPS, Digital Coast, NWM, NCEI. These are the sources a real utility uses; showing awareness is worth marks.
- **"National Water Model for inland streamflow"** — Phase 2, but calling it out reads as domain-aware. This is precisely the NOAA product a water utility should be piped into and often isn't.
- **"Digital Coast + dependency graph"** — real coastal-flood exposure polygons combined with the internal cascading-impact model. Demonstrates the integration payoff.
- **"Adapter pattern isolates provider choice"** — same platform, different national data stack, drops into UK / EU / APAC deployment.
