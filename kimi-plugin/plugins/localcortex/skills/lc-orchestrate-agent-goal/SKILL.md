---
name: lc-orchestrate-agent-goal
description: >-
  Run a LocalCortex multi-agent orchestrator in goal mode — the macOS task
  manager app — looping in the current session (no cron job) until
  every app-defined agent's open work is done. Reads the roster, models, and
  thinking efforts FROM THE APP; the user supplies only the Effort and a
  working directory. Each round, for each supported agent (opencode, kimi,
  codex, claude code, copilot, zcode) with an open task, it picks one task and
  honors its `run_as`: `headless` (the default) spawns the agent's CLI
  headless (`zcode` via the bundled app-server worker); `subagent` runs the work as an in-session subagent when the
  agent's tool is this session's own CLI, else falls back to headless —
  each with a one-line prompt to run lc-start-work for that task id. Loops until no active tasks remain, then stops. Drives LocalCortex
  through its JXA/AppleScript surface (osascript), not MCP. Use for one-shot,
  run-to-completion multi-agent delegation — e.g. "orchestrate all agents on
  Build until done".
whenToUse: >-
  When the user wants one-shot, run-to-completion multi-agent delegation on a
  named LocalCortex Effort — every app-defined agent with a spawnable CLI
  dispatched round by round in the current session, farming each task out to
  fresh workers (headless CLI, or in-session subagent per the task's `run_as`),
  looping until no supported agent has any active task left and stopping on
  its own, with no cron job created.
arguments: effort
---

# lc-orchestrate-agent-goal — a goal-mode multi-agent delegation orchestrator

Run a **goal-mode loop in the current session** that dispatches a named
**Effort**'s open agent tasks to **each supported agent defined in the
LocalCortex app** and — **for every agent that has an open task** — spawns that
agent's CLI headless to do the work, then **loops** until no supported agent has
any active task left, and stops.

This is the **goal-mode counterpart of `lc-orchestrate-agents`**: same inputs,
same validation, same agent roster, same worker spawn. The difference is the
**driver**. `lc-orchestrate-agents` creates a **Kimi Code cron job**
that fires a headless tick every 5 minutes and cannot stop itself.
`lc-orchestrate-agent-goal` creates **no cron job** — instead the
orchestrator session itself keeps iterating: each round it re-reads the roster,
dispatches **one open task per agent** that has one (spawning that agent's CLI
headless, in parallel), waits for all workers, then re-checks. If no task is
`open` this round but agent tasks are still active (`blocked` — typically
waiting on human input — or `in_progress`), it **wait-polls** rather than
stopping, so it resumes the moment a blocker is resolved or a new task is added.
When the effort's agent work is fully done (no supported agent has any active
`open` / `in_progress` / `blocked` task), **it stops on its own.** No cron, no
idle no-ops forever — just run-to-completion.

