# LocalCortex Plugins

Coding-agent plugins for the LocalCortex macOS task manager, grouped by agent
ecosystem. Each subfolder is a self-contained distribution for one agent
system.

These plugins drive LocalCortex through its **JXA / AppleScript automation
surface** (`osascript`) — the default, listener-free automation path — rather
than the opt-in MCP server.

## Distributions

| Folder | Targets | Contents |
|---|---|---|
| [`claude-plugin`](claude-plugin) | Claude Code | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/start-work`). |
| [`codex-plugin`](codex-plugin) | Codex | A local marketplace + the `localcortex` plugin (skill: `start-work`). |
| [`zcode-plugin`](zcode-plugin) | ZCode | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/start-work`). |
| [`kimi-plugin`](kimi-plugin) | Kimi Code | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/skill:start-work`). |
| [`opencode-skill`](opencode-skill) | OpenCode | A `skills/` tree installable via the [`skills`](https://www.npmjs.com/package/skills) CLI (skills: `lc-fetch-effort`, `lc-fetch-agent-task`, `lc-complete-task`, `lc-start-work`, `lc-start-job`). |

(More ecosystems may be added as sibling folders later.)

## Requirements (all distributions)

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface. Build
  it from the `LocalCortex---Swift` repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches on the first Apple Event; no server to start. The
  first call from the agent host triggers a one-time macOS TCC prompt.

## Layout

```
LocalCortex---Plugins/
├── README.md
├── claude-plugin/                 # Claude Code distribution
│   ├── .claude-plugin/
│   │   └── marketplace.json       # local marketplace (registers localcortex)
│   └── plugins/
│       └── localcortex/
│           ├── .claude-plugin/plugin.json
│           ├── README.md
│           └── skills/
│               └── start-work/
│                   ├── SKILL.md
│                   └── scripts/lc.js   # JXA helper wrapping the 7 sdef commands
├── codex-plugin/                  # Codex distribution
│   ├── .agents/plugins/
│   │   └── marketplace.json       # local marketplace (registers localcortex)
│   └── plugins/
│       └── localcortex/
│           ├── .codex-plugin/plugin.json
│           ├── README.md
│           └── skills/
│               └── start-work/
│                   ├── SKILL.md
│                   └── scripts/lc.js   # JXA helper wrapping the 7 sdef commands
├── zcode-plugin/                  # ZCode distribution
│   ├── marketplace.json           # local marketplace (registers localcortex)
│   └── plugins/
│       └── localcortex/
│           ├── .zcode-plugin/plugin.json
│           ├── README.md
│           └── skills/
│               └── start-work/
│                   ├── SKILL.md
│                   └── scripts/lc.js   # JXA helper wrapping the 7 sdef commands
└── kimi-plugin/                   # Kimi Code distribution
    ├── marketplace.json           # local marketplace (registers localcortex)
    └── plugins/
        └── localcortex/
            ├── kimi.plugin.json
            ├── README.md
            └── skills/
                └── start-work/
                    ├── SKILL.md
                    └── scripts/lc.js   # same JXA helper
└── opencode-skill/                # OpenCode distribution (no plugin system)
    ├── README.md
    └── skills/                    # `skills` CLI container dir
        ├── lc-fetch-effort/         { SKILL.md, scripts/lc.js }
        ├── lc-fetch-agent-task/     { SKILL.md, scripts/lc.js }
        ├── lc-complete-task/        { SKILL.md, scripts/lc.js }
        ├── lc-start-work/           { SKILL.md, scripts/lc.js }
        └── lc-start-job/            { SKILL.md, scripts/lc.js }  # launchd job
```

See each distribution's README for ecosystem-specific install instructions:
[`claude-plugin`](claude-plugin/README.md),
[`codex-plugin`](codex-plugin/README.md),
[`zcode-plugin`](zcode-plugin/README.md),
[`kimi-plugin`](kimi-plugin/README.md), and
[`opencode-skill`](opencode-skill/README.md).
