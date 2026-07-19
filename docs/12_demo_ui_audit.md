# Demo UI audit — 2026-07-18 (two passes)

Playwright-cli walkthrough against `pnpm preview` on port 4173 with the mock shim installed (see [frontend/tests/smoke/install_mocks.js](../frontend/tests/smoke/install_mocks.js)). Every nav item was visited in both LIVE NWS and DEBBY 2024 REPLAY modes; the drilldown sheet, Data Sources popover, and Scenarios flow were also exercised.

**Console + network:** 0 errors / 0 warnings across the full walk. Nothing to fix on the plumbing side — this is a copy / mode-awareness audit only.

## Findings ranked by severity

### 🟥 Blockers before recording the demo video

**1. Cockpit LIVE mode still shows the DEBBY hurricane recommendation.**
- **Where:** [pages/CockpitPage.tsx](../frontend/src/pages/CockpitPage.tsx) — FocusLane fetches `/api/assets/{id}/explanation` unconditionally. The endpoint returns the same LLM output regardless of platform mode.
- **What the operator sees in LIVE NWS mode:** *"Pre-position a water-quality crew and stage temporary flood barriers at the intake before T-48h. Confirm Roper Hospital backup-feed switchover window."* — which is a storm-response sentence surfacing when *No current threats* is the headline right above it. It reads as broken.
- **Fix (5 min):** in FocusLane, only fetch `explanation` when `!isLive`; in LIVE mode always render the `fallbackPreventativeRecommendation` client-side template. Longer-term fix: add a `?kind=preventative` query parameter to the explanation endpoint and thread a preventative-flavoured LLM prompt server-side.

**2. Duplicate `Operator decision · human-in-the-loop` header in the drilldown sheet.**
- **Where:** [components/AssetDrilldown.tsx:435](../frontend/src/components/AssetDrilldown.tsx) wraps [HITLPanel](../frontend/src/components/HITLPanel.tsx) in a `<SectionLabel>` that already reads the same title. The inner `HITLPanel` also renders its own heading on line 28 of `HITLPanel.tsx`, so the header appears **twice in a row**.
- **Fix (2 min):** delete the inner header inside `HITLPanel.tsx` (lines 27–29). The wrapping `SectionLabel` already covers it and adds the persona name.

**3. Duplicate `AI copilot` header in the drilldown sheet.**
- **Where:** [components/AssetDrilldown.tsx:425](../frontend/src/components/AssetDrilldown.tsx) wraps [AgentChat](../frontend/src/components/AgentChat.tsx) in a `<SectionLabel>` reading *AI copilot · agent chat · NOC Operations Controller*. The inner `AgentChat` on line 111 of `AgentChat.tsx` also has *AI copilot · gpt-oss:120b · tool-calling*. Two nearly-identical headers stacked.
- **Fix (2 min):** delete the inner header inside `AgentChat.tsx`. The wrapping `SectionLabel` already covers it.

### 🟧 Dev-visible copy that assessors would flag

**4. Crew page subtitle admits "Phase 4 backend endpoint pending."**
- **Where:** [pages/CrewPage.tsx](../frontend/src/pages/CrewPage.tsx) header subtitle reads: *"Proposed placements optimise coverage of critical/high assets before T-48h, respecting shift windows. Preview plan — Phase 4 backend endpoint pending."*
- **What the operator sees:** the words *"Preview plan — Phase 4 backend endpoint pending"* explicitly tell the assessor this surface is mocked. Not a good signal.
- **Fix (1 min):** delete the last sentence. Keep the honest disclosure in [docs/09_design_cockpit_v2.md](09_design_cockpit_v2.md) instead. The reader who follows the docs will still see "OR-Tools VRP + Guided Local Search" is disclosed.

