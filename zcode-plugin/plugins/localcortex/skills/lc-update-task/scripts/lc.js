/*
 * lc.js — JXA helper for the LocalCortex `lc-update-task` skill.
 *
 * Pure JXA (no Node). Driven by `osascript -l JavaScript <path>/lc.js <cmd>`.
 * A focused subset of the LocalCortex AppleScript surface
 * (see LocalCortex.sdef in the LocalCortex---Swift repo): `update task`,
 * `get task`, and `workspace path`. `update task` is the point of this skill;
 * `get task` is bundled so the skill can read a task before/after an update
 * (e.g. to confirm a change landed) without leaving the skill; `workspace path`
 * lets it resolve an effort's workspace folder when artifacts are involved.
 *
 * Free-text inputs (task name, notes, etc.) are passed via environment
 * variables and read here with NSProcessInfo — that is the safe channel for
 * arbitrary content (quotes, newlines, backticks, `$` all pass through
 * verbatim). UUIDs and the subcommand travel as argv. Every command prints
 * the app's JSON-string result to stdout (so the caller JSON.parse's it).
 *
 * Errors:
 *   - Any failure — bad usage, bad JSON in LC_RECURRENCE, or an app-level
 *     failure (app not installed: -2700; validation -1001; not_found -1002;
 *     conflict -1003) — is surfaced by throwing, which osascript turns into a
 *     non-zero exit with the message on stderr. The caller reads stderr on
 *     non-zero exit. On success, the app's JSON-string result is the script's
 *     last expression value and prints to stdout (exit 0).
 */

ObjC.import("Foundation");

// --- argv ---------------------------------------------------------------
// NSProcessInfo.arguments includes the oscript invocation itself:
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
// Parse a JSON recurrence rule passed via env (all five keys required when
// present). Anything that isn't valid JSON is an error from the caller.
function envRecurrence(key) {
  const raw = envOpt(key);
  if (raw === undefined) return undefined;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(key + " must be a JSON recurrence object: " + e.message);
  }
  const required = ["frequency", "interval", "anchor", "basis", "day_mode"];
  for (const k of required) {
    if (!(k in obj)) throw new Error(key + " is missing required key '" + k + "'");
  }
  return obj;
}

// --- dispatch -----------------------------------------------------------
function run() {
  const app = Application("LocalCortex");
  let result;

  switch (cmd) {
    case "tasks-get": {
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js tasks-get <taskId>");
      result = app.getTask(taskId);
      break;
    }
    case "workspace-path": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js workspace-path <effortId>");
      result = app.workspacePath(effortId);
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
      const defer = envOpt("LC_DEFER_DATE");
      if (defer !== undefined) opts.deferDate = defer;
      const due = envOpt("LC_DUE_DATE");
      if (due !== undefined) opts.dueDate = due;
      const recurrence = envRecurrence("LC_RECURRENCE");
      if (recurrence !== undefined) opts.recurrence = recurrence;
      const worker = envOpt("LC_WORKER");
      if (worker !== undefined) opts.worker = worker;
      const workerLabel = envOpt("LC_WORKER_LABEL");
      if (workerLabel !== undefined) opts.workerLabel = workerLabel;
      result = app.updateTask(taskId, opts);
      break;
    }
    default:
      throw new Error(
        "unknown subcommand: '" + cmd + "'. Expected one of: " +
          "tasks-get, workspace-path, task-update."
      );
  }

  // `result` is already a JSON text string from the app (sdef <result type="text">).
  // Echo it verbatim so the caller can JSON.parse the stdout line.
  return result;
}

// On success, `run()` returns the app's JSON-string result; as the script's
// last expression value it prints to stdout (exit 0). Any thrown error —
// bad usage, bad recurrence JSON, or an app/AppleScript failure surfaced by
// the Application call — propagates as a non-zero exit with the message on
// stderr (osascript prints "<path>: execution error: Error: <msg> (-2700)").
//
// NOTE: do NOT call run() explicitly. In JXA a top-level `function run() {}`
// is the osascript run handler and is auto-invoked on execution; calling it
// again here makes the whole script (and every command) run TWICE.
