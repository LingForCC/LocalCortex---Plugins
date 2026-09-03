---
name: lc-skill-creator
description: >-
  Create or revise an OpenCode skill that drives the LocalCortex macOS task
  manager app through its JXA/AppleScript automation surface (osascript). The
  authoritative guide to the full twelve-command LocalCortex scripting surface
  — list efforts/templates/tasks/agents, get task, workspace path,
  create/update/complete task, create/update/delete agent — plus the record
  DTO shapes, the env-var/argv calling convention, the bundled lc.js helper
  pattern, and an honest account of what JXA automation CANNOT do (no name
  search, no date or recurrence clearing, templates read-only, file bytes
  never cross the wire, efforts are UI-only, etc.). Use when the user wants to
  build a new lc-* skill, automate a LocalCortex workflow the existing skills
  don't cover, or learn the JXA surface to hand-roll automation. Generated
  skills copy this skill's bundled lc.js and trim it to the commands they
  need.
license: MIT
compatibility: opencode
---

# lc-skill-creator — author skills that drive LocalCortex over JXA

This skill is a **meta-skill**: it exists to help the user create, extend, or
understand **other** skills that automate the **LocalCortex** macOS task manager
through its **JXA / AppleScript scripting surface** (`osascript`), with no MCP
server required. It is the single authoritative reference, inside the plugin,
for what that surface can and cannot do.

LocalCortex exposes **twelve** AppleScript commands (the sdef — see
`LocalCortex.sdef` in the `LocalCortex---Swift` repo). This skill documents all
twelve, their exact argument and result shapes, the calling conventions every
`lc-*` skill follows, and — honestly — the things automation **cannot** do
(which the user must be told about rather than silently working around).

## When to use this skill

- The user wants to **create a new `lc-*` skill** that automates a LocalCortex
  workflow the existing skills don't cover (e.g. a weekly review skill, a
  "snooze my day" skill, a reporting/dashboard skill).
- The user wants to **extend or fix** an existing `lc-*` skill and needs to know
  the surface, DTO shapes, or conventions.
- The user wants to **understand the JXA surface** to hand-roll a one-off
  automation (without necessarily packaging a skill).

## When NOT to use this skill

- The user wants to **work a specific task** → use `lc-start-work`.
- The user wants to **populate an effort from a template** → use
  `lc-create-from-template`.
- The user wants to **look up an effort** → use `lc-fetch-effort`.
- The user wants **recurring multi-agent delegation** → use
  `lc-orchestrate-agents` / `lc-orchestrate-agent-goal`.
- The user wants to drive LocalCortex through **MCP** (not JXA) → this plugin is
  JXA-only; point them at the app's MCP surface instead.

## Prerequisites

- The **LocalCortex** macOS app, built with the AppleScript/JXA surface
  (scripting name `LocalCortex`). Build it from the `LocalCortex---Swift` repo.
  Apple Events auto-launch the app if it isn't running — no "is the server up"
  check needed.
- The **first call from the OpenCode host binary triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call.
- Source of truth for the surface: `macOS/Scripting/LocalCortex.sdef` (the
  dictionary), `macOS/Scripting/AutomationBridge.swift` (DTO ↔ record
  translation + error mapping), and `macOS/Scripting/AgentOperations.swift`
  (the shared operation core). Read them when accuracy matters.

## Helper setup (do this once, up front)

`lc.js` lives next to this `SKILL.md`, in the skill's `scripts/` folder.
OpenCode installs skills under one of a few known directories and exposes no
skill-dir placeholder, so resolve the helper by skill name once and reuse
`$LC_JS` for every call:

```bash
LC_SKILL="lc-skill-creator"
LC_JS=""
for d in \
  ".opencode/skills/$LC_SKILL" ".agents/skills/$LC_SKILL" ".claude/skills/$LC_SKILL" \
  "$HOME/.config/opencode/skills/$LC_SKILL" "$HOME/.agents/skills/$LC_SKILL" "$HOME/.claude/skills/$LC_SKILL"; do
  [ -f "$d/scripts/lc.js" ] && { LC_JS="$d/scripts/lc.js"; break; }
done
[ -f "$LC_JS" ] || { echo "lc.js not found for $LC_SKILL" >&2; exit 1; }
```

