---
name: lc-create-from-template
description: >-
  Populate a named LocalCortex Effort — the macOS task manager app — with tasks
  materialized from a named task Template's prompt. Resolves the effort and the
  template by name, reads the template's free-text prompt, interprets it, and
  creates the described tasks (roots and subtasks) in the effort — then applies
  assignments and Blocked / blocker relationships on top. When a task is
  Blocked, the status and its blocker list are set together in one update (the
  app rejects Blocked without blockers). Drives LocalCortex through its
  JXA/AppleScript surface (osascript), not MCP. Use whenever the user wants to
  apply / instantiate / spin up a template against an effort — e.g. "create
  tasks from the Release Checklist template in the Ship 0.4 effort", "apply the
  Bug Bash template to Payments", "scaffold the Onboarding template inside
  Launch". Does not work or complete tasks; it only creates them.
argument-hint: "[effort name] [template name]"
allowed-tools: [Bash, Read]
version: 0.1.1
license: MIT
---

# lc-create-from-template — materialize a template's tasks into an Effort

Take a named **Effort** and a named task **Template**, read the template's
**prompt** (free-text instructions describing what tasks to create), interpret
it, and `create task` for each task it describes inside the effort. Then
`update task` to apply the things `create` cannot carry — an agent/human
assignment, and **Blocked / blocker** relationships. Drive LocalCortex
**exclusively through its JXA/AppleScript surface** via the bundled `lc.js`
helper — never use `mcp__localcortex__*` tools in this skill's flow.

A template is **just a name + a prompt** — there are no structured fields and no
placeholder substitution. The prompt is the instruction; **interpreting it is
this skill's job** (it is not done by the app). The existing `create task`
(with `name`, `notes`, `due date`, `parent`, optional `worker`/`worker_label`
applied after via `update task`) is the full materialization surface.

The user provides the two inputs:

- **Effort name** — the Effort to populate (resolved to an id by name).
- **Template name** — the global Template whose prompt describes the tasks
  (resolved to an id by name).

## When to use this skill

When the user wants to **populate an Effort from a Template** — i.e. take a
template's prompt and turn it into actual tasks inside a chosen effort.
Examples: "create tasks from the Release Checklist template in the Ship 0.4
effort", "apply the Bug Bash template to Payments", "scaffold the Onboarding
template inside Launch", "instantiate the Q&A pass template on Build".

## When NOT to use this skill

- The user wants to **work / complete** a task → use `lc-start-work`. This
  skill only creates tasks; it does not do them.
- The user wants to **complete** a known task → use `lc-complete-task`.
- The user only wants to **look up** an effort → use `lc-fetch-effort`.
- The user wants to **edit / create / delete** a template → templates are
  UI-only (Settings → Templates). This skill only *reads* templates.
- No effort and/or no template is in view → don't invent either. Ask.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used: `list efforts`, `list templates`, `list tasks`,
  `workspace path`, `create task`, `update task`). Apple Events auto-launch the
  app if it isn't running — no "is the server up" check needed.
- The **first call from the ZCode host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call.
- The app's scripting name is `LocalCortex`.

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`. Resolve its absolute path once and reuse
`$LC_JS` for every call. Prefer the host-provided plugin root; fall back to
this skill's directory (the parent of this `SKILL.md`).

```bash
# Resolve once. ZCODE_PLUGIN_ROOT points at the plugin root (…/localcortex);
# the helper is under skills/lc-create-from-template/scripts/lc.js.
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/lc-create-from-template/scripts/lc.js"
else
  LC_JS="<this skill's directory>/scripts/lc.js"  # parent dir of this SKILL.md
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

