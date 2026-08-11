---
name: lc-orchestrate-agents
description: >-
  Set up a recurring LocalCortex multi-agent orchestrator — the macOS task
  manager app — that polls a named Effort every 5 minutes and, for each agent
  definition in the app that has an open task, spawns that agent's CLI
  (opencode, kimi, or zcode) headless to do the work. The agent roster, model,
  and thinking effort are READ FROM THE APP (its `list agents` definitions) —
  the user never supplies them; each agent's `tool` selects the CLI, its
  `model` is the model, its `thinking_effort` is the effort. Each tick
  re-reads the agent list, checks every supported agent in parallel, and for
  each agent that has an open task, picks that open task and spawns the agent's
  CLI headless with a one-line prompt telling it to run the lc-start-work skill
  for that task's id (not the agent's id). The worker verifies, claims, works,
  and completes the named task itself. Drives LocalCortex through its
  JXA/AppleScript surface (osascript), not MCP. Use for scheduled multi-agent
  delegation — e.g. "orchestrate all my agents on Build".
argument-hint: "[effort name]"
allowed-tools: [Bash, Read]
version: 0.1.17
license: MIT
---

# lc-orchestrate-agents — a scheduled multi-agent delegation orchestrator

Set up a scheduled ZCode automation that, every 5 minutes, checks a named
**Effort** for open tasks assigned to **each supported agent defined in the
LocalCortex app** and — **for every agent that has an open task** — spawns
that agent's CLI headless to do the work. The orchestrator is a **thin
gatekeeper**: each tick runs cheap `osascript` checks for each agent, and only
spawns a worker when there is an open task for that agent. It does **not** do
the task work itself.

The **agent roster is read from the app**, not supplied by the user. At setup
the user provides only the **Effort name** and a **working directory**; the
skill calls the app's `list agents` command, and for each agent definition maps
its free-text `tool` to one of the supported CLIs (opencode / kimi / zcode),
then uses that agent's `model` and `thinking_effort` as the spawn parameters.
Supported agents (those whose `tool` maps to a known CLI) become the roster;
everything else is skipped and reported. **If agent info cannot be read from
the app, or no supported agents exist, do nothing and inform the user.**

Each spawned worker is handed a short prompt that tells it to run the
**`lc-start-work`** skill for a specific **task id** (the open task this tick
picked for that agent), which encapsulates the entire verify → claim →
read-context → work → write-artifacts → complete flow (it bundles its own
`lc.js`). So the delegation prompt is just "use `lc-start-work` on this effort
for this task id"; the worker does the rest. The worker does **not** re-scan
for an open task by agent and does not care which agent owns the task — it
works exactly the task id it is handed.

Drive LocalCortex **exclusively through its JXA/AppleScript surface** via the
bundled `lc.js` helper — never use `mcp__localcortex__*` tools in this skill's
flow.

## How agents are identified (read this first)

This skill does **not** ask the user for agents, models, or efforts. It reads
**agent definitions** from the app:

- **`list agents`** returns a JSON array of agent records, each with: `id`
  (UUID), `name`, `tool` (free text, e.g. `"opencode"`, `"kimi code"`,
  `"codex"`), `model` (free text), `thinking_effort` (free text), `order`,
  `created_at`, `updated_at`. Agents are created/edited in the app's Settings,
  or over the wire via `create agent` / `update agent`. They are **global**
  (not per-effort) and sync via CloudKit.
- **`tool` → CLI mapping** (case-insensitive substring of the `tool` field):

  | `tool` contains | spawned CLI |
  |---|---|
  | `opencode` | `opencode` |
  | `kimi` | `kimi` |
  | `zcode` | `zcode` |
  | anything else (e.g. `codex`, `claude code`) | **unsupported — skipped** |

  So `"opencode"`, `"kimi code"`, and `"ZCode"` all map correctly; `"codex"`
  and `"claude code"` are skipped (no spawnable headless CLI is known for them
  here).