Every command is invoked the same way:

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

The bundled `lc.js` is the **canonical, full-surface** helper — it covers all
twelve sdef commands plus the three client-side by-name composites. A generated
skill should **copy this `lc.js` and trim it** to just the commands that skill
needs (see the workflow below). You can also run it directly to introspect the
live app while designing a skill (e.g. `agents-list` to show real output).

---

## The LocalCortex JXA surface (authoritative)

A command-based (verb) sdef — **not** a scriptable object model. The twelve
commands map 1:1 to the twelve `AgentOperations` methods.

### Output shape (read carefully)

**Every command returns a JSON `text` string** (`<result type="text">`). The
helper echoes that string verbatim to stdout; the caller `JSON.parse`'s it.
Parsed-JSON labels are exactly the DTO `CodingKeys` (**snake_case**:
`task_id`, `effort_id`, `worker_label`, `is_archived`, `has_notes`, …). Dates
are no-fractional ISO-8601 (`…T09:00:00Z`). **Nil optional fields are an
explicit JSON `null`** (`parent_id`, `due_date`, `completed_at`, `recurrence`,
`agent_id`, `defer_date`, `workspace_folder_name`, …), so key-presence checks
(`'parent_id' in obj`) always see the key — branch on `=== null`, not on
presence.

The JSON-string return is deliberate: returning the `NSDictionary` directly
fails Cocoa Scripting's result coercion (`-1708`), and an AppleScript record
keys fields by 4-char OSType codes and would lose the snake_case labels. JSON
keeps them intact.

### Calling convention

- **Free text** (effort/task/agent/template names, notes, model, tool, prompt)
  is passed via **environment variables**, never inline in argv —
  env vars are safe for quotes, newlines, backticks, and `$`. Each command's
  table lists its env vars.
- **UUIDs** (task/effort/agent ids) and the **subcommand** travel as **argv**.
- The helper reads env with `NSProcessInfo`; an unset env var and an empty
  string both mean "not provided" (the key is omitted, matching the sdef's
  optional semantics).
- **JXA method names** are the camelCase of the sdef verb, and sdef params map
  to camelCase keys: `list efforts` → `app.listEfforts({includeArchived})`;
  `in effort` → `inEffort`; `with name` → `withName`; `due date` → `dueDate`;
  `defer date` → `deferDate`; `thinking effort` → `thinkingEffort`;
  `agent id` → `agentId`. A command's
  **direct parameter** (e.g. the task id on `get task`) is the first positional
  argument to the JXA method: `app.getTask(taskId)`,
  `app.updateTask(taskId, opts)`.

### Errors

Every failure — a helper usage error, or an app-level failure — makes
`osascript` exit non-zero with a one-line message on **stderr** of the form
`<path>: execution error: Error: <message> (-NNNN)`. On success the JSON result
is the only thing on stdout (exit 0). **On non-zero exit, read stderr for the
reason; don't try to parse stdout.**

App-level error numbers (from LocalCortex):

| Number | Meaning |
|---|---|
| `-2700` | App not found / not scriptable — install or rebuild LocalCortex. Also the number osascript itself uses for a thrown helper error. |
| `-1001` | validation — bad UUID/enum, missing required param, or a rule violation (e.g. completing a task that has an incomplete blocker; entering `blocked` without blockers; unknown `agent_id`). |
| `-1002` | not_found — unknown effort/task/agent/parent/blocker; also returned by `list tasks` on an archived effort unless `include archived` is passed. |
| `-1003` | conflict — conflicting state. |

---

## Command reference

Subcommands in the bundled `lc.js`. "argv" = positional args; "env" = env vars.

### Read commands

