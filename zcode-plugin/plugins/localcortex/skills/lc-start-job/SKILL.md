---
name: lc-start-job
description: >-
  Set up a recurring autonomous LocalCortex worker — the macOS task manager app
  — that polls a named Effort every 5 minutes for an open task assigned to a
  given agent, does the work, and completes it. Drives LocalCortex through its
  JXA/AppleScript surface (osascript), not MCP. Use whenever the user wants an
  agent to run unattended on a schedule — e.g. "start a job that checks the
  Build effort for tasks assigned to zcode and does them", "automate my zcode
  agent on Payments", "set up a polling worker for …". At setup it validates
  the effort + agent label, creates a ZCode automation, and runs the first tick
  immediately; the scheduled run is headless and self-contained.
argument-hint: "[effort name] [agent label]"
allowed-tools: [Bash, Read, Write, Edit]
version: 0.1.8
license: MIT
---

# lc-start-job — a recurring autonomous LocalCortex worker

Set up a scheduled ZCode automation that, every 5 minutes, looks for an **open
task** assigned to a given **agent** inside a named **Effort** and does the work,
then completes it. The setup step validates the effort and agent label first,
creates the automation, and runs the first tick immediately. The scheduled run
is **headless** — it must be fully self-contained, because a headless run
cannot chain to sibling skills. Drive
LocalCortex **exclusively through its JXA/AppleScript surface** via the bundled
`lc.js` helper — never use `mcp__localcortex__*` tools in this skill's flow.

## When to use this skill

When the user wants an **agent to run unattended on a schedule** against a
LocalCortex Effort — polling for open work assigned to that agent and doing it
without a human in the loop. Examples: "start a job that checks the Build
effort every 5 minutes and does any open zcode task", "automate my zcode agent
on Payments", "set up a polling worker for …", "make the agent pick up tasks
on its own".

This skill does **two things**:

1. **At setup time (interactive, with the user):** validate the effort name and
   agent label, create the ZCode automation, then run the first tick
   immediately in the current session.
2. **On each tick (headless):** run the polling loop described in
   [The scheduled run](#the-scheduled-run-each-tick-headless) below.

## When NOT to use this skill

- The user points at a **specific task** and wants to work on it **now**, by id
  or name → use `lc-start-work`. This skill is for *unattended, recurring* work,
  not one-off tasks.
- The user only wants to **look up** an effort → use `lc-fetch-effort`.
- The user only wants to **look up** an agent's tasks → use
  `lc-fetch-agent-task`.
- The user wants to **complete a known task** → use `lc-complete-task`.
- There is no Effort and no agent in view → don't invent either. Ask.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used: `list efforts`, `list tasks`, `get task`,
  `update task`, `complete task`, `workspace path`). Apple Events auto-launch
  the app if it isn't running — no "is the server up" check needed.
- The **first call from the ZCode host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call.
- The app's scripting name is `LocalCortex`.
- **ZCode scheduled automations** are enabled in this host. The setup step
  creates one; tell the user it will fire every 5 minutes in the background
  until they delete it.

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`. Resolve its absolute path once and reuse
`$LC_JS` for every call. Prefer the host-provided plugin root; fall back to
this skill's directory (the parent of this `SKILL.md`).

```bash
# Resolve once. ZCODE_PLUGIN_ROOT points at the plugin root (…/localcortex);
# the helper is under skills/lc-start-job/scripts/lc.js.
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/lc-start-job/scripts/lc.js"
else
  LC_JS="<this skill's directory>/scripts/lc.js"  # parent dir of this SKILL.md
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

