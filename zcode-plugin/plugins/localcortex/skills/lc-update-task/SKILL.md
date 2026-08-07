---
name: lc-update-task
description: >-
  Update a LocalCortex task — the macOS task manager app — by id: change its
  name, notes, status, worker / worker_label, defer date, due date, or
  recurrence rule. Provide the task id plus the property→value pairs to change.
  Drives LocalCortex through its JXA/AppleScript automation surface
  (osascript), not MCP. Use whenever the user asks to edit / update / change /
  rename / reassign / re-date / set notes on / re-flag a known task, e.g.
  "rename task X to …", "mark task X blocked", "set the due date on …",
  "assign task X to claude", "add these notes to …". Reads the task first, then
  applies only the fields the user named; does not create, complete, or delete
  tasks. For starting/working/completing a task use the start-work skill.
argument-hint: "<taskId> [property value ...]"
allowed-tools: [Bash, Read]
version: 0.1.4
license: MIT
---

# lc-update-task — update a LocalCortex task by id

Update a single LocalCortex task — its name, notes, status, worker, defer date,
due date, or recurrence rule — given its task id and the property→value pairs
to change. Drive LocalCortex **exclusively through its JXA/AppleScript
surface** via the bundled `lc.js` helper — never use `mcp__localcortex__*`
tools in this skill's flow.

## When to use this skill

When the user points at a **specific task by id** and asks to **change one or
more of its fields**. Examples: "rename `062E31C1…` to …", "mark task X as
blocked", "set the due date on … to 2026-09-01", "assign task X to claude",
"add this note to …", "make task X repeat weekly".

The task id and the set of changes are the required inputs — see
[Collecting the changes](#collecting-the-changes) below for how to gather them.

## When NOT to use this skill

- The user wants to **start / pick up / work on** a task (claim it as
  `agent`, run the lifecycle, complete it, create a follow-up) → use
  `start-work`. That skill uses `task-update` internally to claim the task, but
  the lifecycle belongs to `start-work`, not here.
- The user wants to **complete** (or un-complete) a task → use `start-work`
  (`task-complete`). This skill's `task-update` is not the completion path, and
  `completed` is **not** a settable field here.
- The user wants to **create** a task → use `start-work` (`task-create`).
- The user wants to **find / look up** tasks or efforts (read-only) → use
  `lc-fetch-agent-task`, `lc-fetch-effort`, or `start-work`'s discovery flow.
- The user only has a task **name**, not an id → resolve it first with
  `start-work`'s discovery flow (or `lc-fetch-agent-task` if it is an
  agent-owned task inside a known effort), then come back here with the id.
- No task id is in view and the user is not pointing at a task → don't invent
  one.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used: `update task`, `get task`, optionally
  `workspace path`). Apple Events auto-launch the app if it isn't running — no
  "is the server up" check needed.
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
# the helper is under skills/lc-update-task/scripts/lc.js.
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/lc-update-task/scripts/lc.js"
else
  LC_JS="<this skill's directory>/scripts/lc.js"  # parent dir of this SKILL.md
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

