---
name: lc-orchestrate-agents
description: >-
  Set up a recurring LocalCortex multi-agent orchestrator — the macOS task
  manager app — that polls a named Effort every 5 minutes and, for each
  configured agent that has an open task, spawns that agent's CLI (zcode or kimi)
  headless to do the work. At setup the user names one or more agents, each with
  its own model and thinking effort, plus a working directory. Each tick checks
  every configured agent in parallel and spawns one worker per agent that has an
  open task. The spawned worker runs the lc-start-work skill, which finds, claims,
  works, and completes the task itself. Drives LocalCortex through its
  JXA/AppleScript surface (osascript), not MCP. Use for scheduled multi-agent
  delegation — e.g. "orchestrate kimi (K3, high) and zcode (glm-5.2) on Build".
argument-hint: "[effort name]"
allowed-tools: [Bash, Read]
version: 0.1.13
license: MIT
---

# lc-orchestrate-agents — a scheduled multi-agent delegation orchestrator

Set up a scheduled ZCode automation that, every 5 minutes, checks a named
**Effort** for open tasks assigned to **each of one or more configured agents**
and — **for every agent that has an open task** — spawns that agent's CLI
headless to do the work. The orchestrator is a **thin gatekeeper**: each tick
runs cheap `osascript` checks for each agent, and only spawns a worker when
there is an open task for that agent. It does **not** do the task work itself.

At setup the user provides a **list of agent specs** — each agent type they want
spawned, optionally with its own **model** and **thinking effort** — plus a
**working directory**. The tick then spawns, **in parallel**, one worker per
agent that has an open task, and waits for all of them to finish.

Each spawned worker is handed a short prompt that tells it to run the
**`lc-start-work`** skill, which encapsulates the entire claim → read-context →
work → write-artifacts → complete flow (it bundles its own `lc.js`). So the
delegation prompt is just "use `lc-start-work` on this effort for this agent";
the worker does the rest. This is the key difference from `lc-start-job`, whose
scheduled run does the work itself, and from the earlier single-agent version of
this skill.

Drive LocalCortex **exclusively through its JXA/AppleScript surface** via the
bundled `lc.js` helper — never use `mcp__localcortex__*` tools in this skill's
flow.

## Model & thinking-effort support (read this first)

The headless CLIs do **not** expose model and thinking-effort selection equally:

| agent type | model (headless) | thinking effort (headless) |
|---|---|---|
| **kimi** | ✅ `-m <alias>` (e.g. `kimi-code/k3`) | ✅ env `KIMI_MODEL_THINKING_EFFORT=<low\|medium\|high\|max>` |
| **zcode** | ❌ no flag — model is TUI-only (`/model`), persisted to `~/.zcode/v2/setting.json` | ❌ no flag, no env, no config key |

So a per-agent model + thinking-effort setting is **applied to kimi only**. For
**zcode**, any model/effort the user gives is **recorded but cannot be honored
headless** — at setup you must warn the user that zcode will run at whatever
model its TUI currently has selected, and that thinking effort has no headless
mechanism at all. Still spawn zcode; just don't pretend the setting took effect.

## When to use this skill

When the user wants **scheduled, multi-agent delegation** — one or more agents
running unattended on a LocalCortex Effort, polling for open work assigned to
each, where each tick *farms the actual work out to fresh headless workers*
rather than doing it in-process. Examples: "orchestrate kimi with K3 at high
effort, and zcode with glm-5.2, on the Build effort", "spawn both kimi and zcode
against Payments every 5 min", "set up a polling dispatcher for these agents …".

This skill does **two things**:

1. **At setup time (interactive, with the user):** collect the effort name, the
   list of agent specs (type + optional model + optional thinking effort), and
   the working directory; validate the effort; create the ZCode automation; then
   run the first tick immediately in the current session.
