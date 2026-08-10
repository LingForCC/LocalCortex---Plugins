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
- **`lc-fetch-agent-task`** (`/lc-fetch-agent-task`) — find the active tasks
  assigned to a specific agent (`worker_label`, e.g. `zcode`) inside a given
  Effort. Read-only; matches `worker: agent` + label case-insensitively, and
  never modifies tasks. See
  [`skills/lc-fetch-agent-task/SKILL.md`](skills/lc-fetch-agent-task/SKILL.md).
- **`lc-complete-task`** (`/lc-complete-task`) — complete (default) or reopen a
  LocalCortex task by id. Completing also completes the subtask subtree,
  auto-unblocks tasks waiting on it, and spawns a fresh open copy if the task
  carries a recurrence rule. Only the completion transition lives here; it does
  not create, rename, re-date, or delete tasks. See
  [`skills/lc-complete-task/SKILL.md`](skills/lc-complete-task/SKILL.md).
- **`lc-start-job`** (`/lc-start-job`) — set up a recurring autonomous worker
  that, every 5 minutes, polls a named Effort for an **open** task assigned to
  a given agent (`worker_label`, e.g. `zcode`), does that task's work, writes
  artifacts into the effort's workspace folder, and completes it. Validates the
  effort + agent label at setup, then creates the ZCode automation; the
  scheduled run is self-contained and does not chain sibling skills. See
  [`skills/lc-start-job/SKILL.md`](skills/lc-start-job/SKILL.md).
- **`lc-create-from-template`** (`/lc-create-from-template`) — populate a named
  Effort with tasks materialized from a named task Template's prompt. Resolves
  the effort and template by name, reads the template's free-text prompt,
  interprets it, and creates the described tasks (roots and subtasks) in the
  effort, then applies assignments and Blocked / blocker relationships on top
  (status and blockers set together in one update). Does not work or complete
  tasks; it only creates them. See
  [`skills/lc-create-from-template/SKILL.md`](skills/lc-create-from-template/SKILL.md).

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