Every command below is invoked the same way. **Always pass free text (effort
name, template name, task name, notes, blocker ids) via env vars**, never
inline in argv — env vars are safe for quotes, newlines, backticks, and `$`.
UUIDs and the subcommand go in argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it (or
read the JSON directly). `effort-by-name` and `template-by-name` are
client-side composites (the app has no name-search command of its own); the
rest map 1:1 to sdef commands.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, match, candidates }` object |
| `templates-list` | — | — | JSON array of template records (`id`, `name`, `prompt`, `order`, …) |
| `template-by-name` | — | `LC_NAME` (req) | JSON `{ query, match, candidates }` object |
| `tasks-list` | `<effortId>` | `LC_INCLUDE_ARCHIVED=true` | JSON array of task-summary records (existing tasks, e.g. to reference as blockers) |
| `task-create` | `<effortId>` | `LC_NAME` (req), `LC_NOTES`, `LC_PARENT_ID`, `LC_DUE_DATE` (ISO) | JSON created task record |
| `task-update` | `<taskId>` | `LC_NAME`, `LC_NOTES`, `LC_STATUS`, `LC_WORKER`, `LC_WORKER_LABEL`, `LC_BLOCKERS` (comma-sep ids), `LC_CLEAR_BLOCKERS=true`, `LC_DUE_DATE` (ISO) | JSON updated task record |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |

- Statuses: `open`, `in_progress`, `blocked`, `completed`.
- Workers: `none`, `human`, `agent` (+ `worker_label`, e.g. `zcode`).
- `effort-by-name` / `template-by-name` match the record's own `name`
  case-insensitively, exact first then substring; `match` is `null` on zero or
  ambiguous matches.
- `create task` has **no `worker` param** — a new task defaults to
  `worker=none`. Apply an assignment afterwards via `task-update`
  (`LC_WORKER=agent LC_WORKER_LABEL=…`).
- `task-update` **`LC_BLOCKERS`** is a comma-separated list of task ids
  (`"id1,id2"`). Entering Blocked **requires** blockers — send
  `LC_STATUS=blocked` **and** `LC_BLOCKERS=<ids>` in the **same** call.
  `LC_CLEAR_BLOCKERS=true` sends an empty list, the sdef's revert path (clears
  blockers and reverts a Blocked task to open). Blockers must be in the same
  Effort; no self-blocking; no cycles.
- On this surface, **nil optional fields are explicit JSON `null`** (e.g.
  `parent_id`, `notes`, `due_date`). `has_notes`, `is_archived`, `worker`,
  `worker_label`, `status` are always present.

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
| `-1001` | validation — bad UUID/enum or missing required param. For `task-update`, most commonly Blocked-without-blockers ("… requires blockers"), a self/cyclic blocker, or a blocker in a different effort. |
| `-1002` | not_found — unknown effort/task/template/parent. |
| `-1003` | conflict — conflicting state. |

---

## The workflow

### Step 1 — Confirm the two required inputs

The run is defined by two things the user must provide:

- **Effort name** — the Effort to populate.
- **Template name** — the global Template whose prompt describes the tasks.

If either is missing or ambiguous, **ask** before doing anything else. Do not
invent an effort or guess a template. If the user cannot provide either after
being asked, **stop** — there is nothing to materialize from.

### Step 2 — Resolve the effort to exactly one match

```bash
LC_NAME='<effort name>' osascript -l JavaScript "$LC_JS" effort-by-name
```

- `match` is an object → use its `id`. Proceed.
- `match` is `null` with `candidates` → **list the candidates and ask the user
  which effort they mean.** Only proceed once it resolves to a single match.
- both `null` → tell the user no effort matched. Retry with
  `LC_INCLUDE_ARCHIVED=true` if it may be archived; otherwise stop.

### Step 3 — Resolve the template to exactly one match

```bash
LC_NAME='<template name>' osascript -l JavaScript "$LC_JS" template-by-name
```

- `match` is an object → use its `id` and `prompt`. Proceed.
- `match` is `null` with `candidates` → list them (id + name) and ask the user
  which template they mean.
- both `null` → tell the user no template matched. You can list everything with
  `templates-list` so they can pick; otherwise stop.

### Step 4 — Read the prompt and gather context

The template's `prompt` is free-text instructions describing what tasks to
create (roots, subtasks, ordering, due dates, assignments, blocking
dependencies). **Read it carefully** — it is the spec for this run.

Resolve the Effort's workspace folder for grounding context:

```bash
osascript -l JavaScript "$LC_JS" workspace-path "$EFFORT_ID"
```

If the path is non-`null`, treat the folder as the Effort's shared context:
list it and read any files that bear on how the tasks should be shaped (a
design doc, conventions, prior decisions). If `null`, proceed with just the
prompt.

### Step 5 — Create the tasks

For each task the prompt describes, create it:

```bash
LC_NAME='<task name>' \
LC_NOTES='<notes / the relevant slice of the prompt>' \
[LC_PARENT_ID='<parent task id>' LC_DUE_DATE='2030-01-15T09:00:00Z'] \
  osascript -l JavaScript "$LC_JS" task-create "$EFFORT_ID"
