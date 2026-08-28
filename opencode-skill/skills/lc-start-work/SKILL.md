---
name: lc-start-work
description: >-
  Do one task's worth of work on a named LocalCortex Effort — the macOS task
  manager app — on demand, for a given task id. Verifies the task exists in the
  effort, claims it, does the work, writes artifacts into the effort's
  workspace folder, and completes it — one task, then stops. It does NOT look
  tasks up by agent and does not care which agent (if any) the task is
  assigned to; it works exactly the task id it is handed. Drives LocalCortex
  through its JXA/AppleScript surface (osascript), not MCP. Use whenever the
  caller wants a single autonomous work-one-task-and-complete tick right now
  without setting up a recurring schedule — e.g. the lc-orchestrate-agents
  tick hands each spawned worker a specific task id to work. This is the same
  flow each scheduled tick of lc-start-job runs, just invoked once. Does not
  create a recurring job and does not chain sibling skills.
license: MIT
compatibility: opencode
---

# lc-start-work — work one caller-chosen task, on demand

Work a **specific task** (given by id) inside a named **Effort**: verify the
task exists in that effort, claim it, do its work, write any artifacts into the
Effort's workspace folder, and complete it — then stop. Work **only one task**
per invocation. This is exactly the flow each scheduled tick of
`lc-start-job` runs, and exactly what each worker spawned by
`lc-orchestrate-agents` runs; the difference is this skill runs it **once,
right now**, and does **not** create a recurring job.

The user provides the two inputs:

- **Effort name** — the Effort the task lives in (resolved to an id by name).
- **Task id** — the UUID of the task to work. This is the task the caller
  already chose (e.g. the orchestrator tick picks one open task per agent and
  hands its id here). This skill does **not** scan for an open task itself and
  does **not** care which agent (if any) the task is assigned to — it works
  whatever task id it is given, after confirming it belongs to the named
  effort.

Drive LocalCortex **exclusively through its JXA/AppleScript surface** via the
bundled `lc.js` helper — never use `mcp__localcortex__*` tools in this skill's
flow.

## When to use this skill

When the caller wants to run **one** autonomous "work this specific task and
complete it" tick **right now**, against a named Effort, **without** setting up
a recurring schedule. Examples: "work task `<id>` on Build", "do one tick of
work on task `<id>` under the Launch effort". The `lc-orchestrate-agents` tick
hands each spawned worker one of these prompts with a concrete task id.

## When NOT to use this skill

- The user wants this to keep happening **unattended on a schedule** (every 5
  minutes) → use `lc-start-job`, which sets up a recurring automation.
- The user wants to pick the next open task **by agent** (i.e. "find an open
  task for agent X and do it") → that selection now lives in
  `lc-orchestrate-agents`'s tick; this skill only works a caller-chosen task.
- The user only wants to **look up** an effort → use `lc-fetch-effort`.
- The user only wants to **look up** an agent's tasks → use
  `lc-fetch-agent-task`.
- The user wants to **complete a known task** → use `lc-complete-task`.
- There is no Effort and no task id in view → don't invent either. Ask.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used: `list efforts`, `get task`, `list tasks`,
  `create task`, `update task`, `complete task`, `workspace path`; `create
  task`'s `before` / `flagged today` parameters and the `is_flagged_today`
  record field need LocalCortex ≥ 0.4.7 — the stuck-reporting protocol
  degrades on older apps). Apple Events auto-launch the app if it
  isn't running — no "is the server up" check needed.
- The **first call from the OpenCode host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call.
- The app's scripting name is `LocalCortex`.

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`, in the skill's `scripts/` folder.
OpenCode installs skills under one of a few known directories and exposes no
skill-dir placeholder, so resolve the helper by skill name once and reuse
`$LC_JS` for every call:

```bash
LC_SKILL="lc-start-work"
LC_JS=""
for d in \
  ".opencode/skills/$LC_SKILL" ".agents/skills/$LC_SKILL" ".claude/skills/$LC_SKILL" \
  "$HOME/.config/opencode/skills/$LC_SKILL" "$HOME/.agents/skills/$LC_SKILL" "$HOME/.claude/skills/$LC_SKILL"; do
  [ -f "$d/scripts/lc.js" ] && { LC_JS="$d/scripts/lc.js"; break; }