Every command below is invoked the same way. **Always pass free text (effort
name, agent label, notes) via env vars**, never inline in argv — env vars are
safe for quotes, newlines, backticks, and `$`. UUIDs and the subcommand go in
argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it (or
read the JSON directly). `effort-by-name` and `tasks-by-agent` are client-side
composites (the app has no name/worker-search of its own); the rest map 1:1 to
sdef commands.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, match, candidates }` object |
| `tasks-by-agent` | `<effortId>` | `LC_AGENT_LABEL` (req), `LC_INCLUDE_COMPLETED=true`, `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, count, tasks }` object |
| `tasks-get` | `<taskId>` | — | JSON task record **with `notes`** |
| `task-update` | `<taskId>` | `LC_NAME`, `LC_NOTES`, `LC_STATUS`, `LC_WORKER`, `LC_WORKER_LABEL` | JSON updated task |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |
| `task-complete` | `<taskId>` | `LC_COMPLETED=false` (default `true`) | JSON task record |

- Statuses: `open`, `in_progress`, `blocked`, `completed`.
- Workers: `none`, `human`, `agent` (+ `worker_label`, e.g. `zcode`).
- `effort-by-name` matches the effort's own `name` case-insensitively, exact
  first then substring; `match` is `null` on zero or ambiguous matches.
- `tasks-by-agent` returns tasks whose `worker` is `"agent"` **and** whose
  `worker_label` matches the query case-insensitively; by default only
  **active** tasks (`open`, `in_progress`, `blocked`) are returned.
- On this surface, **nil optional fields are explicit JSON `null`** (e.g.
  `parent_id`, `notes`, `due_date`, `completed_at`). `has_notes`,
  `is_archived`, `worker`, `worker_label`, `status` are always present.

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
| `-1001` | validation — bad UUID/enum or missing required param; for `task-complete`, most commonly an incomplete blocker ("Cannot complete — blocked by …"). |
| `-1002` | not_found — unknown effort/task |
| `-1003` | conflict — conflicting state |

---

## Setup (interactive, with the user)

### Step 1 — Confirm the two inputs

The job is defined by two things the user must provide:

- **Effort name** — the Effort to poll (resolved to an id by name).
- **Agent label** — the `worker_label` of the agent that owns the tasks
  (e.g. `zcode`). This is **not** the literal string "agent".

If either is missing or ambiguous, **ask** before doing anything else. Do not
invent an effort or guess a label.

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

### Step 3 — Create the ZCode automation (every 5 minutes)

Use the host's `CronCreate` tool to schedule a recurring automation that fires
**every 5 minutes**. Pass exactly the fields below — the prompt must be the
complete, self-contained [Scheduled run](#the-scheduled-run-each-tick-headless)
flow, because the run is headless and has no access to this conversation.

- `recurring`: `true`
- `intervalUnit`: `"minute"`, `interval`: `5`  (equivalent cron `*/5 * * * *`)
- `cron`: `"*/5 * * * *"`
- `title`: a concise title that records the schedule **and** the effort/agent,
  e.g. `lc-start-job: poll <effort name> every 5 min for <agent label>`
- `prompt`: the **exact** prompt block from
  [Scheduled run](#the-scheduled-run-each-tick-headless) below, with
  `<EFFORT_NAME>`, `<EFFORT_ID>`, and `<AGENT_LABEL>` filled in with the
  validated values. Do not paraphrase it.

### Step 4 — Run the first tick immediately

Do not wait ~5 minutes for the automation's first fire. Right after creating
it, run one tick now, in this session: follow the
[Scheduled run](#the-scheduled-run-each-tick-headless) flow below exactly as
the automation prompt will, with `<EFFORT_NAME>`, `<EFFORT_ID>`, and
`<AGENT_LABEL>` filled in with the validated values. If there is no open task,
the tick does nothing — that is fine; the recurring automation will pick up
future tasks.

### Step 5 — Report and tell the user how to stop it

Report plainly: the effort (name + id), the agent label, that the automation
is recurring every 5 minutes, and that the first tick has already run —
report its outcome (which task was worked and completed, or that no open task
was found). **Tell the user how to stop it:** the automation persists until
deleted; they can list automations (`CronList`) and delete the job by id
(`CronDelete`), or ask you to stop it.

---

## The scheduled run (each tick, headless)

> The text below is the run. The setup step pastes a filled-in copy of this
> block into the automation's `prompt`. **Keep it self-contained** — a headless
> run cannot ask the user anything mid-tick, and must not chain to sibling
> skills. If a tick finds no open task, it does nothing and exits.

You are an autonomous LocalCortex worker. Poll the Effort **`<EFFORT_NAME>`**
(id `<EFFORT_ID>`) for an **open** task assigned to the agent labeled
**`<AGENT_LABEL>`**, do that task's work, then complete it. Work **only one
task per tick**; if several are open, pick the first by task `order` (then by
`created_at`) and leave the rest for the next tick. Never touch a task whose
`worker` is not `agent` or whose `worker_label` is not `<AGENT_LABEL>`.

### Helper

Resolve the bundled helper once and reuse `$LC_JS`:

```bash
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/lc-start-job/scripts/lc.js"
else
  LC_JS="<lc-start-job skill dir>/scripts/lc.js"
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

