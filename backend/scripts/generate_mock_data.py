"""Generate fragmented-on-purpose synthetic operational data.

Outputs to `data/raw/**` and `data/reference/**` at the project root.
Idempotent — regenerating with the same seed produces the same files.

Usage:
    python -m scripts.generate_mock_data [--seed 42] [--out DIR]
"""

from __future__ import annotations

import json
import random
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import typer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# SGW footprint: SC / GA / NC coastal + inland (per assumption A5).
REGIONS: list[dict] = [
    {
        "region_id": "COAST_EAST",
        "name": "Coastal East (SC)",
        "state_code": "SC",
        "bbox": (-80.20, 32.55, -79.70, 33.00),  # Charleston area
    },
    {
        "region_id": "LOWER_DELTA",
        "name": "Lower Delta (GA)",
        "state_code": "GA",
        "bbox": (-81.30, 31.00, -80.80, 31.60),  # Brunswick area
    },
    {
        "region_id": "INLAND_NORTH",
        "name": "Inland North (NC)",
        "state_code": "NC",
        "bbox": (-80.90, 35.10, -80.30, 35.60),  # Charlotte area
    },
]

ASSET_TYPES_ELECTRICAL = [
    ("electrical_substation", "electrical", "MVA"),
    ("transmission_line_segment", "electrical", "kV"),
    ("distribution_feeder", "electrical", "kV"),
    ("emergency_generator", "electrical", "kW"),
]
ASSET_TYPES_WATER = [
    ("water_treatment_plant", "water", "MGD"),
    ("wastewater_treatment_plant", "wastewater", "MGD"),
    ("water_pumping_station", "water", "MGD"),
    ("reservoir_storage_tank", "water", "MG"),
    ("major_pipeline", "water", "MGD"),
]
CONTROL_TYPES = [("control_centre", "operations", "sites")]

ASSET_TYPES = ASSET_TYPES_ELECTRICAL + ASSET_TYPES_WATER + CONTROL_TYPES

QUALITY_FLAGS = ["Valid"] * 88 + ["Warning"] * 6 + ["Stale"] * 3 + ["Missing"] * 1 + ["Outlier"] * 1 + ["Sensor fault"] * 1
FLOOD_ZONES = ["X", "AE", "VE", "A", "X500"]
BACKUP_POWERS = [None, "diesel_generator", "gas_generator", "battery_ups"]

# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

app = typer.Typer(add_completion=False)


def _rand_point_in_bbox(rng: random.Random, bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    lng = rng.uniform(bbox[0], bbox[2])
    lat = rng.uniform(bbox[1], bbox[3])
    return lng, lat


def generate_regions(out_dir: Path) -> pd.DataFrame:
    rows = [{"region_id": r["region_id"], "name": r["name"], "state_code": r["state_code"]} for r in REGIONS]
    df = pd.DataFrame(rows)
    (out_dir / "reference").mkdir(parents=True, exist_ok=True)
    df.to_csv(out_dir / "reference" / "regions.csv", index=False)
    return df


def generate_assets(rng: random.Random, out_dir: Path, count: int = 200) -> list[dict]:
    features = []
    assets = []
    per_region = count // len(REGIONS)

    for region in REGIONS:
        for i in range(per_region):
            asset_type, utility_domain, cap_unit = rng.choice(ASSET_TYPES)
            lng, lat = _rand_point_in_bbox(rng, region["bbox"])
            asset_id = f"SGW-{asset_type[:3].upper()}-{region['region_id'][:2]}{i:04d}"
            year = rng.randint(1965, 2020)
            criticality = rng.choices([1, 2, 3, 4, 5], weights=[5, 15, 40, 25, 15])[0]
            condition = int(np.clip(rng.gauss(70, 15), 20, 100))

            props = {
                "asset_id": asset_id,
                "asset_name": f"{region['name']} {asset_type.replace('_', ' ').title()} {i + 1:03d}",
                "asset_type": asset_type,
                "utility_domain": utility_domain,
                "region": region["region_id"],
                "latitude": round(lat, 6),
                "longitude": round(lng, 6),
                "operational_status": "operational",
                "criticality_rating": criticality,
                "condition_score": condition,
                "commissioned_year": year,
                "design_capacity": round(rng.uniform(10, 500), 1),
                "capacity_unit": cap_unit,
                "service_population": rng.randint(500, 300_000) if utility_domain != "operations" else None,
                "flood_zone": rng.choice(FLOOD_ZONES),
                "ground_elevation_ft": round(rng.uniform(2, 400), 1),
                "backup_power": rng.choice(BACKUP_POWERS),
                "last_inspection_date": (date(2026, 7, 1) - timedelta(days=rng.randint(30, 400))).isoformat(),
            }
            assets.append(props)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
                    "properties": props,
                }
            )

    (out_dir / "raw" / "gis").mkdir(parents=True, exist_ok=True)
    (out_dir / "raw" / "gis" / "assets.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=2)
    )
    return assets


