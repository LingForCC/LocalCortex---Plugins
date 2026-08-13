---
name: lc-orchestrate-agents
description: >-
  Set up a recurring LocalCortex multi-agent orchestrator — the macOS
  task manager app — that polls a named Effort every 5 minutes and
  spawns each app-defined agent's CLI (opencode, kimi, codex, or
  claude code) headless to do that agent's open work. The roster,
  model, and thinking effort are READ FROM THE APP (`list agents`) —
  the user supplies only the Effort; each agent's `tool` selects the
  CLI, its `model` is the model, its `thinking_effort` is the effort.
  Each tick re-reads the roster and, for each supported agent with an
  open task, picks one task and spawns its CLI headless with a
  one-line prompt telling it to run the lc-start-work skill for that
  task's id (not the agent's id); the worker verifies, claims, works,
  and completes that task itself. Drives LocalCortex through its
  JXA/AppleScript surface (osascript), not MCP. Use for scheduled
  multi-agent delegation — e.g. "orchestrate all my agents on Build".
license: MIT
compatibility: opencode
---

# lc-orchestrate-agents — a scheduled multi-agent delegation orchestrator

Set up a scheduled **launchd LaunchAgent** that, every 5 minutes, runs an
OpenCode orchestrator tick that checks a named **Effort** for open tasks
assigned to **each supported agent defined in the LocalCortex app** and — **for
every agent that has an open task** — spawns that agent's CLI headless to do
the work. OpenCode has no in-process scheduler, so each tick is a headless
`opencode run --auto` with a fully self-contained prompt. The orchestrator is a
**thin gatekeeper**: each tick runs cheap `osascript` checks for each agent,
and only spawns a worker when there is an open task for that agent. It does
**not** do the task work itself.

The **agent roster is read from the app**, not supplied by the user. At setup
the user provides only the **Effort name** and a **working directory**; the
skill calls the app's `list agents` command, and for each agent definition maps
its free-text `tool` to one of the supported CLIs (opencode / kimi / codex /
claude code),
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
  | `codex` | `codex` |
  | `claude` | `claude code` |
  | anything else (e.g. `zcode`) | **unsupported — skipped** |

  So `"opencode"`, `"kimi code"`, `"codex"`, and `"claude code"` all map
  correctly; `"zcode"` is skipped (no spawnable headless CLI is known for it
  here).