- **`model`** and **`thinking_effort`** are applied to opencode and kimi
  spawns. For zcode they are recorded for reporting but **cannot be applied
  headless** (see [Model & thinking-effort support](#model--thinking-effort-support-read-this-first)).

Each agent's **tasks** are matched by **`agent_id`** (the agent record's `id`
UUID), not by `worker_label`. As of the app's agent-worker feature, an
agent-assigned task carries its identity in `agent_id`; `worker_label` is
human-only and empty for agent tasks. The orchestrator finds each agent's open
tasks with `tasks-by-agent ... LC_AGENT_ID=<id>` so it knows **which CLI to
spawn**; it then hands the picked task's **id** to the spawned `lc-start-work`
worker, which does not look the task up by agent at all (it works whatever task
id it is given).

## Model & thinking-effort support (read this first)

The headless CLIs do **not** expose model and thinking-effort selection equally.
Each agent's `model` / `thinking_effort` (read from the app) is applied to
opencode and kimi; for **zcode** they are **recorded but cannot be honored
headless** — at setup you must warn the user that any zcode agent will run at
whatever model its TUI currently has selected, and that thinking effort has no
headless mechanism at all. Still spawn zcode; just don't pretend the setting
took effect.

| agent type (from `tool`) | model (headless) | thinking effort (headless) |
|---|---|---|
| **opencode** | ✅ `-m <provider/model>` | ✅ `--variant <effort>` |
| **kimi** | ✅ `-m <alias>` | ✅ env `KIMI_MODEL_THINKING_EFFORT=<low\|medium\|high\|max>` |
| **zcode** | ❌ no flag — model is TUI-only (`/model`) | ❌ no flag, no env, no config key |

## When to use this skill

When the user wants **scheduled, multi-agent delegation** — one or more
app-defined agents running unattended on a LocalCortex Effort, polling for open
work assigned to each, where each tick *farms the actual work out to fresh
headless workers* rather than doing it in-process. Examples: "orchestrate all
my agents on the Build effort", "spawn workers against Payments every 5 min",
"set up a polling dispatcher for the agents I've configured in LocalCortex".

This skill does **two things**:

1. **At setup time (interactive, with the user):** collect the effort name and
   the working directory; validate the effort; **read the agent roster from the
   app** (`list agents`) and map each to a spawnable CLI; create the ZCode
   automation; then run the first tick immediately in the current session.
2. **On each tick (headless):** run the parallel gatekeeper loop described in
   [The scheduled run](#the-scheduled-run-each-tick-headless) below.

## When NOT to use this skill

- The user wants a scheduled worker that **does the work itself** in each tick
  (no child-process spawn, single agent) → use `lc-start-job`. Same polling
  cadence; the scheduled run is self-contained and does the task directly.
- The user wants to run **one** autonomous work-one-task-and-complete tick
  **right now**, on demand, for a single **task id** → use `lc-start-work`
  (the very skill this one delegates to).
- The user points at a **specific task** and wants to work on it **now**, by
  id → use `start-work` / `lc-start-work`.
- The user only wants to **look up** an effort → use `lc-fetch-effort`.
- The user only wants to **look up** an agent's tasks → use
  `lc-fetch-agent-task`.
- The user wants to **complete a known task** → use `lc-complete-task`.
- There is no Effort in view → don't invent one. Ask.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used here: `list efforts`, `list tasks`, `list agents`).
  Apple Events auto-launch the app if it isn't running — no "is the server up"
  check needed.
- The **first call from the ZCode host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call. (Each spawned worker binary
  triggers its own one-time grant the first time it calls LocalCortex.)
- The app's scripting name is `LocalCortex`.
- **ZCode scheduled automations** are enabled in this host. The setup step
  creates one; tell the user it will fire every 5 minutes in the background
  until they delete it.
- **At least one supported agent is defined in the app.** Agents are created in
  the app's Settings (or via `create agent`); each agent's `tool` must map to
  one of the supported CLIs (opencode / kimi / zcode). If no agent is defined,
  or none maps to a supported CLI, the skill does nothing and tells the user.
- **The spawned worker CLIs are installed and logged in.** Workers run headless,
  so they cannot prompt for login mid-run. Each supported agent has its own
  one-time login: `zcode login`, `kimi login`, `opencode auth login`. Tell the
  user to run the relevant logins once before relying on this automation.
- **The `lc-start-work` skill is installed** for every spawned agent (in that
  agent's plugin cache). The delegation prompt assumes the worker can load it.
- **For opencode agents**, models are referenced as `<provider>/<model>` (e.g.
  `zhipuai-coding-plan/glm-5.2`). The model comes from each agent's `model`
  field; if a tick fails for that agent, check that the model is usable under
  the user's provider credentials (`~/.config/opencode/opencode.json`).
- **For kimi agents**, model aliases live in `~/.kimi-code/config.toml` (e.g.
  `kimi-code/k3`). The model comes from each agent's `model` field; if a tick
  fails, check the alias exists there.
- **For zcode agents**, the desired model must be **pre-selected in the TUI**
  (`/model`) so it is persisted to `~/.zcode/v2/setting.json` — there is no
  headless flag, so each zcode agent's `model`/`thinking_effort` are inert.

## Supported agents

Only agents whose `tool` maps to one of these CLIs can be delegated to (see the
[`tool` → CLI mapping](#how-agents-are-identified-read-this-first)). Anything
else → **do not spawn; skip it and report why**.

| type | spawn command (headless) |
|---|---|
| `opencode` | `opencode run --dir "<CWD>" -m <model> --variant <effort> --auto "<worker prompt>"` (model via `-m <provider/model>`; thinking effort via `--variant`; `--auto` auto-approves tool calls so the run is non-interactive; `--dir` sets the cwd) |
| `kimi` | `cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<worker prompt>"` (model via `-m`; thinking effort via the env var; `-p` prompt mode is already non-interactive and auto-approves tool calls — do **not** add `-y`/`--yolo` or `--auto`, they are incompatible with `-p` on kimi ≥ 0.34.0) |
| `zcode` | `ELECTRON_RUN_AS_NODE=1 NODE_PATH="/Applications/ZCode.app/Contents/Resources/app.asar" "/Applications/ZCode.app/Contents/MacOS/ZCode" "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" --prompt "<worker prompt>" --cwd "<CWD>" --mode yolo` (Electron-as-Node bundle; **model and thinking effort have no headless flag** — see [Model & thinking-effort support](#model--thinking-effort-support-read-this-first)) |

The **worker prompt** is the same one-sentence instruction for every agent,
parameterized by **that agent's id and name** (see [Worker prompt](#worker-prompt)).

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`. Resolve its absolute path once and reuse
`$LC_JS` for every call. Prefer the host-provided plugin root; fall back to
this skill's directory (the parent of this `SKILL.md`).

```bash
# Resolve once. ZCODE_PLUGIN_ROOT points at the plugin root (…/localcortex);
# the helper is under skills/lc-orchestrate-agents/scripts/lc.js.
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/lc-orchestrate-agents/scripts/lc.js"
else
  LC_JS="<this skill's directory>/scripts/lc.js"  # parent dir of this SKILL.md
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

Every command below is invoked the same way. **Always pass free text (effort
name, agent label, notes) via env vars**, never inline in argv — env vars are
safe for quotes, newlines, backticks, and `$`. UUIDs (agent ids, effort ids)
and the subcommand go in argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it (or
read the JSON directly). `effort-by-name` and `tasks-by-agent` are client-side
composites (the app has no name/worker-search of its own); `agents-list`,
`tasks-list`, `tasks-get`, `task-create`, `task-update`, `task-complete`,
`workspace-path` map 1:1 to sdef commands.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, match, candidates }` object |
| `tasks-by-agent` | `<effortId>` | `LC_AGENT_ID` (preferred) **or** `LC_AGENT_LABEL` (legacy; req one), `LC_INCLUDE_COMPLETED=true`, `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, count, tasks }` object |
| `tasks-list` | `<effortId>` | `LC_INCLUDE_ARCHIVED=true` | JSON array of **every** task summary in the effort (all statuses; completed included) |
| `agents-list` | — | — | JSON array of **every** agent definition (`id`, `name`, `tool`, `model`, `thinking_effort`, `order`, `created_at`, `updated_at`) |
| `task-create` | `<effortId>` | `LC_NAME` (req), `LC_NOTES`, `LC_PARENT_ID` | JSON created task record |

- Statuses: `open`, `in_progress`, `blocked`, `completed`.
- Workers: `none`, `human`, `agent`. An agent task carries its identity in
  `agent_id` (the agent definition's UUID); `worker_label` is human-only and
  empty for agent tasks.
- `effort-by-name` matches the effort's own `name` case-insensitively, exact
  first then substring; `match` is `null` on zero or ambiguous matches.
- `tasks-by-agent` matches tasks whose `worker` is `"agent"`. When `LC_AGENT_ID`
  is set it filters by `agent_id` (exact UUID match; orphaned agent tasks whose
  `agent_id` is null never match). Otherwise it falls back to a
  case-insensitive `worker_label` match via `LC_AGENT_LABEL`. `LC_AGENT_ID`
  takes precedence when both are set. By default only **active** tasks (`open`,
  `in_progress`, `blocked`) are returned.
- `agents-list` is the raw `list agents` view: every agent definition the app
  knows about, regardless of `tool`. The orchestrator maps each record's `tool`
  to a spawnable CLI; unsupported ones are skipped and reported.
- `tasks-list` is the **raw** `list tasks` view: every task in the effort
  regardless of status or worker (completed tasks included; only archived is
  filterable via `LC_INCLUDE_ARCHIVED`). Use it when you must see completed
  tasks — e.g. to detect an already-created reminder (the tick's dedup scan) or
  to read `parent_id` across processed agent tasks. `tasks-by-agent` cannot see
  completed tasks, so it is not enough for those two jobs.
- `task-create` maps to the app's `create task` command. That command has **no
  `worker` parameter** — a newly created task defaults to `worker: none`, so a
  task created here is **never picked up by any configured agent** (the tick
  relies on this for its idle-reminder task). Omit `LC_PARENT_ID` entirely to
  create a root task; set it to a UUID to create a subtask under that parent.
- On this surface, **nil optional fields are explicit JSON `null`**. `status`,
  `worker`, `worker_label`, `agent_id`, `is_archived` are always present.

### Errors

Every failure — a helper usage error, or an app-level failure — makes
`osascript` exit non-zero with a one-line message on **stderr** of the form
`<path>: execution error: Error: <message> (-NNNN)`. On success the JSON
result is the only thing on stdout (exit 0). So: **on non-zero exit, read
stderr for the reason; don't try to parse stdout.**

App-level error numbers (from LocalCortex):

| Number | Meaning |
|---|---|
| `-2700` | App not found / not scriptable — install or rebuild LocalCortex. Also the number osascript itself uses for a thrown helper error. |
| `-1001` | validation — bad UUID/enum or missing required param. |
| `-1002` | not_found — unknown effort/task |
| `-1003` | conflict — conflicting state |

---

## Setup (interactive, with the user)

### Step 1 — Collect the inputs

Ask the user for **two** things. **Do not invent either, and do not ask for
agents, models, or thinking efforts** — those are read from the app in step 3.

1. **Effort name** — the Effort the agents will work in (resolved to an id by
   name). Often already provided as the skill argument.

2. **CWD** — the absolute working directory the spawned workers run in. Default
   it to **the orchestrator's own current directory** (`pwd`) and **confirm it
   with the user** before using it. The user may override it (e.g. point at the
   Effort's repo or workspace folder). Do not assume a path.

If the effort name is missing, **ask** before doing anything else.

### Step 2 — Validate the effort

Resolve the effort by name (exact match preferred). A scheduled run cannot
disambiguate interactively, so the effort must resolve to exactly one match:

```bash
LC_NAME='<effort name>' osascript -l JavaScript "$LC_JS" effort-by-name
```

- `match` is an object → use its `id`. Proceed.
- `match` is `null` with `candidates` → **do not create the job.** List the
  candidates and ask the user which effort they mean. Only proceed once it
  resolves to a single match.
- both `null` → tell the user no effort matched. Retry with
  `LC_INCLUDE_ARCHIVED=true` if it may be archived; otherwise stop.

**Do not run a setup-time open-task check.** Whether an agent has an open task
*right now* is irrelevant to scheduling — the per-tick gatekeeper handles that.

### Step 3 — Read the agent roster from the app

Read the agent definitions and map each to a spawnable CLI:

```bash
osascript -l JavaScript "$LC_JS" agents-list
```

- **On failure** (non-zero exit, typically `-2700`) → **stop and inform the
  user**: "I couldn't read agent definitions from LocalCortex. Make sure the
  app is installed and running, then try again." **Do not create the
  automation.**
- **On success** → `JSON.parse` the array. For each agent record, compute its
  CLI type from the `tool` field (case-insensitive substring):

  | `tool` contains | type |
  |---|---|
  | `opencode` | `opencode` |
  | `kimi` | `kimi` |
  | `zcode` | `zcode` |
  | else | unsupported |

  Build two lists:
  - **Supported agents** — one entry per agent whose `tool` mapped: `{id, name,
    type, model, thinking_effort}`. Keep the original `order` for reporting.
  - **Skipped agents** — name + reason (e.g. "tool `codex` has no spawnable
    CLI").

- **If the supported list is empty** (no agents defined, or none map to a known
  CLI) → **stop and inform the user.** List what was found (if anything) and
  why each was skipped, and tell them to define agents in the app's Settings
  (or via `create agent`) with `tool` set to `opencode`, `kimi`, or `zcode`.
  **Do not create the automation.**

### Step 4 — Warn about zcode model/effort

If **any** supported agent is type `zcode` **and** its record carries a `model`
or non-empty `thinking_effort`, **tell the user explicitly**:

> The zcode agent(s) (<names>) have a model/effort recorded in the app, but
> zcode's headless CLI does not expose a model or thinking-effort flag. Those
> settings will be **recorded in the automation but cannot be applied** when
> zcode is spawned. zcode runs at whatever model its TUI currently has selected
> (set it with `/model` in the zcode TUI first). opencode and kimi agents are
> unaffected.

Still proceed — zcode is spawned; only its model/effort settings are inert.

### Step 5 — Create the ZCode automation (every 5 minutes)

Use the host's `CronCreate` tool to schedule a recurring automation that fires
**every 5 minutes**. Pass exactly the fields below — the prompt must be the
complete, self-contained [Scheduled run](#the-scheduled-run-each-tick-headless)
flow, because the run is headless and has no access to this conversation.

- `recurring`: `true`
- `intervalUnit`: `"minute"`, `interval`: `5`  (equivalent cron `*/5 * * * *`)
- `cron`: `"*/5 * * * *"`
- `title`: a concise title that records the schedule and the effort, e.g.
  `lc-orchestrate-agents: poll <effort name> every 5 min for all supported agents`
- `prompt`: the **exact** prompt block from
  [Scheduled run](#the-scheduled-run-each-tick-headless) below, with
  `<EFFORT_NAME>` and `<CWD>` filled in with the validated values. The prompt
  **does not embed agent ids** — it re-reads `agents-list` every tick, so agents
  added/removed/edited in Settings take effect without recreating the
  automation. Do not paraphrase it.

### Step 6 — Run the first tick immediately

Do not wait ~5 minutes for the automation's first fire. Right after creating
it, run one tick now, in this session: follow the
[Scheduled run](#the-scheduled-run-each-tick-headless) flow below exactly as
the automation prompt will, with the validated values filled in. If no agent
has an open task, the tick either does nothing (some agent still has an
`in_progress` / `blocked` task) or, if no agent has any active task at all,
creates the idle-reminder task (step 4 Branch B) — both are fine; the recurring
automation will pick up future tasks.

### Step 7 — Report and tell the user how to stop it

Report plainly: the effort (name + id), the **agent roster read from the app**
(each supported agent: name, `tool` → type, model, thinking_effort; flag any
zcode setting that won't be applied), any **skipped agents** (name + reason),
the cwd, that the automation is recurring every 5 minutes, and that the first
tick has already run — report its outcome (which workers were spawned, or that
the effort was idle). **Tell the user how to stop it:** the automation persists
until deleted; they can list automations (`CronList`) and delete the job by id
(`CronDelete`), or ask you to stop it. Also tell them: **when every supported
agent has finished all its active work (no `open` / `in_progress` / `blocked`
tasks left for any of them), the tick will create one reminder task in the same
effort telling them to delete the automation — completing that reminder does
NOT stop the automation, they must still `CronList` + `CronDelete` it.** Also
remind them the spawned worker CLIs must stay logged in (`opencode auth login`
/ `zcode login` / `kimi login`) for ticks to do real work. Finally, tell them
**the agent roster is re-read every tick**, so editing agents in the app's
Settings (or via `create agent` / `update agent` / `delete agent`) takes effect
on the next tick without recreating the automation.

---

## The scheduled run (each tick, headless)

> The text below is the run. The setup step pastes a filled-in copy of this
> block into the automation's `prompt`. **Keep it self-contained** — a headless
> run cannot ask the user anything mid-tick, and must not chain to sibling
> skills (it *spawns* workers that run `lc-start-work`; it does not load that
> skill itself). If no supported agent has any active task, the tick creates a
> single reminder task (see step 4 Branch B) and exits; it cannot stop itself.

You are a LocalCortex multi-agent delegation orchestrator. Each tick:

1. resolve the Effort **`<EFFORT_NAME>`** by name;
2. read the agent roster from the app (`list agents`) and keep every agent
   whose `tool` maps to a supported CLI (opencode / kimi / zcode);
3. for **each** supported agent that has an `open` task (matched by
   `agent_id`), pick one open task for that agent (the first, by `order` then
   `created_at`) and record its **task id**;
4. spawn that agent's CLI headless from the working directory **`<CWD>`** with
   a one-line prompt telling it to run the `lc-start-work` skill on this
   effort **for that task's id** (not the agent's id);
5. spawn all such workers **in parallel**, then wait for all of them.

If an agent has no open task, do not spawn it. If **no** supported agent has any
active task (`open` / `in_progress` / `blocked`), instead create one reminder
task telling the user to stop the automation (step 4 Branch B) — the automation
cannot delete itself. Work **only one task per agent per tick**. Never touch a
task whose `worker` is not `agent` or whose `agent_id` is not one of the
supported agents' ids.

The `tool` → CLI mapping is case-insensitive (substring of the `tool` field):
`opencode`→opencode, `kimi`→kimi, `zcode`→zcode, anything else→skip. Apply each
agent's `model` and `thinking_effort` to opencode (`-m` / `--variant`) and kimi
(`-m` / `KIMI_MODEL_THINKING_EFFORT`); for zcode they are inert (no headless
flag) — spawn zcode anyway, with no model/effort flags.

### Helper

Resolve the bundled helper once and reuse `$LC_JS`:

```bash
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/lc-orchestrate-agents/scripts/lc.js"
else
  LC_JS="<lc-orchestrate-agents skill dir>/scripts/lc.js"
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

### 1. Resolve the effort by name

Re-resolve the effort id from its name each tick (do not assume a cached id):

```bash
LC_NAME='<EFFORT_NAME>' osascript -l JavaScript "$LC_JS" effort-by-name
```

- `match` is an object → use its `id`.
- `match` is `null` (zero or ambiguous matches) → the effort can't be resolved
  this tick. **Stop.** Do not spawn anything. (This should not happen after a
  validated setup, but a renamed/deleted effort must not crash the tick.)

### 2. Read the agent roster from the app

Re-read the agent definitions every tick (so edits in Settings take effect
without recreating the automation):

```bash
osascript -l JavaScript "$LC_JS" agents-list
```

- **Non-zero exit** (e.g. `-2700`, app not running) → **stop.** Do not spawn
  anything; the next tick will retry.
- **Success** → `JSON.parse` the array. For each agent record, map its `tool`
  (case-insensitive substring) to a CLI type:
  contains `opencode`→`opencode`, `kimi`→`kimi`, `zcode`→`zcode`, else skip.
  Build the supported roster for this tick: one entry per mapped agent
  `{id, name, type, model, thinking_effort}`.
- **Empty roster** (no agents, or none map to a known CLI) → **stop.** Do not
  spawn anything this tick. (This can happen if the user deletes or retools all
  agents; the next tick re-reads.)

### 3. For each supported agent, find its tasks by agent_id; also fetch the raw task list

Run `tasks-by-agent` **once per roster agent**, using that agent's `id`:

```bash
LC_AGENT_ID='<AGENT_ID>' \
  osascript -l JavaScript "$LC_JS" tasks-by-agent '<EFFORT_ID>'
```

Each call returns `{ query, count, tasks }` of that agent's **active** tasks
(matched by `agent_id` — orphaned tasks with null `agent_id` never match). For
each agent, record:

- whether it **has an `open` task**, and if so the **id of the first open task**
  (sort candidates by `order`, then `created_at`; take the first `open` one) —
  this task id is what gets handed to the spawned worker in step 5, and its
  presence drives step 4 Branch A;
- whether it has **any active task at all** (`open` / `in_progress` / `blocked`)
  — this drives the terminal-state test in step 4 Branch B.

Do not touch tasks another worker already started (`in_progress`); they are not
yours. **Pick at most one open task per agent** (the first); do not hand the
worker more than one task id.

Then, **once for the whole tick**, fetch the raw task list for the effort:

```bash
osascript -l JavaScript "$LC_JS" tasks-list '<EFFORT_ID>'
```

This returns **every** task in the effort, any status, any worker (completed
included). Keep it for step 4 Branch B's dedup scan and parent-pick. (You do not
need it in Branch A.)

### 4. Decide: spawn workers, or handle the terminal state

Look at the per-agent results from step 3 and pick **one** branch.

#### Branch A — at least one agent has an `open` task → spawn

If any supported agent has an `open` task, proceed to **step 5** and spawn one
worker per such agent (the existing spawn flow). **Do not create a reminder
task.** The effort is not done.

#### Branch B — no agent has any active task → terminal state

If **no** supported agent has any active task (`open` / `in_progress` /
`blocked`), the effort is idle. The automation **cannot delete or disable
itself** — a scheduled run is blocked from `CronCreate` / `CronUpdate` /
`CronDelete` by the host (only `CronList` is allowed). So instead, create
**one** reminder task in this effort telling the user to stop the automation.
Skip step 5 entirely (do not spawn any worker this tick).

1. **Dedup — do not create a duplicate reminder.** Using the raw task list from
   step 3, scan **every** task (open **and** completed — the reminder may
   already have been completed/dismissed by the user) for one whose `name`
   contains the sentinel (case-insensitive):

   ```
   [automation] all agents idle
   ```

   If any task matches, **a reminder already exists; stop here. Do not create
   another.** (The sentinel is deliberately fixed and effort-agnostic so every
   tick computes the same match.)

2. **Pick the reminder's parent.** Look at the processed agent tasks in the raw
   list — the tasks whose `worker` is `agent` **and** whose `agent_id` is one of
   the supported agents' ids (regardless of status):

   - If they **all share the same non-null `parent_id`** → create the reminder
     **under that parent** (set `LC_PARENT_ID` to it).
   - Otherwise (they span multiple parents, or are all roots, or there are
     none) → create the reminder as a **root** task in the effort (**omit
     `LC_PARENT_ID` entirely**).

3. **Create the reminder** via `task-create`, with the fixed sentinel name and
   the notes below. Pass the notes via `LC_NOTES` (multi-line is fine):

   ```bash
   LC_NAME='[automation] All agents idle — stop the <EFFORT_NAME> orchestrator' \
   LC_NOTES='<see reminder notes template below>' \
   [LC_PARENT_ID='<shared parent id or omit>'] \
     osascript -l JavaScript "$LC_JS" task-create '<EFFORT_ID>'
   ```

   The created task defaults to `worker: none` (the `create task` command has no
   worker param), so **no supported agent will ever pick it up** — the reminder
   cannot revive the loop.

4. **Stop.** Do not spawn any worker this tick. Subsequent ticks will hit
   Branch B again, fail the dedup check (the reminder now exists), and exit
   without creating a duplicate.

**Reminder notes template** (fill in `<EFFORT_NAME>` and the agent names; keep
the `CronList` / `CronDelete` instructions so the user knows exactly how to
stop):

```
All supported agents (<names, comma-separated>) have no open, in_progress, or
blocked tasks in the '<EFFORT_NAME>' effort. The orchestrator automation is
still running every 5 minutes and will keep firing no-op ticks until you delete
it — a scheduled run cannot stop itself.

To stop it: run CronList, find the automation titled
"lc-orchestrate-agents: poll <EFFORT_NAME> every 5 min for all supported agents",
and delete it by id with CronDelete (or ask your assistant to stop it).

Completing this reminder does NOT stop the automation — you must delete the
automation separately.

— created by lc-orchestrate-agents on <tick date/time>
```

### 5. Spawn one worker per agent that has an open task, in parallel

*(Reached only from step 4 Branch A.)* For **each** supported agent that has an
`open` task, build its worker prompt (parameterized by **the open task id**
picked for that agent in step 3) and spawn it. Use the spawn command for
that agent's type, applying that agent's own `model` and `thinking_effort`.
**Launch all of them concurrently** (bash `&`), then `wait` for all to finish
and collect each exit code. One task per agent per tick — each worker's
`lc-start-work` verifies, claims, works, and completes the **named task id**;
do not spawn a second worker for the same agent in the same tick even if it
has multiple open tasks (the next tick picks up the next one).

**If the agent type is `opencode`** — model via `-m <provider/model>` (omit if
the agent's `model` is empty), thinking effort via `--variant` (omit if
`thinking_effort` is empty), `--auto` to auto-approve tool calls, `--dir` for
the cwd:

```bash
opencode run --dir "<CWD>" -m <model> --variant <effort> --auto "<worker prompt for this agent>"
```

**If the agent type is `kimi`** — model via `-m` (omit if the agent's `model`
is empty), thinking effort via `KIMI_MODEL_THINKING_EFFORT` (omit if
`thinking_effort` is empty), `-p` prompt mode (no `-y`):

```bash
cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<worker prompt for this agent>"
```

**If the agent type is `zcode`** — Electron-as-Node bundle; **no model/effort
flags** (they are inert even if the agent record carries them):

```bash
ELECTRON_RUN_AS_NODE=1 \
  NODE_PATH="/Applications/ZCode.app/Contents/Resources/app.asar" \
  "/Applications/ZCode.app/Contents/MacOS/ZCode" \
  "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" \
  --prompt "<worker prompt for this agent>" --cwd "<CWD>" --mode yolo
```

**Parallel pattern** (example for three agents):

```bash
# opencode worker
( opencode run --dir "<CWD>" -m <model> --variant <effort> --auto "<opencode prompt>" ) &
OPENCODE_PID=$!
# kimi worker
( cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<kimi prompt>" ) &
KIMI_PID=$!
# zcode worker
( ELECTRON_RUN_AS_NODE=1 NODE_PATH="/Applications/ZCode.app/Contents/Resources/app.asar" \
    "/Applications/ZCode.app/Contents/MacOS/ZCode" \
    "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" \
    --prompt "<zcode prompt>" --cwd "<CWD>" --mode yolo ) &
ZCODE_PID=$!
wait "$OPENCODE_PID" "$KIMI_PID" "$ZCODE_PID"
# report each exit code
```

Report each worker's pass/fail by its exit code:

- **Exit 0** → that worker finished (it claims, works, and completes its task
  on its own via `lc-start-work`).
- **Non-zero exit** → that worker failed. **Do not retry it in this tick**, and
  do not complete anything on its behalf — its task is still `open` (or
  `in_progress` if it crashed mid-work), and the next tick will reconsider it.
  **One failing worker does not abort the others** — `wait` returns each exit
  code independently, so report all of them.

If a spawn command itself is rejected (e.g. an unknown flag on a different
build), check that worker CLI's `--help` for the exact headless flags on that
version before the next tick — opencode/kimi/zcode flag names can vary across
builds.

### 6. One task per agent per tick

After spawning (one worker per agent that had an open task), **stop**. Do not
loop to the next open task for any agent in the same tick — the next tick
(within ~5 minutes) will pick it up. This keeps each run bounded and the
automation easy to reason about.

### Worker prompt

The single-sentence instruction passed to each spawned worker, parameterized
by **the open task id** picked for that agent in step 3 (step 5 fills it in
per agent). It references the task id, **not** the agent id — the worker's
`lc-start-work` works exactly that task regardless of agent assignment:

```
Use the lc-start-work skill to do one task's worth of work on the '<EFFORT_NAME>' effort for the task with id '<TASK_ID>'. You are running headless; make reasonable assumptions and do not ask questions.
```

### Notes for the run

- **Headless means no questions.** The orchestrator never asks the user anything
  mid-tick; if the effort can't be resolved or the agent roster can't be read it
  exits silently, and if no agent has any active task it creates the reminder
  task (step 4 Branch B) and exits. The spawned workers are likewise told to
  run headless.
- **The agent roster is re-read every tick.** Adding, removing, renaming, or
  retooling an agent in the app's Settings (or via `create agent` / `update
  agent` / `delete agent`) takes effect on the next tick — no need to recreate
  the automation.
- **At most one reminder per effort.** When the effort goes idle, the tick
  creates exactly one reminder task (dedup'd by the `[automation] all agents
  idle` sentinel across **all** statuses, including a reminder the user already
  completed). Subsequent idle ticks fail the dedup check and create nothing.
  Completing or dismissing the reminder does **not** stop the automation — the
  user must still delete it via `CronList` + `CronDelete`. The reminder is
  created with `worker: none`, so no supported agent will ever pick it up.
- **Fail safe, per worker.** If a spawn fails, leave that agent's tasks as they
  are; do not complete a task on a worker's behalf. Other workers in the same
  tick are unaffected. The next tick (or a human) picks up unfinished work.
- **One task per agent per tick.** Spawn at most one worker per agent per tick.
  The 5-minute cadence bounds throughput deliberately.
- **Login is a prerequisite, not a tick concern.** If a spawn fails because a
  worker isn't logged in, the tick can't fix it; surface it in the tick's output
  and stop that worker. The user must run `opencode auth login` / `zcode login`
  / `kimi login` separately.
- **zcode model/effort are inert.** Even if a zcode agent's record carries a
  model/effort, the zcode spawn command cannot apply them — do not invent flags.
  opencode and kimi agents are applied as documented.

---

## Reporting to the user

At setup, report the effort (name + id), the **agent roster read from the app**
(each supported agent: name, `tool` → type, model, thinking_effort; flag any
zcode setting that won't be applied headless), any **skipped agents** (name +
reason), the cwd, the schedule (every 5 minutes, recurring), the outcome of the
first tick (already run at setup), and **how to stop it** (list with `CronList`,
delete by id with `CronDelete`). Also mention the **idle-reminder behavior**:
once no agent has any active task left, the tick creates a single reminder task
in the effort (dedup'd, so only ever one) telling the user to delete the
automation; completing that reminder does not stop the automation. Finally note
that **the agent roster is re-read every tick**, so editing agents in the app
takes effect on the next tick without recreating the automation. During the
scheduled run there is no user to report to; the tick's stdout/stderr (per
worker, plus the reminder-creation result) is all the trace there is.