### 1. Find an open task for the agent

```bash
LC_AGENT_LABEL='<AGENT_LABEL>' \
  osascript -l JavaScript "$LC_JS" tasks-by-agent '<EFFORT_ID>'
```

This returns `{ query, count, tasks }` of the agent's **active** tasks. Select
the first one whose `status` is `"open"` (sort by `order`, then `created_at`).
If there is no `open` task — `count` is 0 or every task is `in_progress` /
`blocked` — **there is nothing to do this tick; stop here.** Do not touch a
task another worker already started (`in_progress`); it is not yours.

### 2. Claim it, then re-read to confirm

Claim the chosen task as the agent before doing any work:

```bash
LC_STATUS=in_progress LC_WORKER=agent LC_WORKER_LABEL='<AGENT_LABEL>' \
  osascript -l JavaScript "$LC_JS" task-update '<TASK_ID>'
```

Then re-read it and confirm `worker` is `agent` **and** `worker_label` is
`<AGENT_LABEL>`. If the claim did not take (another worker holds it, or the
task moved), **stop** — do not work a task you do not own.

### 3. Read the task and do the work

```bash
osascript -l JavaScript "$LC_JS" tasks-get '<TASK_ID>'
```

The returned record's `name` (the title) and `notes` describe the work. The
`notes` are the instructions; the `name` is the summary.

**Resolve the Effort's workspace folder once and read relevant context from it
before starting:**

```bash
osascript -l JavaScript "$LC_JS" workspace-path '<EFFORT_ID>'
```

The result is the absolute path string, or literal `null` if no folder is
configured. If it is non-`null`, treat the folder as the Effort's shared context:
list it and read any files that bear on this task — a design doc, a prior
decision log, review feedback, or artifacts left by earlier tasks. The
task's own `notes` often name or link these; follow those references. Use this
existing material to ground the work (match conventions, avoid redoing prior
decisions, build on what is already there). If the path is `null`, there is no
workspace folder to read — proceed with just the task's `name` and `notes`.

Then **do the work.**

If the work produces files — a design plan, review feedback, a decision
log, anything worth keeping — write them into the **same workspace folder** you
just resolved. If that path was `null`, **do not write loose files** — a
headless run's working directory is not somewhere the user will find them.
Instead, put the artifact content (or a concise "no workspace folder
configured" note) directly into the task's `notes` in the next step. Otherwise,
use `Write`/`Edit` to put artifacts under that path, then record a **brief
summary plus the file links** back on the task's notes:

```bash
LC_NOTES='<one-paragraph summary of what was done + links to artifacts>' \
  osascript -l JavaScript "$LC_JS" task-update '<TASK_ID>'
```

### 4. Complete the task

When the work is done, complete it — do not wait for a human:

```bash
osascript -l JavaScript "$LC_JS" task-complete '<TASK_ID>'
```

Completion also completes the subtask subtree, auto-unblocks tasks waiting on
it, and spawns a fresh open copy if the task carries a recurrence rule. If it
fails with `-1001` and a "Cannot complete — blocked by …" message, **do not
retry blindly** — the task (or a descendant) has an incomplete blocker; leave
the task `in_progress` and stop. The next tick will retry once the blocker is
resolved.

### 5. One task per tick

After completing one task, **stop**. Do not loop to the next open task in the
same tick — the next tick (within ~5 minutes) will pick it up. This keeps each
run bounded and the automation easy to reason about.

### Notes for the run

- **Headless means no questions.** If anything is ambiguous in the task notes,
  make the most reasonable interpretation, do the work, and record your
  interpretation in the task notes. Do not block waiting for input.
- **Do not create follow-up tasks.** A scheduled worker completes the open task
  it picked up; it does not run the follow-up flow. If a task clearly needs
  follow-up, say so in the task notes and leave it at that.
- **Fail safe.** If a tick errors mid-work after the task was claimed, leave
  the task `in_progress` and stop — do not complete a task whose work did not
  finish. The next tick (or a human) can pick it up.

---

## Reporting to the user

At setup, report the effort (name + id), the agent label, the schedule (every
5 minutes, recurring), the outcome of the first tick (already run at setup),
and **how to stop it** (list with `CronList`, delete by id with `CronDelete`).
During the scheduled run there is no user to report to; record progress in the
task notes instead.
