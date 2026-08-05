# zcode-plugin — ZCode distribution for LocalCortex

A ZCode **local marketplace** plus the `localcortex` plugin, which drives the
**LocalCortex** macOS task manager through its **JXA / AppleScript automation
surface** (`osascript`), with no MCP server required. The LocalCortex app
exposes seven scripting commands (`list efforts`, `list tasks`, `get task`,
`workspace path`, `create task`, `update task`, `complete task`) that have
parity with its MCP tools; this plugin wraps them.

## Plugin

- **`localcortex`** → skill **`start-work`** (`/start-work`) — start, pick up,
  or resume a LocalCortex task by id or name, then run the full lifecycle:
  discover the task, claim it as `agent`/`zcode`, collect (but don't create) a
  follow-up, write artifacts into the effort's workspace folder, complete the
  task, and create the follow-up as a sibling. See
  [`plugins/localcortex/skills/start-work/SKILL.md`](plugins/localcortex/skills/start-work/SKILL.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../..) repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches when an Apple Event is sent — no need to start a
  server. The first call from the ZCode host triggers a one-time macOS TCC
  prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.

## Install (local development)

In the ZCode client: **Settings → Plugin Management → Discover → `+`**, then
point at **this `zcode-plugin/` directory** (`…/LocalCortex---Plugins/zcode-plugin`)
to register the local marketplace via [`marketplace.json`](marketplace.json),
or point directly at
**`…/LocalCortex---Plugins/zcode-plugin/plugins/localcortex`** to add the plugin
alone.

## How it talks to LocalCortex

All commands go through one bundled JXA helper:
```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```
where `lc.js` lives at `plugins/localcortex/skills/start-work/scripts/lc.js`.
Free-text inputs (task name, notes) are passed via **environment variables** so
that quotes, newlines, backticks, and `$` are handled safely; UUIDs travel as
argv. See the command reference table in
[`plugins/localcortex/skills/start-work/SKILL.md`](plugins/localcortex/skills/start-work/SKILL.md).

## Layout

```
zcode-plugin/
├── marketplace.json               # local marketplace (registers localcortex)
├── README.md                      # this file
└── plugins/
    └── localcortex/
        ├── .zcode-plugin/plugin.json
        ├── README.md
        └── skills/
            └── start-work/
                ├── SKILL.md
                └── scripts/lc.js
```
