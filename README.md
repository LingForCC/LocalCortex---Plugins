# LocalCortex Plugins

Coding-agent plugins for the LocalCortex macOS task manager, grouped by agent
ecosystem. Each subfolder is a self-contained distribution for one agent
system.

These plugins drive LocalCortex through its **JXA / AppleScript automation
surface** (`osascript`) — the default, listener-free automation path — rather
than the opt-in MCP server.

## Quick start

### 1. Install the plugin into your agent(s)

Pick the distribution that matches the coding agent you use and run its install
commands. Each one is a self-contained local marketplace + `localcortex` plugin
(or, for OpenCode, a plain skills tree). Install into every agent you intend to
drive LocalCortex from.

**Claude Code** — [`claude-plugin`](claude-plugin):

```bash
/plugin marketplace add <path-to>/LocalCortex---Plugins/claude-plugin
/plugin install localcortex@localcortex-plugins
```

**Codex** — [`codex-plugin`](codex-plugin):

```bash
codex plugin marketplace add <path-to>/LocalCortex---Plugins/codex-plugin
codex plugin add localcortex@localcortex-plugins
```

**GitHub Copilot CLI** — [`copilot-plugin`](copilot-plugin):

```bash
copilot plugin marketplace add <path-to>/LocalCortex---Plugins/copilot-plugin
copilot plugin install localcortex@localcortex-plugins
```

**ZCode** — [`zcode-plugin`](zcode-plugin):

In the ZCode client, open **Settings → Plugin Management → Discover → `+`**, then
point at the `zcode-plugin/` directory to register the local marketplace via
[`marketplace.json`](zcode-plugin/marketplace.json), or point directly at
`zcode-plugin/plugins/localcortex` to add the plugin alone.

**Kimi Code** — [`kimi-plugin`](kimi-plugin):

```bash
# Register as a custom marketplace:
/plugins marketplace <path-to>/LocalCortex---Plugins/kimi-plugin/marketplace.json

# Or install the plugin directory directly:
/plugins install <path-to>/LocalCortex---Plugins/kimi-plugin/plugins/localcortex
```

**OpenCode** — [`opencode-skill`](opencode-skill) (no plugin system; skills tree):

```bash
npx skills add ./opencode-skill -a opencode
```

> Start a new session (or run `/reload` where applicable) after installing so the
> skills are picked up. See each distribution's README linked above for detail.

### 2. Use the skills

Once installed, the `localcortex` plugin exposes six skills. The typical
sequence to go from empty Effort → worked tasks:

- **`lc-create-from-template`** — populate an Effort with tasks materialized from a
  **named Template**. Provide the template name and the target effort name. The
  skill reads the template's free-text prompt and turns it into tasks (roots,
  subtasks, assignments, and Blocked/blocker relationships). It only creates tasks;
  it does not work or complete them.
  > **Create the Template in the LocalCortex App first.** The skill resolves the
  > template by name from what the app already holds — there is nothing to create
  > from the agent side.

- **`lc-start-work`** — work **one** task on demand. Provide the **effort name** and
  a **task id**: it verifies the task exists in that effort, claims it, does the
  work, writes artifacts into the effort's workspace folder, and completes it —
  one task, then stop.

- **`lc-orchestrate-agents`** — set up a **recurring scheduled job** that polls an
  Effort every 5 minutes and delegates each agent's open task to that agent's CLI.
  Provide the **effort name**; the agent roster, model, and thinking effort are all
  read from the app on every tick.
  > **Create the agents in the LocalCortex App first.** The orchestrator reads the
  > app's agent roster each tick and spawns each supported CLI (opencode, kimi,
  > codex, or claude code) that has open work — you never supply agent details from
  > the agent side.

`lc-fetch-effort` is a read-only helper that looks up an Effort by name and
returns its id, workspace folder, and on-disk path.

## Distributions

| Folder | Targets | Contents |
|---|---|---|
| [`claude-plugin`](claude-plugin) | Claude Code | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/start-work`). |
| [`codex-plugin`](codex-plugin) | Codex | A local marketplace + the `localcortex` plugin (skill: `start-work`). |
| [`copilot-plugin`](copilot-plugin) | GitHub Copilot CLI | A local marketplace + the `localcortex` plugin (skills: `lc-*`). |
| [`zcode-plugin`](zcode-plugin) | ZCode | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/start-work`). |
| [`kimi-plugin`](kimi-plugin) | Kimi Code | A local marketplace + the `localcortex` plugin (skill: `start-work` / `/skill:start-work`). |
| [`opencode-skill`](opencode-skill) | OpenCode | A `skills/` tree installable via the [`skills`](https://www.npmjs.com/package/skills) CLI (skills: `lc-fetch-effort`, `lc-create-from-template`, `lc-start-work`, `lc-orchestrate-agents`, `lc-orchestrate-agent-goal`, `lc-skill-creator`). |

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
├── copilot-plugin/                # GitHub Copilot CLI distribution
│   ├── marketplace.json           # local marketplace (registers localcortex)
│   └── plugins/
│       └── localcortex/
│           ├── plugin.json
│           ├── README.md
│           └── skills/
│               ├── lc-create-from-template/
│               │   ├── SKILL.md
│               │   └── scripts/lc.js
│               └── ...
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
        ├── lc-fetch-effort/            { SKILL.md, scripts/lc.js }
        ├── lc-create-from-template/    { SKILL.md, scripts/lc.js }
        ├── lc-start-work/              { SKILL.md, scripts/lc.js }
        ├── lc-orchestrate-agents/      { SKILL.md, scripts/lc.js }
        ├── lc-orchestrate-agent-goal/  { SKILL.md, scripts/lc.js }
        └── lc-skill-creator/           { SKILL.md, scripts/lc.js }
```

See each distribution's README for ecosystem-specific install instructions:
[`claude-plugin`](claude-plugin/README.md),
[`codex-plugin`](codex-plugin/README.md),
[`copilot-plugin`](copilot-plugin/README.md),
[`zcode-plugin`](zcode-plugin/README.md),
[`kimi-plugin`](kimi-plugin/README.md), and
[`opencode-skill`](opencode-skill/README.md).
