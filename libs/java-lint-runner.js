'use strict';

/**
 * In-browser OpenJDK javac via CheerpJ (WASM JVM).
 * Loaded inside a hidden extension iframe; talks to content.js via postMessage.
 */

const LOCAL_SCRIPT_URL = document.currentScript?.src || location.href;
const LOCAL_TOOLS_JAR_B64_URL = new URL('tools.jar.b64', LOCAL_SCRIPT_URL).href;
const TOOLS_JAR_PATH = '/str/tools.jar';
const CLASSPATH = TOOLS_JAR_PATH + ':/str/';
const SOURCE_PATH = '/str/Main.java';
const OUTPUT_DIR = '/str/';

let _ready = false;
let _initPromise = null;
let _lintActive = false;
let _pendingLint = null;
let _lintEpoch = 0;
let _toolsLoaded = false;
let _lastLog = '';
let _cheerpjBooted = false;
let _toolsJarBuffer = null;

function post(type, extra = {}) {
  parent.postMessage({ nzoiJavaLint: true, type, ...extra }, '*');
}

function fmt(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

const nativeConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function forwardConsole(level, args) {
  const message = args.map(fmt).join(' ');
  post('log', { level, message: message.slice(0, 2000) });
}

console.log = (...args) => { nativeConsole.log(...args); forwardConsole('log', args); };
console.warn = (...args) => { nativeConsole.warn(...args); forwardConsole('warn', args); };
console.error = (...args) => { nativeConsole.error(...args); forwardConsole('error', args); };

window.addEventListener('error', e => {
  post('error', { message: e.error?.stack || e.message || 'Java lint sandbox error' });
});

window.addEventListener('unhandledrejection', e => {
  post('error', { message: e.reason?.stack || e.reason?.message || String(e.reason || 'Unhandled Java lint rejection') });
});

function status(message, extra = {}) {
  post('status', { message, ...extra });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForCheerpJApi(timeoutMs = 15000) {
  const start = Date.now();
  while (typeof self.cheerpjInit !== 'function') {
    if (Date.now() - start > timeoutMs) {
      throw new Error('cheerpjInit is not available; check libs/java-lint.html script loading');
    }
    await sleep(50);
  }
}

function withTimeout(promise, ms, label) {
  let t = null;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label + ' timed out after ' + Math.round(ms / 1000) + 's')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function base64ToUint8Array(input) {
  const b64 = String(input || '').replace(/\s+/g, '');
  if (!b64) return new Uint8Array();
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((b64.length / 4) * 3 - padding);
  const chunkChars = 32768;
  let offset = 0;
  for (let i = 0; i < b64.length; i += chunkChars) {
    const chunk = b64.slice(i, i + chunkChars);
    const bin = atob(chunk);
    for (let j = 0; j < bin.length; j++) out[offset++] = bin.charCodeAt(j);
  }
  return out;
}

async function fetchToolsJar() {
  if (_toolsJarBuffer) return _toolsJarBuffer;

  status('Decoding bundled javac tools.jar', { detail: LOCAL_TOOLS_JAR_B64_URL });
  const res = await fetch(LOCAL_TOOLS_JAR_B64_URL, { credentials: 'omit', cache: 'force-cache' });
  if (!res.ok) throw new Error('Could not load bundled tools.jar.b64: HTTP ' + res.status);
  const bytes = base64ToUint8Array(await res.text());
  if (!bytes.byteLength) throw new Error('empty bundled tools.jar');
  _toolsJarBuffer = bytes;
  post('debug', { message: 'Decoded bundled tools.jar (' + bytes.byteLength + ' bytes)' });
  return _toolsJarBuffer;
}

function addStringFile(path, bytes) {
  const fn = self.cheerpOSAddStringFile || self.cheerpjAddStringFile;
  if (!fn) throw new Error('CheerpJ virtual filesystem API is not available');
  return fn(path, bytes);
}

function removeStringFile(path) {
  const fn = self.cheerpOSRemoveStringFile || self.cheerpjRemoveStringFile;
  if (!fn) return;
  try { fn(path); } catch {}
}

async function ensureToolsJar() {
  if (_toolsLoaded) return;
  const buf = await fetchToolsJar();
  addStringFile(TOOLS_JAR_PATH, buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  _toolsLoaded = true;
  _toolsJarBuffer = null;
}

async function bootCheerpJ() {
  const attempts = [
    { status: 'none', version: 8, enableX11: false },
    { status: 'none', version: 8 },
    { version: 8 },
  ];
  let lastErr = null;

  for (const options of attempts) {
    try {
      await withTimeout(self.cheerpjInit(options), 90000, 'CheerpJ JVM boot');
      return;
    } catch (err) {
      if (/already initialized/i.test(err?.message || String(err))) return;
      if (/timed out/i.test(err?.message || String(err))) throw err;
      lastErr = err;
      post('debug', {
        message: 'CheerpJ init failed with ' + JSON.stringify(options) + ': ' + (err.message || String(err)),
      });
    }
  }

  throw lastErr || new Error('CheerpJ JVM boot failed');
}

async function initCheerpJ() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    status('Booting JVM...');
    await waitForCheerpJApi();

    if (!_cheerpjBooted) {
      await bootCheerpJ();
      _cheerpjBooted = true;
      post('debug', { message: 'CheerpJ booted from local bundled loader' });
    }

    status('Loading javac...');
    await ensureToolsJar();
    _ready = true;
    post('ready');
  })().catch(err => {
    _ready = false;
    _initPromise = null;
    post('error', { message: err.stack || err.message || String(err) });
    throw err;
  });

  return _initPromise;
}