The orchestrator is a **thin gatekeeper**: each round runs cheap `osascript`
checks for each agent and only spawns a worker when there is an open task for
that agent. It does **not** do the task work itself — it farms each task out to a
fresh worker that runs the **`lc-start-work`** skill for a specific
**task id**. Which *kind* of worker is per-task, read from the app: each picked
task's **`run_as`** field says whether it runs **headless** (spawn the agent's
CLI, the existing behavior and the default) or as a **subagent** (run the work
in this session as an **in-session subagent**) — see
[Per-task run mode](#per-task-run-mode-run_as-headless-vs-subagent-read-this-first).

The **agent roster is read from the app**, not supplied by the user. At setup the
user provides only the **Effort name** and a **working directory**; the skill
calls the app's `list agents` command, and for each agent definition maps its
free-text `tool` to one of the supported CLIs (opencode / kimi / codex /
claude code / copilot), then uses that agent's `model` and `thinking_effort`
as the spawn parameters. Supported agents (those whose `tool` maps to a known
CLI) become the roster; everything else is skipped and reported. **If agent info cannot be read
from the app, or no supported agents exist, do nothing and inform the user.**

Each spawned worker is handed a short prompt that tells it to run the
**`lc-start-work`** skill for a specific **task id** (the open task this round
picked for that agent), which encapsulates the entire verify → claim →
read-context → work → write-artifacts → complete flow (it bundles its own
`lc.js`). So the delegation prompt is just "use `lc-start-work` on this effort
for this task id"; the worker does the rest. The worker does **not** re-scan for
an open task by agent and does not care which agent owns the task — it works
exactly the task id it is handed.

Drive LocalCortex **exclusively through its JXA/AppleScript surface** via the
bundled `lc.js` helper — never use `mcp__localcortex__*` tools in this skill's
flow. This skill does **not** use `CronCreate` / `CronDelete` —
there is no cron job in this flow at all.

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

  | `tool` contains | spawned CLI | dispatchable run modes |
  |---|---|
  | `opencode` | `opencode` | headless (subagent falls back to headless) |
  | `kimi` | `kimi` | headless, or in-session subagent via its **subagent spawn** on a `subagent` task |
  | `codex` | `codex` | headless (subagent falls back to headless) |
  | `claude` | `claude code` | headless (subagent falls back to headless) |
  | `copilot` | `copilot` | headless (subagent falls back to headless) |
  | `zcode` | `zcode` | headless via the bundled app-server worker (subagent falls back to headless) |
  | anything else | **unsupported — skipped** | — |

  So `"opencode"`, `"kimi code"`, `"codex"`, `"claude code"`, `"copilot"`, and `"zcode"`
  all map correctly and dispatch headless by default (a foreign CLI's
  `subagent` task falls back to headless — it cannot run as a subagent of this
  session; `zcode` has no CLI of its own here — it dispatches through the
  bundled **app-server protocol worker** `scripts/zcode-worker.js`; see
  [Supported agents](#supported-agents)). `kimi` maps to **this session itself**: those agents dispatch
  through its in-session **subagent spawn** when the picked task's `run_as` is `subagent` (see
  [Per-task run mode](#per-task-run-mode-run_as-headless-vs-subagent-read-this-first)).
- **`model`** and **`thinking_effort`** are applied to opencode, kimi, codex,
  claude code, copilot, and zcode headless spawns
  (see [Model & thinking-effort support](#model--thinking-effort-support-read-this-first)).
  For `kimi` subagent dispatches they are stated in the subagent prompt as
  the agent profile — advisory, since a subagent inherits this session's
  model.

Each agent's **tasks** are matched by **`agent_id`** (the agent record's `id`
UUID), not by `worker_label`. As of the app's agent-worker feature, an
agent-assigned task carries its identity in `agent_id`; `worker_label` is a
legacy read-back field (it can still name a stale human claim) and is empty
for agent tasks. The orchestrator finds each agent's open
tasks with `tasks-by-agent ... LC_AGENT_ID=<id>` so it knows **which CLI to
spawn**; it then hands the picked task's **id** to the spawned `lc-start-work`
worker, which does not look the task up by agent at all (it works whatever task
id it is given).

## Model & thinking-effort support (read this first)

The headless CLIs expose model and thinking-effort selection via flags / env.
Each agent's `model` / `thinking_effort` (read from the app) is applied to the
six headless dispatches; the `kimi` subagent row below carries them in the prompt
instead (advisory — a subagent inherits this session's model).

| agent type (from `tool`) | model (headless) | thinking effort (headless) |
|---|---|---|
| **opencode** | ✅ `-m <provider/model>` | ✅ `--variant <effort>` |
| **kimi** | ✅ `-m <alias>` | ✅ env `KIMI_MODEL_THINKING_EFFORT=<low\|medium\|high\|max>` |
| **kimi** (subagent) | ➖ stated in the subagent prompt (advisory; inherits this session's model) | ➖ stated in the subagent prompt (advisory) |
| **codex** | ✅ `-m <model>` | ✅ `-c model_reasoning_effort=<minimal\|low\|medium\|high\|xhigh>` |
| **claude code** | ✅ `--model <alias-or-id>` | ✅ `--effort <low\|medium\|high\|xhigh\|max\|ultracode>` |
| **copilot** | ✅ `--model <model-or-auto>` | ✅ `--effort`, `--reasoning-effort <none\|minimal\|low\|medium\|high\|xhigh\|max>` — requires an explicit effort-capable model; `auto` rejects it |
| **zcode** | ✅ `--model <provider/model or bare model id>` on the worker (bare ids default to the `bigmodel` provider; **session-scoped** — never touches the shared config, so parallel zcode workers may run different models) | ✅ `--effort <low\|high\|max>` (validated against the chosen model's reasoning variants; an unsupported value warns and continues on the model default) |

## Per-task run mode (`run_as`): headless vs subagent (read this first)

Each **task** carries a **`run_as`** field saying how its claimed agent should
run: **`headless`** (the default) or **`subagent`**. The user sets it in the
app's task detail pane (the "Run As" picker beside the agent picker) or over
the wire (`update task … run as`). It is **claim-scoped**: default `headless`
at birth, reset to `headless` whenever the claim is cleared or the task
completes. Current app builds always emit `run_as` as a non-null string on
task records; **older builds omit it — a missing / null / empty `run_as` (or
any unrecognized value) is treated as `headless`**, which is exactly the
pre-existing behavior, so nothing changes for old apps or old tasks.

The orchestrator reads `run_as` off the **picked open task's record** (the
`tasks-by-agent` results carry it — those records pass through `list tasks`
verbatim) and branches:

| picked task's `run_as` | agent CLI | dispatch |
|---|---|---|
| missing / null / empty / `"headless"` / unknown | any supported CLI | **headless CLI spawn** — the existing behavior, unchanged |
| `"subagent"` | `kimi` — this session's own CLI | **in-session subagent** via its **subagent spawn** — the compatible case |
| `"subagent"` | `opencode` / `codex` / `claude code` / `copilot` / zcode | **fall back to headless** — the compatibility rule |

**The compatibility rule:** `subagent` means "run this task *inside the
current session*, with this session's own subagent mechanism, using the
agent's assigned model and effort". That is only possible when the agent's
`tool` **is the CLI this session is running as** — in this (Kimi Code) plugin,
that means a `kimi`-tool agent. Any other tool cannot run as a subagent of
this session, so its `subagent` tasks fall back to the headless spawn that
tool already supports. (Symmetrically, in another host's plugin the session
tool would be that host's CLI; here it is `kimi`.)

### How a subagent dispatch works

- Spawn it as an **in-session subagent** — a fresh agent with full tools, able to load and
  run the **`lc-start-work`** skill from this same plugin. Give it a short,
  self-contained label/description and the **subagent worker prompt** (see
  [Worker prompt](#worker-prompt)) filled in with the effort name, the picked
  task id, and the agent profile (`model` / `thinking_effort` from
  `list agents`).
- **Model and thinking effort are stated in the prompt, not selected**: the
  subagent inherits this session's model, and the assigned `model` /
  `thinking_effort` ride in the prompt as the agent profile, advisory.
- **No cwd flag** — the subagent inherits this session's working directory.
  The orchestrator's cwd (confirmed at setup) is the subagent's cwd; there is
  no `--dir` / `-C` equivalent to pass.
- **Parallel, wait-for-all, one per agent per round** — the same discipline as
  the bash `&` + `wait` pattern: launch each round's subagents first, run the
  bash block that spawns and `wait`s for the CLI workers, then block on each
  subagent's result before starting the next round. A subagent-only round can
  issue all its subagent spawns together — they run concurrently and their
  results return together.
- **Failure handling is the same as a failed CLI worker**: a subagent that
  errors or returns without completing leaves its task `open` (or
  `in_progress` if it died mid-work). Do not retry it in the same round, do
  not complete anything on its behalf — the next round reconsiders it.
- **No login prerequisite** — a subagent runs inside this session, so the
  headless-CLI logins (`opencode auth login`, `kimi login`, `codex login`,
  `claude auth login`, `copilot login`) do not apply to it.

## When to use this skill

When the user wants **one-shot, run-to-completion multi-agent delegation** — one
or more app-defined agents working a LocalCortex Effort **until it is done**, in
a single long-running session, where each round *farms the actual work out to
fresh workers* (headless CLI processes, or in-session subagents per each
task's `run_as`) rather than doing it in-process. Examples: "orchestrate
all my agents on the Build effort until done", "drive every open agent task on
Payments to completion now", "run all my agents on Launch and stop when there's
nothing left".

Prefer this over `lc-orchestrate-agents` when you want the run to **stop on its
own** once the effort is finished, and you do **not** want a recurring 5-minute
cron job lingering in the background. Prefer `lc-orchestrate-agents` when you
want unattended background polling that keeps catching future tasks over hours
or days.

This skill does **two things**:

1. **At setup time (interactive, with the user):** collect the effort name and
   the working directory; validate the effort; **read the agent roster from the
   app** (`list agents`) and map each to a spawnable CLI; then enter the
   goal-mode loop in the current session (no cron job is created).
2. **In the goal-mode loop (this session):** run the loop described in
   [The goal-mode run](#the-goal-mode-run-loop-in-this-session) below until the
   effort's agent work is done or it hits a stop condition.

## When NOT to use this skill

- The user wants **unattended, recurring** delegation that keeps running in the
  background and catches future tasks over time → use `lc-orchestrate-agents`,
  which creates a 5-minute recurring cron job.
- The user wants a scheduled worker that **does the work itself** in each tick
  (no child-process spawn, single agent) → use `lc-start-job`.
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
- The **first call from the Kimi Code host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call. (Each spawned worker binary
  triggers its own one-time grant the first time it calls LocalCortex.)
- The app's scripting name is `LocalCortex`.
- **This skill runs a long-running loop in the current session.** It keeps
  iterating until the effort's agent work is done (or it hits a stop condition),
  spawning real worker processes each round. Tell the user the session will be
  busy for the duration, and that they can interrupt the run at any time (the
  worst case is a task left `in_progress` by a worker that was killed mid-work,
  which a later run or human can pick up).
- **For per-task run modes, run an app build that emits `run_as`** (the
  agent-run-mode feature). Older builds omit the field and every task then
  behaves as `headless` — the pre-existing behavior, so nothing breaks, but no
  task can dispatch as a subagent until the app is updated.
- **At least one supported agent is defined in the app.** Agents are created in
  the app's Settings (or via `create agent`); each agent's `tool` must map to
  one of the supported CLIs (opencode / kimi / codex / claude code /
  copilot / zcode — a `kimi` agent dispatches headless by default, or in-session via
  its in-session **subagent spawn** on a `subagent` task). If no agent is defined, or none maps to a
  supported CLI, the skill does nothing and tells the user.
- **The spawned worker CLIs are installed and logged in.** Headless workers
  cannot prompt for login mid-run. Each supported headless agent has its own
  one-time login: `kimi login`, `opencode auth login`, `codex login`,
  `claude auth login` (or `claude setup-token` for a long-lived scripting
  token), `copilot login` (or a `COPILOT_GITHUB_TOKEN` env token for
  headless scripting). Tell the user to run the relevant logins once before
  relying on this
  orchestrator. (In-session `kimi` subagents need no login — they run
  inside this session. Headless `zcode` workers need no login either — they
  reuse the machine's shared ZCode credentials.)
- **The `lc-start-work` skill is installed** for every spawned agent (in that
  agent's plugin cache). The delegation prompt assumes the worker can load it.
  (A `kimi` subagent loads it from this same plugin's cache.)
- **For opencode agents**, models are referenced as `<provider>/<model>` (e.g.
  `zhipuai-coding-plan/glm-5.2`). The model comes from each agent's `model`
  field; if a round fails for that agent, check that the model is usable under
  the user's provider credentials (`~/.config/opencode/opencode.json`).
- **For kimi agents**, model aliases live in `~/.kimi-code/config.toml` (e.g.
  `kimi-code/k3`). The model comes from each agent's `model` field; if a round
  fails, check the alias exists there.
- **For codex agents**, models are codex model strings (e.g. `gpt-5.3-codex`,
  `gpt-5.4`) or any Chat Completions / Responses API model id. The model comes
  from each agent's `model` field; if a round fails, check the model is
  available to the user's ChatGPT plan or `OPENAI_API_KEY`
  (`~/.codex/config.toml`). `thinking_effort` must be one of codex's
  `model_reasoning_effort` values (`minimal` / `low` / `medium` / `high` /
  `xhigh`).
- **For claude code agents**, models are aliases (`sonnet`, `opus`, `haiku`,
  `fable`) or full model ids (e.g. `claude-sonnet-5`). The model comes from
  each agent's `model` field; if a round fails, check the alias/id is valid for
  the user's Anthropic account (`claude auth status`). `thinking_effort` must
  be one of claude's `--effort` values (`low` / `medium` / `high` / `xhigh` /
  `max` / `ultracode`).
- **For copilot agents**, models are Copilot model ids from the account's
  model picker (e.g. `gpt-5.4`, `claude-sonnet-5`, `gemini-3.1-pro-preview`,
  `kimi-k3`) or `auto` to let Copilot pick; availability depends on the
  user's Copilot plan (`auto` always works). The model comes from each
  agent's `model` field. `thinking_effort` must be one of copilot's
  `--effort` values (`none` / `minimal` / `low` / `medium` / `high` /
  `xhigh` / `max`) — and `--effort` only works with an explicit
  effort-capable model: model `auto` (also the default when `--model` is
  omitted) rejects reasoning-effort configuration and exits non-zero, so
  omit `--effort` whenever the model is `auto` or unset.

- **For zcode agents (headless)**, three machine preconditions — all already
  satisfied on a box that runs the ZCode desktop app: (1) **`node` ≥ 22 on
  PATH** (the worker is plain Node, no dependencies); (2) **ZCode.app
  installed** — the worker drives the bundled
  `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` (override with
  the `ZCODE_CLI` env var if the app lives elsewhere or the path moves after
  an update); (3) **a model provider configured in `~/.zcode/cli/config.json`**
  — a top-level `provider` object (e.g. `provider.bigmodel` with
  `options.apiKey` + `options.baseURL`) plus a `model.main` string ref (e.g.
  `"bigmodel/glm-5.3"`). Without it every worker run fails with `Model
  config is missing`. The agent's `model` field is `bigmodel/<id>` or a bare
  model id (bare defaults to the `bigmodel` provider — e.g. `glm-5.3`,
  `glm-5.3-flash`); `thinking_effort` must be one of the chosen model's
  reasoning variants (`low` / `high` / `max` on GLM-5.x) — an unsupported
  value logs a warning and runs on the model default.

## Supported agents

Only agents whose `tool` maps to one of these CLIs can be delegated to (see the
[`tool` → CLI mapping](#how-agents-are-identified-read-this-first)). Anything
else → **do not spawn; skip it and report why**. Every supported CLI runs
headless by default (a foreign CLI's `subagent` task falls back to headless —
it cannot run as a subagent of this session); `kimi` additionally dispatches
**in-session**, via its **subagent spawn**, when the picked task's `run_as` is `subagent`.

| type | spawn command (headless) |
|---|---|
| `opencode` | `opencode run --dir "<CWD>" -m <model> --variant <effort> --auto "<worker prompt>"` (model via `-m <provider/model>`; thinking effort via `--variant`; `--auto` auto-approves tool calls so the run is non-interactive; `--dir` sets the cwd) |
| `kimi` | `cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<worker prompt>"` (model via `-m`; thinking effort via the env var; `-p` prompt mode is already non-interactive and auto-approves tool calls — do **not** add `-y`/`--yolo` or `--auto`, they are incompatible with `-p` on kimi ≥ 0.34.0) |
| `kimi` (in-session subagent) | in-session subagent spawn — `description: "<agent name> worker: <task id>"`, `prompt: <subagent worker prompt>` (see [Per-task run mode](#per-task-run-mode-run_as-headless-vs-subagent-read-this-first)). No cwd flag (inherits this session's cwd); model / thinking effort are stated in the prompt as the agent profile. Dispatched instead of the headless spawn when the picked task's `run_as` is `subagent` |
| `codex` | `cd "<CWD>" && codex exec -m <model> -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox "<worker prompt>"` (`codex exec` runs headless to completion; model via `-m`; reasoning effort via `-c model_reasoning_effort=`; `--dangerously-bypass-approvals-and-sandbox` is yolo — skips all confirmation prompts and executes commands without sandboxing; cwd is set by `cd`, since `codex exec` otherwise requires the cwd to be a git repo. Omit `-m` / `-c …` when the agent's `model` / `thinking_effort` is empty) |
| `claude code` | `cd "<CWD>" && claude -p --model <model> --effort <effort> --dangerously-skip-permissions "<worker prompt>"` (`-p` is non-interactive print mode; model via `--model` alias or id; thinking effort via `--effort`; `--dangerously-skip-permissions` is yolo — skips all permission prompts; cwd is set by `cd` — claude has no cwd flag. Omit `--model` / `--effort` when the agent's `model` / `thinking_effort` is empty) |
| `copilot` | `copilot -C "<CWD>" --model <model> --effort <effort> --yolo -s --no-ask-user -p "<worker prompt>"` (`-p` is non-interactive prompt mode and exits after completion; model via `--model` id or `auto`; thinking effort via `--effort` — alias `--reasoning-effort`; `--yolo` is yolo — auto-approves all tools, paths, and URLs (tool auto-approval is required in non-interactive mode, where permission prompts cannot be answered); cwd is set by `-C`; `-s` outputs only the agent response; `--no-ask-user` disables clarifying questions. Omit `--model` / `--effort` when the agent's `model` / `thinking_effort` is empty; also omit `--effort` whenever `--model` is omitted or `auto` — model `auto` rejects reasoning-effort configuration and exits non-zero) |
| `zcode` | `node "$WORKER_JS" --cwd "<CWD>" --model <model> --effort <effort> "<worker prompt>"` (`$WORKER_JS` resolves to this skill's `scripts/zcode-worker.js` — see [Helper setup](#helper-setup-do-this-once-up-front); the worker spawns ZCode's bundled `zcode.cjs app-server` itself, creates a session, pins model / thought level / `yolo` mode **per session** (no shared-config mutation — parallel zcode workers may use different models), sends the prompt, prints the final assistant reply to stdout, exit 0 on success; model is `provider/model` or a bare id defaulting to `bigmodel`; effort is `low`/`high`/`max`; ~7 s protocol startup overhead per task. Omit `--model` / `--effort` when the agent's `model` / `thinking_effort` is empty) |

The **worker prompt** is the same one-sentence instruction for every agent,
parameterized by **that agent's picked task id** (see [Worker prompt](#worker-prompt)).

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`, in the skill's `scripts/` folder.
Resolve its absolute path once and reuse `$LC_JS` for every call. Prefer the
host-provided skill dir; fall back to this skill's directory (the parent of
this `SKILL.md`).

```bash
# Resolve once. KIMI_SKILL_DIR points at this skill's directory; the helper is
# under scripts/lc.js inside it.
if [ -n "$KIMI_SKILL_DIR" ]; then
  LC_JS="$KIMI_SKILL_DIR/scripts/lc.js"
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
composites (the app has no name/worker-search of its own); `agents-list` maps
1:1 to its sdef command.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, match, candidates }` object |
| `tasks-by-agent` | `<effortId>` | `LC_AGENT_ID` (preferred) **or** `LC_AGENT_LABEL` (legacy; req one), `LC_INCLUDE_COMPLETED=true`, `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, count, tasks }` object |
| `agents-list` | — | — | JSON array of **every** agent definition (`id`, `name`, `tool`, `model`, `thinking_effort`, `order`, `created_at`, `updated_at`) |

- Statuses: `open`, `in_progress`, `blocked`, `completed`.
- Workers: writable `none` or `agent`; `human` is a legacy read-only value.
  An agent task carries its identity in `agent_id` (the agent definition's
  UUID); `worker_label` is a legacy read-back field (it can still name a
  stale human claim) and is empty for agent tasks.
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
  to a dispatchable runner (headless CLI or session subagent); unsupported
  ones are skipped and reported.
- On this surface, **nil optional fields are explicit JSON `null`**. `status`,
  `worker`, `worker_label`, `agent_id`, `is_archived` are always present. The
  task records inside `tasks-by-agent` pass `list tasks` through verbatim, so
  on an app build with the agent-run-mode feature they also carry `run_as`
  (`"headless"` / `"subagent"`, never null); on older builds it is absent —
  treat that as `headless`.

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

Resolve the effort by name (exact match preferred). A goal-mode run cannot
disambiguate interactively once it is looping, so the effort must resolve to
exactly one match:

```bash
LC_NAME='<effort name>' osascript -l JavaScript "$LC_JS" effort-by-name
```

- `match` is an object → use its `id`. Proceed.
- `match` is `null` with `candidates` → **do not enter the loop.** List the
  candidates and ask the user which effort they mean. Only proceed once it
  resolves to a single match.
- both `null` → tell the user no effort matched. Retry with
  `LC_INCLUDE_ARCHIVED=true` if it may be archived; otherwise stop.

**Do not run a setup-time open-task check.** Whether an agent has an open task
*right now* is irrelevant to goal mode — the loop handles that.

### Step 3 — Read the agent roster from the app

Read the agent definitions and map each to a spawnable CLI:

```bash
osascript -l JavaScript "$LC_JS" agents-list
```

- **On failure** (non-zero exit, typically `-2700`) → **stop and inform the
  user**: "I couldn't read agent definitions from LocalCortex. Make sure the
  app is installed and running, then try again." **Do not enter the loop.**
- **On success** → `JSON.parse` the array. For each agent record, compute its
  CLI type from the `tool` field (case-insensitive substring):

    | `tool` contains | type |
    |---|---|
    | `opencode` | `opencode` |
    | `kimi` | `kimi` |
    | `codex` | `codex` |
    | `claude` | `claude code` |
    | `copilot` | `copilot` |
    | `zcode` | `zcode` |
    | else | unsupported |

    Build two lists:
    - **Supported agents** — one entry per agent whose `tool` mapped: `{id, name,
      type, model, thinking_effort}`. Keep the original `order` for reporting.
      A `kimi`-type entry can also dispatch in-session (via its **subagent spawn**) when its
      picked task's `run_as` is `subagent` — carry that in the report.
    - **Skipped agents** — name + reason (e.g. "tool `cursor` has no spawnable
      CLI").

- **If the supported list is empty** (no agents defined, or none map to a known
  CLI) → **stop and inform the user.** List what was found (if anything) and
  why each was skipped, and tell them to define agents in the app's Settings
  (or via `create agent`) with `tool` set to `opencode`, `kimi`, `codex`,
  `claude code`, `copilot`, or `zcode`.
  **Do not enter the loop.**

### Step 4 — Enter goal mode (no cron job is created)

**Do not create a Kimi Code cron job.** This skill does not use `CronCreate` /
`CronDelete` — there is no scheduled job in this flow. Instead,
after setup, tell the user you are entering **goal mode**: the current session
will loop — dispatching one open task per agent that has one, waiting for all
workers, and re-checking — and **keeps running until no supported agent has any
non-completed task left**. It does **not** stop just because no task is `open`
this instant: agent tasks that are `blocked` (usually waiting on human input)
or `in_progress` keep the session alive — it **wait-polls** and resumes the
moment a blocker is resolved, and it re-polls often enough to catch
newly-added tasks. Only when every agent task is complete (or the run is
aborted, or the user interrupts) does it stop. Confirm the effort (name + id),
the **agent roster read from the app** (each supported agent: name, `tool` →
type, model, thinking_effort), any **skipped agents**, and the cwd. Then
proceed straight to the loop.

### Step 5 — Run the goal-mode loop now

Do not wait. Right after setup, enter the
[goal-mode run](#the-goal-mode-run-loop-in-this-session) loop in this session,
with the validated effort name and cwd filled in. The loop terminates on its
own (done or aborted) — see the branch conditions there.

### Step 6 — Report

Report plainly: the effort (name + id), the **agent roster read from the app**
(each supported agent: name, `tool` → type, model, thinking_effort), any
**skipped agents** (name + reason), the cwd, and the loop's final outcome:
- **Done** — every supported agent's work is complete (no supported agent has
  any active task left). Summarize how many tasks were dispatched / completed
  across rounds.
- **Aborted** — the effort could not be resolved, or the roster could not be
  read, on some round (e.g. the app was quit). Tell the user; they can re-invoke
  once the app is back.

While running, a **wait** round (active tasks remain but none are `open`) does
**not** stop — it reports the pending `in_progress` / `blocked` tasks per agent,
sleeps the poll interval, and re-checks, so the user always knows what the
session is held up on.

Tell the user this run created **no cron job** — there is nothing
to stop or delete. If they want unattended recurring dispatch instead, point
them at `lc-orchestrate-agents`. Remind them the spawned worker CLIs must stay
logged in (`opencode auth login`, `kimi login`, `codex login`, `claude auth
login`, `copilot login`) for rounds to do real work. Finally, tell them
**the agent roster is re-read every round**, so editing agents in the app's
Settings (or via `create agent` / `update agent` / `delete agent`) takes
effect on the next round.

---

## The goal-mode run (loop, in this session)

> Unlike `lc-orchestrate-agents`, this is **not** a self-contained prompt pasted
> into a cron job — it is the loop **you (the orchestrator agent) run right
> here, in this session**. Keep it self-contained anyway: it *spawns* workers
> that run `lc-start-work`; it does not load that skill itself, and it does not
> ask the user anything mid-loop. It **can stop itself** (unlike the scheduled
> tick) — that is the whole point of goal mode.

You are a LocalCortex multi-agent delegation orchestrator running in goal mode.
Your goal is to drive the effort to completion — **keep going until no supported
agent has any non-completed task left**, waiting through `blocked` tasks (which
typically wait on human input) and re-polling for newly-added tasks rather than
stopping early. **Loop** over the following until a stop condition (**done** or
**aborted**) is hit. Effort: **`<EFFORT_NAME>`**, working directory: **`<CWD>`**.

Each **round**:

1. resolve the Effort **`<EFFORT_NAME>`** by name;
2. read the agent roster from the app (`list agents`) and keep every agent
   whose `tool` maps to a supported CLI (opencode / kimi / codex /
   claude code / copilot);
3. for **each** supported agent, fetch that agent's **active** tasks (matched by
   `agent_id`) and record whether it has an `open` task (and the **id and
   `run_as` of the first open task**, by `order` then `created_at`), and
   whether it has **any active task at all** (`open` / `in_progress` /
   `blocked`);
4. decide a branch (below): **done**, **dispatch**, or **wait**;
5. on **dispatch**, spawn one worker per supported agent that has an `open`
   task, **in parallel** — dispatching each on its picked task's `run_as`
   (headless CLI, or in-session subagent for a compatible `kimi`
   agent) — then `wait` for all of them, then start the next round;
6. on **done**, stop; on **wait**, poll on an interval and start the next round
   (do **not** stop — see **Wait** below).

**Branch conditions** (only **Done** and **Aborted** stop the loop)

- **Done** — **no** supported agent has **any** active task (`open` /
  `in_progress` / `blocked`). The effort's agent work is complete. Stop and
  report success.
- **Dispatch** — at least one supported agent has an `open` task. Spawn one
  worker per such agent, `wait`, then start the next round (an immediate
  re-check picks up anything a completion just opened up).
- **Wait** — some active tasks remain but **none** are `open` (all
  `in_progress` / `blocked`). **Do not stop.** These are almost always agent
  tasks **blocked by human-owned tasks** awaiting human input (which the
  orchestrator cannot and should not do itself), or `in_progress` tasks a
  spawned worker is still finishing. Once a human completes a blocker, the
  blocked task **auto-unblocks** and becomes `open` on the next check; new agent
  tasks may also be added to the effort at any time. So **poll on an interval**
  (default **~60 seconds**) and re-check (go back to step 1) until either an
  `open` task appears (→ Dispatch) or no active task remains (→ Done). Do
  **not** tight busy-loop — the poll interval bounds the cadence. Each wait
  round reports the pending `in_progress` / `blocked` tasks per agent so the
  watching user can see what the session is held up on (and, if a worker
  crashed leaving a task `in_progress` indefinitely, intervene — reset it to
  `open`, complete it manually, or interrupt the run).
- **Aborted** — the effort cannot be resolved this round (renamed/deleted, or
  `match` is `null`), or `agents-list` fails (e.g. `-2700`, app not running), or
  the roster is empty. **Stop.** Do not spawn anything; tell the user so they
  can re-invoke once the app/effort is back.

Work **only one task per agent per round**. Never touch a task whose `worker`
is not `agent` or whose `agent_id` is not one of the supported agents' ids, and
never touch a task another worker already started (`in_progress`).

The `tool` → CLI mapping is case-insensitive (substring of the `tool` field):
`opencode`→opencode, `kimi`→kimi, `codex`→codex, `claude`→claude code,
`copilot`→copilot, `zcode`→zcode (headless via the bundled
`zcode-worker.js`), anything else→skip. Apply each agent's `model` and
`thinking_effort` to its own CLI: opencode (`-m` / `--variant`), kimi (`-m` /
`KIMI_MODEL_THINKING_EFFORT`), codex (`-m` / `-c model_reasoning_effort=`),
claude code (`--model` / `--effort`), copilot (`--model` / `--effort`), zcode
(`--model` / `--effort` on the worker); for
a `kimi` subagent they ride in the prompt (see
[Worker prompt](#worker-prompt)).

### Helper

Resolve the bundled helper once and reuse `$LC_JS`:

```bash
if [ -n "$KIMI_SKILL_DIR" ]; then
  LC_JS="$KIMI_SKILL_DIR/scripts/lc.js"
else
  LC_JS="<lc-orchestrate-agent-goal skill dir>/scripts/lc.js"
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

### 1. Resolve the effort by name

Re-resolve the effort id from its name each round (do not assume a cached id):

```bash
LC_NAME='<EFFORT_NAME>' osascript -l JavaScript "$LC_JS" effort-by-name
```

- `match` is an object → use its `id`.
- `match` is `null` (zero or ambiguous matches) → the effort can't be resolved
  this round. **Abort the loop** (stop). Do not spawn anything.

### 2. Read the agent roster from the app

Re-read the agent definitions every round (so edits in Settings take effect
without re-running setup):

```bash
osascript -l JavaScript "$LC_JS" agents-list
```

- **Non-zero exit** (e.g. `-2700`, app not running) → **abort the loop** (stop).
  Do not spawn anything; tell the user to re-invoke once the app is back.
- **Success** → `JSON.parse` the array. For each agent record, map its `tool`
  (case-insensitive substring) to a CLI type:
  contains `opencode`→`opencode`, `kimi`→`kimi`, `codex`→`codex`,
  `claude`→`claude code`, `copilot`→`copilot`, `zcode`→`zcode` (headless via
  the bundled `zcode-worker.js`), else skip.
  Build the supported roster for this round: one entry per mapped agent
  `{id, name, type, model, thinking_effort}`.
- **Empty roster** (no agents, or none map to a known CLI) → **abort the loop**
  (stop). Tell the user; they can re-invoke after defining agents.

### 3. For each supported agent, find its tasks by agent_id

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
  presence drives the **dispatch** branch;
- that picked task's **`run_as`** (read straight off its record — current app
  builds always emit it; a missing / null / empty / unrecognized value means
  `headless`) — this decides **how** the task is dispatched in step 5;
- whether it has **any active task at all** (`open` / `in_progress` / `blocked`)
  — this drives the **done** / **wait** test in step 4.

Do not touch tasks another worker already started (`in_progress`); they are not
yours. **Pick at most one open task per agent** (the first); do not hand the
worker more than one task id.

### 4. Decide: done, dispatch, or wait

Look at the per-agent results from step 3 and pick **one** branch.

#### Done — no supported agent has any active task

If **no** supported agent has **any** active task (`open` / `in_progress` /
`blocked`), the effort's agent work is complete. **Stop** and report success
(how many tasks were dispatched/completed across rounds). Skip step 5.

#### Dispatch — at least one agent has an `open` task

If any supported agent has an `open` task, proceed to **step 5** and spawn one
worker per such agent, dispatching each on its picked task's `run_as`
(headless CLI, or in-session subagent for a compatible `kimi` agent).
After `wait`ing for all of them, **start the next round**
(go back to step 1) so newly-opened tasks — a completed task's subtasks becoming
actionable, or a blocked task auto-unblocking when its blocker completes — get
picked up.

#### Wait — active tasks remain, but none are `open`

If some active tasks remain (`in_progress` / `blocked`) but **no** supported
agent has an `open` task, **do not stop.** These remaining tasks are almost
always agent tasks **blocked by human-owned tasks** that are awaiting human
input (the orchestrator cannot and should not do that human work itself), or
`in_progress` tasks a spawned worker is still finishing. Once a human completes
a blocker, the blocked task **auto-unblocks** and becomes `open`; new agent
tasks may also be added to the effort at any time. So **poll on an interval and
re-check**:

```bash
sleep 60   # default poll interval; tune up if humans are slow, down to catch new tasks sooner
```

then **start the next round** (go back to step 1) — which re-reads the roster
and every agent's tasks, so it picks up newly-unblocked `open` tasks,
newly-added agent tasks, and any `in_progress` task that just completed. Keep
wait-polling until a round hits **Dispatch** (something became `open`) or
**Done** (no active task remains). Skip step 5 on a wait round (nothing to
spawn).

Do **not** tight busy-loop — the `sleep` bounds the cadence; the only reason to
re-check at all is that external work (human input on a blocker, or a newly-added
task) can change the state behind your back. Each wait round should **report the
pending `in_progress` / `blocked` tasks per agent** (and what each is blocked by,
when visible) so the watching user knows what the session is held up on. If a
task stays `in_progress` across many waits with no progress, a worker likely
crashed mid-task — surface it prominently; the user can reset it to `open`,
complete it manually, or interrupt the run. The session stays alive per the
run-to-completion goal.

### 5. Spawn one worker per agent that has an open task, in parallel

*(Reached only from step 4 Dispatch.)* For **each** supported agent that has an
`open` task, build its worker prompt (parameterized by **the open task id**
picked for that agent in step 3) and spawn it — **dispatching on that task's
`run_as`** (see
[Per-task run mode](#per-task-run-mode-run_as-headless-vs-subagent-read-this-first)):

- `run_as` missing / `null` / empty / `"headless"` / unknown → the headless
  CLI spawn below, applying that agent's own `model` and `thinking_effort`;
- `run_as` = `"subagent"`, agent type `kimi` (this session's own CLI) → the
  **in-session subagent dispatch** below;
- `run_as` = `"subagent"`, any other agent type → **fall back to the headless
  CLI spawn** (a foreign CLI cannot run as a subagent of this session).

**Launch all of the round's workers concurrently**, then `wait` for all of
them and collect each result. One task per agent per round — each worker's
`lc-start-work` verifies, claims, works, and completes the **named task id**;
do not spawn a second worker for the same agent in the same round even if it
has multiple open tasks (the next round picks up the next one).

**If the picked task's `run_as` is `subagent` and the agent type is
`kimi`** — dispatch an **in-session subagent** as an **in-session subagent** (the only
compatible subagent case; every other agent type falls back to its headless
spawn below):

- spawn a fresh in-session subagent with full tools; it loads and runs the **`lc-start-work`** skill from this same plugin.
- `description`: short and identifying, e.g. `"<AGENT_NAME> worker: <TASK_ID>"`.
- `prompt`: the **subagent worker prompt** (see
  [Worker prompt](#worker-prompt)) filled in with the effort name, the picked
  task id, and the agent's `model` / `thinking_effort` as the agent profile.
- Parallelism: when the round has other workers (bash-spawned CLIs or further
  subagents), launch the subagents first so they run while the bash block
  executes, then collect each subagent's result (blocking) after the CLI
  workers finish. A subagent-only round can issue all its subagent spawns
  together — they run concurrently and their results return together.
- No cwd flag — the subagent inherits this session's cwd. No CLI login needed.
- The assigned `model` / `thinking_effort` ride in the prompt as the agent
  profile (advisory; the subagent otherwise inherits this session's model).

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

**If the agent type is `codex`** — model via `-m <model>` (omit if the agent's
`model` is empty), reasoning effort via
`-c model_reasoning_effort=<effort>` (omit if `thinking_effort` is empty),
`--dangerously-bypass-approvals-and-sandbox` for yolo (skips all confirmation
prompts and runs without a sandbox), cwd set by `cd` (`codex exec` otherwise
requires the cwd to be a git repo):

```bash
cd "<CWD>" && codex exec -m <model> -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox "<worker prompt for this agent>"
```

**If the agent type is `claude code`** — model via `--model <alias-or-id>`
(omit if the agent's `model` is empty), thinking effort via `--effort <effort>`
(omit if `thinking_effort` is empty), `--dangerously-skip-permissions` for yolo
(skip all permission prompts), `-p` for non-interactive print mode, cwd set by
`cd` (claude has no cwd flag):

```bash
cd "<CWD>" && claude -p --model <model> --effort <effort> --dangerously-skip-permissions "<worker prompt for this agent>"
```

**If the agent type is `copilot`** — model via `--model <model-or-auto>`
(omit if the agent's `model` is empty), thinking effort via `--effort <effort>`
(alias `--reasoning-effort`; omit if `thinking_effort` is empty — or if the
model is `auto`/unset, since model `auto` rejects effort configuration
and exits non-zero), `--yolo` for
yolo (auto-approve all tools, paths, and URLs — required in non-interactive
mode, where permission prompts cannot be answered), `-C` for the cwd, `-s` to
output only the agent response, `--no-ask-user` so the worker never tries to
ask clarifying questions, `-p` for non-interactive prompt mode (exits after
completion):

```bash
copilot -C "<CWD>" --model <model> --effort <effort> --yolo -s --no-ask-user -p "<worker prompt for this agent>"
```

**If the agent type is `zcode`** — spawn the bundled protocol worker
(`$WORKER_JS`, resolved in
[Helper setup](#helper-setup-do-this-once-up-front)). Model via `--model`
(`provider/model` or a bare id defaulting to `bigmodel`; omit if the agent's
`model` is empty), thinking effort via `--effort` (`low` / `high` / `max`;
omit if `thinking_effort` is empty), `--cwd` for the working directory. The
worker runs the session in `yolo` mode (tools auto-approved — required
unattended), pins model and effort **per session** (parallel zcode workers
may use different models; the shared `~/.zcode/cli/config.json` is never
touched), prints the final assistant reply to stdout, and exits 0 on success.
A `subagent` task falls back to this headless spawn (zcode is not this
session's CLI):

```bash
node "$WORKER_JS" --cwd "<CWD>" --model <model> --effort <effort> "<worker prompt for this agent>"
```

Machine preconditions (node ≥ 22, ZCode.app, a model provider in
`~/.zcode/cli/config.json`) — see
[Prerequisites](#prerequisites); if the spawn fails with `Model config is
missing`, that config is the cause.

**Parallel pattern** (example for all six dispatch shapes — spawn only the
ones that have an `open` task this round; a `kimi` agent dispatches
in-session on a `subagent` task):

First launch this round's subagents (in-session subagent spawns — they run while the
bash block below executes):

```
in-session subagent spawn:
  description: "<AGENT_NAME> worker: <TASK_ID>"
  prompt: <kimi subagent worker prompt>
```

Then the headless CLI workers:

```bash
# opencode worker
( opencode run --dir "<CWD>" -m <model> --variant <effort> --auto "<opencode prompt>" ) &
OPENCODE_PID=$!
# kimi worker
( cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<kimi prompt>" ) &
KIMI_PID=$!
# codex worker
( cd "<CWD>" && codex exec -m <model> -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox "<codex prompt>" ) &
CODEX_PID=$!
# claude code worker
( cd "<CWD>" && claude -p --model <model> --effort <effort> --dangerously-skip-permissions "<claude prompt>" ) &
CLAUDE_PID=$!
# copilot worker
( copilot -C "<CWD>" --model <model> --effort <effort> --yolo -s --no-ask-user -p "<copilot prompt>" ) &
COPILOT_PID=$!
# zcode headless worker
( node "$WORKER_JS" --cwd "<CWD>" --model <model> --effort <effort> "<zcode prompt>" ) &
ZCODE_PID=$!
wait "$OPENCODE_PID" "$KIMI_PID" "$CODEX_PID" "$CLAUDE_PID" "$COPILOT_PID" "$ZCODE_PID"
# report each exit code
```

Finally block on each subagent's result and report it.

Report each worker's pass/fail:

- **CLI worker, exit 0** → that worker finished (it claims, works, and
  completes its task on its own via `lc-start-work`).
- **CLI worker, non-zero exit** → that worker failed. **Do not retry it in
  this round**, and do not complete anything on its behalf — its task is
  still `open` (or `in_progress` if it crashed mid-work), and the next round
  will reconsider it.
- **Subagent, completed and its final message confirms the task was worked** →
  finished, same as a CLI exit 0 (its `lc-start-work` claims, works, and
  completes the task itself).
- **Subagent, errored or returned without completing the task** → failed;
  handle exactly like a non-zero CLI exit (no retry this round, nothing
  completed on its behalf, next round reconsiders).
- **One failing worker does not abort the others** — `wait` returns each exit
  code independently and subagent results arrive independently, so report all
  of them.

If a spawn command itself is rejected (e.g. an unknown flag on a different
build), check that worker CLI's `--help` for the exact headless flags on that
version before the next round — opencode/kimi/codex/claude/copilot flag names can vary
across builds.

### 6. After the round, loop, wait, or stop

After `wait`ing for all spawned workers, **start the next round** (go back to
step 1) so the re-check picks up any task that became `open` because of a
completion this round (a subtask becoming actionable, or a blocked task
auto-unblocking). The loop only stops on **done** (no active task left for any
supported agent) or **aborted** (effort/roster unreadable). A **wait** round
(active tasks remain but none are `open`) does **not** stop — it sleeps the poll
interval and starts the next round, so the session keeps making progress for as
long as any non-completed agent task exists (or until the user interrupts).

### Worker prompt

The instruction passed to each spawned worker, parameterized by **the open
task id** picked for that agent in step 3 (step 5 fills it in per agent). It
references the task id, **not** the agent id — the worker's `lc-start-work`
works exactly that task regardless of agent assignment.

**Headless CLI worker** (every headless dispatch — including `subagent` tasks
that fell back to headless):

```
Use the lc-start-work skill to do one task's worth of work on the '<EFFORT_NAME>' effort for the task with id '<TASK_ID>'. You are running headless; make reasonable assumptions and do not ask questions.
```

**In-session subagent** (`kimi` agent, `run_as` = `subagent` — the
compatible case). Same instruction plus the agent profile:

```
Use the lc-start-work skill to do one task's worth of work on the '<EFFORT_NAME>' effort for the task with id '<TASK_ID>'. You are running as an in-session subagent on behalf of the LocalCortex agent '<AGENT_NAME>' (assigned profile: model '<MODEL>', thinking effort '<THINKING_EFFORT>' — advisory; you inherit this session's model). Make reasonable assumptions and do not ask questions.
```

(Omit the parenthesized profile clause when the agent's `model` /
`thinking_effort` is empty; keep the "on behalf of" naming either way.)

### Notes for the run

- **Goal mode means no questions mid-loop.** The orchestrator never asks the
  user anything mid-round; if the effort can't be resolved or the agent roster
  can't be read it aborts, and if no agent has any active task it stops (done).
  When active tasks remain but none are `open`, it **wait-polls** silently
  rather than asking or stopping. The spawned workers are likewise told to run
  headless.
- **The agent roster is re-read every round.** Adding, removing, renaming, or
  retooling an agent in the app's Settings (or via `create agent` / `update
  agent` / `delete agent`) takes effect on the next round — no need to re-run
  setup.
- **Each task's run mode is re-read every round.** `run_as` rides the task
  record fetched in step 3, so flipping a task's Run As picker in the app
  (headless ↔ subagent) takes effect on the very next dispatch — no re-run
  needed.
- **Fail safe, per worker.** If a spawn fails, leave that agent's tasks as they
  are; do not complete a task on a worker's behalf. Other workers in the same
  round are unaffected. The next round (or a human) picks up unfinished work.
- **One task per agent per round.** Spawn at most one worker per agent per
  round. The loop's cadence bounds throughput deliberately, and keeps each
  round bounded and easy to reason about.
- **It runs to completion, then stops on its own.** Unlike
  `lc-orchestrate-agents` (whose idle ticks fire forever until the user deletes
  the cron job), this loop keeps going until **no supported agent has any
  non-completed task** (`open` / `in_progress` / `blocked`), then stops — there
  is no cron job to clean up afterwards. Crucially, it does **not** stop just
  because no task is `open` this instant: if agent tasks are `blocked`
  (typically waiting on human input) or `in_progress`, it **wait-polls** and
  keeps the session alive so it can resume the moment a blocker is resolved or a
  new task is added, rather than forcing the user to re-invoke.
- **Wait through human-input blockers; do not stop on `blocked`.** An agent task
  `blocked` by a human-owned task is waiting on input only the human can provide
  — the orchestrator cannot do that work. Instead of stopping, it wait-polls:
  once the human completes the blocker, the blocked task auto-unblocks and the
  next round dispatches it. This is the main reason the session stays alive.
- **Re-poll for newly-added tasks.** The task list is re-read every round, so
  agent tasks added to the effort mid-run are picked up automatically — no need
  to re-invoke. New tasks appear as `open` on the next check (or the next
  wait-poll) and are dispatched like any other.
- **Tune the poll interval to the situation.** The default ~60 s wait-poll is a
  balance between catching unblocks/new tasks quickly and not hammering the app.
  If blockers need long human deliberation, a longer interval is fine; if new
  tasks are expected imminently, shorten it. The user can interrupt at any time.
- **Login is a prerequisite, not a round concern.** If a spawn fails because a
  worker isn't logged in, the round can't fix it; surface it in the round's
  output. The user must run the relevant worker login
  (`opencode auth login` / `kimi login` / `codex login` / `claude auth login` /
  `copilot login`)
  separately. (In-session `kimi` subagents have no login — they run inside
  this session.)

---

## Reporting to the user

At the end of the run, report the effort (name + id), the **agent roster read
from the app** (each supported agent: name, `tool` → type, model,
thinking_effort), any **skipped agents** (name + reason), the cwd, and the
loop's final outcome (**done** / **aborted**, with the details above). While
running, a **wait** round reports the pending `in_progress` / `blocked` tasks
per agent and that it is polling — it is not a terminal outcome. State plainly
that **no cron job was created** — there is nothing to stop or
delete (contrast with `lc-orchestrate-agents`, which creates a recurring
5-minute job). Remind the user the spawned headless worker CLIs must stay
logged in for their rounds to do real work (in-session `kimi` subagents
need no login), and that **the agent roster and every task's `run_as` are
re-read each round**, so editing agents or flipping a task's Run As picker in
the app takes effect on the next round without re-running setup.
