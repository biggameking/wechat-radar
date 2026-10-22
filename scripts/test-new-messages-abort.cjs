/* Isolated regression: no Next server, wx CLI, credentials or chat database. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { setTimeout: delay } = require('node:timers/promises');
const sourceFile = process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.resolve(__dirname, '../app/api/new-messages/route.ts');
const expectLeakingBaseline = process.argv.includes('--expect-baseline');
const nativePolling = process.argv.includes('--native-polling');
const source = fs.readFileSync(sourceFile, 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function check(when) {
  let release;
  let calls = 0;
  let firstPoll = true;
  const pending = new Promise(resolve => { release = resolve; });
  const handles = new Set();
  const wxRead = async () => { calls++; if (firstPoll) await pending; return []; };
  const module = { exports: {} };
  const isolatedRequire = name => {
    if (name === '@/lib/wx') return { wxNewMessages: wxRead, wxSessions: wxRead };
    throw new Error(`Unexpected runtime dependency: ${name}`);
  };
  const trackedSet = (fn, ms) => { assert.equal(ms, 2000); const handle = setInterval(fn, ms); handles.add(handle); return handle; };
  const trackedClear = handle => { handles.delete(handle); clearInterval(handle); };
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', javascript)(isolatedRequire, module, module.exports, trackedSet, trackedClear);
  const ctl = new AbortController();
  if (when === 'before-start') ctl.abort();
  const req = new Request('https://audit.invalid/api/new-messages?interval=2000', { signal: ctl.signal });
  try {
    const response = await module.exports.GET(req);
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
    if (when === 'during-first-poll') ctl.abort();
    firstPoll = false;
    release();
    await delay(0);
    if (when === 'after-first-poll') {
      assert.equal(handles.size, 1, 'live request should start polling');
      ctl.abort();
    }
    const shouldLeak = expectLeakingBaseline && when !== 'after-first-poll';
    assert.equal(handles.size, shouldLeak ? 1 : 0, 'aborted request must not retain an interval');
    const callsAtAbortCompletion = calls;
    if (nativePolling && when === 'during-first-poll') {
      await delay(2100);
      if (shouldLeak) assert.ok(calls >= callsAtAbortCompletion + 2, 'baseline must actually poll after abort');
      else assert.equal(calls, callsAtAbortCompletion, 'candidate must not poll after abort');
    }
    if (!expectLeakingBaseline && when === 'before-start') assert.equal(calls, 0);
    return { when, activeIntervals: handles.size, callsAtAbortCompletion, callsAfterObservation: calls, nativeObservation: nativePolling && when === 'during-first-poll' };
  } finally {
    // Clean up only timers created by this test, including reproduced baseline leaks.
    for (const handle of handles) clearInterval(handle);
    handles.clear();
  }
}
(async () => {
  const results = [];
  for (const when of ['before-start', 'during-first-poll', 'after-first-poll']) results.push(await check(when));
  process.stdout.write(JSON.stringify({ node: process.version, typescript: ts.version, baseline: expectLeakingBaseline, results }, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
