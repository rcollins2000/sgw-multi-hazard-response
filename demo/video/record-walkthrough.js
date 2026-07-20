// SGW Storm Cockpit — video walkthrough recording script.
// Executed via `playwright-cli run-code --filename=demo/video/record-walkthrough.js`.
// Assumes the browser is already open and both backend (8000) + frontend (5173) are up.
//
// Design notes:
//  * `page.screencast.showChapter` and `page.screencast.showOverlay(..., { duration })`
//    both BLOCK the client for the given duration. Captions + highlights are launched
//    concurrently via Promise.all so they overlap on screen.
//  * Captions are written in a first-person narration voice — the intended reader is
//    an interviewer watching without audio. Each caption explains an architectural
//    decision, a HITL touch point, or a limitation / future-work call-out.
//  * We toggle to Debby-2024 replay for scenes 7–10 (storm signature), then toggle
//    back to LIVE before touring the secondary pages, because a few downstream API
//    endpoints assume LIVE-mode inputs.

async page => {
  const VIDEO_PATH = 'demo/video/sgw-walkthrough.webm';
  const W = 1920;
  const H = 1080;

  // ----- Utilities -----------------------------------------------------------

  const wait = (ms) => page.waitForTimeout(ms);

  // Choose a caption position in the corner diagonally opposite the highlighted
  // element so the two never overlap. Pass `null` for scenes without a highlight
  // (defaults to bottom-left).
  const captionCornerFor = (box) => {
    if (!box) return { horizontal: 'left', vertical: 'bottom' };
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return {
      horizontal: cx < W / 2 ? 'right' : 'left',
      vertical: cy < H / 2 ? 'bottom' : 'top',
    };
  };

  const captionHtml = (title, body, corner = { horizontal: 'left', vertical: 'bottom' }) => {
    const hCss = corner.horizontal === 'left' ? 'left: 40px' : 'right: 40px';
    const vCss = corner.vertical === 'bottom' ? 'bottom: 40px' : 'top: 40px';
    return `
      <div style="position: absolute; ${hCss}; ${vCss}; max-width: 780px;
        padding: 20px 24px;
        background: rgba(11, 14, 20, 0.9);
        border-left: 4px solid #f59e0b;
        border-radius: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
        font-size: 16px; line-height: 1.6; color: #f1f5f9;
        box-shadow: 0 12px 32px rgba(0,0,0,0.55);">
        <div style="text-transform: uppercase; letter-spacing: 0.1em;
          font-size: 11px; color: #f59e0b; margin-bottom: 10px; font-weight: 700;">
          ${title}
        </div>
        <div>${body}</div>
      </div>
    `;
  };

  const showCaption = (title, body, durationMs, corner) =>
    page.screencast.showOverlay(captionHtml(title, body, corner), { duration: durationMs });

  // Highlight builder — returns { promise, box } so the caller can position a
  // caption in the opposite corner.
  const highlight = async (locator, label, durationMs = 5500) => {
    let box = null;
    try { box = await locator.boundingBox(); } catch (_) {}
    if (!box) return { promise: Promise.resolve(), box: null };
    // Choose label side — below by default, but above if the element sits low
    const labelAbove = box.y + box.height > H - 80;
    const labelY = labelAbove ? box.y - 42 : box.y + box.height + 12;
    const overlayHtml = `
      <div style="position: absolute;
        top: ${box.y - 6}px; left: ${box.x - 6}px;
        width: ${box.width + 12}px; height: ${box.height + 12}px;
        border: 3px solid #f43f5e;
        border-radius: 12px;
        box-shadow: 0 0 0 5px rgba(244, 63, 94, 0.28);
        pointer-events: none;"></div>
      ${label ? `
        <div style="position: absolute;
          top: ${labelY}px;
          left: ${Math.max(16, box.x)}px;
          padding: 8px 14px;
          background: #f43f5e;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 14px; font-weight: 600;
          border-radius: 8px;
          box-shadow: 0 6px 14px rgba(0,0,0,0.35);">${label}</div>
      ` : ''}
    `;
    return {
      promise: page.screencast.showOverlay(overlayHtml, { duration: durationMs }),
      box,
    };
  };

  const scene = async ({
    chapter,
    chapterDesc,
    chapterMs = 3200,
    caption,
    captionBody,
    captionMs,
    highlightSpec = null,
  }) => {
    await page.screencast.showChapter(chapter, {
      description: chapterDesc,
      duration: chapterMs,
    });

    let corner = { horizontal: 'left', vertical: 'bottom' };
    let highlightPromise = null;
    if (highlightSpec) {
      const { locator, label, ms = 6500 } = highlightSpec;
      const { promise, box } = await highlight(locator, label, ms);
      highlightPromise = promise;
      corner = captionCornerFor(box);
    }

    const captionPromise = showCaption(caption, captionBody, captionMs, corner);
    const promises = [captionPromise];
    if (highlightPromise) promises.push(highlightPromise);
    await Promise.all(promises);
  };

  // ----- Start recording -----------------------------------------------------

  await page.setViewportSize({ width: W, height: H });
  await page.screencast.start({ path: VIDEO_PATH, size: { width: W, height: H } });

  try {

  // ============================================================
  // Scene 1 — Landing on the cockpit (LIVE mode)
  // ============================================================
  await page.goto('http://localhost:5173');
  await wait(3000);
  await scene({
    chapter: 'SGW Storm Cockpit',
    chapterDesc: 'AI-enabled operational decision support · Southeastern Grid & Water · Live NWS + NOAA feeds',
    chapterMs: 3500,
    caption: '1 · Landing on the cockpit',
    captionBody: 'This is the operator’s landing screen. In <strong>LIVE mode</strong> we’re polling real NOAA endpoints — NWS active alerts every 60 seconds, Charleston Harbor tide every 6 minutes. Today has no active hazard, so the cockpit pivots to preventative maintenance ranking. I built it as one screen answering <em>what needs attention right now?</em> rather than a multi-dashboard sprawl — one job, one surface.',
    captionMs: 18000,
  });

  // ============================================================
  // Scene 2 — Preventative priority score
  // ============================================================
  await scene({
    chapter: 'Preventative priority · hero card',
    chapterDesc: 'Calibrated failure probability × operational consequence',
    caption: '2 · Priority score · hero framing',
    captionBody: 'The hero card is deliberate architecture — the operator sees one recommendation with everything they need to act on it, not a table of 200 assets. The number is a 0-to-1 priority score: <code>0.55 · P(failure) + 0.45 · consequence</code>, where consequence is criticality × service population × cluster blast-radius. Above 0.75 is critical. The 55/45 split is a starting weight — production tunes it against real outcome data.',
    captionMs: 17000,
    highlightSpec: {
      locator: page.getByText(/^0\.\d{2}$/).first(),
      label: 'Calibrated priority · 0 → 1 scale',
      ms: 7500,
    },
  });

  // ============================================================
  // Scene 3 — Feature drivers
  // ============================================================
  await scene({
    chapter: 'Feature drivers · why it’s #1',
    chapterDesc: 'Every driver is verifiable in the source system',
    caption: '3 · Feature drivers',
    captionBody: 'The four bars decompose the score into its inputs — failure probability, criticality, service population, blast-radius cluster. Every one is a data point the operator can independently verify in the source systems. No black-box output. Today these are global feature importances; per-asset SHAP attribution is on the Phase 2 roadmap.',
    captionMs: 16000,
    highlightSpec: {
      locator: page.getByText('Priority decomposition').first(),
      label: 'Four verifiable drivers · no black box',
      ms: 7500,
    },
  });

  // ============================================================
  // Scene 4 — Confidence meter
  // ============================================================
  await scene({
    chapter: 'Confidence meter',
    chapterDesc: 'Calibration signal as a semaphore, not just a number',
    caption: '4 · Confidence meter',
    captionBody: 'Every prediction ships with a confidence signal, discretised into a five-block gauge. It combines the probability’s distance from the decision boundary with the tightness of the calibrated CI. Screen-reader-legible — “high confidence”, not just colour. Below three blocks lit, my rule for operators is: consult the copilot before accepting.',
    captionMs: 16000,
    highlightSpec: {
      locator: page.getByRole('meter').first(),
      label: 'Five-block gauge · accessible by design',
      ms: 7500,
    },
  });

  // ============================================================
  // Scene 5 — Copilot recommendation
  // ============================================================
  await scene({
    chapter: 'Copilot recommendation',
    chapterDesc: 'gpt-oss:120b · Pydantic-validated structured output · advisory only',
    caption: '5 · Copilot recommendation',
    captionBody: 'The amber pull-quote is the LLM’s recommendation. Core design principle across the whole platform: <strong>the LLM is a copilot, never the product.</strong> It narrates over structured retrieval — it never generates the score, forecast, or classification itself. Every evidence chip is a real source ID; any ID the model invents is dropped server-side before render.',
    captionMs: 18000,
    highlightSpec: {
      locator: page.getByText(/Copilot recommends/).first(),
      label: 'LLM narrates · never produces · schema-validated',
      ms: 8500,
    },
  });

  // ============================================================
  // Scene 6 — Water-level forecast + anomaly
  // ============================================================
  await scene({
    chapter: 'Water-level forecast + anomaly',
    chapterDesc: 'Prophet + M2 tidal seasonality · 80% band · residual anomaly ranking',
    caption: '6 · Water-level forecast',
    captionBody: 'This is live data from the real NOAA gauge at Charleston Harbor, station 8665530. Dashed line is Meta Prophet with an M2 tidal seasonality regressor; band is the 80% uncertainty envelope; amber dots are residual anomalies. I chose Prophet because it’s boring and honest — real uncertainty bands, real anomaly signal. For truly novel events the platform routes to the scenario agent rather than trusting the forecast.',
    captionMs: 19000,
    highlightSpec: {
      locator: page.getByText(/Charleston Harbor 8665530/).first(),
      label: 'Real NOAA gauge · Prophet forecast · anomaly ranking',
      ms: 8500,
    },
  });

  // ============================================================
  // Scene 7 — Discuss with copilot (LIVE mode, before Debby toggle)
  // ============================================================
  const discussLocator = page.getByRole('button', { name: /Discuss with copilot/ });
  try { await discussLocator.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch (_) {}
  await wait(700);
  await scene({
    chapter: 'Discuss with copilot',
    chapterDesc: 'Asset-scoped chat · tool calls grounded in the same data',
    caption: '7 · Discuss with copilot',
    captionBody: 'Discuss opens an asset-scoped chat. The agent has tool access to the trained risk model, the dependency graph, live NWS alerts, and the asset registry — same data the operator sees, no separate LLM knowledge base. Every tool call renders inline as a badge so the operator can verify the agent’s reasoning against the source of truth.',
    captionMs: 14000,
    highlightSpec: {
      locator: discussLocator,
      label: 'Tool-calling agent · grounded in source data',
      ms: 6500,
    },
  });

  // Open the chat panel and scroll it into view
  try { await discussLocator.click({ timeout: 5000 }); } catch (_) {}
  await wait(1500);
  await page.evaluate(() => {
    const el = document.querySelector('textarea, input[placeholder*="copilot"]');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  await wait(1500);

  // Click the first quick-action to fire a live LLM call with a tool invocation
  const askQuickAction = page.getByRole('button', { name: /Why is this asset flagged.*top three factors/i });
  try {
    const box = await askQuickAction.boundingBox();
    if (box) {
      await page.screencast.showOverlay(`
        <div style="position: absolute;
          top: ${box.y - 6}px; left: ${box.x - 6}px;
          width: ${box.width + 12}px; height: ${box.height + 12}px;
          border: 3px solid #f43f5e;
          border-radius: 10px;
          box-shadow: 0 0 0 5px rgba(244, 63, 94, 0.25);"></div>
        <div style="position: absolute;
          top: ${box.y + box.height + 12}px;
          left: ${Math.max(16, box.x)}px;
          padding: 8px 14px; background: #f43f5e; color: white;
          font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: 600;
          border-radius: 8px;">Quick action · fires a tool-calling LLM turn</div>
      `, { duration: 3800 });
    }
  } catch (_) {}
  await wait(600);
  await showCaption('7b · Firing a quick action',
    'I’ll click the first quick-action — <em>Why is this asset flagged? Cite the top three factors.</em> The agent invokes its <code>lookup_asset</code> tool against the trained risk model, then structures the response as a ranked list. The tool call is visible in-line as a badge — the operator can audit the reasoning trail, not just the answer.',
    14000);
  try { await askQuickAction.click({ timeout: 5000 }); } catch (_) {}
  // Wait for LLM turn + tool call to render
  await wait(14000);

  await showCaption('7c · Structured LLM output',
    'Three factors, all grounded in the same registry the operator sees — criticality rating, service population, and coastal exposure via FEMA VE flood zone + distance to surge zone. The final hedge (“historic overlay does not indicate an active hurricane”) is the model being honest about its own inputs — that transparency is what makes this useful under regulator scrutiny.',
    16000);

  // Close the chat panel and scroll back to the top for the next scene
  const closeChatBtn = page.getByRole('button', { name: /Close copilot chat/i });
  try { await closeChatBtn.click({ timeout: 3000 }); } catch (_) {}
  await wait(1000);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(1500);

  // ============================================================
  // Scene 8a — Threat map (LIVE) + toggle to DEBBY
  // ============================================================
  await scene({
    chapter: 'Threat map · adapter isolation',
    chapterDesc: 'react-leaflet · MapLibre tiles · Hazard Data family',
    caption: '8a · Threat map (LIVE)',
    captionBody: 'Ranked lists never answer <em>where?</em>. The mini-map is a react-leaflet tile with MapLibre tiles. Provider choice is deliberately isolated behind the six-adapter Hazard Data family — I can swap the tile provider or the storm-track source without touching risk-scoring or UI code. Toggling to the Hurricane Debby (August 2024) replay next.',
    captionMs: 16000,
    highlightSpec: {
      locator: page.getByText('Operational map').first(),
      label: 'react-leaflet · six-adapter Hazard Data family',
      ms: 7000,
    },
  });

  // Toggle to Debby
  const debbyBtn = page.getByRole('button', { name: 'DEBBY DEMO' });
  await debbyBtn.hover();
  await wait(600);
  await debbyBtn.click();
  await wait(4000);

  await showCaption('8b · Threat map (Debby replay)',
    'Same widget, storm signature. Dashed amber outline is the NHC forecast cone; solid line is the actual Debby track; marker is projected landfall. Notice the <strong>54h 12m countdown</strong> that appeared up top — it now anchors every panel on the cockpit to the response window. Same react-leaflet component, distinctly different signals — zero cognitive tax between modes.',
    16000);

  // ============================================================
  // Scene 9 — Operator-alignment layer
  // ============================================================
  await scene({
    chapter: 'Operator-alignment layer',
    chapterDesc: 'Bounded preference calibration — not reinforcement learning',
    caption: '9 · Operator alignment',
    captionBody: 'Every operator decision — Accept, Override, or Defer — becomes training data for a small logistic-regression model that learns operator preferences over asset features. It applies a <strong>bounded corrective nudge</strong> to the priority — cap is |Δ| ≤ 0.15, so it cannot flip a Critical to Low. I chose <em>not</em> to frame this as reinforcement learning: there’s no outcome signal, no exploration on real infrastructure, and tens of decisions per week not thousands. It’s preference calibration in the RLHF-lite lineage — honesty over the marketing name.',
    captionMs: 21000,
    highlightSpec: {
      locator: page.getByText(/ALIGN · /).first(),
      label: 'Bounded LR nudge · dormant until 8 decisions',
      ms: 9000,
    },
  });

  // ============================================================
  // Scene 10a — HITL contract + immutable audit
  // ============================================================
  await scene({
    chapter: 'HITL contract + immutable audit',
    chapterDesc: 'Accept · Override · Defer · SHA-256 hash-chained ledger',
    chapterMs: 3800,
    caption: '10 · Human-in-the-loop + audit',
    captionBody: 'Every AI recommendation ends in one of three operator actions — <strong>Accept</strong>, <strong>Override</strong> with a reason, or <strong>Defer</strong>. The AI cannot accept its own recommendation. On any action we write to two tables — <code>operator_decisions</code> and an append-only <code>audit_log</code> with a SHA-256 hash chain. <code>BEFORE UPDATE</code> and <code>BEFORE DELETE</code> triggers raise unconditionally — immutability is enforced at the database layer, not just the app.',
    captionMs: 20000,
    highlightSpec: {
      locator: page.getByRole('button', { name: /^Accept/ }).first(),
      label: 'HITL touch point · append-only, hash-chained',
      ms: 8500,
    },
  });

  try {
    await page.getByRole('button', { name: /^Accept/ }).first().click({ timeout: 5000 });
  } catch (_) { /* keep going even if state changed */ }
  await wait(3500);

  await showCaption('10b · Decision logged to audit',
    'The confirmation shows the audit hash — a cryptographic guarantee that this row is chained to the previous one, and any tampering downstream is provably detectable. And because operator decisions <em>are</em> the alignment layer’s training data, this row also feeds the preference-calibration model on its next retrain. The whole loop is closed.',
    15000);

  // ============================================================
  // Toggle back to LIVE before the nav tour (some APIs assume LIVE inputs)
  // ============================================================
  const liveBtn = page.getByRole('button', { name: /● LIVE/ });
  await liveBtn.click();
  await wait(3500);

  // ============================================================
  // Scene 11 — Scenario agent
  // ============================================================
  await page.getByRole('button', { name: 'Scenarios' }).click();
  await wait(3000);
  await scene({
    chapter: 'Scenario agent',
    chapterDesc: 'What-if analysis · replays, stress tests, cascade',
    caption: '11 · Scenario agent',
    captionBody: 'The Scenarios tab answers the third operator question — <em>what would happen if…?</em>. Pipeline: parse a free-text directive or preset into a typed <code>ScenarioSpec</code> → mutate the asset feature frame → run the <strong>same trained risk model</strong> against the mutated frame → have the LLM narrate the ranked impacts. Every run writes to the audit log with its own <code>scenario_id</code>.',
    captionMs: 17000,
  });

  // ============================================================
  // Scene 12a — Storm-path templates
  // ============================================================
  await scene({
    chapter: 'Storm-path templates',
    chapterDesc: 'Hand-digitised NHC tracks · bounded template enum for LLM paths',
    caption: '12a · Storm-path templates',
    captionBody: 'Presets short-circuit the LLM and use hand-digitised NHC tracks — Debby 2024, Idalia 2023, Matthew 2016, Michael 2018. For free-text directives the LLM picks from a <strong>fixed enum of five templates</strong>, never freehand cone generation. That’s a deliberate constraint — I don’t want the model hallucinating a hurricane track. Provenance chip on the map is always explicit: historic replay versus LLM-inferred.',
    captionMs: 18500,
    highlightSpec: {
      locator: page.getByRole('button', { name: /Replay Debby/ }),
      label: 'Historic replay preset · deterministic path',
      ms: 7500,
    },
  });

  await page.getByRole('button', { name: /Replay Debby/ }).click();
  await wait(8000); // scenario run + LLM narrate

  await showCaption('12b · Debby replay · resolved',
    'The resolved <code>ScenarioSpec</code> is shown at the top — kind, severity, region, horizon, surge lift, cone ratio — so the operator sees exactly what the agent decided before reading the impacts. Each row shows baseline, delta, and scenario score. Amber pull-quote is the LLM’s narration; every evidence chip has been verified server-side against the ranked list. Same HITL contract as the cockpit — Accept queues work orders, and it lands in the audit log.',
    18000);

  // ============================================================
  // Scene 13 — Full map + dependency graph
  // ============================================================
  await page.getByRole('button', { name: 'Full map' }).click();
  await wait(3000);
  await scene({
    chapter: 'Full map · dependency graph',
    chapterDesc: 'Louvain community detection · 26 clusters at modularity 0.90',
    caption: '13 · Full map + blast-radius clusters',
    captionBody: 'Where the operator plans in detail — layered toggles for the NHC cone, hazard zones, and asset risk heatmap. Behind the scenes, <strong>networkx BFS + Louvain community detection</strong> runs on the dependency graph — modularity 0.90 across 26 clusters. So the crew planner can dispatch to a <em>cluster</em> of assets that would fail together, not just to one asset. Today the edges are synthetic; production wires this to real GIS connectivity.',
    captionMs: 18000,
  });

  // ============================================================
  // Scene 14 — Crew plan · VRP
  // ============================================================
  await page.getByRole('button', { name: 'Crew plan' }).click();
  await wait(3000);
  await scene({
    chapter: 'Crew plan · VRP',
    chapterDesc: 'OR-Tools · Guided Local Search · Haversine distance',
    caption: '14 · Vehicle-routing optimisation',
    captionBody: 'Not an LLM. The Crew Plan tab runs a real vehicle-routing-problem solver — <strong>OR-Tools with Guided Local Search</strong> — against Haversine distances, crew home bases, vehicle capacity, and preventative-priority weights. Returns tours, cost, and expected coverage. The formulation assumes deterministic travel times; real storm response has flooded roads and downed trees, which is a Phase 2 wire-up to real-time closure feeds.',
    captionMs: 17500,
  });

  // ============================================================
  // Scene 15 — Executive briefing
  // ============================================================
  await page.getByRole('button', { name: 'Briefing' }).click();
  await wait(3000);
  await scene({
    chapter: 'Executive briefing',
    chapterDesc: 'LLM structured output · headline · situation · risks · actions · outlook',
    caption: '15 · Executive briefing',
    captionBody: 'Drafts a two-paragraph situation summary the operations manager forwards to leadership. Calls <code>gpt-oss:120b</code> with a strict Pydantic schema — headline, situation, top risks, recorded operator actions, recommended actions, outlook. Consistent shift-over-shift because it’s structured, not free text. The LLM drafts; the human always edits and reviews before forwarding — that’s a deliberate HITL gate before anything reaches the C-suite.',
    captionMs: 18000,
  });

  // ============================================================
  // Scene 16 — Governance
  // ============================================================
  await page.getByRole('button', { name: 'Governance' }).click();
  await wait(3000);
  await scene({
    chapter: 'Governance',
    chapterDesc: 'Calibration · fairness · alignment weights — every model inspectable',
    caption: '16 · Governance page',
    captionBody: 'Where the platform meets the auditor. Three panels — risk-model calibration, regional fairness (demographic parity 0.086, equal-opportunity gap 0.094, both under target 0.20), and the operator-alignment layer’s learned weights as diverging bars. Every model, <em>including the alignment layer</em>, is inspectable in one place. Force retrain is a button — a human has to press it. Models don’t silently update.',
    captionMs: 19000,
  });

  // ============================================================
  // Scene 17 — Audit ledger
  // ============================================================
  await page.getByRole('button', { name: 'Audit' }).click();
  await wait(3000);
  await scene({
    chapter: 'Audit · hash-chained ledger',
    chapterDesc: 'SHA-256 chain · UPDATE/DELETE blocked at trigger level',
    caption: '17 · Immutable audit ledger',
    captionBody: 'The platform’s ledger. Every AI recommendation, every operator action, every scenario run — one append-only table. Each row’s hash is <code>SHA-256(previous_hash || row_payload)</code>, so any tampering is provably detectable. Triggers block UPDATE and DELETE at the database layer. This is the forensic-reconstruction primitive I built in for NERC-CIP-style regulatory scrutiny.',
    captionMs: 19000,
  });

  // ============================================================
  // Scene 18 — Data sources popover
  // ============================================================
  await page.getByRole('button', { name: 'Cockpit' }).click();
  await wait(3000);
  await page.screencast.showChapter('Data sources · provenance', {
    description: 'LIVE · ARCHIVED · STATIC REF · SYNTHETIC · TRAINED · PLANNED',
    duration: 3500,
  });

  const dsBtn = page.getByRole('button', { name: /DATA SOURCES/ });
  await highlight(dsBtn, 'Feed registry · real poller telemetry', 3200);
  await dsBtn.click();
  await wait(3200);

  await showCaption('18 · Data sources popover',
    'Every feed is listed with its kind — LIVE, ARCHIVED, STATIC REF, SYNTHETIC, TRAINED, PLANNED — its provider, its cadence, and real poller freshness (last success, last error, cycle count). LIVE feeds show real state; SYNTHETIC feeds are honestly labelled; PLANNED feeds are visible but dimmed. Transparency is a design principle across the platform — if something is a placeholder, it says so on the surface.',
    18000);

  // ============================================================
  // Closing beat
  // ============================================================
  await page.screencast.showChapter('The design principles', {
    description: 'Copilot never producer · advisory always · HITL always · audit always · inspectable always',
    duration: 4000,
  });

  await showCaption('Closing · one consistent shape',
    'One consistent shape across every capability. <strong>The LLM is a copilot, never the product.</strong> Every recommendation is advisory — Accept, Override, or Defer. Every decision is human-in-the-loop and audit-logged. Every model, including the alignment layer, is inspectable on Governance. Not a chatbot, not a black box — a copilot with an audit trail.',
    16500);

  } catch (err) {
    // If a locator times out mid-scene, still finalise the recording rather than
    // leaving the screencast running (which would strand the .webm file).
    await page.screencast.showChapter('Recording ended early', {
      description: String(err && err.message ? err.message : err).slice(0, 240),
      duration: 3500,
    });
  } finally {
    await page.screencast.stop();
  }
}