- **`model`** and **`thinking_effort`** are applied to opencode, kimi, codex,
  and claude code spawns
  (see [Model & thinking-effort support](#model--thinking-effort-support-read-this-first)).

Each agent's **tasks** are matched by **`agent_id`** (the agent record's `id`
UUID), not by `worker_label`. As of the app's agent-worker feature, an
agent-assigned task carries its identity in `agent_id`; `worker_label` is
human-only and empty for agent tasks. The orchestrator finds each agent's open
tasks with `tasks-by-agent ... LC_AGENT_ID=<id>` so it knows **which CLI to
spawn**; it then hands the picked task's **id** to the spawned `lc-start-work`
worker, which does not look the task up by agent at all (it works whatever task
id it is given).

## Model & thinking-effort support (read this first)

The headless CLIs expose model and thinking-effort selection via flags / env.
Each agent's `model` / `thinking_effort` (read from the app) is applied to all
four supported CLIs.

| agent type (from `tool`) | model (headless) | thinking effort (headless) |
|---|---|---|
| **opencode** | ✅ `-m <provider/model>` | ✅ `--variant <effort>` |
| **kimi** | ✅ `-m <alias>` | ✅ env `KIMI_MODEL_THINKING_EFFORT=<low\|medium\|high\|max>` |
| **codex** | ✅ `-m <model>` | ✅ `-c model_reasoning_effort=<minimal\|low\|medium\|high\|xhigh>` |
| **claude code** | ✅ `--model <alias-or-id>` | ✅ `--effort <low\|medium\|high\|xhigh\|max\|ultracode>` |

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
   app** (`list agents`) and map each to a spawnable CLI; install the launchd
   LaunchAgent; then run the first tick immediately in the current session.
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
- The **first call from the OpenCode host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call. (Each spawned worker binary
  triggers its own one-time grant the first time it calls LocalCortex.)
- The app's scripting name is `LocalCortex`.
- The host is **macOS** (launchd). These skills are macOS-only anyway because of
  `osascript`. OpenCode has no in-process scheduler, so this skill installs a
  **launchd LaunchAgent**; tell the user it will fire every 5 minutes in the
  background until they remove it.
- **At least one supported agent is defined in the app.** Agents are created in
  the app's Settings (or via `create agent`); each agent's `tool` must map to
  one of the supported CLIs (opencode / kimi / codex / claude code). If no agent is defined,
  or none maps to a supported CLI, the skill does nothing and tells the user.
- **The spawned worker CLIs are installed and logged in.** Workers run headless,
  so they cannot prompt for login mid-run. Each supported agent has its own
  one-time login: `kimi login`, `opencode auth login`, `codex login`,
  `claude auth login` (or `claude setup-token` for a long-lived scripting
  token). Tell the user to run the relevant logins once before relying on this
  LaunchAgent.
- **The `lc-start-work` skill is installed** for every spawned agent (in that
  agent's skill directory). The delegation prompt assumes the worker can load it.
- **For opencode agents**, models are referenced as `<provider>/<model>` (e.g.
  `zhipuai-coding-plan/glm-5.2`). The model comes from each agent's `model`
  field; if a tick fails for that agent, check that the model is usable under
  the user's provider credentials (`~/.config/opencode/opencode.json`).
- **For kimi agents**, model aliases live in `~/.kimi-code/config.toml` (e.g.
  `kimi-code/k3`). The model comes from each agent's `model` field; if a tick
  fails, check the alias exists there.
- **For codex agents**, models are codex model strings (e.g. `gpt-5.3-codex`,
  `gpt-5.4`) or any Chat Completions / Responses API model id. The model comes
  from each agent's `model` field; if a tick fails, check the model is
  available to the user's ChatGPT plan or `OPENAI_API_KEY`
  (`~/.codex/config.toml`). `thinking_effort` must be one of codex's
  `model_reasoning_effort` values (`minimal` / `low` / `medium` / `high` /
  `xhigh`).
- **For claude code agents**, models are aliases (`sonnet`, `opus`, `haiku`,
  `fable`) or full model ids (e.g. `claude-sonnet-5`). The model comes from
  each agent's `model` field; if a tick fails, check the alias/id is valid for
  the user's Anthropic account (`claude auth status`). `thinking_effort` must
  be one of claude's `--effort` values (`low` / `medium` / `high` / `xhigh` /
  `max` / `ultracode`).

## Supported agents

Only agents whose `tool` maps to one of these CLIs can be delegated to (see the
[`tool` → CLI mapping](#how-agents-are-identified-read-this-first)). Anything
else → **do not spawn; skip it and report why**.

| type | spawn command (headless) |
|---|---|
| `opencode` | `opencode run --dir "<CWD>" -m <model> --variant <effort> --auto "<worker prompt>"` (model via `-m <provider/model>`; thinking effort via `--variant`; `--auto` auto-approves tool calls so the run is non-interactive; `--dir` sets the cwd) |
| `kimi` | `cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<worker prompt>"` (model via `-m`; thinking effort via the env var; `-p` prompt mode is already non-interactive and auto-approves tool calls — do **not** add `-y`/`--yolo` or `--auto`, they are incompatible with `-p` on kimi ≥ 0.34.0) |
| `codex` | `cd "<CWD>" && codex exec -m <model> -c model_reasoning_effort=<effort> -s danger-full-access -a never "<worker prompt>"` (`codex exec` runs headless to completion; model via `-m`; reasoning effort via `-c model_reasoning_effort=`; `-s danger-full-access` gives the worker full access with no sandbox limits; `-a never` is yolo — never ask for approval; cwd is set by `cd`, since `codex exec` otherwise requires the cwd to be a git repo. Omit `-m` / `-c …` when the agent's `model` / `thinking_effort` is empty) |
| `claude code` | `cd "<CWD>" && claude -p --model <model> --effort <effort> --dangerously-skip-permissions "<worker prompt>"` (`-p` is non-interactive print mode; model via `--model` alias or id; thinking effort via `--effort`; `--dangerously-skip-permissions` is yolo — skips all permission prompts; cwd is set by `cd` — claude has no cwd flag. Omit `--model` / `--effort` when the agent's `model` / `thinking_effort` is empty) |

The **worker prompt** is the same one-sentence instruction for every agent,
parameterized by **that agent's id and name** (see [Worker prompt](#worker-prompt)).

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`, in the skill's `scripts/` folder.
OpenCode installs skills under one of a few known directories and exposes no
skill-dir placeholder, so resolve the helper by skill name once and reuse
`$LC_JS` for every call:

```bash
LC_SKILL="lc-orchestrate-agents"
LC_JS=""
for d in \
  ".opencode/skills/$LC_SKILL" ".agents/skills/$LC_SKILL" ".claude/skills/$LC_SKILL" \
  "$HOME/.config/opencode/skills/$LC_SKILL" "$HOME/.agents/skills/$LC_SKILL" "$HOME/.claude/skills/$LC_SKILL"; do
  [ -f "$d/scripts/lc.js" ] && { LC_JS="$d/scripts/lc.js"; break; }
done
[ -f "$LC_JS" ] || { echo "lc.js not found for $LC_SKILL" >&2; exit 1; }
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
  app is installed and running, then try again." **Do not install the
  LaunchAgent.**
- **On success** → `JSON.parse` the array. For each agent record, compute its
  CLI type from the `tool` field (case-insensitive substring):

    | `tool` contains | type |
    |---|---|
    | `opencode` | `opencode` |
    | `kimi` | `kimi` |
    | `codex` | `codex` |
    | `claude` | `claude code` |
    | else | unsupported |

    Build two lists:
    - **Supported agents** — one entry per agent whose `tool` mapped: `{id, name,
      type, model, thinking_effort}`. Keep the original `order` for reporting.
    - **Skipped agents** — name + reason (e.g. "tool `zcode` has no spawnable
      CLI").

- **If the supported list is empty** (no agents defined, or none map to a known
  CLI) → **stop and inform the user.** List what was found (if anything) and
  why each was skipped, and tell them to define agents in the app's Settings
  (or via `create agent`) with `tool` set to `opencode`, `kimi`, `codex`, or
  `claude code`.
  **Do not install the LaunchAgent.**

### Step 4 — Install the launchd LaunchAgent (every 5 minutes)

OpenCode has no in-process scheduler, so install a macOS `launchd` LaunchAgent
that fires every 5 minutes. Each tick runs `opencode run --auto` headless with
the self-contained orchestrator prompt below.

Build a stable slug from the effort name, and a per-job directory + plist label
(namespaced with an `orch-` prefix so it never collides with an `lc-start-job`
LaunchAgent for the same effort):

```bash
slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'; }
JOB_SLUG="orch-$(slug '<effort name>')"
JOB_DIR="$HOME/.local/share/opencode/localcortex-jobs/$JOB_SLUG"
PLIST="$HOME/Library/LaunchAgents/ai.opencode.localcortex.$JOB_SLUG.plist"
LABEL="ai.opencode.localcortex.$JOB_SLUG"
mkdir -p "$JOB_DIR"
```

Write the **filled-in** orchestrator prompt to `$JOB_DIR/tick.prompt` using
`Write` — the exact prompt block from
[The scheduled run](#the-scheduled-run-each-tick-headless) below, with
`<EFFORT_NAME>`, `<CWD>`, `<LABEL>`, `<PLIST>`, and `<JOB_DIR>` substituted for
the validated/resolved values. The tick prompt **does not embed agent ids** —
it re-reads `agents-list` every tick, so agents added/removed/edited in
Settings take effect without recreating the LaunchAgent. Do not paraphrase it.

Then write the runner `$JOB_DIR/tick.sh` and make it executable. The runner
cd's into `<CWD>` and hands the prompt to `opencode run --auto`:

```bash
cat > "$JOB_DIR/tick.sh" <<'RUNNER'
#!/bin/zsh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd '__CWD__'        # the validated working directory (replaced below)
exec opencode run --auto "$(cat "$DIR/tick.prompt")"
RUNNER
# Drop the chosen CWD into the runner (use the Edit tool to replace __CWD__).
# If the CWD contains a ', instead leave the cd line as `cd "$HOME"` and pass
# the directory with `opencode run --auto --dir '<CWD>' "$(cat "$DIR/tick.prompt")"`.
chmod +x "$JOB_DIR/tick.sh"
```

Write `$PLIST` (use the `Write` tool) so launchd runs the runner every 300 s,
with logs under the job dir:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>__LABEL__</string>
  <key>ProgramArguments</key>
  <array>
    <string>__JOB_DIR__/tick.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__HOME__</string>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>__JOB_DIR__/tick.log</string>
  <key>StandardErrorPath</key>
  <string>__JOB_DIR__/tick.log</string>
</dict>
</plist>
```

(Substitute `__LABEL__`, `__JOB_DIR__`, and `__HOME__` — `$HOME` absolute path.)

Then load it:

```bash
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null \
  || launchctl load "$PLIST"   # older macOS fallback
```

### Step 5 — Run the first tick immediately

Do not wait ~5 minutes for the LaunchAgent's first fire. Right after installing
it, run one tick now, in this session: follow the
[Scheduled run](#the-scheduled-run-each-tick-headless) flow below exactly as
the tick prompt will, with the validated values filled in. If no agent
has an open task, the tick simply does nothing and exits — that's fine; the
recurring LaunchAgent will pick up future tasks.

### Step 6 — Report and tell the user how to stop it

Report plainly: the effort (name + id), the **agent roster read from the app**
  (each supported agent: name, `tool` → type, model, thinking_effort), any
  **skipped agents** (name + reason),
the cwd, the LaunchAgent label/plist path, that the job is recurring every 5
minutes, and that the first tick has already run — report its outcome (which
workers were spawned, or that the effort was idle). **Tell the user how to stop
it:** the LaunchAgent persists until removed; they can ask you to stop it, or
run:

```bash
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null \
  || launchctl unload "$PLIST"   # older macOS fallback
rm -f "$PLIST"
rm -rf "$JOB_DIR"
```

Also tell them the job keeps firing
even when no agent has any active work left — idle ticks are silent no-ops
that create nothing, and the job only stops when they remove it (bootout/unload
+ remove the plist and job dir). Also remind them the spawned
worker CLIs must stay logged in (`opencode auth login`, `kimi login`,
`codex login`, `claude auth login`) for ticks to do real work. Finally, tell
them **the agent roster is re-read every tick**, so editing agents in the app's
Settings (or via `create agent` / `update agent` / `delete agent`) takes effect
on the next tick without recreating the LaunchAgent.

---

## The scheduled run (each tick, headless)

> The text below is the run. The setup step writes a filled-in copy of this
> block (with `<EFFORT_NAME>`, `<CWD>`, `<LABEL>`, `<PLIST>`, and `<JOB_DIR>`
> substituted) into the tick prompt file, and the LaunchAgent runs it via
> `opencode run --auto`. **Keep it self-contained** — a headless run cannot ask
> the user anything mid-tick, and must not chain to sibling skills (it *spawns*
> workers that run `lc-start-work`; it does not load that skill itself). If no
> supported agent has any active task, the tick does
> nothing and exits; it cannot stop itself.

You are a LocalCortex multi-agent delegation orchestrator. Each tick:

1. resolve the Effort **`<EFFORT_NAME>`** by name;
2. read the agent roster from the app (`list agents`) and keep every agent
   whose `tool` maps to a supported CLI (opencode / kimi / codex / claude code);
3. for **each** supported agent that has an `open` task (matched by
   `agent_id`), pick one open task for that agent (the first, by `order` then
   `created_at`) and record its **task id**;
4. spawn that agent's CLI headless from the working directory **`<CWD>`** with
   a one-line prompt telling it to run the `lc-start-work` skill on this
   effort **for that task's id** (not the agent's id);
5. spawn all such workers **in parallel**, then wait for all of them.

If an agent has no open task, do not spawn it. If **no** supported agent has any
active task (`open` / `in_progress` / `blocked`), do nothing this tick and exit
— the effort is idle, and idle ticks are silent no-ops (never create any task).
Work **only one task per agent per tick**.
Never touch a task whose `worker` is not `agent` or whose `agent_id` is not one
of the supported agents' ids.

The `tool` → CLI mapping is case-insensitive (substring of the `tool` field):
`opencode`→opencode, `kimi`→kimi, `codex`→codex, `claude`→claude code, anything
else→skip. Apply each agent's `model` and `thinking_effort` to its own CLI:
opencode (`-m` / `--variant`), kimi (`-m` / `KIMI_MODEL_THINKING_EFFORT`),
codex (`-m` / `-c model_reasoning_effort=`), claude code (`--model` / `--effort`).

### Helper

Resolve the bundled helper once and reuse `$LC_JS`. OpenCode installs skills
under one of a few known directories and exposes no skill-dir placeholder, so
find it by skill name:

```bash
LC_SKILL="lc-orchestrate-agents"
LC_JS=""
for d in \
  ".opencode/skills/$LC_SKILL" ".agents/skills/$LC_SKILL" ".claude/skills/$LC_SKILL" \
  "$HOME/.config/opencode/skills/$LC_SKILL" "$HOME/.agents/skills/$LC_SKILL" "$HOME/.claude/skills/$LC_SKILL"; do
  [ -f "$d/scripts/lc.js" ] && { LC_JS="$d/scripts/lc.js"; break; }
done
[ -f "$LC_JS" ] || { echo "lc.js not found for $LC_SKILL" >&2; exit 1; }
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
without recreating the LaunchAgent):

```bash
osascript -l JavaScript "$LC_JS" agents-list
```

- **Non-zero exit** (e.g. `-2700`, app not running) → **stop.** Do not spawn
  anything; the next tick will retry.
- **Success** → `JSON.parse` the array. For each agent record, map its `tool`
  (case-insensitive substring) to a CLI type:
  contains `opencode`→`opencode`, `kimi`→`kimi`, `codex`→`codex`,
  `claude`→`claude code`, else skip.
  Build the supported roster for this tick: one entry per mapped agent
  `{id, name, type, model, thinking_effort}`.
- **Empty roster** (no agents, or none map to a known CLI) → **stop.** Do not
  spawn anything this tick. (This can happen if the user deletes or retools all
  agents; the next tick re-reads.)

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
  presence drives step 4 Branch A;
- whether it has **any active task at all** (`open` / `in_progress` / `blocked`)
  — this drives the idle test in step 4 Branch B.

Do not touch tasks another worker already started (`in_progress`); they are not
yours. **Pick at most one open task per agent** (the first); do not hand the
worker more than one task id.

### 4. Decide: spawn workers, or exit idle

Look at the per-agent results from step 3 and pick **one** branch.

#### Branch A — at least one agent has an `open` task → spawn

If any supported agent has an `open` task, proceed to **step 5** and spawn one
worker per such agent (the existing spawn flow). The effort is not done.

#### Branch B — no agent has any active task → idle, do nothing

If **no** supported agent has any active task (`open` / `in_progress` /
`blocked`), the effort is idle. **Do nothing this tick: spawn no worker, and
create no task** — idle ticks are silent no-ops. The LaunchAgent **cannot
delete or disable itself** — a headless `opencode run` has no way to remove its
own launchd registration mid-tick — so it simply keeps firing no-op ticks until
the user removes it. Skip step 5 entirely and stop.

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

**If the agent type is `codex`** — model via `-m <model>` (omit if the agent's
`model` is empty), reasoning effort via
`-c model_reasoning_effort=<effort>` (omit if `thinking_effort` is empty),
`-s danger-full-access` so the worker runs with full access and no sandbox limits, `-a never`
for yolo (never ask for approval), cwd set by `cd` (`codex exec` otherwise
requires the cwd to be a git repo):

```bash
cd "<CWD>" && codex exec -m <model> -c model_reasoning_effort=<effort> -s danger-full-access -a never "<worker prompt for this agent>"
```

**If the agent type is `claude code`** — model via `--model <alias-or-id>`
(omit if the agent's `model` is empty), thinking effort via `--effort <effort>`
(omit if `thinking_effort` is empty), `--dangerously-skip-permissions` for yolo
(skip all permission prompts), `-p` for non-interactive print mode, cwd set by
`cd` (claude has no cwd flag):

```bash
cd "<CWD>" && claude -p --model <model> --effort <effort> --dangerously-skip-permissions "<worker prompt for this agent>"
```

**Parallel pattern** (example for all four agent types — spawn only the ones
that have an `open` task this tick):

```bash
# opencode worker
( opencode run --dir "<CWD>" -m <model> --variant <effort> --auto "<opencode prompt>" ) &
OPENCODE_PID=$!
# kimi worker
( cd "<CWD>" && KIMI_MODEL_THINKING_EFFORT=<effort> kimi -m <model> -p "<kimi prompt>" ) &
KIMI_PID=$!
# codex worker
( cd "<CWD>" && codex exec -m <model> -c model_reasoning_effort=<effort> -s danger-full-access -a never "<codex prompt>" ) &
CODEX_PID=$!
# claude code worker
( cd "<CWD>" && claude -p --model <model> --effort <effort> --dangerously-skip-permissions "<claude prompt>" ) &
CLAUDE_PID=$!
wait "$OPENCODE_PID" "$KIMI_PID" "$CODEX_PID" "$CLAUDE_PID"
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
version before the next tick — opencode/kimi/codex/claude flag names can vary across
builds.

### 6. One task per agent per tick

After spawning (one worker per agent that had an open task), **stop**. Do not
loop to the next open task for any agent in the same tick — the next tick
(within ~5 minutes) will pick it up. This keeps each run bounded and the
LaunchAgent easy to reason about.

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
  exits silently, and if no agent has any active task it does nothing and exits
  (step 4 Branch B). The spawned workers are likewise told to
  run headless.
- **The agent roster is re-read every tick.** Adding, removing, renaming, or
  retooling an agent in the app's Settings (or via `create agent` / `update
  agent` / `delete agent`) takes effect on the next tick — no need to recreate
  the LaunchAgent.
- **Fail safe, per worker.** If a spawn fails, leave that agent's tasks as they
  are; do not complete a task on a worker's behalf. Other workers in the same
  tick are unaffected. The next tick (or a human) picks up unfinished work.
- **One task per agent per tick.** Spawn at most one worker per agent per tick.
  The 5-minute cadence bounds throughput deliberately.
- **Login is a prerequisite, not a tick concern.** If a spawn fails because a
  worker isn't logged in, the tick can't fix it; surface it in the tick's output
  and stop that worker. The user must run the relevant worker login
  (`opencode auth login` / `kimi login` / `codex login` / `claude auth login`)
  separately.

---

## Reporting to the user

At setup, report the effort (name + id), the **agent roster read from the app**
(each supported agent: name, `tool` → type, model, thinking_effort), any
**skipped agents** (name +
reason), the cwd, the LaunchAgent label and plist path, the schedule (every 5
minutes, recurring), the outcome of the first tick (already run at setup), and
**how to stop it** (bootout/unload + remove the plist and job dir). Also
mention the **idle behavior**: once no agent has any active task left, ticks
become silent no-ops that create nothing — the job keeps firing until the user
removes it. Finally note that **the agent roster is re-read every tick**,
so editing agents in the app takes effect on the next tick without recreating
the LaunchAgent. During the scheduled run there is no user to report to; the
tick's stdout/stderr (per worker) —
captured under the job dir's `tick.log` — is all the trace there is.