done
[ -f "$LC_JS" ] || { echo "lc.js not found for $LC_SKILL" >&2; exit 1; }
```

Every command below is invoked the same way. **Always pass free text (effort
name, notes) via env vars**, never inline in argv — env vars are safe for
quotes, newlines, backticks, and `$`. UUIDs (task id, effort id) and the
subcommand go in argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints the app's JSON-string result to stdout — `JSON.parse` it (or
read the JSON directly). `effort-by-name` is a client-side composite (the app
has no name-search of its own); the rest map 1:1 to sdef commands.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, match, candidates }` object |
| `tasks-get` | `<taskId>` | — | JSON task record **with `notes`** (or not_found `-1002` if the id is unknown) |
| `tasks-list` | `<effortId>` | `LC_INCLUDE_ARCHIVED=true` | JSON flat ordered array of task-summary records — **no `notes`**, `has_notes` hint, statuses included, `parent_id` for tree grouping |
| `task-update` | `<taskId>` | `LC_NAME`, `LC_NOTES`, `LC_STATUS`, `LC_WORKER` (`none` or `agent`), `LC_BLOCKERS` (comma-separated ids), `LC_CLEAR_BLOCKERS=true`, `LC_FLAGGED_TODAY` (`true`/`false`, ≥ 0.4.7) | JSON updated task |
| `task-create` | `<effortId>` | `LC_NAME` (req), `LC_NOTES`, `LC_PARENT_ID`, `LC_BEFORE_ID` (≥ 0.4.7) | JSON task record |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |
| `task-complete` | `<taskId>` | `LC_COMPLETED=false` (default `true`) | JSON task record |

- Statuses: `open`, `in_progress`, `blocked`, `completed`.
- Workers: writable `none` or `agent`; `human` is a legacy read-only value
  (the app rejects writing it with `-1001`). This skill does not filter on
  `worker` — it works the task id it is given regardless of who owns it. An
  agent task carries its identity in `agent_id`; `worker_label` is a legacy
  read-back field (it can still name a stale human claim) and is empty for
  agent tasks.
- Entering Blocked requires `LC_STATUS=blocked` + `LC_BLOCKERS` in the same
  `task-update` call; `LC_CLEAR_BLOCKERS=true` sends the empty list (the
  revert path that clears blockers and returns the task to `open`);
  `LC_BLOCKERS` wins over `LC_CLEAR_BLOCKERS` if both are set.
- `effort-by-name` matches the effort's own `name` case-insensitively, exact
  first then substring; `match` is `null` on zero or ambiguous matches.
- On this surface, **nil optional fields are explicit JSON `null`** (e.g.
  `parent_id`, `notes`, `due_date`, `completed_at`, `agent_id`). `has_notes`,
  `is_archived`, `worker`, `worker_label`, `status`, `effort_id` are always
  present.
- `tasks-list` returns the effort's flat ordered list; grouping records on
  `parent_id` (JSON `null` = root) reconstructs the tree. An archived effort
  returns `-1002` unless `LC_INCLUDE_ARCHIVED=true`.

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
| `-1002` | not_found — unknown effort/task. `tasks-get` on an unknown task id returns this. |
| `-1003` | conflict — conflicting state |

---

## The workflow

### Step 1 — Confirm the two inputs

The run is defined by two things the caller must provide:

- **Effort name** — the Effort the task lives in (resolved to an id by name).
- **Task id** — the UUID of the task to work.

If either is missing, **ask** before doing anything else. Do not invent an
effort or guess a task id. (This skill does not resolve "an open task for
agent X" — the caller picks the task; if the caller means to pick by agent,
that is `lc-orchestrate-agents`'s job, not this skill's.)

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

### Step 3 — Fetch the task by id and verify it is workable

