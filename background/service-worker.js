/**
 * NZOI Enhanced — Background Service Worker v10
 */
'use strict';

const LOG = (...a) => console.log('[NZOI Enhanced BG]', ...a);
const ERR = (...a) => console.error('[NZOI Enhanced BG]', ...a);

const store = {
  get:    k  => new Promise(r => chrome.storage.local.get(k, r)),
  set:    d  => new Promise(r => chrome.storage.local.set(d, r)),
  remove: k  => new Promise(r => chrome.storage.local.remove(k, r)),
};

// ── GitHub Gist ───────────────────────────────────────────────────────────────

async function ghFetch(token, method, path, body) {
  if (!token) throw new Error('No GitHub token');
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      'Authorization': 'token ' + token,
      'Content-Type':  'application/json',
      'Accept':        'application/vnd.github.v3+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error('GitHub ' + res.status + ': ' + text.slice(0, 200));
  return JSON.parse(text);
}

async function getOrCreateGist(token) {
  const { gistId } = await store.get(['gistId']);
  if (gistId) return gistId;
  const data = await ghFetch(token, 'POST', '/gists', {
    description: 'NZOI Enhanced Code Storage',
    public: false,
    files: { 'init.txt': { content: 'NZOI Enhanced' } },
  });
  await store.set({ gistId: data.id });
  return data.id;
}

async function fetchGistFiles(token) {
  const { gistId, gistCache, gistCacheTime } = await store.get(['gistId', 'gistCache', 'gistCacheTime']);
  if (!gistId) return {};
  if (gistCache && Date.now() - (gistCacheTime || 0) < 30_000) return gistCache;
  const data = await ghFetch(token, 'GET', '/gists/' + gistId);
  await store.set({ gistCache: data.files || {}, gistCacheTime: Date.now() });
  return data.files || {};
}

async function saveFileToGist(token, filename, content) {
  const gistId = await getOrCreateGist(token);
  await ghFetch(token, 'PATCH', '/gists/' + gistId, { files: { [filename]: { content: content || ' ' } } });
  await store.remove(['gistCache', 'gistCacheTime']);
}

async function deleteFileFromGist(token, filename) {
  const { gistId } = await store.get(['gistId']);
  if (!gistId) return;
  await ghFetch(token, 'PATCH', '/gists/' + gistId, { files: { [filename]: null } });
  await store.remove(['gistCache', 'gistCacheTime']);
}

async function testGistToken(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!res.ok) throw new Error('Invalid token (HTTP ' + res.status + ')');
  const user = await res.json();
  const { gistId } = await store.get(['gistId']);
  let fileCount = 0;
  if (gistId) {
    try { const g = await ghFetch(token, 'GET', '/gists/' + gistId); fileCount = Object.keys(g.files || {}).length; } catch {}
  }
  return { login: user.login, gistId: gistId || null, fileCount };
}

async function listGists(token) {
  const gists = await ghFetch(token, 'GET', '/gists?per_page=50');
  return gists.map(g => ({
    id:          g.id,
    description: g.description || '(no description)',
    fileCount:   Object.keys(g.files).length,
    files:       Object.keys(g.files).slice(0, 6).join(', '),
    updatedAt:   g.updated_at,
  }));
}

// ── Classification Gist sync ──────────────────────────────────────────────────

const CLASSIFICATIONS_FILE = 'nzoi_classifications.json';

async function saveClassificationsToGist(token, data) {
  const gistId = await getOrCreateGist(token);
  await ghFetch(token, 'PATCH', '/gists/' + gistId, {
    files: { [CLASSIFICATIONS_FILE]: { content: JSON.stringify(data, null, 2) } },
  });
  await store.remove(['gistCache', 'gistCacheTime']);
}

async function loadClassificationsFromGist(token) {
  const files = await fetchGistFiles(token);
  const f = files[CLASSIFICATIONS_FILE];
  if (!f) return {};
  const text = f.truncated ? await fetch(f.raw_url).then(r => r.text()) : f.content;
  try { return JSON.parse(text); } catch { return {}; }
}

// ── AI ────────────────────────────────────────────────────────────────────────

function getChatContent(data, label) {
  const msg = data?.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content.map(part => {
      if (typeof part === 'string') return part;
      return part?.text || part?.content || '';
    }).join('').trim();
    if (joined) return joined;
  }
  throw new Error(label + ' empty response');
}

