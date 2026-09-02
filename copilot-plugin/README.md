# copilot-plugin — GitHub Copilot CLI distribution for LocalCortex

A GitHub Copilot CLI plugin that drives the **LocalCortex** macOS task manager
through its **JXA / AppleScript automation surface** (`osascript`), with no MCP
server required.

## Plugin

The **`localcortex`** plugin ships six skills:

- **`lc-fetch-effort`** (`/lc-fetch-effort`) — look up a single Effort by name
  and return its id, workspace folder name, and on-disk workspace path.
- **`lc-create-from-template`** (`/lc-create-from-template`) — populate a named
  Effort from a named Template.
- **`lc-orchestrate-agents`** (`/lc-orchestrate-agents`) — set up repeated
  delegation across supported agent CLIs to complete open Effort tasks.
- **`lc-orchestrate-agent-goal`** (`/lc-orchestrate-agent-goal`) — one-shot
  goal-mode delegation until all supported agents are idle; each dispatched
  task honors its app-set `run_as` (headless CLI spawn, or in-session
  subagent via the task tool for a `copilot` agent).
- **`lc-start-work`** (`/lc-start-work`) — claim and complete one selected task.
- **`lc-skill-creator`** (`/lc-skill-creator`) — author or revise additional
  `lc-*` skills and JXA call patterns.

See [`plugins/localcortex/README.md`](plugins/localcortex/README.md) and each
skill's `SKILL.md` for details.

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../..) repo:

  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```

- For `lc-orchestrate-agents`, the spawned worker CLIs (opencode, kimi, codex,
  or claude code) must be installed, logged in, and permitted to run unattended.

## Install (local development)

Register this directory as a local marketplace, then install the plugin:

```bash
copilot plugin marketplace add <path-to>/LocalCortex---Plugins/copilot-plugin
copilot plugin install localcortex@localcortex-plugins
```

Or load the plugin directly for one session:

```bash
copilot --plugin-dir <path-to>/LocalCortex---Plugins/copilot-plugin/plugins/localcortex
```

## Layout

```text
copilot-plugin/
├── README.md
├── marketplace.json
└── plugins/
    └── localcortex/
        ├── plugin.json
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
