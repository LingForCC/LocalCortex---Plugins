/*
 * lc.js — JXA helper for the LocalCortex `lc-start-work` skill.
 *
 * Pure JXA (no Node). Driven by `osascript -l JavaScript <path>/lc.js <cmd>`.
 * A focused subset of the LocalCortex AppleScript surface (see
 * LocalCortex.sdef in the LocalCortex---Swift repo) covering exactly the
 * operations an autonomous "work a caller-chosen task → complete it" run needs.
 * The composite `effort-by-name` is the same client-side filter used by the
 * `lc-fetch-effort` sibling (the app has no name-search command of its own);
 * `tasks-get`, `tasks-list`, `task-create`, `task-update`, and `task-complete`
 * map 1:1 to sdef commands. `tasks-list` exists for structure context: a
 * headless worker discovers its parent, blockers, and completed siblings by
 * grouping the flat list on `parent_id` before it starts working. The
 * stuck-report path — create a sibling placeholder `before` the target, enter
 * blocked with `blockers`, flag Today — needs app ≥ 0.4.7 for the
 * `before` / `flaggedToday` parameters; on an older app those calls fail and
 * the caller degrades per the skill's degradation ladder.
 * The point of bundling them here is that a scheduled run is headless — it
 * must not chain sibling skills to get its work done, so this one helper is
 * self-contained.
 *
 * This skill is given a specific task id (chosen by the caller — typically the
 * lc-orchestrate-agents tick). It does NOT look up tasks by agent and does not
 * care which agent (if any) a task is assigned to; it works whatever task id it
 * is handed, after verifying the task exists in the named effort.
 *
 * Free-text inputs (effort name, notes) are passed via environment variables
 * and read here with NSProcessInfo — that is the safe channel for arbitrary
 * content (quotes, newlines, backticks, `$` all pass through verbatim). UUIDs
 * (task id, effort id) and the subcommand travel as argv. Every command prints
 * the app's JSON-string result to stdout (so the caller JSON.parse's it).
 *
 * Errors:
 *   - Any failure — bad usage, or an app-level failure (app not installed:
 *     -2700; validation -1001; not_found -1002; conflict -1003) — is surfaced
 *     by throwing, which osascript turns into a non-zero exit with the message
 *     on stderr. The caller reads stderr on non-zero exit. On success, the JSON
 *     result is the script's last expression value and prints to stdout
 *     (exit 0).
 */

ObjC.import("Foundation");

// --- argv ---------------------------------------------------------------
// NSProcessInfo.arguments includes the osascript invocation itself:
//   ["/usr/bin/osascript", "-l", "JavaScript", "<path>/lc.js", "<cmd>", ...]
// so the script path is at index 3, the subcommand at index 4, and any
// positional args from index 5 onward.
const ALL_ARGS = $.NSProcessInfo.processInfo.arguments;
function argAt(i) {
  return i < ALL_ARGS.count ? ALL_ARGS.objectAtIndex(i).js : undefined;
}
const cmd = argAt(4);
const positional = [];
for (let i = 5; i < ALL_ARGS.count; i++) positional.push(ALL_ARGS.objectAtIndex(i).js);

// --- env ----------------------------------------------------------------
const ENV = $.NSProcessInfo.processInfo.environment;
function envStr(key) {
  const v = ENV.objectForKey(key);
  return v === null || v.isNil() ? null : v.js;
}
// Treat an unset env var and an empty string as "not provided" so the JXA
// command simply omits that key (matches the sdef's optional semantics).
function envOpt(key) {
  const v = envStr(key);
  return v === null || v === "" ? undefined : v;
}

// --- matching helpers (client-side composites) --------------------------
function norm(s) {
  return String(s).toLowerCase();
}

// An effort is a candidate if its name equals the query (exact) or contains
// the query as a substring. Exact matches win over substring matches.
// (Mirrors the lc-fetch-effort sibling so behavior stays consistent.)
function findEffortByName(efforts, query) {
  const q = norm(query);
  const substring = [];
  for (let i = 0; i < efforts.length; i++) {
    const e = efforts[i];
    const name = norm(e.name);
    if (name === q) {
      // Exact hit — return immediately; it is unambiguously the best match.
      return { match: e, candidates: [e] };
    }
    if (name.indexOf(q) !== -1) {
      substring.push(e);
    }
  }
  if (substring.length === 1) {
    return { match: substring[0], candidates: substring };
  }
  // 0 substring matches, or >=2 (ambiguous): no single match.
  return { match: null, candidates: substring.length ? substring : null };
}

// Parse a comma-separated list of task ids ("id1,id2,id3") into a JS array,
// trimming whitespace and dropping empty segments. Returns null when the
// caller did not provide LC_BLOCKERS at all (so the helper can omit the key
// and leave blockers unchanged on the app side).
function parseBlockerList(raw) {
  if (raw === undefined) return null;
  const out = [];
  const parts = String(raw).split(",");
  for (let i = 0; i < parts.length; i++) {
    const id = parts[i].trim();
    if (id) out.push(id);
  }
  return out;
}

