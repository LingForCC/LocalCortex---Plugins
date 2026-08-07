---
name: lc-complete-task
description: >-
  Complete (or reopen) a LocalCortex task — the macOS task manager app — by id.
  Provide the task id; the skill marks it complete (the default) or reopens it.
  Completing also completes the whole subtask subtree, auto-unblocks any task
  that was waiting on it, and spawns a fresh open copy if the task carries a
  recurrence rule. Drives LocalCortex through its JXA/AppleScript automation
  surface (osascript), not MCP. Use whenever the user asks to complete / finish
  / mark done / close / wrap up / reopen / un-complete a known task, e.g.
  "complete task X", "mark … done", "reopen task X", "un-complete …". Only the
  completion transition lives here; it does not create, rename, re-date, or
  delete tasks. For the full lifecycle (claim, work, complete + create a
  follow-up) use the start-work skill.
argument-hint: "<taskId>"
allowed-tools: [Bash, Read]
version: 0.1.6
license: MIT
---

# lc-complete-task — complete (or reopen) a LocalCortex task by id

Complete a single LocalCortex task — or reopen one — given its task id. Drive
LocalCortex **exclusively through its JXA/AppleScript surface** via the bundled
`lc.js` helper — never use `mcp__localcortex__*` tools in this skill's flow.

## When to use this skill

When the user points at a **specific task by id** and asks to **complete it** or
**reopen it**. Examples: "complete task `062E31C1…`", "mark task X done",
"close …", "wrap up …", "reopen task X", "un-complete …".

The task id is the required input — see [Confirm the task](#confirm-the-task)
below for how to verify it before acting.

## When NOT to use this skill

- The user wants the **full lifecycle** — discover the task, claim it as an
  agent, do the work, complete it, and create a follow-up sibling → use
  `start-work`. That skill runs `task-complete` internally as its completion
  step, but the lifecycle (claiming, artifacts, follow-up) belongs there, not
  here. Reach for this skill only when the user wants the completion
  transition by itself on a task already in view.
- The user wants to **create / rename / re-date / reassign / set notes on** a
  task (any field edit) → `start-work` does not edit arbitrary fields either;
  completion is the only mutation this skill performs.
- The user only has a task **name**, not an id → resolve it first with
  `start-work`'s discovery flow (or `lc-fetch-agent-task` if it is an
  agent-owned task inside a known effort), then come back here with the id.
- The user wants to **find / look up** tasks or efforts (read-only) → use
  `lc-fetch-agent-task`, `lc-fetch-effort`, or `start-work`'s discovery flow.
- No task id is in view and the user is not pointing at a task → don't invent
  one.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used: `complete task`, `get task`, optionally
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
# the helper is under skills/lc-complete-task/scripts/lc.js.
if [ -n "$ZCODE_PLUGIN_ROOT" ]; then
  LC_JS="$ZCODE_PLUGIN_ROOT/skills/lc-complete-task/scripts/lc.js"
else
  LC_JS="<this skill's directory>/scripts/lc.js"  # parent dir of this SKILL.md
fi
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

Every command below is invoked the same way. The task id and the subcommand
travel as argv; the only optional input, the `completed` flag, goes via the
`LC_COMPLETED` env var.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it
(or read the JSON directly). All three subcommands map 1:1 to the sdef
commands.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `task-complete` | `<taskId>` | `LC_COMPLETED=false` (default `true`) | JSON updated task record |
| `tasks-get` | `<taskId>` | — | JSON task record **with `notes`** |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |

### What completion does

`task-complete` calls the sdef `complete task` command. Its semantics matter
for what you should expect and report:

- **Default is complete.** Omitting `LC_COMPLETED` (or setting it `true`)
  completes the task and stamps `completed_at`. Setting `LC_COMPLETED=false`
  reopens it (status → `open`) and clears `completed_at`.
