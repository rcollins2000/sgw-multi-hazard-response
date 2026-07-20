// SGW Storm Cockpit — video walkthrough recording script.
// Executed via `playwright-cli run-code --filename=demo/video/record-walkthrough.js`.
// Assumes the browser is already open and both backend (8000) + frontend (5173) are up.

async page => {
  const VIDEO_PATH = 'demo/video/sgw-walkthrough.webm';
  const W = 1280;
  const H = 800;

  // ----- Utilities -----------------------------------------------------------

  const wait = (ms) => page.waitForTimeout(ms);

  // Sticky bottom-left caption panel (narration subtitle).
  let currentCaption = null;
  const showCaption = async (title, body) => {
    if (currentCaption) {
      await currentCaption.dispose();
      currentCaption = null;
    }
    currentCaption = await page.screencast.showOverlay(`
      <div style="position: absolute; left: 24px; bottom: 24px; max-width: 560px;
        padding: 14px 18px;
        background: rgba(12, 16, 22, 0.86);
        border-left: 3px solid #f59e0b;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; line-height: 1.45; color: #f1f5f9;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
        <div style="text-transform: uppercase; letter-spacing: 0.08em;
          font-size: 10px; color: #f59e0b; margin-bottom: 6px; font-weight: 600;">
          ${title}
        </div>
        <div>${body}</div>
      </div>
    `);
  };
  const clearCaption = async () => {
    if (currentCaption) {
      await currentCaption.dispose();
      currentCaption = null;
    }
  };

  // Highlight a locator with a red outline + optional label below.
  const highlight = async (locator, label, duration = 2500) => {
    try {
      const box = await locator.boundingBox();
      if (!box) return;
      const overlay = await page.screencast.showOverlay(`
        <div style="position: absolute;
          top: ${box.y - 4}px; left: ${box.x - 4}px;
          width: ${box.width + 8}px; height: ${box.height + 8}px;
          border: 2px solid #f43f5e;
          border-radius: 8px;
          box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.25);
          pointer-events: none;"></div>
        ${label ? `
          <div style="position: absolute;
            top: ${box.y + box.height + 6}px;
            left: ${Math.max(8, box.x)}px;
            padding: 5px 10px;
            background: #f43f5e;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 12px; font-weight: 500;
            border-radius: 6px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);">${label}</div>
        ` : ''}
      `, { duration });
    } catch (err) {
      // element not on page — swallow
    }
  };

  // ----- Start recording -----------------------------------------------------

  await page.setViewportSize({ width: W, height: H });
  await page.screencast.start({ path: VIDEO_PATH, size: { width: W, height: H } });

  try {

  // ============================================================
  // Scene 1 — Landing on the cockpit (LIVE mode)
  // ============================================================
  await page.goto('http://localhost:5173');
  await wait(2500);

  await page.screencast.showChapter('SGW Storm Cockpit', {
    description: 'AI-enabled operational decision support · Southeastern Grid & Water · LIVE NWS feed',
    duration: 3200,
  });

  await showCaption('1 · Landing on the cockpit',
    'LIVE mode polls NWS alerts every 60s + NOAA Charleston Harbor tides every 6min. Answers the operator question: <em>what should I care about today?</em>');
  await wait(4500);

  // ============================================================
  // Scene 2 — Preventative priority score
  // ============================================================
  await page.screencast.showChapter('Preventative priority', {
    description: 'Calibrated failure probability × consequence — the maintenance-planner ranking',
    duration: 2600,
  });

  await showCaption('2 · Preventative priority score',
    'Score = 0.55·P(failure) + 0.45·consequence · scale 0–1 · above 0.75 is critical. Combines LightGBM output with criticality × population × cluster blast radius.');
  const scoreEl = page.getByText(/^0\.\d{2}$/).first();
  await highlight(scoreEl, 'Priority score 0–1', 4200);
  await wait(4500);

  // ============================================================
  // Scene 3 — Feature drivers (Priority decomposition)
  // ============================================================
  await page.screencast.showChapter('Feature drivers · why it’s #1', {
    description: 'Every driver is verifiable in the source system — no black-box outputs',
    duration: 2600,
  });

  await showCaption('3 · Feature drivers',
    'Bars explain <em>why</em> this asset ranks first — failure probability, criticality, service population, blast-radius cluster. Every driver is an independently verifiable data point.');
  const decompEl = page.getByText('Priority decomposition').first();
  await highlight(decompEl, 'Feature-importance drivers', 4200);
  await wait(4500);

  // ============================================================
  // Scene 4 — Confidence meter
  // ============================================================
  await page.screencast.showChapter('Confidence meter', {
    description: 'Two calibration signals discretised into a 5-block semaphore gauge',
    duration: 2600,
  });

  await showCaption('4 · Confidence meter',
    '5-block gauge: distance from decision boundary + tightness of calibrated CI. Screen-reader-legible ("high confidence"), not colour-only. Low confidence should trigger a copilot chat.');
  const confMeter = page.getByRole('meter').first();
  await highlight(confMeter, 'Confidence meter · 5 blocks', 4200);
  await wait(4500);

  // ============================================================
  // Scene 5 — Copilot recommendation
  // ============================================================
  await page.screencast.showChapter('Copilot recommendation', {
    description: 'gpt-oss:120b · Pydantic-validated structured output · advisory only',
    duration: 2600,
  });

  await showCaption('5 · Copilot recommendation',
    'LLM narrates <em>over</em> the structured retrieval — never produces scores, forecasts, or classifications. Every evidence chip is a verified source ID; hallucinated IDs are dropped server-side.');
  const copilotEl = page.getByText('Copilot recommends').first();
  await highlight(copilotEl, 'LLM-drafted · schema-validated · advisory', 4200);
  await wait(4500);

  // ============================================================
  // Scene 6 — Water-level forecast + anomaly
  // ============================================================
  await page.screencast.showChapter('Water-level forecast + anomaly', {
    description: 'Prophet with M2 tidal seasonality · 80% uncertainty band · residual anomaly ranking',
    duration: 2600,
  });

  await showCaption('6 · Water-level forecast',
    'Charleston Harbor gauge 8665530 — real NOS CO-OPS data. Prophet forecast + 80% band + rolling-median residual anomalies. Toggle to DEBBY mode to see the actual Aug 2024 storm surge.');
  const forecastEl = page.getByText(/Charleston Harbor 8665530/).first();
  await highlight(forecastEl, 'Real NOAA · Prophet forecast · anomaly ranking', 4500);
  await wait(4500);

  // ============================================================
  // Scene 7 — Live threat map + mode toggle → switch to DEBBY
  // ============================================================
  await page.screencast.showChapter('Threat map · LIVE ↔ DEBBY toggle', {
    description: 'Same widget, distinctly different signals — zero cognitive tax between modes',
    duration: 2600,
  });

  await showCaption('7 · Live threat map',
    'Mini-map summarises geography — asset dots in LIVE mode, cone + track + landfall marker in storm mode. Switching to DEBBY 2024 replay now…');
  const mapEl = page.getByText('Operational map').first();
  await highlight(mapEl, 'react-leaflet · MapLibre tiles', 3800);
  await wait(4000);

  const debbyBtn = page.getByRole('button', { name: 'DEBBY DEMO' });
  await debbyBtn.hover();
  await wait(600);
  await debbyBtn.click();
  await wait(3500);

  await showCaption('7 · Threat map · DEBBY 2024 replay',
    'Cone (dashed amber) + track (solid) + landfall marker overlaid. The countdown up top anchors the whole cockpit to the response window. Same widget, storm signature.');
  await wait(4500);

  // ============================================================
  // Scene 8 — Operator alignment layer
  // ============================================================
  await page.screencast.showChapter('Operator alignment', {
    description: 'Bounded preference calibration · not full RL · every learned rule inspectable',
    duration: 2600,
  });

  await showCaption('8 · Operator alignment layer',
    'Logistic regression on <code>(features, was_deferred_or_overridden)</code> from the audit log. <strong>Bounded</strong> nudge |Δ| ≤ 0.15 — cannot flip Critical to Low. Not RL: no outcome signal, no exploration, tens of samples not thousands.');
  const alignPill = page.getByText(/ALIGN · /).first();
  await highlight(alignPill, 'Preference calibration · dormant until 8 decisions', 4800);
  await wait(5000);

  // ============================================================
  // Scene 9 — Discuss with copilot (button surface only — LLM stream is slow)
  // ============================================================
  await page.screencast.showChapter('Discuss with copilot', {
    description: 'Asset-scoped chat · agent has tool access to model, graph, alerts, registry',
    duration: 2600,
  });

  await showCaption('9 · Discuss with copilot',
    'Chat scoped to <em>this asset</em>. Agent tools: <code>lookup_asset</code>, <code>trace_cascade</code>, <code>fetch_alerts</code>, <code>explain_model</code>. Every tool call rendered inline as a badge — no separate LLM knowledge base.');
  const discussBtn = page.getByRole('button', { name: /Discuss with copilot/ });
  await highlight(discussBtn, 'gpt-oss:120b · tool calling · same data the operator sees', 4800);
  await wait(5000);

  // ============================================================
  // Scene 10 — Accept / Override / Defer (HITL + audit)
  // ============================================================
  await page.screencast.showChapter('Accept · Override · Defer', {
    description: 'HITL contract · SHA-256 hash-chained · append-only enforced at the DB trigger level',
    duration: 2800,
  });

  await showCaption('10 · Human-in-the-loop + immutable audit',
    'Three terminal operator actions on every recommendation. <code>POST /api/decisions</code> writes to <code>operator_decisions</code> + <code>audit_log</code>. BEFORE UPDATE/DELETE triggers raise — the ledger is enforced at the database layer, not just the app.');
  const acceptBtn = page.getByRole('button', { name: /^Accept/ }).first();
  await highlight(acceptBtn, 'Accept → append-only ledger write', 3800);
  await wait(4000);

  // Click Accept to demonstrate the audit-log write
  try { await acceptBtn.click({ timeout: 5000 }); } catch (e) { /* keep going even if state changed */ }
  await wait(3200);

  await showCaption('10 · Decision logged to audit',
    '✓ Accepted · crew tasked · SHA-256 audit hash issued. This decision now feeds the operator-alignment layer as training data.');
  await wait(3500);

  // ============================================================
  // Scene 11 — Scenario agent
  // ============================================================
  await page.getByRole('button', { name: 'Scenarios' }).click();
  await wait(2000);

  await page.screencast.showChapter('Scenario agent', {
    description: 'What-if analysis · replays, stress tests, worst-case cascade',
    duration: 2800,
  });

  await showCaption('11 · Scenario agent',
    'Answers "what if?" — parses free-text directive → typed <code>ScenarioSpec</code> → mutates feature frame → same trained risk model → LLM narrates ranked impacts. Every run audit-logged with a <code>scenario_id</code>.');
  await wait(4200);

  // ============================================================
  // Scene 12 — Storm-path templates (click the Debby preset — no LLM cost)
  // ============================================================
  await page.screencast.showChapter('Storm-path templates', {
    description: 'Hand-digitised NHC tracks · Debby, Idalia, Matthew, Michael · LLM-inferred paths for free text',
    duration: 2800,
  });

  await showCaption('12 · Storm-path templates',
    'Presets short-circuit the LLM — Debby 2024, Idalia 2023, Matthew 2016, Michael 2018. Free-text directives pick from a <em>fixed enum</em> of five templates. Provenance chip always visible: <code>Historic replay · NHC track</code> vs <code>LLM-inferred cone</code>.');
  const debbyPreset = page.getByRole('button', { name: /Replay Debby/ });
  await highlight(debbyPreset, 'Historic replay preset', 4000);
  await wait(4200);

  await debbyPreset.click();
  await wait(6000); // scenario run + narrate takes a moment

  await showCaption('12 · Debby 2024 replay · resolved',
    'Resolved <code>ScenarioSpec</code> shown up top — kind, severity, region, horizon, surge lift, cone ratio. Ranked impacts below with baseline · Δ · scenario score. Amber pull-quote is the LLM narration; every evidence chip is a real asset in the ranked list.');
  await wait(5000);

  // ============================================================
  // Scene 13 — Full map
  // ============================================================
  await page.getByRole('button', { name: 'Full map' }).click();
  await wait(2500);

  await page.screencast.showChapter('Full map · dependency graph', {
    description: 'Cone · surge zones · risk-scaled dots · Louvain community-detection clusters',
    duration: 2800,
  });

  await showCaption('13 · Full map + blast-radius clusters',
    'react-leaflet + layered toggles. Louvain community detection on the dependency graph: modularity 0.90 across 26 clusters — assets that would fail together. Dispatch to a <em>cluster</em>, not to a single asset.');
  await wait(5000);

  // ============================================================
  // Scene 14 — Crew plan (VRP)
  // ============================================================
  await page.getByRole('button', { name: 'Crew plan' }).click();
  await wait(2500);

  await page.screencast.showChapter('Crew plan · VRP optimisation', {
    description: 'OR-Tools · Guided Local Search · Haversine distance · vehicle capacity + priority',
    duration: 2800,
  });

  await showCaption('14 · Vehicle routing optimisation',
    'Not an LLM. Real optimisation — OR-Tools VRP with Guided Local Search. Tours + total cost + expected coverage. Even 5–10% over manual whiteboard planning is significant across an event.');
  await wait(5000);

  // ============================================================
  // Scene 15 — Briefing
  // ============================================================
  await page.getByRole('button', { name: 'Briefing' }).click();
  await wait(2500);

  await page.screencast.showChapter('Executive briefing', {
    description: 'LLM structured output · Pydantic-validated · headline + situation + top risks + actions',
    duration: 2800,
  });

  await showCaption('15 · Executive briefing',
    'Drafts a two-paragraph situation summary the ops manager forwards to leadership. Structured JSON from gpt-oss:120b · fully cited · consistent shift-over-shift. Drafted, never sent — human edits before forward.');
  await wait(5000);

  // ============================================================
  // Scene 16 — Governance
  // ============================================================
  await page.getByRole('button', { name: 'Governance' }).click();
  await wait(2500);

  await page.screencast.showChapter('Governance', {
    description: 'Calibration · fairness · operator-alignment weights — all inspectable',
    duration: 2800,
  });

  await showCaption('16 · Governance page',
    'Risk model (ROC-AUC · Brier · feature importances) · regional fairness (demographic parity 0.086 · equal opportunity 0.094 · target &lt; 0.20) · operator-alignment weights as diverging bars. Trust me doesn\'t cut it for AI in critical infra.');
  await wait(5500);

  // ============================================================
  // Scene 17 — Audit
  // ============================================================
  await page.getByRole('button', { name: 'Audit' }).click();
  await wait(2500);

  await page.screencast.showChapter('Audit · SHA-256 hash chain', {
    description: 'Every recommendation, every operator action, every scenario run — one ledger',
    duration: 2800,
  });

  await showCaption('17 · Immutable audit ledger',
    '<code>current_hash = SHA256(previous_hash || row_payload)</code>. BEFORE UPDATE / BEFORE DELETE triggers raise unconditionally — enforcement at the DB layer, not just the app. Forensic reconstruction primitive for NERC-CIP-style scrutiny.');
  await wait(5500);

  // ============================================================
  // Scene 18 — Data sources popover
  // ============================================================
  await page.getByRole('button', { name: 'Cockpit' }).click();
  await wait(2000);

  await page.screencast.showChapter('Data sources · provenance', {
    description: 'LIVE · ARCHIVED · STATIC REF · SYNTHETIC · TRAINED · PLANNED — no hidden mocks',
    duration: 2800,
  });

  const dsBtn = page.getByRole('button', { name: /DATA SOURCES/ });
  await highlight(dsBtn, 'Feed registry · real poller telemetry', 2500);
  await wait(2700);
  await dsBtn.click();
  await wait(3000);

  await showCaption('18 · Data sources popover',
    'Every feed with its kind, provider, cadence, and freshness telemetry (<code>last_success</code>, <code>last_error</code>, <code>cycle_count</code>). LIVE = real poller state. SYNTHETIC = honestly labelled. PLANNED = visible but dimmed. No marketing framing.');
  await wait(5500);

  // ============================================================
  // Closing beat
  // ============================================================
  await page.screencast.showChapter('The design principles', {
    description: 'Copilot never producer · advisory always · HITL always · audit always · inspectable always',
    duration: 3500,
  });

  await showCaption('Closing',
    'Every capability layered on the same design principles — the LLM is a copilot, never the product; every recommendation is advisory; every decision is HITL and audit-logged; every model is inspectable in Governance. A co-pilot with an audit trail.');
  await wait(5000);

  await clearCaption();
  await wait(500);

  } catch (err) {
    // If any locator times out mid-scene, still finalise the recording.
    await page.screencast.showChapter('Recording ended early', {
      description: String(err && err.message ? err.message : err).slice(0, 200),
      duration: 3000,
    });
    await wait(3200);
  } finally {
    await page.screencast.stop();
  }
}
