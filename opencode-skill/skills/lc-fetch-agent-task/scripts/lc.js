/*
 * lc.js — JXA helper for the LocalCortex `lc-fetch-agent-task` skill.
 *
 * Pure JXA (no Node). Driven by `osascript -l JavaScript <path>/lc.js <cmd>`.
 * A small, read-only subset of the LocalCortex AppleScript surface
 * (see LocalCortex.sdef in the LocalCortex---Swift repo): `list tasks`.
 * `tasks-by-agent` is a client-side composite built on top of `list tasks` —
 * the app has no worker-search command of its own.
 *
 * Free-text input (the agent label) is passed via the `LC_AGENT_LABEL`
 * environment variable and read here with NSProcessInfo — that is the safe
 * channel for arbitrary content (quotes, newlines, backticks, `$` all pass
 * through verbatim). The effort id and the subcommand travel as argv. Every
 * command prints a JSON result to stdout (so the caller can JSON.parse it).
 *
 * Errors:
 *   - Any failure — bad usage, or an app-level failure (app not installed:
 *     -2700; validation -1001; not_found -1002) — is surfaced by throwing,
 *     which osascript turns into a non-zero exit with the message on stderr.
 *     The caller reads stderr on non-zero exit. On success, the JSON result is
 *     the script's last expression value and prints to stdout (exit 0).
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
// Treat an unset env var and an empty string as "not provided".
function envOpt(key) {
  const v = envStr(key);
  return v === null || v === "" ? undefined : v;
}

// --- matching helpers (client-side composite) ---------------------------
// Case-insensitive comparison. An empty label query is rejected upstream
// (LC_AGENT_LABEL is required for tasks-by-agent), so no guard needed here.
function norm(s) {
  return String(s).toLowerCase();
}

// A task is assigned to an agent when its `worker` is "agent". The label
// match is case-insensitive against `worker_label`. By default only active
// tasks (open / in_progress / blocked) qualify; archived and completed tasks
// are excluded unless the caller opts in.
//
// `includeCompleted` / `includeArchived` follow the sdef's optional semantics:
// a literal false means "keep the default exclusion"; only true widens the set.
function filterTasksByAgent(tasks, label, includeCompleted, includeArchived) {
  const q = norm(label);
  const ACTIVE = { open: true, in_progress: true, blocked: true };
  const out = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.worker !== "agent") continue;
    if (norm(t.worker_label) !== q) continue;
    // `t.status` is always present in the list-tasks summary.
    if (!includeCompleted && t.status === "completed") continue;
    if (!includeArchived && t.is_archived) continue;
    out.push(t);
  }
  return out;
}

// --- dispatch -----------------------------------------------------------
function run() {
  const app = Application("LocalCortex");
  let result;

  switch (cmd) {
    case "tasks-list": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js tasks-list <effortId>");
      result = app.listTasks(effortId, {
        includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true",
      });
      break;
    }
    case "tasks-by-agent": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js tasks-by-agent <effortId>");
      const label = envStr("LC_AGENT_LABEL");
      if (!label) throw new Error("LC_AGENT_LABEL is required for tasks-by-agent");
      // listTasks returns the app's JSON-string result; parse to filter, then
      // re-stringify the composite object below.
      const raw = app.listTasks(effortId, {
        includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true",
      });
      const tasks = JSON.parse(raw);
      const matched = filterTasksByAgent(
        tasks,
        label,
        envOpt("LC_INCLUDE_COMPLETED") === "true",
        envOpt("LC_INCLUDE_ARCHIVED") === "true"
      );
      result = JSON.stringify({
        query: { effort_id: effortId, agent_label: label },
        count: matched.length,
        tasks: matched,
      });
      break;
    }
    case "workspace-path": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js workspace-path <effortId>");
      result = app.workspacePath(effortId);
      break;
    }
    default:
      throw new Error(
        "unknown subcommand: '" + cmd + "'. Expected one of: " +
          "tasks-list, tasks-by-agent, workspace-path."
      );
  }

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
