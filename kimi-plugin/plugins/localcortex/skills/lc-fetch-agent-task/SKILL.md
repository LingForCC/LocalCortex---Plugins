---
name: lc-fetch-agent-task
description: >-
  Find the LocalCortex tasks assigned to a specific agent inside a given Effort
  — the macOS task manager app. Provide the effort id and the agent's label
  (the `worker_label`, e.g. `kimi`); the skill returns the active tasks
  (`open`, `in_progress`, `blocked`) whose `worker` is `agent` and whose label
  matches. Drives LocalCortex through its JXA/AppleScript automation surface
  (osascript), not MCP. Use whenever the user asks "what is agent X working on
  in effort Y", "find the tasks assigned to kimi in …", or "show me the
  agent-owned tasks for …". Read-only; does not read full notes or modify
  tasks. For starting/working a returned task, use the start-work skill.
whenToUse: >-
  When the user has an Effort id (or names an Effort) and an agent label, and
  asks what tasks are assigned to that agent inside that effort.
arguments: effortId agentLabel
---

# lc-fetch-agent-task — find tasks assigned to an agent in an Effort

List the tasks assigned to the agent labeled `$agentLabel` within the Effort
`$effortId`, and report their ids, names, and status. Drive LocalCortex
**exclusively through its JXA/AppleScript surface** via the bundled `lc.js`
helper — never use `mcp__localcortex__*` tools in this skill's flow.

## When to use this skill

When the user has an **Effort id** (or you resolved one with `lc-fetch-effort`)
and an **agent label** (e.g. `kimi`, `zcode`, `claude`), and wants to see the
tasks assigned to that agent inside that effort — e.g. "what is kimi working
on in the Build effort?", "find tasks assigned to claude in …", "show me the
agent-owned tasks for …". This skill is read-only — it lists task summaries,
never reads full notes or modifies tasks. If the user then wants to work on a
returned task, hand off to the `start-work` skill with that task's id.

## When NOT to use this skill

- The user points at a **task** (by id or name) and wants to work on it → use
  `start-work`.
- The user names an **Effort** and wants to resolve its id or workspace folder
  → use `lc-fetch-effort`.
- No effort id is in view → don't invent one. Resolve the effort first with
  `lc-fetch-effort`, or ask the user for the id.
- The user wants **human**-owned tasks, or tasks regardless of worker → this
  skill filters to `worker: agent` only; it is the wrong tool.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used: `list tasks`). Apple Events auto-launch the app
  if it isn't running — no "is the server up" check needed.
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

Every command below is invoked the same way. **Always pass the agent label via
the `LC_AGENT_LABEL` env var**, never inline in argv — env vars are safe for
quotes, newlines, backticks, and `$`. The effort id and the subcommand travel
as argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints JSON to stdout — read it directly or `JSON.parse` it.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `tasks-list` | `<effortId>` | `LC_INCLUDE_ARCHIVED=true` | JSON array of task summaries (no notes; has `has_notes`) |
| `tasks-by-agent` | `<effortId>` | `LC_AGENT_LABEL` (req), `LC_INCLUDE_COMPLETED=true`, `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, count, tasks }` object (see below) |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |

### What `tasks-by-agent` returns

A single JSON object:

```json
{
  "query": { "effort_id": "…", "agent_label": "kimi" },
  "count": 1,
  "tasks": [
    {
      "id": "…",
      "parent_id": "…",
      "effort_id": "…",
      "name": "…",
      "status": "in_progress",
      "worker": "agent",
      "worker_label": "kimi",
      "has_notes": true,
      "is_archived": false,
      "due_date": null
    }
  ]
}
```

- A task qualifies when its `worker` is `"agent"` **and** its `worker_label`
  matches the query **case-insensitively**.
- By default only **active** tasks are returned: `open`, `in_progress`, and
  `blocked`. Set `LC_INCLUDE_COMPLETED=true` to also return completed tasks
  assigned to that agent. Set `LC_INCLUDE_ARCHIVED=true` to also search
  archived tasks.
- Matching is on the agent's label only — it never looks at task names or
  notes. A task with `worker: human` or `worker: none` never matches.
- The returned `tasks` carry the **summary** fields (no `notes`); each has a
  `has_notes` hint. Use the `start-work` skill (`tasks-get <taskId>`) if you
  need the full notes of a specific task.

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
| `-1001` | validation — bad UUID/enum or missing required param |
| `-1002` | not_found — unknown effort |

---

## The workflow

1. **Resolve the helper** as shown above.

2. **Confirm the inputs:** the **effort id** and the **agent label**. If the
   user only gave an effort *name*, resolve its id first with `lc-fetch-effort`.
   The agent label is the worker's `worker_label` (e.g. `kimi`), not the
   literal string "agent".

3. **Run the lookup** with the effort id (argv) and the label (env):

   ```bash
   LC_AGENT_LABEL='<agent label>' \
     osascript -l JavaScript "$LC_JS" tasks-by-agent "$EFFORT_ID"
   ```

   By default completed tasks are excluded. If the user wants the agent's
   completed work too, include it:

   ```bash
   LC_AGENT_LABEL='<agent label>' LC_INCLUDE_COMPLETED=true \
     osascript -l JavaScript "$LC_JS" tasks-by-agent "$EFFORT_ID"
   ```

4. **Read the result and branch on `count`:**
   - `count` ≥ 1 → report each task's `id`, `name`, and `status` (and note any
     that are `in_progress`/`blocked`). This is the common case.
   - `count` is 0 → tell the user no active task in that effort is assigned to
     that agent. Suggest re-checking the label spelling, including completed
     tasks (`LC_INCLUDE_COMPLETED=true`), or, if the effort may be archived,
     retrying with `LC_INCLUDE_ARCHIVED=true`.

### Reporting to the user

Report the essentials plainly — the agent label, the effort, and the matching
tasks (id + name + status). Do not dump the entire task list; that's noise. If
there are several matches, list them; if the user then wants to work on one,
hand off to `start-work` with that task's id.
