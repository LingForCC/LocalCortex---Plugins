---
name: start-work
description: >-
  Start, pick up, resume, or work on a LocalCortex task — the macOS task
  manager app. Drives LocalCortex through its JXA/AppleScript automation
  surface (osascript), not MCP. Use whenever the user points to a LocalCortex
  task (by id or by name) and asks to start it, work on it, pick it up, take
  it, resume it, or find it before doing the work — even if they don't say
  "start" explicitly. Handles the full lifecycle: discover the task, claim it,
  collect (not create) a follow-up, write artifacts into the effort folder,
  complete the task, then create the follow-up as a sibling.
argument-hint: "[task-id | task name | effort name]"
allowed-tools: [Bash, Read, Write, Edit]
version: 0.1.4
license: MIT
---

# start-work — LocalCortex task lifecycle

Implement the LocalCortex task workflow described below. Drive LocalCortex
**exclusively through its JXA/AppleScript surface** via the bundled `lc.js`
helper — never use `mcp__localcortex__*` tools in this skill's flow.

## When to use this skill

Only when the user **explicitly points to a LocalCortex task** (by id or name)
and asks to start it / work on it / pick it up / resume it / find it before
doing the work. Not every session starts from a LocalCortex task — if there
is no task in view, do not invoke this skill and do not invent one.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands: `list efforts`, `list tasks`, `get task`,
  `workspace path`, `create task`, `update task`, `complete task`). Apple
  Events auto-launch the app if it isn't running — no "is the server up"
  check is needed.
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
# the helper is under skills/start-work/scripts/lc.js.
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/start-work/scripts/lc.js"
else
  LC_JS="<this skill's directory>/scripts/lc.js"  # parent dir of this SKILL.md
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

Every command below is invoked the same way. **Always pass free text (task
name, notes) via env vars**, never inline in argv — env vars are safe for
quotes, newlines, backticks, and `$`. UUIDs and the subcommand go in argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it
(or read the JSON directly). All seven subcommands map 1:1 to the sdef
commands.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `efforts-list` | — | `LC_INCLUDE_ARCHIVED=true` | JSON array of efforts |
| `tasks-list` | `<effortId>` | `LC_INCLUDE_ARCHIVED=true` | JSON array of task summaries (no notes; has `has_notes`) |
| `tasks-get` | `<taskId>` | — | JSON task record **with `notes`** |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |
| `task-create` | `<effortId>` | `LC_NAME` (req), `LC_NOTES`, `LC_DUE_DATE`, `LC_PARENT_ID`, `LC_RECURRENCE` | JSON created task |
| `task-update` | `<taskId>` | `LC_NAME`, `LC_NOTES`, `LC_STATUS`, `LC_DEFER_DATE`, `LC_DUE_DATE`, `LC_WORKER`, `LC_WORKER_LABEL`, `LC_RECURRENCE` | JSON updated task |
| `task-complete` | `<taskId>` | `LC_COMPLETED=false` (default true) | JSON task record |

- Statuses: `open`, `in_progress`, `blocked`, `completed`.
- Workers: `none`, `human`, `agent`.
- `LC_RECURRENCE` must be a JSON object with all of: `frequency`
  (`daily`/`weekly`/`monthly`/`yearly`), `interval` (int), `anchor`
  (`due`/`defer`), `basis` (`fixed`/`after_completion`), `day_mode`
  (`day_of_month`/`weekday_position`).
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
| `-1002` | not_found — unknown effort/task/parent |
| `-1003` | conflict — conflicting state |

---

## The workflow

### Discovery

If the user gave a **task id directly**, skip the list flow — `tasks-get` on it
straight away.

Otherwise resolve the task via:

1. `efforts-list` → list all Efforts (top-level containers).
2. `tasks-list <effortId>` → flat list of task summaries for one Effort.
   **Notes are NOT included** in this index, but each row has a `has_notes`
   boolean hint.