// --- dispatch -----------------------------------------------------------
function run() {
  const app = Application("LocalCortex");
  let result;

  switch (cmd) {
    case "effort-by-name": {
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for effort-by-name");
      // listEfforts returns the app's JSON-string result; parse to filter, then
      // re-stringify the composite object below.
      const raw = app.listEfforts({ includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true" });
      const efforts = JSON.parse(raw);
      const found = findEffortByName(efforts, name);
      result = JSON.stringify({ query: name, match: found.match, candidates: found.candidates });
      break;
    }
    case "tasks-get": {
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js tasks-get <taskId>");
      result = app.getTask(taskId);
      break;
    }
    case "tasks-list": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js tasks-list <effortId>");
      // Verbatim passthrough of the sdef `list tasks` result: the app's flat,
      // ordered JSON array of task-summary records (no notes; has_notes hint;
      // completed included; grouping on parent_id reconstructs the tree).
      // Caller filters client-side.
      result = app.listTasks(effortId, {
        includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true",
      });
      break;
    }
    case "task-update": {
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js task-update <taskId>");
      const opts = {};
      const name = envOpt("LC_NAME");
      if (name !== undefined) opts.name = name;
      const notes = envOpt("LC_NOTES");
      if (notes !== undefined) opts.notes = notes;
      const status = envOpt("LC_STATUS");
      if (status !== undefined) opts.status = status;
      // LC_WORKER accepts only "none" or "agent" — 0.3.11 rejects "human"
      // (-1001) and deleted the sdef worker-label parameter.
      const worker = envOpt("LC_WORKER");
      if (worker !== undefined) opts.worker = worker;
      // Blockers (stuck-report path): entering Blocked REQUIRES blockers —
      // the caller must send LC_STATUS=blocked and LC_BLOCKERS=<ids> in the
      // same call. LC_CLEAR_BLOCKERS=true sends an empty list (the sdef
      // revert path that clears blockers and reverts a Blocked task to
      // open). LC_BLOCKERS wins over LC_CLEAR_BLOCKERS if both are set.
      const blockers = parseBlockerList(envOpt("LC_BLOCKERS"));
      if (blockers !== null) {
        opts.blockers = blockers;
      } else if (envOpt("LC_CLEAR_BLOCKERS") === "true") {
        opts.blockers = [];
      }
      // Strict boolean flag (app ≥ 0.4.7), mirroring the app's own -1001 on
      // a non-boolean `flagged today` — fail loud, never a silent no-op.
      const flagRaw = envOpt("LC_FLAGGED_TODAY");
      if (flagRaw !== undefined) {
        if (flagRaw === "true") opts.flaggedToday = true;
        else if (flagRaw === "false") opts.flaggedToday = false;
        else throw new Error("LC_FLAGGED_TODAY must be 'true' or 'false'");
      }
      result = app.updateTask(taskId, opts);
      break;
    }
    case "task-create": {
      // createTask sdef: in-effort / with-name (required), optional notes /
      // parent / before. No worker param on create — a new task defaults to
      // worker=none. Omit parent entirely when LC_PARENT_ID is unset so a
      // ROOT task is created. `before` (app ≥ 0.4.7) splices the new task
      // directly above the anchor task in the anchor's own sibling group;
      // on an older app the call fails and the caller retries without it.
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js task-create <effortId>");
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for task-create");
      const opts = { inEffort: effortId, withName: name };
      const notes = envOpt("LC_NOTES");
      if (notes !== undefined) opts.notes = notes;
      const parent = envOpt("LC_PARENT_ID");
      if (parent !== undefined) opts.parent = parent;
      const before = envOpt("LC_BEFORE_ID");
      if (before !== undefined) opts.before = before;
      result = app.createTask(opts);
      break;
    }
    case "workspace-path": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js workspace-path <effortId>");
      result = app.workspacePath(effortId);
      break;
    }
    case "task-complete": {
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js task-complete <taskId>");
      // `completed` defaults to true on the app side when omitted, so only
      // forward the key when the caller set it explicitly.
      const completedRaw = envOpt("LC_COMPLETED");
      const opts = {};
      if (completedRaw !== undefined) opts.completed = completedRaw === "true";
      result = app.completeTask(taskId, opts);
      break;
    }
    default:
      throw new Error(
        "unknown subcommand: '" + cmd + "'. Expected one of: " +
          "effort-by-name, tasks-get, tasks-list, task-update, task-create, " +
          "workspace-path, task-complete."
      );
  }

  // `result` is already a JSON text string from the app (sdef <result type="text">),
  // or a re-stringified composite from the client-side filters. Echo it verbatim
  // so the caller can JSON.parse the stdout line.
  return result;
}

// On success, `run()` returns the JSON result; as the script's last expression
// value it prints to stdout (exit 0). Any thrown error — bad usage, or an
// app/AppleScript failure surfaced by the Application call — propagates as a
// non-zero exit with the message on stderr (osascript prints
// "<path>: execution error: Error: <msg> (-2700)").
//
// NOTE: do NOT call run() explicitly. In JXA a top-level `function run() {}`
// is the osascript run handler and is auto-invoked on execution; calling it
// again here makes the whole script (and every command) run TWICE.
