---
name: lc-orchestrate-agents
description: >-
  Set up a recurring LocalCortex orchestrator — the macOS task manager app —
  that polls a named Effort every 5 minutes for an open task assigned to a given
  agent and, when one exists, delegates it by spawning that agent's CLI (zcode or
  kimi) headless. The spawned worker runs the lc-start-work skill, which finds,
  claims, works, and completes the task itself. Unlike lc-start-job (where the
  scheduled run does the work itself), this skill is a thin gatekeeper: each tick
  does a cheap check and only spawns a fresh headless worker when there is an open
  task. Drives LocalCortex through its JXA/AppleScript surface (osascript), not
  MCP. Use for scheduled delegation — e.g. "orchestrate zcode on the Build
  effort", "delegate open kimi tasks every 5 min".
argument-hint: "[effort name] [agent label] [cwd]"
allowed-tools: [Bash, Read]
version: 0.1.11
license: MIT
---

# lc-orchestrate-agents — a scheduled delegation gatekeeper

Set up a scheduled ZCode automation that, every 5 minutes, checks a named
**Effort** for an **open** task assigned to a given **agent** and — **only when
one exists** — spawns that agent's CLI headless to do the work. The orchestrator
is a **thin gatekeeper**: each tick runs a cheap `osascript` check, and only when
there is an open task does it spawn a fresh headless worker process. It does
**not** do the task work itself.

The spawned worker is handed a short prompt that tells it to run the
**`lc-start-work`** skill, which encapsulates the entire claim → read-context →
work → write-artifacts → complete flow (it bundles its own `lc.js`). So the
delegation prompt is just "use `lc-start-work` on this effort for this agent";
the worker does the rest. This is the key difference from `lc-start-job`, whose
scheduled run does the work itself.

Drive LocalCortex **exclusively through its JXA/AppleScript surface** via the
bundled `lc.js` helper — never use `mcp__localcortex__*` tools in this skill's
flow.

## When to use this skill

When the user wants **scheduled delegation** — an agent to run unattended on a
LocalCortex Effort, polling for open work assigned to it, but where each tick
*farms the actual work out to a fresh headless worker* rather than doing it
in-process. Examples: "orchestrate zcode on the Build effort", "delegate open
kimi tasks every 5 min", "set up a polling dispatcher for …".

This skill does **two things**:

1. **At setup time (interactive, with the user):** validate the effort name,
   agent label, and working directory, create the ZCode automation, then run the
   first tick immediately in the current session.
