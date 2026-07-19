/* eslint-disable no-unused-expressions, sonarjs/cognitive-complexity */
// Evaluated by `playwright-cli run-code --filename=...` as a single async
// arrow function expression. Installs a page-side `fetch` shim (via
// `addInitScript`) that returns Debby-scenario JSON for /api/* URLs and
// then navigates to the preview build. Everything runs in-page — no IPC
// route callbacks — so the smoke session survives page reloads.
async page => {
  await page.addInitScript(() => {
    const ASSETS = [
      {
        asset_id: "SGW-WAT-CO0002",
        asset_name: "Ashley River Pumping Station",
        asset_type: "water_pumping_station",
        utility_domain: "Water",
        region: "COAST_EAST",
        latitude: 32.62,
        longitude: -80.03,
        criticality_rating: 5,
        service_population: 42000,
        risk_score: 0.91,
        risk_level: "critical",
        blast_radius_cluster: 7,
        within_hurricane_cone: true,
      },
      {
        asset_id: "SGW-ELE-CO0006",
        asset_name: "Charleston Peninsula Substation",
        asset_type: "electrical_substation",
        utility_domain: "Electric",
        region: "COAST_EAST",
        latitude: 32.8,
        longitude: -79.93,
        criticality_rating: 5,
        service_population: 60000,
        risk_score: 0.87,
        risk_level: "critical",
        blast_radius_cluster: 7,
        within_hurricane_cone: true,
      },
      {
        asset_id: "SGW-WAT-CO0009",
        asset_name: "Battery Pumping Station",
        asset_type: "water_pumping_station",
        utility_domain: "Water",
        region: "COAST_EAST",
        latitude: 32.77,
        longitude: -79.93,
        criticality_rating: 4,
        service_population: 18000,
        risk_score: 0.84,
        risk_level: "critical",
        blast_radius_cluster: 7,
        within_hurricane_cone: true,
      },
      {
        asset_id: "SGW-TRA-CO0003",
        asset_name: "Mt Pleasant Transmission Seg 004",
        asset_type: "transmission_line_segment",
        utility_domain: "Electric",
        region: "COAST_EAST",
        latitude: 32.92,
        longitude: -79.92,
        criticality_rating: 4,
        service_population: null,
        risk_score: 0.78,
        risk_level: "critical",
        blast_radius_cluster: 7,
        within_hurricane_cone: true,
      },
    ];
    const DETAIL_BASE = {
      condition_score: 71,
      flood_zone: "A",
      ground_elevation_ft: 6.2,
      backup_power: "48h diesel",
      features: {
        min_dist_to_surge_zone_m: 420,
        ground_elevation_ft: 6.2,
        recent_scada_warnings: 4,
        within_hurricane_cone: 1,
        criticality_rating: 5,
        overdue_work_orders: 2,
        min_dist_to_flood_zone_m: 1200,
        recent_high_severity_reports: 1,
      },
      cascade: [
        { downstream: "West Ashley Control Node", depth: 1, consequence: "Pressure loss" },
        { downstream: "Roper Regional Hospital", depth: 2, consequence: "Service interruption" },
      ],
      evidence: {
        alerts: ["NWS-SURGE-8665530"],
        work_orders: ["WO-90005", "MAX-267681"],
        sensor_readings: ["SCADA-WCO0002"],
        field_reports: ["FR-55001"],
      },
    };
    const EXPLANATION = {
      explanation: {
        asset_id: "SGW-WAT-CO0002",
        risk_level: "critical",
        recommended_action:
          "Pre-position a water-quality crew and stage temporary flood barriers at the intake before T-48h. Confirm Roper Hospital backup-feed switchover window.",
        reasoning_summary: [
          "Charleston gauge 8665530 trending above the 80% forecast band.",
          "Asset sits 0.42 km from the surge zone at 6.2 ft ground elevation, inside the NHC cone.",
          "Downstream chain in Louvain cluster #7 places Roper Regional Hospital's water service at cascading risk.",
        ],
        uncertainties: ["Surge timing may shift ±3h with tide phase."],
        evidence: ["NWS-SURGE-8665530", "SCADA-WCO0002", "WO-90005", "FR-55001"],
        human_approval_required: true,
      },
      audit: { current_hash: "3f9a1c07d2be54810123456789abcdef" },
    };
    // Backend serves `.version` on /api/governance/model and `.model_version`
    // on /api/status.training_report.risk — the mock returns both so both
    // consumers see the same string.
    const RISK = {
      version: "lgbm-cal-v1",
      model_version: "lgbm-cal-v1",
      metrics: { roc_auc: 0.804, brier: 0.175 },
      top_features: {
        min_dist_to_surge_zone_m: 0.28,
        ground_elevation_ft: 0.22,
        recent_scada_warnings: 0.14,
        criticality_rating: 0.11,
        within_hurricane_cone: 0.09,
        overdue_work_orders: 0.08,
      },
    };
    const GRAPH = { n_nodes: 240, n_edges: 480, n_clusters: 12, modularity: 0.901 };

    const now = Date.now();
    const isoFromHours = (h) => new Date(now + h * 3600000).toISOString();
    const history = [];
    for (let i = 48; i >= 0; i--) {
      const t = -i;
      const tide = 1.5 * Math.cos((2 * Math.PI * t) / 12.42 + 0.6);
      const surge = 2.4 / (1 + Math.exp(-(t - 4) / 9));
      history.push({ ds: isoFromHours(t), y: 4.7 + tide + surge + 0.06 * Math.sin(t * 1.7) });
    }
    const forecast = [];
    for (let i = 1; i <= 24; i++) {
      const tide = 1.5 * Math.cos((2 * Math.PI * i) / 12.42 + 0.6);
      const surge = 2.4 / (1 + Math.exp(-(i - 4) / 9));
      const yhat = 4.7 + tide + surge;
      forecast.push({ ds: isoFromHours(i), yhat, yhat_lower: yhat - 0.9, yhat_upper: yhat + 0.9 });
    }

    const jsonResponse = (body) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const u = new URL(url, window.location.origin);
      const p = u.pathname;
      if (!p.startsWith("/api/")) return originalFetch(input, init);

      if (p === "/api/status")
        return jsonResponse({
          ready: true,
          error: null,
          training_report: { risk: RISK, graph: GRAPH },
        });
      if (p === "/api/governance/model")
        return jsonResponse({ risk_model: RISK, graph: GRAPH });
      if (p === "/api/governance/fairness")
        return jsonResponse({
          group_column: "region",
          demographic_parity_gap: 0.12,
          equal_opportunity_gap: 0.09,
          per_group: [],
        });
      if (p.startsWith("/api/forecasts/water-level"))
        return jsonResponse({
          source: "NOS_COOPS:live_8665530",
          requested_source: "NOS_COOPS:live_8665530",
          is_live: true,
          history_points: history.length,
          history_tail: history,
          forecast,
        });
      if (p === "/api/assets") return jsonResponse(ASSETS);
      if (p === "/api/hazard-zones") return jsonResponse({ type: "FeatureCollection", features: [] });
      if (p === "/api/hurricane-tracks") return jsonResponse({ type: "FeatureCollection", features: [] });
      if (p === "/api/alerts") return jsonResponse([]);
      if (p === "/api/audit") return jsonResponse([]);
      if (p === "/api/decisions")
        return jsonResponse({ ok: true, audit_hash: "e18c4a6b7d0f2295aaaaaaaaaaaaaaaa" });
      if (p === "/api/briefing/generate") {
        return jsonResponse({
          briefing: {
            headline: "Coastal East baseline · 4 critical / 0 high",
            situation_summary:
              "SGW's Coastal East footprint currently ranks 4 assets as critical and 0 as high across ~120K served population. Ashley River Pumping Station leads the preventative-priority ranking, driven by low ground elevation and proximity to the surge zone.",
            top_risks: [
              "Ashley River Pumping Station (SGW-WAT-CO0002) — priority 0.88",
              "Charleston Peninsula Substation (SGW-ELE-CO0006) — priority 0.86",
              "Battery Pumping Station (SGW-WAT-CO0009) — priority 0.78",
            ],
            recorded_actions: [],
            recommended_actions: [
              "Schedule preventative maintenance for Ashley River intake before next hurricane season.",
              "Confirm Roper Regional Hospital backup-feed switchover procedure.",
            ],
            outlook:
              "No active severe hazards; preventative posture is favoured over surge response. Weather + gauge feeds continue to poll on their configured cadences.",
          },
          snapshot: {
            critical_assets: 4,
            high_assets: 0,
            population_at_risk: 120000,
            active_alerts: 0,
            hazard_types: [],
          },
          audit: { current_hash: "abc123def456aabbccddeeff11223344" },
        });
      }
      if (p === "/api/scenarios/presets") {
        return jsonResponse({
          presets: {
            replay_idalia: {
              kind: "replay",
              label: "Replay Hurricane Idalia (2023) against today's assets",
              hazard_type: "hurricane",
              severity: "cat_3",
              region_focus: "COAST_EAST",
              horizon_days: 7,
              reference_event: "hurricane_idalia_2023",
              surge_lift_pct: 0.7,
              within_cone_ratio: 0.9,
              notes: "Uses the real NHC track projected onto today's assets.",
            },
            cat3_charleston_30d: {
              kind: "synthesised",
              label: "Cat 3 hurricane landfall at Charleston, +30 days",
              hazard_type: "hurricane",
              severity: "cat_3",
              region_focus: "COAST_EAST",
              horizon_days: 30,
              surge_lift_pct: 0.6,
              within_cone_ratio: 0.85,
              notes: "Synthesised from HURDAT2-shaped climatology.",
            },
            worst_case_cascade: {
              kind: "worst_case_cascade",
              label: "Worst single-asset cascade over the next month",
              horizon_days: 30,
              notes: "No hazard perturbation; ranks by priority × cascade depth.",
            },
          },
        });
      }
      if (p === "/api/scenarios/run") {
        // Reflect the caller's intent in the mock response so the free-text
        // directive path reads honestly (no false PRESET badge). Read the
        // request body from the fetch init argument.
        let body = {};
        try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* noop */ }
        const isPreset = !!body.preset;
        const directive = (body.directive ?? "").toString();
        const label = isPreset
          ? "Cat 3 hurricane landfall at Charleston, +30 days"
          : directive
            ? "Operator directive: " + directive.slice(0, 60)
            : "Cat 3 hurricane landfall at Charleston, +30 days";
        const notes = isPreset
          ? "Synthesised from HURDAT2-shaped climatology."
          : "LLM parsed the operator's free-text directive to this ScenarioSpec.";
        return jsonResponse({
          scenario_id: "SCN-" + new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15),
          spec: {
            kind: "synthesised",
            label,
            hazard_type: "hurricane",
            severity: "cat_3",
            region_focus: "COAST_EAST",
            horizon_days: 30,
            surge_lift_pct: 0.6,
            within_cone_ratio: 0.85,
            notes,
          },
          generated_at: new Date().toISOString(),
          ranked_impacts: [
            {
              asset_id: "SGW-WAT-CO0002",
              asset_name: "Ashley River Pumping Station",
              region: "COAST_EAST",
              utility_domain: "Water",
              baseline_score: 0.91,
              scenario_score: 0.96,
              delta: 0.05,
              consequence: 0.82,
              ranked_priority: 0.93,
              cascade_depth: 3,
              cluster: 7,
            },
            {
              asset_id: "SGW-ELE-CO0006",
              asset_name: "Charleston Peninsula Substation",
              region: "COAST_EAST",
              utility_domain: "Electric",
              baseline_score: 0.87,
              scenario_score: 0.94,
              delta: 0.07,
              consequence: 0.85,
              ranked_priority: 0.91,
              cascade_depth: 4,
              cluster: 7,
            },
            {
              asset_id: "SGW-WAT-CO0009",
              asset_name: "Battery Pumping Station",
              region: "COAST_EAST",
              utility_domain: "Water",
              baseline_score: 0.84,
              scenario_score: 0.9,
              delta: 0.06,
              consequence: 0.7,
              ranked_priority: 0.86,
              cascade_depth: 2,
              cluster: 7,
            },
          ],
          total_assets_impacted: 12,
          summary:
            "A Cat 3 landfall at Charleston in 30 days would push a further 12 SGW assets into the critical band, concentrated on Ashley River Pumping Station and Charleston Peninsula Substation. Cascading effects propagate through Louvain cluster #7 and reach the Roper Regional Hospital dependency.",
          recommendation:
            "Pre-authorise a preventative work-order sequence on Ashley River Pumping Station and Charleston Peninsula Substation targeting elevation + surge-barrier readiness before landfall week.",
          evidence: ["SGW-WAT-CO0002", "SGW-ELE-CO0006", "SGW-WAT-CO0009"],
          audit_hash: "b0d9c3e21af04c98e7a4123f5678aabb",
        });
      }
      const scenDec = /^\/api\/scenarios\/[^/]+\/decision$/.exec(p);
      if (scenDec)
        return jsonResponse({ ok: true, audit_hash: "9c8b7a6f5e4d3210aaaaaaaaaaaaaaaa" });
      if (p === "/api/data-sources") {
        const nowIso = new Date().toISOString();
        return jsonResponse({
          generated_at: nowIso,
          sources: [
            {
              id: "nws_alerts",
              label: "NWS active alerts",
              kind: "live",
              provider: "api.weather.gov",
              cadence: "polled every 60s (SC / GA / NC)",
              detail: "17 active alerts.",
              freshness: {
                cadence_seconds: 60,
                last_success: nowIso,
                last_error: null,
                cycle_count: 42,
                last_row_count: 17,
              },
            },
            {
              id: "coops_live",
              label: "Charleston Harbor water levels · live",
              kind: "live",
              provider: "NOS CO-OPS gauge 8665530",
              cadence: "polled every 360s (matches upstream 6-minute cadence)",
              detail: "480 rows in the rolling 48h buffer.",
              freshness: {
                cadence_seconds: 360,
                last_success: nowIso,
                last_error: null,
                cycle_count: 7,
                last_row_count: 480,
              },
            },
            {
              id: "coops_archived",
              label: "Charleston Harbor water levels · event archives",
              kind: "archived",
              provider: "NOS CO-OPS gauge 8665530",
              detail: "Debby (Aug 2024): 1680 rows. Idalia (Aug 2023): 1200 rows.",
            },
            {
              id: "nwm",
              label: "National Water Model streamflow",
              kind: "planned",
              provider: "s3://noaa-nwm-pds (anonymous S3, NetCDF)",
              detail: "2.7km continental streamflow forecasts.",
            },
          ],
        });
      }

      const exp = /^\/api\/assets\/([^/]+)\/explanation$/.exec(p);
      if (exp) return jsonResponse(EXPLANATION);
      const det = /^\/api\/assets\/([^/]+)$/.exec(p);
      if (det) {
        const asset = ASSETS.find((a) => a.asset_id === det[1]) ?? ASSETS[0];
        return jsonResponse({ ...asset, ...DETAIL_BASE });
      }
      return new Response("not mocked: " + p, { status: 404 });
    };
  });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" });
}