function parseJavacLog(log) {
  const markers = [];
  const lines = log.split('\n');
  const lineRe = /^(?:\/str\/)?Main\.java:(\d+):\s*(error|warning|note):\s*(.+)$/i;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(lineRe);
    if (!m) continue;
    let col = 1;
    const caret = lines[i + 2];
    if (caret && /^\s*\^/.test(caret)) col = caret.indexOf('^') + 1;
    markers.push({
      startLineNumber: parseInt(m[1], 10),
      startColumn: col,
      endLineNumber: parseInt(m[1], 10),
      endColumn: 999,
      message: m[3].trim(),
      severity: m[2].toLowerCase() === 'error' ? 8 : 4,
    });
  }

  if (!markers.length && log.trim()) {
    const cleaned = log.split('\n').filter(l => l.trim()).slice(0, 4).join(' | ')
      .replace(/\/str\/Main\.java/g, 'Main.java').trim();
    if (cleaned) {
      markers.push({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 999,
        message: cleaned,
        severity: 8,
      });
    }
  }
  return markers;
}

function collectConsoleText(el) {
  const out = [];
  const push = v => {
    if (v == null) return;
    const s = String(v);
    if (s.trim()) out.push(s);
  };
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args) => { push(args.join(' ')); original.log.apply(console, args); };
  console.warn = (...args) => { push(args.join(' ')); original.warn.apply(console, args); };
  console.error = (...args) => { push(args.join(' ')); original.error.apply(console, args); };

  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
    const domText = el?.innerText || el?.textContent || '';
    const combined = [domText, out.join('\n')].filter(Boolean).join('\n');
    _lastLog = combined;
    return combined;
  };
}

function cleanupRunFiles() {
  removeStringFile(SOURCE_PATH);
  [
    '/str/Main.class',
    '/str/Main$1.class',
    '/str/Main$FastScanner.class',
    '/str/Main$Scanner.class',
  ].forEach(removeStringFile);
}

function postStaleResult(id) {
  if (id) post('result', { id, markers: [], stale: true });
}

function enqueueLint(source, id) {
  if (_pendingLint?.id) postStaleResult(_pendingLint.id);
  _pendingLint = { source, id, epoch: _lintEpoch };
  drainLintQueue();
}

async function drainLintQueue() {
  if (_lintActive) return;
  _lintActive = true;
  try {
    while (_pendingLint) {
      const job = _pendingLint;
      _pendingLint = null;
      await runLintJob(job.source, job.id, job.epoch);
    }
  } finally {
    _lintActive = false;
  }
  if (_pendingLint) drainLintQueue();
}

async function runLintJob(source, id, epoch) {
  try {
    await initCheerpJ();
    if (epoch !== _lintEpoch) return postStaleResult(id);

    cleanupRunFiles();
    addStringFile(SOURCE_PATH, new TextEncoder().encode(source));
    status('Running javac...', { id, bytes: source.length });

    const consoleEl = document.getElementById('console');
    consoleEl.textContent = '';
    const stopCollecting = collectConsoleText(consoleEl);

    let exitCode = 1;
    try {
      exitCode = await self.cheerpjRunMain(
        'com.sun.tools.javac.Main',
        CLASSPATH,
        '-d', OUTPUT_DIR,
        '-Xlint:all',
        SOURCE_PATH
      );
    } finally {
      _lastLog = stopCollecting();
      cleanupRunFiles();
    }

    if (epoch !== _lintEpoch) return postStaleResult(id);

    const log = _lastLog || consoleEl.innerText || consoleEl.textContent || '';
    const markers = exitCode === 0 && !log.trim() ? [] : parseJavacLog(log);
    post('log', {
      level: exitCode === 0 ? 'log' : 'warn',
      message: 'javac exit ' + exitCode + ', markers=' + markers.length + (log.trim() ? ': ' + log.trim().slice(0, 1200) : ''),
    });
    post('result', { id, markers, exitCode });
  } catch (err) {
    if (epoch !== _lintEpoch) return postStaleResult(id);
    const message = err.stack || err.message || String(err);
    post('error', { id, message });
    post('result', {
      id,
      error: message,
      markers: [{
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 999,
        message: 'Java linter failed: ' + message.split('\n')[0],
        severity: 8,
      }],
    });
  }
}

function resetLintState() {
  _lintEpoch++;
  if (_pendingLint?.id) postStaleResult(_pendingLint.id);
  _pendingLint = null;
  _lastLog = '';
  const consoleEl = document.getElementById('console');
  if (consoleEl) consoleEl.textContent = '';
  cleanupRunFiles();
  status('Java lint sandbox reset');
}

window.addEventListener('message', e => {
  const d = e.data;
  if (!d || !d.nzoiJavaLintCmd) return;
  if (d.cmd === 'init') initCheerpJ().catch(() => {});
  if (d.cmd === 'lint' && typeof d.source === 'string') enqueueLint(d.source, d.id);
  if (d.cmd === 'reset') resetLintState();
});

post('debug', { message: 'Java lint runner loaded at ' + location.href });
initCheerpJ().catch(() => {});