2. **On each tick (headless):** run the gatekeeper loop described in
   [The scheduled run](#the-scheduled-run-each-tick-headless) below.

## When NOT to use this skill

- The user wants a scheduled worker that **does the work itself** in each tick
  (no child-process spawn) → use `lc-start-job`. Same polling cadence; the
  scheduled run is self-contained and does the task directly.
- The user wants to run **one** autonomous pull-work-and-complete tick **right
  now**, on demand → use `lc-start-work` (the very skill this one delegates to).
- The user points at a **specific task** and wants to work on it **now**, by id
  or name → use `start-work`.
- The user only wants to **look up** an effort → use `lc-fetch-effort`.
- The user only wants to **look up** an agent's tasks → use
  `lc-fetch-agent-task`.
- The user wants to **complete a known task** → use `lc-complete-task`.
- There is no Effort and no agent in view → don't invent either. Ask.

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
- **The spawned worker CLI is installed and logged in.** Workers run headless,
  so they cannot prompt for login mid-run. Each supported agent has its own
  one-time login: `zcode login`, `kimi login`. Tell the user to run the relevant
  login once before relying on this automation.
- **The `lc-start-work` skill is installed** for every spawned agent (in that
  agent's plugin cache). The delegation prompt assumes the worker can load it.

## Supported agents

Only these agent labels can be delegated to (the `worker_label` read off the
task). Anything else → **do not spawn; stop and tell the user** the label is
unsupported.

| label | spawn command (headless) |
|---|---|
| `zcode` | `zcode --prompt "<worker prompt>" --cwd "<CWD>" --mode yolo` (see the full invocation in [The scheduled run](#5-spawn-the-worker-blocking) — zcode is an Electron-as-Node bundle, not a plain `node` script) |
| `kimi` | `cd "<CWD>" && kimi -p "<worker prompt>"` (kimi has no `--cwd` flag, so set cwd with `cd`; `-p` prompt mode is already non-interactive and auto-approves tool calls — do **not** add `-y`/`--yolo` or `--auto`, they are incompatible with `-p` on kimi ≥ 0.34.0) |

The **worker prompt** is the same one-sentence instruction for both (see
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
- Workers: `none`, `human`, `agent` (+ `worker_label`, e.g. `zcode`).
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

### Step 1 — Confirm the three inputs

The job is defined by three things the user must provide:

- **Effort name** — the Effort to poll (resolved to an id by name).
- **Agent label** — the `worker_label` of the agent that owns the tasks
  (e.g. `zcode`, `kimi`). This is **not** the literal string "agent".
- **CWD** — the absolute working directory the spawned worker runs in (e.g. the
  Effort's repo or workspace folder). The worker's `lc-start-work` skill reads
  and writes here.

If any is missing or ambiguous, **ask** before doing anything else. Do not
invent an effort, guess a label, or pick a cwd.

### Step 2 — Validate that the effort and agent exist

Resolve the effort by name (exact match preferred). A scheduled run cannot
disambiguate interactively, so the effort must resolve to exactly one match:

```bash
LC_NAME='<effort name>' osascript -l JavaScript "$LC_JS" effort-by-name
```

- `match` is an object → use its `id`. Stop here.
- `match` is `null` with `candidates` → **do not create the job.** List the
  candidates and ask the user which effort they mean. Only proceed once it
  resolves to a single match.
- both `null` → tell the user no effort matched. Retry with
  `LC_INCLUDE_ARCHIVED=true` if it may be archived; otherwise stop.

Then confirm the agent actually has tasks in that effort (this also surfaces a
label typo). Active tasks only:

```bash
LC_AGENT_LABEL='<agent label>' \
  osascript -l JavaScript "$LC_JS" tasks-by-agent "$EFFORT_ID"
```

A `count` of 0 is **not** a failure — it just means there is nothing to do
*right now*; the job will pick up future tasks. But a typo'd label also yields
0, so: if `count` is 0, tell the user and **ask them to confirm the label is
correct** before scheduling. Do not block on it, but do not silently schedule
a job over a wrong label either.

**Supported-label check:** if the agent label is not one of `zcode`, `kimi`,
**stop** — tell the user that label is not (yet) a supported spawn target, and
that they should use a supported label or ask for one to be added. Do not
create the job.

### Step 3 — Create the ZCode automation (every 5 minutes)

Use the host's `CronCreate` tool to schedule a recurring automation that fires
**every 5 minutes**. Pass exactly the fields below — the prompt must be the
complete, self-contained [Scheduled run](#the-scheduled-run-each-tick-headless)
flow, because the run is headless and has no access to this conversation.

- `recurring`: `true`
- `intervalUnit`: `"minute"`, `interval`: `5`  (equivalent cron `*/5 * * * *`)
- `cron`: `"*/5 * * * *"`
- `title`: a concise title that records the schedule, the effort, and the agent,
  e.g. `lc-orchestrate-agents: poll <effort name> every 5 min for <agent label>`
- `prompt`: the **exact** prompt block from
  [Scheduled run](#the-scheduled-run-each-tick-headless) below, with
  `<EFFORT_NAME>`, `<AGENT_LABEL>`, and `<CWD>` filled in with the validated
  values. Do not paraphrase it.

### Step 4 — Run the first tick immediately

Do not wait ~5 minutes for the automation's first fire. Right after creating
it, run one tick now, in this session: follow the
[Scheduled run](#the-scheduled-run-each-tick-headless) flow below exactly as
the automation prompt will, with `<EFFORT_NAME>`, `<AGENT_LABEL>`, and `<CWD>`
filled in with the validated values. If there is no open task, the tick does
nothing — that is fine; the recurring automation will pick up future tasks.

### Step 5 — Report and tell the user how to stop it

Report plainly: the effort (name + id), the agent label, the cwd, that the
automation is recurring every 5 minutes, and that the first tick has already
run — report its outcome (a worker was spawned for task X, or that no open task
was found). **Tell the user how to stop it:** the automation persists until
deleted; they can list automations (`CronList`) and delete the job by id
(`CronDelete`), or ask you to stop it. Also remind them the spawned worker CLI
must stay logged in (`zcode login` / `kimi login`) for ticks to do real work.

---

## The scheduled run (each tick, headless)

> The text below is the run. The setup step pastes a filled-in copy of this
> block into the automation's `prompt`. **Keep it self-contained** — a headless
> run cannot ask the user anything mid-tick, and must not chain to sibling
> skills (it *spawns* a worker that runs `lc-start-work`; it does not load that
> skill itself). If a tick finds no open task, it does nothing and exits.

You are a LocalCortex delegation gatekeeper. Check the Effort
**`<EFFORT_NAME>`** for an **open** task assigned to the agent labeled
**`<AGENT_LABEL>`**. If there is one, spawn that agent's CLI headless (from the
working directory **`<CWD>`**) with a one-line prompt telling it to run the
`lc-start-work` skill on this effort for this agent. If there is no open task,
do nothing. Work **only one task per tick**. Never touch a task whose `worker`
is not `agent` or whose `worker_label` is not `<AGENT_LABEL>`.

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

### 2. Look for an open task for the agent

```bash
LC_AGENT_LABEL='<AGENT_LABEL>' \
  osascript -l JavaScript "$LC_JS" tasks-by-agent '<EFFORT_ID>'
```

This returns `{ query, count, tasks }` of the agent's **active** tasks. Select
the first one whose `status` is `"open"` (sort by `order`, then `created_at`).
If there is no `open` task — `count` is 0 or every task is `in_progress` /
`blocked` — **there is nothing to do this tick; stop here.** Do not touch a
task another worker already started (`in_progress`); it is not yours.

### 3. Confirm the agent label is a supported spawn target

Read the chosen task's `worker_label`. It must be one of:

- `zcode`
- `kimi`

Any other label → **do not spawn; stop.** (Extending this table is how new
agents get supported.)

### 4. Build the worker prompt

The worker prompt is the same one sentence for both agents (fill in the
validated effort name and agent label):

> Use the lc-start-work skill to do one task's worth of work on the
> `<EFFORT_NAME>` effort for the `<AGENT_LABEL>` agent. You are running
> headless; make reasonable assumptions and do not ask questions.

That's the entire prompt — `lc-start-work` does the claim, the work, the
artifact writing, and the completion itself.

### 5. Spawn the worker (blocking)

Spawn exactly one worker and **wait for it to finish**. One task per tick; do
not background it. Use the command for the task's `worker_label`:

**If `worker_label` is `zcode`** — zcode's CLI bundle is built for Electron's
Node, so it must run under the Electron binary as Node with `app.asar` on
`NODE_PATH` (plain `node` cannot resolve `@zcode/*`):

```bash
ELECTRON_RUN_AS_NODE=1 \
  NODE_PATH="/Applications/ZCode.app/Contents/Resources/app.asar" \
  "/Applications/ZCode.app/Contents/MacOS/ZCode" \
  "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" \
  --prompt "<worker prompt>" --cwd "<CWD>" --mode yolo
```

**If `worker_label` is `kimi`** — `kimi` is on `PATH` (`~/.kimi-code/bin/kimi`)
and has **no `--cwd` flag**, so set the working directory with `cd`. Use `-p`
prompt mode only — it is already non-interactive and auto-approves tool calls on
its own, so do **not** add `-y`/`--yolo` or `--auto`: on kimi ≥ 0.34.0 those
flags are rejected when combined with `-p`.

```bash
cd "<CWD>" && kimi -p "<worker prompt>"
```

Report the spawn's pass/fail by its exit code:

- **Exit 0** → the worker finished (it claims, works, and completes the task on
  its own via `lc-start-work`). Nothing more for this tick to do.
- **Non-zero exit** → the worker failed. **Do not retry in this tick**, and do
  not complete anything yourself — the task is still `open` (or `in_progress`
  if the worker crashed mid-work), and the next tick will reconsider it. If the
  worker claimed it then crashed, it is `in_progress` and step 2 above will
  correctly skip it on subsequent ticks (only `open` tasks trigger a spawn); a
  human can reopen it if needed.

If the spawn command itself is rejected (e.g. an unknown flag on a different
build), check the worker CLI's `--help` for the exact headless flags on that
version before the next tick — zcode/kimi flag names can vary across builds.

### 6. One task per tick

After spawning one worker, **stop**. Do not loop to the next open task in the
same tick — the next tick (within ~5 minutes) will pick it up. This keeps each
run bounded and the automation easy to reason about.

### Worker prompt

The single-sentence instruction passed to the spawned worker (shown here for
reference; step 5 fills it in):

```
Use the lc-start-work skill to do one task's worth of work on the '<EFFORT_NAME>' effort for the '<AGENT_LABEL>' agent. You are running headless; make reasonable assumptions and do not ask questions.
```

### Notes for the run

- **Headless means no questions.** The gatekeeper never asks the user anything
  mid-tick; if the effort can't be resolved or no task is open, it exits
  silently. The spawned worker is likewise told to run headless.
- **Fail safe.** If a spawn fails, leave things as they are and stop. Do not
  complete a task on the worker's behalf. The next tick (or a human) picks it
  up.
- **One task per tick.** Spawn at most one worker per tick. The 5-minute cadence
  bounds throughput deliberately.
- **Login is a prerequisite, not a tick concern.** If a spawn fails because the
  worker isn't logged in, the tick can't fix it; surface it in the tick's
  output and stop. The user must run `zcode login` / `kimi login` separately.

---

## Reporting to the user

At setup, report the effort (name + id), the agent label, the cwd, the schedule
(every 5 minutes, recurring), the outcome of the first tick (already run at
setup), and **how to stop it** (list with `CronList`, delete by id with
`CronDelete`). During the scheduled run there is no user to report to; the
tick's stdout/stderr is all the trace there is.
