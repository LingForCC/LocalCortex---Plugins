# localcortex — Kimi Code plugin

A Kimi Code plugin that drives the **LocalCortex** macOS task manager through
its **JXA / AppleScript automation surface** (`osascript`) — no MCP server
required.

## Skills

- **`lc-create-from-template`** (`/skill:lc-create-from-template`) — populate a
  named Effort with tasks materialized from a named task Template's prompt.
  Resolves the effort and template by name, reads the template's free-text
  prompt, interprets it, and creates the described tasks (roots and subtasks)
  in the effort, then applies assignments and Blocked / blocker relationships
  on top (status and blockers set together in one update). Does not work or
  complete tasks; it only creates them. See
  [`skills/lc-create-from-template/SKILL.md`](skills/lc-create-from-template/SKILL.md).
- **`lc-fetch-effort`** (`/skill:lc-fetch-effort`) — look up a single Effort by
  name and return its id, workspace folder name, and on-disk workspace path.
  Read-only; resolves exact-then-substring (case-insensitive), asks for
  disambiguation on several matches, and never touches tasks. See
  [`skills/lc-fetch-effort/SKILL.md`](skills/lc-fetch-effort/SKILL.md).
- **`lc-orchestrate-agents`** (`/skill:lc-orchestrate-agents`) — set up a
  recurring Kimi Code cron job that, every 5 minutes, checks a named Effort
  for open tasks assigned to each supported agent defined in the LocalCortex
  app and — for every agent that has an open task — spawns that agent's CLI
  (opencode / kimi / codex / claude code) headless to do the work via
  `lc-start-work`. The agent
  roster, model, and thinking effort are read from the app (`list agents`)
  and re-read every tick; when no agent has any active task left, the tick
  is a silent no-op — it creates nothing, and the cron job keeps firing until
  the user deletes it. See
  [`skills/lc-orchestrate-agents/SKILL.md`](skills/lc-orchestrate-agents/SKILL.md).
- **`lc-start-work`** (`/skill:lc-start-work`) — run **one** autonomous
  work-one-task-and-complete tick on demand: verify a caller-chosen **task id**
  lives in a named Effort and is `open`, claim it, do the work, write artifacts
  into the effort's workspace folder, and complete it — then stop. It does not
  look tasks up by agent; it works exactly the task id it is handed (each
  worker spawned by `lc-orchestrate-agents` runs this flow). It creates no
  cron job. See
  [`skills/lc-start-work/SKILL.md`](skills/lc-start-work/SKILL.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). The app auto-launches when an Apple Event is
  sent. The first call from the Kimi Code host triggers a one-time macOS TCC
  prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.

## Install

```bash
# From the marketplace one level up:
/plugins marketplace <path-to>/kimi-plugin/marketplace.json

# Or install this plugin directory directly:
/plugins install <path-to>/kimi-plugin/plugins/localcortex
```

Then run `/reload` (or start a new session) to activate it.

## Layout

```
localcortex/
├── kimi.plugin.json                    # plugin manifest
├── README.md                           # this file
└── skills/
    ├── lc-create-from-template/
    │   ├── SKILL.md
    │   └── scripts/lc.js               # each skill bundles its own copy
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