async function postChatJson(url, apiKey, body, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(label + ' ' + res.status + ': ' + text.slice(0, 300));
    err.status = res.status;
    err.body = text;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(label + ' returned non-JSON response: ' + text.slice(0, 120));
  }
}

async function callAI(provider, apiKey, model, prompt, options = {}) {
  if (!apiKey) throw new Error('No API key for ' + provider);
  if (!model) throw new Error('No model configured for ' + provider);

  const messages = Array.isArray(options.messages) && options.messages.length
    ? options.messages
    : [{ role: 'user', content: prompt || '' }];
  const maxTokens = Number.isFinite(options.maxTokens) ? options.maxTokens : 900;
  const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.1;

  if (provider === 'mistral') {
    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };
    if (options.responseFormat) body.response_format = options.responseFormat;
    const data = await postChatJson('https://api.mistral.ai/v1/chat/completions', apiKey, body, 'Mistral/' + model);
    return getChatContent(data, 'Mistral/' + model);
  }

  if (provider === 'google') {
    const systemText = messages
      .filter(m => m.role === 'system')
      .map(m => m.content || '')
      .filter(Boolean)
      .join('\n\n');
    const userText = messages
      .filter(m => m.role !== 'system')
      .map(m => `${String(m.role || 'user').toUpperCase()}:\n${m.content || ''}`)
      .join('\n\n') || prompt || '';
    const body = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    if (options.responseSchema) {
      body.generationConfig.responseMimeType = 'application/json';
      body.generationConfig.responseSchema = options.responseSchema;
    } else if (options.responseFormat) {
      body.generationConfig.responseMimeType = 'application/json';
    }
    if (options.thinkingConfig) body.generationConfig.thinkingConfig = options.thinkingConfig;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const sendGoogle = async payload => fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    let res = await sendGoogle(body);
    let text = await res.text();
    if (!res.ok && res.status === 400 && options.responseSchema) {
      const schemaRejected = /response_?schema|generationConfig\.responseSchema|responseSchema/i.test(text);
      if (schemaRejected) {
        const bodyWithoutSchema = {
          ...body,
          generationConfig: {
            ...body.generationConfig,
            responseMimeType: 'application/json',
          },
        };
        delete bodyWithoutSchema.generationConfig.responseSchema;
        res = await sendGoogle(bodyWithoutSchema);
        text = await res.text();
      }
    }
    if (!res.ok) {
      const err = new Error('Google/' + model + ' ' + res.status + ': ' + text.slice(0, 300));
      err.status = res.status;
      err.body = text;
      throw err;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Google/' + model + ' returned non-JSON response: ' + text.slice(0, 120));
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const out = parts
      .filter(part => !part.thought)
      .map(part => part.text || '')
      .join('')
      .trim();
    if (out) return out;
    const blockReason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw new Error('Google/' + model + ' empty response' + (blockReason ? ' (' + blockReason + ')' : ''));
  }

  throw new Error('Unknown provider: ' + provider);
}

// ── Code execution ────────────────────────────────────────────────────────────

async function runCode(source, languageId, stdin) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch('https://ce.judge0.com/submissions?base64_encoded=true&wait=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_code: btoa(unescape(encodeURIComponent(source))),
        language_id: languageId,
        stdin:       btoa(unescape(encodeURIComponent(stdin || ''))),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const d = await res.json();
      const decode = b64 => { try { return atob(b64); } catch { return ''; } };
      const compile = d.compile_output ? decode(d.compile_output) : '';
      const stderr  = d.stderr  ? decode(d.stderr)  : '';
      const stdout  = d.stdout  ? decode(d.stdout)  : '';
      const isCompileErr = d.status?.id === 6;
      const out = isCompileErr ? compile : (stderr || stdout || compile || 'No output');
      return { output: out.trim(), error: isCompileErr ? compile.trim() : null };
    }
  } catch(e) { LOG('Judge0 failed, falling back to Piston:', e.message); }

  const PISTON = { 54:'c++', 71:'python', 62:'java' };
  const lang = PISTON[languageId];
  if (!lang) return { output: '', error: 'Unsupported language: ' + languageId };
  const res = await fetch('https://emkc.org/api/v2/piston/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: lang, version: '*', files: [{ content: source }], stdin: stdin || '' }),
  });
  const d = await res.json();
  const ce = d.compile?.stderr?.trim();
  const out = ce || d.run?.stdout?.trim() || d.run?.stderr?.trim() || 'No output';
  return { output: out, error: ce || null };
}

