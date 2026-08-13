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
- **`lc-create-from-template`** — populate a named Effort with tasks
  materialized from a named task Template's prompt. Resolves the effort and
  template by name, reads the template's free-text prompt, interprets it, and
  creates the described tasks (roots and subtasks) in the effort, then applies
  assignments and Blocked / blocker relationships on top (status and blockers
  set together in one update). Does not work or complete tasks; it only creates
  them. See
  [`skills/lc-create-from-template/SKILL.md`](skills/lc-create-from-template/SKILL.md).
- **`lc-start-work`** — work **one caller-chosen task** (by id) on demand:
  verify the task exists in the named Effort, claim it, do the work, write
  artifacts into the effort's workspace folder, and complete it — then stop. It
  does not look tasks up by agent and does not care which agent (if any) the
  task is assigned to; it works exactly the task id it is handed. This is the
  unit of work each spawned worker in `lc-orchestrate-agents` runs. Installs no
  LaunchAgent. See
  [`skills/lc-start-work/SKILL.md`](skills/lc-start-work/SKILL.md).
- **`lc-orchestrate-agents`** — set up a recurring **multi-agent delegation
  orchestrator**. Installs a macOS `launchd` LaunchAgent that, every 5 minutes,
  runs a headless `opencode run` tick which reads the agent roster from the app
  (`list agents`), and for **each** app-defined agent whose `tool` maps to a
  supported CLI (opencode / kimi / codex / claude code) that has an `open`
  task, spawns that agent's CLI headless with a one-line prompt telling it to
  run `lc-start-work` for that task's id. The agent roster, model, and thinking
  effort are read from the app — the user never supplies them. See
  [`skills/lc-orchestrate-agents/SKILL.md`](skills/lc-orchestrate-agents/SKILL.md).
- **`lc-skill-creator`** — a **meta-skill** for authoring other `lc-*` skills:
  the authoritative in-plugin reference for the full twelve-command LocalCortex
  JXA surface (read commands, task CRUD, agent CRUD, plus the client-side
  by-name composites), the record DTO shapes, the env-var/argv calling
  convention, the bundled `lc.js` pattern, and an honest account of what JXA
  automation CANNOT do. Generated skills copy this skill's full-surface `lc.js`
  and trim it to the commands they need. Use when building a new `lc-*` skill,
  extending an existing one, or learning the JXA surface. See
  [`skills/lc-skill-creator/SKILL.md`](skills/lc-skill-creator/SKILL.md).

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
  Required for normal skill use, and `lc-orchestrate-agents` runs each tick as
  `opencode run --auto` headlessly.
- For `lc-orchestrate-agents`, the **spawned worker CLIs** it delegates to must
  also be installed and logged in (`opencode auth login`, `kimi login`,
  `codex login`, `claude auth login`) — workers run headless and cannot prompt
  for login mid-run.
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
npx skills add <owner>/<repo> --skill lc-orchestrate-agents
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
npx skills remove lc-orchestrate-agents -a opencode
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

## Scheduling

OpenCode has no in-process scheduler, so `lc-orchestrate-agents` installs a
**macOS `launchd` LaunchAgent** (under
`~/Library/LaunchAgents/ai.opencode.localcortex.orch-<effort-slug>.plist`,
with its tick prompt + runner + logs under
`~/.local/share/opencode/localcortex-jobs/orch-<effort-slug>/`) whose each tick
runs `opencode run --auto` headlessly. To stop it: `launchctl bootout` (or
`launchctl unload`) the label, then remove the plist and job dir — the skill
reports the exact label/paths at setup. An idle effort is a silent no-op: ticks
create nothing and the LaunchAgent keeps firing until you remove it.

## Layout

```
opencode-skill/
├── README.md                       # this file
└── skills/                         # skills-CLI container directory
    ├── lc-fetch-effort/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-create-from-template/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-start-work/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    ├── lc-orchestrate-agents/
    │   ├── SKILL.md
    │   └── scripts/lc.js
    └── lc-skill-creator/
        ├── SKILL.md
        └── scripts/lc.js
```

Each `SKILL.md` uses only frontmatter OpenCode recognizes (`name`,
`description`, plus `license` and `compatibility: opencode`), so the same files
also install cleanly to Claude Code, Codex, Cursor, and the other agents the
skills CLI supports.
