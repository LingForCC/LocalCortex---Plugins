# codex-plugin — Codex distribution for LocalCortex

A Codex **local marketplace** plus the `localcortex` plugin. It drives the
**LocalCortex** macOS task manager through its **JXA / AppleScript automation
surface** (`osascript`), with no MCP server required.

## Plugin

- **`localcortex`** → skills **`lc-create-from-template`**,
  **`lc-fetch-effort`**, **`lc-orchestrate-agent-goal`**,
  **`lc-orchestrate-agents`**,
  **`lc-skill-creator`**, and **`lc-start-work`**. See
  [`plugins/localcortex/README.md`](plugins/localcortex/README.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../..) repo:

  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```

  The app auto-launches when an Apple Event is sent. The first call from the
  Codex host triggers a one-time macOS TCC prompt ("… wants to control
  LocalCortex"); grant it once and subsequent calls are silent.
- **Codex in the ChatGPT desktop app** is required to create or manage the
  recurring task used by `lc-orchestrate-agents`. Codex CLI and the IDE
  extension can use the other skills but do not expose Scheduled management.
- For `lc-orchestrate-agents`, each configured worker CLI must be installed,
  logged in, and allowed by the Scheduled task's unattended permissions.

## Install (local development)

Register this directory as a local marketplace, then install the plugin:

```bash
codex plugin marketplace add <path-to>/LocalCortex---Plugins/codex-plugin
codex plugin add localcortex@localcortex-plugins
```
Start a new Codex thread after installation so the skills are loaded.

## How it talks to LocalCortex

Each skill bundles an appropriately scoped JXA helper:

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```

The helpers live at
`plugins/localcortex/skills/<skill>/scripts/lc.js`. Free-text inputs such as
task names, effort names, and notes travel through environment variables so
quotes, newlines, backticks, and `$` are handled safely; UUIDs travel as
arguments.

## Layout

```text
codex-plugin/
├── .agents/plugins/
│   └── marketplace.json
├── README.md
└── plugins/
    └── localcortex/
        ├── .codex-plugin/plugin.json
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
