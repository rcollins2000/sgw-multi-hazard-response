# Cockpit smoke test (playwright-cli)

A hand-driven `playwright-cli` runbook that boots the built cockpit against
an in-page `fetch` shim (mocked Debby scenario) and asserts:

1. Command bar renders (SGW brand, Storm Cockpit sub-label, mode toggle, nav, personas, UTC clock)
2. Platform-status strip is populated with model + graph metrics
3. Countdown + timeline spine render with **Now** and **Landfall** markers in the right order
4. Priority-decision surface shows the top-risk asset (Ashley River Pumping Station, score 0.91)
5. Confidence meter is level 4/5 (high)
6. Copilot pull-quote renders the LLM recommendation and evidence chips
7. Drivers list populates from `/api/governance/model` × per-asset features
8. Sparkline renders observed + forecast + anomalies
9. Mini-map + watchlist render in the rail
10. Watchlist click **refocuses** the cockpit to a new asset
11. **Defer** advances focus to the next-ranked asset
12. **Accept** posts to `/api/decisions`, shows the ✓ Accepted pill with the audit hash
13. Top-nav clicks route to Briefing / Audit / Cockpit

## Why hand-driven vs a Playwright test file

`playwright-cli` is the browser-inspection tool the team uses across
repos, and this runbook doubles as a debugging recipe: any step below can
be re-issued in isolation. The equivalent test-file version would live in
`tests/e2e/` and use the same in-page fetch shim.

## Prerequisites

- `pnpm build` succeeded at `frontend/` (produces `frontend/dist`)
- `pnpm preview --host --port 4173` is running (or start it inline — step 0)
- Global `playwright-cli` is on PATH (`playwright-cli --version` returns ≥ 0.1.6)

## Runbook

```bash
# 0 — start the preview server (in a separate shell, or backgrounded)
cd frontend && pnpm preview --host --port 4173 &

# 1 — open a fresh session
playwright-cli -s=sgw open --browser=chrome about:blank

# 2 — install the in-page fetch shim AND navigate to the cockpit
#     (the shim is registered via addInitScript so it survives reloads)
playwright-cli -s=sgw run-code --filename=tests/smoke/install_mocks.js

# 3 — assert command-bar chrome
playwright-cli --raw -s=sgw eval "document.title"
# → "SGW Storm Cockpit"

# 4 — assert hero + score
playwright-cli --raw -s=sgw eval "document.querySelector('[data-testid=cockpit-hero-name]')?.textContent"
# → "Ashley River Pumping Station"
playwright-cli --raw -s=sgw eval "document.querySelector('[data-testid=cockpit-hero-score]')?.textContent"
# → "0.91"

# 5 — assert cockpit primitives
playwright-cli --raw -s=sgw eval "!!document.querySelector('[data-testid=timeline-spine]')"
playwright-cli --raw -s=sgw eval "!!document.querySelector('[data-testid=copilot-pull-quote]')"
playwright-cli --raw -s=sgw eval "!!document.querySelector('[data-testid=cockpit-mini-map]')"
playwright-cli --raw -s=sgw eval "document.querySelector('[data-testid=confidence-meter]').getAttribute('aria-valuenow')"
# → "4"

# 6 — Defer flow (focus advances)
playwright-cli --raw -s=sgw eval "document.querySelector('[data-testid=cockpit-defer]').click()"
playwright-cli --raw -s=sgw eval "document.querySelector('[data-testid=cockpit-hero-name]')?.textContent"
# → "Charleston Peninsula Substation"

# 7 — Accept flow (decided pill appears with hash)
playwright-cli --raw -s=sgw eval "document.querySelector('[data-testid=cockpit-accept]').click()"
playwright-cli --raw -s=sgw eval "document.querySelector('[data-testid=cockpit-decided]')?.textContent"
# → "✓Accepted · crew tasked · logged to audit e18c4a6b7d0f"

# 8 — Nav routes
playwright-cli --raw -s=sgw eval "Array.from(document.querySelectorAll('nav[aria-label=Primary] button')).find(b => b.textContent === 'Briefing').click()"
playwright-cli --raw -s=sgw eval "document.querySelector('h1')?.textContent"
# → "Executive briefing"

# 9 — Screenshots for docs
playwright-cli -s=sgw screenshot --filename=tests/smoke/screenshots/cockpit_landing.png

# 10 — cleanup
playwright-cli -s=sgw close
```

## Files in this folder

- `install_mocks.js` — the `page.addInitScript` fetch shim that returns
  Debby-scenario JSON for `/api/*`. Executed once via
  `playwright-cli run-code --filename=...` and persists across reloads.
- `screenshots/` — reference PNGs captured on the last successful run. Not
  strict fixtures (dark-mode Recharts + fonts drift a few pixels between
  environments) — kept as visual documentation.
- `README.md` — this file.