| subcommand | argv | env | returns |
|---|---|---|---|
| `efforts-list` | — | `LC_INCLUDE_ARCHIVED=true` | JSON array of all efforts |
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | `{ query, match, candidates }` |
| `templates-list` | — | — | JSON array of all templates (read-only) |
| `template-by-name` | — | `LC_NAME` (req) | `{ query, match, candidates }` |
| `tasks-list` | `<effortId>` | `LC_INCLUDE_ARCHIVED=true` | JSON array of task summaries (no notes) |
| `tasks-get` | `<taskId>` | — | JSON task record **with notes** |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |
| `agents-list` | — | — | JSON array of all agents |
| `agent-by-name` | — | `LC_NAME` (req) | `{ query, match, candidates }` |

### Write commands (tasks)

| subcommand | argv | env (all optional unless noted) | returns |
|---|---|---|---|
| `task-create` | `<effortId>` | `LC_NAME` (req), `LC_NOTES`, `LC_PARENT_ID`, `LC_DUE_DATE`, `LC_RECURRENCE` | created task record |
| `task-update` | `<taskId>` | `LC_NAME`, `LC_NOTES`, `LC_STATUS`, `LC_WORKER` (`none` or `agent`), `LC_AGENT_ID`, `LC_DEFER_DATE`, `LC_DUE_DATE`, `LC_RECURRENCE`, `LC_BLOCKERS`, `LC_CLEAR_BLOCKERS=true` | updated task record |
| `task-complete` | `<taskId>` | `LC_COMPLETED=false` (default `true`) | updated task record |

### Write commands (agents)

| subcommand | argv | env | returns |
|---|---|---|---|
| `agent-create` | — | `LC_NAME` (req), `LC_TOOL`, `LC_MODEL`, `LC_THINKING_EFFORT` | created agent record |
| `agent-update` | `<agentId>` | `LC_NAME`, `LC_TOOL`, `LC_MODEL`, `LC_THINKING_EFFORT` | updated agent record |
| `agent-delete` | `<agentId>` | — | deleted agent record |

---

## Record shapes (DTO CodingKeys)

**Effort** — `id, name, summary, workspace_folder_name, created_at, updated_at,
is_archived`.

**Task (full, `get task` / create / update / complete)** — `id, effort_id, name,
notes, status, defer_date, due_date, completed_at, order, created_at,
updated_at, parent_id, recurrence, worker, worker_label, agent_id,
blocker_ids`.

**Task summary (`list tasks`)** — same as the full task **except** `notes` is
omitted and `has_notes` (boolean) is added. Reconstruct the tree by grouping on
`parent_id` (`null` = root).

**Template** — `id, name, prompt, order, created_at, updated_at`. Read-only on
this surface.

**Agent** — `id, name, model, thinking_effort, tool, order, created_at,
updated_at`.

**Recurrence rule** (nested `recurrence` object) — `frequency`
(`daily`/`weekly`/`monthly`/`yearly`), `interval` (integer), `anchor`
(`due`/`defer`), `basis` (`fixed`/`after_completion`), `day_mode`
(`day_of_month`/`weekday_position`). **All five keys are required** when a
recurrence is supplied. Pass it from the helper as a JSON object string in
`LC_RECURRENCE`, e.g.:
`LC_RECURRENCE='{"frequency":"weekly","interval":1,"anchor":"due","basis":"fixed","day_mode":"day_of_month"}'`.

### Enum string values

- `status` — `open`, `in_progress`, `blocked`, `completed`.
- `worker` — writable `none` or `agent`; `human` survives as a legacy
  read-only value on records claimed before 0.3.11.
- (Recurrence enums as above.)

### By-name composites

`effort-by-name` / `template-by-name` / `agent-by-name` each return:

```json
{ "query": "<name>", "match": { "id": "…", "name": "…", … } | null,
  "candidates": [ { … }, … ] | null }
```

- Exactly one match → `match` is that record (exact name match wins; else a
  single substring match).
- Several matches → `match` is `null`, `candidates` lists them — **ask the user
  to disambiguate; do not guess.**
- No match → both `null`.

Matching is case-insensitive, **on the record's `name` only** — it never looks
inside task names, notes, or other fields.

---

## Conventions to follow when generating a skill

Match the existing `lc-*` skills so a generated skill is indistinguishable from
a hand-written one:

1. **One skill = one folder** under `skills/<skill-name>/` (a flat tree —
   OpenCode has no "plugin" nesting) containing `SKILL.md` and
   `scripts/lc.js`. The skill name is `lc-<verb>` (kebab-case).