Fetch the task record (with notes) by its id:

```bash
osascript -l JavaScript "$LC_JS" tasks-get "$TASK_ID"
```

- **Non-zero exit with `-1002`** → the task id does not exist. Tell the user
  the task id was not found and **stop.** Do not claim or work anything.
- **Success** → `JSON.parse` the record and verify:
  - **It belongs to this effort** — `task.effort_id` must equal the effort id
    from Step 2. If it does not, the task is in a different effort: tell the
    user and **stop.** (This is the "check the task id exists [in this
    effort]" gate.)
  - **It is actionable** — `task.status` must be `"open"`. If it is
    `in_progress` (another worker already started it), `completed` (already
    done), or `blocked` (it has incomplete blockers), **do not touch it** —
    tell the user the task is not open and stop. Only an `open` task is
    claimed and worked.

Keep the parsed task record; its `name` (title) and `notes` (instructions)
are the work to do in Step 5.

### Step 4 — Claim the task, then re-read to confirm

Claim the task before doing any work. Claiming only flips the status — do
**not** set `worker` or `agent_id`; the task keeps whatever
assignment it already has (this skill does not care who owns it, and must not
clobber an existing agent assignment):

```bash
LC_STATUS=in_progress \
  osascript -l JavaScript "$LC_JS" task-update "$TASK_ID"
```

Then re-read it (`tasks-get "$TASK_ID"`) and confirm `status` is now
`in_progress`. If the claim did not take (another worker holds it, or the task
moved to `completed` / `blocked` between Step 3 and now), **stop** — do not
work a task you do not own.

### Step 5 — Do the work

The task record's `name` (the title) and `notes` describe the work. The
`notes` are the instructions; the `name` is the summary.

**Before the workspace folder, understand where this task sits — three cheap
reads, each best-effort (a missing or empty record is not an error):**

1. **Parent** — if `parent_id` is non-null, `tasks-get` it and read its
   name + notes: the group brief. Expect notes to be empty (common); the
   siblings below are usually where the real context lives.
2. **Blockers** — for each id in `blocker_ids`, `tasks-get` it and read its
   notes: upstream input or output to build on. Tolerate `-1002` (a stale
   edge to a deleted task) — note it and continue.
3. **Siblings** — `tasks-list "$EFFORT_ID"` once, then filter client-side:
   records whose `parent_id` equals this task's (or, for a root task, the
   other roots). Of those, `tasks-get` **completed** siblings whose
   `has_notes` is true — at most the **5 most recent by `completed_at`** —
   and read their completion notes: prior-round findings, artifact links,
   conventions to match. This channel, not the parent's notes, is where
   cross-round context actually flows.

Do **not** enumerate children of the task at hand — reading context is not
absorbing a subtree, and the one-task contract stands.

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
the task `in_progress` and stop, then run the stuck-reporting protocol's
guard (step 0 below): re-read the task — a `-1001` "Cannot complete — blocked
by …" means an incomplete blocker already exists, so the guard's
already-blocked branch applies (banner + report only, **no second
placeholder**). Tell the user; they (or another run) can pick
it up once the blocker is resolved.

If completion succeeded and `parent_id` is non-null, re-run
`tasks-list "$EFFORT_ID"` and look at this task's sibling group (same
`parent_id`, excluding this task). Every sibling `completed` → the final
report gains the line: **"parent X: all subtasks complete — yours to
close"** (X = the parent's name). Otherwise → "parent X: N open subtask(s)
remain". One extra list call; it makes the human's close-the-rollup job
visible instead of silent (completing subtasks never auto-completes the
parent — by design).

### Step 7 — One task, then stop

After completing one task, **stop**. Do not loop to another task in the same
invocation — if the caller wants more, it can invoke this skill again (with a
new task id), or use `lc-start-job` for a recurring worker. Report what you did.

## When the run gets stuck — fail-safe reporting protocol