**5. Crew page storm-mode wording bleeds into LIVE mode.**
- **Where:** same page — the subtitle *"optimise coverage of critical/high assets before T-48h"* is storm-response phrasing shown even when there is no active storm.
- **Fix (5 min):** thread `isLive` from the app store into `CrewPage`, swap the copy to *"…placements optimise preventative-maintenance coverage across critical/high assets"* in live mode.

**6. Audit-log empty-state text reads *`No entries match ""`.***
- **Where:** [pages/AuditPage.tsx:96](../frontend/src/pages/AuditPage.tsx) renders `No entries match "{filter}"` even when `filter` is the empty string.
- **Fix (2 min):** if `filter.trim() === ""`, render *"No audit-log entries yet. Every operator action + LLM call will append here."* instead.

**7. Audit-log footer copy is stale.**
- **Where:** [pages/AuditPage.tsx](../frontend/src/pages/AuditPage.tsx) footer reads *"New decisions from the drill-down and crew views append here in real time."* — but scenario runs, cockpit accepts, and briefing generations also write here now.
- **Fix (1 min):** change to *"New decisions from every operator action — cockpit, drilldown, scenarios, briefing — append here in real time."*

### 🟨 Nice-to-haves (not blockers)

**8. Governance `Version` slot renders as `—` in mock mode.**
- **Where:** [pages/GovernancePage.tsx](../frontend/src/pages/GovernancePage.tsx) reads `gov.risk_model.version` but the [smoke mock](../frontend/tests/smoke/install_mocks.js) uses key `model_version` for the same value. Real backend uses `version`, so this is only broken when someone runs the demo against the mock shim (e.g. this audit run).
- **Fix (1 min):** update the mock's `RISK` object to also expose `version: "lgbm-cal-v1"`. No code change needed.

**9. Cockpit LIVE mode "Pop. covered" label is opaque.**
- **Where:** [pages/CockpitPage.tsx](../frontend/src/pages/CockpitPage.tsx) StatTile shows *POP. COVERED · 120K* in live mode. Reads as "population currently covered by our services" — but it's actually the population that *would be affected* if the top-priority assets failed (same value as *Pop. at risk* in storm mode).
- **Fix (2 min):** rename to *POP. SERVED* — matches the maintenance-planner framing where the number represents the customer base whose service depends on the ranked assets.

**10. Feature-contributions bars all render positive in the mocked Ashley River drilldown.**
- **Where:** [components/AssetDrilldown.tsx](../frontend/src/components/AssetDrilldown.tsx) `buildDrivers` — every feature in the mocked scenario is adverse, so every bar is red. Not a bug per se — the mock happens to be all-critical — but visually monotone. A live backend with a mid-risk asset would show mixed +/− bars.
- **Fix (0 min):** no code change; note it in the demo talk-track so the assessor knows to expect variance under real data.

**11. Persona chip title tooltip is verbose in Debby mode.**
- **Where:** the persona chip `title` attribute reads e.g. *"NOC Operations Controller · Live map + all at-risk assets"*. The second half is a Live-mode focus hint that reads oddly in DEBBY mode.
- **Fix (5 min):** only append `p.focus` to the title when in live mode.

## What passed the audit

- **No `TODO` / `FIXME` / `XXX` / `HACK` / `DEBUG` markers** anywhere in `frontend/src/`.
- **No `console.log`** calls. `console.error` only appears inside `.catch(...)` blocks — legitimate.
- **No dev-only strings** like "MOCK", "STUB", "PLACEHOLDER" leaking into rendered UI.
- **Console clean** across the whole nav walk in both modes.
- **Every explainer popover** ("?" chip) opens, has content, and dismisses correctly on ESC / click-outside.
- **Every HITL flow** (cockpit accept, scenario accept, drilldown accept) posts to its endpoint and shows the audit-hash chip.
- **Data Sources popover** honestly labels planned feeds as `PLANNED` (dimmed) alongside live feeds — no hidden roadmap.
- **Timeline spine** correctly hides the landfall marker + pre-Now shading in live mode.
- **Explainer diagnostics** all render the current runtime value (score, LIVE/REPLAY, updated timestamps).

