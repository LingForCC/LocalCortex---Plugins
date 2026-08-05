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
| [`zcode-plugin`](zcode-plugin) | ZCode | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/start-work`). |
| [`kimi-plugin`](kimi-plugin) | Kimi Code | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/skill:start-work`). |

(More ecosystems — e.g. Claude, Codex — may be added as sibling folders later.)

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
```

See [`zcode-plugin/README.md`](zcode-plugin/README.md) and
[`kimi-plugin/README.md`](kimi-plugin/README.md) for ecosystem-specific
install instructions.