2. **`SKILL.md` frontmatter** — only the fields OpenCode recognizes: `name`,
   `description` (keep under 1024 chars), `license`, and
   `compatibility: opencode`. Do **not** add ZCode-only fields
   (`argument-hint`, `allowed-tools`, `version`) or Kimi-only fields
   (`whenToUse`, `arguments`) — OpenCode ignores them and they clutter the
   file. The `description` is what the host uses to decide when to load the
   skill — make it specific about *when to use* and *when not to use*.

3. **Bundle a trimmed `lc.js`.** Copy **this** skill's `lc.js` and delete the
   `case` branches the skill doesn't need, plus the helpers only those branches
   use. Keep the file header comment but narrow it to the operations that skill
   needs. **Do not** chain to a sibling skill's `lc.js` — each skill is
   self-contained (a recurring/scheduled run is headless and must not depend on
   another skill being installed).

4. **Resolve `$LC_JS` by scanning OpenCode's skill directories for the skill
   name** (OpenCode exposes no skill-dir placeholder), exactly as every other
   opencode `lc-*` skill does — see "Helper setup" above. Free text via env
   vars; UUIDs + subcommand via argv. Never inline a task name, notes, or prompt
   in argv. Reuse the env-var names (`LC_NAME`, `LC_NOTES`, `LC_STATUS`,
   `LC_WORKER`, `LC_AGENT_ID`, `LC_BLOCKERS`, …) so the surface is consistent
   across skills.

5. **`JSON.parse` the result; branch on `=== null`, not key presence.** Nil
   optionals are explicit `null`.

6. **Errors:** on non-zero `osascript` exit, read stderr; map `-1001`/`-1002`/
   `-1003`/`-2700` to user-facing guidance. Never try to parse stdout on
   failure.

7. **The `function run() {}` rule.** In JXA a top-level `function run() {}` is
   the osascript run handler and is **auto-invoked** — do not call `run()`
   explicitly, or every command runs twice.

8. **TCC prompt.** Tell the user to expect a one-time "… wants to control
   LocalCortex" prompt on the first call from the OpenCode host binary.

9. **List the new skill** in the single README (`opencode-skill/README.md`):
   add a bullet to the `## Skills` list and a branch to the `## Layout` tree.
   OpenCode has no plugin manifest or version file, so there is **nothing to
   bump** — unlike the ZCode / Kimi / Claude / Codex distributions, the
   opencode-skill tree carries no `plugin.json` / `marketplace.json` version.

---

## What JXA automation CANNOT do (be honest)

If the skill the user wants needs any of these, **say so plainly** and propose
the closest automatable alternative, or mark it as requiring the app UI. Do not
silently fake it.

- **No name-based search command.** The app has no name lookup; `effort-by-name`
  / `template-by-name` / `agent-by-name` are client-side filters on the list
  commands (exact-then-substring on `name` only). There is no full-text search
  over task names, notes, or summaries.
- **No create / update / delete for Efforts.** Efforts are created, renamed,
  and archived in the app UI only. Automation can list them and read/write
  their tasks, but cannot make a new Effort.
- **No create / update / delete for Templates.** `list templates` is read-only;
  editing a template's prompt is UI-only. (You can still *materialize* a
  template's tasks via `create task` — that's what `lc-create-from-template`
  does.)
- **No moving a task between Efforts.** A `parent` must belong to the same
  effort; there is no effort-change command.
- **Dates cannot be cleared via `update task`.** Absent means *unchanged*; to
  clear a defer/due date you must use the app UI's Clear button. (You can
  *set* or *change* a date over the wire; you just cannot null it out.)
- **Recurrence cannot be cleared via `update task`.** Supplying a recurrence
  *replaces* the rule; there is no wire path to remove an existing recurrence.
  (Caveat below on setting one.)