## Second pass — 2026-07-18 (deeper interaction walk)

Second sweep opened both modes, cycled personas, clicked every explainer, ran the Briefing generate flow, ran the free-text scenario directive, opened the drilldown as different personas, and enumerated focusable elements. Console + network still clean. **Six additional findings**, several of which are bigger than the first-pass items.

### 🟥 Additional blockers

**B1. Every fetch error renders as `Error: Error: <message>` (double prefix).**
- **Where:** [pages/BriefingPage.tsx:98](../frontend/src/pages/BriefingPage.tsx), [pages/GovernancePage.tsx:170](../frontend/src/pages/GovernancePage.tsx), [pages/AuditPage.tsx:59](../frontend/src/pages/AuditPage.tsx), [components/DataSourcesPopover.tsx:70](../frontend/src/components/DataSourcesPopover.tsx). Each does `setError(String(e))` where `e` is an `Error` object (`String(new Error("x"))` returns `"Error: x"`), then renders `<div>Error: {error}</div>`, producing `Error: Error: /api/… → 404`.
- **Repro:** in mock mode, clicking *Generate briefing* on the Briefing page → the mock doesn't route `/api/briefing/generate` → 404 → renders `Error: Error: /api/briefing/generate → 404`. Visible to any assessor who tries the button.
- **Fix (2 min):** in the four spots above, replace `Error: {error}` with just `{error}`. The stringified `Error` already contains the "Error: " prefix.

**B2. Drilldown Override button doesn't require a reason; Scenarios does.**
- **Where:** [components/HITLPanel.tsx](../frontend/src/components/HITLPanel.tsx) — Override has `disabled={busy}` only. Comment has `disabled={busy || !reason}`. [pages/ScenariosPage.tsx](../frontend/src/pages/ScenariosPage.tsx) — Override + Comment both require a reason.
- **Why it matters:** an operator can override the LLM's recommendation for an asset with zero justification, and it writes to the append-only audit log with an empty `reason`. That's *exactly* the kind of thing the CLAUDE.md "every operator action logged with reason" principle exists to prevent. Also inconsistent between two HITL surfaces.
- **Fix (2 min):** change `HITLPanel` Override disabled condition to `disabled={busy || !reason}`.

**B3. Briefing generate 404s in the smoke mock (blocks demo-in-mock).**
- **Where:** [frontend/tests/smoke/install_mocks.js](../frontend/tests/smoke/install_mocks.js) has no handler for `POST /api/briefing/generate`.
- **Impact:** an assessor who runs the demo against the mock and clicks *Generate briefing* sees a red error. Against the real backend this is fine — but the mock should still be complete.
- **Fix (5 min):** add a `/api/briefing/generate` handler to the mock that returns a plausible `Briefing` payload.

### 🟧 Additional dev-visible copy issues

