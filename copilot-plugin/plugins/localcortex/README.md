# localcortex — GitHub Copilot CLI plugin

A GitHub Copilot CLI plugin that drives the **LocalCortex** macOS task manager
through its **JXA / AppleScript automation surface** (`osascript`), with no MCP
server required.

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
- **`lc-orchestrate-agents`** (`/lc-orchestrate-agents`) — set up a recurring
  Copilot automation that polls an Effort every 5 minutes. Each tick
  re-reads the LocalCortex agent roster (`list agents`) and spawns each
  supported agent CLI (opencode, kimi, codex, or claude code) that has open
  work, delegating one task id per agent to `lc-start-work`. When all
  supported agents are idle, the tick is a silent no-op — it creates nothing;
  the automation keeps firing until the user deletes it. See
  [`skills/lc-orchestrate-agents/SKILL.md`](skills/lc-orchestrate-agents/SKILL.md).
- **`lc-orchestrate-agent-goal`** (`/lc-orchestrate-agent-goal`) — the
  goal-mode counterpart of `lc-orchestrate-agents`: same setup, roster, and
  worker spawn, but **no scheduled automation**. Instead it loops in the
  current session — dispatching one open task per supported agent each round,
  waiting for all workers, and re-checking — until no supported agent has any
  active task, then stops on its own. Each dispatched task honors its
  `run_as` field (read from the app): `headless` (the default) spawns the
  agent's CLI headless; `subagent` runs the task as an **in-session subagent
  via the task tool** when the agent's `tool` is this session's own CLI
  (`copilot`), falling back to headless otherwise.. Use for one-shot,
  run-to-completion delegation. See
  [`skills/lc-orchestrate-agent-goal/SKILL.md`](skills/lc-orchestrate-agent-goal/SKILL.md).
- **`lc-start-work`** (`/lc-start-work`) — work one caller-chosen task id on
  demand: verify it belongs to the named Effort and is open, claim it, do the
  work, write artifacts into the Effort's workspace folder, and complete it —
  one task, then stop. It does not choose tasks by agent and creates no
  schedule. See
  [`skills/lc-start-work/SKILL.md`](skills/lc-start-work/SKILL.md).
- **`lc-skill-creator`** (`/lc-skill-creator`) — meta-skill for creating or
  revising `lc-*` skills. The authoritative in-plugin reference for the full
  twelve-command LocalCortex JXA surface, the record DTO shapes, the
  env-var/argv calling convention, the bundled `lc.js` helper pattern, and an
  honest account of what JXA automation cannot do. See
  [`skills/lc-skill-creator/SKILL.md`](skills/lc-skill-creator/SKILL.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../../../..) repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches when an Apple Event is sent — no need to start a
  server. The first call from the Copilot CLI host triggers a one-time macOS
  TCC prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.
- For `lc-orchestrate-agents`, the spawned worker CLIs (opencode, kimi, codex,
  claude code) must be installed, logged in, and permitted to run unattended.

## Install (local development)

```bash
copilot --plugin-dir <path-to>/LocalCortex---Plugins/copilot-plugin/plugins/localcortex
```

Or register the containing marketplace and install by name (see the
[`copilot-plugin/`](../../README.md) README).

## How it talks to LocalCortex

All commands go through one bundled JXA helper:
```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```
where `lc.js` lives at `skills/<skill>/scripts/lc.js` (each skill bundles its
own copy), resolved via the active plugin location. Free-text inputs (effort
name, task name, notes) are passed via **environment variables** so that quotes,
newlines, backticks, and `$` are handled safely; UUIDs travel as argv. See the
command reference table in each skill's `SKILL.md`.
