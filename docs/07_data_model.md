# Data model & mock dataset design

## Design principle — fragmented on purpose

The mock dataset must look like **several fragmented operational systems that have to be brought together**, not one clean spreadsheet. This directly reflects SGW's stated problem: operational data is scattered across GIS, maintenance, weather, field-ops and control systems, each with its own format, identifier scheme and quality expectations. Presenting a pre-joined dataset would hide the exact integration challenge the platform is designed to solve.

What "fragmented" looks like in the mock:
- Different **formats** per source (GeoJSON, CSV, JSON)
- Different **asset identifiers** per system, requiring a crosswalk
- Different **freshness** expectations (SCADA seconds, GIS daily, inspections quarterly)
- Sensor data with realistic **quality flags** (Valid / Warning / Stale / Missing / Outlier)
- Field reports as free-text notes alongside structured fields
- A **curated** view that shows what the platform produces after ingestion + AI reasoning — separate from the raw sources

The prototype's ingestion layer resolves this fragmentation. That, on its own, is a defensible technical story before the AI is even invoked.

---

## Folder layout

```text
data/
├── raw/
│   ├── gis/
│   │   ├── assets.geojson
│   │   ├── service_areas.geojson
│   │   └── hazard_zones.geojson
│   ├── maintenance/
│   │   ├── work_orders.csv
│   │   └── inspection_history.csv
│   ├── weather/
│   │   ├── observations.csv
│   │   ├── forecasts.json
│   │   └── alerts.json
│   ├── field_operations/
│   │   ├── crews.csv
│   │   ├── crew_status.csv
│   │   └── field_reports.csv
│   └── operations/
│       ├── sensor_readings.csv
│       ├── outages.csv
│       └── incidents.csv
├── reference/
│   ├── asset_id_crosswalk.csv
│   ├── asset_dependencies.csv
│   └── regions.csv
└── curated/
    └── operational_risk_snapshot.csv
```

---

## 1. GIS and asset data

GIS provides the spatial and infrastructure context. Normally stored as GeoJSON, shapefiles or PostGIS.

### `assets.geojson`

| Field | Example |
| --- | --- |
| `asset_id` | `SGW-PMP-0321` |
| `asset_name` | `Marsh Point Pumping Station` |
| `asset_type` | `water_pumping_station` |
| `utility_domain` | `water` |
| `region` | `Coastal East` |
| `latitude` | `32.7812` |
| `longitude` | `-79.9453` |
| `geometry` | Point, line or polygon |
| `operational_status` | `operational` |
| `criticality_rating` | `5` |
| `condition_score` | `62` |
| `commissioned_year` | `1987` |
| `design_capacity` | `42` |
| `capacity_unit` | `MGD` |
| `service_population` | `184000` |
| `flood_zone` | `AE` |
| `ground_elevation_ft` | `11.2` |
| `backup_power` | `diesel_generator` |
| `last_inspection_date` | `2026-05-11` |

