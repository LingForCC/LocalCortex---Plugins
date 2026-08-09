# opencode-skill — OpenCode skill set for LocalCortex

A [skills](https://www.npmjs.com/package/skills)-CLI-compatible set of **agent
skills** that drive the **LocalCortex** macOS task manager through its **JXA /
AppleScript automation surface** (`osascript`), with no MCP server required.
OpenCode has no "plugin" concept like Claude Code or Codex desktop, so this
distribution is a plain `skills/` tree that the skills CLI installs straight
into OpenCode's skill directories.

The LocalCortex app exposes seven scripting commands (`list efforts`, `list
tasks`, `get task`, `workspace path`, `create task`, `update task`,
`complete task`) that have parity with its MCP tools; these skills wrap the
subset each one needs.

## Skills

- **`lc-fetch-effort`** — look up a single Effort by name and return its id,
  workspace folder name, and on-disk workspace path. Read-only; resolves
  exact-then-substring (case-insensitive), asks for disambiguation on several
  matches, and never touches tasks. See
  [`skills/lc-fetch-effort/SKILL.md`](skills/lc-fetch-effort/SKILL.md).
- **`lc-fetch-agent-task`** — find the active tasks assigned to a specific
  agent (`worker_label`, e.g. `opencode`) inside a given Effort. Read-only;
  matches `worker: agent` + label case-insensitively, and never modifies tasks.
  See [`skills/lc-fetch-agent-task/SKILL.md`](skills/lc-fetch-agent-task/SKILL.md).
- **`lc-complete-task`** — complete (default) or reopen a LocalCortex task by
  id. Completing also completes the subtask subtree, auto-unblocks tasks
  waiting on it, and spawns a fresh open copy if the task carries a recurrence
  rule. Only the completion transition lives here. See
  [`skills/lc-complete-task/SKILL.md`](skills/lc-complete-task/SKILL.md).
- **`lc-start-job`** — set up a recurring autonomous worker that, every 5
  minutes, polls a named Effort for an **open** task assigned to a given agent
  (`worker_label`, e.g. `opencode`), does that task's work, writes artifacts
  into the effort's workspace folder, and completes it. OpenCode has no
  in-process scheduler, so this installs a **macOS `launchd` LaunchAgent**
  whose each tick runs `opencode run --auto` headlessly; the scheduled run is
  self-contained and does not chain sibling skills. See
  [`skills/lc-start-job/SKILL.md`](skills/lc-start-job/SKILL.md).
- **`lc-start-work`** — run **one** autonomous pull-work-and-complete tick on
  demand: find the next **open** task assigned to a given agent inside a named
  Effort, claim it, do the work, write artifacts into the effort's workspace
  folder, and complete it — then stop. This is the same flow each scheduled
  tick of `lc-start-job` runs, invoked once; it installs no LaunchAgent. See
  [`skills/lc-start-work/SKILL.md`](skills/lc-start-work/SKILL.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../..) repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches when an Apple Event is sent — no need to start a
  server. The first call from the OpenCode host triggers a one-time macOS TCC
  prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.
- **OpenCode** (`opencode` on `$PATH`), authenticated for a model/provider.
  Required for normal skill use, and `lc-start-job` shells out to
  `opencode run --auto` for each scheduled tick.
- **Node.js**, only to run the skills CLI installer below.

## Install (skills CLI)

The [skills](https://www.npmjs.com/package/skills) CLI auto-detects installed
agents and writes skills into the right global folders. It recognizes OpenCode
(`opencode`) and writes to `~/.config/opencode/skills/` (global) — the same
directory OpenCode discovers skills in. Requires Node.js.

Install all skills from this folder locally:

```bash
npx skills add ./opencode-skill -a opencode
```

Or install specific skills:

```bash
npx skills add ./opencode-skill --skill lc-fetch-effort --skill lc-start-work -a opencode
```

Or, once this folder is published in a GitHub repo, install from the repo
(globally, across all detected agents):

```bash
npx skills add <owner>/<repo>            # all skills under skills/
npx skills add <owner>/<repo> --skill lc-start-job
```

Use `-g` for a global install (the default for OpenCode is
`~/.config/opencode/skills/`), and `-a opencode` to target OpenCode only. By
default the CLI symlinks each skill into a canonical copy; pass `--copy` if
your filesystem does not support symlinks. **Restart OpenCode afterward** so it
re-scans its skill directories.

List what is installed:

```bash
npx skills list
```

Remove a skill:

```bash
npx skills remove lc-start-job -a opencode
```

## How it talks to LocalCortex

All commands go through one bundled JXA helper:

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```

Each skill bundles its own appropriately-scoped copy of `lc.js` at
`skills/<skill>/scripts/lc.js`. Because OpenCode exposes no skill-directory
placeholder, every skill resolves `$LC_JS` by scanning OpenCode's standard
skill directories (`~/.config/opencode/skills`, `~/.agents/skills`,
`~/.claude/skills`, and their project-local equivalents) for its own name.
Free-text inputs (effort name, agent label, notes) are passed via **environment
variables** so that quotes, newlines, backticks, and `$` are handled safely;
UUIDs travel as argv.

## Layout

```
opencode-skill/
├── README.md                       # this file
└── skills/                         # skills-CLI container directory
    ├── lc-fetch-effort/
    │   ├── SKILL.md
    │   └── scripts/lc.js
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

Each `SKILL.md` uses only frontmatter OpenCode recognizes (`name`,
`description`, plus `license` and `compatibility: opencode`), so the same files
also install cleanly to Claude Code, Codex, Cursor, and the other agents the
skills CLI supports.
