---
name: lc-fetch-effort
description: >-
  Look up a single LocalCortex Effort by name — the macOS task manager app —
  and return its id, workspace folder name, and on-disk workspace path. Drives
  LocalCortex through its JXA/AppleScript automation surface (osascript), not
  MCP. Use whenever the user references an Effort by name (not a task) and wants
  to find it, get its id, or locate its workspace folder — e.g. "find the
  Build LocalCortex 0.3.2 effort", "what's the effort id for Payments", "where
  is the workspace folder for Investments". Does not read or modify tasks; for
  task work use the lc-start-work skill instead.
---

# lc-fetch-effort — resolve a LocalCortex Effort by name

Resolve a single **Effort** (LocalCortex's top-level container) from its name,
and report its id and on-disk workspace folder. Drive LocalCortex
**exclusively through its JXA/AppleScript surface** via the bundled `lc.js`
helper — never use `mcp__localcortex__*` tools in this skill's flow.

## When to use this skill

When the user names an **Effort** (not a task) and wants to find it: get its
id, confirm it exists, see whether it is archived, or locate its workspace
folder on disk. This skill is read-only — it never reads, creates, or modifies
tasks. If the user actually wants to work on a task within an effort, hand off
to the `lc-start-work` skill.

## When NOT to use this skill

- The user points at a **task** (an item inside an effort), not an effort → use
  `lc-start-work`.
- No effort is in view and the user is just browsing → don't invent one.
- The user already has an effort id → they don't need a lookup.

## Prerequisites

- The **LocalCortex** macOS app is installed and built with the AppleScript/JXA
  surface (sdef commands used: `list efforts`, `workspace path`). Apple Events
  auto-launch the app if it isn't running — no "is the server up" check needed.
- The **first call from the Codex host triggers a one-time macOS TCC
  prompt** ("*… wants to control LocalCortex*"). After the user grants it,
  subsequent calls are silent. Tell the user to expect this prompt the first
  time; it is a per-sender grant, not per-call.
- The app's scripting name is `LocalCortex`.

## Helper setup (do this once, up front)

`lc.js` lives in the `scripts/` directory next to this `SKILL.md`. Codex
includes the selected skill's absolute file path in its available-skills list.
Resolve that path's parent directory once and reuse `$LC_JS` for every call.

```bash
# Replace the placeholder with the absolute directory containing this SKILL.md.
LC_JS="<this skill's directory>/scripts/lc.js"
[ -f "$LC_JS" ] || { echo "lc.js not found at $LC_JS" >&2; exit 1; }
```

Every command below is invoked the same way. **Always pass free text (the
effort name) via the `LC_NAME` env var**, never inline in argv — env vars are
safe for quotes, newlines, backticks, and `$`. The subcommand travels as argv.

```bash
osascript -l JavaScript "$LC_JS" <subcommand> [positional args]
```

## Command reference

The helper prints JSON to stdout — read it directly or `JSON.parse` it.

| subcommand | argv | env vars | returns |
|---|---|---|---|
| `efforts-list` | — | `LC_INCLUDE_ARCHIVED=true` | JSON array of all efforts |
| `effort-by-name` | — | `LC_NAME` (req), `LC_INCLUDE_ARCHIVED=true` | JSON `{ query, match, candidates }` object (see below) |
| `workspace-path` | `<effortId>` | — | JSON string path, or literal `null` |

### What `effort-by-name` returns

A single JSON object:

```json
{
  "query": "<the name you searched for>",
  "match": { "id": "…", "name": "…", "workspace_folder_name": "…", "is_archived": false, "summary": "" },
  "candidates": [
    { "id": "…", "name": "…", "workspace_folder_name": "…", "is_archived": false }
  ]
}
```

- Exactly one match → `match` is that effort, `candidates` lists the same one.
- Several matches → `match` is `null`, `candidates` lists all of them (ask the
  user to disambiguate).
- No match → both `match` and `candidates` are `null`.

Matching is case-insensitive. It prefers an **exact** name match; if none, it
falls back to efforts whose name **contains** the query as a substring. It
never looks inside task names or notes — only the effort's own `name`.

### `workspace-path` result

The **absolute** on-disk path string of the effort's workspace folder, or
literal `null` when no root folder is configured / the effort hasn't been
materialized. (Effort records also carry a `workspace_folder_name`, which is
just the folder's base name — `workspace-path` resolves the full absolute
path through the app.)

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
2. **Run the lookup** with the name the user gave:

   ```bash
   LC_NAME='<effort name>' \
     osascript -l JavaScript "$LC_JS" effort-by-name
   ```

   By default archived efforts are excluded. If the user is looking for
   something that may have been archived, include them:

   ```bash
   LC_NAME='<effort name>' LC_INCLUDE_ARCHIVED=true \
     osascript -l JavaScript "$LC_JS" effort-by-name
   ```

3. **Read the result and branch on `match`:**
   - `match` is an object → report the effort's `id`, `name`, `is_archived`,
     and `workspace_folder_name`. This is the common case; stop here unless the
     user also asked for the on-disk path.
   - `match` is `null` but `candidates` is a non-empty array → **do not guess.**
     List the candidates (id + name, noting any that are archived) and ask the
     user which one they mean.
   - both `null` → tell the user no effort matched. Suggest checking spelling,
     or retry with `LC_INCLUDE_ARCHIVED=true` if it may be archived.

4. **Resolve the on-disk workspace path** when the user asked for it (or when
   you're about to read/write effort files), using the resolved effort's id:

   ```bash
   osascript -l JavaScript "$LC_JS" workspace-path "$EFFORT_ID"
   ```

   Report the path string, or tell the user the effort has no workspace folder
   configured yet (result `null`).

### Reporting to the user

Report the essentials plainly — the effort id and name, whether it is archived,
and (if requested) the full workspace path. Do not dump the entire efforts
list; that's noise. If you disambiguated among candidates, say which one you
landed on and why.