**Trigger**: any **post-claim** failure — the work itself errored, or
`task-complete` failed other than via a pre-existing blocker. Pre-claim stops
(task id unknown, wrong effort, task not open, claim did not take) leave the
task untouched and report plainly — this protocol never fires there.

Ordered — cheapest-and-almost-unbreakable first, so a failure partway through
degrades gracefully:

0. **Guard — no double-reporting.** Re-read the task (`tasks-get`). Already
   `blocked` → banner + report only, **no second placeholder** (its blocker
   already exists; e.g. the Step 6 `-1001` path lands here). `in_progress` →
   full protocol. Use this fresh record's `notes` as the base for the banner
   (the Step 3 snapshot may be stale).
1. **Banner the task notes** — prepend to the existing notes (notes replace
   wholesale, so send `banner + "\n\n" + existing`):
   `⚠️ AGENT STUCK (timestamp) — reason / done so far / artifacts / resume
   hint / placeholder id once known / report-file path once known`.
2. **Write the workspace report** — create or append an episode section to
   `stuck-report-<TASK_ID>.md` in the effort workspace (only when
   `workspace-path` returned non-`null`; otherwise the banner carries
   everything).
3. **Create the placeholder as a sibling directly above** — `task-create`
   with `LC_NAME='🔔 Agent stuck: <task name> — human input needed'`,
   `LC_NOTES` = the full report, `LC_PARENT_ID` = the target's `parent_id`
   (unset for a root target), `LC_BEFORE_ID` = the target id.
4. **Propagate Today** — if the target's `is_flagged_today` is true (absent
   field = false, i.e. app < 0.4.7) → `task-update <placeholder>` with
   `LC_FLAGGED_TODAY=true`.
5. **Enter blocked atomically, banner amended** — one `task-update <target>`
   call with `LC_STATUS=blocked` + `LC_BLOCKERS=<placeholder id>` + `LC_NOTES`
   = banner now carrying the placeholder id and report path (banner +
   "\n\n" + the same existing notes). Re-read and confirm. Legal as one
   call — status/blockers/notes are independent fields.
6. **Stop** — never complete unfinished work.

**Guards**: exactly one *open* placeholder per stuck task; a
re-stuck-after-resume episode creates a fresh one (the old is completed) and
appends to the same report file; normal completion's Step 5 notes update
replaces the banner wholesale (it drops naturally); completed 🔔 placeholders
remain as audit trail.

**Degradation ladder** (steps 3–5 use ≥ 0.4.7-only surface parameters):
banner + report always run first; if `task-create` rejects `LC_BEFORE_ID`
(older app / arg error) → retry the create **without** it (append position;
the flag is still attempted); if the flag update rejects → skip it
(non-fatal); if the placeholder create itself fails → banner + report only.
The banner records whatever happened.

**Resolution**: the human reads the banner/report, resolves, then completes
(or deletes) the placeholder — completing a blocker reverts the target to
`open` (the same revert path as `LC_CLEAR_BLOCKERS`), so the next run/tick
re-claims it; deleting the placeholder drops the blocker edge the same way.

## Notes for the run

- **Make reasonable assumptions.** Unlike a fully headless scheduled tick, you
  *can* ask the user if something in the task notes is genuinely ambiguous —
  but prefer to make the most reasonable interpretation, do the work, and
  record your interpretation in the task notes. Do not block on trivia.
- **Do not create follow-up tasks.** This run completes the task it was handed;
  it does not create follow-up siblings. If a task clearly needs follow-up, say
  so in the task notes and leave it at that.
- **Fail safe.** On any post-claim failure, run the stuck-reporting protocol
  (section above) instead of stopping silently — never complete unfinished
  work.

---

## Reporting to the user

Report plainly: the effort (name + id), the task (title + id), and the
outcome — that you worked and completed it (a one-line summary of what you
did), or that you could not (the task id was not found, was not in this
effort, was not open, or could not be completed e.g. due to an incomplete
blocker — in which case it is left `in_progress`). When the task's sibling
group just finished, the report ends with the parent close-out line (Step 6).
No recurring job is created
by this skill, so there is nothing to "stop".
