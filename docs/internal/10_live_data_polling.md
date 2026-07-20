# Live NOAA data polling

**Status:** Landed 2026-07-17.
**Companion:** [docs/07_external_data_sources.md](07_external_data_sources.md), [docs/09_design_cockpit_v2.md](09_design_cockpit_v2.md)

## The problem this fixes

The v1 platform ingested NWS alerts and NOS CO-OPS water levels once at build
time (via `scripts.pull_noaa_fixtures` + `scripts.seed_noaa_fixtures`). The
Data Sources popover honestly labelled the CO-OPS gauge as `ARCHIVED` — but
labelled the NWS alerts as `LIVE` while the ingestion was still a snapshot.
Both feeds have public APIs designed for polling; freezing them at boot
undermines the platform's core premise of *"live operational decision support"*.

## What runs now

Two async background tasks start alongside the model trainer in the FastAPI
lifespan ([`backend/src/sgw_platform/api/main.py`](../backend/src/sgw_platform/api/main.py)):

| Task | Source | Cadence | Table | Rolling window | Idempotency |
|---|---|---|---|---|---|
| `poll_nws_alerts` | [api.weather.gov/alerts/active](https://api.weather.gov/) — SC, GA, NC | **60 s** | `weather_alerts` | rows swept when `expires_at < NOW() - 24h` | `ON CONFLICT (alert_id) DO UPDATE` |
| `poll_coops_water_level` | [tidesandcurrents.noaa.gov · gauge 8665530](https://api.tidesandcurrents.noaa.gov/api/prod/datagetter) | **360 s** (matches upstream 6-minute cadence) | `weather_observations` | last 48 h | `DELETE WHERE source='NOS_COOPS:live_8665530'` then bulk insert |

Both tasks:

- Live in [`backend/src/sgw_platform/polling.py`](../backend/src/sgw_platform/polling.py).
- Reuse the existing adapters (`NwsAlertAdapter`, `CoopsObservationAdapter`) —
  no new upstream code paths.
- Never propagate exceptions. A transient 5xx is captured into
  `POLLERS.<feed>.last_error`, the poller sleeps for `interval_s`, and loops.
- Publish a small freshness struct (`cadence_seconds`, `last_success`,
  `last_error`, `cycle_count`, `last_row_count`) via the module-global
  `POLLERS` registry — consumed by `/api/data-sources`.

## Endpoint changes

### `/api/forecasts/water-level`

Default source flipped from `NOS_COOPS:debby_2024` → `NOS_COOPS:live_8665530`.
Response gained two fields:

```jsonc
{
  "source":           "NOS_COOPS:live_8665530",   // resolved (post-fallback)
  "requested_source": "NOS_COOPS:live_8665530",   // what the caller asked for
  "is_live":          true,                        // convenience — client renders "LIVE" chip
  "history_points":   480,
  "history_tail":     [ ... ],
  "forecast":         [ ... ]
}
```

Cold-start fallback: if the live buffer is empty (first ≤ 6 min after boot),
the endpoint transparently falls back to the Debby fixture so the sparkline
never renders blank. The frontend shows a `REPLAY` chip in that case instead
of `LIVE`.

Archived windows remain queryable — pass `?source=NOS_COOPS:debby_2024` or
`?source=NOS_COOPS:idalia_2023`.

### `/api/data-sources`

Rewritten to enumerate the full NOAA landscape honestly:

- **live** feeds (currently NWS alerts + CO-OPS + LLM copilot) carry a
  `cadence` string and a `freshness` block with the module-level poller state.
- **archived** feeds (Debby / Idalia CO-OPS windows, hand-curated hurricane
  tracks) are labelled as such and kept for stress-testing + cold-start fallback.
- **static_ref** feeds (NCEI Storm Events historical training set) are one-time
  ingests that don't need polling.
- **synthetic** feeds (asset registry, SCADA telemetry, placeholder hazard
  zones) are declared as such.
- **trained** feeds (the risk-scoring model) point to the model version + link
  to the Governance tab.
- **planned** feeds — declared here so the roadmap is visible:
  - NHC GIS forecast cones / SLOSH MOM
  - Digital Coast coastal flood exposure
  - nowCOAST aggregator
  - SPC severe-storm + CPC heat/drought outlooks
  - National Water Model streamflow (Phase 2 inland-flood story)
  - NCEP HRRR gridded numerical weather
  - NGS post-event aerial imagery (Phase 3 CV workflow)

## Frontend changes

### `usePoll(fetcher, intervalMs, deps?)`

New primitive in [`frontend/src/lib/usePoll.ts`](../frontend/src/lib/usePoll.ts).
Returns `{ data, error, updatedAt, refresh }` and drops stale results if a newer
call has already resolved (sequence-number guard). Used by:

| Surface | Endpoint | Cadence | Why that cadence |
|---|---|---|---|
| `OverviewPage` — hazard alert stack | `/api/alerts` | 60 s | Matches server-side NWS poll cadence exactly |
| `OverviewPage` — asset heatmap + ranked list | `/api/assets` | 30 s | Model scores change slowly; frequent enough that a new NWS alert (which lifts scores) shows up within one operator glance |
| `CockpitPage` — hero + watchlist + drivers | `/api/assets` | 30 s | Same |
| `CockpitPage` — sparkline | `/api/forecasts/water-level` | 5 min | Server poller is 6 min; tighter would just refit Prophet against the same data |
| `DataSourcesPopover` | `/api/data-sources` | 15 s | Keeps the "updated N seconds ago" chips honest |

### `DataSourcesPopover`

Rewrote as a live popover:

- Polls `/api/data-sources` every 15 s.
- Groups sources by kind (LIVE / ARCHIVED / STATIC REF / TRAINED / SYNTHETIC / PLANNED).
- Each live feed renders its `cadence` string + a `role="status"` freshness row
  with a coloured dot (green = ok, amber = first-poll-pending, red = last error),
  relative "updated N seconds ago", cycle count, last-row count, and last error
  message when present.
- Planned sources are dimmed 40% so the honest roadmap is visible but doesn't
  compete with actual live feeds.

### Live/replay chip on the sparkline

The cockpit sparkline caption now reads *"Charleston Harbor 8665530 · water
level · LIVE"* (or *· REPLAY* if the endpoint falls back to Debby) plus an
`updated N seconds ago` chip.

## Operational implications

- **First 6 minutes after boot** the live CO-OPS buffer is empty; the water-
  level endpoint falls back to the Debby archive. Users see a `REPLAY` chip in
  that window. After the first successful poll it flips to `LIVE`.
- **NWS alerts** in a quiet period may return zero rows. The freshness chip
  will still say "updated N seconds ago" — silence is not staleness.
- **Prophet fit cost** — the water-level endpoint re-fits Prophet on every call.
  Front-end polling at 5 min is intentionally slow so we don't burn CPU on a
  gauge that changes every 6 min upstream anyway.
- **Rate limits** — `api.weather.gov` allows generous polling with a
  `User-Agent`, and CO-OPS has no auth. Both are polled per SGW instance, not
  per user.

## What did NOT change

- No new migrations. `weather_alerts.alert_id` was already a PK and
  `weather_observations` uses `source` as a partition-key discriminator, so
  archived vs live rows coexist without schema change.
- No new dependencies.
- The `pull_noaa_fixtures` + `seed_noaa_fixtures` scripts still exist and still
  seed the archived Debby / Idalia windows. Those windows are the cold-start
  fallback + risk-model stress-test set.
- The audit log, LLM copilot, and human-in-the-loop flow are unaffected.

## Roadmap hooks (declared in `/api/data-sources`)

Every `planned` entry in the data-sources catalog is a shovel-ready adapter:

- **NHC GIS** → `sgw_platform.adapters.nhc` (scaffolded, adapter class ready).
  Replaces the hand-curated Debby cone with the real per-advisory shapefile.
- **Digital Coast** → new adapter, seeds `hazard_zones` with real polygons.
- **NWM streamflow** → anonymous S3 (`s3://noaa-nwm-pds`), NetCDF; strongest
  Phase 2 hook for the water side of SGW.
- **HRRR** → anonymous S3 (`s3://noaa-hrrr-bdp-pds`), GRIB2; feature-engineering
  upgrade for the risk model.
- **NCEI Storm Events** → historical training data — imports once, versioned.
- **NGS imagery** → post-event CV workflow (Phase 3 in the PRD).