def generate_service_areas(rng: random.Random, out_dir: Path, assets: list[dict]) -> None:
    features = []
    for region in REGIONS:
        for i in range(5):
            bbox = region["bbox"]
            cx = rng.uniform(bbox[0] + 0.05, bbox[2] - 0.05)
            cy = rng.uniform(bbox[1] + 0.05, bbox[3] - 0.05)
            w = rng.uniform(0.02, 0.08)
            h = rng.uniform(0.02, 0.08)
            poly = [
                [cx - w, cy - h],
                [cx + w, cy - h],
                [cx + w, cy + h],
                [cx - w, cy + h],
                [cx - w, cy - h],
            ]
            primary_asset = rng.choice([a for a in assets if a["region"] == region["region_id"]])
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [poly]},
                    "properties": {
                        "service_area_id": f"SA-{region['region_id']}-{i:02d}",
                        "service_area_name": f"{region['name']} District {i + 1}",
                        "population": rng.randint(20_000, 500_000),
                        "priority_facilities": rng.randint(2, 20),
                        "hospitals": rng.randint(0, 5),
                        "emergency_shelters": rng.randint(1, 12),
                        "primary_asset_id": primary_asset["asset_id"],
                    },
                }
            )
    (out_dir / "raw" / "gis" / "service_areas.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=2)
    )


def generate_hazard_zones(rng: random.Random, out_dir: Path) -> None:
    """Placeholder — real fixtures from NOAA/Digital Coast land in Phase 2."""
    features = []
    hazard_types = [
        ("flood_zone", "FEMA_placeholder"),
        ("storm_surge", "NHC_SLOSH_placeholder"),
        ("wildfire_risk", "SPC_placeholder"),
        ("extreme_heat", "CPC_placeholder"),
    ]
    for region in REGIONS:
        for hazard_type, source in hazard_types:
            bbox = region["bbox"]
            cx = rng.uniform(bbox[0] + 0.05, bbox[2] - 0.05)
            cy = rng.uniform(bbox[1] + 0.05, bbox[3] - 0.05)
            w = rng.uniform(0.08, 0.15)
            h = rng.uniform(0.08, 0.15)
            poly = [
                [cx - w, cy - h],
                [cx + w, cy - h],
                [cx + w, cy + h],
                [cx - w, cy + h],
                [cx - w, cy - h],
            ]
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "MultiPolygon", "coordinates": [[poly]]},
                    "properties": {
                        "hazard_zone_id": f"HZ-{hazard_type}-{region['region_id']}",
                        "hazard_type": hazard_type,
                        "severity_band": rng.choice(["low", "moderate", "high", "extreme"]),
                        "source": source,
                    },
                }
            )
    (out_dir / "raw" / "gis" / "hazard_zones.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=2)
    )


def generate_work_orders(rng: random.Random, out_dir: Path, assets: list[dict], count: int = 300) -> None:
    rows = []
    priorities = ["Low", "Medium", "High", "Critical"]
    statuses = ["Scheduled", "In progress", "Completed", "Overdue"]
    work_types = ["Preventive", "Corrective", "Inspection", "Emergency"]
    for i in range(count):
        asset = rng.choice(assets)
        created = datetime(2026, 5, 1, tzinfo=UTC) + timedelta(days=rng.randint(0, 75))
        rows.append(
            {
                "work_order_id": f"WO-{90000 + i:05d}",
                "asset_id": asset["asset_id"],
                "work_type": rng.choice(work_types),
                "description": f"{rng.choice(['Inspect', 'Replace', 'Service', 'Test'])} "
                f"{rng.choice(['seals', 'bearings', 'controllers', 'wiring', 'insulation'])}",
                "priority": rng.choices(priorities, weights=[20, 40, 30, 10])[0],
                "created_at_source": created.isoformat(),
                "due_date": (created.date() + timedelta(days=rng.randint(7, 60))).isoformat(),
                "status": rng.choices(statuses, weights=[40, 20, 30, 10])[0],
                "estimated_hours": round(rng.uniform(1, 40), 1),
                "assigned_team": rng.choice(["Team A", "Team B", "Team C", None]),
            }
        )
    (out_dir / "raw" / "maintenance").mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(out_dir / "raw" / "maintenance" / "work_orders.csv", index=False)


