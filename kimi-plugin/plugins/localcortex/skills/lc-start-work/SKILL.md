---
name: lc-start-work
description: >-
  Do one task's worth of work on a named LocalCortex Effort — the macOS task
  manager app — on demand, for a given agent. Finds the next open task assigned
  to that agent (worker_label, e.g. kimi), claims it, does the work, writes
  artifacts into the effort's workspace folder, and completes it — one task,
  then stops. Drives LocalCortex through its JXA/AppleScript surface
  (osascript), not MCP. Use whenever the user wants to run a single autonomous
  pull-work-and-complete tick right now without setting up a recurring schedule
  — e.g. "work one kimi task on Build", "have the agent pick up the next open
  task on Payments and do it". This is the same flow each scheduled tick of
  lc-start-job runs, just invoked once. Does not create a Kimi Code cron job
  and does not chain sibling skills.
whenToUse: >-
  When the user wants one autonomous "pull the next open task for this agent
  and do it" tick right now against a named LocalCortex Effort, without
  setting up a recurring schedule.
arguments: effort agentLabel
---

# lc-start-work — one autonomous pull-work-and-complete tick, on demand

Find the next **open** task assigned to a given **agent** inside a named
**Effort**, claim it, do that task's work, write any artifacts into the
Effort's workspace folder, and complete it — then stop. Work **only one task**
per invocation. This is exactly the flow each scheduled tick of `lc-start-job`
runs; the difference is this skill runs it **once, right now**, instead of on a
recurring 5-minute schedule, and it does **not** create a Kimi Code cron job.

The user provides the two inputs:

- **Effort name** — the Effort to look in (resolved to an id by name).
- **Agent label** — the `worker_label` of the agent that owns the tasks
  (e.g. `kimi`). This is **not** the literal string "agent".

Drive LocalCortex **exclusively through its JXA/AppleScript surface** via the
bundled `lc.js` helper — never use `mcp__localcortex__*` tools in this skill's
flow.

## When to use this skill

When the user wants to run **one** autonomous "pull the next open task for this
agent and do it" tick **right now**, against a named Effort, **without** setting
up a recurring schedule. Examples: "work one kimi task on Build", "have the
agent pick up the next open task on Payments and do it", "do one tick of work
on the Launch effort for kimi".

## When NOT to use this skill

- The user wants this to keep happening **unattended on a schedule** (every 5
  minutes) → use `lc-start-job`, which sets up a recurring cron job.
- The user points at a **specific task** by id or name and wants to work on
  *that* one → this skill picks the next open task itself; it is not for a
  caller-chosen task.
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
- The **first call from the Kimi Code host binary triggers a one-time macOS
  TCC prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call.
- The app's scripting name is `LocalCortex`.

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`, in the skill's `scripts/` folder:

```bash
LC_JS="${KIMI_SKILL_DIR}/scripts/lc.js"
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
- Workers: `none`, `human`, `agent` (+ `worker_label`, e.g. `kimi`).
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

## The workflow

### Step 1 — Confirm the two inputs

The run is defined by two things the user must provide:

- **Effort name** — the Effort to look in (resolved to an id by name).
- **Agent label** — the `worker_label` of the agent that owns the tasks
  (e.g. `kimi`). This is **not** the literal string "agent".

If either is missing or ambiguous, **ask** before doing anything else. Do not
invent an effort or guess a label.

### Step 2 — Resolve the effort to exactly one match

Resolve the effort by name (exact match preferred):

```bash
LC_NAME='<effort name>' osascript -l JavaScript "$LC_JS" effort-by-name
```

- `match` is an object → use its `id`. Proceed.
- `match` is `null` with `candidates` → **list the candidates and ask the user
  which effort they mean.** Only proceed once it resolves to a single match.
- both `null` → tell the user no effort matched. Retry with
  `LC_INCLUDE_ARCHIVED=true` if it may be archived; otherwise stop.

### Step 3 — Find an open task for the agent

```bash
LC_AGENT_LABEL='<agent label>' \
  osascript -l JavaScript "$LC_JS" tasks-by-agent "$EFFORT_ID"
```

