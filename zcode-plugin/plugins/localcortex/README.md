# localcortex — ZCode plugin

A ZCode plugin that drives the **LocalCortex** macOS task manager through its
**JXA / AppleScript automation surface** (`osascript`), with no MCP server
required. The LocalCortex app exposes seven scripting commands (`list efforts`,
`list tasks`, `get task`, `workspace path`, `create task`, `update task`,
`complete task`) that have parity with its MCP tools; this plugin wraps them.

## Skills

- **`lc-fetch-effort`** (`/lc-fetch-effort`) — look up a single Effort by name
  and return its id, workspace folder name, and on-disk workspace path.
  Read-only; resolves exact-then-substring (case-insensitive), asks for
  disambiguation on several matches, and never touches tasks. See
  [`skills/lc-fetch-effort/SKILL.md`](skills/lc-fetch-effort/SKILL.md).
- **`lc-create-from-template`** (`/lc-create-from-template`) — populate a named
  Effort with tasks materialized from a named task Template's prompt. Resolves
  the effort and template by name, reads the template's free-text prompt,
  interprets it, and creates the described tasks (roots and subtasks) in the
  effort, then applies assignments and Blocked / blocker relationships on top
  (status and blockers set together in one update). Does not work or complete
  tasks; it only creates them. See
  [`skills/lc-create-from-template/SKILL.md`](skills/lc-create-from-template/SKILL.md).
- **`lc-start-work`** (`/lc-start-work`) — do one task's worth of work on a
  named Effort, on demand, for a given task id: verify the task belongs to the
  effort, claim it, do the work, write artifacts into the effort's workspace
  folder, and complete it — one task, then stop. See
  [`skills/lc-start-work/SKILL.md`](skills/lc-start-work/SKILL.md).
- **`lc-orchestrate-agents`** (`/lc-orchestrate-agents`) — set up a recurring
  (every 5 minutes) multi-agent orchestrator that polls a named Effort and, for
  each app-defined agent whose `tool` maps to a supported CLI (opencode / kimi /
  codex / claude code), spawns that CLI headless to run `lc-start-work` on one
  of its open tasks. The roster, model, and thinking effort are read from the
  app; the user supplies only the Effort and a working directory. Creates a
  ZCode automation that keeps firing until deleted. See
  [`skills/lc-orchestrate-agents/SKILL.md`](skills/lc-orchestrate-agents/SKILL.md).
- **`lc-orchestrate-agent-goal`** (`/lc-orchestrate-agent-goal`) — the
  goal-mode counterpart of `lc-orchestrate-agents`: same setup, roster, and
  worker spawn, but **no scheduled automation**. Instead it loops in the current
  session — dispatching one open task per supported agent each round, waiting
  for all workers, and re-checking — until no supported agent has any active
  task, then stops on its own. Use for one-shot, run-to-completion delegation.
  See [`skills/lc-orchestrate-agent-goal/SKILL.md`](skills/lc-orchestrate-agent-goal/SKILL.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../../../..) repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches when an Apple Event is sent — no need to start a
  server. The first call from the ZCode host triggers a one-time macOS TCC
  prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.

## Install (local development)

In the ZCode client: **Settings → Plugin Management → Discover → `+`**, then
point directly at **this plugin directory**
(`…/LocalCortex---Plugins/zcode-plugin/plugins/localcortex`), or at the
**`zcode-plugin/` folder** (`…/LocalCortex---Plugins/zcode-plugin`) to register
the local marketplace via [`marketplace.json`](../../marketplace.json).

## How it talks to LocalCortex

All commands go through one bundled JXA helper:
```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```
where `lc.js` lives at `skills/<skill>/scripts/lc.js` (each skill bundles its
own copy). Free-text inputs (task name, effort name, notes) are passed via
**environment variables** so that quotes, newlines, backticks, and `$` are
handled safely; UUIDs travel as argv. See the command reference table in each
skill's `SKILL.md`.