Example GeoJSON feature:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-79.9453, 32.7812] },
  "properties": {
    "asset_id": "SGW-PMP-0321",
    "asset_name": "Marsh Point Pumping Station",
    "asset_type": "water_pumping_station",
    "utility_domain": "water",
    "region": "Coastal East",
    "criticality_rating": 5,
    "condition_score": 62,
    "service_population": 184000,
    "flood_zone": "AE",
    "operational_status": "operational"
  }
}
```

Asset types covered:
- Electrical substations
- Transmission-line segments
- Distribution feeders
- Water treatment plants
- Wastewater treatment plants
- Pumping stations
- Reservoirs and storage tanks
- Major pipelines
- Control centres
- Emergency generators

### `service_areas.geojson`

Polygons showing which geographic areas each asset supports.

| Field | Example |
| --- | --- |
| `service_area_id` | `SA-COAST-07` |
| `service_area_name` | `Charleston Coastal District` |
| `population` | `426000` |
| `priority_facilities` | `12` |
| `hospitals` | `3` |
| `emergency_shelters` | `8` |
| `primary_asset_id` | `SGW-SUB-0142` |

### `hazard_zones.geojson`

Polygons representing known hazards:
- FEMA-style flood zones
- Storm-surge zones
- Wildfire-risk areas
- Landslide / erosion areas
- Extreme-heat zones
- Hurricane evacuation zones

**Seeded from real NOAA / Digital Coast layers** clipped to the SGW footprint (SC / GA / NC), stored as offline fixtures — not hand-drawn. Each polygon carries `source` metadata (Digital Coast, NHC SLOSH MOM, SPC/CPC outlook, FEMA, …). See [08_external_data_sources.md](08_external_data_sources.md) for the full source registry.

Enables queries like: *which critical assets fall within the predicted storm-surge area?*

---

## 2. Maintenance platform data

Represents a CMMS (e.g., Maximo).

### `work_orders.csv`

| work_order_id | asset_id | work_type | description | priority | created_at | due_date | status | estimated_hours |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| WO-98421 | SGW-PMP-0321 | Preventive | Inspect flood barrier seals | High | 2026-06-02 | 2026-06-30 | Overdue | 6 |
| WO-98422 | SGW-SUB-0142 | Corrective | Replace transformer cooling fan | Critical | 2026-07-10 | 2026-07-14 | In progress | 10 |
| WO-98423 | SGW-WTP-0007 | Inspection | Inspect chlorine dosing system | Medium | 2026-07-11 | 2026-07-25 | Scheduled | 4 |

Additional fields worth including:
`maintenance_system_asset_id, failure_code, scheduled_start, completed_at, assigned_team, actual_hours, estimated_cost, actual_cost, parts_required, safety_requirement`.

### `inspection_history.csv`

| inspection_id | asset_id | inspected_at | inspection_type | condition_score | defect_found | severity | notes |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| INS-77102 | SGW-PMP-0321 | 2026-05-11 | Annual | 62 | Yes | Moderate | Corrosion around access hatch |
| INS-77103 | SGW-SUB-0142 | 2026-06-18 | Thermal | 48 | Yes | High | Abnormal transformer temperature |
| INS-77104 | SGW-WTP-0007 | 2026-06-22 | Process safety | 87 | No | None | No material defects identified |

Gives the AI evidence about **asset vulnerability**, not just exposure to a weather hazard.

---

## 3. External hazard & weather data

Separated because observed weather, forecast weather, and issued alerts have different levels of certainty and different consumers. **Backed by the full NOAA stack, not just `api.weather.gov`** — NWS + NHC (hurricane track, SLOSH surge) + NOS CO-OPS (tide gauges) + Digital Coast (flood exposure) + SPC/CPC (severe-storm and heat outlooks) + NCEI (historical baseline). Phase 2 adds NWM (streamflow), HRRR (high-resolution gridded forecast), NGS imagery, nowCOAST. See [08_external_data_sources.md](08_external_data_sources.md).

**For the demo:** real Charleston Harbor (8665530) water-level observations + Digital Coast flood-exposure polygons + an archived NHC hurricane cone (e.g., Ian, Idalia, Debby) — not synthetic curves and hand-drawn polygons.

### `observations.csv`

| observation_time | station_id | latitude | longitude | rainfall_1h_in | rainfall_24h_in | wind_speed_mph | wind_gust_mph | temperature_f | river_level_ft |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-07-14T14:00:00Z | WX-CHAR-01 | 32.79 | -79.94 | 0.62 | 3.41 | 31 | 49 | 82 | 7.4 |
| 2026-07-14T15:00:00Z | WX-CHAR-01 | 32.79 | -79.94 | 0.91 | 4.32 | 38 | 58 | 81 | 8.1 |

### `forecasts.json`

```json
{
  "forecast_id": "FC-20260714-CHAR-06",
  "issued_at": "2026-07-14T12:00:00Z",
  "valid_from": "2026-07-14T18:00:00Z",
  "valid_to": "2026-07-15T18:00:00Z",
  "region": "Coastal East",
  "forecast_horizon_hours": 30,
  "rainfall_total_in": 8.4,
  "maximum_wind_gust_mph": 82,
  "storm_surge_ft": 5.7,
  "flood_probability": 0.78,
  "forecast_confidence": "medium",
  "source": "SGW Synthetic Weather Feed"
}
```

### `alerts.json`

```json
{
  "alert_id": "WX-ALERT-1042",
  "hazard_type": "flash_flood",
  "severity": "severe",
  "urgency": "immediate",
  "issued_at": "2026-07-14T15:10:00Z",
  "expires_at": "2026-07-15T02:00:00Z",
  "affected_regions": ["Coastal East", "Lower Delta"],
  "headline": "Severe flash-flood conditions expected",
  "predicted_impacts": [
    "Road closures",
    "Pumping-station access restrictions",
    "Potential substation inundation"
  ]
}
```

Alerts carry the **hazard type** (`flash_flood`, `hurricane`, `heatwave`, `wildfire`, …) that anchors hazard-conditional risk scoring downstream. Live source: NWS `/alerts/active`. For hurricane-specific track + surge: NHC GIS (cone shapefile + SLOSH MOM). Feeds refresh every simulated hour for the prototype.

---

## 4. Operational sensor data (SCADA / IoT)

### `sensor_readings.csv`

| timestamp | sensor_id | asset_id | metric | value | unit | quality_flag |
| --- | --- | --- | --- | ---: | --- | --- |
| 2026-07-14T14:00:00Z | SNS-PMP-321-01 | SGW-PMP-0321 | wet_well_level | 76.2 | percent | Valid |
| 2026-07-14T14:00:00Z | SNS-PMP-321-02 | SGW-PMP-0321 | pump_vibration | 9.8 | mm/s | Warning |
| 2026-07-14T14:00:00Z | SNS-SUB-142-01 | SGW-SUB-0142 | transformer_load | 94.1 | percent | Valid |
| 2026-07-14T14:00:00Z | SNS-WTP-007-01 | SGW-WTP-0007 | turbidity | 1.9 | NTU | Valid |

Metrics covered:

**Electrical** — transformer load, voltage, frequency, equipment temperature, breaker state, feeder load, battery charge, generator fuel level.

**Water** — flow rate, water pressure, reservoir level, pump vibration, pump motor temperature, turbidity, chlorine concentration, wet-well level.

`quality_flag` values: `Valid, Estimated, Stale, Missing, Outlier, Sensor fault`. Realistic sensor noise + quality flags are essential — they force the anomaly detection and risk scoring to handle imperfect inputs, which is the real operational condition.

---

## 5. Field operations data

Should show both **where crews are** and **what they are seeing**.

### `crews.csv`

| crew_id | crew_name | base_region | capability | shift_start | shift_end |
| --- | --- | --- | --- | --- | --- |
| CREW-E-12 | Electrical Response 12 | Coastal East | High-voltage electrical | 06:00 | 18:00 |
| CREW-W-07 | Water Operations 7 | Coastal East | Pump and pipeline repair | 06:00 | 18:00 |
| CREW-V-03 | Vegetation Team 3 | Inland North | Line clearance | 07:00 | 19:00 |

### `crew_status.csv`

| timestamp | crew_id | status | latitude | longitude | current_job_id | travel_time_min |
| --- | --- | --- | ---: | ---: | --- | ---: |
| 2026-07-14T15:00:00Z | CREW-E-12 | En route | 32.83 | -79.91 | INC-24019 | 27 |
| 2026-07-14T15:00:00Z | CREW-W-07 | Available | 32.78 | -79.97 | | 0 |
| 2026-07-14T15:00:00Z | CREW-V-03 | Assigned | 33.42 | -80.11 | WO-98430 | 42 |

### `field_reports.csv`

| report_id | asset_id | crew_id | submitted_at | observation_type | severity | access_status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FR-55201 | SGW-PMP-0321 | CREW-W-07 | 2026-07-14T14:42:00Z | Flooding | High | Restricted | Water approximately 8 inches above access road |
| FR-55202 | SGW-SUB-0142 | CREW-E-12 | 2026-07-14T15:06:00Z | Equipment fault | Critical | Accessible | Cooling fan stopped; transformer temperature rising |
| FR-55203 | SGW-TL-0448 | CREW-V-03 | 2026-07-14T15:18:00Z | Vegetation | Moderate | Accessible | Tree limb within 3 feet of conductor |

Include image filenames (no actual images required): `FR-55201_01.jpg`, `FR-55201_02.jpg` — allows the demo to show a photo-attachment surface without needing real images.

---

## 6. Incident and outage data

### `incidents.csv`

| incident_id | opened_at | incident_type | region | primary_asset_id | severity | status | people_affected | lead_team |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| INC-24019 | 2026-07-14T14:51:00Z | Transformer overheating | Coastal East | SGW-SUB-0142 | Critical | Active | 84000 | Electrical Response |
| INC-24020 | 2026-07-14T15:12:00Z | Pump capacity reduction | Coastal East | SGW-PMP-0321 | High | Monitoring | 184000 | Water Operations |
| INC-24021 | 2026-07-14T15:26:00Z | Transmission obstruction | Inland North | SGW-TL-0448 | Medium | Assigned | 22000 | Vegetation Management |

Additional useful fields: `incident_type, detected_by, opened_at, confirmed_at, resolved_at, related_asset_ids, critical_facilities_affected, estimated_restoration_time, command_lead, response_notes`.

Aggregated service impact only — no individual resident data.

---

## 7. Infrastructure dependencies

The most valuable single dataset for demonstrating situational awareness.

### `asset_dependencies.csv`

| upstream_asset_id | downstream_asset_id | dependency_type | consequence_if_lost |
| --- | --- | --- | --- |
| SGW-SUB-0142 | SGW-PMP-0321 | Electrical supply | Pumping station operates on backup power |
| SGW-PMP-0321 | SGW-WTR-ZONE-08 | Water pressure | Loss of pressure for approximately 184,000 residents |
| SGW-SUB-0197 | SGW-HSP-004 | Electrical supply | Hospital generator activation required |

Enables cascading-impact reasoning: *a substation failure may not only cause a power outage — it may also disable a pumping station and reduce water pressure at a hospital*. This is the "AI-assisted situational awareness" bullet made concrete.

---

## 8. Asset ID crosswalk

To represent the fragmentation problem realistically, the systems should not all use the same identifier.

### `asset_id_crosswalk.csv`

| canonical_asset_id | gis_id | maintenance_id | scada_id | field_ops_id |
| --- | --- | --- | --- | --- |
| SGW-PMP-0321 | GIS-PS-321 | MAX-001893 | SCADA-P321 | FO-PS-0321 |
| SGW-SUB-0142 | GIS-SE-142 | MAX-004223 | SCADA-S142 | FO-SUB-142 |

The integration layer resolves these to a canonical `asset_id`. More believable than assuming every source system aligns cleanly.

---

## 9. Curated operational risk view

The prototype does not query every raw source directly at runtime. It produces a joined, explainable operational snapshot — the output of ingestion + AI reasoning.

### `operational_risk_snapshot.csv`

| asset_id | snapshot_time | hazard_score | condition_risk | operational_anomaly | overdue_maintenance | consequence_score | crew_eta_min | overall_risk | recommended_action |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| SGW-PMP-0321 | 2026-07-14T15:00:00Z | 91 | 64 | 82 | Yes | 88 | 24 | 89 | Deploy water crew and inspect flood barriers |
| SGW-SUB-0142 | 2026-07-14T15:00:00Z | 73 | 81 | 95 | No | 93 | 27 | 92 | Reduce transformer load and dispatch electrical crew |
| SGW-WTP-0007 | 2026-07-14T15:00:00Z | 46 | 21 | 12 | No | 97 | 58 | 48 | Continue monitoring; prepare backup generation |

Detailed per-asset response record (structured LLM output):

```json
{
  "asset_id": "SGW-PMP-0321",
  "asset_name": "Marsh Point Pumping Station",
  "hazard_type": "flash_flood",
  "overall_risk_score": 89,
  "risk_level": "critical",
  "recommended_action": "Dispatch a water operations crew and activate the flood response procedure.",
  "reasoning_summary": [
    "The pumping station is within the predicted flash-flood area.",
    "Observed water levels are rising.",
    "Its flood-barrier inspection is overdue.",
    "Pump vibration has exceeded its warning threshold.",
    "The station supports approximately 184,000 residents."
  ],
  "uncertainties": [
    "The latest field report is 38 minutes old.",
    "The flood forecast is classified as medium confidence."
  ],
  "evidence": [
    "WX-ALERT-1042", "WO-98421", "SNS-PMP-321-02", "FR-55201"
  ],
  "human_approval_required": true
}
```

Supports decision-making while keeping the operator in control.

---

## Recommended prototype scale

Not millions of records. A credible lightweight dataset:

| Dataset | Suggested volume |
| --- | ---: |
| Infrastructure assets | 150–300 |
| Network dependency relationships | 200–500 |
| Service-area polygons | 10–20 |
| Hazard-area polygons | 10–30 |
| Maintenance work orders | 150–300 |
| Inspection records | 300–600 |
| Sensor readings | 20,000–50,000 |
| Weather observations | 500–2,000 |
| Weather alerts | 10–30 |
| Field crews | 12–20 |
| Field reports | 50–100 |
| Incidents | 20–40 |

A four-week simulated period with one major simulated hazard event is enough.

## Demo scenario

The demo scenario is a 72-hour hurricane + flash-flood event on the Coastal East region, grounded in **Hurricane Debby (August 2024)** as the primary reference storm and **Hurricane Idalia (August 2023)** as a validation case for the surge signal at Charleston Harbor gauge 8665530. See [00_working_notes.md](00_working_notes.md) for the rationale, and [08_external_data_sources.md](08_external_data_sources.md) for how the NOAA fixtures are pulled.

Debby's slow-moving 72h+ evolution and historic rainfall over GA/SC make it the strongest multi-hazard demo case (hurricane classification + flash-flood alerts + inland flooding). Idalia is referenced live as a validation moment — same platform, same assets, different storm — to show the surge visual at Charleston that Debby doesn't headline.

The scenario threads through every persona:

1. External weather alert predicts heavy rainfall, high winds and storm surge.
2. Platform ingests the alert, joins to GIS + hazard zones + asset registry.
3. Hazard-conditional risk scoring identifies several coastal assets as exposed.
4. Maintenance records show that one pumping station has an overdue flood-barrier inspection.
5. Sensor data shows rising wet-well levels and abnormal pump vibration.
6. A field report confirms flooding on the access road.
7. Dependency graph surfaces cascading impacts: substation → pumping station → hospital.
8. Optimiser proposes crew pre-positioning across the affected region.
9. Platform ranks the pumping station as critical, produces a structured explanation citing WX-ALERT-1042, WO-98421, SNS-PMP-321-02, FR-55201.
10. Operations Controller reviews evidence, accepts or overrides — audit log records everything.
11. Executive dashboard shows aggregated affected services and response progress; LLM drafts a briefing paragraph on demand.

Same platform, same workflow, would handle a wildfire, heatwave or inland-flood scenario — with the hazard-conditional risk scoring adapting the contributing factors accordingly.
