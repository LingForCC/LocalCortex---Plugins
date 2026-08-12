/*
 * lc.js — JXA helper for the LocalCortex `lc-fetch-effort` skill.
 *
 * Pure JXA (no Node). Driven by `osascript -l JavaScript <path>/lc.js <cmd>`.
 * A small, read-only subset of the LocalCortex AppleScript surface
 * (see LocalCortex.sdef in the LocalCortex---Swift repo): `list efforts` and
 * `workspace path`. `effort-by-name` is a client-side composite built on top of
 * `list efforts` — the app has no name-search command of its own.
 *
 * Free-text input (the effort name) is passed via the `LC_NAME` environment
 * variable and read here with NSProcessInfo — that is the safe channel for
 * arbitrary content (quotes, newlines, backticks, `$` all pass through
 * verbatim). The subcommand travels as argv. Every command prints a JSON
 * result to stdout (so the caller can JSON.parse it).
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
// Case-insensitive comparison. Empty/whitespace-only names are rejected
// upstream (LC_NAME is required for effort-by-name), so no guard needed here.
function norm(s) {
  return String(s).toLowerCase();
}
// A effort is a candidate if its name equals the query (exact) or contains
// the query as a substring. Exact matches win over substring matches.
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

// --- dispatch -----------------------------------------------------------
function run() {
  const app = Application("LocalCortex");
  let result;

  switch (cmd) {
    case "efforts-list": {
      result = app.listEfforts({ includeArchived: envOpt("LC_INCLUDE_ARCHIVED") === "true" });
      break;
    }
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
    case "workspace-path": {
      const effortId = positional[0];
      if (!effortId) throw new Error("usage: lc.js workspace-path <effortId>");
      result = app.workspacePath(effortId);
      break;
    }
    default:
      throw new Error(
        "unknown subcommand: '" + cmd + "'. Expected one of: " +
          "efforts-list, effort-by-name, workspace-path."
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
