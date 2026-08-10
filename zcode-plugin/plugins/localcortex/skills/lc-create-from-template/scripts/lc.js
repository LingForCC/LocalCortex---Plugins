/*
 * lc.js — JXA helper for the LocalCortex `lc-create-from-template` skill.
 *
 * Pure JXA (no Node). Driven by `osascript -l JavaScript <path>/lc.js <cmd>`.
 * A focused subset of the LocalCortex AppleScript surface (see
 * LocalCortex.sdef in the LocalCortex---Swift repo) covering exactly the
 * operations a "materialize a template's tasks into an Effort" run needs:
 * `list efforts`, `list templates`, `list tasks`, `workspace path`,
 * `create task`, `update task`. The composites `effort-by-name` and
 * `template-by-name` are client-side filters built on top of the list
 * commands — the app has no name-search of its own. `task-update` carries the
 * `blockers` list (sdef `blockers` param) so a Blocked state and its blocker
 * ids can be set in the same call, the way the app requires it.
 *
 * Free-text inputs (effort name, template name, task name, notes, blocker ids)
 * are passed via environment variables and read here with NSProcessInfo —
 * that is the safe channel for arbitrary content (quotes, newlines, backticks,
 * `$` all pass through verbatim). UUIDs and the subcommand travel as argv.
 * Every command prints the app's JSON-string result to stdout (so the caller
 * JSON.parse's it).
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

// A record is a candidate if its name equals the query (exact) or contains
// the query as a substring. Exact matches win over substring matches.
// (Mirrors the lc-fetch-effort sibling so behavior stays consistent.)
function findByName(records, query) {
  const q = norm(query);
  const substring = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const name = norm(r.name);
    if (name === q) {
      // Exact hit — return immediately; it is unambiguously the best match.
      return { match: r, candidates: [r] };
    }
    if (name.indexOf(q) !== -1) {
      substring.push(r);
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
      // listEfforts returns the app's JSON-string result; parse to filter,
      // then re-stringify the composite object below.
      const raw = app.listEfforts({ includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true" });
      const efforts = JSON.parse(raw);
      const found = findByName(efforts, name);
      result = JSON.stringify({ query: name, match: found.match, candidates: found.candidates });
      break;
    }
    case "templates-list": {
      // listTemplates returns the app's JSON-string result verbatim — a JSON
      // array of template records (id, name, prompt, order, created_at,
      // updated_at). Read-only on this surface.
      result = app.listTemplates();
      break;
    }
    case "template-by-name": {
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for template-by-name");
      // listTemplates returns the app's JSON-string result; parse to filter,
      // then re-stringify the composite object below.
      const raw = app.listTemplates();
      const templates = JSON.parse(raw);
      const found = findByName(templates, name);
      result = JSON.stringify({ query: name, match: found.match, candidates: found.candidates });
      break;
    }
    case "tasks-list": {
      // Raw listTasks — every task in the effort (completed tasks included;
      // only archived is filterable). Used to collect ids of existing tasks
      // the prompt may want to reference as blockers or parents.
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js tasks-list <effortId>");
      result = app.listTasks(effortId, {
        includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true",
      });
      break;
    }
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
    case "task-create": {
      // createTask sdef has in-effort / with-name (both required) and
      // optional notes / due-date / parent / recurrence. There is NO worker
      // param on create — a new task defaults to worker=none, so an
      // assignment is applied afterwards via task-update. Omit parent
      // entirely when LC_PARENT_ID is unset so a ROOT task is created rather
      // than a child of an empty/null id. Omit dueDate when unset too.
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js task-create <effortId>");
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for task-create");
      const opts = { inEffort: effortId, withName: name };
      const notes = envOpt("LC_NOTES");
      if (notes !== undefined) opts.notes = notes;
      const parent = envOpt("LC_PARENT_ID");
      if (parent !== undefined) opts.parent = parent;
      const dueDate = envOpt("LC_DUE_DATE");
      if (dueDate !== undefined) opts.dueDate = dueDate;
      result = app.createTask(opts);
      break;
    }
    case "task-update": {
      // updateTask sdef takes task id (argv) + any subset of name / notes /
      // status / due date / worker / worker label / blockers. Only keys that
      // were provided are forwarded; absent keys are left unchanged on the
      // app side.
      //
      // `blockers` is a list of task-id text on the app side. Entering
      // Blocked REQUIRES blockers — the caller must send LC_STATUS=blocked
      // and LC_BLOCKERS=<ids> in the same call. LC_CLEAR_BLOCKERS=true sends
      // an empty list (the sdef revert path that clears blockers and reverts
      // a Blocked task to open). LC_BLOCKERS wins over LC_CLEAR_BLOCKERS if
      // both are somehow set.
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js task-update <taskId>");
      const opts = {};
      const name = envOpt("LC_NAME");
      if (name !== undefined) opts.name = name;
      const notes = envOpt("LC_NOTES");
      if (notes !== undefined) opts.notes = notes;
      const status = envOpt("LC_STATUS");
      if (status !== undefined) opts.status = status;
      const worker = envOpt("LC_WORKER");
      if (worker !== undefined) opts.worker = worker;
      const workerLabel = envOpt("LC_WORKER_LABEL");
      if (workerLabel !== undefined) opts.workerLabel = workerLabel;
      const dueDate = envOpt("LC_DUE_DATE");
      if (dueDate !== undefined) opts.dueDate = dueDate;
      const blockers = parseBlockerList(envOpt("LC_BLOCKERS"));
      if (blockers !== null) {
        opts.blockers = blockers;
      } else if (envOpt("LC_CLEAR_BLOCKERS") === "true") {
        opts.blockers = [];
      }
      result = app.updateTask(taskId, opts);
      break;
    }
    default:
      throw new Error(
        "unknown subcommand: '" + cmd + "'. Expected one of: " +
          "effort-by-name, templates-list, template-by-name, tasks-list, " +
          "tasks-get, workspace-path, task-create, task-update."
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
