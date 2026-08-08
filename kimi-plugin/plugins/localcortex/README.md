# localcortex — Kimi Code plugin

A Kimi Code plugin that drives the **LocalCortex** macOS task manager through
its **JXA / AppleScript automation surface** (`osascript`) — no MCP server
required.

## Skills

- **`lc-fetch-effort`** (`/skill:lc-fetch-effort`) — look up a single Effort by
  name and return its id, workspace folder name, and on-disk workspace path.
  Read-only; resolves exact-then-substring (case-insensitive), asks for
  disambiguation on several matches, and never touches tasks. See
  [`skills/lc-fetch-effort/SKILL.md`](skills/lc-fetch-effort/SKILL.md).
- **`lc-fetch-agent-task`** (`/skill:lc-fetch-agent-task`) — find the active
  tasks assigned to a specific agent (`worker_label`, e.g. `kimi`) inside a
  given Effort. Read-only; matches `worker: agent` + label case-insensitively,
  and never modifies tasks. See
  [`skills/lc-fetch-agent-task/SKILL.md`](skills/lc-fetch-agent-task/SKILL.md).
- **`lc-complete-task`** (`/skill:lc-complete-task`) — complete (default) or
  reopen a LocalCortex task by id. Completing also completes the subtask
  subtree, auto-unblocks tasks waiting on it, and spawns a fresh open copy if
  the task carries a recurrence rule. Only the completion transition lives
  here; it does not create, rename, re-date, or delete tasks. See
  [`skills/lc-complete-task/SKILL.md`](skills/lc-complete-task/SKILL.md).
- **`lc-start-job`** (`/skill:lc-start-job`) — set up a recurring autonomous
  worker that, every 5 minutes, polls a named Effort for an **open** task
  assigned to a given agent (`worker_label`, e.g. `kimi`), does that task's
  work, writes artifacts into the effort's workspace folder, and completes it.
  Validates the effort + agent label at setup, then creates a Kimi Code cron
  job; the scheduled run is self-contained and does not chain sibling skills.
  See [`skills/lc-start-job/SKILL.md`](skills/lc-start-job/SKILL.md).
- **`lc-start-work`** (`/skill:lc-start-work`) — run **one** autonomous
  pull-work-and-complete tick on demand: find the next **open** task assigned
  to a given agent inside a named Effort, claim it, do the work, write
  artifacts into the effort's workspace folder, and complete it — then stop.
  This is the same flow each scheduled tick of `lc-start-job` runs, invoked
  once; it creates no cron job. See
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
    ├── lc-fetch-effort/
    │   ├── SKILL.md
    │   └── scripts/lc.js               # each skill bundles its own copy
    ├── lc-fetch-agent-task/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-complete-task/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-start-job/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    └── lc-start-work/
        ├── SKILL.md
        └── scripts/lc.js
```
