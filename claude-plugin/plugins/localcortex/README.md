# localcortex — Claude Code plugin

A Claude Code plugin that drives the **LocalCortex** macOS task manager through
its **JXA / AppleScript automation surface** (`osascript`), with no MCP server
required.

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
  Claude Code automation that polls an Effort every 5 minutes. Each tick
  re-reads the LocalCortex agent roster (`list agents`) and spawns each
  supported agent CLI (opencode, kimi, codex, or claude code) that has open
  work, delegating one task id per agent to `lc-start-work`. When all
  supported agents are idle, it creates one deduplicated reminder task telling
  the user to delete the automation. See
  [`skills/lc-orchestrate-agents/SKILL.md`](skills/lc-orchestrate-agents/SKILL.md).
- **`lc-start-work`** (`/lc-start-work`) — work one caller-chosen task id on
  demand: verify it belongs to the named Effort and is open, claim it, do the
  work, write artifacts into the Effort's workspace folder, and complete it —
  one task, then stop. It does not choose tasks by agent and creates no
  schedule. See
  [`skills/lc-start-work/SKILL.md`](skills/lc-start-work/SKILL.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../../../..) repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches when an Apple Event is sent — no need to start a
  server. The first call from the Claude Code host triggers a one-time macOS
  TCC prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.
- For `lc-orchestrate-agents`, the spawned worker CLIs (opencode, kimi, codex,
  claude code) must be installed, logged in, and permitted to run unattended.

## Install (local development)

```bash
claude --plugin-dir <path-to>/LocalCortex---Plugins/claude-plugin/plugins/localcortex
```

Or register the containing marketplace and install by name (see the
[`claude-plugin/`](../../README.md) README).

## How it talks to LocalCortex

All commands go through one bundled JXA helper:
```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```
where `lc.js` lives at `skills/<skill>/scripts/lc.js` (each skill bundles its
own copy), resolved via `$CLAUDE_PLUGIN_ROOT`. Free-text inputs (effort name,
task name, notes) are passed via **environment variables** so that quotes,
newlines, backticks, and `$` are handled safely; UUIDs travel as argv. See the
command reference table in each skill's `SKILL.md`.
