/*
 * lc.js — JXA helper for the LocalCortex `lc-skill-creator` skill.
 *
 * Pure JXA (no Node). Driven by `osascript -l JavaScript <path>/lc.js <cmd>`.
 *
 * Unlike the focused helpers bundled with the other lc-* skills (each of which
 * covers only the operations that one skill needs), THIS helper is the
 * **canonical reference implementation** covering the FULL LocalCortex
 * AppleScript surface — all twelve sdef commands (see LocalCortex.sdef in the
 * LocalCortex---Swift repo):
 *
 *   Read:        list efforts, list templates, list tasks, get task, workspace path
 *   Write/tasks: create task, update task, complete task
 *   Agent CRUD:  list agents, create agent, update agent, delete agent
 *
 * plus three client-side composites (effort-by-name / template-by-name /
 * agent-by-name) built on top of the list commands — the app has no name-search
 * of its own, so name resolution is always a client-side exact-then-substring
 * filter (mirrors every lc-* sibling). The point of bundling the full surface
 * here is twofold: (1) the creator skill can introspect/verify the live surface
 * while helping the user design a new skill, and (2) a generated skill copies
 * THIS file and trims it down to just the commands it needs, so every generated
 * helper starts from a correct, convention-matching baseline.
 *
 * Free-text inputs (names, notes, model, tool, …) are passed via environment
 * variables and read here with NSProcessInfo — that is the safe channel for
 * arbitrary content (quotes, newlines, backticks, `$` all pass through
 * verbatim). UUIDs (task/effort/agent ids) and the subcommand travel as argv.
 * Every command prints the app's JSON-string result to stdout (so the caller
 * JSON.parse's it).
 *
 * Errors:
 *   - Any failure — bad usage, or an app-level failure (app not installed:
 *     -2700; validation -1001; not_found -1002; conflict -1003; entitlement
 *     -1004 — no active subscription or trial, every command rejects, reads
 *     included) — is surfaced by throwing, which osascript turns into a
 *     non-zero exit with the message on stderr. The caller reads stderr on
 *     non-zero exit. On success, the JSON result is the script's last
 *     expression value and prints to stdout (exit 0).
 *
 * Write latency (app 1.0.0): the six write commands wait for scroll-quiet
 * behind the app's scroll-activity gate — during continuous scrolling a write
 * may take up to ~2 s to reply. Reads stay immediate. Latency only; semantics
 * are unchanged.
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
// (Mirrors every lc-* sibling so name resolution stays consistent.)
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

// Parse a recurrence rule passed as a JSON object string
// (LC_RECURRENCE='{"frequency":"daily","interval":1,"anchor":"due",
// "basis":"fixed","day_mode":"day_of_month"}'). Returns the parsed object, or
// undefined when unset (so the key is omitted and the rule is left unchanged).
//
// CAVEAT (documented in SKILL.md): the sdef declares `recurrence` as an
// AppleScript record. Passing a nested record whose keys include underscores
// (`day_mode`) from JXA can be lossy across the JXA→AppleScript record
// coercion — the app bridge re-encodes whatever NSDictionary it receives and
// decodes it through the DTO CodingKeys, so the snake_case labels must
// survive intact. Verify with a create→get round-trip before relying on it.
function parseRecurrence(raw) {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error("LC_RECURRENCE is not valid JSON: " + e.message);
  }
}

// --- dispatch -----------------------------------------------------------
function run() {
  const app = Application("LocalCortex");
  let result;

  switch (cmd) {
    // --- Efforts ---------------------------------------------------------
    case "efforts-list": {
      // listEfforts returns the app's JSON-string result verbatim — a JSON
      // array of effort records (id, name, summary, workspace_folder_name,
      // created_at, updated_at, is_archived). Hidden by default is the
      // archived set.
      result = app.listEfforts({ includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true" });
      break;
    }
    case "effort-by-name": {
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for effort-by-name");
      const raw = app.listEfforts({ includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true" });
      const efforts = JSON.parse(raw);
      const found = findByName(efforts, name);
      result = JSON.stringify({ query: name, match: found.match, candidates: found.candidates });
      break;
    }

    // --- Templates (read-only on this surface) ---------------------------
    case "templates-list": {
      // listTemplates returns the app's JSON-string result verbatim — a JSON
      // array of template records (id, name, prompt, order, created_at,
      // updated_at). Read-only: create/update/delete templates is UI-only.
      result = app.listTemplates();
      break;
    }
    case "template-by-name": {
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for template-by-name");
      const raw = app.listTemplates();
      const templates = JSON.parse(raw);
      const found = findByName(templates, name);
      result = JSON.stringify({ query: name, match: found.match, candidates: found.candidates });
      break;
    }

    // --- Agents ----------------------------------------------------------
    case "agents-list": {
      // listAgents returns the app's JSON-string result verbatim — a JSON
      // array of agent records (id, name, model, thinking_effort, tool,
      // order, created_at, updated_at).
      result = app.listAgents();
      break;
    }
    case "agent-by-name": {
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for agent-by-name");
      const raw = app.listAgents();
      const agents = JSON.parse(raw);
      const found = findByName(agents, name);
      result = JSON.stringify({ query: name, match: found.match, candidates: found.candidates });
      break;
    }
    case "agent-create": {
      // createAgent sdef has with-name (required) and optional tool / model /
      // thinking effort. All free text.
      const name = envStr("LC_NAME");
      if (!name) throw new Error("LC_NAME is required for agent-create");
      const opts = { withName: name };
      const tool = envOpt("LC_TOOL");
      if (tool !== undefined) opts.tool = tool;
      const model = envOpt("LC_MODEL");
      if (model !== undefined) opts.model = model;
      const thinkingEffort = envOpt("LC_THINKING_EFFORT");
      if (thinkingEffort !== undefined) opts.thinkingEffort = thinkingEffort;
      result = app.createAgent(opts);
      break;
    }
    case "agent-update": {
      // updateAgent sdef takes agent id (argv, direct param) + any subset of
      // name / tool / model / thinking effort. Absent fields are unchanged.
      const agentId = positional[0];
      if (!agentId) throw new Error("usage: lc.js agent-update <agentId>");
      const opts = {};
      const name = envOpt("LC_NAME");
      if (name !== undefined) opts.name = name;
      const tool = envOpt("LC_TOOL");
      if (tool !== undefined) opts.tool = tool;
      const model = envOpt("LC_MODEL");
      if (model !== undefined) opts.model = model;
      const thinkingEffort = envOpt("LC_THINKING_EFFORT");
      if (thinkingEffort !== undefined) opts.thinkingEffort = thinkingEffort;
      result = app.updateAgent(agentId, opts);
      break;
    }
    case "agent-delete": {
      // deleteAgent sdef takes agent id (argv, direct param). Does NOT
      // cascade: tasks referencing the deleted agent keep a dangling agent_id
      // (nullified on the relationship) and surface as orphan state in the UI.
      const agentId = positional[0];
      if (!agentId) throw new Error("usage: lc.js agent-delete <agentId>");
      result = app.deleteAgent(agentId);
      break;
    }

    // --- Tasks -----------------------------------------------------------
    case "tasks-list": {
      // listTasks sdef takes effort id (argv, direct param) + optional
      // include archived. Flat ordered list (roots + subtasks); no notes, just
      // a has_notes hint. Reconstruct the tree by grouping on parent_id
      // (null = root). An archived effort's tasks throw not_found unless
      // include archived is true.
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js tasks-list <effortId>");
      result = app.listTasks(effortId, {
        includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true",
      });
      break;
    }
    case "tasks-get": {
      // getTask sdef takes task id (argv, direct param). Full-fidelity record,
      // including notes.
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js tasks-get <taskId>");
      result = app.getTask(taskId);
      break;
    }
    case "workspace-path": {
      // workspacePath sdef takes effort id (argv, direct param). Returns the
      // absolute on-disk folder path as a JSON text string, or the JSON
      // literal null when no root folder is configured / not materialized.
      // File bytes never cross this boundary — only the path.
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js workspace-path <effortId>");
      result = app.workspacePath(effortId);
      break;
    }
    case "task-create": {
      // createTask sdef has in-effort / with-name (both required) and optional
      // notes / due-date / parent / before / recurrence / run-as. There is NO
      // worker param on create — a new task defaults to worker=none, so an
      // assignment is applied afterwards via task-update. There is also NO
      // defer-date param on create — apply it post-create via task-update.
      // Omit parent entirely when LC_PARENT_ID is unset so a ROOT task is
      // created rather than a child of an empty/null id. Omit
      // dueDate/recurrence when unset. `before` (app >= 0.4.7) splices the new
      // task directly above the anchor id in the anchor's own sibling group.
      // `runAs` (app 1.0.0) is headless (default) or subagent — the agent run
      // mode; it may be set without a claim and stays dormant until claimed.
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
      const dueDate = envOpt("LC_DUE_DATE");
      if (dueDate !== undefined) opts.dueDate = dueDate;
      const recurrence = parseRecurrence(envOpt("LC_RECURRENCE"));
      if (recurrence !== undefined) opts.recurrence = recurrence;
      const runAs = envOpt("LC_RUN_AS");
      if (runAs !== undefined) {
        if (runAs !== "headless" && runAs !== "subagent") {
          throw new Error("LC_RUN_AS must be 'headless' or 'subagent'");
        }
        opts.runAs = runAs;
      }
      result = app.createTask(opts);
      break;
    }
    case "task-update": {
      // updateTask sdef takes task id (argv, direct param) + any subset of
      // name / notes / status / defer date / due date / recurrence / worker /
      // agent id / clear agent / blockers / flagged today / run as. Only keys
      // that were provided are forwarded; absent keys are left unchanged on
      // the app side.
      //
      // For assigning an app-defined agent, the wire is `LC_WORKER=agent` +
      // `LC_AGENT_ID=<id>` (resolved from the agent name via agent-by-name /
      // agents-list). `LC_WORKER` accepts only `none` or `agent` — 0.3.11
      // rejects `human` (-1001) and deleted the sdef `worker label` param.
      // An absent LC_AGENT_ID never clears the reference (app 1.0.0): sending
      // LC_WORKER=agent alone keeps the previous agent id. LC_CLEAR_AGENT=true
      // is the explicit opt-in that drops the agent reference while keeping
      // the agent claim (rejected together with LC_AGENT_ID, with an explicit
      // worker other than agent, and on a task that is not agent-claimed).
      // An agent-claimed task cannot have subtasks (-1001) — release the
      // claim (LC_WORKER=none), restructure, re-claim.
      //
      // `blockers` is a list of task-id text on the app side. Entering
      // Blocked REQUIRES blockers — the caller must send LC_STATUS=blocked
      // and LC_BLOCKERS=<ids> in the same call. LC_CLEAR_BLOCKERS=true sends
      // an empty list (the sdef revert path that clears blockers and reverts
      // a Blocked task to open). LC_BLOCKERS wins over LC_CLEAR_BLOCKERS if
      // both are somehow set. An all-completed blocker set is rejected.
      //
      // `flaggedToday` (app >= 0.4.7) sets/clears the Today flag. `runAs`
      // (app 1.0.0) is headless|subagent: a same-call LC_WORKER=none release
      // re-resets it to headless (release wins), and setting it on a
      // completed task is rejected (-1001), including a same-call reopen —
      // reopen first, then set runAs in a second call.
      //
      // Dates CANNOT be cleared via this command (absent = unchanged) — use
      // the app UI's Clear button. Recurrence can be replaced but not cleared
      // via this command.
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
      const agentId = envOpt("LC_AGENT_ID");
      if (agentId !== undefined) opts.agentId = agentId;
      if (envOpt("LC_CLEAR_AGENT") === "true") opts.clearAgent = true;
      const deferDate = envOpt("LC_DEFER_DATE");
      if (deferDate !== undefined) opts.deferDate = deferDate;
      const dueDate = envOpt("LC_DUE_DATE");
      if (dueDate !== undefined) opts.dueDate = dueDate;
      const recurrence = parseRecurrence(envOpt("LC_RECURRENCE"));
      if (recurrence !== undefined) opts.recurrence = recurrence;
      const blockers = parseBlockerList(envOpt("LC_BLOCKERS"));
      if (blockers !== null) {
        opts.blockers = blockers;
      } else if (envOpt("LC_CLEAR_BLOCKERS") === "true") {
        opts.blockers = [];
      }
      const flagRaw = envOpt("LC_FLAGGED_TODAY");
      if (flagRaw !== undefined) {
        if (flagRaw === "true") opts.flaggedToday = true;
        else if (flagRaw === "false") opts.flaggedToday = false;
        else throw new Error("LC_FLAGGED_TODAY must be 'true' or 'false'");
      }
      const runAs = envOpt("LC_RUN_AS");
      if (runAs !== undefined) {
        if (runAs !== "headless" && runAs !== "subagent") {
          throw new Error("LC_RUN_AS must be 'headless' or 'subagent'");
        }
        opts.runAs = runAs;
      }
      result = app.updateTask(taskId, opts);
      break;
    }
    case "task-complete": {
      // completeTask sdef takes task id (argv, direct param) + optional
      // completed (defaults to true). Completing cascades the subtree, is
      // rejected while any blocker is incomplete, and spawns a recurrence
      // copy. Pass completed=false to reopen.
      const taskId = positional[0];
      if (!taskId) throw new Error("usage: lc.js task-complete <taskId>");
      const completedRaw = envOpt("LC_COMPLETED");
      const opts = {};
      if (completedRaw !== undefined) opts.completed = completedRaw === "true";
      result = app.completeTask(taskId, opts);
      break;
    }
    default:
      throw new Error(
        "unknown subcommand: '" + cmd + "'. Expected one of: " +
          "efforts-list, effort-by-name, templates-list, template-by-name, " +
          "agents-list, agent-by-name, agent-create, agent-update, " +
          "agent-delete, tasks-list, tasks-get, workspace-path, " +
          "task-create, task-update, task-complete."
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
