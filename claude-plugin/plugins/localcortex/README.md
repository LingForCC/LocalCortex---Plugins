# localcortex — Claude Code plugin

A Claude Code plugin that drives the **LocalCortex** macOS task manager through
its **JXA / AppleScript automation surface** (`osascript`), with no MCP server
required. The LocalCortex app exposes seven scripting commands (`list efforts`,
`list tasks`, `get task`, `workspace path`, `create task`, `update task`,
`complete task`) that have parity with its MCP tools; this plugin wraps them.

## Skill

- **`start-work`** (`/start-work`) — start, pick up, or resume a LocalCortex
  task by id or name, then run the full lifecycle: discover the task, claim it
  as `agent`/`claude`, collect (but don't create) a follow-up, write artifacts
  into the effort's workspace folder, complete the task, and create the
  follow-up as a sibling. See
  [`skills/start-work/SKILL.md`](skills/start-work/SKILL.md).

## Requirements

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the
  [`LocalCortex---Swift`](../../../..) repo:
  ```bash
  xcodebuild -project LocalCortex.xcodeproj -scheme LocalCortex-macOS -configuration Debug build
  ```
  The app auto-launches when an Apple Event is sent — no need to start a
  server. The first call from the Claude Code host triggers a one-time macOS
  TCC prompt ("… wants to control LocalCortex"); grant it once and subsequent
  calls are silent.

## Install (local development)

```bash
claude --plugin-dir <path-to>/LocalCortex---Plugins/claude-plugin/plugins/localcortex
```

Or register the containing marketplace and install by name (see the
[`claude-plugin/`](../../README.md) README).

## How it talks to LocalCortex

All commands go through one bundled JXA helper:
```bash
osascript -l JavaScript "$LC_JS" <subcommand> [args]
```
where `lc.js` lives at `skills/start-work/scripts/lc.js`, resolved via
`$CLAUDE_PLUGIN_ROOT`. Free-text inputs (task name, notes) are passed via
**environment variables** so that quotes, newlines, backticks, and `$` are
handled safely; UUIDs travel as argv. See the command reference table in
`skills/start-work/SKILL.md`.