This returns `{ query, count, tasks }` of the agent's **active** tasks. Select
the first one whose `status` is `"open"` (sort by `order`, then `created_at`).
If there is no `open` task — `count` is 0 or every task is `in_progress` /
`blocked` — **there is nothing to do; stop here.** Tell the user there were no
open tasks for that agent (a `count` of 0 is not an error, just "nothing to do
right now"). Do not touch a task another worker already started
(`in_progress`); it is not yours.

A `count` of 0 may also mean a typo'd label — if it is 0, mention the label you
used so the user can confirm it was correct.

### Step 4 — Claim the task, then re-read to confirm

Claim the chosen task as the agent before doing any work:

```bash
LC_STATUS=in_progress LC_WORKER=agent LC_WORKER_LABEL='<agent label>' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

Then re-read it and confirm `worker` is `agent` **and** `worker_label` is the
agent label. If the claim did not take (another worker holds it, or the task
moved), **stop** — do not work a task you do not own.

### Step 5 — Read the task and do the work

```bash
osascript -l JavaScript "$LC_JS" tasks-get "$TASK_ID"
```

The returned record's `name` (the title) and `notes` describe the work. The
`notes` are the instructions; the `name` is the summary.

**Resolve the Effort's workspace folder once and read relevant context from it
before starting:**

```bash
osascript -l JavaScript "$LC_JS" workspace-path "$EFFORT_ID"
```

The result is the absolute path string, or literal `null` if no folder is
configured. If it is non-`null`, treat the folder as the Effort's shared
context: list it and read any files that bear on this task — a design doc, a
prior decision log, review feedback, or artifacts left by earlier tasks. The
task's own `notes` often name or link these; follow those references. Use this
existing material to ground the work (match conventions, avoid redoing prior
decisions, build on what is already there). If the path is `null`, there is no
workspace folder to read — proceed with just the task's `name` and `notes`.

Then **do the work.**

If the work produces files — a design plan, review feedback, a decision log,
anything worth keeping — write them into the **same workspace folder** you
just resolved. If that path was `null`, **do not write loose files** — this
run's working directory is not somewhere the user will find them. Instead, put
the artifact content (or a concise "no workspace folder configured" note)
directly into the task's `notes` in the next step. Otherwise, use `Write`/`Edit`
to put artifacts under that path, then record a **brief summary plus the file
links** back on the task's notes:

```bash
LC_NOTES='<one-paragraph summary of what was done + links to artifacts>' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

### Step 6 — Complete the task

When the work is done, complete it — do not wait for a human:

```bash
osascript -l JavaScript "$LC_JS" task-complete "$TASK_ID"
```

Completion also completes the subtask subtree, auto-unblocks tasks waiting on
it, and spawns a fresh open copy if the task carries a recurrence rule. If it
fails with `-1001` and a "Cannot complete — blocked by …" message, **do not
retry blindly** — the task (or a descendant) has an incomplete blocker; leave
the task `in_progress` and stop. Tell the user; they (or another run) can pick
it up once the blocker is resolved.

### Step 7 — One task, then stop

After completing one task, **stop**. Do not loop to the next open task in the
same invocation — if the user wants more, they can invoke this skill again, or
use `lc-start-job` for a recurring worker. Report what you did.

## Notes for the run

- **Make reasonable assumptions.** Unlike a fully headless scheduled tick, you
  *can* ask the user if something in the task notes is genuinely ambiguous —
  but prefer to make the most reasonable interpretation, do the work, and
  record your interpretation in the task notes. Do not block on trivia.
- **Do not create follow-up tasks.** This run completes the open task it picked
  up; it does not create follow-up siblings. If a task clearly needs
  follow-up, say so in the task notes and leave it at that.
- **Fail safe.** If the run errors mid-work after the task was claimed, leave
  the task `in_progress` and stop — do not complete a task whose work did not
  finish. Tell the user so they (or another run) can pick it up.

---

## Reporting to the user

Report plainly: the effort (name + id), the agent label, and the outcome —
which task you worked and completed (title + id + a one-line summary of what
you did), or that there was no open task for that agent. If you could not
complete the task (e.g. an incomplete blocker), say so and leave it
`in_progress`. No cron job is created by this skill, so there is nothing to
"stop".
