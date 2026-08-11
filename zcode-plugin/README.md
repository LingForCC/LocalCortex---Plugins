# zcode-plugin — ZCode distribution for LocalCortex

A ZCode **local marketplace** plus the `localcortex` plugin, which drives the
**LocalCortex** macOS task manager through its **JXA / AppleScript automation
surface** (`osascript`), with no MCP server required. The LocalCortex app
exposes seven scripting commands (`list efforts`, `list tasks`, `get task`,
`workspace path`, `create task`, `update task`, `complete task`) that have
parity with its MCP tools; this plugin wraps them.

## Plugin

- **`localcortex`** → skills:
  - **`lc-fetch-effort`** (`/lc-fetch-effort`) — look up a single Effort by
    name and return its id, workspace folder name, and on-disk workspace path.
    Read-only (no task access); resolves exact-then-substring,
    case-insensitive, and asks for disambiguation on several matches. See
    [`plugins/localcortex/skills/lc-fetch-effort/SKILL.md`](plugins/localcortex/skills/lc-fetch-effort/SKILL.md).
  - **`lc-start-work`** (`/lc-start-work`) — run **one** autonomous
    pull-work-and-complete tick on demand: find the next **open** task assigned to
    a given agent (`worker_label`, e.g. `zcode`) in a named Effort, claim it,
    do the work, write artifacts into the effort's workspace folder, and
    complete it — one task, then stop. See
    [`plugins/localcortex/skills/lc-start-work/SKILL.md`](plugins/localcortex/skills/lc-start-work/SKILL.md).
  - **`lc-create-from-template`** (`/lc-create-from-template`) — populate a named
    Effort with tasks materialized from a named task Template's prompt. Resolves
    the effort and template by name, reads the template's free-text prompt,
    interprets it, and creates the described tasks (roots and subtasks) in the
    effort, then applies assignments and Blocked / blocker relationships on top
    (status and blockers set together in one update). Does not work or complete
    tasks; it only creates them. See
    [`plugins/localcortex/skills/lc-create-from-template/SKILL.md`](plugins/localcortex/skills/lc-create-from-template/SKILL.md).

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
where `lc.js` lives at `plugins/localcortex/skills/<skill>/scripts/lc.js`
(each skill bundles its own copy). Free-text inputs (task name, effort name,
notes) are passed via **environment variables** so that quotes, newlines,
backticks, and `$` are handled safely; UUIDs travel as argv. See the command
reference table in each skill's `SKILL.md`.

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
            ├── lc-fetch-effort/
            │   ├── SKILL.md
            │   └── scripts/lc.js
            ├── lc-start-work/
            │   ├── SKILL.md
            │   └── scripts/lc.js
            └── lc-create-from-template/
                ├── SKILL.md
                └── scripts/lc.js
```
