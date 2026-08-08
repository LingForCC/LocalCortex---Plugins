# kimi-plugin — Kimi Code distribution for LocalCortex

A Kimi Code **local marketplace** plus the `localcortex` plugin, which drives
the **LocalCortex** macOS task manager through its **JXA / AppleScript
automation surface** (`osascript`), with no MCP server required. The LocalCortex
app exposes seven scripting commands (`list efforts`, `list tasks`, `get task`,
`workspace path`, `create task`, `update task`, `complete task`) that have
parity with its MCP tools; this plugin wraps them.

## Plugin

- **`localcortex`** → skills **`lc-fetch-effort`**, **`lc-fetch-agent-task`**,
  **`lc-complete-task`**, **`lc-start-job`**, and **`lc-start-work`**. See
  [`plugins/localcortex/README.md`](plugins/localcortex/README.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../..) repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches when an Apple Event is sent — no need to start a
  server. The first call from the Kimi Code host triggers a one-time macOS TCC
  prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.

## Install (local development)

In Kimi Code:

```bash
# Register this directory as a custom marketplace:
/plugins marketplace <path-to>/kimi-plugin/marketplace.json

# Or install the plugin directory directly:
/plugins install <path-to>/kimi-plugin/plugins/localcortex
```

Then run `/reload` (or start a new session) — plugin changes do not apply to
the current session until reload.

## How it talks to LocalCortex

All commands go through one bundled JXA helper:
```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```
where each skill bundles its own copy of `lc.js` at
`plugins/localcortex/skills/<skill>/scripts/lc.js` and resolves it via the
`${KIMI_SKILL_DIR}` placeholder. Free-text
inputs (task name, notes) are passed via **environment variables** so that
quotes, newlines, backticks, and `$` are handled safely; UUIDs travel as argv.

## Layout

```
kimi-plugin/
├── marketplace.json               # local marketplace (registers localcortex)
├── README.md                      # this file
└── plugins/
    └── localcortex/
        ├── kimi.plugin.json       # plugin manifest
        ├── README.md
        └── skills/
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
