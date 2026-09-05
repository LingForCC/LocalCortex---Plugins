#!/usr/bin/env node
// lc-zcode-worker — one-shot headless ZCode worker over the app-server protocol.
//
// Spawns `zcode.cjs app-server`, creates a session, optionally pins model /
// thought level / permission mode, sends one prompt, waits for the main
// session's turn to complete (no time limit — turns may run for hours;
// subagent traffic never counts as completion), prints the final assistant
// reply to stdout, exits.
//
// Usage:
//   node zcode-worker.js --cwd <dir> [--model provider/model | model] \
//        [--effort low|high|max] [--mode build|edit|plan|yolo] "prompt"
//
// Env:
//   ZCODE_CLI   path to zcode.cjs (default: the copy inside ZCode.app)

'use strict';
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const DEFAULT_CLI =
  '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';

function parseArgs(argv) {
  const out = { mode: 'yolo' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd' || a === '--model' || a === '--effort' || a === '--mode')
      out[a.slice(2)] = argv[++i];
    else rest.push(a);
  }
  out.prompt = rest.join(' ');
  if (!out.cwd) { console.error('--cwd is required'); process.exit(2); }
  if (!out.prompt) { console.error('prompt is required'); process.exit(2); }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const child = spawn('node', [process.env.ZCODE_CLI || DEFAULT_CLI, 'app-server', '--cwd', args.cwd], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let nextId = 1;
  const pending = new Map(); // id -> {resolve, reject}
  const state = {
    status: 'idle', turnCount: 0, turnCompleted: false,
    mainSessionId: null, mainTurnId: null, sent: false,
    done: null, failed: null,
  };

  function send(msg) { child.stdin.write(JSON.stringify(msg) + '\n'); }
  function request(method, params, timeoutMs = 20000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs)
        : null;
      pending.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
      });
      send({ id, method, params });
    });
  }
  const fail = (err) => { if (!state.failed) { state.failed = err; state.done && state.done(); } };

  child.on('exit', (code) => { if (!state.done) fail(new Error(`app-server exited early (code ${code})`)); });
  child.on('error', fail);

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && m.method !== undefined) {
      // server -> client request; auto-answer the handshake, deny the rest
      if (m.method === 'session/requestRuntimePreferences')
        send({ id: m.id, result: { nativeSearchEnhancementsEnabled: true } });
      else
        send({ id: m.id, error: { code: -32601, message: `worker does not handle ${m.method}` } });
      return;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    // notifications — scoped to OUR main session/turn so traffic from
    // subagents spawned by the main session never fakes a completion signal
    // or pollutes our state.
    const kind = m.params?.kind;
    if (m.method === 'state.updated') {
      const p = m.params?.patch || {};
      const scope = p.scope !== undefined ? p.scope : m.params?.scope;
      const sid = p.sessionId !== undefined ? p.sessionId : m.params?.sessionId;
      if (scope === 'session' && sid === state.mainSessionId) Object.assign(state, p);
    }
    if (m.method === 'computer-use/operation-event') {
      const ev = m.params || {};
      const isSubagent = typeof ev.sessionId === 'string' && ev.sessionId.startsWith('sess_subagent_agent_');
      if (!isSubagent && ev.sessionId === state.mainSessionId) {
        if (kind === 'turn-started' && state.sent && state.mainTurnId == null && ev.turnId != null)
          state.mainTurnId = ev.turnId; // first main-session turn after send is the turn we await
        if (kind === 'turn-completed' && state.mainTurnId != null && ev.turnId === state.mainTurnId)
          state.turnCompleted = true;
      }
    }
    if (state.done && (state.turnCompleted || state.status === 'idle')) state.done();
  });

  (async () => {
    const created = await request('session/create', { workspace: { workspacePath: args.cwd, workspaceKey: args.cwd } });
    const sessionId = created.session.sessionId;
    state.mainSessionId = sessionId;
    if (args.model) {
      // Accept "provider/model" or a bare model id (defaults to bigmodel).
      const slash = args.model.indexOf('/');
      const providerId = slash >= 0 ? args.model.slice(0, slash) : 'bigmodel';
      const modelId = slash >= 0 ? args.model.slice(slash + 1) : args.model;
      await request('session/setModel', { sessionId, model: { providerId, modelId } });
    }
    if (args.effort) {
      try { await request('session/setThoughtLevel', { sessionId, thoughtLevel: args.effort }); }
      catch (e) { console.error(`warning: ${e.message}`); }
    }
    await request('session/setMode', { sessionId, mode: args.mode });
    state.sent = true;
    await request('session/send', { sessionId, content: args.prompt }, 0);

    await new Promise((resolve) => {
      state.done = resolve;
      // No timeout: an agent turn may legitimately run longer than any cap
      // we could pick, so we wait indefinitely for the main session's
      // completion signal.
      // already finished?
      if (state.turnCompleted || state.status === 'idle') resolve();
    });
    if (state.failed) throw state.failed;

    const msgs = await request('session/messages', { sessionId });
    const list = msgs.messages || msgs || [];
    const text = extractAssistantText(list);
    console.log(text || '(no assistant reply)');
    child.kill();
    process.exit(0);
  })().catch((e) => { console.error(String(e.message || e)); child.kill(); process.exit(1); });
}

function extractAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (String(m?.info?.role || '').toLowerCase() !== 'assistant') continue;
    const text = (m.parts || []).filter((p) => p.type === 'text').map((p) => p.text || '').join('');
    if (text.trim()) return text;
  }
  return null;
}

main();