2. **On each tick (headless):** run the parallel gatekeeper loop described in
   [The scheduled run](#the-scheduled-run-each-tick-headless) below.

## When NOT to use this skill

- The user wants a scheduled worker that **does the work itself** in each tick
  (no child-process spawn, single agent) → use `lc-start-job`. Same polling
  cadence; the scheduled run is self-contained and does the task directly.
- The user wants to run **one** autonomous pull-work-and-complete tick **right
  now**, on demand, for a single agent → use `lc-start-work` (the very skill
  this one delegates to).
- The user points at a **specific task** and wants to work on it **now**, by id
  or name → use `start-work` / `lc-start-work`.
- The user only wants to **look up** an effort → use `lc-fetch-effort`.
- The user only wants to **look up** an agent's tasks → use
  `lc-fetch-agent-task`.
- The user wants to **complete a known task** → use `lc-complete-task`.
- There is no Effort in view → don't invent one. Ask.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used here: `list efforts`, `list tasks`). Apple Events
  auto-launch the app if it isn't running — no "is the server up" check needed.
- The **first call from the ZCode host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call. (Each spawned worker binary
  triggers its own one-time grant the first time it calls LocalCortex.)
- The app's scripting name is `LocalCortex`.
- **ZCode scheduled automations** are enabled in this host. The setup step
  creates one; tell the user it will fire every 5 minutes in the background
  until they delete it.
- **The spawned worker CLIs are installed and logged in.** Workers run headless,
  so they cannot prompt for login mid-run. Each supported agent has its own
  one-time login: `zcode login`, `kimi login`. Tell the user to run the relevant
  logins once before relying on this automation.
- **The `lc-start-work` skill is installed** for every spawned agent (in that
  agent's plugin cache). The delegation prompt assumes the worker can load it.
- **For kimi**, model aliases live in `~/.kimi-code/config.toml` (e.g.
  `kimi-code/k3`, `kimi-code/kimi-for-coding`, `kimi-code/k3-256k`). Confirm the
  alias the user names actually exists there before scheduling.
- **For zcode**, the desired model must be **pre-selected in the TUI** (`/model`)
  so it is persisted to `~/.zcode/v2/setting.json` — there is no headless flag.

## Supported agents

Only these agent types can be delegated to (the `worker_label` tasks are
assigned to). Anything else → **do not spawn; stop and tell the user** the type
is unsupported.

| type | spawn command (headless) |
|---|---|
| `kimi` | `cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<worker prompt>"` (model via `-m`; thinking effort via the env var; `-p` prompt mode is already non-interactive and auto-approves tool calls — do **not** add `-y`/`--yolo` or `--auto`, they are incompatible with `-p` on kimi ≥ 0.34.0) |
| `zcode` | `ELECTRON_RUN_AS_NODE=1 NODE_PATH="/Applications/ZCode.app/Contents/Resources/app.asar" "/Applications/ZCode.app/Contents/MacOS/ZCode" "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" --prompt "<worker prompt>" --cwd "<CWD>" --mode yolo` (Electron-as-Node bundle; **model and thinking effort have no headless flag** — see [Model & thinking-effort support](#model--thinking-effort-support-read-this-first)) |

The **worker prompt** is the same one-sentence instruction for every agent type,
parameterized by that agent's own label (see
[Worker prompt](#worker-prompt)).

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
name, agent label) via env vars**, never inline in argv — env vars are safe for
quotes, newlines, backticks, and `$`. UUIDs and the subcommand go in argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it (or
read the JSON directly). `effort-by-name` and `tasks-by-agent` are client-side
composites (the app has no name/worker-search of its own); they are the only
two this skill needs.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, match, candidates }` object |
| `tasks-by-agent` | `<effortId>` | `LC_AGENT_LABEL` (req), `LC_INCLUDE_COMPLETED=true`, `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, count, tasks }` object |

- Statuses: `open`, `in_progress`, `blocked`, `completed`.
- Workers: `none`, `human`, `agent` (+ `worker_label`, e.g. `zcode`, `kimi`).
- `effort-by-name` matches the effort's own `name` case-insensitively, exact
  first then substring; `match` is `null` on zero or ambiguous matches.
- `tasks-by-agent` returns tasks whose `worker` is `"agent"` **and** whose
  `worker_label` matches the query case-insensitively; by default only
  **active** tasks (`open`, `in_progress`, `blocked`) are returned.
- On this surface, **nil optional fields are explicit JSON `null`**. `status`,
  `worker`, `worker_label`, `is_archived` are always present.

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

Ask the user for three things. **Do not invent any of them.**

1. **Effort name** — the Effort the agents will work in (resolved to an id by
   name). Often already provided as the skill argument.

2. **Agent specs — a list.** Ask which agents to orchestrate, and for each, its
   model and thinking effort. Build a list of specs, one per agent:

   | field | required? | notes |
   |---|---|---|
   | `label` | **yes** | the agent's `worker_label` — `kimi` or `zcode`. Not the literal string "agent". |
   | `model` | optional | kimi: a `~/.kimi-code/config.toml` alias, e.g. `kimi-code/k3`. zcode: **ignored headless** (see warning below). |
   | `effort` | optional | one of `low`, `medium`, `high`, `max`. kimi: applied via `KIMI_MODEL_THINKING_EFFORT`. zcode: **ignored headless**. |

   Example the user might give: *"kimi with K3 at high effort, and zcode with
   glm-5.2 at the highest effort."* That yields two specs:
   `{label: kimi, model: kimi-code/k3, effort: high}` and
   `{label: zcode, model: glm-5.2, effort: max}`.

3. **CWD** — the absolute working directory the spawned workers run in. Default
   it to **the orchestrator's own current directory** (`pwd`) and **confirm it
   with the user** before using it. The user may override it (e.g. point at the
   Effort's repo or workspace folder). Do not assume a path.

If the effort name is missing, or the agent list is empty, **ask** before doing
anything else. You may proceed with an agent list whose specs omit model/effort
(the CLIs just use their defaults).

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

**Do not run a setup-time `tasks-by-agent` open-task check.** Whether an agent
has an open task *right now* is irrelevant to scheduling — the per-tick
gatekeeper handles that. (This is a deliberate change from the single-agent
version of this skill.)

### Step 3 — Warn about zcode model/effort

If **any** spec is type `zcode` **and** the user gave a `model` or `effort` for
it, **tell them explicitly**:

> zcode's headless CLI does not expose a model or thinking-effort flag. The
> model you named (`<model>`) and effort (`<effort>`) will be **recorded in the
> automation but cannot be applied** when zcode is spawned. zcode runs at
> whatever model its TUI currently has selected (set it with `/model` in the
> zcode TUI first). kimi specs are unaffected.

Still proceed — zcode is spawned; only its model/effort settings are inert.

### Step 4 — Confirm kimi model aliases (if any kimi spec has a model)

For each kimi spec that names a model, confirm the alias exists before
scheduling (a typo'd alias fails every kimi tick):

```bash
grep -n '<model alias>' ~/.kimi-code/config.toml
```

No match → tell the user the alias is unknown and ask them to pick one from
`~/.kimi-code/config.toml` (or omit the model to use `default_model`).

### Step 5 — Create the ZCode automation (every 5 minutes)

Use the host's `CronCreate` tool to schedule a recurring automation that fires
**every 5 minutes**. Pass exactly the fields below — the prompt must be the
complete, self-contained [Scheduled run](#the-scheduled-run-each-tick-headless)
flow, because the run is headless and has no access to this conversation.

- `recurring`: `true`
- `intervalUnit`: `"minute"`, `interval`: `5`  (equivalent cron `*/5 * * * *`)
- `cron`: `"*/5 * * * *"`
- `title`: a concise title that records the schedule, the effort, and **all
  agent types**, e.g.
  `lc-orchestrate-agents: poll <effort name> every 5 min for kimi, zcode`
- `prompt`: the **exact** prompt block from
  [Scheduled run](#the-scheduled-run-each-tick-headless) below, with
  `<EFFORT_NAME>`, `<CWD>`, and the **agent-specs table** filled in with the
  validated values. Do not paraphrase it.

### Step 6 — Run the first tick immediately

Do not wait ~5 minutes for the automation's first fire. Right after creating
it, run one tick now, in this session: follow the
[Scheduled run](#the-scheduled-run-each-tick-headless) flow below exactly as
the automation prompt will, with the validated values filled in. If no agent has
an open task, the tick does nothing — that is fine; the recurring automation
will pick up future tasks.

### Step 7 — Report and tell the user how to stop it

Report plainly: the effort (name + id), the **list of agent specs** (each
type + model + effort, noting any zcode setting that won't be applied), the cwd,
that the automation is recurring every 5 minutes, and that the first tick has
already run — report its outcome (which workers were spawned, or that no agent
had an open task). **Tell the user how to stop it:** the automation persists
until deleted; they can list automations (`CronList`) and delete the job by id
(`CronDelete`), or ask you to stop it. Also remind them the spawned worker CLIs
must stay logged in (`zcode login` / `kimi login`) for ticks to do real work.

---

## The scheduled run (each tick, headless)

> The text below is the run. The setup step pastes a filled-in copy of this
> block into the automation's `prompt`. **Keep it self-contained** — a headless
> run cannot ask the user anything mid-tick, and must not chain to sibling
> skills (it *spawns* workers that run `lc-start-work`; it does not load that
> skill itself). If no configured agent has an open task, the tick does nothing
> and exits.

You are a LocalCortex multi-agent delegation orchestrator. Poll the Effort
**`<EFFORT_NAME>`** for **open** tasks assigned to each of the agents listed
below. For **each** agent that has an `open` task, spawn that agent's CLI
headless (from the working directory **`<CWD>`**) with a one-line prompt telling
it to run the `lc-start-work` skill on this effort for that agent. Spawn all
such workers **in parallel**, then wait for all of them. If an agent has no open
task, do not spawn it. Work **only one task per agent per tick**. Never touch a
task whose `worker` is not `agent` or whose `worker_label` is not one of the
configured labels.

**Agent specs for this run** (filled in at setup):

| label | model | effort | spawn command |
|---|---|---|---|
| `<AGENT_LABEL_1>` | `<model or none>` | `<effort or none>` | `<the exact spawn command for this type, with model/effort applied for kimi; for zcode, model/effort omitted with a comment that they are inert>` |
| `<AGENT_LABEL_2>` | … | … | … |

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

### 2. For each configured agent, check for an open task

Run `tasks-by-agent` **once per agent spec**, using that agent's `worker_label`:

```bash
LC_AGENT_LABEL='<AGENT_LABEL>' \
  osascript -l JavaScript "$LC_JS" tasks-by-agent '<EFFORT_ID>'
```

Each call returns `{ query, count, tasks }` of that agent's **active** tasks.
An agent **has work this tick** iff at least one of its tasks has
`status == "open"` (sort by `order`, then `created_at`). Record the set of
agents that have an open task. Do not touch tasks another worker already started
(`in_progress`); they are not yours.

### 3. If no agent has an open task, stop

If the set of agents with an open task is empty, **there is nothing to do this
tick; stop here.**

### 4. Spawn one worker per agent that has an open task, in parallel

For **each** agent in the set, build its worker prompt and spawn it. Use the
spawn command for that agent's type from the specs table. **Launch all of them
concurrently** (bash `&`), then `wait` for all to finish and collect each exit
code. One task per agent per tick — each worker's `lc-start-work` handles the
claim/work/complete; do not spawn a second worker for the same agent in the same
tick even if it has multiple open tasks.

**If the agent type is `kimi`** — model via `-m` (omit if model is `none`),
thinking effort via `KIMI_MODEL_THINKING_EFFORT` (omit if effort is `none`),
`-p` prompt mode (no `-y`):

```bash
cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<worker prompt for this agent>"
```

**If the agent type is `zcode`** — Electron-as-Node bundle; **no model/effort
flags** (they are inert even if recorded in the specs table):

```bash
ELECTRON_RUN_AS_NODE=1 \
  NODE_PATH="/Applications/ZCode.app/Contents/Resources/app.asar" \
  "/Applications/ZCode.app/Contents/MacOS/ZCode" \
  "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" \
  --prompt "<worker prompt for this agent>" --cwd "<CWD>" --mode yolo
```

**Parallel pattern** (example for two agents):

```bash
# kimi worker
( cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<kimi prompt>" ) &
KIMI_PID=$!
# zcode worker
( ELECTRON_RUN_AS_NODE=1 NODE_PATH="/Applications/ZCode.app/Contents/Resources/app.asar" \
    "/Applications/ZCode.app/Contents/MacOS/ZCode" \
    "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" \
    --prompt "<zcode prompt>" --cwd "<CWD>" --mode yolo ) &
ZCODE_PID=$!
wait "$KIMI_PID" "$ZCODE_PID"
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
version before the next tick — zcode/kimi flag names can vary across builds.

### 5. One task per agent per tick

After spawning (one worker per agent that had an open task), **stop**. Do not
loop to the next open task for any agent in the same tick — the next tick
(within ~5 minutes) will pick it up. This keeps each run bounded and the
automation easy to reason about.

### Worker prompt

The single-sentence instruction passed to each spawned worker, parameterized by
**that worker's own** label (step 4 fills it in per agent):

```
Use the lc-start-work skill to do one task's worth of work on the '<EFFORT_NAME>' effort for the '<AGENT_LABEL>' agent. You are running headless; make reasonable assumptions and do not ask questions.
```

### Notes for the run

- **Headless means no questions.** The orchestrator never asks the user anything
  mid-tick; if the effort can't be resolved or no agent has an open task, it
  exits silently. The spawned workers are likewise told to run headless.
- **Fail safe, per worker.** If a spawn fails, leave that agent's tasks as they
  are; do not complete a task on a worker's behalf. Other workers in the same
  tick are unaffected. The next tick (or a human) picks up unfinished work.
- **One task per agent per tick.** Spawn at most one worker per agent per tick.
  The 5-minute cadence bounds throughput deliberately.
- **Login is a prerequisite, not a tick concern.** If a spawn fails because a
  worker isn't logged in, the tick can't fix it; surface it in the tick's output
  and stop that worker. The user must run `zcode login` / `kimi login`
  separately.
- **zcode model/effort are inert.** Even if the specs table records a
  model/effort for a zcode agent, the zcode spawn command cannot apply them —
  do not invent flags. kimi specs are applied as documented.

---

## Reporting to the user

At setup, report the effort (name + id), the **list of agent specs** (each type
+ model + effort, flagging any zcode setting that won't be applied headless),
the cwd, the schedule (every 5 minutes, recurring), the outcome of the first
tick (already run at setup), and **how to stop it** (list with `CronList`,
delete by id with `CronDelete`). During the scheduled run there is no user to
report to; the tick's stdout/stderr (per worker) is all the trace there is.