- **Subtree cascade.** Completing a task also completes its whole subtask
  subtree, and clears the `worker` on every completed task. Reopening does
  **not** cascade to descendants — they stay as they were — but it **does**
  reopen every completed ancestor up the parent chain (a completed task always
  means its whole subtree is done).
- **Blocker gate.** Completion is **rejected** (`-1001` validation) if the
  task or **any descendant** in the cascade subtree has an incomplete blocker.
  The error message names the offending task(s) — "Cannot complete — blocked
  by …". The fix is to **complete the blockers first**, then retry. Do not
  try to work around this by setting `status` elsewhere; the gate is absolute.
- **Auto-unblock.** When a completion makes another task's blockers all
  complete, that task auto-reverts from `blocked` to `open`. This is a side
  effect, not something you call.
- **Recurrence spawn.** If the completed task (not a cascade-completed
  descendant — only the directly-completed one) carries a recurrence rule, a
  fresh **open** copy is spawned with the next occurrence's defer/due dates;
  the completed instance stays in history. Reopening never spawns.
- **Reopen redirect.** Reopening a task that still has an **incomplete
  blocker** lands it at `blocked` instead of `open` (blockers all complete or
  removed → lands at `open`). If the user reopens and the result is
  `blocked` rather than `open`, that is why — surface it.

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
| `-1001` | validation — most commonly the blocker gate ("Cannot complete — blocked by …"); also a malformed task id. Complete the blockers first, then retry. |
| `-1002` | not_found — unknown task |
| `-1003` | conflict — conflicting state |

---

## The workflow

### Confirm the task

Before completing anything, fetch the task by id to confirm it exists and to
see its current state (status, worker, whether it has a recurrence rule or
children). This avoids completing the wrong task and gives a baseline for
reporting what changed.

```bash
osascript -l JavaScript "$LC_JS" tasks-get "$TASK_ID"
```

On non-zero exit (e.g. `-1002` not_found), tell the user the task id was not
found and stop. On success you have the current record — note its `status`
and, if it has children you care about, that the completion will cascade onto
them.

### Step 1 — Complete (or reopen) the task

```bash
# Complete (the default — LC_COMPLETED may be omitted):
osascript -l JavaScript "$LC_JS" task-complete "$TASK_ID"

# Reopen:
LC_COMPLETED=false osascript -l JavaScript "$LC_JS" task-complete "$TASK_ID"
```

### Step 2 — Verify and report

`task-complete` returns the updated task record; the transition is already
applied. Compare the returned `status` / `completed_at` to the baseline and
**report to the user what changed**:

- For a completion: confirm it is now `completed`, that `completed_at` is set,
  and mention the **side effects** that fired — the subtree cascade (if it had
  children), the auto-unblock of any task it was blocking, and the recurrence
  spawn (if it carries a recurrence rule, a fresh open copy was created).
- For a reopen: confirm the new status. If it landed at `blocked` instead of
  `open` (reopen redirect), say so and name the still-incomplete blocker(s).

If the call failed with `-1001` and a "Cannot complete — blocked by …"
message, **do not retry blindly** — tell the user which task(s) block the
completion, and that those blockers must be completed first. Offer to complete
the blocker if the user wants.

### Reporting to the user

Report the essentials plainly — which task (id + name), the transition
(completed / reopened), and the side effects that matter (subtree cascade,
auto-unblock, recurrence spawn, reopen redirect). Do not dump the whole task
record unless the user asks. If nothing meaningful changed (e.g. completing an
already-completed task is a no-op), say so.

## Examples

Complete a task:

```bash
osascript -l JavaScript "$LC_JS" task-complete "$TASK_ID"
```

Reopen a task:

```bash
LC_COMPLETED=false osascript -l JavaScript "$LC_JS" task-complete "$TASK_ID"
```

Confirm before completing (read-only):

```bash
osascript -l JavaScript "$LC_JS" tasks-get "$TASK_ID"
```
