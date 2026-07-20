# AI-assisted development — done as engineering

This folder documents how AI was used in the *construction* of the SGW
platform, not the AI *inside* the platform. Both matter, and both apply
the same discipline: narrow scopes, versioned prompts, tool-scoped
capabilities, an audit trail.

## What's here

- **[agents/](agents/)** — three task-scoped subagents, each with a
  defined objective, tool policy, and non-goals:
  - **[test-orchestrator.md](agents/test-orchestrator.md)** — runs the
    backend / frontend / model-eval suites and reports a structured
    pass/fail summary. Read/Bash tools only; cannot Edit code.
  - **[dev-tracker.md](agents/dev-tracker.md)** — reads
    [PLAN.md](../PLAN.md), inspects repo state, updates `status.md`
    with phase progress. Cannot modify code.
  - **[demo-scribe.md](agents/demo-scribe.md)** — documents scenes as
    they're built into [demo/walkthrough.md](../demo/walkthrough.md).
    Writes to `demo/` only.

- **[../CLAUDE.md](../CLAUDE.md)** — the engineering charter for the
  repo: non-negotiable design principles, locked stack, coding
  conventions, guardrails. Read by every AI-assisted session before
  making non-trivial changes. This is *taste and judgement*, encoded
  as a prompt.

- **`skills/`** — skills the assistant has access to (e.g. `playwright-cli`
  for end-to-end verification). Referenced, not vendored.

- **`design/`** — design bundles from Claude's `/design` skill used
  during the UI iteration. Kept for auditability; not read at runtime.

- **`status.md`** — a moving snapshot of build progress written by the
  `dev-tracker` subagent. Gitignored so it doesn't bleed into diffs.

## Why this is here, and not hidden

The platform itself argues that AI in critical infrastructure should be
**advisory, versioned, tool-scoped, and audit-logged**. That claim would
be hollow if the *build process* used AI invisibly and without the same
discipline.

Instead:

- **Every subagent has a narrow scope** — the same pattern the copilot
  in the platform uses. `test-orchestrator` can't edit code any more
  than `lookup_asset` can shut down a substation.
- **Every LLM call in the running platform writes an audit row**
  (`action_type=llm_call` in `audit_log`) with provider, model, prompt
  version, and prompt hash. See
  [docs/09_operator_alignment.md](../docs/09_operator_alignment.md)
  and `explain/prompt_versions.py`.
- **Prompts are versioned** as code — `expl-v4`, `sp-v2`, `chat-v3` —
  and pinned by the golden-set eval so a rewrite forces a test refresh.
- **The `CLAUDE.md` charter** treats AI-assisted development as an
  engineering practice with rules, not as a shortcut around them.

Treat this folder as evidence that AI-assisted engineering can be done
auditably — not as a bibliography of what the AI wrote.
