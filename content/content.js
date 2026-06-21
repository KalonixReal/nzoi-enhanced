/**
 * NZOI Enhanced - Content Script v10
 * Fixes: Monaco CSP bypass, file manager UI, thorough dark mode,
 *        Python/Java linting (CheerpJ javac), Gist-first save, classification persistence.
 */
'use strict';

const IFRAME_ORIGIN = 'https://clangd-in-browser-fork.pages.dev';

const LANGUAGES = {
  cpp:    { label:'C++ 17',   judgeId:54, submitId:11, ext:'cpp',  monaco:'cpp',    clangd:true  },
  python: { label:'Python 3', judgeId:71, submitId:6,  ext:'py',   monaco:'python', clangd:false },
  java:   { label:'Java',     judgeId:62, submitId:3,  ext:'java', monaco:'java',   clangd:false },
};

const TEMPLATES = {
  cpp:    '#include <bits/stdc++.h>\nusing namespace std;\n\nint main(){\n    \n    return 0;\n}\n',
  python: 'import sys\ninput = sys.stdin.readline\n\ndef main():\n    pass\n\nmain()\n',
  java:   'import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        \n    }\n}\n',
};

const esc = t => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sanitize = n => (n || 'x').replace(/[^a-z0-9_\-]/gi, '_').replace(/_+/g, '_').slice(0, 60);

function injectStyle(id, css) {
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id; el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
}

// Icon shows the mode a click would switch TO (sun while dark = "go light",
// moon while light = "go dark") 閳?mirrors ui.themeIcon() in dashboard.js so
// the toggle behaves identically wherever it appears across the extension.
function themeIconSVG(theme) {
  return theme === 'dark'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

// 閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡?// SEMANTIC TOKENS (LSP textDocument/semanticTokens)
// 閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡?// Real semantic highlighting, registered via Monaco's standard
// `registerDocumentSemanticTokensProvider` API (the same API a true LSP client
// uses) 閳?NOT a Monarch/regex re-skin. Two backends feed it:
//   閳?Python: a genuine `ast`-based analyzer running in the Pyodide worker
//     (real AST, real scope/role classification of every Name/Attribute/Call).
//   閳?Java:   a real lexer (handles strings/text-blocks/comments/escapes
//     correctly) + a lexical/scope-aware classifier that distinguishes type
//     references, declarations vs. calls, member access, annotations, etc.
//     A full type-checking result (as a JDT Language Server would give) would
//     require running Eclipse JDT inside CheerpJ 閳?a second multi-hundred-MB
//     JVM workload that directly conflicts with this refactor's RAM goals 閳?so
//     this is the right engineering tradeoff for an in-browser extension.
//
// Both backends emit `[line0, col0, length, tokenTypeName, modifierNames[]]`
// tuples, which `encodeSemanticTokens()` below sorts/dedupes and delta-encodes
// into the flat Uint32 array the LSP spec (and Monaco) expects.
//
// IMPORTANT: SEM_TOKEN_TYPES / SEM_TOKEN_MODIFIERS order is the index source of
// truth and MUST exactly match the `getLegend()` arrays registered in
// background/service-worker.js (MAIN-world Monaco injection).

const SEM_TOKEN_TYPES = [
  'namespace','class','interface','enum','enumMember','type','typeParameter',
  'parameter','variable','property','function','method','decorator','macro',
];
const SEM_TOKEN_MODIFIERS = ['declaration','readonly','static','defaultLibrary','async'];

function encodeSemanticTokens(raw) {
  if (!raw || !raw.length) return [];
  const valid = raw.filter(t => t && t[2] > 0 && SEM_TOKEN_TYPES.includes(t[3]));
  valid.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  let pl = 0, pc = 0, lastKey = null;
  for (const [line, col, len, typeName, mods] of valid) {
    const key = line + ':' + col;
    if (key === lastKey) continue; // overlapping start 閳?first (more specific) wins
    lastKey = key;
    const typeIdx = SEM_TOKEN_TYPES.indexOf(typeName);
    let bits = 0;
    (mods || []).forEach(m => { const bi = SEM_TOKEN_MODIFIERS.indexOf(m); if (bi >= 0) bits |= (1 << bi); });
    const dLine = line - pl;
    const dCol  = dLine === 0 ? col - pc : col;
    out.push(dLine, dCol, len, typeIdx, bits);
    pl = line; pc = col;
  }
  return out;
}

// 閳光偓閳光偓 Java lexer 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
// Hand-rolled, correctly handles: line/block comments, string & char literals
// (with escapes), Java 13+ text blocks ("""), and number literals (incl. hex/
// binary/underscore/exponent/type-suffix) so none of these can be mistaken for
// identifiers downstream.

const JAVA_KEYWORDS = new Set([
  'abstract','assert','boolean','break','byte','case','catch','char','class','const',
  'continue','default','do','double','else','enum','extends','final','finally','float',
  'for','goto','if','implements','import','instanceof','int','interface','long','native',
  'new','package','private','protected','public','return','short','static','strictfp',
  'super','switch','synchronized','this','throw','throws','transient','try','void',
  'volatile','while','var','record','sealed','permits','yield','true','false','null',
  'module','open','requires','exports','opens','uses','provides','to','with','transitive',
]);
const JAVA_PRIMITIVES         = new Set(['void','int','long','short','byte','char','boolean','float','double','var']);
const JAVA_DECL_PREFIX_KEYWORDS = new Set(['public','private','protected','static','final','abstract','synchronized','native','default','strictfp','transient','volatile']);
const JAVA_TYPEREF_KEYWORDS    = new Set(['extends','implements','new','instanceof','throws']);

function tokenizeJava(src) {
  const toks = [];
  const n = src.length;
  let i = 0, line = 0, col = 0;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; col = 0; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i++; col++; continue; }
    // line comment
    if (c === '/' && src[i+1] === '/') { while (i < n && src[i] !== '\n') { i++; col++; } continue; }
    // block comment
    if (c === '/' && src[i+1] === '*') {
      i += 2; col += 2;
      while (i < n && !(src[i] === '*' && src[i+1] === '/')) { if (src[i] === '\n') { line++; col = 0; } else col++; i++; }
      i += 2; col += 2;
      continue;
    }
    // text block """ ... """
    if (c === '"' && src[i+1] === '"' && src[i+2] === '"') {
      i += 3; col += 3;
      while (i < n && !(src[i] === '"' && src[i+1] === '"' && src[i+2] === '"')) { if (src[i] === '\n') { line++; col = 0; } else col++; i++; }
      i += 3; col += 3;
      continue;
    }
    // string literal
    if (c === '"') {
      i++; col++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') { i++; col++; }
        if (i < n) { if (src[i] === '\n') { line++; col = 0; } else col++; i++; }
      }
      i++; col++;
      continue;
    }
    // char literal
    if (c === "'") {
      i++; col++;
      while (i < n && src[i] !== "'") {
        if (src[i] === '\\') { i++; col++; }
        if (i < n) { col++; i++; }
      }
      i++; col++;
      continue;
    }
    // number literal (int/float/hex/binary, underscores, exponent, type suffix)
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n) {
        const ch = src[j];
        if (/[0-9a-fA-FxXbB_.]/.test(ch)) { j++; continue; }
        if ((ch === 'e' || ch === 'E' || ch === 'p' || ch === 'P') && j > i && /[0-9a-fA-F]/.test(src[j-1])) {
          j++; if (src[j] === '+' || src[j] === '-') j++; continue;
        }
        if (/[lLfFdD]/.test(ch) && j > i && /[0-9a-fA-F]/.test(src[j-1])) { j++; continue; }
        break;
      }
      const len = j - i; col += len; i = j;
      continue;
    }
    // annotation marker
    if (c === '@') { toks.push({ type:'at', text:'@', line, col }); i++; col++; continue; }
    // identifier / keyword
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const text = src.slice(i, j);
      toks.push({ type: JAVA_KEYWORDS.has(text) ? 'kw' : 'id', text, line, col });
      col += text.length; i = j;
      continue;
    }
    // operators / punctuation (single char)
    toks.push({ type:'punct', text:c, line, col });
    i++; col++;
  }
  return toks;
}

// 閳光偓閳光偓 Java semantic classifier 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
// Single linear pass with 1-2 token lookbehind/lookahead. No scope stack is
// needed for these categories 閳?each is a local lexical pattern:
//   class refs (decls, extends/implements/new/instanceof/throws, generics,
//   arrays, "Type name" pairs), method decls vs. calls (incl. via `.`),
//   field/constant access via `.`, annotations, and import path segments.
// Known limitation: a `>` immediately before `name(` is treated as "declaration"
// (covers the common `List<String> getNames(` pattern); rare constructs like
// explicit generic-call witnesses (`Collections.<T>emptyList()`) or expression
// lambdas (`() -> foo()`, where `->` lexes as `-` `>`) can inherit that modifier
// on a call. Token TYPE (the colour) stays correct in all these cases 閳?only the
// `declaration` modifier (usually just font-weight) can be imprecise.
// A second, type-level limitation: an ALL-CAPS or Capitalized constant used as a
// non-final argument in a call (`max(i, MOD, 5)`) can be coloured as 'class' by
// the generic-type-argument rule, since `,`-`,` is also how `Map<K, V>` type
// arguments look without full bracket-depth tracking. Cosmetic only 閳?the
// constant itself is never misread as a keyword/declaration.
function computeJavaSemanticTokens(src) {
  let toks;
  try { toks = tokenizeJava(src); } catch { return []; }
  const raw = [];
  const CAP     = s => /^[A-Z]/.test(s);
  const ALLCAPS = s => /^[A-Z][A-Z0-9_]*$/.test(s);
  const claimed = new Set();
  const keyOf = t => t.line + ':' + t.col;
  const emit = (t, type, mods = []) => {
    const key = keyOf(t);
    if (claimed.has(key)) return;
    claimed.add(key);
    raw.push([t.line, t.col, t.text.length, type, mods]);
  };
  const isTypeToken = t => (t?.type === 'id' && CAP(t.text)) || (t?.type === 'kw' && JAVA_PRIMITIVES.has(t.text));
  const isDeclModifier = t => t?.type === 'kw' && JAVA_DECL_PREFIX_KEYWORDS.has(t.text);
  const prevSignificant = idx => {
    let j = idx - 1;
    while (j >= 0 && isDeclModifier(toks[j])) j--;
    return toks[j];
  };

  // Import path segments 閳?run FIRST so the general loop below can skip these
  // positions entirely (otherwise e.g. `import java.util.*` would ALSO hit the
  // member-access rule for `util` and emit a conflicting 'property' token at
  // the same position).
  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (!(t.type==='kw' && t.text==='import')) continue;
    let j = idx+1;
    if (toks[j] && toks[j].type==='kw' && toks[j].text==='static') j++;
    const seg = [];
    let wildcard = false;
    while (j < toks.length && !(toks[j].type==='punct' && toks[j].text===';')) {
      if (toks[j].type==='id') seg.push(toks[j]);
      else if (toks[j].type==='punct' && toks[j].text==='*') wildcard = true;
      j++;
    }
    seg.forEach((s, si) => {
      const isLast = si === seg.length-1;
      const type = (wildcard || !isLast) ? 'namespace' : (CAP(s.text) ? 'class' : 'method');
      emit(s, type);
    });
  }

  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.type !== 'id') continue;
    if (claimed.has(keyOf(t))) continue;
    const prev = toks[idx-1], prev2 = toks[idx-2], next = toks[idx+1], sigPrev = prevSignificant(idx);

    // @Annotation name
    if (prev && prev.type === 'at') { emit(t, 'decorator'); continue; }

    // Member access `x.y` 閳?skip if part of varargs ellipsis `...y`
    if (prev && prev.type==='punct' && prev.text==='.' && !(prev2 && prev2.type==='punct' && prev2.text==='.')) {
      if (next && next.type==='punct' && next.text==='(') emit(t, 'method');
      else emit(t, 'property', ALLCAPS(t.text) ? ['static','readonly'] : []);
      continue;
    }

    // Type declaration: class/interface/enum/record Name
    if (prev && prev.type==='kw' && ['class','interface','enum','record'].includes(prev.text)) {
      emit(t, 'class', ['declaration']); continue;
    }

    // Type reference after extends/implements/new/instanceof/throws
    if (prev && prev.type==='kw' && JAVA_TYPEREF_KEYWORDS.has(prev.text) && CAP(t.text)) {
      emit(t, 'class'); continue;
    }

    // Generic/array type usage: Foo<...>, Foo[], Foo. ; or inside <Foo,Bar> / [Foo]
    if (CAP(t.text) && next && next.type==='punct' && ['.','<','['].includes(next.text)) {
      emit(t, 'class'); continue;
    }
    // Generic type-argument position: <Foo,Bar> / Map<K, V> etc. Require the
    // identifier to ALSO be followed by a generic/array delimiter, so an
    // ALL-CAPS constant passed as an ordinary call argument (e.g. max(i, MOD))
    // 閳?which also has a `,` to its left 閳?isn't mistaken for a type argument.
    if (CAP(t.text) && prev && prev.type==='punct' && ['<',',','['].includes(prev.text)
        && next && next.type==='punct' && ['>',',','[',']'].includes(next.text)) {
      emit(t, 'class'); continue;
    }

    // "TypeName identifier" 閳?declared type immediately preceding a name
    if (CAP(t.text) && next && next.type==='id') {
      emit(t, 'class'); continue;
    }

    // Method declaration / call: identifier(
    if (next && next.type==='punct' && next.text==='(') {
      const declLike = !prev
        || prev.type==='id'
        || (prev.type==='kw' && (JAVA_PRIMITIVES.has(prev.text) || JAVA_DECL_PREFIX_KEYWORDS.has(prev.text)))
        || (prev.type==='punct' && (prev.text==='>' || prev.text===']'));
      emit(t, 'method', declLike ? ['declaration'] : []);
      continue;
    }

    const declarationLike =
      isTypeToken(sigPrev) ||
      (sigPrev?.type === 'punct' && ['>', ']'].includes(sigPrev.text)) ||
      (prev?.type === 'punct' && prev.text === ',' && toks.slice(Math.max(0, idx - 6), idx).some(isTypeToken));

    if (declarationLike) {
      const mods = ['declaration'];
      if (ALLCAPS(t.text)) mods.push('static', 'readonly');
      emit(t, 'variable', mods);
      continue;
    }

    if (ALLCAPS(t.text)) { emit(t, 'variable', ['static', 'readonly']); continue; }
    if (CAP(t.text)) { emit(t, 'class'); continue; }
    emit(t, 'variable');
  }

  return raw;
}