// ── Monaco injection ──────────────────────────────────────────────────────────
//
// ARCHITECTURE (MV3 world isolation):
//   Chrome MV3 content scripts run in an ISOLATED world. executeScript(world:'MAIN')
//   runs in the PAGE's MAIN world. These two worlds DO NOT share JS object references —
//   DOM expando properties set in MAIN are invisible to ISOLATED world code.
//
//   So we cannot pass the `monaco` object through a DOM property.
//
//   SOLUTION: The MAIN world injection creates the Monaco editor itself and owns it.
//   Content.js (ISOLATED) communicates with it entirely via window.postMessage,
//   using the prefix 'nzoi:ed:' to distinguish these messages.
//
//   Messages content.js → MAIN world editor:
//     { _nzoi:'cmd', cmd:'create',       containerId, value, language }
//     { _nzoi:'cmd', cmd:'getValue' }
//     { _nzoi:'cmd', cmd:'setValue',     value }
//     { _nzoi:'cmd', cmd:'setLanguage',  language }
//     { _nzoi:'cmd', cmd:'setMarkers',   source, markers }
//     { _nzoi:'cmd', cmd:'clearMarkers', source }
//     { _nzoi:'cmd', cmd:'addCommand',   key, action }   (key = 'save'|'run'|'submit')
//
//   Messages MAIN world editor → content.js:
//     { _nzoi:'evt', evt:'ready' }
//     { _nzoi:'evt', evt:'change',        value }
//     { _nzoi:'evt', evt:'getValue.reply', value }
//     { _nzoi:'evt', evt:'cmd.save' }
//     { _nzoi:'evt', evt:'cmd.run' }
//     { _nzoi:'evt', evt:'cmd.submit' }

const _monacoCache = new Map();
const MONACO_BASE = chrome.runtime.getURL('libs/monaco');

async function fetchMonacoText(url) {
  if (_monacoCache.has(url)) return _monacoCache.get(url);
  LOG('Fetching', url.split('/').pop(), '...');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Fetch failed: ' + res.status + ' ' + url);
  const text = await res.text();
  _monacoCache.set(url, text);
  LOG('Fetched', url.split('/').pop(), Math.round(text.length / 1024) + 'KB');
  return text;
}

