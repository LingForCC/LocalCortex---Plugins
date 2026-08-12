# localcortex — Codex plugin

A Codex plugin that drives the **LocalCortex** macOS task manager through its
**JXA / AppleScript automation surface** (`osascript`), with no MCP server
required.

## Skills

- **`lc-create-from-template`** (`$lc-create-from-template`) — populate a
  named Effort with tasks materialized from a named Template's prompt. It
  creates roots and subtasks, then applies assignments and blocker
  relationships. It does not work or complete tasks. See
  [`skills/lc-create-from-template/SKILL.md`](skills/lc-create-from-template/SKILL.md).
- **`lc-fetch-effort`** (`$lc-fetch-effort`) — look up one Effort by name
  and return its id, workspace folder name, and absolute workspace path.
  Read-only; it never touches tasks. See
  [`skills/lc-fetch-effort/SKILL.md`](skills/lc-fetch-effort/SKILL.md).
- **`lc-orchestrate-agents`** (`$lc-orchestrate-agents`) — create a Codex
  Scheduled task that polls an Effort every 5 minutes. Each tick re-reads the
  LocalCortex agent roster and spawns each supported agent CLI (opencode,
  kimi, codex, or claude code) that has open work, delegating one task id to
  `lc-start-work`. When all supported agents are idle, it creates one
  deduplicated reminder to stop the schedule. See
  [`skills/lc-orchestrate-agents/SKILL.md`](skills/lc-orchestrate-agents/SKILL.md).
- **`lc-start-work`** (`$lc-start-work`) — work one caller-chosen task id
  on demand: validate it belongs to the named Effort and is open, claim it,
  do the work, write artifacts into the Effort workspace, and complete it.
  It does not choose tasks by agent and creates no schedule. See
  [`skills/lc-start-work/SKILL.md`](skills/lc-start-work/SKILL.md).

## Requirements

- The **LocalCortex** macOS app with its AppleScript/JXA surface, using the
  scripting name `LocalCortex`. The app auto-launches on the first Apple
  Event. The first call from the Codex host triggers a one-time macOS TCC
  prompt; grant it once.
- `lc-orchestrate-agents` must be invoked from Codex in the ChatGPT desktop
  app because Codex CLI and the IDE extension do not expose Scheduled
  management. Its worker CLIs must be installed, authenticated, and permitted
  to run unattended.

## Install

Register the containing marketplace, then install the plugin:

```bash
codex plugin marketplace add <path-to>/LocalCortex---Plugins/codex-plugin
codex plugin add localcortex@localcortex-plugins
```
Start a new Codex thread after installation.

## Layout

```text
localcortex/
├── .codex-plugin/
│   └── plugin.json
├── README.md
└── skills/
    ├── lc-create-from-template/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-fetch-effort/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-orchestrate-agents/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    └── lc-start-work/
        ├── SKILL.md
        └── scripts/lc.js
```
