# localcortex — Kimi Code plugin

A Kimi Code plugin that drives the **LocalCortex** macOS task manager through
its **JXA / AppleScript automation surface** (`osascript`) — no MCP server
required.

## Skill

- **`start-work`** (`/skill:start-work`) — start, pick up, or resume a
  LocalCortex task by id or name, then run the full lifecycle: discover the
  task, claim it as `agent`/`kimi`, collect (but don't create) a follow-up,
  write artifacts into the effort's workspace folder, complete the task, and
  create the follow-up as a sibling. See
  [`skills/start-work/SKILL.md`](skills/start-work/SKILL.md).

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
    └── start-work/
        ├── SKILL.md
        └── scripts/lc.js               # JXA helper wrapping the 7 sdef commands
```