def generate_inspection_history(rng: random.Random, out_dir: Path, assets: list[dict], count: int = 500) -> None:
    rows = []
    inspection_types = ["Annual", "Thermal", "Process safety", "Visual", "Vibration"]
    severities = [None, "Low", "Moderate", "High"]
    for i in range(count):
        asset = rng.choice(assets)
        inspected = date(2026, 7, 1) - timedelta(days=rng.randint(1, 720))
        defect_found = rng.random() < 0.25
        rows.append(
            {
                "inspection_id": f"INS-{70000 + i:05d}",
                "asset_id": asset["asset_id"],
                "inspected_at": inspected.isoformat(),
                "inspection_type": rng.choice(inspection_types),
                "condition_score": int(np.clip(rng.gauss(75, 12), 25, 100)),
                "defect_found": defect_found,
                "severity": rng.choice(severities[1:]) if defect_found else None,
                "notes": rng.choice(
                    ["No material defects", "Minor corrosion", "Vibration above spec", "Requires follow-up"]
                ),
            }
        )
    pd.DataFrame(rows).to_csv(out_dir / "raw" / "maintenance" / "inspection_history.csv", index=False)


def generate_sensor_readings(
    rng: random.Random,
    out_dir: Path,
    assets: list[dict],
    hours: int = 168,
) -> None:
    """One week of hourly readings per SCADA-instrumented asset (~1/3 of assets, 2 sensors each)."""
    rows = []
    truth = []  # hidden truth file — records injected anomalies
    scada_assets = rng.sample(assets, k=len(assets) // 3)

    sensor_metric_map = {
        "electrical_substation": [("transformer_load", "percent", 60, 15), ("transformer_temp", "degC", 55, 10)],
        "distribution_feeder": [("feeder_load", "percent", 55, 20)],
        "transmission_line_segment": [("line_current", "amps", 400, 80)],
        "water_pumping_station": [("wet_well_level", "percent", 65, 15), ("pump_vibration", "mm/s", 4.0, 1.5)],
        "water_treatment_plant": [("turbidity", "NTU", 1.5, 0.6), ("chlorine_ppm", "ppm", 1.5, 0.3)],
        "wastewater_treatment_plant": [("influent_flow", "MGD", 20, 5)],
        "reservoir_storage_tank": [("reservoir_level", "percent", 78, 8)],
        "major_pipeline": [("pipeline_pressure", "psi", 85, 12)],
        "emergency_generator": [("generator_fuel", "percent", 90, 5)],
        "control_centre": [("network_latency", "ms", 12, 3)],
    }

    start = datetime(2026, 7, 10, 0, 0, tzinfo=UTC)
    for asset in scada_assets:
        metrics = sensor_metric_map.get(asset["asset_type"])
        if not metrics:
            continue
        for m_idx, (metric, unit, base, sd) in enumerate(metrics):
            sensor_id = f"SNS-{asset['asset_id'].split('-')[-1]}-{m_idx:02d}"
            # optional injected anomaly for detection eval
            inject_anomaly_at = rng.randint(hours // 3, 2 * hours // 3) if rng.random() < 0.3 else None
            for h in range(hours):
                ts = start + timedelta(hours=h)
                diurnal = np.sin(2 * np.pi * (h % 24) / 24) * (sd * 0.6)
                noise = rng.gauss(0, sd * 0.35)
                value = base + diurnal + noise
                if inject_anomaly_at is not None and abs(h - inject_anomaly_at) <= 1:
                    value += sd * 4.5  # spike
                    truth.append({"sensor_id": sensor_id, "timestamp": ts.isoformat(), "kind": "spike"})
                flag = rng.choices(QUALITY_FLAGS, k=1)[0]
                rows.append(
                    {
                        "timestamp": ts.isoformat(),
                        "sensor_id": sensor_id,
                        "asset_id": asset["asset_id"],
                        "metric": metric,
                        "value": round(value, 3),
                        "unit": unit,
                        "quality_flag": flag,
                    }
                )

    (out_dir / "raw" / "operations").mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(out_dir / "raw" / "operations" / "sensor_readings.csv", index=False)
    (out_dir / "reference").mkdir(parents=True, exist_ok=True)
    pd.DataFrame(truth).to_csv(out_dir / "reference" / "_sensor_anomaly_truth.csv", index=False)


def generate_crews(rng: random.Random, out_dir: Path) -> list[dict]:
    crews = []
    capabilities = ["High-voltage electrical", "Pump and pipeline repair", "Line clearance", "Water quality"]
    for i, region in enumerate(REGIONS):
        for j in range(5):
            crews.append(
                {
                    "crew_id": f"CREW-{region['region_id'][:2]}-{i}{j:02d}",
                    "crew_name": f"{region['name']} Response {i + 1}-{j + 1}",
                    "base_region": region["region_id"],
                    "capability": rng.choice(capabilities),
                    "shift_start": time(6, 0).isoformat(),
                    "shift_end": time(18, 0).isoformat(),
                }
            )
    _ = j  # keep the loop variable explicit
    (out_dir / "raw" / "field_operations").mkdir(parents=True, exist_ok=True)
    pd.DataFrame(crews).to_csv(out_dir / "raw" / "field_operations" / "crews.csv", index=False)
    return crews


def generate_crew_status(rng: random.Random, out_dir: Path, crews: list[dict], count: int = 300) -> None:
    rows = []
    statuses = ["Available", "En route", "On site", "Assigned", "Off shift"]
    for _ in range(count):
        crew = rng.choice(crews)
        region = next(r for r in REGIONS if r["region_id"] == crew["base_region"])
        lng, lat = _rand_point_in_bbox(rng, region["bbox"])
        ts = datetime(2026, 7, 14, 6, 0, tzinfo=UTC) + timedelta(minutes=rng.randint(0, 60 * 24 * 3))
        rows.append(
            {
                "timestamp": ts.isoformat(),
                "crew_id": crew["crew_id"],
                "status": rng.choice(statuses),
                "latitude": round(lat, 6),
                "longitude": round(lng, 6),
                "current_job_id": None,
                "travel_time_min": rng.randint(0, 45),
            }
        )
    pd.DataFrame(rows).to_csv(out_dir / "raw" / "field_operations" / "crew_status.csv", index=False)


def generate_field_reports(rng: random.Random, out_dir: Path, assets: list[dict], crews: list[dict], count: int = 75) -> None:
    rows = []
    observations = ["Flooding", "Equipment fault", "Vegetation", "Vandalism", "Debris", "Normal"]
    severities = ["Low", "Moderate", "High", "Critical"]
    access = ["Accessible", "Restricted", "Blocked"]
    for i in range(count):
        rows.append(
            {
                "report_id": f"FR-{55000 + i:05d}",
                "asset_id": rng.choice(assets)["asset_id"],
                "crew_id": rng.choice(crews)["crew_id"],
                "submitted_at": (datetime(2026, 7, 14, tzinfo=UTC) + timedelta(minutes=rng.randint(0, 4320))).isoformat(),
                "observation_type": rng.choice(observations),
                "severity": rng.choices(severities, weights=[35, 30, 25, 10])[0],
                "access_status": rng.choice(access),
                "notes": rng.choice(
                    [
                        "Water approx 8 inches above access road",
                        "Cooling fan stopped; temperature rising",
                        "Tree limb within 3 feet of conductor",
                        "No material defects identified",
                        "Fence damage; asset intact",
                    ]
                ),
                "photo_reference": f"FR-{55000 + i:05d}_01.jpg",
            }
        )
    pd.DataFrame(rows).to_csv(out_dir / "raw" / "field_operations" / "field_reports.csv", index=False)


def generate_incidents_and_outages(
    rng: random.Random, out_dir: Path, assets: list[dict]
) -> None:
    incidents = []
    outages = []
    severities = ["Low", "Medium", "High", "Critical"]
    statuses = ["Active", "Monitoring", "Assigned", "Resolved"]
    incident_types = [
        "Transformer overheating",
        "Pump capacity reduction",
        "Transmission obstruction",
        "Turbidity spike",
        "Pipeline pressure loss",
    ]

    for i in range(30):
        asset = rng.choice(assets)
        opened = datetime(2026, 7, 14, tzinfo=UTC) + timedelta(hours=rng.randint(0, 72))
        status = rng.choice(statuses)
        incidents.append(
            {
                "incident_id": f"INC-{24000 + i:05d}",
                "opened_at": opened.isoformat(),
                "incident_type": rng.choice(incident_types),
                "region": asset["region"],
                "primary_asset_id": asset["asset_id"],
                "severity": rng.choices(severities, weights=[15, 30, 40, 15])[0],
                "status": status,
                "people_affected": rng.randint(200, 250_000),
                "lead_team": rng.choice(["Electrical Response", "Water Operations", "Vegetation Management"]),
                "resolved_at": (opened + timedelta(hours=rng.randint(2, 24))).isoformat() if status == "Resolved" else None,
                "response_notes": None,
                "related_asset_ids": json.dumps([]),
            }
        )
        if rng.random() < 0.7:
            outages.append(
                {
                    "outage_id": f"OUT-{40000 + i:05d}",
                    "incident_id": f"INC-{24000 + i:05d}",
                    "asset_id": asset["asset_id"],
                    "started_at": opened.isoformat(),
                    "restored_at": (opened + timedelta(hours=rng.randint(1, 12))).isoformat() if status == "Resolved" else None,
                    "customers_affected": rng.randint(50, 20_000),
                    "cause": rng.choice(["equipment failure", "storm damage", "planned", "unknown"]),
                }
            )
    pd.DataFrame(incidents).to_csv(out_dir / "raw" / "operations" / "incidents.csv", index=False)
    pd.DataFrame(outages).to_csv(out_dir / "raw" / "operations" / "outages.csv", index=False)


def generate_dependencies_and_crosswalk(
    rng: random.Random, out_dir: Path, assets: list[dict]
) -> None:
    """Dependency graph with realistic topology + deliberately-different IDs per source system."""
    dep_types = [
        ("Electrical supply", "Backup power required"),
        ("Water pressure", "Pressure loss for downstream assets"),
        ("Control signal", "Loss of remote control"),
        ("Fuel supply", "Runtime limited to on-site fuel"),
    ]
    deps = []
    # Prefer electrical → water dependencies for cascading realism
    electrical = [a for a in assets if a["utility_domain"] == "electrical"]
    water = [a for a in assets if a["utility_domain"] in ("water", "wastewater")]
    other = [a for a in assets if a not in electrical and a not in water]

    for src in electrical:
        n_children = rng.choices([0, 1, 2, 3], weights=[30, 40, 20, 10])[0]
        candidates = [a for a in water + other if a["region"] == src["region"] and a["asset_id"] != src["asset_id"]]
        for target in rng.sample(candidates, k=min(n_children, len(candidates))):
            dep_type, consequence = rng.choice(dep_types)
            deps.append(
                {
                    "upstream_asset_id": src["asset_id"],
                    "downstream_asset_id": target["asset_id"],
                    "dependency_type": dep_type,
                    "consequence_if_lost": consequence,
                }
            )
    # Add some water → other cascades
    for src in rng.sample(water, k=min(30, len(water))):
        candidates = [a for a in other if a["region"] == src["region"]]
        if candidates:
            target = rng.choice(candidates)
            deps.append(
                {
                    "upstream_asset_id": src["asset_id"],
                    "downstream_asset_id": target["asset_id"],
                    "dependency_type": "Water pressure",
                    "consequence_if_lost": "Downstream operations impacted",
                }
            )

    (out_dir / "reference").mkdir(parents=True, exist_ok=True)
    pd.DataFrame(deps).to_csv(out_dir / "reference" / "asset_dependencies.csv", index=False)

    # Crosswalk — deliberately inconsistent IDs
    crosswalk = []
    for a in assets:
        num = a["asset_id"].split("-")[-1]
        crosswalk.append(
            {
                "canonical_asset_id": a["asset_id"],
                "gis_id": f"GIS-{a['asset_type'][:2].upper()}-{num}",
                "maintenance_id": f"MAX-{rng.randint(100_000, 999_999):06d}",
                "scada_id": f"SCADA-{a['asset_type'][:1].upper()}{num}",
                "field_ops_id": f"FO-{a['asset_type'][:3].upper()}-{num}",
            }
        )
    pd.DataFrame(crosswalk).to_csv(out_dir / "reference" / "asset_id_crosswalk.csv", index=False)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


@app.command()
def main(
    seed: int = typer.Option(42, help="Random seed for reproducibility"),
    out: Path = typer.Option(
        Path(__file__).resolve().parents[2] / "data",
        help="Output directory (default: <repo>/data)",
    ),
    asset_count: int = typer.Option(210, help="Number of assets to generate (per-region floor at count/3)"),
) -> None:
    """Generate the full mock dataset."""
    rng = random.Random(seed)
    np.random.seed(seed)
    out = out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    typer.echo(f"[generate] mock data (seed={seed}) in {out}")

    generate_regions(out)
    assets = generate_assets(rng, out, count=asset_count)
    typer.echo(f"  assets: {len(assets)}")

    generate_service_areas(rng, out, assets)
    generate_hazard_zones(rng, out)

    generate_work_orders(rng, out, assets)
    generate_inspection_history(rng, out, assets)

    generate_sensor_readings(rng, out, assets, hours=168)

    crews = generate_crews(rng, out)
    generate_crew_status(rng, out, crews)
    generate_field_reports(rng, out, assets, crews)

    generate_incidents_and_outages(rng, out, assets)
    generate_dependencies_and_crosswalk(rng, out, assets)

    typer.echo("[done]")


if __name__ == "__main__":
    app()