3. `tasks-get <taskId>` → full record **only** for tasks whose `has_notes` is
   `true` (and the one you're about to work on). Don't fetch notes you won't use.

Reconstruct the task tree by grouping on `parent_id` (`null` = root).

Resolve an Effort's on-disk workspace folder with `workspace-path <effortId>`
**before** reading or writing effort files. The result is the absolute path
string, or `null` when no root folder is configured / the Effort hasn't been
materialized.

### Step 1 — Starting the work

When the task is found and the user asks you to start:

```bash
LC_STATUS=in_progress LC_WORKER=agent LC_WORKER_LABEL=zcode \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

Then **re-read the task** (`tasks-get`) and confirm its `worker` is `agent`
**and** `worker_label` is `zcode`. If it isn't, **stop and double-check with
the user that you found the correct task** before doing any further work — a
mismatch usually means the wrong task was claimed or another worker holds it.

### Step 2 — Follow-up task: collect the info, do NOT create it yet

A task may need a follow-up once it is done — what it is depends on the
situation. **If the user hasn't told you**, ask them **before** you start the
work:

- What the follow-up needs to be (a concrete description).
- Who will do it: the user (→ worker `human`), or an agent (→ worker `agent`
  + the agent's label).

This step is **only** about collecting that information. Do **not** create the
follow-up task here — not now, and not at any point during the work.

### Step 3 — Artifacts

When the work produces information worth keeping in files (a design plan,
review feedback, a decision log, …), write them into the **workspace folder of
the Effort the task belongs to** (resolve it with `workspace-path`). Use the
`Write` and `Edit` tools for those files.

Then put the **file link(s) plus a brief, concise summary** into the notes of
**both**:

- the task you're working on (update via `task-update` with `LC_NOTES`), and
- the follow-up task — when it is created in Step 4.

```bash
# Append/replace notes on the task being worked (build LC_NOTES from the
# summary + file links). Multi-line content is safe via the env var.
LC_NOTES='Design plan: see design.md

Follow-up: write integration tests (owner: agent/zcode).' \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

### Step 4 — Completion: NOW create the follow-up task

When the work is done:

1. **Complete the task** — do not wait for the user to tell you:

   ```bash
   osascript -l JavaScript "$LC_JS" task-complete "$TASK_ID"
   ```

   Completing also completes the whole subtask subtree, and spawns a fresh
   recurring copy if the task carries a recurrence rule.

2. **Only now, after the original task is completed**, create the follow-up
   task collected in Step 2 (creating it any earlier is wrong):

   - It is a **sibling** of the completed task — **not a child** — so that
     completing the original task never cascades onto the follow-up.
   - **Worker**: `human` if the user does it; `agent` + the given label if an
     agent does it.
   - **Leave the follow-up's defer date and due date empty** — do not set
     either.

   "Sibling" is a structural requirement, not a loose description — get it
   right mechanically:

   - A sibling **shares the completed task's `parent_id`**. Re-read the
     completed task (you have its full `tasks-get` output) and pass the
     **same** `parent_id` to `task-create`. If the completed task was itself a
     root (`parent_id` is `null`/absent), the follow-up is a root too. Do
     **not** guess "root is fine" — mirror whatever the completed task's
     parent is.
   - **`LC_PARENT_ID` gotcha:** to create a **root** sibling, **omit
     `LC_PARENT_ID` entirely** — do not set it to the string `"null"`.
     To create a nested sibling, set `LC_PARENT_ID` to the parent task's UUID.

   ```bash
   # NESTED sibling: completed task had a parent → mirror its parent_id.
   LC_NAME='<follow-up description>' \
   LC_NOTES='<summary + file links, same as on the original task>' \
   LC_PARENT_ID='<completed task's parent_id>' \
     osascript -l JavaScript "$LC_JS" task-create "$EFFORT_ID"

   # ROOT sibling: completed task was a root → OMIT LC_PARENT_ID entirely.
   LC_NAME='<follow-up description>' \
   LC_NOTES='<summary + file links>' \
     osascript -l JavaScript "$LC_JS" task-create "$EFFORT_ID"
   ```

   Then set the worker on the **newly created** follow-up:

   ```bash
   # If the user owns it:
   LC_WORKER=human osascript -l JavaScript "$LC_JS" task-update "$NEW_TASK_ID"
   # If an agent owns it (use the label collected in Step 2):
   LC_WORKER=agent LC_WORKER_LABEL='<label>' \
     osascript -l JavaScript "$LC_JS" task-update "$NEW_TASK_ID"
   ```

3. **Verify placement.** Re-read the created follow-up (`tasks-get`) and
   confirm its `parent_id` **equals** the completed task's `parent_id`. If it
   doesn't match, you placed it wrong — recreate it correctly (the surface has
   no move/delete), and **tell the user to delete the stray**.