// 閳光偓閳光偓 Background bridge 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓

function bg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || 'BG error'));
      resolve(res.data);
    });
  });
}

// 閳光偓閳光偓 Storage helpers 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓

async function getToken() {
  return new Promise(r => chrome.storage.local.get('githubToken', d => r(d.githubToken || '')));
}
async function storageGet(key) {
  return new Promise(r => chrome.storage.local.get(key, d => r(d[key] ?? null)));
}
async function storageSet(key, val) {
  return new Promise(r => chrome.storage.local.set({ [key]: val }, r));
}

async function storageRemove(key) {
  return new Promise(r => chrome.storage.local.remove(key, r));
}

// 閳光偓閳光偓 Auto-save (Gist-first; local is offline buffer only) 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓

let _gistTimer = null, _localTimer = null, _autoSaveDelay = 2500;

chrome.storage.local.get('gistAutoSaveMs', d => { if (d.gistAutoSaveMs) _autoSaveDelay = d.gistAutoSaveMs; });
chrome.storage.onChanged.addListener(c => { if (c.gistAutoSaveMs?.newValue) _autoSaveDelay = c.gistAutoSaveMs.newValue; });

function gistFilename(pid, lang, name) {
  return `${sanitize(name || pid)}_${pid}.${LANGUAGES[lang]?.ext || 'txt'}`;
}

function scheduleLocalSave(pid, lang, code) {
  clearTimeout(_localTimer);
  _localTimer = setTimeout(() => storageSet(`code_${pid}_${lang}`, code), 500);
}

async function pushToGist(pid, lang, code, name) {
  const token = await getToken();
  if (!token) throw new Error('No GitHub token - set one in the extension popup to enable Gist sync');
  await bg({ type:'gist:save', token, filename: gistFilename(pid, lang, name), content: code });
  await storageRemove(`code_${pid}_${lang}`);
}

function scheduleGistSave(pid, lang, code, name, onOk) {
  clearTimeout(_gistTimer);
  _gistTimer = setTimeout(async () => {
    try {
      await pushToGist(pid, lang, code, name);
      if (onOk) onOk();
    } catch(e) {
      console.warn('[NZOI Enhanced] Gist auto-save failed - keeping local copy:', e.message);
      scheduleLocalSave(pid, lang, code);
    }
  }, _autoSaveDelay);
}

function autoSave(pid, lang, code, name, onOk) {
  getToken().then(token => {
    if (token) scheduleGistSave(pid, lang, code, name, onOk);
    else scheduleLocalSave(pid, lang, code);
  });
}

async function manualSave(pid, lang, code, name) {
  clearTimeout(_gistTimer); clearTimeout(_localTimer);
  await pushToGist(pid, lang, code, name);
}

async function loadCode(pid, lang) {
  try {
    const token = await getToken();
    if (token) {
      const files = await bg({ type:'gist:files', token });
      const ext   = LANGUAGES[lang]?.ext || 'txt';
      const file  = Object.values(files).find(f => {
        const m = f.filename.match(/_(\d+)\.[a-z]+$/);
        return m && m[1] === String(pid) && f.filename.endsWith('.' + ext);
      });
      if (file) {
        const content = file.truncated ? await fetch(file.raw_url).then(r => r.text()) : file.content;
        return { code: content, src: 'gist' };
      }
    }
  } catch(e) { console.warn('[NZOI Enhanced] Gist load:', e.message); }
  const local = await storageGet(`code_${pid}_${lang}`);
  if (local) return { code: local, src: 'storage' };
  return { code: null, src: null };
}

// Router: exact numeric problem statements get the IDE; all other pages get styling only.
const path = window.location.pathname.replace(/\/+$/, '') || '/';
const isProblemStatementPage = /^\/problems\/\d+$/.test(path);

if (isProblemStatementPage) {
  initProblemPage();
} else {
  applyGlobalDarkTheme();
}