async function injectMonacoIntoTab(tabId) {
  LOG('Loading Monaco for tab', tabId, '...');
  const [loaderCode, editorCode, workerCode, editorCss] = await Promise.all([
    fetchMonacoText(chrome.runtime.getURL('libs/monaco/loader.min.js')),
    fetchMonacoText(chrome.runtime.getURL('libs/monaco/editor/editor.main.js')),
    fetchMonacoText(chrome.runtime.getURL('libs/monaco/base/worker/workerMain.js')),
    fetchMonacoText(chrome.runtime.getURL('libs/monaco/editor/editor.main.css')),
  ]);
  LOG('Monaco total size:', Math.round((loaderCode.length + editorCode.length + workerCode.length + editorCss.length) / 1024) + 'KB');

  // This runs in the PAGE's MAIN world — it has access to window.monaco after loading,
  // and communicates with the isolated content script via window.postMessage.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (loaderSrc, editorSrc, vsBase, workerSrc, cssSrc) => {
      // Guard against double injection
      if (window.__nzoi_editor_ready) {
        window.postMessage({ _nzoi: 'evt', evt: 'ready' }, '*');
        return;
      }
      if (window.__nzoi_editor_injecting) return;
      window.__nzoi_editor_injecting = true;

      console.log('[NZOI Enhanced MAIN] Starting Monaco injection via script tags...');

      function fail(msg) {
        window.__nzoi_editor_injecting = false;
        console.error('[NZOI Enhanced MAIN] Error:', msg);
        window.postMessage({ _nzoi: 'evt', evt: 'error', message: msg }, '*');
      }

      // Worker environment: build a self-contained blob with the full worker code
      // already inlined — no importScripts() or cross-origin fetches needed.
      // This sidesteps both COEP credentialless restrictions AND any CSP worker-src rules.
      const _workerBlobUrl = URL.createObjectURL(
        new Blob([
          'const __nzoiFetch = self.fetch.bind(self);\n' +
          'self.fetch = (input, init) => {\n' +
          '  if (typeof input === "string") input = input.replace(/^(?:\\.\\.\\/)+(?=chrome-extension:\\/\\/)/, "");\n' +
          '  return __nzoiFetch(input, init);\n' +
          '};\n',
          'self.require = { baseUrl: ' + JSON.stringify(vsBase + '/') +
          ', paths: { vs: ' + JSON.stringify(vsBase) + ' } };\n',
          workerSrc,
        ], { type: 'application/javascript' })
      );
      window.MonacoEnvironment = {
        getWorker() { return new Worker(_workerBlobUrl, { name: 'monaco-editor-worker' }); },
        getWorkerUrl() { return _workerBlobUrl; },
      };

      if (!document.getElementById('nzoi-monaco-css')) {
        const style = document.createElement('style');
        style.id = 'nzoi-monaco-css';
        style.textContent = cssSrc + `
.monaco-editor .nzoi-sem-namespace,.monaco-editor .nzoi-sem-class,.monaco-editor .nzoi-sem-interface,.monaco-editor .nzoi-sem-enum,.monaco-editor .nzoi-sem-type,.monaco-editor .nzoi-sem-typeParameter{color:#4ec9b0!important}
.monaco-editor .nzoi-sem-enumMember{color:#b5cea8!important}
.monaco-editor .nzoi-sem-parameter,.monaco-editor .nzoi-sem-variable,.monaco-editor .nzoi-sem-property{color:#9cdcfe!important}
.monaco-editor .nzoi-sem-function,.monaco-editor .nzoi-sem-method{color:#dcdcaa!important}
.monaco-editor .nzoi-sem-decorator,.monaco-editor .nzoi-sem-macro{color:#c586c0!important}
.monaco-editor.vs .nzoi-sem-namespace,.monaco-editor.vs .nzoi-sem-class,.monaco-editor.vs .nzoi-sem-interface,.monaco-editor.vs .nzoi-sem-enum,.monaco-editor.vs .nzoi-sem-type,.monaco-editor.vs .nzoi-sem-typeParameter{color:#267f99!important}
.monaco-editor.vs .nzoi-sem-enumMember{color:#098658!important}
.monaco-editor.vs .nzoi-sem-parameter,.monaco-editor.vs .nzoi-sem-variable,.monaco-editor.vs .nzoi-sem-property{color:#001080!important}
.monaco-editor.vs .nzoi-sem-function,.monaco-editor.vs .nzoi-sem-method{color:#795e26!important}
.monaco-editor.vs .nzoi-sem-decorator,.monaco-editor.vs .nzoi-sem-macro{color:#af00db!important}
.monaco-editor .nzoi-sem-declaration{font-weight:600!important}
.monaco-editor .nzoi-sem-readonly,.monaco-editor .nzoi-sem-static{font-style:italic!important}
.monaco-hover,.monaco-editor-hover,.monaco-editor .suggest-widget,.monaco-editor .parameter-hints-widget,.monaco-editor .overflowingContentWidgets,.context-view,.monaco-menu-container,.quick-input-widget{z-index:2147483647!important}
.monaco-editor .overflowingContentWidgets{overflow:visible!important}
`;
        (document.head || document.documentElement).appendChild(style);
      }

      // Inject as script tags so document.currentScript is set correctly,
      // which Monaco's AMD loader needs to resolve its own base path.
      function injectScript(code, onDone, onFail) {
        const s = document.createElement('script');
        const u = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        s.src = u;
        s.onload  = () => { URL.revokeObjectURL(u); onDone(); };
        s.onerror = () => { URL.revokeObjectURL(u); onFail('script tag load failed'); };
        (document.head || document.documentElement).appendChild(s);
      }

      let _editor = null;
      let _semDecorationIds = [];

      // ── Semantic tokens: legend + request/response bridge ─────────────────
      // MUST match SEM_TOKEN_TYPES / SEM_TOKEN_MODIFIERS in content.js exactly
      // (index positions are the wire format for the LSP semanticTokens data array).
      const SEM_TYPES = ['namespace','class','interface','enum','enumMember','type','typeParameter','parameter','variable','property','function','method','decorator','macro'];
      const SEM_MODS  = ['declaration','readonly','static','defaultLibrary','async'];
      const _semPending = {};
      let _semIdCtr = 0;

      window.addEventListener('message', e => {
        if (!e.data || e.data._nzoiSem !== 'res') return;
        const cb = _semPending[e.data.id];
        if (cb) { cb(e.data.data || []); delete _semPending[e.data.id]; }
      });

      function requestSemTokens(lang, value) {
        return new Promise(resolve => {
          const id = 'msem-' + (++_semIdCtr);
          _semPending[id] = resolve;
          window.postMessage({ _nzoiSem:'req', lang, id, value }, '*');
          // Safety timeout — never let a stuck request hang Monaco's highlighter
          setTimeout(() => { if (_semPending[id]) { resolve([]); delete _semPending[id]; } }, 30000);
        });
      }

      function registerSemanticTokens(lang) {
        window.monaco.languages.registerDocumentSemanticTokensProvider(lang, {
          getLegend: () => ({ tokenTypes: SEM_TYPES, tokenModifiers: SEM_MODS }),
          provideDocumentSemanticTokens: async (model) => ({
            data: new Uint32Array(await requestSemTokens(lang, model.getValue())),
          }),
          releaseDocumentSemanticTokens: () => {},
        });
      }

      function themeName(theme) {
        return theme === 'vs' || theme === 'light' || theme === 'nzoi-light' ? 'nzoi-light' : 'nzoi-dark';
      }

      function clearSemanticDecorations() {
        if (_editor && _semDecorationIds.length) {
          _semDecorationIds = _editor.deltaDecorations(_semDecorationIds, []);
        } else {
          _semDecorationIds = [];
        }
      }

      function setSemanticDecorations(tokens) {
        if (!_editor) return;
        const range = window.monaco.Range;
        const stickiness = window.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
        const decorations = (tokens || [])
          .filter(t => Array.isArray(t) && t[2] > 0 && SEM_TYPES.includes(t[3]))
          .map(([line, col, length, type, mods]) => ({
            range: new range(line + 1, col + 1, line + 1, col + length + 1),
            options: {
              inlineClassName: ['nzoi-sem-' + type].concat((mods || []).map(m => 'nzoi-sem-' + m)).join(' '),
              stickiness,
            },
          }));
        _semDecorationIds = _editor.deltaDecorations(_semDecorationIds, decorations);
      }

      function refreshEditorTokens() {
        if (!_editor) return;
        _editor.updateOptions({ 'semanticHighlighting.enabled': true });
        const model = _editor.getModel();
        if (model?.tokenization?.forceTokenization) model.tokenization.forceTokenization(model.getLineCount());
        if (typeof _editor.render === 'function') _editor.render(true);
      }

      function ensureLanguage(id, aliases, extensions) {
        if (!window.monaco.languages.getLanguages().some(l => l.id === id)) {
          window.monaco.languages.register({ id, aliases, extensions });
        }
      }

      function installPythonLanguage() {
        ensureLanguage('python', ['Python', 'py'], ['.py']);
        window.monaco.languages.setLanguageConfiguration('python', {
          comments: { lineComment: '#', blockComment: ["'''", "'''"] },
          brackets: [['{','}'], ['[',']'], ['(',')']],
          autoClosingPairs: [
            { open:'{', close:'}' }, { open:'[', close:']' }, { open:'(', close:')' },
            { open:'"', close:'"', notIn:['string'] }, { open:"'", close:"'", notIn:['string','comment'] },
          ],
          surroundingPairs: [
            { open:'{', close:'}' }, { open:'[', close:']' }, { open:'(', close:')' },
            { open:'"', close:'"' }, { open:"'", close:"'" },
          ],
        });
        window.monaco.languages.setMonarchTokensProvider('python', {
          defaultToken: '',
          tokenPostfix: '.python',
          keywords: [
            'and','as','assert','async','await','break','class','continue','def','del','elif','else',
            'except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not',
            'or','pass','raise','return','try','while','with','yield','True','False','None',
          ],
          builtins: [
            'abs','all','any','bool','dict','enumerate','float','int','len','list','map','max','min',
            'open','pow','print','range','reversed','set','sorted','str','sum','tuple','zip','input',
          ],
          tokenizer: {
            root: [
              [/^\s*@[\w.]+/, 'annotation'],
              [/[a-zA-Z_]\w*/, { cases: { '@keywords':'keyword', '@builtins':'predefined', '@default':'identifier' } }],
              [/\d+(\.\d+)?([eE][\-+]?\d+)?/, 'number'],
              [/[{}()\[\]]/, '@brackets'],
              [/#.*$/, 'comment'],
              [/'''/, 'string', '@tqs'],
              [/"""/, 'string', '@tqd'],
              [/'/, 'string', '@sq'],
              [/"/, 'string', '@dq'],
            ],
            tqs: [[/[^']+/, 'string'], [/'''/, 'string', '@pop'], [/'/, 'string']],
            tqd: [[/[^"]+/, 'string'], [/"""/, 'string', '@pop'], [/"/, 'string']],
            sq: [[/\\./, 'string.escape'], [/[^\\']+/, 'string'], [/'/, 'string', '@pop']],
            dq: [[/\\./, 'string.escape'], [/[^\\"]+/, 'string'], [/"/, 'string', '@pop']],
          },
        });
      }

      function installJavaLanguage() {
        ensureLanguage('java', ['Java'], ['.java']);
        window.monaco.languages.setLanguageConfiguration('java', {
          comments: { lineComment: '//', blockComment: ['/*', '*/'] },
          brackets: [['{','}'], ['[',']'], ['(',')']],
          autoClosingPairs: [
            { open:'{', close:'}' }, { open:'[', close:']' }, { open:'(', close:')' },
            { open:'"', close:'"', notIn:['string'] }, { open:"'", close:"'", notIn:['string','comment'] },
          ],
          surroundingPairs: [
            { open:'{', close:'}' }, { open:'[', close:']' }, { open:'(', close:')' },
            { open:'"', close:'"' }, { open:"'", close:"'" },
          ],
        });
        window.monaco.languages.setMonarchTokensProvider('java', {
          defaultToken: '',
          tokenPostfix: '.java',
          keywords: [
            'abstract','assert','boolean','break','byte','case','catch','char','class','const','continue',
            'default','do','double','else','enum','extends','final','finally','float','for','goto','if',
            'implements','import','instanceof','int','interface','long','native','new','package','private',
            'protected','public','return','short','static','strictfp','super','switch','synchronized','this',
            'throw','throws','transient','try','void','volatile','while','var','record','sealed','permits',
            'true','false','null',
          ],
          tokenizer: {
            root: [
              [/[A-Z][\w$]*/, 'type.identifier'],
              [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords':'keyword', '@default':'identifier' } }],
              [/\d+(\.\d+)?([eE][\-+]?\d+)?[fFdDlL]?/, 'number'],
              [/[{}()\[\]]/, '@brackets'],
              [/\/\/.*$/, 'comment'],
              [/\/\*/, 'comment', '@comment'],
              [/"/, 'string', '@string'],
              [/'([^'\\]|\\.)*$/, 'string.invalid'],
              [/'/, 'string', '@char'],
              [/@[a-zA-Z_$][\w$]*/, 'annotation'],
            ],
            comment: [[/[^\/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[\/*]/, 'comment']],
            string: [[/[^\\"]+/, 'string'], [/\\./, 'string.escape'], [/"/, 'string', '@pop']],
            char: [[/[^\\']+/, 'string'], [/\\./, 'string.escape'], [/'/, 'string', '@pop']],
          },
        });
      }

      function installNZOIThemes() {
        const semanticDark = {
          namespace: '#4ec9b0',
          class: '#4ec9b0',
          interface: '#4ec9b0',
          enum: '#4ec9b0',
          enumMember: '#b5cea8',
          type: '#4ec9b0',
          typeParameter: '#4ec9b0',
          parameter: '#9cdcfe',
          variable: '#9cdcfe',
          property: '#9cdcfe',
          function: '#dcdcaa',
          method: '#dcdcaa',
          decorator: '#c586c0',
          macro: '#c586c0',
          'variable.defaultLibrary': '#4fc1ff',
          'function.defaultLibrary': '#dcdcaa',
          '*.declaration': { foreground: '#ffffff', fontStyle: 'bold' },
          '*.readonly': { fontStyle: 'italic' },
          '*.static': { fontStyle: 'italic' },
        };
        const semanticLight = {
          namespace: '#267f99',
          class: '#267f99',
          interface: '#267f99',
          enum: '#267f99',
          enumMember: '#098658',
          type: '#267f99',
          typeParameter: '#267f99',
          parameter: '#001080',
          variable: '#001080',
          property: '#001080',
          function: '#795e26',
          method: '#795e26',
          decorator: '#af00db',
          macro: '#af00db',
          'variable.defaultLibrary': '#0070c1',
          'function.defaultLibrary': '#795e26',
          '*.declaration': { foreground: '#000000', fontStyle: 'bold' },
          '*.readonly': { fontStyle: 'italic' },
          '*.static': { fontStyle: 'italic' },
        };
        window.monaco.editor.defineTheme('nzoi-dark', {
          base: 'vs-dark',
          inherit: true,
          semanticHighlighting: true,
          rules: [
            { token: 'keyword', foreground: '569cd6' },
            { token: 'string', foreground: 'ce9178' },
            { token: 'comment', foreground: '6a9955' },
            { token: 'number', foreground: 'b5cea8' },
            { token: 'annotation', foreground: 'c586c0' },
            { token: 'predefined', foreground: '4fc1ff' },
            { token: 'identifier', foreground: '9cdcfe' },
            { token: 'type.identifier', foreground: '4ec9b0' },
            { token: 'string.escape', foreground: 'd7ba7d' },
          ],
          colors: { 'editor.background': '#1e1e1e' },
          semanticTokenColors: semanticDark,
        });
        window.monaco.editor.defineTheme('nzoi-light', {
          base: 'vs',
          inherit: true,
          semanticHighlighting: true,
          rules: [
            { token: 'keyword', foreground: '0000ff' },
            { token: 'string', foreground: 'a31515' },
            { token: 'comment', foreground: '008000' },
            { token: 'number', foreground: '098658' },
            { token: 'annotation', foreground: 'af00db' },
            { token: 'predefined', foreground: '0070c1' },
            { token: 'identifier', foreground: '001080' },
            { token: 'type.identifier', foreground: '267f99' },
            { token: 'string.escape', foreground: '811f3f' },
          ],
          colors: { 'editor.background': '#ffffff' },
          semanticTokenColors: semanticLight,
        });
      }

      // Handle commands from isolated-world content.js
      window.addEventListener('message', function onMsg(e) {
        if (!e.data || e.data._nzoi !== 'cmd') return;
        const d = e.data;
        if (d.cmd === 'create') {
          const container = document.getElementById(d.containerId);
          if (!container) { fail('Monaco container #' + d.containerId + ' not found'); return; }
          container.innerHTML = '';
          _editor = window.monaco.editor.create(container, {
            value:    d.value || '',
            language: d.language || 'cpp',
            theme:    themeName(d.theme),
            automaticLayout:         true,
            fontSize:                14,
            lineHeight:              21,
            fontFamily:              "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace",
            fontLigatures:           true,
            minimap:                 { enabled: false },
            scrollBeyondLastLine:    false,
            wordWrap:                'off',
            tabSize:                 4,
            insertSpaces:            true,
            renderWhitespace:        'selection',
            bracketPairColorization: { enabled: true },
            guides:                  { bracketPairs: true },
            smoothScrolling:         true,
            cursorSmoothCaretAnimation: 'on',
            suggest:                 { showMethods: true, showFunctions: true, showClasses: true },
            quickSuggestions:        { other: true, comments: false, strings: false },
            fixedOverflowWidgets:    true,
            hover:                   { enabled: true, above: false, sticky: true },
            padding:                 { top: 8, bottom: 8 },
            'semanticHighlighting.enabled': true,
          });
          _editor.onDidChangeModelContent(() => {
            window.postMessage({ _nzoi: 'evt', evt: 'change', value: _editor.getValue() }, '*');
          });
          _editor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS,
            () => window.postMessage({ _nzoi: 'evt', evt: 'cmd.save' }, '*'));
          _editor.addCommand(window.monaco.KeyMod.Alt | window.monaco.KeyCode.KeyR,
            () => window.postMessage({ _nzoi: 'evt', evt: 'cmd.run' }, '*'));
          _editor.addCommand(window.monaco.KeyMod.Alt | window.monaco.KeyCode.KeyS,
            () => window.postMessage({ _nzoi: 'evt', evt: 'cmd.submit' }, '*'));
          window.postMessage({ _nzoi: 'evt', evt: 'ready' }, '*');
        } else if (d.cmd === 'getValue') {
          window.postMessage({ _nzoi: 'evt', evt: 'getValue.reply', value: _editor ? _editor.getValue() : '' }, '*');
        } else if (d.cmd === 'setValue') {
          if (_editor) { _editor.setValue(d.value || ''); clearSemanticDecorations(); }
        } else if (d.cmd === 'setLanguage') {
          if (_editor) { window.monaco.editor.setModelLanguage(_editor.getModel(), d.language); clearSemanticDecorations(); }
        } else if (d.cmd === 'setMarkers') {
          if (_editor) {
            const sev = s => s === 8 ? window.monaco.MarkerSeverity.Error : window.monaco.MarkerSeverity.Warning;
            window.monaco.editor.setModelMarkers(_editor.getModel(), d.source,
              (d.markers || []).map(m => ({ ...m, severity: sev(m.severity), source: d.source })));
          }
        } else if (d.cmd === 'clearMarkers') {
          if (_editor) window.monaco.editor.setModelMarkers(_editor.getModel(), d.source, []);
        } else if (d.cmd === 'setTheme') {
          window.monaco.editor.setTheme(themeName(d.theme));
          refreshEditorTokens();
        } else if (d.cmd === 'refreshSemanticTokens') {
          refreshEditorTokens();
        } else if (d.cmd === 'setSemanticDecorations') {
          setSemanticDecorations(d.tokens);
        } else if (d.cmd === 'clearSemanticDecorations') {
          clearSemanticDecorations();
        }
      });

      // Step 1: load AMD loader
      injectScript(loaderSrc, () => {
        if (!window.require) { fail('loader.min.js did not set window.require'); return; }
        window.require.config({ paths: { vs: vsBase } });
        console.log('[NZOI Enhanced MAIN] AMD loader ready, loading editor bundle...');

        // Step 2: load editor bundle, then call require() to initialise monaco
        injectScript(editorSrc, () => {
          console.log('[NZOI Enhanced MAIN] Editor bundle loaded, calling require...');
          window.require(['vs/editor/editor.main'], () => {
            if (!window.monaco) { fail('require callback fired but window.monaco not set'); return; }
            console.log('[NZOI Enhanced MAIN] window.monaco ready ✓');
            // Real LSP semantic-tokens providers (textDocument/semanticTokens) —
            // backed by genuine ast/lexical analysis in the isolated content
            // script via the _nzoiSem bridge above, not Monarch/regex re-styling.
            try {
              installPythonLanguage();
              installJavaLanguage();
              installNZOIThemes();
              registerSemanticTokens('python');
              registerSemanticTokens('java');
            } catch (e) {
              console.warn('[NZOI Enhanced MAIN] semantic tokens registration failed:', e && e.message);
            }
            window.__nzoi_editor_ready     = true;
            window.__nzoi_editor_injecting = false;
            // Signal isolated world that Monaco is ready to receive 'create' command
            window.postMessage({ _nzoi: 'evt', evt: 'monaco-loaded' }, '*');
          }, (err) => fail('require failed: ' + (err && err.message || err)));
        }, fail);
      }, fail);
    },
    args: [loaderCode, editorCode, MONACO_BASE, workerCode, editorCss],
  });

  LOG('Monaco injection dispatched for tab', tabId);
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      let result;
      switch (msg.type) {
        case 'storage:get':               result = await store.get(msg.keys); break;
        case 'storage:set':               await store.set(msg.data); break;
        case 'storage:remove':            await store.remove(msg.keys); break;
        case 'gist:files':                result = await fetchGistFiles(msg.token); break;
        case 'gist:save':                 await saveFileToGist(msg.token, msg.filename, msg.content); break;
        case 'gist:delete':               await deleteFileFromGist(msg.token, msg.filename); break;
        case 'gist:getOrCreate':          result = await getOrCreateGist(msg.token); break;
        case 'gist:test':                 result = await testGistToken(msg.token); break;
        case 'gist:list':                 result = await listGists(msg.token); break;
        case 'gist:saveClassifications':  await saveClassificationsToGist(msg.token, msg.data); break;
        case 'gist:loadClassifications':  result = await loadClassificationsFromGist(msg.token); break;
        case 'ai:classify':               result = await callAI(msg.provider, msg.apiKey, msg.model, msg.prompt, msg.options || {}); break;
        case 'run:code':                  result = await runCode(msg.source, msg.languageId, msg.stdin); break;
        case 'get:tabId':                 result = sender.tab?.id; break;
        case 'inject:monaco':             await injectMonacoIntoTab(msg.tabId); break;
        default: throw new Error('Unknown message: ' + msg.type);
      }
      sendResponse({ ok: true, data: result });
    } catch(e) {
      ERR(msg.type, e.message);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') store.set({ defaultLanguage: 'cpp', gistAutoSaveMs: 2500 });
});
