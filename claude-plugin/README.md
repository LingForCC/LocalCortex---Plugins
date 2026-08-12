# claude-plugin — Claude Code distribution for LocalCortex

A Claude Code **local marketplace** plus the `localcortex` plugin, which
drives the **LocalCortex** macOS task manager through its **JXA / AppleScript
automation surface** (`osascript`), with no MCP server required.

## Plugin

The **`localcortex`** plugin ships four skills:

- **`lc-fetch-effort`** (`/lc-fetch-effort`) — look up a single Effort by name
  and return its id, workspace folder name, and on-disk workspace path.
  Read-only; never touches tasks.
- **`lc-create-from-template`** (`/lc-create-from-template`) — populate a
  named Effort with tasks materialized from a named Template's prompt,
  including assignments and Blocked / blocker relationships. Only creates
  tasks; does not work or complete them.
- **`lc-orchestrate-agents`** (`/lc-orchestrate-agents`) — set up a recurring
  Claude Code automation that polls an Effort every 5 minutes, re-reads the
  app's agent roster each tick, and spawns each supported agent CLI (opencode,
  kimi, codex, or claude code) that has open work, delegating one task id per
  agent to `lc-start-work`.
- **`lc-start-work`** (`/lc-start-work`) — work one caller-chosen task id on
  demand: verify, claim, work, write artifacts into the Effort's workspace
  folder, and complete it — one task, then stop.

See [`plugins/localcortex/README.md`](plugins/localcortex/README.md) and each
skill's `SKILL.md` for details.

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../..) repo:
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

Register this directory as a local marketplace, then install the plugin:

```bash
/plugin marketplace add <path-to>/LocalCortex---Plugins/claude-plugin
/plugin install localcortex@localcortex-plugins
```

Or skip the marketplace and load the plugin directly for one session:

```bash
claude --plugin-dir <path-to>/LocalCortex---Plugins/claude-plugin/plugins/localcortex
```

Start a new Claude Code session after installation so the skills are loaded.

## How it talks to LocalCortex

All commands go through one bundled JXA helper:
```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```
where `lc.js` lives at `plugins/localcortex/skills/<skill>/scripts/lc.js`
(each skill bundles its own copy), resolved via `$CLAUDE_PLUGIN_ROOT`.
Free-text inputs (effort name, task name, notes) are passed via **environment
variables** so that quotes, newlines, backticks, and `$` are handled safely;
UUIDs travel as argv. See the command reference table in each skill's
`SKILL.md`.

## Layout

```
claude-plugin/
├── .claude-plugin/
│   └── marketplace.json           # local marketplace (registers localcortex)
├── README.md                      # this file
└── plugins/
    └── localcortex/
        ├── .claude-plugin/plugin.json
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