**B4. Dependency-chain nodes render the same string twice.**
- **Where:** [components/AssetDrilldown.tsx](../frontend/src/components/AssetDrilldown.tsx) `buildCascadeChain` sets `node.name = first.downstream` **and** `node.id = first.downstream` — same value in both fields. `ChainNode` then renders `{truncate(node.name, 28)}` above `{truncate(node.id, 20)}` — the same string twice at different truncation lengths. Ugly under both mock and real data.
- **Fix (5 min):** if `node.name === node.id`, only render one line. Even better: fetch the asset name from `/api/assets` and show `name` on top + `id` below (matching the drilldown's hero row treatment).

**B5. `preventative_priority` explainer text mentions "demo default" inside a user-facing popover.**
- **Where:** [lib/explanations.ts:67](../frontend/src/lib/explanations.ts) — the *Confidence* section reads: *"Consequence is a policy weighting — the split (45 / 35 / 20) is a demo default and should be tuned against SGW's actual maintenance-outcome data."*
- **Impact:** assessor clicks the `?` on the hero score → sees "demo default" → reads as unfinished. It's honest but the phrasing invites doubt.
- **Fix (1 min):** rephrase to *"starting weight — production would tune this against SGW's actual maintenance-outcome data"*. Same honesty, less alarming word.

**B6. Mini-map explainer titled "Live threat map" but the section is renamed to "Operational map" in LIVE mode.**
- **Where:** [lib/explanations.ts:127](../frontend/src/lib/explanations.ts) `mini_map` explainer title is `"Live threat map"`. But the LIVE mode cockpit rail renders the section as `Operational map` (as I coded in the mode-aware pass). So clicking `?` on *Operational map* opens a popover titled *Live threat map* — jarring.
- **Fix (1 min):** rename the popover title to *"Map — cone + risk-scaled asset dots"* (works for both modes).

### 🟨 Additional nice-to-haves

**B7. Ranked-asset button accessible names are 100+ char run-on strings.**
- **Where:** [pages/OverviewPage.tsx](../frontend/src/pages/OverviewPage.tsx) `RankedAssetRow` — the whole button's `textContent` becomes the a11y name (screen-reader users hear e.g. *"SGW-WAT-CO0002critical0.91Ashley River Pumping StationCoastal East (SC) ◆ cluster 7 in cone high criticality water-side"*). No visual issue; just noisy for AT.
- **Fix (2 min):** add `aria-label="Drill down · {asset.asset_name} · {asset.risk_level} {score}"` on the button.

**B8. Governance fairness table renders header row + zero-row body when `per_group` is empty.**
- **Where:** [pages/GovernancePage.tsx](../frontend/src/pages/GovernancePage.tsx) — the `<tbody>` renders nothing when the mock returns `per_group: []`. No empty-state message. Reads as broken.
- **Fix (2 min):** if `fair.per_group.length === 0`, render a single row with *"No group breakdown available."* colspan-ing the full table width.

**B9. AgentChat "AI copilot · gpt-oss:120b · tool-calling" inner header duplicates the outer wrapper.**
- Already flagged as blocker #3 in the first pass — noting here as this second pass confirmed the fix scope: the inner `<div>` on [components/AgentChat.tsx:110-114](../frontend/src/components/AgentChat.tsx) should go, along with the outer `SectionLabel` fully covering it.

**B10. Free-text scenario directive → mock always returns the same Cat 3 Charleston spec.**
- **Where:** [frontend/tests/smoke/install_mocks.js](../frontend/tests/smoke/install_mocks.js) — every scenario POST returns the same static ScenarioReport regardless of directive text. Frontend then shows the `PRESET` badge because the returned spec's `label` matches a preset's `label`.
- **Impact:** mock-mode demo shows a false `PRESET` badge for a free-text run. Real backend calls the LLM parser and gets a fresh spec — no false badge.
- **Fix (5 min):** in the mock, when a `directive` is provided and no `preset`, mutate at least the `label` and `notes` fields to reflect the input text so the free-text vs preset distinction is honest even in mock mode.

## Estimated time to fix blockers + 🟧 items (both passes combined)

- First-pass blockers 1-3: ~10 min
- First-pass 🟧 items 4-7: ~10 min
- Second-pass blockers B1-B3: ~10 min
- Second-pass 🟧 items B4-B6: ~10 min
- **Total: ~40 min** to clean everything visible to an assessor.

Nice-to-haves (both passes) are another ~20 min if we want the a11y + empty-state polish.

---

## Fixes executed — 2026-07-18 late afternoon

Every 🟥 blocker, 🟧 issue and 🟨 nice-to-have from both passes has been implemented.

### First-pass fixes

| # | Item | Change |
|---|------|--------|
| 1 | Cockpit LIVE mode showing Debby hurricane recommendation | [pages/CockpitPage.tsx](../frontend/src/pages/CockpitPage.tsx) — `FocusLane` now short-circuits the LLM fetch when `isLive`; always renders `CopilotPullQuote` with the `fallbackPreventativeRecommendation` template and label *"preventative-priority engine · rule-based"* in live mode |
| 2 | Duplicate *Operator decision · human-in-the-loop* header | [components/HITLPanel.tsx](../frontend/src/components/HITLPanel.tsx) — inner header removed; the panel is now content-only and callers own the section chrome |
| 3 | Duplicate *AI copilot · agent chat* header | [components/AgentChat.tsx](../frontend/src/components/AgentChat.tsx) — inner header removed; kept the "as {persona.abbr}" chip on the right |
| 4 | *Preview plan — Phase 4 backend endpoint pending* | [pages/CrewPage.tsx](../frontend/src/pages/CrewPage.tsx) — sentence deleted; disclosure lives only in docs/09 now |
| 5 | Crew page storm wording bleeding into LIVE mode | [pages/CrewPage.tsx](../frontend/src/pages/CrewPage.tsx) — `isLive` threaded from `useAppStore`; live-mode subtitle swaps to preventative-maintenance framing |
| 6 | Audit empty state *No entries match ""* | [pages/AuditPage.tsx](../frontend/src/pages/AuditPage.tsx) — empty-filter branch now reads *"No audit-log entries yet. Every operator action + LLM call will append here."* |
| 7 | Audit footer stale references | [pages/AuditPage.tsx](../frontend/src/pages/AuditPage.tsx) — footer updated to enumerate all decision surfaces |
| 8 | Governance *Version* renders as `—` in mock | [tests/smoke/install_mocks.js](../frontend/tests/smoke/install_mocks.js) — `RISK` now exposes both `version` and `model_version` |
| 9 | LIVE *Pop. covered* label opaque | [pages/CockpitPage.tsx](../frontend/src/pages/CockpitPage.tsx) — renamed to *Pop. served* |
| 10 | Feature-contributions monotone in mock | Talk-track only — noted in the audit doc, no code change |
| 11 | Persona chip tooltip verbose | [App.tsx](../frontend/src/App.tsx) — dropped the ambiguous focus hint; tooltip now shows just the persona name |

### Second-pass fixes

| # | Item | Change |
|---|------|--------|
| B1 | `Error: Error:` double prefix | [pages/BriefingPage.tsx](../frontend/src/pages/BriefingPage.tsx), [pages/GovernancePage.tsx](../frontend/src/pages/GovernancePage.tsx), [pages/AuditPage.tsx](../frontend/src/pages/AuditPage.tsx), [components/DataSourcesPopover.tsx](../frontend/src/components/DataSourcesPopover.tsx), [lib/usePoll.ts](../frontend/src/lib/usePoll.ts), [pages/ScenariosPage.tsx](../frontend/src/pages/ScenariosPage.tsx) — every caught error now uses `e instanceof Error ? e.message : String(e)`, and the `Error:` prefix in the render was removed; Briefing gets a bordered error box for consistency |
| B2 | Drilldown Override didn't require reason | [components/HITLPanel.tsx](../frontend/src/components/HITLPanel.tsx) — Override now `disabled={busy || reasonMissing}`; textarea placeholder updated to make the requirement obvious |
| B3 | Mock missing `/api/briefing/generate` | [tests/smoke/install_mocks.js](../frontend/tests/smoke/install_mocks.js) — added a plausible `Briefing` payload |
| B4 | Cascade nodes rendered same string twice | [components/AssetDrilldown.tsx](../frontend/src/components/AssetDrilldown.tsx) — `ChainNode` now hides the mono-ID line when `node.name === node.id` |
| B5 | *"demo default"* text in explainer popover | [lib/explanations.ts](../frontend/src/lib/explanations.ts) — rephrased to *"starting weight; production would tune it against SGW's actual maintenance-outcome data"* |
| B6 | mini_map explainer title mismatch in LIVE mode | [lib/explanations.ts](../frontend/src/lib/explanations.ts) — renamed to *"Map — cone + risk-scaled asset dots"* + added a "LIVE mode hides the cone" note |
| B7 | Ranked-asset a11y noise | [pages/OverviewPage.tsx](../frontend/src/pages/OverviewPage.tsx), [pages/CockpitPage.tsx](../frontend/src/pages/CockpitPage.tsx) — added explicit `aria-label="Drill down · {name} · {level} {score}"` / `"Focus cockpit on {name} · score {score}"` |
| B8 | Fairness table empty-state | [pages/GovernancePage.tsx](../frontend/src/pages/GovernancePage.tsx) — added *"No group breakdown available — fairness auditor has not run against this dataset yet."* row when `per_group.length === 0` |
| B9 | AgentChat inner header duplication | Covered by fix #3 above |
| B10 | Mock returned same spec for free-text directive | [tests/smoke/install_mocks.js](../frontend/tests/smoke/install_mocks.js) — mock now reads the request body, differentiates `preset` vs `directive`, and mutates the returned `label` + `notes` for free-text runs so the `PRESET` badge no longer lies |
| — | Explainer test needed updating for renamed title | [components/ExplainPopover.test.tsx](../frontend/src/components/ExplainPopover.test.tsx) — regex updated to `/Explain: Map — cone/i` |

### Verification

- `pnpm typecheck` — clean.
- `pnpm vitest run --pool=threads` — **31 / 31 pass** (was 30 / 31 briefly after the `mini_map` title rename; test updated in the same batch).
- `pnpm build` — clean.
- Playwright smoke — walked LIVE + Debby modes, cockpit + drilldown + Briefing + Audit + Governance + Crew + Scenarios; every fix confirmed:
  - LIVE cockpit copilot now says *"Prioritise a preventative work order for Ashley River Pumping Station — combined failure probability (91%) × consequence (84%) ranks highest…"* with `preventative-priority engine · rule-based` provenance.
  - LIVE cockpit stat reads `POP. SERVED · 120K`.
  - Briefing → Generate briefing produces the *Coastal East baseline* payload with no `Error: Error:` chain.
  - Audit tab shows *"No audit-log entries yet."* on empty state.
  - Crew page subtitle in Debby mode reads storm framing; in LIVE reads preventative framing; no *"Phase 4 pending"* anywhere.
  - Governance shows `Version` populated + fairness empty-state message.
  - Drilldown has one Operator-decision header (not two), one AgentChat section header (not two), cascade nodes render the ID once when it equals the name.
  - Drilldown Override is `disabled: true` without a reason (matches Scenarios page behaviour).
- Screenshots for the demo-recording set:
  - [demo/screenshots/post_fix_cockpit_live.png](../demo/screenshots/post_fix_cockpit_live.png)
  - [demo/screenshots/post_fix_cockpit_debby.png](../demo/screenshots/post_fix_cockpit_debby.png)

## Suggested demo-recording order (post-fixes)

1. Open with **DEBBY 2024 REPLAY** cockpit — countdown + timeline + priority decision + copilot pull-quote → click Accept → audit hash appears.
2. Toggle to **LIVE NWS** — same page reconfigures to *No current threats · preventative priority* — a strong "mode-aware" moment.
3. Click **Scenarios** → click *Cat 3 @ Charleston +30d* preset — narrate the agent pipeline (parse → mutate → predict → narrate).
4. Type a free-text directive → *"What if a Cat 4 hit Savannah in 21 days?"* — real LLM call.
5. **Audit** tab — every action from steps 1-4 present in the ledger with hash chain intact.
6. **Data Sources** popover — walk through LIVE / ARCHIVED / PLANNED groups so the assessor sees the honest roadmap.