Every command below is invoked the same way. **Always pass free text (task
name, notes) via the env vars**, never inline in argv — env vars are safe for
quotes, newlines, backticks, and `$`. The task id and the subcommand travel as
argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it
(or read the JSON directly). All three subcommands map 1:1 to the sdef
commands.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `task-update` | `<taskId>` | see [Update fields](#update-fields) below | JSON updated task record |
| `tasks-get` | `<taskId>` | — | JSON task record **with `notes`** |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |

### Update fields

`task-update` only changes the fields you set; omitted fields are left
unchanged by the app. Pass each field as an environment variable:

| env var | field | accepts |
|---|---|---|
| `LC_NAME` | name | any string |
| `LC_NOTES` | notes | any string (multi-line, markdown ok) |
| `LC_STATUS` | status | `open`, `in_progress`, `blocked`, `completed` (see warning below) |
| `LC_WORKER` | worker | `none`, `human`, `agent` |
| `LC_WORKER_LABEL` | worker_label | the agent's label (e.g. `zcode`) — meaningful only with `worker: agent` |
| `LC_DEFER_DATE` | defer date | full ISO-8601 datetime, e.g. `2026-09-01T09:00:00Z` (a date-only value like `2026-09-01` is rejected) |
| `LC_DUE_DATE` | due date | full ISO-8601 datetime, e.g. `2026-09-01T09:00:00Z` (date-only is rejected) |
| `LC_RECURRENCE` | recurrence | a JSON object with **all of** `frequency` (`daily`/`weekly`/`monthly`/`yearly`), `interval` (int), `anchor` (`due`/`defer`), `basis` (`fixed`/`after_completion`), `day_mode` (`day_of_month`/`weekday_position`) |

Notes on the field set:

- **At least one field must be provided** — a `task-update` with no fields is a
  no-op; the skill asks the user what to change before calling.
- **`completed` / `completed_at` are not settable here.** Use `start-work`
  (`task-complete`) to complete or un-complete a task. `completed_at` is
  populated by completion; setting `LC_STATUS=completed` only flips the status
  flag and does **not** run the completion side effects (subtree cascade,
  recurrence spawn), so do not use this skill to complete a task.
- **`worker` + `worker_label` are independent keys.** To assign to an agent,
  set `LC_WORKER=agent` **and** `LC_WORKER_LABEL=<label>`; to assign to a
  human, `LC_WORKER=human` (the label is ignored); to unassign, `LC_WORKER=none`.
- **`parent_id` / `effort_id` are not settable** — a task's place in the tree
  is fixed at creation; the surface has no move. Changing either is not
  supported.
- On this surface, **nil optional fields are explicit JSON `null`** (e.g.
  `parent_id`, `due_date`, `completed_at`, `recurrence`). So `parent_id === null`
  means "root task". `has_notes`, `is_archived`, `worker`, `worker_label` are
  always present.

### Errors

Every failure — a helper usage error, bad recurrence JSON, or an app-level
failure — makes `osascript` exit non-zero with a one-line message on **stderr**
of the form `<path>: execution error: Error: <message> (-NNNN)`. On success the
JSON result is the only thing on stdout (exit 0). So: **on non-zero exit, read
stderr for the reason; don't try to parse stdout.**

App-level error numbers (from LocalCortex):

| Number | Meaning |
|---|---|
| `-2700` | App not found / not scriptable — install or rebuild LocalCortex. Also the number osascript itself uses for a thrown helper error. |
| `-1001` | validation — bad UUID/date/enum or missing required param |
| `-1002` | not_found — unknown task |
| `-1003` | conflict — conflicting state |

---

## The workflow

### Collecting the changes

Before calling `task-update`, gather from the user (or the request) **all**
field→value pairs to apply. This skill edits only the fields the user named —
do not infer extra changes. If the request is vague ("update task X"), ask
**what** to change (which fields, to what values) before doing anything.

Typical, well-formed requests and the fields they imply:

- "rename task X to …" → `LC_NAME`
- "set the notes on … to …" / "add this to the notes" → `LC_NOTES`
- "mark task X blocked / in progress / open" → `LC_STATUS`
- "set the due date / defer date on … to 2026-09-01" → `LC_DUE_DATE` /
  `LC_DEFER_DATE` (pass a full datetime like `2026-09-01T09:00:00Z` — the app
  rejects a date-only value)
- "assign task X to claude / to me / unassign" → `LC_WORKER` (+`LC_WORKER_LABEL`
  for an agent)
- "make task X repeat weekly" → `LC_RECURRENCE` (build the full JSON object;
  ask the user for any of the five required keys they did not specify, default
  `interval: 1`, `basis: fixed`, `anchor: due`, `day_mode: day_of_month` only
  if the user would obviously agree — otherwise ask)

Multiple changes in one request are fine — set all the corresponding env vars
in a single `task-update` call.

> **Status warning.** If the user's goal is to **finish** a task ("complete
> it", "mark done", "close it"), **stop** — this skill is the wrong tool. Use
> `start-work` (`task-complete`), which runs the completion side effects. Here,
> only set `LC_STATUS` to `completed` if the user explicitly wants to flip the
> flag **without** completing (rare, and usually a mistake).

### Step 1 — Read the task first (confirm you have the right one)

Before changing anything, fetch the task by id to confirm it exists and to see
its current state. This avoids editing the wrong task and gives a baseline for
reporting what changed.

```bash
osascript -l JavaScript "$LC_JS" tasks-get "$TASK_ID"
```

On non-zero exit (e.g. `-1002` not_found), tell the user the task id was not
found and stop. On success, you have the current record.

### Step 2 — Apply the update

Set one env var per field the user asked to change, then run `task-update`:

```bash
# Example: rename + set status + assign to an agent, in one call.
LC_NAME='<new name>' \
LC_STATUS=blocked \
LC_WORKER=agent \
LC_WORKER_LABEL=zcode \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

Free-text fields (`LC_NAME`, `LC_NOTES`) are safe for quotes, newlines,
backticks, and `$` because they travel via env, not argv.

For a **recurrence** change, pass the full JSON object:

```bash
LC_RECURRENCE='{"frequency":"weekly","interval":1,"anchor":"due","basis":"fixed","day_mode":"day_of_month"}' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

### Step 3 — Verify and report

`task-update` returns the updated task record; the change is already applied.
Compare the returned field(s) to the baseline from Step 1 and **report to the
user what changed** (field → old → new). If a field did not change despite
being set, surface that (it usually means the value was rejected or was already
that value).

If you need a clean re-read (e.g. the caller modified `LC_NOTES` and you want
to be sure of the stored formatting), `tasks-get` it again.

### Reporting to the user

Report the essentials plainly — which task (id + name), which fields changed,
and their new values. Do not dump the whole task record unless the user asks.
If nothing actually changed (the values were already as requested), say so.

## Examples

Rename a task:

```bash
LC_NAME='Wire up the update-task skill' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

Mark a task blocked and reassign to the user:

```bash
LC_STATUS=blocked LC_WORKER=human \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

Set notes (multi-line is safe via the env var):

```bash
LC_NOTES='Decision: ship behind a flag.

Owner: Colin.' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

Set a due date:

```bash
LC_DUE_DATE=2026-09-01T09:00:00Z \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```
