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
- **`lc-orchestrate-agent-goal`** (`$lc-orchestrate-agent-goal`) — run
  multi-agent orchestration in the current Codex session until the Effort's
  supported agent work is complete. It dispatches one open task per agent in
  parallel, waits for workers, re-reads LocalCortex, and wait-polls while work
  remains blocked or in progress. It creates no Scheduled task. See
  [`skills/lc-orchestrate-agent-goal/SKILL.md`](skills/lc-orchestrate-agent-goal/SKILL.md).
- **`lc-orchestrate-agents`** (`$lc-orchestrate-agents`) — create a Codex
  Scheduled task that polls an Effort every 5 minutes. Each tick re-reads the
  LocalCortex agent roster and spawns each supported agent CLI (opencode,
  kimi, codex, or claude code) that has open work, delegating one task id to
  `lc-start-work`. When all supported agents are idle, the tick is a silent
  no-op — it creates nothing, and the schedule keeps firing until the user
  pauses or deletes it from Scheduled. See
  [`skills/lc-orchestrate-agents/SKILL.md`](skills/lc-orchestrate-agents/SKILL.md).
- **`lc-skill-creator`** (`$lc-skill-creator`) — a meta-skill for authoring
  other `lc-*` skills. It documents the full twelve-command LocalCortex JXA
  surface, record shapes, calling conventions, bundled-helper pattern, and
  automation limits. Generated skills copy its full-surface `lc.js` and trim
  it to the commands they need. See
  [`skills/lc-skill-creator/SKILL.md`](skills/lc-skill-creator/SKILL.md).
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
    ├── lc-orchestrate-agent-goal/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-orchestrate-agents/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-skill-creator/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    └── lc-start-work/
        ├── SKILL.md
        └── scripts/lc.js
```