```

- Create **roots first**, then their **subtasks** — a subtask's `LC_PARENT_ID`
  must be an id you already created (or an existing task id in the same
  effort). Capture every returned `id`.
- Use `LC_NOTES` to carry the instructions for that task — the prompt usually
  has per-task detail; if it only has a single body, put a concise version on
  each task (or on the roots) so the work is self-describing later.
- `due date` is optional ISO-8601 (`2030-01-15T09:00:00Z`); omit when the
  prompt doesn't date the task. A subtask with no due date inherits its
  parent's.
- If you also want to reference **existing** tasks in the effort (e.g. as
  blockers), list them first with `tasks-list "$EFFORT_ID"` and collect ids.

### Step 6 — Update tasks (assignment and Blocked / blockers)

`create task` cannot set a worker or a Blocked state — do those with
`task-update` after the task exists.

**Assign a task** (worker kind + label):

```bash
LC_STATUS=in_progress LC_WORKER=agent LC_WORKER_LABEL='zcode' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

(`LC_STATUS` is optional; set it only when the prompt implies the task should
start somewhere other than the default `open`.)

**Block a task — set status and blockers TOGETHER in one call.** Entering
Blocked requires ≥1 blocker; the app rejects `status=blocked` with no
`blockers` (error `-1001`):

```bash
LC_STATUS=blocked LC_BLOCKERS='<blockerTaskId1>,<blockerTaskId2>' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

- `LC_BLOCKERS` is a **comma-separated** list of task ids, all in the same
  Effort as the blocked task.
- No self-blocking, no cycles (the app validates both).
- To **clear** blockers and revert a Blocked task to open, send
  `LC_CLEAR_BLOCKERS=true` (with no `LC_BLOCKERS`).
- You can also set `name` / `notes` / `due date` in the same `task-update`
  call when it makes sense.

### Step 7 — Report

Report plainly: the effort (name + id), the template (name + id), and the list
of created tasks — each task's name, id, final status, worker (if assigned),
and any blocker links (the ids it is blocked by). If anything failed mid-run,
say what was created and what failed, and leave the successfully-created tasks
in place (do not try to roll them back).

## Notes for the run

- **Make reasonable assumptions.** This is an interactive run — interpret the
  prompt, make the most reasonable shape (roots vs. subtasks, ordering,
  assignments, which tasks block which), and **record your interpretation** in
  the task notes. Ask only when the prompt is genuinely ambiguous.
- **Respect the blocker invariants.** Same-Effort only; no self-block; no
  cycles. Always send `LC_STATUS=blocked` and `LC_BLOCKERS=<ids>` in the same
  `task-update` call — never set Blocked on one call and blockers on another.
- **Don't touch unrelated tasks.** Only create and update the tasks the
  template describes. Don't re-assign, re-block, or complete pre-existing
  tasks.
- **Fail safe.** If a create or update errors mid-run, leave what was created
  in place and report the failure (with stderr) rather than retrying blindly
  or rolling back.
- **No recurrence / defer-date support in this helper.** `create task` /
  `update task` can take them on the app surface, but templates rarely drive
  them and they are out of scope here; edit recurrence/defer dates in the app
  UI if needed.

---

## Reporting to the user

Report the essentials plainly: the effort (name + id), the template (name +
id), and the created tasks (name + id, status, worker if assigned, and any
blocker links). If you disambiguated the effort or template among candidates,
say which one you landed on and why. If you interpreted an ambiguous prompt a
particular way, say so briefly so the user can adjust.