// 閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡?// PROBLEM PAGE
// 閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡?
async function initProblemPage() {
  const pid = (path.match(/\/problems\/([^/]+)/) || [])[1] || 'default';
  let currentLang     = 'cpp';
  let code            = TEMPLATES.cpp;
  let _codeInEditor   = false;
  let _pname          = null;
  let _clangdRetry    = null;
  // Monaco lives in MAIN world; we talk to it via postMessage.
  let _monacoInjected = false;  // MAIN world bundle loaded
  let _editorCreated  = false;  // editor.create() complete and ready

  // Theme preference is shared (storage key 'theme') with the dashboard and the
  // lightweight global-dark-theme pages, so flipping it anywhere is consistent
  // everywhere. Applied before any styles/DOM below to avoid a flash.
  const { theme: storedTheme } = await new Promise(r => chrome.storage.local.get('theme', d => r(d)));
  let currentTheme = storedTheme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);

  const getPName = () => {
    if (!_pname) {
      _pname = document.querySelector('h1.ui.header')?.textContent.trim()
        || document.title.split('|')[0].trim() || 'Untitled';
    }
    return _pname;
  };

  const resolveStatementImageUrl = raw => {
    const src = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
    if (!src) return '';
    if (/^(?:https?:|data:|blob:|chrome-extension:)/i.test(src)) return src;
    if (src.startsWith('/')) return new URL(src, location.origin).href;
    const problemBase = new URL(location.pathname.endsWith('/') ? location.pathname : location.pathname + '/', location.origin);
    return new URL(src, problemBase).href;
  };

  const statementImageFallbacks = raw => {
    const src = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
    if (!src || /^(?:https?:|data:|blob:|chrome-extension:|\/)/i.test(src)) return [];
    const normalRelative = new URL(src, location.href).href;
    const problemFile = new URL(`/problems/${pid}/${src}`, location.origin).href;
    const problemFiles = new URL(`/problems/${pid}/files/${src}`, location.origin).href;
    return [...new Set([normalRelative, problemFile, problemFiles])];
  };

  const resolveStatementAssetUrl = raw => {
    const src = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
    if (!src) return '';
    try {
      if (/^(?:https?:|data:|blob:|chrome-extension:)/i.test(src)) return src;
      if (src.startsWith('/')) return new URL(src, location.origin).href;
      const problemBase = new URL(location.pathname.endsWith('/') ? location.pathname : location.pathname + '/', location.origin);
      return new URL(src, problemBase).href;
    } catch {
      return '';
    }
  };

  const fixStatementImagePlaceholders = (root = document) => {
    const selector = '.problem-description,.problem-statement,#main-container';
    const isScopedElement = root.nodeType === Node.ELEMENT_NODE && (root.matches(selector) || root.closest(selector));
    const scopes = isScopedElement
      ? [root]
      : [...(root.querySelectorAll?.(selector) || [])];
    const imageToken = /!?\[([^\]\n]*)\]\(([^)\s]+(?:\s+["'][^"']+["'])?)\)/g;
    const imageExt = /\.(?:png|jpe?g|gif|webp|svg|bmp)(?:[?#].*)?$/i;
    scopes.forEach(scope => {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest('pre,code,kbd,samp,textarea,script,style')) return NodeFilter.FILTER_REJECT;
          imageToken.lastIndex = 0;
          if (!imageToken.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
          imageToken.lastIndex = 0;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        const text = node.nodeValue || '';
        imageToken.lastIndex = 0;
        let match, last = 0, changed = false;
        const frag = document.createDocumentFragment();
        while ((match = imageToken.exec(text))) {
          const rawTarget = (match[2] || '').trim().split(/\s+["']/)[0];
          if (!imageExt.test(rawTarget)) continue;
          if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
          const img = document.createElement('img');
          img.className = 'nzoi-statement-img';
          img.alt = match[1] || rawTarget.split('/').pop() || 'problem image';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.src = resolveStatementImageUrl(rawTarget);
          img.dataset.fallbacks = JSON.stringify(statementImageFallbacks(rawTarget));
          img.addEventListener('error', () => {
            let fallbacks = [];
            try { fallbacks = JSON.parse(img.dataset.fallbacks || '[]'); } catch {}
            const next = fallbacks.shift();
            img.dataset.fallbacks = JSON.stringify(fallbacks);
            if (next && next !== img.src) img.src = next;
          });
          frag.appendChild(img);
          last = imageToken.lastIndex;
          changed = true;
        }
        if (!changed) return;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    });
  };

  const embeddedPdfUrls = new Set();
  const pendingPdfUrls = new Set();
  let pdfEmbedTimer = null;

  const findStatementPdfLinks = (root = document) => {
    const selector = '.problem-description,.problem-statement,#main-container';
    const isScopedElement = root.nodeType === Node.ELEMENT_NODE && (root.matches(selector) || root.closest(selector));
    const scopes = isScopedElement
      ? [root]
      : [...(root.querySelectorAll?.(selector) || [])];
    const links = [];
    const add = href => {
      const url = resolveStatementAssetUrl(href);
      if (/\.pdf(?:[?#]|$)/i.test(url) && !links.includes(url)) links.push(url);
    };
    scopes.forEach(scope => {
      if (scope.closest?.('.nzoi-pdf-embeds')) return;
      scope.querySelectorAll?.('a[href], iframe[src], embed[src], object[data]')?.forEach(el => {
        if (el.closest('.nzoi-pdf-embeds')) return;
        add(el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data'));
      });
      const text = scope.innerText || '';
      const markdownPdfRe = /(?:!?\[[^\]\n]*\]\(|href=["']?)([^)"'\s<>]+\.pdf(?:[?#][^)"'\s<>]*)?)/gi;
      let match;
      while ((match = markdownPdfRe.exec(text))) add(match[1]);
      const barePdfRe = /(?:^|[\s("'=])((?:https?:\/\/|\.{0,2}\/|\/)?[A-Za-z0-9._~:/?#@!$&*+,;=%-]+\.pdf(?:[?#][A-Za-z0-9._~:/?#@!$&*+,;=%-]*)?)/gi;
      while ((match = barePdfRe.exec(text))) add(match[1]);
    });
    return links.slice(0, 4);
  };

  const getPdfFrameSrc = async url => {
    try {
      if (new URL(url, location.href).origin !== location.origin) return url;
      const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
    } catch {
      return null;
    }
  };

  const appendPdfEmbed = (url, frameSrc) => {
    const statement = document.querySelector('.problem-description,.problem-statement');
    const container = document.getElementById('main-container');
    if ((!statement && !container) || embeddedPdfUrls.has(url)) return;
    let holder = document.getElementById('nzoi-pdf-embeds');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'nzoi-pdf-embeds';
      holder.className = 'nzoi-pdf-embeds';
      if (statement?.parentNode) statement.parentNode.insertBefore(holder, statement);
      else container.appendChild(holder);
    }
    const name = (() => {
      try { return decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'PDF attachment'); }
      catch { return 'PDF attachment'; }
    })();
    const box = document.createElement('section');
    box.className = 'nzoi-pdf-embed';
    box.dataset.pdfUrl = url;
    const head = document.createElement('div');
    head.className = 'nzoi-pdf-head';
    const title = document.createElement('span');
    title.className = 'nzoi-pdf-title';
    title.textContent = `PDF: ${name}`;
    const open = document.createElement('a');
    open.className = 'nzoi-pdf-open';
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Open';
    const frame = document.createElement('iframe');
    frame.className = 'nzoi-pdf-frame';
    frame.src = frameSrc;
    frame.title = name;
    frame.loading = 'lazy';
    head.appendChild(title);
    head.appendChild(open);
    box.appendChild(head);
    box.appendChild(frame);
    holder.appendChild(box);
    embeddedPdfUrls.add(url);
  };

  const scheduleStatementPdfEmbeds = (root = document) => {
    if (pdfEmbedTimer) clearTimeout(pdfEmbedTimer);
    pdfEmbedTimer = setTimeout(async () => {
      pdfEmbedTimer = null;
      const urls = findStatementPdfLinks(root);
      for (const url of urls) {
        if (embeddedPdfUrls.has(url) || pendingPdfUrls.has(url)) continue;
        pendingPdfUrls.add(url);
        const frameSrc = await getPdfFrameSrc(url);
        pendingPdfUrls.delete(url);
        if (!frameSrc) continue;
        appendPdfEmbed(url, frameSrc);
      }
    }, 200);
  };

  setTimeout(() => {
    const n = getPName();
    if (n && n !== 'Untitled') chrome.storage.local.set({ ['nzname_' + pid]: n });
  }, 600);

  // 閳光偓閳光偓 Styles 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  injectStyle('nzoi-problem-styles', `
:root{
  --bg0:#121212;--bg1:#1e1e1e;--bg2:#252526;--bg3:#2d2d2d;
  --bd:#333;--bdl:#444;--fg:#e0e0e0;--fg2:#c9d1d9;--fgm:#999;--fgs:#666;
  --ac:#0a84ff;--gn:#2ecc71;--rd:#e06c75;--yw:#e5c07b;
  --syn-kw:#569cd6;--syn-str:#ce9178;--syn-com:#6a9955;--syn-num:#b5cea8;--syn-fn:#dcdcaa;
  --info-bg:#0d2137;--warn-bg:#1e1a0d;--err-bg:#1e0d0d;--ok-bg:#0d1e0d;
  --font:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
/* Light theme 閳?toggled via data-theme="light" on <html>, persisted in
   chrome.storage.local under 'theme' (shared with the dashboard). Every color
   in this sheet routes through these tokens, so this block alone re-skins the
   whole IDE chrome (Monaco itself is switched separately via setTheme). */
:root[data-theme="light"]{
  --bg0:#ffffff;--bg1:#f6f8fa;--bg2:#eaeef2;--bg3:#d8dee4;
  --bd:#d0d7de;--bdl:#afb8c1;--fg:#1f2328;--fg2:#444c56;--fgm:#57606a;--fgs:#6e7781;
  --ac:#0969da;--gn:#1a7f37;--rd:#cf222e;--yw:#9a6700;
  --syn-kw:#0451a5;--syn-str:#a31515;--syn-com:#008000;--syn-num:#098658;--syn-fn:#795e26;
  --info-bg:#ddf4ff;--warn-bg:#fff8c5;--err-bg:#ffebe9;--ok-bg:#dafbe1;
}

/* 閳光偓閳光偓 Page reset 閳光偓閳光偓 */
*,*::before,*::after{box-sizing:border-box}
html,body{background:var(--bg0)!important;color:var(--fg)!important;font-family:var(--font)!important;min-height:100vh;overflow:hidden!important}
a{color:var(--fg)!important;text-decoration:none!important}
a:hover{color:var(--fg)!important;text-decoration:underline!important}
::-webkit-scrollbar{width:7px;height:7px}
::-webkit-scrollbar-track{background:var(--bg0)}
::-webkit-scrollbar-thumb{background:var(--bg2);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:var(--bdl)}

/* 閳光偓閳光偓 Layout 閳光偓閳光偓 */
#nzoi-layout{
  position:relative!important;z-index:1!important;
  display:flex;width:100%;height:calc(100dvh - var(--nzoi-layout-top, 0px) - 8px);max-height:calc(100dvh - var(--nzoi-layout-top, 0px) - 8px);
  overflow:hidden;background:var(--bg0)
}
#main-container{width:50%;height:100%;overflow-y:auto;padding:12px 16px;border-right:1px solid var(--bd);background:var(--bg0)}
#nzoi-resizer{width:5px;cursor:col-resize;background:var(--bg1);flex-shrink:0;transition:background .2s}
#nzoi-resizer:hover,#nzoi-resizer.dragging{background:var(--ac)}
#nzoi-sidebar{flex:1;background:var(--bg1);display:flex;flex-direction:column;overflow:hidden;min-width:300px}

/* 閳光偓閳光偓 Problem content 閳光偓閳光偓 */
#main-container .ui.segment,#main-container .ui.container,
#main-container .ui.breadcrumb{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important;margin:0 0 10px!important}
#main-container h1,#main-container h2,#main-container h3,
#main-container .ui.header{color:var(--fg)!important;font-family:var(--font)!important}
#main-page-title-box{margin-bottom:16px!important;padding:0!important}
.ui.breadcrumb .section{color:var(--fg)!important}
.ui.breadcrumb .divider{color:var(--fgs)!important}
.problem-description,.problem-statement{color:var(--fg)!important;line-height:1.7!important}
.problem-description p,.problem-statement p{margin-bottom:10px!important}

/* 閳光偓閳光偓 Tables 閳光偓閳光偓 */
table,thead,tbody,tfoot,tr,td,th{
  background:var(--bg2)!important;color:var(--fg)!important;
  border-color:var(--bd)!important;border-collapse:collapse!important;
}
thead tr,th{background:var(--bg3)!important;font-weight:600!important}
tr:hover td{background:var(--bg3)!important}

/* 閳光偓閳光偓 Code blocks 閳光偓閳光偓 */
pre,code,kbd,samp,tt{
  background:var(--bg2)!important;color:var(--fg2)!important;
  font-family:'JetBrains Mono','Fira Code','Courier New',monospace!important;
}
pre{border:1px solid var(--bd)!important;border-radius:6px!important;padding:10px 14px!important;overflow-x:auto!important;white-space:pre-wrap!important;margin:8px 0!important}
code{border-radius:3px!important;padding:2px 5px!important;font-size:.9em!important}
.highlight{background:var(--bg2)!important;border:1px solid var(--bd)!important;border-radius:6px!important;overflow:hidden!important;margin:8px 0!important}
.highlight pre{margin:0!important;border:none!important;background:transparent!important}
.highlight .k,.highlight .kn,.highlight .kd{color:var(--syn-kw)!important}
.highlight .s,.highlight .s1,.highlight .s2{color:var(--syn-str)!important}
.highlight .c,.highlight .c1,.highlight .cm{color:var(--syn-com)!important}
.highlight .mi,.highlight .mf,.highlight .mh{color:var(--syn-num)!important}
.highlight .nf,.highlight .nc{color:var(--syn-fn)!important}
.highlight .o,.highlight .p{color:var(--fg)!important}

/* 閳光偓閳光偓 Sample boxes 閳光偓閳光偓 */
.samples{border:1px solid var(--bd)!important;border-radius:6px!important;overflow:hidden!important;margin:10px 0!important}
.samples li{background:var(--bg2)!important;border-color:var(--bd)!important}
.samples .title{background:var(--bg3)!important;color:var(--fgm)!important;font-size:12px!important;padding:6px 12px!important;font-weight:600!important}
.samples pre{background:var(--bg1)!important;border:none!important;margin:0!important;padding:10px 14px!important;border-radius:0!important}

/* 閳光偓閳光偓 Forms / inputs 閳光偓閳光偓 */
input,select,textarea,button.ui{
  background:var(--bg2)!important;color:var(--fg)!important;
  border:1px solid var(--bd)!important;border-radius:5px!important;
  font-family:var(--font)!important;
}
input:focus,select:focus,textarea:focus{outline:none!important;border-color:var(--ac)!important;box-shadow:0 0 0 2px rgba(10,132,255,.2)!important}

/* 閳光偓閳光偓 UI elements 閳光偓閳光偓 */
.ui.label,.label{background:var(--bg3)!important;color:var(--fg)!important;border-color:var(--bd)!important}
.ui.card,.ui.cards>.card{background:var(--bg2)!important;border-color:var(--bd)!important;box-shadow:none!important}
.ui.divider{border-color:var(--bd)!important}
.ui.popup{background:var(--bg2)!important;border-color:var(--bd)!important;color:var(--fg)!important}
.ui.message{background:var(--bg2)!important;color:var(--fg)!important;border-color:var(--bd)!important;box-shadow:none!important}
.ui.info.message{background:var(--info-bg)!important;border-left:3px solid var(--ac)!important}
.ui.warning.message{background:var(--warn-bg)!important;border-left:3px solid var(--yw)!important}
.ui.error.message,.ui.negative.message{background:var(--err-bg)!important;border-left:3px solid var(--rd)!important}
.ui.success.message,.ui.positive.message{background:var(--ok-bg)!important;border-left:3px solid var(--gn)!important}
/* 閳光偓閳光偓 Question tabs 閳?FIX: readable text on both the resting and active background 閳光偓閳光偓 */
.tab_menu,.ui.tabular.menu{display:flex!important;gap:6px!important;border-bottom:1px solid var(--bd)!important;margin:14px 0!important;padding:0!important;background:transparent!important}
.tab_menu li{display:block!important;min-width:auto!important;margin:0!important;padding:0!important}
.tab_menu li a,.ui.tabular.menu .item{
  color:var(--fg2)!important;background:var(--bg2)!important;
  border:1px solid var(--bd)!important;border-bottom:none!important;
  border-radius:8px 8px 0 0!important;font-weight:600!important;
  height:auto!important;padding:8px 14px!important;transition:all .15s!important;
}
.tab_menu li a:hover,.ui.tabular.menu .item:hover{
  color:var(--fg)!important;background:var(--bg3)!important;
}
.tab_menu li a.selected,.ui.tabular.menu .active.item{
  color:var(--ac)!important;background:var(--bg1)!important;
  border-color:var(--bd)!important;border-bottom-color:var(--bg1)!important;
}
.ui.top.attached{border-color:var(--bd)!important}
.ui.attached.segment{background:var(--bg1)!important;border-color:var(--bd)!important}

/* 閳光偓閳光偓 Override menu defaults so menu items read cleanly 閳光偓閳光偓 */
.navbar,nav,#main-menu,#side,#side-container,.ui.menu{background:var(--bg1)!important;border-color:var(--bd)!important;color:var(--fg)!important}
.navbar *,nav *,#main-menu *,#side,#side *,.ui.menu .item{color:var(--fg2)!important}
ul.nav-theme li,ul.nav-theme ul,#side-minify{background:var(--bg1)!important;border-color:var(--bd)!important}
ul.nav-theme a{color:var(--fg2)!important}
.ui.menu .active.item,.ui.menu .item:hover,.navbar a:hover,nav a:hover,ul.nav-theme li:hover,ul.nav-theme li.sfHover,ul.nav-theme a:hover,#side-minify:hover{color:var(--fg)!important;background:var(--bg2)!important}
.ui.button{background:var(--bg3)!important;color:var(--fg)!important;border:1px solid var(--bd)!important}
.ui.button:hover{background:var(--bdl)!important}
.ui.primary.button{background:var(--ac)!important;color:#fff!important;border-color:transparent!important}
.ui.positive.button,.ui.green.button{background:var(--gn)!important;color:#fff!important;border-color:transparent!important}
.ui.negative.button,.ui.red.button{background:var(--rd)!important;color:#fff!important;border-color:transparent!important}
.ui.list .item,.ui.list .description{color:var(--fg)!important}
.ui.grid>.row,.ui.grid>.column{background:transparent!important}
.ui.footer,.ui.segment.footer{background:var(--bg1)!important;color:var(--fgm)!important;border-top:1px solid var(--bd)!important}
.ui.statistic,.ui.statistics .statistic{color:var(--fg)!important}
.ui.statistics .label{color:var(--fgm)!important}
.ui.progress{background:var(--bg3)!important}
.ui.progress .bar{background:var(--ac)!important}
blockquote{border-left:3px solid var(--bd)!important;color:var(--fgm)!important;padding-left:12px!important;margin:8px 0!important}
img{max-width:100%!important}
.nzoi-statement-img{display:block;max-width:100%!important;height:auto!important;margin:12px auto!important;border-radius:6px}
.nzoi-pdf-embeds{margin:16px 0}
.nzoi-pdf-embed{border:1px solid var(--bd);border-radius:6px;overflow:hidden;background:var(--bg1);margin:14px 0}
.nzoi-pdf-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:var(--bg2);border-bottom:1px solid var(--bd);font-size:12px}
.nzoi-pdf-title{font-weight:700;color:var(--fg);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nzoi-pdf-open{color:var(--ac)!important;font-weight:700;flex-shrink:0}
.nzoi-pdf-frame{display:block;width:100%;height:min(72vh,760px);min-height:420px;border:0;background:#fff}
.math,.MathJax{color:var(--fg)!important}

/* 閳光偓閳光偓 Editor sidebar 閳光偓閳光偓 */
.sc{height:100%;display:flex;flex-direction:column;padding:8px;gap:6px}
.ec{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:2px 0}
#save-st{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--gn);opacity:0;transition:opacity .5s ease;margin-right:auto;white-space:nowrap;flex-shrink:0}
#save-st svg{flex-shrink:0;stroke-dasharray:20;stroke-dashoffset:0;transition:stroke-dashoffset .3s ease}
.nbtn{border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px;transition:opacity .2s,background .2s;white-space:nowrap}
.icbtn{
  display:flex;align-items:center;justify-content:center;width:28px;height:28px;
  border:1px solid var(--bd);background:transparent;color:var(--fgm);
  border-radius:4px;cursor:pointer;transition:all .2s;padding:0;flex-shrink:0;
}
.icbtn:hover{background:var(--bg3);color:var(--fg);border-color:var(--bdl)}
.icbtn svg{width:14px;height:14px}
.nbtn:hover{opacity:.85}
#run-btn{background:#4263eb;color:#fff}
#submit-btn{background:var(--gn);color:#fff}
#save-btn,#files-btn{background:var(--bg2);color:var(--fg);border:1px solid var(--bd)}
#save-btn:hover,#files-btn:hover{background:var(--bg3)}
#lang-sel{background:var(--bg2);color:var(--fg);border:1px solid var(--bd);border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer}
#editor-wrap{flex:1;border:1px solid var(--bd);border-radius:4px;overflow:hidden;position:relative;min-height:0}
#clangd-iframe{width:100%;height:100%;border:none}
#monaco-wrap{width:100%;height:100%}
.ed-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg1);color:var(--fgm);font-size:13px;gap:8px;z-index:5}
.ed-loading small{font-size:10px;color:var(--fgs)}
.ed-err{color:var(--rd);font-size:12px;text-align:center;padding:0 20px}
#vresizer{height:6px;background:var(--bg1);cursor:row-resize;display:flex;justify-content:center;align-items:center;flex-shrink:0;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd)}
#vresizer::after{content:'';width:34px;height:2px;border-radius:999px;background:var(--fgs);opacity:.65}
#test-wrap{min-height:80px;background:var(--bg1);display:flex;flex-direction:column;overflow:hidden}
#test-results{padding:8px;overflow-y:auto;flex:1}
.tr{margin-bottom:6px;border:1px solid var(--bd);border-radius:5px;overflow:hidden}
.th2{padding:8px 12px;background:var(--bg2);display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700}
.th2.pass{color:var(--gn)}.th2.fail{color:var(--rd)}
.td{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px;background:var(--bg1)}
.tb strong{color:var(--fgm);display:block;margin-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
.tb pre{margin:0;white-space:pre-wrap;font-family:'JetBrains Mono','Courier New',monospace;font-size:12px;color:var(--fg);background:var(--bg0)!important;padding:6px 8px;border-radius:4px;max-height:120px;overflow-y:auto}

/* 閳光偓閳光偓 Modal 閳光偓閳光偓 */
.nzoi-modal{position:fixed;z-index:10000;inset:0;background:rgba(0,0,0,.85);display:flex;justify-content:center;align-items:center}
.modal-c{background:var(--bg1);width:90%;max-width:700px;border-radius:10px;border:1px solid var(--bd);display:flex;flex-direction:column;max-height:90vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.modal-h{padding:14px 18px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center;background:var(--bg2);flex-shrink:0}
.modal-h h2{margin:0;font-size:15px;color:var(--fg)}
.modal-h small{font-size:11px;color:var(--fgm);margin-left:8px}
.mcl{background:none;border:none;color:var(--fgm);font-size:20px;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background .15s,color .15s}
.mcl:hover{background:var(--bg3);color:var(--fg)}
.tabs{display:flex;border-bottom:1px solid var(--bd);background:var(--bg2);flex-shrink:0}
.tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--fgm);padding:9px 20px;cursor:pointer;font-weight:600;font-size:13px;margin-bottom:-1px;transition:color .2s,border-color .2s}
.tab:hover{color:var(--fg)}.tab.on{color:var(--ac);border-bottom-color:var(--ac)}
.modal-b{padding:12px 16px;overflow-y:auto;flex:1}
.fi{padding:10px 14px;border:1px solid var(--bd);margin-bottom:6px;border-radius:6px;background:var(--bg2);display:flex;gap:12px;align-items:flex-start;transition:border-color .15s}
.fi:hover{border-color:var(--bdl)}
.fi-info{flex:1;min-width:0}
.fi-name{font-weight:700;font-size:13px;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}
.fi-meta{font-size:11px;color:var(--fgm);display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.fi-acts{display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap;align-items:center}
.sbtn{padding:5px 11px;font-size:11px;border:none;border-radius:4px;cursor:pointer;font-weight:600;transition:opacity .15s;white-space:nowrap}
.sbtn:hover{opacity:.85}
.sbtn-p{background:var(--ac);color:#fff}
.sbtn-g{background:#28a745;color:#fff}
.sbtn-o{background:#6f42c1;color:#fff}
.sbtn-d{background:var(--rd);color:#fff}
.badge{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600;color:#fff;background:var(--bg3);border:1px solid var(--bd);color:var(--fgm)}
.badge-lang{background:var(--ac);color:#fff;border:none}
.badge-cur{background:transparent!important;color:var(--ac)!important;border:1px solid var(--ac)!important}
.empty{color:var(--fgm);text-align:center;padding:30px;font-size:13px;line-height:1.6}`);

  // 閳光偓閳光偓 Layout setup 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  const orig = document.getElementById('main-container');
  if (!orig) return;
  const layout  = document.createElement('div'); layout.id = 'nzoi-layout';
  const sidebar = document.createElement('div'); sidebar.id = 'nzoi-sidebar';
  const resizer = document.createElement('div'); resizer.id = 'nzoi-resizer';
  orig.parentNode.insertBefore(layout, orig);
  layout.appendChild(orig); layout.appendChild(resizer); layout.appendChild(sidebar);
  const fitLayoutToViewport = () => {
    const top = Math.max(0, layout.getBoundingClientRect().top);
    const h = Math.max(360, window.innerHeight - top - 8);
    layout.style.setProperty('--nzoi-layout-top', `${top}px`);
    layout.style.height = `${h}px`;
    layout.style.maxHeight = `${h}px`;
  };
  requestAnimationFrame(fitLayoutToViewport);
  window.addEventListener('resize', fitLayoutToViewport, { passive: true });

  const titleBox = document.getElementById('main-page-title-box');
  if (titleBox) { orig.insertBefore(titleBox, orig.firstChild); }
  fixStatementImagePlaceholders(orig);
  scheduleStatementPdfEmbeds(orig);
  const statementObserver = new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(n => {
        if (n.nodeType === Node.ELEMENT_NODE) {
          fixStatementImagePlaceholders(n);
          scheduleStatementPdfEmbeds(n);
        } else if (n.nodeType === Node.TEXT_NODE) {
          fixStatementImagePlaceholders(n.parentElement || orig);
          scheduleStatementPdfEmbeds(n.parentElement || orig);
        }
      });
    });
  });
  statementObserver.observe(orig, { childList: true, subtree: true });

  const langOpts = Object.entries(LANGUAGES).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
  sidebar.innerHTML = `<div class="sc">
    <div class="ec">
      <span id="save-st"></span>
      <select id="lang-sel" class="nbtn">${langOpts}</select>
      <button class="nbtn" id="run-btn">Run</button>
      <button class="nbtn" id="submit-btn">Submit</button>
      <button class="nbtn" id="save-btn">Save</button>
      <button class="nbtn" id="files-btn">Files</button>
      <button class="icbtn" id="theme-toggle-btn" title="Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} theme">${themeIconSVG(currentTheme)}</button>
    </div>
    <div id="editor-wrap">
      <iframe id="clangd-iframe" allow="cross-origin-isolated" style="width:100%;height:100%;border:none;display:none"></iframe>
      <div id="monaco-wrap" style="width:100%;height:100%;display:none"></div>
      <div class="ed-loading" id="ed-loading">
        <span>Loading editor...</span>
        <small id="ed-loading-sub"></small>
      </div>
    </div>
    <div id="vresizer"></div>
    <div id="test-wrap"><div id="test-results">
      <div style="color:var(--fgm);text-align:center;padding:16px;font-size:12px">Run to see test results.</div>
    </div></div>
  </div>`;

  const iframe     = document.getElementById('clangd-iframe');
  const monacoWrap = document.getElementById('monaco-wrap');
  const edLoading  = document.getElementById('ed-loading');
  const edSub      = document.getElementById('ed-loading-sub');

  function showSt(msg, isErr) {
    // Bare checkmark for ambient autosave ticks (msg empty) 閳?matches the
    // faint, textless autosync indicator used by most editors/docs tools.
    // Checkmark + text for deliberate user actions (e.g. "Loaded X from Gist")
    // where the extra context is actually useful, not just noise.
    const el = document.getElementById('save-st');
    if (!el) return;
    if (isErr) {
      el.innerHTML = `<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="7" cy="7" r="6"/><line x1="4.5" y1="4.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="4.5" x2="4.5" y2="9.5"/></svg> ${esc(msg)}`;
      el.style.color = 'var(--rd)';
    } else {
      const checkmark = `<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1.5 7.5 5.5 11.5 12.5 3"/></svg>`;
      el.innerHTML = msg ? `${checkmark} ${esc(msg)}` : checkmark;
      el.style.color = 'var(--gn)';
    }
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, isErr ? 5000 : 2200);
  }

  // 閳光偓閳光偓 Clangd 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  const clangdUrl = () => `${IFRAME_ORIGIN}/?embed=true&theme=${currentTheme === 'light' ? 'light' : 'dark'}`;
  function isClangdFrameTargeted() {
    try { return new URL(iframe.src, location.href).origin === IFRAME_ORIGIN; }
    catch { return false; }
  }

  function postToClangd(message) {
    if (!iframe.contentWindow || !isClangdFrameTargeted()) return false;
    try {
      iframe.contentWindow.postMessage(message, IFRAME_ORIGIN);
      return true;
    } catch (err) {
      if (!/target origin|recipient window/i.test(String(err?.message || err))) {
        console.warn('[NZOI Enhanced] clangd postMessage failed:', err?.message || err);
      }
      return false;
    }
  }

  function sendToClangd(val) {
    return postToClangd({ cdib:'1.0.0', type:'setCode', value:val, id:'nzoi-init' });
  }

  function loadClangdFrame() {
    _codeInEditor = false;
    clearTimeout(_clangdRetry);
    iframe.onload = () => {
      postToClangd({ cdib:'1.0.0', type:'setTheme', theme:currentTheme });
      startClangdRetry();
    };
    iframe.src = clangdUrl();
  }

  function syncClangdTheme(reloadFallback = false) {
    if (!LANGUAGES[currentLang]?.clangd) return;
    const sent = postToClangd({ cdib:'1.0.0', type:'setTheme', theme:currentTheme });
    if (reloadFallback && iframe.src && iframe.src !== 'about:blank') loadClangdFrame();
    return sent;
  }

  function startClangdRetry() {
    _codeInEditor = false; clearTimeout(_clangdRetry); let att = 0;
    const try_ = () => {
      if (_codeInEditor || att++ > 15) return;
      _clangdRetry = setTimeout(try_, sendToClangd(code) ? 2500 : 500);
    };
    setTimeout(try_, 2000);
  }

  // 閳光偓閳光偓 Python linting 閳?inline Web Worker (Pyodide + pyflakes) 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  // Python linting uses bundled Pyodide + pyflakes. All executable runtime
  // files ship inside the extension package for MV3/CWS compliance.
  let _pyWorker = null, _pyReady = false, _pyQueue = null;
  let _pyCallbacks = {}, _pyIdCtr = 0, _pyLintDebounce = null;
  let _semCallbacks = {}, _semQueue = [], _semIdCtr = 0;

  function ensurePyWorker() {
    if (_pyWorker) return;
    const pyodideIndex = chrome.runtime.getURL('libs/pyodide/');
    const pyodideJs = chrome.runtime.getURL('libs/pyodide/pyodide.js');
    const pyodideStdlibB64 = chrome.runtime.getURL('libs/pyodide/python_stdlib.zip.b64');
    const pyflakesWheelB64 = chrome.runtime.getURL('libs/pyodide/pyflakes-3.4.0-py2.py3-none-any.whl.b64');
    const src = `
const PYODIDE_INDEX = ${JSON.stringify(pyodideIndex)};
const PYODIDE_JS = ${JSON.stringify(pyodideJs)};
const PYODIDE_STDLIB_B64 = ${JSON.stringify(pyodideStdlibB64)};
const PYFLAKES_WHEEL_B64 = ${JSON.stringify(pyflakesWheelB64)};
let py = null;

function base64ToUint8Array(input) {
  const b64 = String(input || '').replace(/\\s+/g, '');
  if (!b64) return new Uint8Array();
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((b64.length / 4) * 3 - padding);
  const chunkChars = 32768;
  let offset = 0;
  for (let i = 0; i < b64.length; i += chunkChars) {
    const bin = atob(b64.slice(i, i + chunkChars));
    for (let j = 0; j < bin.length; j++) out[offset++] = bin.charCodeAt(j);
  }
  return out;
}

async function fetchBase64Bytes(url, label) {
  const resp = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!resp.ok) throw new Error('Failed to load bundled ' + label + ': HTTP ' + resp.status);
  const bytes = base64ToUint8Array(await resp.text());
  if (!bytes.byteLength) throw new Error('Bundled ' + label + ' is empty');
  return bytes;
}

function installPyflakesFromWheel(bytes) {
  const wheelPath = '/tmp/pyflakes-3.4.0-py2.py3-none-any.whl';
  py.FS.writeFile(wheelPath, bytes);
  py.runPython([
    'import sysconfig, zipfile',
    '_wheel = "/tmp/pyflakes-3.4.0-py2.py3-none-any.whl"',
    '_site = sysconfig.get_paths()["purelib"]',
    'with zipfile.ZipFile(_wheel) as _z:',
    '    _z.extractall(_site)'
  ].join('\\n'));
  try { py.FS.unlink(wheelPath); } catch (_) {}
}

async function init() {
  try {
    importScripts(PYODIDE_JS);
    if (typeof loadPyodide === 'undefined') throw new Error('loadPyodide not defined after local import');

    const stdlibBytes = await fetchBase64Bytes(PYODIDE_STDLIB_B64, 'python_stdlib.zip');
    const stdlibUrl = URL.createObjectURL(new Blob([stdlibBytes], { type: 'application/zip' }));
    try {
      py = await loadPyodide({ indexURL: PYODIDE_INDEX, stdLibURL: stdlibUrl });
    } finally {
      URL.revokeObjectURL(stdlibUrl);
    }
    installPyflakesFromWheel(await fetchBase64Bytes(PYFLAKES_WHEEL_B64, 'pyflakes wheel'));
    postMessage({ type: 'ready' });
  } catch(err) {
    postMessage({ type: 'init-error', message: err.message });
  }
}

onmessage = function(e) {
  const d = e.data;
  if (d.type === 'lint') {
    if (!py) { postMessage({ type:'result', id:d.id, markers:[] }); return; }
    try {
      const script = [
        'import pyflakes.checker, ast, json',
        '_c = ' + JSON.stringify(d.code),
        '_ms = []',
        'try:',
        '    _t = ast.parse(_c)',
        '    _ch = pyflakes.checker.Checker(_t, filename="main.py")',
        '    for _w in _ch.messages:',
        '        _col = getattr(_w,"col",0) or 0',
        '        _ms.append({"startLineNumber":_w.lineno,"startColumn":_col+1,"endLineNumber":_w.lineno,"endColumn":999,"message":(_w.message % _w.message_args) if _w.message_args else str(_w.message),"severity":4})',
        'except SyntaxError as _e:',
        '    _ms.append({"startLineNumber":_e.lineno or 1,"startColumn":_e.offset or 1,"endLineNumber":_e.lineno or 1,"endColumn":999,"message":"SyntaxError: "+str(_e.msg),"severity":8})',
        'json.dumps(_ms)'
      ].join('\\n');
      postMessage({ type:'result', id:d.id, markers:JSON.parse(py.runPython(script)) });
    } catch(err) {
      postMessage({ type:'result', id:d.id, markers:[], error:err.message });
    }
    return;
  }
  if (d.type === 'semtokens') {
    // Real ast-based semantic analysis 閳?walks the actual parse tree and
    // classifies every Name/Attribute/Call/arg/decorator by role, feeding
    // Monaco's LSP-standard semanticTokens provider (see content.js).
    if (!py) { postMessage({ type:'semtokens-result', id:d.id, data:[] }); return; }
    try {
      const header = '_src = ' + JSON.stringify(d.code);
      const body = \`
import ast, json
_toks = []
_claimed = set()
def _emit(line, col, length, ttype, mods=None):
    key = (line, col)
    if key in _claimed or length <= 0:
        return
    _claimed.add(key)
    _toks.append([line - 1, col, length, ttype, mods or []])
try:
    _BUILTINS = set(dir(__builtins__))
except Exception:
    _BUILTINS = set()
class _V(ast.NodeVisitor):
    def _decorators(self, node):
        for dec in node.decorator_list:
            d2 = dec.func if isinstance(dec, ast.Call) else dec
            if isinstance(d2, ast.Name):
                _emit(d2.lineno, d2.col_offset, len(d2.id), "decorator")
            elif isinstance(d2, ast.Attribute):
                _emit(d2.end_lineno, d2.end_col_offset - len(d2.attr), len(d2.attr), "decorator")
    def _annotation(self, node):
        if isinstance(node, ast.Name):
            _emit(node.lineno, node.col_offset, len(node.id), "class" if node.id[:1].isupper() else "type")
        elif isinstance(node, ast.Attribute):
            _emit(node.end_lineno, node.end_col_offset - len(node.attr), len(node.attr), "class")
        elif isinstance(node, ast.Subscript):
            self._annotation(node.value)
            self._annotation(node.slice)
        elif isinstance(node, ast.Tuple):
            for elt in node.elts:
                self._annotation(elt)
    def visit_Import(self, node):
        for alias in node.names:
            name = alias.asname or alias.name.split(".")[0]
            col = node.col_offset + 7 + node.names.index(alias) * 2
            pos = _src.find(name, sum(len(line) + 1 for line in _src.splitlines()[:node.lineno - 1]) + col)
            if pos >= 0:
                line_start = _src.rfind("\\n", 0, pos) + 1
                _emit(node.lineno, pos - line_start, len(name), "namespace", ["declaration"] if alias.asname else [])
    def visit_ImportFrom(self, node):
        if node.module:
            base = _src.splitlines()[node.lineno - 1].find(node.module)
            if base >= 0:
                _emit(node.lineno, base, len(node.module.split(".")[0]), "namespace")
        for alias in node.names:
            name = alias.asname or alias.name
            line_text = _src.splitlines()[node.lineno - 1]
            base = line_text.find(name)
            if base >= 0:
                _emit(node.lineno, base, len(name), "class" if name[:1].isupper() else "variable", ["declaration"] if alias.asname else [])
    def visit_FunctionDef(self, node, _async=False):
        pos = node.col_offset + (10 if _async else 4)
        mods = ["declaration"] + (["async"] if _async else [])
        _emit(node.lineno, pos, len(node.name), "function", mods)
        self._decorators(node)
        a = node.args
        allargs = list(getattr(a, "posonlyargs", []) or []) + list(a.args) + list(a.kwonlyargs)
        if a.vararg:
            allargs.append(a.vararg)
        if a.kwarg:
            allargs.append(a.kwarg)
        for arg in allargs:
            _emit(arg.lineno, arg.col_offset, len(arg.arg), "parameter", ["declaration"])
            if arg.annotation:
                self._annotation(arg.annotation)
        if node.returns:
            self._annotation(node.returns)
        self.generic_visit(node)
    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node, _async=True)
    def visit_ClassDef(self, node):
        _emit(node.lineno, node.col_offset + 6, len(node.name), "class", ["declaration"])
        self._decorators(node)
        for base in node.bases:
            if isinstance(base, ast.Name):
                _emit(base.lineno, base.col_offset, len(base.id), "class")
            elif isinstance(base, ast.Attribute):
                _emit(base.end_lineno, base.end_col_offset - len(base.attr), len(base.attr), "class")
            elif isinstance(base, ast.Subscript):
                self._annotation(base)
        self.generic_visit(node)
    def visit_AnnAssign(self, node):
        self._annotation(node.annotation)
        self.generic_visit(node)
    def visit_Attribute(self, node):
        _emit(node.end_lineno, node.end_col_offset - len(node.attr), len(node.attr), "property")
        self.generic_visit(node)
    def visit_Call(self, node):
        f = node.func
        if isinstance(f, ast.Name):
            if f.id[:1].isupper():
                _emit(f.lineno, f.col_offset, len(f.id), "class")
            else:
                mods = ["defaultLibrary"] if f.id in _BUILTINS else []
                _emit(f.lineno, f.col_offset, len(f.id), "function", mods)
        elif isinstance(f, ast.Attribute):
            _emit(f.end_lineno, f.end_col_offset - len(f.attr), len(f.attr), "method")
        self.generic_visit(node)
    def visit_Name(self, node):
        if node.id in ("self", "cls"):
            _emit(node.lineno, node.col_offset, len(node.id), "variable")
        elif isinstance(node.ctx, ast.Load) and node.id[:1].isupper():
            # PEP8 convention: capitalized + referenced (not assigned) means a
            # class/type used as a value, base, or namespace qualifier, e.g.
            # Foo(), Solver.helper(...), isinstance(x, Bar).
            _emit(node.lineno, node.col_offset, len(node.id), "class")
        elif isinstance(node.ctx, ast.Load) and node.id in _BUILTINS:
            _emit(node.lineno, node.col_offset, len(node.id), "variable", ["defaultLibrary"])
        else:
            mods = ["declaration"] if isinstance(node.ctx, ast.Store) else []
            _emit(node.lineno, node.col_offset, len(node.id), "variable", mods)
try:
    _V().visit(ast.parse(_src))
except Exception:
    pass
json.dumps(_toks)
\`;
      postMessage({ type:'semtokens-result', id:d.id, data: JSON.parse(py.runPython(header + body)) });
    } catch(err) {
      postMessage({ type:'semtokens-result', id:d.id, data:[], error: err.message });
    }
    return;
  }
  postMessage({ type:'result', id:d.id, markers:[] });
};
init();`;
    const blob = new Blob([src], { type:'application/javascript' });
    _pyWorker = new Worker(URL.createObjectURL(blob));
    _pyWorker.onmessage = e => {
      const d = e.data;
      if (d.type === 'ready') {
        _pyReady = true;
        if (_pyQueue) { runPyLint(_pyQueue); _pyQueue = null; }
        // Flush any semantic-token requests that arrived before the worker was ready
        if (_semQueue.length) { _semQueue.forEach(req => _pyWorker.postMessage(req)); _semQueue = []; }
        if (_editorCreated && currentLang === 'python') refreshSemanticColors(code, true);
      }
      if (d.type === 'init-error') { console.warn('[NZOI Enhanced] PyWorker init failed:', d.message); _pyWorker = null; }
      if (d.type === 'result' && _pyCallbacks[d.id]) { _pyCallbacks[d.id](d.markers || []); delete _pyCallbacks[d.id]; }
      if (d.type === 'semtokens-result' && _semCallbacks[d.id]) { _semCallbacks[d.id](d.data || []); delete _semCallbacks[d.id]; }
    };
    _pyWorker.onerror = err => { console.warn('[NZOI Enhanced] PyWorker error:', err.message); _pyWorker = null; };
  }

  function runPyLint(src) {
    if (!_pyWorker || !_pyReady) { _pyQueue = src; ensurePyWorker(); return; }
    const id = 'py-' + (++_pyIdCtr);
    _pyCallbacks[id] = markers => {
      if (!_editorCreated || currentLang !== 'python') return;
      edCmd('setMarkers', { source: 'pyflakes', markers });
    };
    _pyWorker.postMessage({ type:'lint', id, code:src });
  }
  function schedulePyLint(src) { clearTimeout(_pyLintDebounce); _pyLintDebounce = setTimeout(() => runPyLint(src), 1000); }

  // Real ast-based semantic tokens for Python (genuine AST, see worker source
  // above). If the worker isn't ready yet, the request is queued and flushed on
  // 'ready' 閳?Monaco re-requests on the next edit regardless, so a one-time
  // delay on first load is the worst case.
  function requestPySemanticTokens(src, cb) {
    const id = 'sem-' + (++_semIdCtr);
    _semCallbacks[id] = cb;
    const msg = { type:'semtokens', id, code:src };
    if (_pyWorker && _pyReady) _pyWorker.postMessage(msg);
    else { _semQueue.push(msg); ensurePyWorker(); }
  }

  let _semDecorDebounce = null, _semDecorGeneration = 0;
  function applySemanticDecorations(lang, src, raw) {
    if (!_editorCreated || currentLang !== lang || code !== src) return;
    edCmd('setSemanticDecorations', { tokens: raw || [] });
    edCmd('refreshSemanticTokens');
  }

  function refreshSemanticColors(src = code, immediate = false) {
    clearTimeout(_semDecorDebounce);
    const run = () => {
      if (!_editorCreated || !['python', 'java'].includes(currentLang)) {
        edCmd('clearSemanticDecorations');
        return;
      }
      const lang = currentLang;
      const snapshot = src;
      const generation = ++_semDecorGeneration;
      if (lang === 'java') {
        applySemanticDecorations(lang, snapshot, computeJavaSemanticTokens(snapshot));
        return;
      }
      requestPySemanticTokens(snapshot, raw => {
        if (generation === _semDecorGeneration) applySemanticDecorations(lang, snapshot, raw);
      });
    };
    if (immediate) run();
    else _semDecorDebounce = setTimeout(run, 180);
  }

  // 閳光偓閳光偓 Java linting 閳?CheerpJ WASM JVM + real OpenJDK javac 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  function javaMarker(line, column, message, severity = 8) {
    return {
      startLineNumber: Math.max(1, line),
      startColumn: Math.max(1, column),
      endLineNumber: Math.max(1, line),
      endColumn: Math.max(2, column + 1),
      message,
      severity,
    };
  }

  function computeJavaLintMarkers(src) {
    const markers = [];
    const lines = String(src || '').split(/\r\n|\r|\n/);
    const clean = lines.map(() => '');
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    let blockComment = null;
    let mode = null;
    let literalStart = null;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      let i = 0;
      while (i < line.length) {
        const ch = line[i];
        const next = line[i + 1];

        if (blockComment) {
          clean[li] += ' ';
          if (ch === '*' && next === '/') {
            clean[li] += ' ';
            blockComment = null;
            i += 2;
          } else {
            i++;
          }
          continue;
        }

        if (mode === 'text') {
          clean[li] += ' ';
          if (ch === '"' && next === '"' && line[i + 2] === '"') {
            clean[li] += '  ';
            mode = null;
            literalStart = null;
            i += 3;
          } else {
            i++;
          }
          continue;
        }

        if (mode === 'string' || mode === 'char') {
          clean[li] += ' ';
          if (ch === '\\') {
            clean[li] += ' ';
            i += 2;
            continue;
          }
          if ((mode === 'string' && ch === '"') || (mode === 'char' && ch === "'")) {
            mode = null;
            literalStart = null;
          }
          i++;
          continue;
        }

        if (ch === '/' && next === '/') break;
        if (ch === '/' && next === '*') {
          blockComment = { line: li + 1, column: i + 1 };
          clean[li] += '  ';
          i += 2;
          continue;
        }
        if (ch === '"' && next === '"' && line[i + 2] === '"') {
          mode = 'text';
          literalStart = { line: li + 1, column: i + 1 };
          clean[li] += '   ';
          i += 3;
          continue;
        }
        if (ch === '"' || ch === "'") {
          mode = ch === '"' ? 'string' : 'char';
          literalStart = { line: li + 1, column: i + 1 };
          clean[li] += ch === '"' ? '""' : "''";
          i++;
          continue;
        }

        if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line: li + 1, column: i + 1 });
        if (ch === ')' || ch === ']' || ch === '}') {
          const open = stack.pop();
          if (!open || open.ch !== pairs[ch]) markers.push(javaMarker(li + 1, i + 1, `Unexpected '${ch}'`));
        }

        clean[li] += ch;
        i++;
      }

      if (mode === 'string' || mode === 'char') {
        markers.push(javaMarker(literalStart.line, literalStart.column, `Unterminated ${mode} literal`));
        mode = null;
        literalStart = null;
      }
    }

    if (blockComment) markers.push(javaMarker(blockComment.line, blockComment.column, 'Unterminated block comment'));
    if (mode === 'text' && literalStart) markers.push(javaMarker(literalStart.line, literalStart.column, 'Unterminated text block'));
    stack.reverse().forEach(open => markers.push(javaMarker(open.line, open.column, `Unclosed '${open.ch}'`)));

    const cleanSrc = clean.join('\n');
    const publicClass = /\bpublic\s+class\s+([A-Za-z_$][\w$]*)/.exec(cleanSrc);
    if (publicClass && publicClass[1] !== 'Main') {
      const before = cleanSrc.slice(0, publicClass.index);
      const line = before.split('\n').length;
      const column = clean[line - 1].indexOf(publicClass[1]) + 1;
      markers.push(javaMarker(line, column, `Public class '${publicClass[1]}' must be named 'Main' on this judge`));
    }

    const controlRe = /^(?:if|for|while|switch|catch|try|else|do|finally|case|default)\b/;
    const typeDeclRe = /^(?:(?:public|private|protected|static|final|abstract|strictfp)\s+)*(?:class|interface|enum|record)\b/;
    const methodDeclRe = /^(?:(?:public|private|protected|static|final|abstract|synchronized|native|strictfp)\s+)*(?:<[^>]+>\s*)?[\w.$<>\[\], ?]+\s+[A-Za-z_$][\w$]*\s*\([^;{}]*\)\s*(?:throws\s+[\w.$,\s]+)?$/;
    const constructorDeclRe = /^(?:(?:public|private|protected)\s+)?[A-Z_$][\w$]*\s*\([^;{}]*\)\s*(?:throws\s+[\w.$,\s]+)?$/;
    const statementStartRe = /^(?:return|throw|break|continue|import|package|assert)\b/;
    const declarationRe = /^(?:(?:final|volatile|transient)\s+)*(?:(?:boolean|byte|short|int|long|float|double|char|String|var|[A-Z_$][\w$]*(?:<[^;{}()]+>)?)(?:\[\])*)\s+[A-Za-z_$][\w$]*(?:\s*[=,].*)?$/;
    const assignmentRe = /(?:^|[^=!<>])=(?!=)/;

    clean.forEach((line, idx) => {
      const s = line.trim();
      if (!s || s.startsWith('@') || s.startsWith('*')) return;
      if (/[;{}:]$/.test(s)) return;
      if (/[,+\-*/%&|^!?=<>.]$/.test(s)) return;
      if (controlRe.test(s) || typeDeclRe.test(s) || methodDeclRe.test(s) || constructorDeclRe.test(s)) return;
      if (statementStartRe.test(s) || declarationRe.test(s) || assignmentRe.test(s) || /\)\s*$/.test(s) || /\+\+$|--$/.test(s)) {
        markers.push(javaMarker(idx + 1, Math.max(1, lines[idx].length), "Missing ';'"));
      }
    });

    return markers.slice(0, 100);
  }

  let _javaLintFrame = null, _javaLintReady = false, _javaLintQueue = null;
  let _javaLintCallbacks = {}, _javaLintTimeouts = {}, _javaLintId = 0, _javaLintDebounce = null;
  let _javaLintBootTimer = null;
  function ensureJavaLintFrame() {
    if (_javaLintFrame) return;
    _javaLintFrame = document.createElement('iframe');
    _javaLintFrame.src = chrome.runtime.getURL('libs/java-lint.html');
    _javaLintFrame.title = 'NZOI Enhanced Java Lint';
    _javaLintFrame.setAttribute('aria-hidden', 'true');
    _javaLintFrame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;z-index:-1';
    _javaLintFrame.onload = () => {
      _javaLintFrame.contentWindow?.postMessage({ nzoiJavaLintCmd: true, cmd: 'init' }, '*');
    };
    _javaLintFrame.onerror = () => {
      const message = 'Java linter iframe failed to load';
      console.warn('[NZOI Enhanced] Java lint JVM:', message);
      if (_editorCreated && currentLang === 'java') {
        edCmd('setMarkers', { source: 'javac', markers: javaLintFailureMarker(message) });
      }
    };
    document.documentElement.appendChild(_javaLintFrame);
  }
  function startJavaLintBootWatch() {
    clearTimeout(_javaLintBootTimer);
    _javaLintBootTimer = setTimeout(() => {
      if (!_javaLintReady && _editorCreated && currentLang === 'java') {
        console.warn('[NZOI Enhanced] Java lint JVM is still booting; javac markers will appear when CheerpJ is ready.');
      }
    }, 20000);
  }

  function javaLintFailureMarker(message) {
    return [{
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 999,
      message: 'Java linter failed: ' + String(message || 'unknown javac error').split('\n')[0],
      severity: 8,
    }];
  }

  function resolveJavaLint(id, markers, err, meta = {}) {
    const cb = _javaLintCallbacks[id];
    if (!cb) return;
    clearTimeout(_javaLintTimeouts[id]);
    delete _javaLintTimeouts[id];
    delete _javaLintCallbacks[id];
    cb(markers || [], err, meta);
  }

  window.addEventListener('message', e => {
    const d = e.data;
    if (!d?.nzoiJavaLint) return;
    if (d.type === 'status' || d.type === 'debug' || d.type === 'log') {
      console.log('[NZOI Enhanced] Java lint:', d.message || d.detail || '');
    }
    if (d.type === 'ready') {
      clearTimeout(_javaLintBootTimer);
      _javaLintReady = true;
      if (_editorCreated && currentLang === 'java') refreshSemanticColors(code, true);
      if (_javaLintQueue) { runJavaLint(_javaLintQueue); _javaLintQueue = null; }
    }
    if (d.type === 'error') {
      clearTimeout(_javaLintBootTimer);
      console.warn('[NZOI Enhanced] Java lint JVM:', d.message);
      if (d.id) {
        resolveJavaLint(d.id, javaLintFailureMarker(d.message), d.message, d);
        return;
      }
      if (_editorCreated && currentLang === 'java') {
        edCmd('setMarkers', {
          source: 'javac',
          markers: javaLintFailureMarker(d.message || 'unknown CheerpJ error'),
        });
      }
    }
    if (d.type === 'result' && _javaLintCallbacks[d.id]) {
      resolveJavaLint(d.id, d.markers || [], d.error, d);
    }
  });

  function runJavaLint(src) {
    const snapshot = String(src || '');
    const markers = computeJavaLintMarkers(snapshot);
    if (_editorCreated && currentLang === 'java' && code === snapshot) {
      edCmd('setMarkers', { source: 'javac', markers });
    }
    if (_editorCreated && currentLang === 'java') refreshSemanticColors(src, true);
  }

  function scheduleJavaLint(src) {
    clearTimeout(_javaLintDebounce);
    _javaLintDebounce = setTimeout(() => runJavaLint(src), 800);
  }

  function warmJavaLint() {
    if (_editorCreated && currentLang === 'java') refreshSemanticColors(code, true);
  }

  // 閳光偓閳光偓 Memory management 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  // Each language backend (clangd/WASM-clang, Pyodide/WASM-Python, CheerpJ/WASM-JVM)
  // is independently heavy (hundreds of MB each). Historically all three could end
  // up resident simultaneously if a user tried every language tab in one session,
  // which is the root cause of multi-GB memory growth on the problem page.
  //
  // Fix: whenever the active language changes, tear down the OTHER two backends so
  // at most one heavy runtime is ever resident. The tradeoff is a one-time re-init
  // cost if the user switches back 閳?acceptable given the memory payoff, and each
  // backend already has its own loading state / retry logic to absorb this.

  function teardownClangd() {
    if (!iframe.src || iframe.src === 'about:blank') return;
    clearTimeout(_clangdRetry);
    iframe.src = 'about:blank';
    iframe.onload = null;
    _codeInEditor = false;
  }

  function teardownPyWorker() {
    clearTimeout(_pyLintDebounce);
    if (_pyWorker) { _pyWorker.terminate(); _pyWorker = null; }
    _pyReady = false; _pyQueue = null; _pyCallbacks = {};
    _semCallbacks = {}; _semQueue = [];
  }

  function teardownJavaLint() {
    clearTimeout(_javaLintDebounce);
    clearTimeout(_javaLintBootTimer);
    Object.values(_javaLintTimeouts).forEach(clearTimeout);
    if (_javaLintFrame) { _javaLintFrame.remove(); _javaLintFrame = null; }
    _javaLintReady = false; _javaLintQueue = null; _javaLintCallbacks = {}; _javaLintTimeouts = {};
  }

  // Tear down every heavy backend (used on tab-hide / page-unload as a safety net).
  function teardownAllBackends() {
    teardownClangd(); teardownPyWorker(); teardownJavaLint();
  }

  // Keep only the backend for `lang` warm, freeing the other two.
  function teardownInactiveBackends(lang) {
    if (lang !== 'cpp')    teardownClangd();
    if (lang !== 'python') teardownPyWorker();
    if (lang !== 'java')   teardownJavaLint();
  }

  // 閳光偓閳光偓 postMessage bridge to MAIN-world Monaco editor 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  // Content scripts (isolated world) cannot read JS variables set in MAIN world.
  // Instead the MAIN world injection owns the Monaco editor and we talk to it
  // via window.postMessage. All messages are tagged with _nzoi:'cmd' or _nzoi:'evt'.

  function edCmd(cmd, extra) {
    window.postMessage({ _nzoi: 'cmd', cmd, ...extra }, '*');
  }

  // Promise that resolves once the MAIN world signals 'monaco-loaded'
  // (i.e. window.monaco is ready and the message listener is active).
  let _monacoLoadedResolve = null;
  let _monacoLoadedPromise = new Promise(r => { _monacoLoadedResolve = r; });

  // Promise that resolves once the editor responds 'ready' after 'create'.
  let _editorReadyResolve = null;
  let _editorReadyPromise = null;

  // Listen for all _nzoi events from MAIN world
  window.addEventListener('message', e => {
    if (!e.data || e.data._nzoi !== 'evt') return;
    const d = e.data;

    if (d.evt === 'monaco-loaded') {
      _monacoInjected = true;
      _monacoLoadedResolve();
    }
    if (d.evt === 'ready') {
      _editorCreated = true;
      edLoading.style.display = 'none';
      monacoWrap.style.display = 'block';
      if (_editorReadyResolve) { _editorReadyResolve(); _editorReadyResolve = null; }
      refreshSemanticColors(code, true);
    }
    if (d.evt === 'error') {
      edLoading.innerHTML = '<div class="ed-err">Editor failed to load.<br><small>' + esc(d.message || 'Unknown error') + '</small></div>';
    }
    if (d.evt === 'change') {
      if (d.value === code) return;
      code = d.value;
      autoSave(pid, currentLang, code, getPName(), () => showSt(''));
      if (currentLang === 'python') schedulePyLint(d.value);
      if (currentLang === 'java')   scheduleJavaLint(d.value);
      refreshSemanticColors(d.value);
    }
    if (d.evt === 'cmd.save') {
      manualSave(pid, currentLang, code, getPName())
        .then(() => showSt(''))
        .catch(async err => {
          const isTokenErr = err.message.toLowerCase().includes('token');
          await storageSet(`code_${pid}_${currentLang}`, code);
          showSt(isTokenErr ? 'No token - saved locally' : 'Gist failed - local', true);
        });
    }
    if (d.evt === 'cmd.run')    runTests();
    if (d.evt === 'cmd.submit') submitCode();
  });

  // 閳光偓閳光偓 Semantic tokens bridge 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  // MAIN-world Monaco semantic-token providers (registered in service-worker.js)
  // post a `_nzoiSem:'req'` request here whenever the model changes. We run the
  // real analysis (Python: ast in the Pyodide worker; Java: lexical classifier
  // above) and post back `_nzoiSem:'res'` with the LSP delta-encoded data.
  // Uses a distinct tag (not _nzoi:'cmd'/'evt') to avoid any ambiguity with the
  // editor command/event channel above.
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || d._nzoiSem !== 'req') return;
    if (d.lang === 'python') {
      requestPySemanticTokens(d.value, raw => {
        window.postMessage({ _nzoiSem:'res', id: d.id, data: encodeSemanticTokens(raw) }, '*');
      });
    } else if (d.lang === 'java') {
      const data = encodeSemanticTokens(computeJavaSemanticTokens(d.value));
      window.postMessage({ _nzoiSem:'res', id: d.id, data }, '*');
    } else {
      window.postMessage({ _nzoiSem:'res', id: d.id, data: [] }, '*');
    }
  });

  async function loadMonaco() {
    if (_editorCreated) return;

    iframe.style.display = 'none';
    monacoWrap.style.display = 'none';
    edLoading.style.display = 'flex';
    edSub.textContent = 'Fetching editor (~5MB, first load only)...';

    // Inject MAIN world script if not already done
    if (!_monacoInjected) {
      let tabId;
      try {
        tabId = await bg({ type: 'get:tabId' });
        if (!tabId) throw new Error('Cannot get tab ID - try reloading the extension');
      } catch(e) {
        edLoading.innerHTML = '<div class="ed-err">Editor failed to start.<br><small>' + esc(e.message) + '</small></div>';
        return;
      }

      edSub.textContent = 'Downloading Monaco (first time ~10s)...';
      bg({ type: 'inject:monaco', tabId }).catch(e => {
        edLoading.innerHTML = '<div class="ed-err">Editor injection failed.<br><small>' + esc(e.message) + '</small></div>';
      });

      // Wait for MAIN world to signal it's ready (with timeout)
      const loadTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Monaco load timed out (120s) - check console for [NZOI Enhanced MAIN] errors')), 120_000));
      try {
        await Promise.race([_monacoLoadedPromise, loadTimeout]);
      } catch(e) {
        edLoading.innerHTML = '<div class="ed-err">Editor failed to load.<br><small>' + esc(e.message) + '</small></div>';
        return;
      }
    }

    // Monaco is loaded in MAIN world 閳?now tell it to create the editor
    edSub.textContent = 'Creating editor...';
    _editorReadyPromise = new Promise(r => { _editorReadyResolve = r; });

    edCmd('create', {
      containerId: 'monaco-wrap',
      value:       code,
      language:    LANGUAGES[currentLang].monaco,
      theme:       currentTheme === 'light' ? 'vs' : 'vs-dark',
    });

    const createTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Editor create timed out - check console for errors')), 15_000));
    try {
      await Promise.race([_editorReadyPromise, createTimeout]);
    } catch(e) {
      edLoading.innerHTML = '<div class="ed-err">Editor failed to start.<br><small>' + esc(e.message) + '</small></div>';
    }
  }

  async function saveCurrentLang() {
    const token = await getToken();
    if (token) {
      try { await pushToGist(pid, currentLang, code, getPName()); return; }
      catch(e) { console.warn('[NZOI Enhanced] Gist save on lang switch failed:', e.message); }
    }
    await storageSet(`code_${pid}_${currentLang}`, code);
  }

  // 閳光偓閳光偓 Switch language 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  async function switchLang(lang) {
    await saveCurrentLang();
    currentLang = lang;
    const res = await loadCode(pid, lang);
    code = res.code || TEMPLATES[lang] || '';

    // Free the backends for languages we're leaving 閳?see "Memory management" above.
    teardownInactiveBackends(lang);

    if (LANGUAGES[lang].clangd) {
      monacoWrap.style.display = 'none';
      iframe.style.display = 'block';
      edLoading.style.display = 'none';
      if (!iframe.src || iframe.src === 'about:blank') {
        loadClangdFrame();
      } else {
        sendToClangd(code);
      }
    } else {
      iframe.style.display = 'none';
      // Clear old markers if switching between monaco languages
      if (_editorCreated) {
        edCmd('clearMarkers', { source: 'pyflakes' });
        edCmd('clearMarkers', { source: 'javac' });
        edCmd('setLanguage', { language: LANGUAGES[lang].monaco });
        edCmd('setValue',    { value: code });
        monacoWrap.style.display = 'block';
      } else {
        await loadMonaco();
      }
      refreshSemanticColors(code, true);
      if (lang === 'python') { ensurePyWorker(); schedulePyLint(code); }
      if (lang === 'java')   { warmJavaLint(); scheduleJavaLint(code); }
    }
  }
  // 閳光偓閳光偓 Bootstrap 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  (async () => {
    const settings = await new Promise(r => chrome.storage.local.get(['defaultLanguage'], r));
    if (settings.defaultLanguage && LANGUAGES[settings.defaultLanguage]) {
      currentLang = settings.defaultLanguage;
      document.getElementById('lang-sel').value = currentLang;
    }

    const res = await loadCode(pid, currentLang);
    if (res.code) { code = res.code; console.log('[NZOI Enhanced] Code from', res.src); }

    if (LANGUAGES[currentLang].clangd) {
      iframe.style.display = 'block';
      edLoading.style.display = 'none';
      loadClangdFrame();
    } else {
      await loadMonaco();
      if (currentLang === 'python') { ensurePyWorker(); schedulePyLint(code); }
      if (currentLang === 'java')   { warmJavaLint(); scheduleJavaLint(code); }
    }
  })();

  // 閳光偓閳光偓 clangd postMessage 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  window.addEventListener('message', e => {
    if (!e.origin.includes('clangd-in-browser-fork.pages.dev')) return;
    const d = e.data; if (!d?.cdib) return;
    if (d.type === 'reply:setCode' && d.id === 'nzoi-init') {
      _codeInEditor = true; clearTimeout(_clangdRetry);
      edLoading.style.display = 'none';
    }
    if (d.type === 'codeChange' && typeof d.code === 'string' && d.code !== code) {
      _codeInEditor = true; code = d.code;
      autoSave(pid, currentLang, code, getPName(), () => showSt(''));
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && LANGUAGES[currentLang]?.clangd && !_codeInEditor && iframe.src && iframe.src !== 'about:blank')
      setTimeout(() => { if (!_codeInEditor) sendToClangd(code); }, 800);
  });

  // Final safety net: free all heavy WASM backends if the tab is closed/navigated
  // away from. Full reloads already reclaim memory, but this also helps in
  // scenarios where the extension's content script context outlives the page
  // (e.g. some SPA-style navigations within the same origin).
  window.addEventListener('pagehide', teardownAllBackends);

  // 閳光偓閳光偓 Buttons 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  document.getElementById('lang-sel').addEventListener('change', e => switchLang(e.target.value));

  document.getElementById('save-btn').onclick = async () => {
    const b = document.getElementById('save-btn');
    b.textContent = 'Saving...'; b.disabled = true;
    try {
      await manualSave(pid, currentLang, code, getPName());
      showSt('');
    } catch(e) {
      const isTokenErr = e.message.toLowerCase().includes('token');
      if (isTokenErr) {
        await storageSet(`code_${pid}_${currentLang}`, code);
        showSt('No GitHub token - saved locally', true);
      } else {
        showSt('Gist failed - saved locally', true);
        await storageSet(`code_${pid}_${currentLang}`, code);
      }
      console.warn('[NZOI Enhanced] Save error:', e.message);
    }
    finally { b.textContent = 'Save'; b.disabled = false; }
  };

  document.getElementById('files-btn').onclick  = () => showFilesModal(pid, currentLang);
  document.getElementById('run-btn').onclick     = runTests;
  document.getElementById('submit-btn').onclick  = submitCode;

  document.getElementById('theme-toggle-btn').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    chrome.storage.local.set({ theme: currentTheme });
    const btn = document.getElementById('theme-toggle-btn');
    btn.innerHTML = themeIconSVG(currentTheme);
    btn.title = `Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} theme`;
    syncClangdTheme(true);
    if (_editorCreated) edCmd('setTheme', { theme: currentTheme === 'light' ? 'vs' : 'vs-dark' });
    refreshSemanticColors(code, true);
  };

  document.addEventListener('keydown', e => {
    // Ctrl+S for clangd mode (Monaco mode handles it via MAIN world addCommand)
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && LANGUAGES[currentLang]?.clangd) {
      e.preventDefault();
      manualSave(pid, currentLang, code, getPName())
        .then(() => showSt(''))
        .catch(async err => {
          const isTokenErr = err.message.toLowerCase().includes('token');
          await storageSet(`code_${pid}_${currentLang}`, code); // always fall back to local on any Gist failure
          showSt(isTokenErr ? 'No token - saved locally' : 'Gist failed - saved locally', true);
        });
    }
    if (e.altKey && e.key === 'r') { e.preventDefault(); runTests(); }
    if (e.altKey && e.key === 's') { e.preventDefault(); submitCode(); }
  });

  // 閳光偓閳光偓 Run tests 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  const samples = [];
  document.querySelectorAll('ul.samples li, .sample-test').forEach((item, i) => {
    const inp = item.querySelector('.input pre, pre.input');
    const out = item.querySelector('.output pre, pre.output');
    if (inp && out) samples.push({ id:i+1, input:inp.textContent, output:out.textContent });
  });

  let _running = false;
  async function runTests() {
    if (_running) return; _running = true;
    const c   = code;
    const r   = document.getElementById('test-results');
    const lid = LANGUAGES[currentLang]?.judgeId;
    r.innerHTML = '<div style="padding:10px;color:var(--ac);font-size:12px">Compiling & Running...</div>';
    if (!lid) { r.innerHTML = '<div style="color:var(--rd);padding:10px;font-size:12px">Language not supported.</div>'; _running = false; return; }
    if (!samples.length) { r.innerHTML = '<div style="color:var(--fgm);text-align:center;padding:20px;font-size:12px">No sample cases found on this page.</div>'; _running = false; return; }

    const results = [];
    for (const s of samples) {
      try {
        const res = await bg({ type:'run:code', source:c, languageId:lid, stdin:s.input.trim() });
        const out = (res.error || res.output || '').trim();
        results.push({ s, pass:!res.error && out === s.output.trim(), out, exp:s.output.trim(), error:res.error || null });
      } catch(e) { results.push({ s, error:e.message, out:'', exp:'', pass:false }); }
    }

    r.innerHTML = results.map(({ s, pass, out, exp, error }) => {
      if (error) return `<div class="tr"><div class="th2 fail"><span>Sample ${s.id}</span><span>ERROR</span></div><div style="padding:8px;background:var(--bg1)"><pre style="color:var(--rd);margin:0;font-size:11px">${esc(error)}</pre></div></div>`;
      return `<div class="tr">
        <div class="th2 ${pass?'pass':'fail'}"><span>Sample ${s.id}</span><span>${pass ? 'ACCEPTED' : 'WRONG ANSWER'}</span></div>
        ${!pass ? `<div class="td">
          <div class="tb"><strong>Your output</strong><pre>${esc(out)}</pre></div>
          <div class="tb"><strong>Expected</strong><pre>${esc(exp)}</pre></div>
        </div>` : ''}
      </div>`;
    }).join('');
    _running = false;
  }

  // 閳光偓閳光偓 Submit 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  function submitCode() {
    if (!code.trim()) { alert('Code is empty.'); return; }
    const lc = LANGUAGES[currentLang];
    if (!lc.submitId) { alert(`${lc.label} submissions are not supported.`); return; }
    const form = document.createElement('form');
    form.method = 'POST'; form.action = `/problems/${pid}/submit`; form.style.display = 'none';
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    [['utf8','check'],['authenticity_token',csrfToken],['submission[language_id]',lc.submitId],['submission[source]',code],['commit','Submit']]
      .forEach(([k,v]) => { const i = document.createElement('input'); i.type='hidden'; i.name=k; i.value=v||''; form.appendChild(i); });
    document.body.appendChild(form); form.submit();
  }

  // 閳光偓閳光偓 File manager modal 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  async function showFilesModal(pidVal, lang) {
    document.querySelector('.nzoi-modal')?.remove();
    const modal = document.createElement('div'); modal.className = 'nzoi-modal';
    modal.innerHTML = `<div class="modal-c">
      <div class="modal-h">
        <div><h2>Code Manager</h2><small id="fm-status">Loading...</small></div>
        <button class="mcl" title="Close">鑴?/button>
      </div>
      <div class="tabs">
        <button class="tab on" data-tab="local">Local Storage</button>
        <button class="tab" data-tab="gist">GitHub Gist</button>
      </div>
      <div class="modal-b" id="fm-body"><div class="empty">Loading...</div></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.mcl').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    const [storageAll, gistFilesRaw] = await Promise.all([
      new Promise(r => chrome.storage.local.get(null, r)),
      (async () => {
        try { const t = await getToken(); if (!t) return {}; return await bg({ type:'gist:files', token:t }); } catch { return {}; }
      })(),
    ]);

    const getProblemName = fpid => storageAll['nzname_' + fpid] || null;

    // Build local map: { pid: { lang: code } }
    const localMap = {};
    Object.keys(storageAll).filter(k => k.startsWith('code_')).forEach(k => {
      const parts = k.split('_'); // code_{pid}_{lang}
      if (parts.length < 3) return;
      const fpid = parts[1], llang = parts.slice(2).join('_');
      if (!localMap[fpid]) localMap[fpid] = {};
      localMap[fpid][llang] = storageAll[k];
    });

    // Build gist map: { pid: [fileObj, ...] }
    const gistMap = {};
    Object.values(gistFilesRaw).forEach(f => {
      const m = f.filename.match(/_(\d+)\.[a-z]+$/);
      if (!m) return;
      const fpid = m[1];
      if (!gistMap[fpid]) gistMap[fpid] = [];
      gistMap[fpid].push(f);
    });

    let activeTab = 'local';
    const body = document.getElementById('fm-body');
    const statusEl = document.getElementById('fm-status');
    statusEl.textContent = `${Object.keys(localMap).length} local - ${Object.keys(gistMap).length} in Gist`;

    function render() {
      const isLocal = activeTab === 'local';
      const map = isLocal ? localMap : gistMap;
      const pids = Object.keys(map).sort((a, b) => {
        if (a === String(pidVal)) return -1;
        if (b === String(pidVal)) return 1;
        return parseInt(b) - parseInt(a);
      });

      if (!pids.length) {
        body.innerHTML = `<div class="empty">${isLocal
          ? 'No locally saved files yet.<br>Files are saved automatically as you type.'
          : 'No Gist files found.<br>Click Save to sync your code to GitHub Gist.'}</div>`;
        return;
      }

      body.innerHTML = pids.map(fpid => {
        const isCur = fpid === String(pidVal);
        const name  = getProblemName(fpid) || ('Problem ' + fpid);

        let badges = '', acts = '';
        if (isLocal) {
          const langs = Object.keys(map[fpid]);
          badges = langs.map(l =>
            `<span class="badge badge-lang" style="${(isCur && l === lang) ? 'background:var(--gn)' : ''}">${LANGUAGES[l]?.label || l}</span>`
          ).join(' ');

          if (isCur) {
            // For the current problem: show each language with a Load button
            acts = langs.map(l =>
              l === lang
                ? `<span class="sbtn" style="background:var(--bg3);color:var(--fgm);cursor:default">Active (${LANGUAGES[l]?.label || l})</span>`
                : `<button class="sbtn sbtn-p" data-a="load-local" data-pid="${fpid}" data-lang="${l}">Load ${LANGUAGES[l]?.label || l}</button>`
            ).join('') + `<button class="sbtn sbtn-d" data-a="del" data-pid="${fpid}">Delete</button>`;
          } else {
            // For other problems: "Open in New Tab" only
            acts = `<button class="sbtn sbtn-o" data-a="open-tab" data-pid="${fpid}">Open in New Tab</button>
                    <button class="sbtn sbtn-d" data-a="del" data-pid="${fpid}">Delete</button>`;
          }
        } else {
          badges = map[fpid].map(f =>
            `<span class="badge badge-lang" style="background:#6f42c1">.${f.filename.split('.').pop()}</span>`
          ).join(' ');

          if (isCur) {
            acts = `<button class="sbtn sbtn-g" data-a="load-gist" data-pid="${fpid}">Load into Editor</button>
                    <button class="sbtn sbtn-d" data-a="del" data-pid="${fpid}">Delete</button>`;
          } else {
            acts = `<button class="sbtn sbtn-o" data-a="open-tab" data-pid="${fpid}">Open in New Tab</button>
                    <button class="sbtn sbtn-d" data-a="del" data-pid="${fpid}">Delete</button>`;
          }
        }

        return `<div class="fi">
          <div class="fi-info">
            <div class="fi-name">${esc(name)}${isCur ? ' <span class="badge badge-cur">current</span>' : ''}</div>
            <div class="fi-meta">${badges}</div>
          </div>
          <div class="fi-acts">${acts}</div>
        </div>`;
      }).join('');

      // Load local (only for current problem's other languages)
      body.querySelectorAll('[data-a="load-local"]').forEach(btn => {
        btn.onclick = async () => {
          const fpid = btn.dataset.pid, llang = btn.dataset.lang;
          const saved = localMap[fpid]?.[llang];
          if (saved == null) { alert('Content not found.'); return; }
          code = saved;
          await switchLang(llang);
          document.getElementById('lang-sel').value = llang;
          if (LANGUAGES[llang]?.clangd) sendToClangd(code);
          else edCmd('setValue', { value: code });
          showSt(`Loaded ${LANGUAGES[llang]?.label || llang} from local storage`);
          modal.remove();
        };
      });

      // Load gist (only for current problem)
      body.querySelectorAll('[data-a="load-gist"]').forEach(btn => {
        btn.onclick = async () => {
          const fpid = btn.dataset.pid;
          const ext  = LANGUAGES[lang]?.ext || 'cpp';
          let file = gistMap[fpid]?.find(f => f.filename.endsWith('.' + ext)) || gistMap[fpid]?.[0];
          if (!file) { alert('No Gist files for this problem.'); return; }
          btn.textContent = 'Loading...'; btn.disabled = true;
          const loaded = file.truncated ? await fetch(file.raw_url).then(r => r.text()) : file.content;
          code = loaded;
          if (LANGUAGES[currentLang].clangd) sendToClangd(code);
          else edCmd('setValue', { value: code });
          await storageRemove(`code_${fpid}_${lang}`);
          showSt('Loaded from Gist');
          modal.remove();
        };
      });

      // Open in new tab
      body.querySelectorAll('[data-a="open-tab"]').forEach(btn => {
        btn.onclick = () => {
          window.open(`https://train.nzoi.org.nz/problems/${btn.dataset.pid}`, '_blank');
        };
      });

      // Delete
      body.querySelectorAll('[data-a="del"]').forEach(btn => {
        btn.onclick = async () => {
          const fpid = btn.dataset.pid;
          const pname = getProblemName(fpid) || fpid;
          if (!confirm(`Delete all ${isLocal ? 'local' : 'Gist'} code for "${pname}"?`)) return;
          btn.textContent = '...'; btn.disabled = true;
          if (isLocal) {
            const keys = Object.keys(localMap[fpid]).map(l => `code_${fpid}_${l}`);
            await new Promise(r => chrome.storage.local.remove(keys, r));
            delete localMap[fpid];
          } else {
            const t = await getToken();
            for (const f of (gistMap[fpid] || [])) {
              try { await bg({ type:'gist:delete', token:t, filename:f.filename }); } catch {}
            }
            delete gistMap[fpid];
          }
          statusEl.textContent = `${Object.keys(localMap).length} local - ${Object.keys(gistMap).length} in Gist`;
          render();
        };
      });
    }

    modal.querySelectorAll('.tab').forEach(tab => {
      tab.onclick = () => {
        modal.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
        tab.classList.add('on'); activeTab = tab.dataset.tab; render();
      };
    });
    render();
  }

  // 閳光偓閳光偓 Resizers 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
  (function setupHResizer() {
    let sx, sw;
    resizer.onmousedown = e => {
      sx = e.clientX; sw = orig.getBoundingClientRect().width;
      resizer.classList.add('dragging');
      document.documentElement.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const move = e => {
        const w = Math.max(300, Math.min(sw + (e.clientX - sx), window.innerWidth - 350));
        orig.style.width = w + 'px'; sidebar.style.width = (window.innerWidth - w - 5) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        resizer.classList.remove('dragging');
        document.documentElement.style.cursor = ''; document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    };
  })();

  (function setupVResizer() {
    const vr = document.getElementById('vresizer');
    const ew = document.getElementById('editor-wrap');
    const tw = document.getElementById('test-wrap');
    let sy, sh;
    vr.onmousedown = e => {
      sy = e.clientY; sh = ew.getBoundingClientRect().height;
      document.documentElement.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      const maxH = sidebar.clientHeight - 120;
      const move = e => {
        const h = Math.max(100, Math.min(sh + (e.clientY - sy), maxH - 80));
        ew.style.flex = 'none'; ew.style.height = h + 'px';
        tw.style.flex = 'none'; tw.style.height = (sidebar.clientHeight - h - 60) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.documentElement.style.cursor = ''; document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    };
  })();
}

// 閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡?// GLOBAL DARK THEME (all non-problem pages)
// 閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡鎰ㄦ櫜閳烘劏鏅查埡?
async function applyGlobalDarkTheme() {
  const { theme: storedTheme } = await new Promise(r => chrome.storage.local.get('theme', d => r(d)));
  document.documentElement.setAttribute('data-theme', storedTheme === 'light' ? 'light' : 'dark');
  injectStyle('nzoi-global-dark', `
:root{
  --bg0:#0d1117;--bg1:#161b22;--bg2:#21262d;--bg3:#30363d;
  --fg:#e6edf3;--fgm:#8b949e;--ac:#58a6ff;
  --gn:#3fb950;--rd:#f85149;--yw:#d29922;
  --syn-kw:#569cd6;--syn-str:#ce9178;--syn-com:#6a9955;--syn-num:#b5cea8;--syn-fn:#dcdcaa;
  --info-bg:#0c2039;--info-fg:#93c5fd;--warn-bg:#1e1500;--warn-fg:#fde68a;
  --err-bg:#1e0a0a;--err-fg:#fca5a5;--ok-bg:#0a1e0d;--ok-fg:#86efac;
}
/* Light theme 閳?shares the 'theme' storage key with the problem-page IDE and
   the dashboard, so the whole site flips consistently regardless of which
   page wrote the preference. */
:root[data-theme="light"]{
  --bg0:#ffffff;--bg1:#f6f8fa;--bg2:#eaeef2;--bg3:#d0d7de;
  --fg:#1f2328;--fgm:#57606a;--ac:#0969da;
  --gn:#1a7f37;--rd:#cf222e;--yw:#9a6700;
  --syn-kw:#0451a5;--syn-str:#a31515;--syn-com:#008000;--syn-num:#098658;--syn-fn:#795e26;
  --info-bg:#ddf4ff;--info-fg:#0969da;--warn-bg:#fff8c5;--warn-fg:#9a6700;
  --err-bg:#ffebe9;--err-fg:#cf222e;--ok-bg:#dafbe1;--ok-fg:#1a7f37;
}
*{box-sizing:border-box}
html,body{background:var(--bg0)!important;color:var(--fg)!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important}
a{color:var(--fg)!important;text-decoration:none!important}
a:hover{color:var(--fg)!important;text-decoration:underline!important}

/* Navigation */
#main-menu,#side,#side-container,.navbar,.ui.menu,nav{background:var(--bg1)!important;border-color:var(--bg3)!important;color:var(--fg)!important}
#main-menu *,#side,#side *,.navbar *,.ui.menu .item,.ui.menu a,nav *{color:var(--fg)!important}
ul.nav-theme li,ul.nav-theme ul,#side-minify{background:var(--bg1)!important;border-color:var(--bg3)!important}
ul.nav-theme a{color:var(--fg)!important}
.ui.menu .active.item,.ui.menu .item:hover,.navbar a:hover,nav a:hover,ul.nav-theme li:hover,ul.nav-theme li.sfHover,ul.nav-theme a:hover,#side-minify:hover{background:var(--bg2)!important;color:var(--fg)!important}
.ui.menu .item.header,.site-name{color:var(--fg)!important;font-weight:700!important}

/* Page body */
.ui.container,.ui.segment{background:transparent!important;color:var(--fg)!important;border:none!important;box-shadow:none!important}
.ui.card,.ui.cards>.card{background:var(--bg1)!important;border:1px solid var(--bg3)!important;box-shadow:none!important}
.ui.card .content,.ui.card .description{color:var(--fg)!important}
.ui.card .meta{color:var(--fg)!important}

/* Headers */
h1,h2,h3,h4,h5,h6,.ui.header,.page-header{color:var(--fg)!important}

/* Tables */
table,thead,tbody,tfoot,tr,td,th{background:var(--bg1)!important;color:var(--fg)!important;border-color:var(--bg3)!important}
th{background:var(--bg2)!important;font-weight:600!important}
tr:hover td{background:var(--bg2)!important}
.ui.table{background:var(--bg1)!important;border:1px solid var(--bg3)!important}

/* Code */
pre,code,kbd,tt{background:var(--bg2)!important;color:var(--fg)!important;font-family:'JetBrains Mono','Fira Code',monospace!important}
pre{border:1px solid var(--bg3)!important;border-radius:6px!important;padding:12px!important}
code{border-radius:3px!important;padding:2px 5px!important;font-size:.88em!important}
.highlight{background:var(--bg2)!important;border:1px solid var(--bg3)!important;border-radius:6px!important;overflow:hidden!important}
.highlight pre{border:none!important;margin:0!important;background:transparent!important}
.highlight .k,.highlight .kn,.highlight .kd{color:var(--syn-kw)!important}
.highlight .s,.highlight .s1,.highlight .s2{color:var(--syn-str)!important}
.highlight .c,.highlight .c1,.highlight .cm{color:var(--syn-com)!important}
.highlight .mi,.highlight .mf,.highlight .mh{color:var(--syn-num)!important}
.highlight .nf,.highlight .nc{color:var(--syn-fn)!important}

/* Forms */
input[type=text],input[type=password],input[type=email],input[type=search],
select,textarea{
  background:var(--bg2)!important;color:var(--fg)!important;
  border:1px solid var(--bg3)!important;border-radius:6px!important;padding:8px 12px!important;
}
input:focus,select:focus,textarea:focus{border-color:var(--ac)!important;outline:none!important;box-shadow:0 0 0 2px rgba(88,166,255,.15)!important}

/* Buttons */
.ui.button{background:var(--bg2)!important;color:var(--fg)!important;border:1px solid var(--bg3)!important}
.ui.button:hover{background:var(--bg3)!important}
.ui.primary.button,.ui.blue.button{background:#1f6feb!important;color:#fff!important;border-color:transparent!important}
.ui.positive.button,.ui.green.button{background:#238636!important;color:#fff!important;border-color:transparent!important}
.ui.negative.button,.ui.red.button{background:#b91c1c!important;color:#fff!important;border-color:transparent!important}

/* Labels & badges */
.ui.label{background:var(--bg2)!important;color:var(--fg)!important;border-color:var(--bg3)!important}
.ui.green.label{background:#238636!important;color:#fff!important}
.ui.red.label{background:#b91c1c!important;color:#fff!important}
.ui.blue.label{background:#1f6feb!important;color:#fff!important}

/* Messages */
.ui.message{background:var(--bg2)!important;color:var(--fg)!important;border:1px solid var(--bg3)!important;box-shadow:none!important}
.ui.info.message{background:var(--info-bg)!important;border-color:var(--ac)!important;color:var(--info-fg)!important}
.ui.warning.message{background:var(--warn-bg)!important;border-color:var(--yw)!important;color:var(--warn-fg)!important}
.ui.error.message,.ui.negative.message{background:var(--err-bg)!important;border-color:var(--rd)!important;color:var(--err-fg)!important}
.ui.success.message,.ui.positive.message{background:var(--ok-bg)!important;border-color:var(--gn)!important;color:var(--ok-fg)!important}

/* Pagination */
.ui.pagination.menu{background:var(--bg1)!important;border:1px solid var(--bg3)!important}
.ui.pagination.menu .item{color:var(--fgm)!important;border-color:var(--bg3)!important}
.ui.pagination.menu .active.item{background:var(--bg2)!important;color:var(--fg)!important}

/* Tabs */
.tab_menu,.ui.tabular.menu{display:flex!important;gap:6px!important;background:transparent!important;border-bottom:1px solid var(--bg3)!important;margin:14px 0!important;padding:0!important}
.tab_menu li{display:block!important;min-width:auto!important;margin:0!important;padding:0!important}
.tab_menu li a,.ui.tabular.menu .item{background:var(--bg2)!important;color:var(--fgm)!important;border:1px solid var(--bg3)!important;border-bottom:none!important;border-radius:8px 8px 0 0!important;height:auto!important;padding:8px 14px!important;font-weight:600!important}
.tab_menu li a:hover,.ui.tabular.menu .item:hover{background:var(--bg3)!important;color:var(--fg)!important}
.tab_menu li a.selected,.ui.tabular.menu .active.item{background:var(--bg1)!important;color:var(--ac)!important;border-bottom-color:var(--bg1)!important}
.ui.tab,.ui.bottom.attached.segment{background:var(--bg1)!important;border:1px solid var(--bg3)!important}

/* Misc */
.ui.divider{border-color:var(--bg3)!important}
hr{border-color:var(--bg3)!important}
::selection{background:rgba(88,166,255,.3)!important}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:var(--bg0)}
::-webkit-scrollbar-thumb{background:var(--bg2);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:var(--bg3)}

/* Problem list */
.problem-list table td,.problem-list table th{padding:10px 12px!important}
.difficulty-easy,.diff-easy{color:var(--gn)!important}
.difficulty-medium,.diff-medium{color:var(--yw)!important}
.difficulty-hard,.diff-hard{color:var(--rd)!important}

/* Contest / submission pages */
.verdict-accepted,.result-accepted{color:var(--gn)!important;font-weight:700!important}
.verdict-wrong,.result-wrong-answer{color:var(--rd)!important;font-weight:700!important}
.verdict-tle,.result-time-limit{color:var(--yw)!important;font-weight:700!important}
.verdict-mle{color:#c084fc!important;font-weight:700!important}
`);
}