- **Recurrence over the JXA record param is fragile.** The sdef declares
  `recurrence` as an AppleScript `record`; the app bridge re-encodes whatever
  it receives and decodes it through the DTO CodingKeys, so the snake_case key
  `day_mode` must survive the JXA→AppleScript record coercion intact. None of
  the existing `lc-*` skills exercise recurrence over the wire. **Verify with a
  `task-create` → `tasks-get` round-trip before relying on it**; if the
  snake_case label is lossy, tell the user recurrence must be set in the UI.
- **File bytes never cross the wire.** `workspace path` returns only the
  absolute folder path (or `null`); the skill reads/writes files itself using
  the host's file tools. There is no app command to read, write, list, or
  attach files.
- **`delete agent` does not cascade.** Tasks referencing a deleted agent keep a
  nullified `agent_id` and surface as an orphan state in the UI; the user
  re-picks or switches the worker. Automation cannot reassign them in bulk in
  one call (you'd loop `task-update`).
- **`worker label` is gone from the write surface (0.3.11).** The sdef
  `worker label` parameter is deleted — passing it fails the whole call — and
  `update task` rejects `worker: "human"` (`-1001`). To claim a task for an
  app-defined agent, use `LC_WORKER=agent` + `LC_AGENT_ID=<id>` (resolved from
  the agent name via `agent-by-name`). `worker_label` survives only as a
  read-back field naming a stale human claim.
- **Blocked-state invariants are enforced server-side.** Entering `blocked`
  *requires* `blockers` in the same call; completing a task (or any descendant)
  with an incomplete blocker is rejected (`-1001`); a blocked task with an
  incomplete blocker cannot switch to `open`/`in_progress`. You cannot bypass
  these over the wire — complete the blockers first.
- **`list tasks` hides an archived effort's tasks** (returns `-1002`) unless
  `include archived` is passed. Archived efforts themselves are hidden from
  `list efforts` unless opted in. (Id-based calls like `get task` /
  `task-update` keep working on archived tasks regardless.)
- **No batch / transaction.** Each command is one operation; a multi-step
  workflow is a sequence of calls. A failure mid-sequence leaves the prior
  calls' effects in place — design generated skills to be idempotent and to
  recover from partial state (re-read before acting).
- **No ordering guarantee beyond `order`.** `list tasks` is flat and ordered by
  `order`; do not assume creation-time ordering.

---

## The workflow

1. **Understand the goal.** Read the user's request and decide whether it
   actually maps to the LocalCortex JXA surface. If it needs something in the
   "cannot do" list, say so up front and propose the closest alternative.

2. **Resolve the helper** as shown above. Optionally **introspect the live app**
   to ground the design (e.g. `agents-list`, `efforts-list`) — this also
   confirms the app is installed and the TCC grant is in place.

3. **Design the skill.** Pick the minimal set of sdef commands the skill needs.
   Sketch the workflow as a numbered sequence of `lc.js` calls (resolve name →
   act → report), mirroring the existing `lc-*` skills' structure: *When to use
   / When NOT to use → Prerequisites → Helper setup → Command reference →
   Workflow → Reporting*.

4. **Scaffold the skill folder:** `skills/<skill-name>/SKILL.md` and
   `scripts/lc.js`. Copy this skill's `lc.js` and **trim** it to the commands
   the skill needs. Write the `SKILL.md` following the conventions above.

5. **Verify** the generated `lc.js` runs (e.g. a read-only command against a
   real effort/agent) and that the `SKILL.md` description is under 1024 chars.

6. **Update the distribution:** add the skill to `opencode-skill/README.md`
   (both the `## Skills` bullet list and the `## Layout` tree). There is no
   version file to bump for the opencode-skill tree.

7. **Report** what was created (folder path, commands used), and call out any
   "cannot do" items that shaped the design.

### Making reasonable assumptions

You *can* ask the user if something is genuinely ambiguous, but prefer to make
the most reasonable interpretation, build the skill, and record your
assumptions in the skill's `## Notes` section or in your reply. Do not block on
trivia. If the user's request needs a feature the surface lacks, build the
closest automatable version and document the gap honestly.

## Reporting to the user

Report plainly: the new skill's name and folder, the sdef commands it uses, and
any "cannot do" limitations that shaped the design (with the closest
alternative you chose instead). If you only wrote a one-off automation rather
than a packaged skill, say that and show the commands.
