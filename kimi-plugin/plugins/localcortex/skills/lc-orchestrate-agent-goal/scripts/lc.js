/*
 * lc.js — JXA helper for the LocalCortex `lc-start-job` skill.
 *
 * Pure JXA (no Node). Driven by `osascript -l JavaScript <path>/lc.js <cmd>`.
 * A focused subset of the LocalCortex AppleScript surface (see
 * LocalCortex.sdef in the LocalCortex---Swift repo) covering exactly the
 * operations an autonomous "pull open agent task → work it → complete it" run
 * needs. The composites `effort-by-name` and `tasks-by-agent` are the same
 * client-side filters used by the `lc-fetch-effort` and `lc-fetch-agent-task`
 * siblings (the app has no name/worker-search command of its own); `tasks-get`,
 * `task-update`, and `task-complete` map 1:1 to sdef commands. The point of
 * bundling them here is that a scheduled run is headless — it must not chain
 * sibling skills to get its work done, so this one helper is self-contained.
 *
 * Free-text inputs (effort name, agent label, notes) are passed via environment
 * variables and read here with NSProcessInfo — that is the safe channel for
 * arbitrary content (quotes, newlines, backticks, `$` all pass through
 * verbatim). UUIDs and the subcommand travel as argv. Every command prints the
 * app's JSON-string result to stdout (so the caller JSON.parse's it).
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

// A task is assigned to an agent when its `worker` is "agent". The identity
// match is by `agent_id` when an agentId is given (the modern wire —
// app-defined agents set agent_id, not worker_label, which is a legacy
// read-back field and is empty for agent tasks); otherwise it falls back to
// a case-insensitive match
// against `worker_label` (legacy). Orphaned agent tasks (worker == "agent"
// but agent_id is null) never match an agentId query. By default only active
// tasks (open / in_progress / blocked) qualify; archived and completed tasks
// are excluded unless the caller opts in.
// (Mirrors the lc-fetch-agent-task sibling so behavior stays consistent.)
function filterTasksByAgent(tasks, label, includeCompleted, includeArchived, agentId) {
  const q = norm(label);
  const byId = agentId !== undefined && agentId !== null && agentId !== "";
  const out = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.worker !== "agent") continue;
    if (byId) {
      // agent_id is a UUID string or JSON null on the wire; null never matches.
      if (!t.agent_id || t.agent_id !== agentId) continue;
    } else {
      if (norm(t.worker_label) !== q) continue;
    }
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
    case "tasks-by-agent": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js tasks-by-agent <effortId>");
      // agent_id takes precedence (modern wire for app-defined agents); fall
      // back to the legacy worker_label match. At least one must be provided.
      const agentId = envOpt("LC_AGENT_ID");
      const label = envStr("LC_AGENT_LABEL");
      if (!agentId && !label) {
        throw new Error("LC_AGENT_ID or LC_AGENT_LABEL is required for tasks-by-agent");
      }
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
        envOpt("LC_INCLUDE_ARCHIVED") === "true",
        agentId
      );
      result = JSON.stringify({
        query: agentId
          ? { effort_id: effortId, agent_id: agentId }
          : { effort_id: effortId, agent_label: label },
        count: matched.length,
        tasks: matched,
      });
      break;
    }
    case "agents-list": {
      // listAgents returns the app's JSON-string result verbatim — a JSON
      // array of agent definition records (id, name, model, thinking_effort,
      // tool, order, created_at, updated_at). Read-only on this surface; the
      // orchestrator maps each record's `tool` to a spawnable CLI.
      result = app.listAgents();
      break;
    }
    case "tasks-get": {
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js tasks-get <taskId>");
      result = app.getTask(taskId);
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
      result = app.updateTask(taskId, opts);
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
          "effort-by-name, tasks-by-agent, tasks-get, " +
          "task-update, workspace-path, task-complete, agents-list."
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
