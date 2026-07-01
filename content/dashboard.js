/**
 * NZOI Enhanced — Dashboard UI (dashboard.js)
 * Loaded after content.js on the home page.
 * Defines its own bg() helper — does NOT rely on content.js scope.
 */

'use strict';

// Only run on home page
if (window.location.pathname !== '/' && window.location.pathname !== '') {
    // Not home — skip
} else {
    initDashboard();
}

function initDashboard() {

// ─── Logging ──────────────────────────────────────────────────────────────────

const LOG = (...a) => console.log('[NZOI Enhanced Dashboard]', ...a);
const ERR = (...a) => console.error('[NZOI Enhanced Dashboard]', ...a);

// ─── Background bridge (self-contained, not relying on content.js) ────────────

function bg(msg) {
    return new Promise((resolve, reject) => {
        LOG('→ BG msg:', msg.type, msg.provider || msg.filename || '');
        chrome.runtime.sendMessage(msg, res => {
            if (chrome.runtime.lastError) {
                ERR('BG error:', chrome.runtime.lastError.message);
                return reject(new Error(chrome.runtime.lastError.message));
            }
            if (!res?.ok) {
                ERR('BG returned error for', msg.type, ':', res?.error);
                return reject(new Error(res?.error || 'Background error'));
            }
            LOG('← BG ok:', msg.type);
            resolve(res.data);
        });
    });
}

// ─── API providers (loaded from storage — set keys in the extension popup) ──────

let API_PROVIDERS = [];

const MISTRAL_PRIMARY_MODEL = 'mistral-medium-3-5';
const MISTRAL_FALLBACK_MODEL = 'codestral-2508';
const GOOGLE_TIER2_MODEL = 'gemini-3.5-flash';
const GOOGLE_TIER2_FALLBACK_MODEL = 'gemini-3.1-pro-preview';

const MISTRAL_LIMITS = {
    requestsPerSecond: 3,
    tokensPerMinute: 1_500_000,
    contextWindowTokens: 128_000,
};

const CLASSIFICATION_WORKER_CAP = 8;
const CLASSIFICATION_UI_FLUSH_MS = 350;
const CLASSIFICATION_SYNC_DEBOUNCE_MS = 1200;
const LATE_PROBLEM_RESCAN_MS = 5000;
const TIER2_MIN_BATCH_SIZE = 15;
const TIER2_BATCH_SIZE = 15;
const PDF_ATTACHMENT_MAX_FILES = 4;
const PDF_ATTACHMENT_MAX_BYTES = 8_000_000;
const PDF_ATTACHMENT_TEXT_MAX_CHARS = 80_000;
const PDF_ATTACHMENT_TOTAL_TEXT_MAX_CHARS = 180_000;
const PDF_ATTACHMENT_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const PDF_ATTACHMENT_FETCH_TIMEOUT_MS = 18_000;

const GOOGLE_LIMITS = {
    requestsPerMinute: 5,
    requestsPerDay: 20,
    contextWindowTokens: 1_048_576,
};

const ACCEPT_DIFFICULTIES = new Set(['beginner', 'easy', 'medium']);
const ESCALATE_DIFFICULTIES = new Set(['hard', 'very_hard', 'hardcore', 'olympiad_hard']);
const ROUTER_DIFFICULTIES = ['beginner', 'easy', 'medium', 'hard', 'very_hard', 'hardcore', 'olympiad_hard'];
const DIFFICULTY_RATING = {
    beginner: 800,
    easy: 1100,
    medium: 1500,
    hard: 1900,
    very_hard: 2300,
    hardcore: 2600,
    olympiad_hard: 2900,
};

const VALID_TAGS = new Set([
    '2-satisfiability','binary search','bitmasks','brute force','chinese remainder theorem',
    'combinatorics','constructive algorithms','data structures','depth-first search and similar',
    'divide and conquer','dynamic programming','disjoint set union','expression parsing',
    'fast fourier transform','flows','game theory','geometry','graph matchings','graphs',
    'greedy algorithms','hashing','implementation','linear algebra','meet-in-the-middle',
    'number theory','probabilities','scheduling','shortest paths','sorting',
    'string suffix structures','strings','ternary search','trees','two pointers','io',
].map(t => t.toLowerCase()));

// Default AI classification prompt. Users can override this from the extension
// popup (Data Management → Classification Prompt); the override is stored under
// chrome.storage.local key 'classificationPromptTemplate'.
// MUST contain {{TAGS}} and {{TEXT}} — see buildPrompt() below.
// MUST match DEFAULT_PROMPT_TEMPLATE in popup.js (used for the "Reset to Default"
// button there, since popup.js has no access to this content-script scope).
const DEFAULT_PROMPT_TEMPLATE = `You are a competitive programming problem classifier.
Output ONLY a single valid JSON object — no markdown, no extra text.

Tasks:
1. Assign difficulty rating 800-2500 (nearest 100).
2. Assign 1-5 tags from: [{{TAGS}}]

Rating guide: 800=trivial I/O only, 900-1000=trivial, 1000-1200=easy, 1200-1500=medium-easy, 1500-1800=medium, 1800-2300=hard, 2300+=very hard
IMPORTANT: Round rating to nearest 100 (e.g. 1200, 1300, 1500 — never 1250 or 1337).

{{PREVIOUS}}
Output exactly:
{"tags":["tag1","tag2"],"rating":1200}

Problem text:
{{TEXT}}`;

// ─── State ────────────────────────────────────────────────────────────────────

const ROUTER_JSON_SCHEMA = {
    type: 'json_schema',
    json_schema: {
        name: 'competitive_programming_classification',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: [
                'difficulty',
                'estimated_rating',
                'primary_skill',
                'skills',
                'reasoning_summary',
                'risk_of_misclassification',
                'confidence',
            ],
            properties: {
                difficulty: { type: 'string', enum: ROUTER_DIFFICULTIES },
                estimated_rating: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['codeforces', 'atcoder', 'usaco', 'nzoi'],
                    properties: {
                        codeforces: { type: 'integer' },
                        atcoder: { type: 'integer' },
                        usaco: { type: 'integer' },
                        nzoi: { type: 'integer' },
                    },
                },
                primary_skill: { type: 'string' },
                skills: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
                reasoning_summary: { type: 'string' },
                risk_of_misclassification: { type: 'string', enum: ['low', 'medium', 'high'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
        },
    },
};

const ROUTER_JSON_OBJECT = { type: 'json_object' };

const TIER2_BATCH_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['results'],
    properties: {
        results: {
            type: 'array',
            minItems: 1,
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'batch_id',
                    'difficulty',
                    'estimated_rating',
                    'primary_skill',
                    'skills',
                    'reasoning_summary',
                    'risk_of_misclassification',
                    'confidence',
                ],
                properties: {
                    batch_id: { type: 'string' },
                    difficulty: { type: 'string', enum: ROUTER_DIFFICULTIES },
                    estimated_rating: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['codeforces', 'atcoder', 'usaco', 'nzoi'],
                        properties: {
                            codeforces: { type: 'integer' },
                            atcoder: { type: 'integer' },
                            usaco: { type: 'integer' },
                            nzoi: { type: 'integer' },
                        },
                    },
                    primary_skill: { type: 'string' },
                    skills: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
                    reasoning_summary: { type: 'string' },
                    risk_of_misclassification: { type: 'string', enum: ['low', 'medium', 'high'] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                },
            },
        },
    },
};

const DEFAULT_MISTRAL_TIER1_PROMPT_TEMPLATE = `You are Tier 1 of a competitive-programming classifier for NZOI Training.

Return ONLY one valid JSON object. Do not use markdown. Do not include extra keys.
Do not give a solution, algorithm walkthrough, pseudocode, or code.

Inspect constraints carefully: input sizes, graph sizes, value bounds, time limits implied by the statement, and whether the apparent simple approach is too slow.

Your job:
- Classify difficulty using exactly one of: beginner, easy, medium, hard, very_hard, hardcore, olympiad_hard.
- Estimate ratings rounded to nearest 100 for codeforces, atcoder, usaco, and nzoi.
- Rating 800 means basically no thinking: direct input/output, fixed formula, or trivial parsing only.
- If the problem needs even a tiny observation, branch, loop, simulation, or case handling, rate it above 800.
- Choose primary_skill and skills from the existing tag list as closely as possible.
- If this looks hard/risky/ambiguous, set confidence below 0.85 and risk_of_misclassification to medium or high.
- Keep reasoning_summary short and high-level. Do not reveal hidden chain-of-thought.

Risky topics that should lower confidence or mark the problem hard include: tricky DP, graph modeling, modified shortest path, flows, matching, geometry, number theory, combinatorics, game theory, string hashing, suffix structures, heavy data structures, proof-heavy greedy, and binary search on answer.

Allowed existing tags:
{{TAGS}}

Previous classification anchor, if any. Use it only if it still matches the statement and constraints:
{{PREVIOUS}}

Problem title:
{{TITLE}}

Problem URL:
{{URL}}

Problem statement:
{{TEXT}}

Required JSON shape:
{
  "difficulty": "beginner|easy|medium|hard|very_hard|hardcore|olympiad_hard",
  "estimated_rating": { "codeforces": 1200, "atcoder": 1200, "usaco": 1200, "nzoi": 1200 },
  "primary_skill": "one existing tag",
  "skills": ["one existing tag"],
  "reasoning_summary": "brief non-solution reason",
  "risk_of_misclassification": "low|medium|high",
  "confidence": 0.0
}`;

const DEFAULT_GOOGLE_TIER2_PROMPT_TEMPLATE = `You are Tier 2 of a competitive-programming classifier for NZOI Training.

This problem was escalated from Tier 1. Review the original problem and Tier 1 result. Your result becomes final.
Use native/private thinking if available, but NEVER output hidden thinking or chain-of-thought. Return ONLY one valid JSON object.
Do not provide a full solution, code, pseudocode, or step-by-step algorithm.

Focus especially on:
- constraints and whether common approaches fit,
- malformed or missing Tier 1 fields,
- hard/risky topics,
- whether primary_skill and skills are valid existing tags,
- avoiding overconfident easy classifications for subtle problems.
- keeping rating 800 only for problems with basically no thinking at all; anything with a tiny observation or case split should be above 800.

Escalation reason:
{{ESCALATION_REASON}}

Allowed existing tags:
{{TAGS}}

Tier 1 result/debug payload:
{{TIER1_RESULT}}

Problem title:
{{TITLE}}

Problem URL:
{{URL}}

Original problem statement:
{{TEXT}}

Required JSON shape:
{
  "difficulty": "beginner|easy|medium|hard|very_hard|hardcore|olympiad_hard",
  "estimated_rating": { "codeforces": 1200, "atcoder": 1200, "usaco": 1200, "nzoi": 1200 },
  "primary_skill": "one existing tag",
  "skills": ["one existing tag"],
  "reasoning_summary": "brief non-solution reason",
  "risk_of_misclassification": "low|medium|high",
  "confidence": 0.0
}`;

const state = {
    problems: [], allTags: new Set(), allGroups: new Set(), seenIds: new Set(),
    // Active table sort, controlled from column headers.
    sorts: [{ column:'rating', ascending:false }],
    // Multi-value filters: Sets of selected values per dimension (OR within each
    // dimension, AND across dimensions). Empty Set = "all" for that dimension.
    filters: { tags: new Set(), groups: new Set(), diffs: new Set(), search: '' },
    apiStates: {}, reclassifying: new Set(), total: 0,
    filtered: [],   // current filtered+sorted view — virtualized renderer reads this
    theme: 'dark',  // set synchronously at the top of run(), before first paint
    hideTags: false, // some users find inline tags spoil the approach before they've tried the problem
    revealedTagRows: new Set(), // problem IDs temporarily revealed by clicking their hidden-tags placeholder
};

// Row height in px — MUST match `.pr{height:...}` in injectDashboardStyles().
// Used by the virtualized renderer to compute scroll offsets without measuring
// the DOM (so it works correctly even before any rows have been painted).
const ROW_H = 72;
const OVERSCAN = 6; // extra rows rendered above/below the viewport

// Precompute lowercase sort keys once, so the comparator in updateTable() never
// calls .toLowerCase()/.join() per-comparison (was the main per-sort cost at
// ~800 rows; Array.prototype.sort itself is already O(N log N) TimSort).
// Call this whenever a problem is created/restored/classified, or whenever its
// name/group/tags change.
function setSortKeys(p) {
    p._nameKey  = (p.name  || '').toLowerCase();
    p._groupKey = (p.group || '').toLowerCase();
    p._tagsKey  = (p.tags  || []).join(',').toLowerCase();
}

function prepareProblem(p) {
    if (!Array.isArray(p.tags)) p.tags = p.tags == null ? null : [];
    if (p.rating == null) p.rating = null;
    p.searchIndex = `${p.name || ''} ${(p.tags || []).join(' ')} ${p.rating || ''} ${p.group || ''}`.toLowerCase();
    p._tagSet = new Set((p.tags || []).map(t => t.toLowerCase()));
    setSortKeys(p);
    if (p.group) state.allGroups.add(p.group);
    (p.tags || []).forEach(t => state.allTags.add(t));
    return p;
}

function upsertProblems(problems) {
    if (!problems || !problems.length) return [];
    const byId = new Map(state.problems.map(p => [String(p.id), p]));
    const changed = [];
    problems.forEach(raw => {
        const incoming = prepareProblem({ ...raw });
        const key = String(incoming.id);
        const existing = byId.get(key);
        if (existing) {
            Object.assign(existing, incoming);
            prepareProblem(existing);
            changed.push(existing);
        } else {
            byId.set(key, incoming);
            changed.push(incoming);
        }
    });
    state.problems = Array.from(byId.values());
    return changed;
}

function initApiStates() {
    API_PROVIDERS.forEach(p => {
        state.apiStates[p.name] = {
            lastCall: 0,
            pauseUntil: 0,
            consecutive429: 0,
            requestTimes: [],
            tokenTimes: [],
            dayKey: new Date().toISOString().slice(0, 10),
            dailyRequests: 0,
            currentBackoffMs: 5000,
            limitLogTimes: {},
        };
    });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const esc      = t => (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const sleep    = ms => new Promise(r => setTimeout(r, ms));
const debounce = (f,w) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), w); }; };

const getRatingConfig = () => ({
    bounds: [800,1200,1400,1600,1900,2100,2400,9999],
    colors: ['#808080','#008000','#03a89e','#0000ff','#aa00aa','#ff8c00','#ff0000','#000000'],
});
const getStarCount = r => { const b=getRatingConfig().bounds; let i=0; while(i+1<b.length&&r>=b[i+1])i++; return Math.max(1,Math.min(5,i+1)); };
const getStarRating = r => '★'.repeat(getStarCount(r));
const formatPct = p => `${Math.round(p||0)}%`;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const roundRating = n => Math.round(clamp(Number(n) || 800, 800, 3500) / 100) * 100;
const estimateTokens = text => Math.ceil(String(text || '').length / 4);

function fillPromptTemplate(template, values) {
    return String(template || '').replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
        const value = values[key];
        return value == null ? '' : String(value);
    });
}

function trimForTokenBudget(text, maxTokens) {
    const s = String(text || '');
    if (estimateTokens(s) <= maxTokens) return s;
    const maxChars = Math.max(1200, maxTokens * 4);
    const head = Math.floor(maxChars * 0.72);
    const tail = Math.floor(maxChars * 0.22);
    return s.slice(0, head) + '\n\n[content truncated for provider context window]\n\n' + s.slice(-tail);
}

function stableHash(input) {
    const s = String(input || '');
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 ^= c;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= c + i;
        h2 = Math.imul(h2, 0x85ebca6b);
    }
    return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36));
}

const bytesToBinary = bytes => {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return out;
};

const binaryToBytes = str => {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 255;
    return out;
};

function decodePdfBytes(bytes) {
    if (!bytes || !bytes.length) return '';
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        let out = '';
        for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return out;
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        let out = '';
        for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
        return out;
    }
    let zeroEven = 0, pairs = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) { pairs++; if (bytes[i] === 0 && bytes[i + 1] >= 32) zeroEven++; }
    if (pairs > 2 && zeroEven / pairs > 0.45) {
        let out = '';
        for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return out;
    }
    return Array.from(bytes, b => String.fromCharCode(b)).join('');
}

function decodePdfLiteralString(src) {
    const bytes = [];
    for (let i = 0; i < src.length; i++) {
        let c = src[i];
        if (c !== '\\') { bytes.push(c.charCodeAt(0) & 255); continue; }
        const n = src[++i];
        if (n == null) break;
        if (n === 'n') bytes.push(10);
        else if (n === 'r') bytes.push(13);
        else if (n === 't') bytes.push(9);
        else if (n === 'b') bytes.push(8);
        else if (n === 'f') bytes.push(12);
        else if (n === '\n') {}
        else if (n === '\r') { if (src[i + 1] === '\n') i++; }
        else if (/[0-7]/.test(n)) {
            let oct = n;
            for (let k = 0; k < 2 && /[0-7]/.test(src[i + 1] || ''); k++) oct += src[++i];
            bytes.push(parseInt(oct, 8) & 255);
        } else {
            bytes.push(n.charCodeAt(0) & 255);
        }
    }
    return decodePdfBytes(bytes);
}

function decodePdfHexString(src) {
    const hex = String(src || '').replace(/[^0-9a-f]/gi, '');
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2).padEnd(2, '0'), 16) || 0);
    return decodePdfBytes(bytes);
}

function cleanPdfText(text) {
    return String(text || '')
        .replace(/\u0000/g, '')
        .replace(/[ \t\r\f\v]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractPdfTextOperators(streamText) {
    const out = [];
    const blockRe = /BT([\s\S]*?)ET/g;
    let block;
    while ((block = blockRe.exec(streamText))) {
        const body = block[1];
        const tokenRe = /\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>|\[(.*?)\]\s*TJ/g;
        let token;
        while ((token = tokenRe.exec(body))) {
            const raw = token[0];
            if (raw[0] === '(') out.push(decodePdfLiteralString(raw.slice(1, -1)));
            else if (raw[0] === '<') out.push(decodePdfHexString(token[1] || ''));
            else if (token[2]) {
                const inner = token[2];
                const partRe = /\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>/g;
                let part;
                while ((part = partRe.exec(inner))) {
                    const p = part[0];
                    out.push(p[0] === '(' ? decodePdfLiteralString(p.slice(1, -1)) : decodePdfHexString(part[1] || ''));
                }
            }
        }
        out.push('\n');
    }
    return out.join(' ');
}

async function inflatePdfStream(bytes) {
    if (!('DecompressionStream' in window)) return null;
    try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

function extractPdfLooseText(binary) {
    const out = [];
    const literalRe = /\((?:\\.|[^\\()]){3,}\)/g;
    let m;
    while ((m = literalRe.exec(binary))) {
        const text = decodePdfLiteralString(m[0].slice(1, -1));
        if (/[A-Za-z0-9]/.test(text)) out.push(text);
        if (out.join(' ').length > PDF_ATTACHMENT_TEXT_MAX_CHARS) break;
    }
    const readable = binary
        .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, '\n')
        .split(/\n+/)
        .map(s => s.trim())
        .filter(s => s.length > 30 && /[A-Za-z]/.test(s))
        .slice(0, 800)
        .join('\n');
    return cleanPdfText(out.join(' ') + '\n' + readable);
}

async function extractPdfTextFromArrayBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    const binary = bytesToBinary(bytes);
    const chunks = [];
    const streamRe = /<<(?:[\s\S]*?)>>\s*stream\r?\n?/g;
    let match;
    while ((match = streamRe.exec(binary))) {
        const header = match[0];
        const start = streamRe.lastIndex;
        const end = binary.indexOf('endstream', start);
        if (end < 0) break;
        let raw = binary.slice(start, end).replace(/(?:\r?\n|\r)$/, '');
        let streamBytes = binaryToBytes(raw);
        if (/\/FlateDecode\b/.test(header)) {
            const inflated = await inflatePdfStream(streamBytes);
            if (inflated) streamBytes = inflated;
        }
        const streamText = bytesToBinary(streamBytes);
        const text = extractPdfTextOperators(streamText);
        if (text.trim()) chunks.push(text);
        if (chunks.join('\n').length > PDF_ATTACHMENT_TEXT_MAX_CHARS) break;
        streamRe.lastIndex = end + 'endstream'.length;
    }
    let text = cleanPdfText(chunks.join('\n'));
    if (text.length < 200) text = extractPdfLooseText(binary);
    return cleanPdfText(text).slice(0, PDF_ATTACHMENT_TEXT_MAX_CHARS);
}

function normalizeDifficulty(value) {
    const d = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases = {
        trivial: 'beginner',
        novice: 'beginner',
        easy_medium: 'medium',
        medium_easy: 'medium',
        veryhard: 'very_hard',
        olympiad: 'olympiad_hard',
        extremely_hard: 'hardcore',
    };
    const out = aliases[d] || d;
    return ROUTER_DIFFICULTIES.includes(out) ? out : 'medium';
}

function difficultyFromRating(rating) {
    const r = roundRating(rating);
    if (r < 1000) return 'beginner';
    if (r < 1400) return 'easy';
    if (r < 1800) return 'medium';
    if (r < 2200) return 'hard';
    if (r < 2500) return 'very_hard';
    if (r < 2800) return 'hardcore';
    return 'olympiad_hard';
}

function labelDifficulty(difficulty) {
    return String(difficulty || 'medium').replace(/_/g, ' ');
}

const SKILL_RULES = [
    [/2[-\s]?sat|two satisfiability/, '2-satisfiability'],
    [/binary search|parametric search|answer search/, 'binary search'],
    [/bitmask|bitset|subset/, 'bitmasks'],
    [/brute force|backtracking|complete search|enumeration/, 'brute force'],
    [/chinese remainder|crt\b/, 'chinese remainder theorem'],
    [/combinatorics|counting|inclusion.?exclusion|pigeonhole/, 'combinatorics'],
    [/constructive|construction/, 'constructive algorithms'],
    [/data structure|segment tree|fenwick|binary indexed tree|\bbit\b|sparse table|heap|priority queue|treap|sqrt decomposition|heavy.?light|hld|lazy propagation/, 'data structures'],
    [/dfs|depth.?first|flood fill|topological|traversal/, 'depth-first search and similar'],
    [/divide and conquer|cdq/, 'divide and conquer'],
    [/dynamic programming|\bdp\b|knapsack|memoization|lis|lcs|digit dp|tree dp|interval dp/, 'dynamic programming'],
    [/disjoint set|union find|dsu/, 'disjoint set union'],
    [/expression parsing|parser|grammar/, 'expression parsing'],
    [/fft|fourier|ntt/, 'fast fourier transform'],
    [/flow|dinic|min.?cut|max.?flow|circulation/, 'flows'],
    [/game theory|grundy|nim|sprague/, 'game theory'],
    [/geometry|convex hull|sweep line|polygon|circle|orientation/, 'geometry'],
    [/matching|bipartite matching|hungarian/, 'graph matchings'],
    [/\bgraph|bfs|shortest path|dijkstra|bellman|floyd|mst|minimum spanning|topological/, 'graphs'],
    [/greedy|exchange argument/, 'greedy algorithms'],
    [/hash|rolling hash|zobrist/, 'hashing'],
    [/implementation|simulation|ad hoc|casework|parsing input/, 'implementation'],
    [/linear algebra|matrix|gaussian/, 'linear algebra'],
    [/meet.?in.?the.?middle/, 'meet-in-the-middle'],
    [/number theory|modular|gcd|lcm|prime|sieve|factor|diophantine|totient/, 'number theory'],
    [/probabilit|expected value|random/, 'probabilities'],
    [/scheduling|interval scheduling|deadline/, 'scheduling'],
    [/shortest path|dijkstra|bellman|floyd|0-1 bfs|modified shortest/, 'shortest paths'],
    [/sorting|order statistics/, 'sorting'],
    [/suffix array|suffix automaton|suffix tree|suffix structure/, 'string suffix structures'],
    [/string|kmp|prefix function|z-function|trie|aho.?corasick/, 'strings'],
    [/ternary search/, 'ternary search'],
    [/tree|lca|centroid|euler tour/, 'trees'],
    [/two pointers|sliding window/, 'two pointers'],
    [/\bio\b|input.?output|fast input/, 'io'],
];

function mapSkillToTag(skill) {
    const s = String(skill || '').trim().toLowerCase();
    if (!s) return '';
    if (VALID_TAGS.has(s)) return s;
    const compact = s.replace(/[_-]+/g, ' ');
    if (VALID_TAGS.has(compact)) return compact;
    for (const [re, tag] of SKILL_RULES) if (re.test(compact)) return tag;
    return '';
}

function normalizeSkillList(rawSkills, primarySkill) {
    const source = [];
    if (primarySkill) source.push(primarySkill);
    if (Array.isArray(rawSkills)) source.push(...rawSkills);
    const out = [];
    source.forEach(skill => {
        const tag = mapSkillToTag(skill);
        if (tag && !out.includes(tag)) out.push(tag);
    });
    return out;
}

const RISKY_RULES = [
    [/tricky\s+dp|digit dp|interval dp|tree dp|dp over subsets|bitmask dp|profile dp/i, 'tricky DP'],
    [/graph modeling|model(?:ing)? as a graph|state graph/i, 'graph modeling'],
    [/modified shortest path|shortest path with|dijkstra.*state|0-1 bfs/i, 'modified shortest path'],
    [/flow|min.?cut|max.?flow|dinic|circulation/i, 'flows'],
    [/matching|hungarian|bipartite matching/i, 'matching'],
    [/geometry|convex hull|orientation|polygon|circle/i, 'geometry'],
    [/number theory|modular arithmetic|prime|sieve|factorization|diophantine/i, 'number theory'],
    [/combinatorics|inclusion.?exclusion|counting/i, 'combinatorics'],
    [/game theory|grundy|nim|sprague/i, 'game theory'],
    [/string hashing|rolling hash|hash collision/i, 'string hashing'],
    [/suffix array|suffix automaton|suffix tree/i, 'suffix structures'],
    [/heavy data structure|segment tree|fenwick|treap|heavy.?light|hld|lazy propagation/i, 'heavy data structures'],
    [/proof.?heavy greedy|exchange argument/i, 'proof-heavy greedy'],
    [/binary search on answer|parametric search/i, 'binary search on answer'],
];

function detectRiskyTopics(problemText, result) {
    const skills = [result?.primary_skill, ...(Array.isArray(result?.skills) ? result.skills : [])].join(' ');
    const summary = result?.reasoning_summary || '';
    const hay = `${problemText || ''}\n${skills}\n${summary}`;
    const found = [];
    RISKY_RULES.forEach(([re, label]) => { if (re.test(hay) && !found.includes(label)) found.push(label); });
    return found;
}

function normalizeRatings(ratings, difficulty) {
    const base = DIFFICULTY_RATING[difficulty] || 1500;
    const src = ratings && typeof ratings === 'object' ? ratings : {};
    const nzoi = roundRating(src.nzoi || src.codeforces || base);
    return {
        codeforces: roundRating(src.codeforces || nzoi),
        atcoder: roundRating(src.atcoder || nzoi),
        usaco: roundRating(src.usaco || nzoi),
        nzoi,
    };
}

// ─── API rate limiter ─────────────────────────────────────────────────────────

const apiMgr = {
    candidates(kind, sp=null) {
        if (!kind || kind === 'any') {
            return API_PROVIDERS.filter(p => !sp || sp === 'router' || p.name === sp || p.provider === sp);
        }
        if (kind === 'mistral' || kind === 'google') {
            return API_PROVIDERS.filter(p => p.provider === kind && (!sp || sp === 'router' || p.name === sp));
        }
        const direct = API_PROVIDERS.filter(p => p.name === kind || p.provider === kind);
        return direct.length ? direct : API_PROVIDERS.filter(p => !sp || sp === 'router' || p.name === sp || p.provider === sp);
    },
    ensureState(p) {
        if (!state.apiStates[p.name]) {
            state.apiStates[p.name] = {
                lastCall: 0,
                pauseUntil: 0,
                consecutive429: 0,
                requestTimes: [],
                tokenTimes: [],
                dayKey: new Date().toISOString().slice(0, 10),
                dailyRequests: 0,
                currentBackoffMs: 5000,
                limitLogTimes: {},
            };
        }
        return state.apiStates[p.name];
    },
    rollDailyWindow(ps) {
        const dayKey = new Date().toISOString().slice(0, 10);
        if (ps.dayKey !== dayKey) {
            ps.dayKey = dayKey;
            ps.dailyRequests = 0;
        }
    },
    logLimited(p, key, message, intervalMs=10_000) {
        const ps = this.ensureState(p);
        const now = Date.now();
        ps.limitLogTimes = ps.limitLogTimes || {};
        if ((ps.limitLogTimes[key] || 0) + intervalMs > now) return;
        ps.limitLogTimes[key] = now;
        LOG(message);
    },
    getAvailable(kind, sp=null, tokenCost=0) {
        const now = Date.now();
        const prv = this.candidates(kind, sp);
        for (const p of prv) {
            const ps = this.ensureState(p);
            this.rollDailyWindow(ps);
            if (ps.pauseUntil > now) {
                this.logLimited(p, 'paused', `${p.name} paused for ${Math.ceil((ps.pauseUntil-now)/1000)}s`, 30_000);
                continue;
            }
            ps.requestTimes = ps.requestTimes.filter(t=>t>now-60_000);
            ps.tokenTimes = (ps.tokenTimes || []).filter(x=>x.t>now-60_000);
            const rr = ps.requestTimes;
            if (p.contextWindowTokens && tokenCost > p.contextWindowTokens) continue;
            if (p.rpsLimit && rr.filter(t=>t>now-1000).length >= p.rpsLimit) continue;
            if (p.rpmLimit && rr.length >= p.rpmLimit) {
                this.logLimited(p, 'rpm', `${p.name} rate limited (${rr.length}/${p.rpmLimit} rpm)`);
                continue;
            }
            if (p.rpdLimit && ps.dailyRequests >= p.rpdLimit) {
                this.logLimited(p, 'rpd', `${p.name} daily request limit reached (${ps.dailyRequests}/${p.rpdLimit})`, 300_000);
                continue;
            }
            if (p.tpmLimit) {
                const used = ps.tokenTimes.reduce((sum, x) => sum + x.tokens, 0);
                if (used + tokenCost > p.tpmLimit) {
                    this.logLimited(p, 'tpm', `${p.name} token limited (${used}/${p.tpmLimit} tpm)`);
                    continue;
                }
            }
            return p;
        }
        return null;
    },
    dailyExhausted(kind, sp=null) {
        const candidates = this.candidates(kind, sp);
        if (!candidates.length) return false;
        return candidates.every(p => {
            if (!p.rpdLimit) return false;
            const ps = this.ensureState(p);
            this.rollDailyWindow(ps);
            return ps.dailyRequests >= p.rpdLimit;
        });
    },
    reserve(p, tokenCost=0) {
        const now = Date.now();
        const ps = this.ensureState(p);
        this.rollDailyWindow(ps);
        ps.requestTimes = ps.requestTimes.filter(t=>t>now-60_000);
        ps.tokenTimes = (ps.tokenTimes || []).filter(x=>x.t>now-60_000);
        ps.requestTimes.push(now);
        if (p.rpdLimit) ps.dailyRequests++;
        if (tokenCost > 0) ps.tokenTimes.push({ t: now, tokens: tokenCost });
        ps.lastCall = now;
        const dayPart = p.rpdLimit ? `, ${ps.dailyRequests}/${p.rpdLimit} day` : '';
        LOG(`${p.name}: reserved ${ps.requestTimes.length}/${p.rpmLimit || 'unlimited'} rpm${dayPart}`);
    },
    async waitFor(kind, sp=null, tokenCost=0) {
        let waited = 0;
        while (true) {
            const p = this.getAvailable(kind, sp, tokenCost);
            if (p) {
                this.reserve(p, tokenCost);
                return p;
            }
            if (this.dailyExhausted(kind, sp)) {
                throw new Error((kind || 'AI') + ' daily request limit reached');
            }
            if (waited === 0) LOG('All providers busy, waiting…');
            await sleep(250); waited += 250;
            if (waited > 120_000) throw new Error((kind || 'AI') + ' providers rate-limited for >2 minutes');
        }
    },
    record(p, tokenCost=0) {
        const now=Date.now(), ps=this.ensureState(p);
        ps.requestTimes = ps.requestTimes.filter(t=>t>now-60_000);
        ps.tokenTimes = (ps.tokenTimes || []).filter(x=>x.t>now-60_000);
        ps.lastCall=now;
        LOG(`${p.name}: ${ps.requestTimes.length}/${p.rpmLimit || 'unlimited'} rpm used`);
    },
    resetBackoff(p) { const ps=this.ensureState(p); ps.consecutive429=0; ps.currentBackoffMs=5000; },
    handle429(p) {
        const ps=this.ensureState(p); ps.consecutive429++;
        const bo = Math.min(300_000, ps.currentBackoffMs * Math.pow(2, ps.consecutive429));
        ps.pauseUntil = Date.now() + bo;
        ERR(`${p.name} 429 — pausing ${Math.ceil(bo/1000)}s`);
    },
};

// ─── Classifier ───────────────────────────────────────────────────────────────

const classifier = {
    // Build the classification prompt, optionally injecting a previous result
    // for consistency. `prevCls` is used when reclassifying an already-tagged
    // problem — it anchors the model so a provider/model switch doesn't
    // silently flip the rating or tags on every re-run.
    async buildPrompt(txt, prevCls=null) {
        const stored = await new Promise(r => chrome.storage.local.get('classificationPromptTemplate', d => r(d.classificationPromptTemplate)));
        const tpl = (typeof stored === 'string' && stored.includes('{{TEXT}}')) ? stored : DEFAULT_PROMPT_TEMPLATE;
        const prevSection = (prevCls && prevCls.classifiedBy !== 'fallback' && prevCls.tags?.length)
            ? `\nPREVIOUS CLASSIFICATION (use as anchor — only deviate if clearly wrong):\n{"tags":${JSON.stringify(prevCls.tags)},"rating":${prevCls.rating}}\n`
            : '';
        return tpl
            .replace(/\{\{TAGS\}\}/g, Array.from(VALID_TAGS).join(', '))
            .replace(/\{\{TEXT\}\}/g, txt.slice(0, 3000))
            .replace(/\{\{PREVIOUS\}\}/g, prevSection);
    },

    // Summarize a long problem statement to ~120 words so it fits alongside the
    // consistency context without consuming the full token budget. Only called
    // when ptxt > TOKEN_BUDGET AND a previous classification exists.
    async _summarize(txt, sp=null) {
        const SUMMARY_PROMPT =
            `Summarize this competitive programming problem in ≤120 words. ` +
            `Preserve: input/output format, key constraints, algorithmic challenge. ` +
            `Output ONLY the summary, no preamble.\n\n${txt.slice(0, 4000)}`;
        try {
            const raw = await this.callAPIRaw(SUMMARY_PROMPT, sp, 2);
            return (raw || '').trim().slice(0, 600);
        } catch { return txt.slice(0, 600); }
    },

    parseResponse(raw) {
        LOG('Parsing AI response:', raw?.slice(0,150));
        try {
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch {
                const m = raw?.match(/\{[\s\S]*?\}/);
                if (m) { try { parsed = JSON.parse(m[0]); } catch(e) { ERR('JSON extract failed:', e.message); } }
            }
            if (parsed && Array.isArray(parsed.tags) && typeof parsed.rating === 'number') {
                const vt = parsed.tags.map(t=>t.toLowerCase()).filter(t=>VALID_TAGS.has(t));
                // Always round to nearest 100 regardless of what the model output
                const rounded = Math.round(Math.max(800, Math.min(3000, parsed.rating)) / 100) * 100;
                const result = { tags: vt.length ? vt : ['implementation'], rating: rounded };
                LOG('Parsed:', result);
                return result;
            }
            ERR('Could not parse valid tags/rating from:', raw?.slice(0,200));
        } catch(e) { ERR('parseResponse threw:', e.message); }
        return { tags:['implementation'], rating:800 };
    },

    // Low-level: make one API call and return the raw text response
    async callAPIRaw(prompt, sp=null, maxRetries=5) {
        for (let att=0; att<maxRetries; att++) {
            const pv = await apiMgr.waitFor(sp);
            try {
                const ps = state.apiStates[pv.name];
                const tsl = Date.now() - ps.lastCall;
                if (tsl < 1000) await sleep(1000 - tsl);
                const raw = await bg({ type:'ai:classify', provider:pv.name.replace(/-\d+$/, ''), apiKey:pv.key, model:pv.model, prompt });
                apiMgr.record(pv); apiMgr.resetBackoff(pv);
                return raw;
            } catch(e) {
                ERR(`${pv.name} attempt ${att+1} failed:`, e.message);
                if (e.message.includes('429')) { apiMgr.handle429(pv); att--; continue; }
                state.apiStates[pv.name].pauseUntil = Date.now() + 15_000;
            }
        }
        throw new Error('All API attempts exhausted');
    },

    async callAPI(prompt, sp=null, maxRetries=5) {
        LOG(`callAPI: sp=${sp||'any'}, retries=${maxRetries}`);
        try {
            const raw = await this.callAPIRaw(prompt, sp, maxRetries);
            const cls = this.parseResponse(raw);
            cls.classifiedAt = Date.now();
            LOG('Classification result:', cls);
            return cls;
        } catch {
            ERR('All attempts failed; pausing classification instead of using fallback');
            this.pauseForReload('legacy_api_attempts_exhausted');
        }
    },

    // Token budget: declared once at the bottom of this object
    // (TOKEN_BUDGET = MISTRAL_LIMITS.contextWindowTokens - 4000). The stray
    // duplicate that used to live here (TOKEN_BUDGET: 2000) was shadowed by
    // that later declaration and has been removed to avoid confusion.

    async classifyProblem(prob, sp=null) {
        LOG(`Classifying: "${prob.name}" (id=${prob.id})`);

        // Load previous result for consistency anchoring
        const prevCls = await new Promise(r =>
            chrome.storage.local.get(`nztags_${prob.id}`, d => r(d[`nztags_${prob.id}`] || null))
        );

        let ptxt = prob.name;
        try {
            const r = await fetch(prob.href);
            const h = await r.text();
            const d = new DOMParser().parseFromString(h, 'text/html');
            ptxt = d.querySelector('.problem-statement')?.innerText || d.body.innerText || prob.name;
            LOG(`Fetched problem text: ${ptxt.length} chars`);
        } catch(e) { ERR('Failed to fetch problem page:', e.message); }

        // If text is long AND we have a good previous result, summarize first so
        // the consistency context doesn't crowd out the problem statement.
        const hasPrev = prevCls && prevCls.classifiedBy !== 'fallback' && prevCls.tags?.length;
        let textForPrompt = ptxt;
        if (ptxt.length > this.TOKEN_BUDGET && hasPrev) {
            textForPrompt = await this._summarize(ptxt, sp);
            LOG(`Summarized: ${ptxt.length} → ${textForPrompt.length} chars`);
        }

        const prompt = await this.buildPrompt(textForPrompt.slice(0, 3000), hasPrev ? prevCls : null);
        const cls = await this.callAPI(prompt, sp);
        if (!cls.classifiedBy || cls.classifiedBy === 'fallback') {
            if (cls.classifiedBy !== 'fallback') cls.classifiedBy = sp || API_PROVIDERS[0]?.name || 'unknown';
        }
        return cls;
    },

    // Queue-based classification: callable multiple times as new problems are
    // discovered (e.g. from background "My Groups" fetches) without spawning
    // overlapping drain loops — the single loop below absorbs anything pushed
    // onto _queue while it's running.
    routerSystemPrompt(tier='classifier') {
        return [
            `You are ${tier} for competitive-programming problem classification.`,
            'Output ONLY one valid JSON object. No markdown, no prose outside JSON.',
            'Do not provide a full solution, algorithm walkthrough, pseudocode, or code.',
            'Inspect input/output format and constraints carefully before classifying.',
            'Use this difficulty enum exactly: beginner, easy, medium, hard, very_hard, hardcore, olympiad_hard.',
            'Use primary_skill and skills from the closest existing tag names supplied by the user.',
            'reasoning_summary must be concise, high-level, and must not reveal hidden chain-of-thought.',
        ].join('\n');
    },

    async getPromptTemplate(key, fallback, requiredPlaceholders) {
        const stored = await new Promise(r => chrome.storage.local.get(key, d => r(d[key])));
        const tpl = (typeof stored === 'string' && stored.trim()) ? stored : fallback;
        const ok = requiredPlaceholders.every(ph => tpl.includes(ph));
        return ok ? tpl : fallback;
    },

    async buildRouterMessages(prob, problemText, prevCls=null) {
        const previous = prevCls && prevCls.classifiedBy !== 'fallback'
            ? JSON.stringify({
                difficulty: prevCls.difficulty,
                rating: prevCls.rating,
                tags: prevCls.tags,
                confidence: prevCls.confidence,
                provider: prevCls.source_provider || prevCls.classifiedBy,
            }, null, 2)
            : 'none';
        const tpl = await this.getPromptTemplate(
            'mistralTier1PromptTemplate',
            DEFAULT_MISTRAL_TIER1_PROMPT_TEMPLATE,
            ['{{TEXT}}', '{{TAGS}}', '{{PREVIOUS}}']
        );
        const content = fillPromptTemplate(tpl, {
            TAGS: Array.from(VALID_TAGS).join(', '),
            PREVIOUS: previous,
            TITLE: prob.name || '',
            URL: prob.href || '',
            TEXT: problemText,
        });
        return [
            { role: 'system', content: this.routerSystemPrompt('Mistral Tier 1') },
            { role: 'user', content },
        ];
    },

    async buildTier2Messages(prob, problemText, tier1Info, escalationReason='') {
        const tpl = await this.getPromptTemplate(
            'googleTier2PromptTemplate',
            DEFAULT_GOOGLE_TIER2_PROMPT_TEMPLATE,
            ['{{TEXT}}', '{{TAGS}}', '{{TIER1_RESULT}}']
        );
        const content = fillPromptTemplate(tpl, {
            TAGS: Array.from(VALID_TAGS).join(', '),
            ESCALATION_REASON: escalationReason || 'unspecified',
            TIER1_RESULT: JSON.stringify(tier1Info, null, 2),
            TITLE: prob.name || '',
            URL: prob.href || '',
            TEXT: problemText,
        });
        return [
            { role: 'system', content: this.routerSystemPrompt('Google Gemini Tier 2') + '\nUse private reasoning if available, but never include hidden thinking in the JSON.' },
            { role: 'user', content },
        ];
    },

    async buildTier2BatchMessages(items) {
        const tpl = await this.getPromptTemplate(
            'googleTier2PromptTemplate',
            DEFAULT_GOOGLE_TIER2_PROMPT_TEMPLATE,
            ['{{TEXT}}', '{{TAGS}}', '{{TIER1_RESULT}}']
        );
        const policy = fillPromptTemplate(tpl, {
            TAGS: Array.from(VALID_TAGS).join(', '),
            ESCALATION_REASON: 'Use each item.escalation_reason.',
            TIER1_RESULT: 'Use each item.tier1_result.',
            TITLE: 'Use each item.title.',
            URL: 'Use each item.url.',
            TEXT: 'Use each item.problem_text.',
        });
        const perItemTokenBudget = Math.max(4000, Math.floor((GOOGLE_LIMITS.contextWindowTokens - 12_000) / Math.max(1, items.length)));
        const payload = items.map(item => ({
            batch_id: item.batchId,
            title: item.prob.name || '',
            url: item.prob.href || '',
            escalation_reason: item.reasons.join(', '),
            tier1_result: item.tier1Debug,
            problem_text: trimForTokenBudget(item.problemText, perItemTokenBudget),
        }));
        const content = [
            'Classify every item in the JSON array below as Tier 2.',
            'Return ONLY one valid JSON object with key "results".',
            'results must contain exactly one object per input item.',
            'Each result must copy the matching batch_id exactly.',
            'Do not include markdown, hidden thinking, full solutions, code, pseudocode, or step-by-step algorithms.',
            'Inspect constraints carefully for every item.',
            '',
            'Tier 2 policy/template:',
            policy,
            '',
            'Input items JSON:',
            JSON.stringify(payload, null, 2),
            '',
            'Required output shape:',
            JSON.stringify({
                results: [{
                    batch_id: 'same id from input',
                    difficulty: 'beginner|easy|medium|hard|very_hard|hardcore|olympiad_hard',
                    estimated_rating: { codeforces: 1200, atcoder: 1200, usaco: 1200, nzoi: 1200 },
                    primary_skill: 'one existing tag',
                    skills: ['one existing tag'],
                    reasoning_summary: 'brief non-solution reason',
                    risk_of_misclassification: 'low|medium|high',
                    confidence: 0.0,
                }],
            }),
        ].join('\n');
        return [
            { role: 'system', content: this.routerSystemPrompt('Google Gemini Tier 2 batch classifier') + '\nUse private reasoning if available, but never include hidden thinking in the JSON.' },
            { role: 'user', content },
        ];
    },

    buildRepairMessages(raw) {
        return [
            { role: 'system', content: 'Repair invalid classifier output into exactly one valid JSON object matching the requested schema. No markdown, no comments, no extra keys.' },
            {
                role: 'user',
                content: [
                    'Required keys: difficulty, estimated_rating, primary_skill, skills, reasoning_summary, risk_of_misclassification, confidence.',
                    'difficulty enum: ' + ROUTER_DIFFICULTIES.join(', '),
                    'estimated_rating object keys: codeforces, atcoder, usaco, nzoi.',
                    'risk_of_misclassification enum: low, medium, high.',
                    'confidence is a number from 0 to 1.',
                    'Invalid output:',
                    String(raw || '').slice(0, 5000),
                ].join('\n'),
            },
        ];
    },

    buildTier2BatchRepairMessages(raw) {
        return [
            { role: 'system', content: 'Repair invalid Tier 2 batch classifier output into exactly one valid JSON object. No markdown, no comments, no extra keys.' },
            {
                role: 'user',
                content: [
                    'Required top-level key: results.',
                    'results is an array. Each item must include: batch_id, difficulty, estimated_rating, primary_skill, skills, reasoning_summary, risk_of_misclassification, confidence.',
                    'difficulty enum: ' + ROUTER_DIFFICULTIES.join(', '),
                    'estimated_rating object keys: codeforces, atcoder, usaco, nzoi.',
                    'risk_of_misclassification enum: low, medium, high.',
                    'confidence is a number from 0 to 1.',
                    'Invalid output:',
                    String(raw || '').slice(0, 9000),
                ].join('\n'),
            },
        ];
    },

    parseStrictJson(raw) {
        if (typeof raw !== 'string') return { ok: false, error: 'empty_non_string_response' };
        try {
            const value = JSON.parse(raw.trim());
            if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'json_not_object' };
            return { ok: true, value };
        } catch (e) {
            return { ok: false, error: e.message || 'invalid_json' };
        }
    },

    hasProvider(kind) {
        return API_PROVIDERS.some(p => p.provider === kind);
    },

    async callProvider(kind, messages, options={}, sp=null) {
        if (!this.hasProvider(kind)) throw new Error('Missing ' + kind + ' provider');
        const promptTokens = estimateTokens(messages.map(m => m.content || '').join('\n'));
        const tokenCost = promptTokens + (options.maxTokens || 900);
        const candidates = apiMgr.candidates(kind, sp);
        if (!candidates.length) throw new Error('Missing ' + kind + ' provider');
        if (candidates.every(p => p.contextWindowTokens && tokenCost > p.contextWindowTokens)) {
            throw new Error('context-too-long for ' + kind);
        }
        let lastErr = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            const pv = await apiMgr.waitFor(kind, sp, tokenCost);
            const models = [pv.model, pv.fallbackModel].filter((m, i, arr) => m && arr.indexOf(m) === i);
            for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
                const model = models[modelIndex];
                try {
                    if (modelIndex > 0) await apiMgr.waitFor(kind, pv.name, tokenCost);
                    if (pv.contextWindowTokens && tokenCost > pv.contextWindowTokens) {
                        throw new Error('context-too-long for ' + model);
                    }
                    const raw = await bg({
                        type: 'ai:classify',
                        provider: pv.provider,
                        apiKey: pv.key,
                        model,
                        prompt: messages.map(m => m.content || '').join('\n\n'),
                        options: {
                            ...options,
                            messages,
                            responseFormat: options.responseFormat || ROUTER_JSON_OBJECT,
                        },
                    });
                    apiMgr.record(pv, tokenCost);
                    apiMgr.resetBackoff(pv);
                    return { raw, provider: kind, providerName: pv.name, model };
                } catch (e) {
                    lastErr = e;
                    ERR(`${pv.name}/${model} failed:`, e.message);
                    if (/429|rate limit|quota|resource exhausted|limit exceeded/i.test(e.message)) {
                        apiMgr.handle429(pv);
                        if (kind === 'google') throw e;
                        break;
                    }
                    if (/context|too long/i.test(e.message)) throw e;
                }
            }
            const ps = state.apiStates[pv.name];
            if (ps && lastErr && !/429|rate limit/i.test(lastErr.message)) ps.pauseUntil = Date.now() + 15_000;
        }
        throw lastErr || new Error(kind + ' API attempts exhausted');
    },

    async callAndParse(kind, messages, options={}, sp=null) {
        const first = await this.callProvider(kind, messages, options, sp);
        let parsed = this.parseStrictJson(first.raw);
        if (parsed.ok) return { ...first, parsed: parsed.value, validJson: true, repaired: false };

        const repair = await this.callProvider(kind, this.buildRepairMessages(first.raw), options, sp);
        parsed = this.parseStrictJson(repair.raw);
        if (parsed.ok) return { ...repair, parsed: parsed.value, validJson: true, repaired: true, originalRaw: first.raw };
        return {
            ...repair,
            parsed: null,
            validJson: false,
            repaired: true,
            originalRaw: first.raw,
            parseError: parsed.error,
        };
    },

    async callAndParseTier2Batch(messages, options={}) {
        const first = await this.callProvider('google', messages, options);
        let parsed = this.parseStrictJson(first.raw);
        if (parsed.ok) return { ...first, parsed: parsed.value, validJson: true, repaired: false };

        const repair = await this.callProvider('google', this.buildTier2BatchRepairMessages(first.raw), options);
        parsed = this.parseStrictJson(repair.raw);
        if (parsed.ok) return { ...repair, parsed: parsed.value, validJson: true, repaired: true, originalRaw: first.raw };
        return {
            ...repair,
            parsed: null,
            validJson: false,
            repaired: true,
            originalRaw: first.raw,
            parseError: parsed.error,
        };
    },

    normalizeResult(payload, meta={}) {
        const rawDifficulty = payload?.difficulty || difficultyFromRating(payload?.estimated_rating?.nzoi);
        const difficulty = normalizeDifficulty(rawDifficulty);
        const estimated_rating = normalizeRatings(payload?.estimated_rating, difficulty);
        const rawPrimary = typeof payload?.primary_skill === 'string' ? payload.primary_skill.trim() : '';
        const rawSkills = Array.isArray(payload?.skills) ? payload.skills.filter(Boolean) : [];
        let skills = normalizeSkillList(rawSkills, rawPrimary);
        if (!skills.length && meta.allowFallbackSkill) skills = ['implementation'];
        const primary_skill = mapSkillToTag(rawPrimary) || skills[0] || '';
        const confidence = clamp(Number(payload?.confidence), 0, 1) || 0;
        const reasoning_summary = String(payload?.reasoning_summary || '').replace(/\s+/g, ' ').trim().slice(0, 280);
        const risk = ['low', 'medium', 'high'].includes(payload?.risk_of_misclassification)
            ? payload.risk_of_misclassification
            : (confidence >= 0.85 ? 'low' : confidence >= 0.65 ? 'medium' : 'high');
        return {
            difficulty,
            estimated_rating,
            primary_skill,
            skills,
            reasoning_summary,
            risk_of_misclassification: risk,
            confidence,
            source_provider: meta.source_provider || 'unknown',
            source_model: meta.source_model || 'unknown',
            escalated: !!meta.escalated,
            escalation_reason: meta.escalation_reason || '',
            tier1_result: meta.tier1_result,
            tags: skills.length ? skills : ['implementation'],
            rating: estimated_rating.nzoi,
            classifiedBy: meta.source_provider || 'unknown',
            classifiedAt: Date.now(),
            classificationDeferred: false,
            deferReason: '',
        };
    },

    tier1EscalationReasons(tier1, problemText) {
        const reasons = [];
        if (!tier1.validJson) {
            reasons.push('invalid_json_after_one_retry');
            return reasons;
        }
        const raw = tier1.parsed || {};
        const norm = tier1.normalized;
        if (ESCALATE_DIFFICULTIES.has(norm.difficulty)) reasons.push('difficulty_' + norm.difficulty);
        if (!ACCEPT_DIFFICULTIES.has(norm.difficulty)) reasons.push('difficulty_not_accepted');
        if (norm.confidence < 0.85) reasons.push('confidence_below_0.85');
        if (!raw.primary_skill || typeof raw.primary_skill !== 'string' || !raw.primary_skill.trim()) reasons.push('missing_primary_skill');
        if (!Array.isArray(raw.skills) || raw.skills.length === 0) reasons.push('empty_skills');
        if (!norm.primary_skill) reasons.push('primary_skill_not_mapped');
        if (!norm.skills.length) reasons.push('skills_not_mapped');
        const risky = detectRiskyTopics(problemText, raw).concat(detectRiskyTopics(problemText, norm));
        [...new Set(risky)].forEach(topic => reasons.push('risky_topic_' + topic.replace(/\s+/g, '_').toLowerCase()));
        return [...new Set(reasons)];
    },

    cacheKeys(prob, problemText) {
        const contentHash = stableHash(problemText || '');
        const fullHash = stableHash([prob.href || '', prob.name || '', contentHash].join('\n'));
        return {
            legacy: `nztags_${prob.id}`,
            index: `nztags_idx_${prob.id}`,
            full: `nztags_v2_${fullHash}`,
            contentHash,
        };
    },

    async readContentCache(prob, problemText) {
        const keys = this.cacheKeys(prob, problemText);
        const stored = await new Promise(r => chrome.storage.local.get(keys.full, r));
        const cls = stored[keys.full];
        return cache.isValid(cls) ? { ...cls, cacheHit: true } : null;
    },

    withCacheMeta(prob, cls, problemText) {
        const keys = this.cacheKeys(prob, problemText);
        return {
            ...cls,
            cache_key: keys.full,
            problem_hash: keys.contentHash,
            problem_url: prob.href || '',
            problem_title: prob.name || '',
        };
    },

    async saveClassification(prob, cls) {
        const legacy = `nztags_${prob.id}`;
        const updates = { [legacy]: cls };
        if (cls.cache_key) {
            updates[cls.cache_key] = cls;
            updates[`nztags_idx_${prob.id}`] = {
                key: cls.cache_key,
                contentHash: cls.problem_hash || '',
                url: cls.problem_url || prob.href || '',
                title: cls.problem_title || prob.name || '',
                savedAt: Date.now(),
            };
        }
        await new Promise(r => chrome.storage.local.set(updates, r));
    },

    pauseForReload(reason, tier1Info=null) {
        const err = new Error('Classification paused until next reload: ' + (reason || 'ai_unavailable'));
        err.pauseClassification = true;
        err.reason = reason || 'ai_unavailable';
        err.tier1_result = tier1Info || undefined;
        throw err;
    },

    deferUntilReload(reason, tier1Info=null) {
        const err = new Error('Classification deferred until next reload: ' + (reason || 'tier2_unavailable'));
        err.deferClassification = true;
        err.reason = reason || 'tier2_unavailable';
        err.tier1_result = tier1Info || undefined;
        throw err;
    },

    fallbackClassification(prob, reason, tier1Info=null) {
        this.pauseForReload(reason, tier1Info);
    },

    TOKEN_BUDGET: MISTRAL_LIMITS.contextWindowTokens - 4000,

    findPdfLinks(doc, baseUrl, rawText='') {
        const links = [];
        const add = href => {
            if (!href) return;
            try {
                const rawHref = String(href).trim();
                let effectiveBase = baseUrl;
                const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(rawHref) && !rawHref.startsWith('//') && !rawHref.startsWith('/');
                if (isRelative) {
                    const b = new URL(baseUrl, location.href);
                    const lastPart = b.pathname.split('/').pop() || '';
                    if (!b.pathname.endsWith('/') && !lastPart.includes('.')) {
                        b.pathname += '/';
                        b.search = '';
                        b.hash = '';
                        effectiveBase = b.href;
                    }
                }
                const url = new URL(rawHref, effectiveBase).href;
                if (/\.pdf(?:[?#]|$)/i.test(url) && !links.includes(url)) links.push(url);
            } catch {}
        };
        doc?.querySelectorAll?.('a[href], iframe[src], embed[src], object[data]')?.forEach(el => {
            add(el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data'));
        });
        const markdownPdfRe = /(?:!?\[[^\]\n]*\]\(|href=["']?)([^)"'\s<>]+\.pdf(?:[?#][^)"'\s<>]*)?)/gi;
        let match;
        while ((match = markdownPdfRe.exec(String(rawText || '')))) add(match[1]);
        const barePdfRe = /(?:^|[\s("'=])((?:https?:\/\/|\.{0,2}\/|\/)?[A-Za-z0-9._~:/?#@!$&*+,;=%-]+\.pdf(?:[?#][A-Za-z0-9._~:/?#@!$&*+,;=%-]*)?)/gi;
        while ((match = barePdfRe.exec(String(rawText || '')))) add(match[1]);
        return links.slice(0, PDF_ATTACHMENT_MAX_FILES);
    },

    async fetchWithTimeout(url, options={}, timeoutMs=PDF_ATTACHMENT_FETCH_TIMEOUT_MS) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: ctrl.signal });
        } finally {
            clearTimeout(t);
        }
    },

    async loadPdfText(url) {
        const key = 'nzpdf_text_' + stableHash(url);
        try {
            const cached = await new Promise(r => chrome.storage.local.get(key, d => r(d[key] || null)));
            if (cached?.text && Date.now() - (cached.savedAt || 0) < PDF_ATTACHMENT_CACHE_MS) return cached.text;
        } catch {}
        try {
            const res = await this.fetchWithTimeout(url, { credentials:'include', cache:'force-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const len = Number(res.headers.get('content-length') || 0);
            if (len && len > PDF_ATTACHMENT_MAX_BYTES) throw new Error('PDF too large: ' + len + ' bytes');
            const buffer = await res.arrayBuffer();
            if (buffer.byteLength > PDF_ATTACHMENT_MAX_BYTES) throw new Error('PDF too large: ' + buffer.byteLength + ' bytes');
            const text = await extractPdfTextFromArrayBuffer(buffer);
            const finalText = text || '[PDF text extraction returned no readable text]';
            chrome.storage.local.set({ [key]: { url, text: finalText, savedAt: Date.now(), bytes: buffer.byteLength } });
            return finalText;
        } catch (e) {
            ERR('PDF extraction failed:', url, e.message);
            return `[PDF attachment could not be read: ${url} (${e.message})]`;
        }
    },

    async enrichProblemTextWithPdfs(prob, doc, baseText) {
        const links = this.findPdfLinks(doc, prob.href, doc?.body?.innerText || baseText);
        if (!links.length) return baseText;
        LOG(`Found ${links.length} PDF attachment(s) for ${prob.name}`);
        const parts = [];
        let used = 0;
        const texts = await Promise.all(links.map(url => this.loadPdfText(url)));
        texts.forEach((text, i) => {
            const remaining = PDF_ATTACHMENT_TOTAL_TEXT_MAX_CHARS - used;
            if (remaining <= 0) return;
            const clipped = String(text || '').slice(0, remaining);
            used += clipped.length;
            parts.push(`\n\n[PDF attachment ${i + 1}: ${links[i]}]\n${clipped}`);
        });
        if (!parts.length) return baseText;
        return `${baseText}\n\n=== Attached PDF Text For Classification ===${parts.join('')}`;
    },

    classifyTier2Batched(prob, problemText, tier1Debug, reasons) {
        if (!this.hasProvider('google')) {
            this.deferUntilReload(reasons.concat('missing_google_tier2_provider').join(', '), tier1Debug);
        }
        return new Promise((resolve, reject) => {
            const batchId = `p${prob.id}_${Date.now()}_${++this._tier2BatchSeq}`;
            this._tier2BatchQueue.push({
                batchId,
                prob,
                problemText,
                tier1Debug,
                reasons,
                resolve,
                reject,
            });
            if (this._tier2BatchQueue.length >= TIER2_MIN_BATCH_SIZE) {
                this.flushTier2Batch();
            }
        });
    },

    flushTier2Batch(force=false) {
        let flushed = false;
        while (this._tier2BatchQueue.length && (force || this._tier2BatchQueue.length >= TIER2_MIN_BATCH_SIZE)) {
            const items = this._tier2BatchQueue.splice(0, TIER2_BATCH_SIZE);
            if (!items.length) break;
            flushed = true;
            this.runTier2Batch(items);
            if (!force) break;
        }
        return flushed;
    },

    async runTier2Batch(items) {
        try {
            const messages = await this.buildTier2BatchMessages(items);
            const maxTokens = Math.min(28_000, 900 + items.length * 1200);
            const tier2 = await this.callAndParseTier2Batch(messages, {
                maxTokens,
                temperature: 0.2,
                responseFormat: ROUTER_JSON_OBJECT,
                thinkingConfig: { thinkingLevel: 'HIGH' },
            });
            if (!tier2.validJson || !Array.isArray(tier2.parsed?.results)) {
                throw new Error('google_tier2_batch_invalid_json_after_one_retry');
            }
            const byId = new Map();
            tier2.parsed.results.forEach(result => {
                if (result && typeof result.batch_id === 'string' && !byId.has(result.batch_id)) {
                    byId.set(result.batch_id, result);
                }
            });
            items.forEach(item => {
                const raw = byId.get(item.batchId);
                if (!raw) {
                    item.reject(new Error('google_tier2_batch_missing_result'));
                    return;
                }
                const final = this.normalizeResult(raw, {
                    source_provider: 'google',
                    source_model: tier2.model,
                    escalated: true,
                    escalation_reason: item.reasons.join(', '),
                    tier1_result: item.tier1Debug,
                    allowFallbackSkill: true,
                });
                item.resolve(this.withCacheMeta(item.prob, final, item.problemText));
            });
            LOG(`Tier 2 batch classified ${items.length} problem(s) via ${tier2.model}`);
        } catch (e) {
            ERR('Tier 2 batch failed:', e.message);
            items.forEach(item => item.reject(e));
        }
    },

    async classifyProblem(prob, sp=null, force=false, options={}) {
        LOG(`Classifying with router: "${prob.name}" (id=${prob.id})`);
        const queueTier2 = !!options.queueTier2;

        const prevCls = await new Promise(r =>
            chrome.storage.local.get(`nztags_${prob.id}`, d => r(d[`nztags_${prob.id}`] || null))
        );

        let ptxt = prob.name || '';
        try {
            const r = await this.fetchWithTimeout(prob.href, { credentials:'include', cache:'no-store' });
            const contentType = r.headers.get('content-type') || '';
            if (/application\/pdf/i.test(contentType) || /\.pdf(?:[?#]|$)/i.test(r.url || prob.href)) {
                const len = Number(r.headers.get('content-length') || 0);
                if (len && len > PDF_ATTACHMENT_MAX_BYTES) throw new Error('PDF too large: ' + len + ' bytes');
                const buffer = await r.arrayBuffer();
                if (buffer.byteLength > PDF_ATTACHMENT_MAX_BYTES) throw new Error('PDF too large: ' + buffer.byteLength + ' bytes');
                const pdfText = await extractPdfTextFromArrayBuffer(buffer);
                ptxt = `${prob.name || ''}\n\n[Problem PDF: ${r.url || prob.href}]\n${pdfText || '[PDF text extraction returned no readable text]'}`;
            } else {
                const h = await r.text();
                const d = new DOMParser().parseFromString(h, 'text/html');
                ptxt = d.querySelector('.problem-statement')?.innerText || d.body.innerText || prob.name || '';
                ptxt = await this.enrichProblemTextWithPdfs(prob, d, ptxt);
            }
            LOG(`Fetched problem text: ${ptxt.length} chars`);
        } catch(e) { ERR('Failed to fetch problem page:', e.message); }

        if (!force) {
            const cached = await this.readContentCache(prob, ptxt);
            if (cached) return cached;
        }

        const problemForTier1 = trimForTokenBudget(ptxt, this.TOKEN_BUDGET);
        if (!this.hasProvider('mistral')) {
            return this.withCacheMeta(prob, this.fallbackClassification(prob, 'missing_mistral_tier1_provider'), ptxt);
        }

        let tier1;
        try {
            const tier1Call = await this.callAndParse('mistral', await this.buildRouterMessages(prob, problemForTier1, prevCls), {
                maxTokens: 900,
                temperature: 0.1,
                responseFormat: ROUTER_JSON_OBJECT,
            }, sp && sp.startsWith('mistral') ? sp : null);
            tier1 = {
                ...tier1Call,
                normalized: tier1Call.validJson ? this.normalizeResult(tier1Call.parsed, {
                    source_provider: 'mistral',
                    source_model: tier1Call.model,
                    allowFallbackSkill: false,
                }) : null,
            };
        } catch (e) {
            ERR('Tier 1 failed:', e.message);
            return this.withCacheMeta(prob, this.fallbackClassification(prob, 'tier1_failed_' + e.message), ptxt);
        }

        const reasons = tier1.normalized ? this.tier1EscalationReasons(tier1, ptxt) : ['invalid_json_after_one_retry'];
        if (!reasons.length) {
            return this.withCacheMeta(prob, {
                ...tier1.normalized,
                escalated: false,
                escalation_reason: '',
                tier1_result: undefined,
            }, ptxt);
        }

        const tier1Debug = tier1.validJson
            ? { ...tier1.normalized, raw_model_json: tier1.parsed, repaired: tier1.repaired }
            : { raw: tier1.raw, originalRaw: tier1.originalRaw, parseError: tier1.parseError, repaired: tier1.repaired };

        try {
            const problemForTier2 = trimForTokenBudget(ptxt, GOOGLE_LIMITS.contextWindowTokens - 4000);
            const tier2Promise = this.classifyTier2Batched(prob, problemForTier2, tier1Debug, reasons).catch(e => {
                if (e.deferClassification) throw e;
                ERR('Tier 2 failed:', e.message);
                return this.withCacheMeta(prob, this.deferUntilReload('tier2_failed_' + e.message, tier1Debug), ptxt);
            });
            if (queueTier2) {
                return { tier2Pending: true, promise: tier2Promise };
            }
            if (!this._running) this.flushTier2Batch(true);
            return await tier2Promise;
        } catch (e) {
            if (e.deferClassification) throw e;
            throw e;
        }
    },

    _queue: [],
    _queuedIds: new Set(),
    _activeIds: new Set(),
    _running: false,
    _pausedUntilReload: false,
    _uiFlushTimer: null,
    _tier2BatchQueue: [],
    _tier2PendingSaves: new Set(),
    _tier2PendingIds: new Set(),
    _tier2BatchSeq: 0,

    // ── Gist sync: gradual, coalesced, never overlapping ──────────────────────
    // The old approach called syncToGist() every 10 classifications, and each
    // call did chrome.storage.local.get(null) (reading EVERY stored key,
    // including every saved code snapshot for every problem/language — not
    // just classifications) plus a full Gist read+merge+write, with calls
    // potentially overlapping if classification ran faster than the network
    // round-trip. That's the "lag the whole thing" bottleneck.
    //
    // Fix: track exactly which nztags_<id> keys changed since the last
    // successful sync (_dirtyKeys), and run at most ONE sync at a time
    // (_syncInFlight). Any classification/edit that finishes while a sync is
    // already running just marks _syncPending — the in-flight sync picks up
    // everything newly-dirtied in one immediate follow-up pass once it
    // completes, rather than starting a second overlapping read+write. This
    // collapses any burst of classifications into the minimum number of actual
    // Gist round-trips, and each round-trip only touches the keys that
    // actually changed instead of the entire storage area.
    _dirtyKeys: new Set(),
    _syncInFlight: false,
    _syncPending: false,
    _syncTimer: null,

    markDirty(pid) { this._dirtyKeys.add(`nztags_${pid}`); },

    requestSync(delay=CLASSIFICATION_SYNC_DEBOUNCE_MS) {
        if (this._syncInFlight) { this._syncPending = true; return; }
        if (this._syncTimer) {
            if (delay > 0) return;
            clearTimeout(this._syncTimer);
            this._syncTimer = null;
        }
        const start = () => {
            this._syncTimer = null;
            if (!this._dirtyKeys.size) return;
            this._syncInFlight = true;
            this._runSync().finally(() => {
                this._syncInFlight = false;
                if (this._syncPending) { this._syncPending = false; this.requestSync(0); }
            });
        };
        if (delay > 0) this._syncTimer = setTimeout(start, delay);
        else start();
    },

    async _runSync() {
        if (!this._dirtyKeys.size) return;
        try {
            const token = await new Promise(r => chrome.storage.local.get('githubToken', d => r(d.githubToken || '')));
            if (!token) { this._dirtyKeys.clear(); return; }

            // Snapshot + clear the dirty set up front — anything marked dirty
            // WHILE this sync is in flight (e.g. another classification
            // finishes mid-request) re-populates it and triggers the
            // coalesced follow-up pass in requestSync() above, rather than
            // being silently dropped.
            const dirty = [...this._dirtyKeys];
            this._dirtyKeys.clear();

            // Only fetch the specific keys that changed — not the entire
            // storage area (which also holds every saved code snapshot).
            const localChanged = await new Promise(r => chrome.storage.local.get(dirty, r));

            let gistExisting = {};
            try { gistExisting = await bg({ type:'gist:loadClassifications', token }); } catch {}

            // Merge only the dirty keys against their Gist counterparts (tier
            // comparison protects against a fallback/heuristic result
            // overwriting a better one already shared in the Gist — manual
            // edits always win). Everything NOT in `dirty` is left exactly as
            // it already is in the Gist, since by definition it hasn't
            // changed locally since the last successful sync.
            const merged = { ...gistExisting };
            const pulledDown = [];
            for (const k of dirty) {
                const localCls = localChanged[k], gistCls = gistExisting[k];
                if (isBetterClassification(localCls, gistCls)) {
                    merged[k] = localCls;
                } else if (gistCls) {
                    merged[k] = gistCls;
                    if (JSON.stringify(gistCls) !== JSON.stringify(localCls)) pulledDown.push([k, gistCls]);
                }
            }

            if (pulledDown.length) {
                const updates = {};
                pulledDown.forEach(([k, gd]) => {
                    updates[k] = gd;
                    const pid = k.slice('nztags_'.length);
                    const prob = state.problems.find(p => String(p.id) === pid);
                    if (prob) {
                        Object.assign(prob, gd);
                        prob.searchIndex = `${prob.name} ${(prob.tags||[]).join(' ')} ${prob.rating}`.toLowerCase();
                        setSortKeys(prob);
                        (gd.tags||[]).forEach(t => state.allTags.add(t));
                    }
                });
                await new Promise(r => chrome.storage.local.set(updates, r));
                LOG(`Gist sync: pulled down ${pulledDown.length} better classification(s) from gist`);
            }

            await bg({ type:'gist:saveClassifications', token, data: merged });
            LOG(`Gist sync: ${dirty.length} changed key(s), ${Object.keys(merged).length} total in file`);
            if (typeof ui !== 'undefined') {
                ui.flashSaved();
                if (pulledDown.length) { ui.populateFilters(); ui.updateTable(); ui.updateCounter(); }
            }
        } catch(e) { LOG('Gist sync skipped:', e.message); }
    },

    enqueue(newProbs) {
        if (!newProbs || !newProbs.length) return;
        if (this._pausedUntilReload) {
            LOG(`Classification paused until reload; leaving ${newProbs.length} problem(s) unclassified`);
            return;
        }
        let added = 0;
        newProbs.forEach(prob => {
            const pid = String(prob.id);
            if (this._queuedIds.has(pid) || this._activeIds.has(pid) || this._tier2PendingIds.has(pid)) return;
            this._queuedIds.add(pid);
            this._queue.push(prob);
            added++;
        });
        if (!added) return;
        LOG(`Queued ${added} new classification(s); ${this._queue.length} waiting`);
        if (!this._running) this._drain();
    },

    workerCount() {
        return this.hasProvider('mistral') ? CLASSIFICATION_WORKER_CAP : 1;
    },

    scheduleUiFlush(force=false) {
        if (typeof ui === 'undefined') return;
        if (force) { this.flushUi(); return; }
        if (this._uiFlushTimer) return;
        this._uiFlushTimer = setTimeout(() => this.flushUi(), CLASSIFICATION_UI_FLUSH_MS);
    },

    flushUi() {
        if (this._uiFlushTimer) {
            clearTimeout(this._uiFlushTimer);
            this._uiFlushTimer = null;
        }
        if (typeof ui === 'undefined') return;
        ui.populateFilters();
        ui.updateTable();
        ui.updateCounter();
    },

    async completeQueuedClassification(prob, cls, stats, workerId) {
        await this.saveClassification(prob, cls);
        Object.assign(prob, cls);
        upsertProblems([prob]);
        (cls.tags || []).forEach(t => state.allTags.add(t));
        stats.comp++;
        LOG(`[OK w${workerId}] ${prob.name} -> ${cls.rating} [${(cls.tags || []).join(', ')}] via ${cls.classifiedBy} (${this._queue.length} queued)`);
        this.markDirty(prob.id);
        this.requestSync();
        this.scheduleUiFlush();
    },

    handleQueuedClassificationError(e, prob, stats, workerId) {
        if (e.deferClassification) {
            prob.classificationDeferred = true;
            prob.deferReason = e.reason || 'tier2_unavailable';
            prob.tier1_result = e.tier1_result;
            prob.tags = null;
            prob.rating = null;
            upsertProblems([prob]);
            stats.deferred++;
            LOG(`[DEFERRED w${workerId}]: ${prob.name} ${e.message} (${this._queue.length} queued)`);
            this.scheduleUiFlush();
            return true;
        }
        if (e.pauseClassification) {
            this._pausedUntilReload = true;
            this._queue = [];
            this._queuedIds.clear();
            stats.fail++;
            ERR(`[PAUSED w${workerId}]: ${prob.name}`, e.message);
            this.scheduleUiFlush(true);
            return true;
        }
        stats.fail++;
        ERR(`[FAIL w${workerId}]: ${prob.name}`, e.message);
        return true;
    },

    trackTier2PendingSave(prob, promise, stats, workerId) {
        const pid = String(prob.id);
        this._tier2PendingIds.add(pid);
        const job = promise
            .then(cls => this.completeQueuedClassification(prob, cls, stats, workerId))
            .catch(e => this.handleQueuedClassificationError(e, prob, stats, workerId))
            .finally(() => {
                this._tier2PendingSaves.delete(job);
                this._tier2PendingIds.delete(pid);
            });
        this._tier2PendingSaves.add(job);
        LOG(`[T2 QUEUED w${workerId}] ${prob.name} (${this._tier2BatchQueue.length} waiting for Tier 2 batch)`);
    },

    async waitForTier2Pending() {
        while (this._tier2PendingSaves.size) {
            await Promise.allSettled([...this._tier2PendingSaves]);
        }
    },

    async _worker(id, stats) {
        while (!this._pausedUntilReload) {
            const prob = this._queue.shift();
            if (!prob) return;
            const pid = String(prob.id);
            this._queuedIds.delete(pid);
            this._activeIds.add(pid);
            try {
                await this._classifyQueuedProblem(prob, stats, id);
            } finally {
                this._activeIds.delete(pid);
            }
        }
    },

    async _classifyQueuedProblem(prob, stats, workerId) {
        try {
            const cls = await this.classifyProblem(prob, null, false, { queueTier2: true });
            if (cls?.tier2Pending) {
                this.trackTier2PendingSave(prob, cls.promise, stats, workerId);
                return;
            }
            await this.completeQueuedClassification(prob, cls, stats, workerId);
        } catch(e) {
            this.handleQueuedClassificationError(e, prob, stats, workerId);
        }
    },

    async _drain() {
        this._running = true;
        let total = 0;
        const stats = { comp: 0, fail: 0, deferred: 0 };
        while (this._queue.length && !this._pausedUntilReload) {
            const roundTotal = this._queue.length;
            total += roundTotal;
            const workers = Math.min(this.workerCount(), roundTotal);
            LOG(`Starting parallel classification: ${roundTotal} queued, ${workers} worker(s)`);
            await Promise.all(Array.from({ length: workers }, (_, i) => this._worker(i + 1, stats)));
        }
        if (this._tier2BatchQueue.length) {
            LOG(`Tier 1 complete; flushing ${this._tier2BatchQueue.length} leftover Tier 2 classification(s)`);
            this.flushTier2Batch(true);
        }
        await this.waitForTier2Pending();
        this._running = false;
        this.flushUi();
        this.requestSync(0);
        LOG(`Classification complete: ${stats.comp} ok, ${stats.deferred} deferred, ${stats.fail} failed (of ${total} queued this round)`);
        if (this._queue.length && !this._pausedUntilReload) this._drain();
        return;
        /*
        let comp=0, fail=0;
        LOG(`Starting batch classification: ${total} problem(s) queued`);

        while (this._queue.length) {
            const prob = this._queue.shift();
            try {
                const cls = await this.classifyProblem(prob);
                await this.saveClassification(prob, cls);
                Object.assign(prob, cls);
                upsertProblems([prob]);
                cls.tags.forEach(t => state.allTags.add(t));
                comp++;
                LOG(`[OK] ${prob.name} → ${cls.rating} [${cls.tags.join(', ')}] via ${cls.classifiedBy} (${this._queue.length} left)`);
                // Update UI every 2 classifications
                if (comp % 2 === 0 || !this._queue.length) { ui.populateFilters(); ui.updateTable(); ui.updateCounter(); }
                // Mark this result dirty and request a sync immediately — the
                // single-flight mutex in requestSync() means a fast burst of
                // classifications still collapses into the minimum number of
                // actual Gist round-trips rather than firing one every N items.
                this.markDirty(prob.id);
                this.requestSync();
            } catch(e) {
                if (e.deferClassification) {
                    prob.classificationDeferred = true;
                    prob.deferReason = e.reason || 'tier2_unavailable';
                    prob.tier1_result = e.tier1_result;
                    prob.tags = null;
                    prob.rating = null;
                    upsertProblems([prob]);
                    fail++;
                    LOG(`[DEFERRED]: ${prob.name} ${e.message} (${this._queue.length} left)`);
                    if (typeof ui !== 'undefined') { ui.updateTable(); ui.updateCounter(); }
                    continue;
                }
                if (e.pauseClassification) {
                    this._pausedUntilReload = true;
                    this._queue = [];
                    ERR(`[PAUSED]: ${prob.name}`, e.message);
                    if (typeof ui !== 'undefined') { ui.updateTable(); ui.updateCounter(); }
                    break;
                }
                ERR(`[FAIL]: ${prob.name}`, e.message); fail++;
            }
        }

        this._running = false;
        LOG(`Classification complete: ${comp} ok, ${fail} failed (of ${total} queued this round)`);
        // No need to await a "final" sync here — any classification whose
        // requestSync() call landed while another sync was already in flight
        // already scheduled a coalesced follow-up pass that will run (and
        // persist) in the background even after _drain() itself returns.
    },

        */
    },

    async reclassify(pid, sp=null) {
        LOG(`Reclassifying pid=${pid} sp=${sp||'any'}`);
        const prob = state.problems.find(p=>String(p.id)===String(pid));
        if (!prob) { ERR('Problem not found in state:', pid); return; }
        state.reclassifying.add(String(pid)); ui.updateRow(String(pid), true);
        try {
            const cls = await this.classifyProblem(prob, sp, true);
            await this.saveClassification(prob, cls);
            Object.assign(prob, cls);
            prob.searchIndex = `${prob.name} ${(prob.tags||[]).join(' ')} ${prob.rating}`.toLowerCase();
            setSortKeys(prob);
            cls.tags.forEach(t => state.allTags.add(t));
            LOG(`Reclassified: ${prob.name} → ${cls.rating} via ${cls.classifiedBy}`);
            this.markDirty(prob.id);
            this.requestSync();
        } catch(e) {
            if (e.deferClassification) {
                prob.classificationDeferred = true;
                prob.deferReason = e.reason || 'tier2_unavailable';
                prob.tier1_result = e.tier1_result;
                prob.tags = null;
                prob.rating = null;
                upsertProblems([prob]);
                ERR('Reclassify deferred:', e.message);
                alert('Tier 2 was unavailable, so this problem was marked to retry on the next reload.');
            } else if (e.pauseClassification) {
                this._pausedUntilReload = true;
                ERR('Reclassify paused:', e.message);
                alert('Classification paused until the next reload because AI fallback would have been used.');
            } else {
                ERR('Reclassify failed:', e.message);
                alert(`Reclassification failed: ${e.message}`);
            }
        }
        state.reclassifying.delete(String(pid)); ui.updateTable();
    },
};

// ─── Cache ────────────────────────────────────────────────────────────────────

// Classification "quality" ranking, used when merging local vs. Gist data so a
// fallback/heuristic result never silently overwrites a better one already
// shared in the Gist (and vice versa — a better local result still wins).
//   manual   (user explicitly set tags/rating in the UI) — highest, always wins
//   <AI name> (mistral/google/router-compatible results)   — normal
//   fallback / missing                                     — lowest
function classificationTier(cls) {
    const by = cls?.classifiedBy;
    if (by === 'manual') return 2;
    if (!by || by === 'fallback') return 0;
    return 1;
}

// True if `a` should be kept over `b` when merging. Absent/invalid entries
// always lose. Within the same tier, the entry with MORE tags (more
// information) wins; an exact tie prefers `a` (the candidate being written).
function isBetterClassification(a, b) {
    const av = cache.isValid(a), bv = cache.isValid(b);
    if (!av) return false;
    if (!bv) return true;
    const ta = classificationTier(a), tb = classificationTier(b);
    if (ta !== tb) return ta > tb;
    return (a.tags?.length || 0) >= (b.tags?.length || 0);
}

const cache = {
    isValid: d => Array.isArray(d?.tags) && d.tags.length > 0 && typeof d?.rating === 'number' && d.rating >= 800,

    // Fast path: chrome.storage.local only — no network. Called before first render.
    async loadLocal(all) {
        if (!all.length) return { cached: [], uncached: [] };
        const keys = all.map(p=>`nztags_${p.id}`);
        const stored = await new Promise(r => chrome.storage.local.get(keys, r));
        const cached=[], uncached=[];
        all.forEach(p => {
            const d = stored[`nztags_${p.id}`];
            if (d && this.isValid(d)) {
                const mp = { ...p, ...d };
                mp.searchIndex = `${mp.name} ${(mp.tags||[]).join(' ')} ${mp.rating}`.toLowerCase();
                setSortKeys(mp);
                cached.push(mp); d.tags.forEach(t=>state.allTags.add(t));
            } else uncached.push(p);
        });
        LOG(`Local cache: ${cached.length} cached, ${uncached.length} uncached`);
        return { cached, uncached };
    },

    // Slow path: hits the Gist API. Called AFTER the first render so it never
    // blocks initial paint.
    async restoreFromGist(uncached) {
        if (!uncached.length) return { restored: [], stillUncached: uncached };
        try {
            const token = await new Promise(r => chrome.storage.local.get('githubToken', d => r(d.githubToken || '')));
            if (!token) return { restored: [], stillUncached: uncached };
            const gistClasses = await bg({ type:'gist:loadClassifications', token });
            const restored=[], stillUncached=[];
            uncached.forEach(p => {
                const gd = gistClasses[`nztags_${p.id}`];
                if (gd && this.isValid(gd)) {
                    const mp = { ...p, ...gd };
                    mp.searchIndex = `${mp.name} ${(mp.tags||[]).join(' ')} ${mp.rating}`.toLowerCase();
                    setSortKeys(mp);
                    restored.push(mp); gd.tags.forEach(t=>state.allTags.add(t));
                    chrome.storage.local.set({ [`nztags_${p.id}`]: gd });
                } else { stillUncached.push(p); }
            });
            LOG(`Gist restore: ${restored.length} restored, ${stillUncached.length} still need AI`);
            return { restored, stillUncached };
        } catch(e) { LOG('Gist classification restore skipped:', e.message); return { restored: [], stillUncached: uncached }; }
    },

    async clearAll() {
        if (!confirm('Clear all classifications?')) return;
        const all = await new Promise(r=>chrome.storage.local.get(null,r));
        const keys = Object.keys(all).filter(k=>k.startsWith('nztags_'));
        await new Promise(r=>chrome.storage.local.remove(keys,r));
        LOG('Cleared', keys.length, 'classifications');
        location.reload();
    },

    async refreshAll() {
        if (!confirm('Re-classify all problems?')) return;
        const all = await new Promise(r=>chrome.storage.local.get(null,r));
        const keys = Object.keys(all).filter(k=>k.startsWith('nztags_'));
        await new Promise(r=>chrome.storage.local.remove(keys,r));
        try {
            const token = await new Promise(r => chrome.storage.local.get('githubToken', d => r(d.githubToken || '')));
            if (token) await bg({ type:'gist:saveClassifications', token, data: {} });
        } catch(e) {
            LOG('Gist classification clear skipped:', e.message);
        }
        location.reload();
    },
};

// ─── Scrapers ─────────────────────────────────────────────────────────────────

const scrapers = {
    nzoiUrl(href) {
        try { return new URL(href || '/', 'https://train.nzoi.org.nz').href; }
        catch { return 'https://train.nzoi.org.nz/'; }
    },

    getMyGroups() {
        const g=[];
        const seen = new Set();
        const addGroup = l => {
            if(!l || !l.length) return;
            const href = this.nzoiUrl(l.attr('href'));
            if(seen.has(href)) return;
            seen.add(href);
            g.push({name:l.text().trim(),href});
        };
        $('h2').filter((_, h) => /My Groups/i.test($(h).text())).first().nextAll('div').each((_, div)=>{
            const l=$(div).find('a[href*="/groups/"]').first();
            addGroup(l);
        });
        if (g.length < 2) $('a[href*="/groups/"]').each((_, a) => addGroup($(a)));
        g.sort((a,b)=>a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
        LOG('Groups:', g.map(x=>x.name));
        return g;
    },

    getUpcomingContests() {
        const c=[];
        $('h2:contains("Upcoming and Current Contests")').next('table').find('tbody tr').each(function(){
            const cells=$(this).find('td');
            if(cells.length>=6) c.push({title:$(cells[0]).text().trim(),startTime:$(cells[1]).text().trim(),endTime:$(cells[2]).text().trim(),href:$(cells[5]).find('a').attr('href')});
        });
        c.sort((a,b)=>a.title.localeCompare(b.title, undefined, {sensitivity:'base'}));
        return c;
    },

    // Shared extraction logic. Pushes newly-seen problems (deduped via
    // state.seenIds) from any /problems/N link. If the link lives in a table row
    // we also read the progress cell; otherwise it still appears as a problem.
    procDOM(doc, gn, into) {
        if (!doc) return;
        doc.querySelectorAll('a[href*="/problems/"]').forEach(lnk=>{
            if(!lnk) return;
            const href=this.nzoiUrl(lnk.getAttribute('href'));
            const id=(href.match(/\/problems\/(\d+)/)||[])[1];
            if(!id||!/^\d+$/.test(id)||state.seenIds.has(id)) return;
            state.seenIds.add(id);
            const row=lnk.closest('tr'), cells=row?.children || [];
            const name=lnk.textContent.trim(), progTxt=cells[1]?.textContent.trim()||'';
            let prog=0;
            if(progTxt.includes('%')) prog=parseInt(progTxt)||0;
            else if(progTxt.includes('/')) { const[s,t]=progTxt.split('/').map(Number); if(!isNaN(s)&&!isNaN(t)&&t>0) prog=Math.round(s/t*100); }
            into.push({id,name,href,group:gn,progress:prog});
        });
    },

    // SYNCHRONOUS, no fetch — every "Public Problems" subtable is already
    // present in the home page's DOM (hidden behind a "Show" toggle), so this
    // gives us a full first paint instantly.
    getOwnPageProblems() {
        const all=[];
        $('.subheading').each((_, el) => {
            const raw = $(el).find('td:first').text().trim();
            const gn = raw.replace(/\(\d+\s*problems?\)\s*$/i, '').trim() || 'Public';
            const holder = $(el).next('tr').find('[id]').first()[0] || $(el).next('tr')[0];
            this.procDOM(holder, gn, all);
        });
        // Fallback for differently-themed pages with no .subheading rows
        if (!all.length) this.procDOM(document, 'Public', all);
        LOG(`Own-page problems: ${all.length}`);
        return all;
    },

    // ASYNC, one network round-trip per "My Groups" entry — runs in the
    // background AFTER the first render so it never blocks initial paint.
    async getGroupPageProblems(g) {
        const all=[];
        try {
            const r = await fetch(this.nzoiUrl(g.href), { credentials:'include', cache:'no-store' });
            const text = await r.text();
            if (!r.ok) throw new Error('HTTP ' + r.status);
            this.procDOM(new DOMParser().parseFromString(text,'text/html'), g.name, all);
            LOG(`Group ${g.name}: ${all.length} problems`);
        } catch(e){ ERR('Group fetch failed:', g.name, e.message); }
        return all;
    },
};

function injectDashboardStyles() {
    if (document.getElementById('nzoi-dash-styles')) return;
    const s = document.createElement('style');
    s.id = 'nzoi-dash-styles';
    s.textContent = `
/* ── NZOI Enhanced Dashboard v10.0 ── */
:root{
  --bgp:#0d1117;--bgs:#161b22;--bgt:#21262d;--bgh:#30363d;
  --tp:#f0f6fc;--ts:#8b949e;--tt:#6e7681;
  --ab:#58a6ff;--ar:#f85149;
  --ar-tint:rgba(248,81,73,.08);
  --bp:#30363d;
  --faint:rgba(255,255,255,.06);
  --sm:0 4px 12px rgba(0,0,0,.25);--sl:0 16px 40px rgba(0,0,0,.4);
  --rsm:6px;--rmd:10px;--rlg:14px;
  --nzoi-green:#2d9d78;--nzoi-green-dk:#1e6b52;
}
/* Light theme — toggled via data-theme="light" on <html>, persisted in
   chrome.storage.local under 'theme'. Every color elsewhere in this sheet
   routes through these tokens, so this block is the only thing that needs to
   change to re-skin the whole dashboard. */
:root[data-theme="light"]{
  --bgp:#ffffff;--bgs:#f6f8fa;--bgt:#eaeef2;--bgh:#d0d7de;
  --tp:#1f2328;--ts:#57606a;--tt:#6e7781;
  --ab:#0969da;--ar:#cf222e;
  --ar-tint:rgba(207,34,46,.08);
  --bp:#d0d7de;
  --faint:rgba(31,35,40,.07);
  --sm:0 1px 3px rgba(31,35,40,.10),0 1px 2px rgba(31,35,40,.06);
  --sl:0 12px 28px rgba(140,149,159,.35);
  --nzoi-green:#1a8f68;--nzoi-green-dk:#136b4d;
}
*{box-sizing:border-box;margin:0;padding:0}
body,html{
  background:var(--bgp)!important;color:var(--tp)!important;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif!important;
  font-size:14px;line-height:1.5;height:100%;max-height:100dvh;overflow:hidden;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
/* ── Layout ── */
#main-container{
  position:relative!important;z-index:1!important;
  width:100%!important;height:calc(100dvh - var(--nzoi-dashboard-top, 0px) - 8px)!important;max-height:calc(100dvh - var(--nzoi-dashboard-top, 0px) - 8px)!important;
  margin:0!important;padding:0!important;display:flex;background:var(--bgp);overflow:hidden;
}
.dbl{display:flex;width:100%;height:100%;gap:14px;padding:14px;min-height:0}
.dbm{flex:1;display:flex;flex-direction:column;background:var(--bgs);border-radius:var(--rmd);border:1px solid var(--bp);box-shadow:var(--sm);overflow:hidden;min-width:0}

/* ── Header ── */
.dbh{background:var(--bgs);border-bottom:1px solid var(--bp);padding:14px 18px 12px;flex-shrink:0}
.dbht{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px}
.dbtitle{font-size:20px;font-weight:700;color:var(--tp);letter-spacing:-.03em;display:flex;align-items:center;gap:10px}
.dbtitle::before{
  content:'';display:inline-block;width:8px;height:8px;border-radius:50%;
  background:var(--nzoi-green);box-shadow:0 0 8px var(--nzoi-green);flex-shrink:0;
}

/* ── Status bar ── */
.cst{display:flex;align-items:center;gap:8px}
.csc{
  font-size:11px;color:var(--tt);font-variant-numeric:tabular-nums;
  background:var(--bgp);border:1px solid var(--bp);padding:3px 10px;
  border-radius:20px;letter-spacing:.02em;
}
.csa{display:flex;align-items:center;gap:4px}
.csa-div{width:1px;height:18px;background:var(--bp);margin:0 2px;flex-shrink:0}
.abt{
  display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;background:transparent;border:1px solid var(--bp);
  border-radius:var(--rsm);color:var(--tt);cursor:pointer;transition:all .2s;
}
.abt:hover{background:var(--bgh);color:var(--ts);border-color:var(--ts)}
.abt.danger:hover{border-color:var(--ar);color:var(--ar);background:var(--ar-tint)}
.abt.flt-btn--active{border-color:var(--nzoi-green);color:var(--nzoi-green);background:rgba(45,157,120,.1)}
.abt svg{width:13px;height:13px}

/* ── Hidden-tags placeholder chip ── */
.tb2.tag-hidden{cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-style:italic;transition:all .15s}
.tb2.tag-hidden:hover{background:var(--bgh);color:var(--tp)}
.tb2.tag-hidden svg{width:11px;height:11px;flex-shrink:0}

/* ── Filter bar ── */
.flt{display:flex;align-items:center;gap:6px;flex-wrap:wrap;position:relative}
.flt-btn{
  display:flex;align-items:center;gap:4px;padding:6px 11px;
  background:var(--bgp);border:1px solid var(--bp);border-radius:20px;
  color:var(--ts);font-size:12px;font-weight:500;cursor:pointer;
  transition:all .18s;user-select:none;white-space:nowrap;
}
.flt-btn:hover{border-color:var(--ts);color:var(--tp)}
.flt-btn--active{border-color:var(--ab);color:var(--ab);background:rgba(88,166,255,.08)}
.flt-ct{color:var(--ab);font-weight:600;font-size:11px}
.flt-clear{
  padding:5px 10px;border-radius:20px;border:1px solid rgba(248,81,73,.3);
  background:transparent;color:var(--ar);font-size:11px;font-weight:500;
  cursor:pointer;transition:all .18s;
}
.flt-clear:hover{background:var(--ar-tint);border-color:var(--ar)}

/* ── Multi-select dropdown panel ── */
.flt-panel{
  position:fixed;z-index:9999;
  background:var(--bgt);border:1px solid var(--bp);border-radius:var(--rmd);
  box-shadow:var(--sl);padding:6px;min-width:180px;max-height:280px;
  overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--bp) transparent;
  display:none;animation:fi .15s ease;
}
.flt-panel.open{display:block}
.flt-panel::-webkit-scrollbar{width:5px}
.flt-panel::-webkit-scrollbar-thumb{background:var(--bp);border-radius:3px}
.flt-opt{
  display:flex;align-items:center;gap:8px;padding:7px 10px;
  border-radius:var(--rsm);cursor:pointer;font-size:13px;
  color:var(--ts);transition:background .12s;
}
.flt-opt:hover{background:var(--bgh);color:var(--tp)}
.flt-opt input[type=checkbox],.to input[type=checkbox]{
  appearance:none;width:14px;height:14px;border:1px solid var(--bp);
  border-radius:4px;background:var(--bgt);cursor:pointer;flex-shrink:0;
  display:inline-grid;place-content:center;transition:background .15s,border-color .15s;
}
.flt-opt input[type=checkbox]:checked,.to input[type=checkbox]:checked{background:var(--nzoi-green);border-color:var(--nzoi-green)}
.flt-opt input[type=checkbox]:checked::after,.to input[type=checkbox]:checked::after{
  content:'';width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg);margin-top:-2px;
}

/* ── Sort badges on column headers ── */
.sth{cursor:pointer;user-select:none;white-space:nowrap;position:relative}
.sth:hover{color:var(--ts)}.sth.act{color:var(--tp)}
.sort-badges{display:inline-flex;align-items:center;gap:2px;margin-left:4px;vertical-align:middle}
.sort-badge-pri{font-size:10px;color:var(--ab)}
.sort-badge-sec{font-size:9px;color:var(--tt);opacity:.7}
.sort-badge-sec sup{font-size:7px}

/* ── Search + Filters bar ── */
.dbct{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}
.sw{flex:1;min-width:180px;position:relative}
.si{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--tt);pointer-events:none}
#db-search{
  width:100%;padding:8px 12px 8px 34px;
  background:var(--bgp);border:1px solid var(--bp);
  border-radius:var(--rsm);color:var(--tp);font-size:13px;
  transition:border-color .2s,box-shadow .2s;
}
#db-search:focus{outline:none;border-color:var(--ab);box-shadow:0 0 0 3px rgba(88,166,255,.1)}
#db-search::placeholder{color:var(--tt)}

.tbs{flex:1;display:flex;flex-direction:column;overflow:hidden}
.tbw{flex:1;overflow-y:auto;min-height:0;padding:0 18px 12px}
.tbw::-webkit-scrollbar{width:7px}
.tbw::-webkit-scrollbar-thumb{background:var(--bp);border-radius:4px}
.tbw::-webkit-scrollbar-track{background:transparent}

/* ── Table ── */
.pt{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
.pt th{width:18%}.pt th:first-child{width:24%}.pt th:nth-child(5){width:16%}.pt th:last-child{width:11%}
.pt thead{position:sticky;top:0;z-index:10;background:var(--bgs)}
.pt thead::after{content:'';display:block;height:1px;background:var(--bp);position:absolute;bottom:0;left:0;right:0}
.pt th{
  background:transparent;color:var(--tt);padding:10px 14px;text-align:left;
  font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.6px;
  border:none;border-bottom:1px solid var(--bp);white-space:nowrap;
}

/* ── Table rows ── */
.pr{transition:background .12s;border-bottom:1px solid rgba(48,54,61,.6);height:72px}
.pr:hover{background:rgba(88,166,255,.08)}
.pt .pr:hover td{background:transparent!important}
.pr.unclassified-row{opacity:.7}
.pr td{padding:10px 14px;border:none;color:var(--ts);vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pn,.pl{color:var(--tp)!important;font-weight:500;text-decoration:none!important;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl{transition:color .15s}.pl:hover{color:var(--ab)!important}

/* ── Progress bar ── */
.pgw{display:flex;align-items:center;gap:8px}
.pgb{flex:1;height:4px;background:var(--faint);border-radius:2px;overflow:hidden}
.pgf{height:100%;border-radius:2px;transition:width .4s ease}
.pgt{font-size:11px;color:var(--tt);min-width:28px;text-align:right;font-variant-numeric:tabular-nums}

/* ── Group badge + Tags ── */
.gb{
  display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:500;
  background:rgba(88,166,255,.08);color:var(--ab);border:1px solid rgba(88,166,255,.2);
  white-space:nowrap;flex-shrink:0;max-width:130px;overflow:hidden;text-overflow:ellipsis;
}
.tb2{
  display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:500;
  background:var(--bgh);color:var(--ts);border:1px solid var(--bp);
  white-space:nowrap;flex-shrink:0;
}
.tb2.unclassified-tag{
  background:rgba(210,153,34,.06);color:rgba(210,153,34,.5);
  border-color:rgba(210,153,34,.15);font-style:italic;
}
.tw,.gw{display:flex;flex-wrap:nowrap;align-items:center;gap:4px;overflow:hidden;min-width:0}
.tag-cell{display:flex;flex-direction:column;gap:3px;min-width:0;overflow:hidden}
.rsum{font-size:10px;line-height:1.2;color:var(--tt);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.tag-scroll{
  flex:1;min-width:0;display:flex;align-items:center;gap:4px;overflow-x:auto;overflow-y:hidden;
  scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:var(--bp) transparent;
  -webkit-mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 18px),transparent);
  mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 18px),transparent);
}
.tag-scroll::-webkit-scrollbar{height:4px}
.tag-scroll::-webkit-scrollbar-track{background:transparent}
.tag-scroll::-webkit-scrollbar-thumb{background:var(--bp);border-radius:999px}

/* Virtualized list spacer rows — keep total scroll height correct while only
   rows near the viewport are actually in the DOM (see ui.renderVirtual). */
.vsp{border:none!important}
.vsp td{border:none!important}

/* ── Edit button ── */
.ebt{
  display:inline-flex;align-items:center;justify-content:center;
  width:20px;height:20px;background:transparent;border:none;
  border-radius:4px;color:transparent;cursor:pointer;transition:all .15s;
  padding:0;flex-shrink:0;margin-left:2px;
}
.tw:hover .ebt,.gw:hover .ebt,.pr:hover .ebt,.dfw:hover .ebt{color:var(--tt)}
.ebt:hover{background:var(--bgh);color:var(--ab)!important}
.ebt svg{width:11px;height:11px}

/* ── Difficulty stars ── */
.dfw{display:flex;align-items:center;gap:5px;font-weight:600}
.dfs{font-size:13px}.dfr{font-size:11px;color:var(--tt);font-variant-numeric:tabular-nums}
.clby{font-size:10px;color:var(--tt);margin-top:1px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.class-meta{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--tt);margin-top:1px;min-width:0;white-space:nowrap}
.class-meta span{overflow:hidden;text-overflow:ellipsis}
.esc{color:var(--ab)}
.esc.no{color:var(--tt)}

/* ── Actions ── */
.acc{text-align:center}.acb{display:flex;align-items:center;justify-content:center;gap:6px}
.rcb,.pvb{
  display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;background:transparent;border:1px solid var(--bp);
  border-radius:var(--rsm);color:var(--tt);cursor:pointer;transition:all .2s;padding:0;
}
.rcb:hover{background:var(--bgt);border-color:var(--nzoi-green);color:var(--nzoi-green)}
.pvb:hover{background:var(--bgt);border-color:var(--ts);color:var(--ts)}
.rcb svg,.pvb svg{width:13px;height:13px}

/* ── Provider menu ── */
.pvw{position:relative}
.pvm{
  position:fixed;background:var(--bgt);border:1px solid var(--bp);
  border-radius:var(--rsm);box-shadow:var(--sl);min-width:160px;
  max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;
  z-index:2147483647;opacity:0;transform:translateY(-6px) scale(.97);
  pointer-events:none;transition:opacity .18s ease,transform .18s ease;
}
.pvm.show{opacity:1;transform:translateY(0) scale(1);pointer-events:all}
.pvo{
  display:block;width:100%;padding:9px 14px;background:transparent;
  border:none;color:var(--tp);text-align:left;font-size:13px;cursor:pointer;
  transition:background .15s;border-bottom:1px solid rgba(48,54,61,.6);
}
.pvo:last-child{border-bottom:none}
.pvo:hover{background:var(--bgh);color:var(--ab)}

/* ── Spinner ── */
.rspin{display:flex;align-items:center;justify-content:center;gap:6px;color:var(--ab);font-size:11px}
.sp{width:15px;height:15px;animation:spin 1s linear infinite}
.sp circle{stroke-dasharray:50;stroke-dashoffset:25;animation:sd 1.5s ease-in-out infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes sd{
  0%{stroke-dasharray:1,150;stroke-dashoffset:0}
  50%{stroke-dasharray:90,150;stroke-dashoffset:-35}
  100%{stroke-dasharray:90,150;stroke-dashoffset:-124}
}
.empty-r td{text-align:center;color:var(--tt);padding:48px;font-size:13px}

/* ── Sidebar ── */
.dash-sidebar{width:252px;display:flex;flex-direction:column;gap:12px;height:100%;flex-shrink:0}
.sc{
  flex:1;min-height:0;display:flex;flex-direction:column;
  background:var(--bgs);border-radius:var(--rmd);
  border:1px solid var(--bp);box-shadow:var(--sm);overflow:hidden;
}
.ch{
  display:flex;align-items:center;gap:8px;padding:11px 14px;
  border-bottom:1px solid var(--bp);background:var(--bgs);flex-shrink:0;
}
.ch h2{margin:0;font-size:13px;font-weight:600;color:var(--tp);letter-spacing:.01em}
.ci{width:14px;height:14px;color:var(--nzoi-green);flex-shrink:0}
.cb{
  flex:1;min-height:0;overflow-y:auto;padding:6px;
  display:flex;flex-direction:column;gap:2px;
}
.cb::-webkit-scrollbar{width:6px}
.cb::-webkit-scrollbar-thumb{background:var(--bp);border-radius:3px}
.si3{
  display:flex;align-items:center;justify-content:space-between;
  padding:7px 10px;border-radius:var(--rsm);color:var(--ts)!important;
  text-decoration:none!important;transition:all .18s;
  border:1px solid transparent;font-size:13px;
}
.si3:hover{background:var(--bgh);border-color:var(--bp);color:var(--tp)!important}
.it{flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ia{width:13px;height:13px;color:var(--tt);transition:transform .18s;flex-shrink:0}
.si3:hover .ia{transform:translateX(2px);color:var(--ab)}
.ci2{flex-direction:column;align-items:flex-start}
.cit{font-weight:600;margin-bottom:3px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;color:var(--tp)}
.citi{font-size:11px;color:var(--tt)}
.emp{text-align:center;color:var(--tt);padding:18px;font-size:12px;line-height:1.6}

/* ── Modals ── */
.mo{
  position:fixed;inset:0;background:rgba(0,0,0,.8);
  display:flex;align-items:center;justify-content:center;
  z-index:10000;animation:fi .18s ease;
}
@keyframes fi{from{opacity:0}to{opacity:1}}
.mb{
  background:var(--bgs);border:1px solid var(--bp);border-radius:var(--rlg);
  box-shadow:var(--sl);max-width:580px;width:90%;max-height:82vh;
  display:flex;flex-direction:column;animation:su .25s ease;
}
.mb-sm{max-width:420px}
@keyframes su{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.mh{
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 18px;border-bottom:1px solid var(--bp);
}
.mh h3{margin:0;font-size:16px;font-weight:600;color:var(--tp)}
.mc{
  background:transparent;border:none;color:var(--tt);font-size:20px;
  cursor:pointer;padding:0;width:26px;height:26px;
  display:flex;align-items:center;justify-content:center;border-radius:4px;
  transition:all .15s;line-height:1;
}
.mc:hover{background:var(--bgh);color:var(--tp)}
.mbd{padding:18px;overflow-y:auto;flex:1}
.mft{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid var(--bp)}
.mbt{padding:8px 16px;border-radius:var(--rsm);font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all .15s}
.mbs{background:var(--bgp);color:var(--tp);border-color:var(--bp)}.mbs:hover{background:var(--bgh)}
.mbp{background:var(--nzoi-green);color:#fff}.mbp:hover{background:var(--nzoi-green-dk)}

/* ── Tag grid ── */
.tg{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:8px}
.to{
  display:flex;align-items:center;gap:8px;padding:9px 12px;
  background:var(--bgp);border:1px solid var(--bp);border-radius:var(--rsm);
  cursor:pointer;transition:all .18s;user-select:none;
}
.to:hover{background:var(--bgh);border-color:var(--ts)}
.to.sel{background:rgba(45,157,120,.1);border-color:var(--nzoi-green)}
.to input{margin:0;cursor:pointer;accent-color:var(--nzoi-green)}
.to span{color:var(--tp);font-size:13px}

/* ── Rating editor ── */
.re{display:flex;flex-direction:column;gap:12px}
.re label{color:var(--tp);font-weight:500;font-size:14px}
.re input[type=number]{
  padding:10px 12px;background:var(--bgp);border:1px solid var(--bp);
  border-radius:var(--rsm);color:var(--tp);font-size:16px;font-weight:600;width:100%;
  transition:border-color .2s;
}
.re input[type=number]:focus{outline:none;border-color:var(--nzoi-green);box-shadow:0 0 0 3px rgba(45,157,120,.15)}
.rg{display:flex;flex-direction:column;gap:6px;padding:12px;background:var(--bgp);border-radius:var(--rsm);border:1px solid var(--bp)}
.gi{display:flex;gap:8px;font-size:13px}
.gr{color:var(--nzoi-green);font-weight:600;min-width:90px}
.gd{color:var(--ts)}

/* ── Hide original title box ── */
#main-page-title-box{display:none!important}`;
    document.head.appendChild(s);
}


// ─── UI ───────────────────────────────────────────────────────────────────────

const ui = {
    init(tot) {
        injectDashboardStyles();
        const mg=scrapers.getMyGroups(), con=scrapers.getUpcomingContests();
        $('#main-container').html(this.getHTML(mg,con,tot));
        this.attachHandlers(); this.populateFilters();
    },

    // Icon shows the mode a click would switch TO (sun while dark = "go light",
    // moon while light = "go dark") — the convention used by GitHub/VSCode.
    themeIcon() {
        return state.theme === 'dark'
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    },
    eyeIcon() {
        return state.hideTags
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    },

    getHTML(grps, cons, tot) {
        const gh = grps.length ? grps.map(g=>`<a href="${g.href}" class="si3"><span class="it">${esc(g.name)}</span><svg class="ia" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></a>`).join('') : '<div class="emp">No groups found</div>';
        const ch = cons.length ? cons.map(c=>`<a href="${c.href||'#'}" class="si3 ci2"><div class="cit">${esc(c.title)}</div><div class="citi">${c.startTime} — ${c.endTime}</div></a>`).join('') : '<div class="emp">No upcoming contests</div>';
        return `<div class="dbl">
<div class="dbm">
<header class="dbh">
<div class="dbht">
<div style="display:flex;align-items:center;gap:12px">
<h1 class="dbtitle">Problems</h1>
<div class="cst"><span class="csc"><span id="cached-count">0</span>/<span id="total-count">${tot}</span> classified</span>
<div class="csa">
<button id="theme-toggle" class="abt" title="Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme">${this.themeIcon()}</button>
<button id="hide-tags-toggle" class="abt${state.hideTags ? ' flt-btn--active' : ''}" title="${state.hideTags ? 'Show tags' : 'Hide tags'}">${this.eyeIcon()}</button>
<span class="csa-div"></span>
<button id="refresh-cache" class="abt" title="Re-classify all"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button>
<button id="clear-cache" class="abt danger" title="Clear cache"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
</div></div></div></div>
<div class="dbct">
<div class="sw"><svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input id="db-search" placeholder="Search problems, tags, ratings…" autocomplete="off"></div>
<div class="flt" id="flt-bar">
<div class="flt-btn" id="flt-tag-btn">Tags<span class="flt-ct" id="flt-tag-ct"></span></div>
<div class="flt-btn" id="flt-diff-btn">Difficulty<span class="flt-ct" id="flt-diff-ct"></span></div>
<div class="flt-btn" id="flt-grp-btn">Group<span class="flt-ct" id="flt-grp-ct"></span></div>
<button class="flt-clear" id="flt-clear" style="display:none">✕ Clear</button>
</div>
</div>
<!-- Multi-select dropdown panels (portal-positioned to #main-container) -->
<div class="flt-panel" id="flt-panel-tags" data-dim="tags"></div>
<div class="flt-panel" id="flt-panel-diffs" data-dim="diffs">
  <label class="flt-opt"><input type="checkbox" value="1"> ★ Very Easy (&lt;1000)</label>
  <label class="flt-opt"><input type="checkbox" value="2"> ★★ Easy (1000-1399)</label>
  <label class="flt-opt"><input type="checkbox" value="3"> ★★★ Medium (1400-1799)</label>
  <label class="flt-opt"><input type="checkbox" value="4"> ★★★★ Hard (1800-2099)</label>
  <label class="flt-opt"><input type="checkbox" value="5"> ★★★★★ Expert (2100+)</label>
</div>
<div class="flt-panel" id="flt-panel-groups" data-dim="groups"></div>
</header>
<div class="tbs"><div class="tbw">
<table class="pt"><thead><tr>
<th id="th-name" class="sth" data-col="name"><span>Problem</span><span class="sort-badges" data-col="name"></span></th>
<th id="th-progress" class="sth" data-col="progress"><span>Progress</span><span class="sort-badges" data-col="progress"></span></th>
<th id="th-group" class="sth" data-col="group"><span>Group</span><span class="sort-badges" data-col="group"></span></th>
<th id="th-tags" class="sth" data-col="tags"><span>Tags</span><span class="sort-badges" data-col="tags"></span></th>
<th id="th-rating" class="sth" data-col="rating"><span>Difficulty</span><span class="sort-badges" data-col="rating"></span></th>
<th class="acc"><span>Actions</span></th>
</tr></thead><tbody id="prob-tbody"></tbody></table>
</div></div></div>
<aside class="dash-sidebar">
<div class="sc"><div class="ch"><svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><h2>My Groups</h2></div><div class="cb">${gh}</div></div>
<div class="sc"><div class="ch"><svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg><h2>Upcoming Contests</h2></div><div class="cb">${ch}</div></div>
</aside></div>`;
    },

    attachHandlers() {
        const wrap  = document.querySelector('.tbw');
        const tbody = document.getElementById('prob-tbody');

        $('#refresh-cache').on('click', () => cache.refreshAll());
        $('#clear-cache').on('click',   () => cache.clearAll());

        // ── Theme toggle ──────────────────────────────────────────────────────
        $('#theme-toggle').on('click', () => {
            state.theme = state.theme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', state.theme);
            chrome.storage.local.set({ theme: state.theme });
            const btn = document.getElementById('theme-toggle');
            if (btn) { btn.innerHTML = this.themeIcon(); btn.title = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`; }
        });

        // ── Hide tags toggle ──────────────────────────────────────────────────
        // Some competitive programmers consider visible tags a spoiler — they
        // give away the intended approach before the problem's been attempted.
        // This swaps every tag cell for a neutral "Hidden" placeholder; the
        // underlying data (and tag-based filtering) is unaffected.
        $('#hide-tags-toggle').on('click', () => {
            state.hideTags = !state.hideTags;
            if (state.hideTags) state.revealedTagRows.clear();
            chrome.storage.local.set({ dashboardHideTags: state.hideTags });
            const btn = document.getElementById('hide-tags-toggle');
            if (btn) {
                btn.innerHTML = this.eyeIcon();
                btn.title = state.hideTags ? 'Show tags' : 'Hide tags';
                btn.classList.toggle('flt-btn--active', state.hideTags);
            }
            this.renderVirtual();
        });

        const resetScroll = () => { if (wrap) wrap.scrollTop = 0; };

        // ── Search ────────────────────────────────────────────────────────────
        const dbu = debounce(() => {
            state.filters.search = ($('#db-search').val() || '').toLowerCase().trim();
            resetScroll(); this.updateTable();
        }, 280);
        $('#db-search').on('input', dbu);

        // ── Multi-select filter panels ─────────────────────────────────────────
        // Each button toggles a floating panel anchored below it. Checkboxes
        // inside each panel set state.filters.<dim> (a Set). OR within each
        // dimension, AND across dimensions — standard faceted-filter behaviour
        // used by GitHub/Linear/Notion search/filter bars.

        const closePanels = () => document.querySelectorAll('.flt-panel').forEach(p => p.classList.remove('open'));

        const positionPanel = (panel, btn) => {
            const r = btn.getBoundingClientRect();
            const container = document.getElementById('main-container');
            const cr = container.getBoundingClientRect();
            panel.style.left = (r.left - cr.left) + 'px';
            panel.style.top  = (r.bottom - cr.top + 4) + 'px';
            panel.style.minWidth = Math.max(r.width, 200) + 'px';
        };

        [
            { btn: '#flt-tag-btn',  panel: '#flt-panel-tags',   dim: 'tags' },
            { btn: '#flt-diff-btn', panel: '#flt-panel-diffs',  dim: 'diffs' },
            { btn: '#flt-grp-btn',  panel: '#flt-panel-groups', dim: 'groups' },
        ].forEach(({ btn, panel, dim }) => {
            $(btn).on('click', (e) => {
                e.stopPropagation();
                const p = document.querySelector(panel);
                const b = document.querySelector(btn);
                const wasOpen = p.classList.contains('open');
                closePanels();
                if (!wasOpen) { positionPanel(p, b); p.classList.add('open'); }
            });

            // Checkbox changes update the filter Set and re-render immediately
            $(panel).on('change', 'input[type=checkbox]', () => {
                const checked = new Set([...document.querySelectorAll(panel + ' input:checked')].map(i => i.value));
                state.filters[dim] = checked;
                this._updateFilterBadge(dim);
                resetScroll(); this.updateTable();
            });
        });

        // Clear-all button
        $('#flt-clear').on('click', () => {
            ['tags','groups','diffs'].forEach(d => {
                state.filters[d] = new Set();
                document.querySelectorAll(`#flt-panel-${d} input`).forEach(i => i.checked = false);
            });
            this._updateFilterBadge('tags');
            this._updateFilterBadge('diffs');
            this._updateFilterBadge('groups');
            resetScroll(); this.updateTable();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.flt-btn, .flt-panel')) closePanels();
        });

        // Column header sort
        ['name','progress','group','tags','rating'].forEach(col => {
            $(`#th-${col}`).on('click', () => {
                const wasPrimary = state.sorts[0]?.column === col;
                state.sorts = [{ column: col, ascending: wasPrimary ? !state.sorts[0].ascending : col !== 'rating' }];
                this._updateSortIndicators();
                resetScroll(); this.updateTable();
            });
        });

        // ── Delegated click handler on tbody ──────────────────────────────────
        if (tbody) tbody.addEventListener('click', async (e) => {
            const rcb = e.target.closest('.rcb');
            if (rcb) { e.stopPropagation(); await classifier.reclassify(rcb.dataset.pid); return; }
            const hiddenTag = e.target.closest('.tag-hidden');
            if (hiddenTag) { e.stopPropagation(); state.revealedTagRows.add(hiddenTag.dataset.pid); this.renderVirtual(); return; }
            const tagTrigger = e.target.closest('.et');
            if (tagTrigger) { e.stopPropagation(); this.showTagEditor(tagTrigger.dataset.pid); return; }
            const er = e.target.closest('.er');
            if (er) { e.stopPropagation(); this.showRatingEditor(er.dataset.pid); return; }
            const pvb = e.target.closest('.pvb');
            if (pvb) {
                e.stopPropagation(); e.preventDefault();
                const pid = pvb.dataset.pid;
                const menu = document.querySelector(`.pvm[data-pid="${pid}"]`);
                const wasOpen = menu?.classList.contains('show');
                document.querySelectorAll('.pvm').forEach(m => m.classList.remove('show'));
                if (wasOpen || !menu) return;
                const r = pvb.getBoundingClientRect();
                const gap = 6;
                const mw = Math.max(160, menu.offsetWidth || 160);
                const mh = Math.max(40, menu.offsetHeight || 40);
                let top = r.bottom + gap, left = r.right - mw;
                if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
                if (left < 8) left = 8;
                if (top + mh > window.innerHeight - 8) top = r.top - mh - gap;
                if (top < 8) top = 8;
                menu.style.top = top + 'px'; menu.style.left = left + 'px';
                menu.classList.add('show');
                return;
            }
            const pvo = e.target.closest('.pvo');
            if (pvo) {
                e.stopPropagation();
                document.querySelectorAll('.pvm').forEach(m => m.classList.remove('show'));
                await classifier.reclassify(pvo.dataset.pid, pvo.dataset.pv);
            }
        });

        if (tbody) tbody.addEventListener('wheel', (e) => {
            const scroller = e.target.closest('.tag-scroll');
            if (!scroller || scroller.scrollWidth <= scroller.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            scroller.scrollLeft += e.deltaY;
            e.preventDefault();
        }, { passive: false });

        $(document).on('click', e => {
            if (!$(e.target).closest('.pvw,.pvb').length) document.querySelectorAll('.pvm').forEach(m => m.classList.remove('show'));
        });

        if (wrap) {
            let raf = null;
            wrap.addEventListener('scroll', () => {
                if (raf) return;
                raf = requestAnimationFrame(() => { raf = null; this.renderVirtual(); });
            }, { passive: true });
            if (window.ResizeObserver) new ResizeObserver(() => this.renderVirtual()).observe(wrap);
        }

        // Set initial sort indicators
        this._updateSortIndicators();
    },

    // Update sort indicator badges on column headers
    _updateSortIndicators() {
        document.querySelectorAll('.sth').forEach(th => {
            const col = th.dataset.col;
            const badge = th.querySelector('.sort-badges');
            if (!badge) return;
            th.classList.remove('act', 'asc', 'desc');
            badge.innerHTML = '';
        });
        state.sorts.forEach((s, i) => {
            const th = document.querySelector(`[data-col="${s.column}"]`);
            if (!th) return;
            if (i === 0) th.classList.add('act', s.ascending ? 'asc' : 'desc');
            const badge = th.querySelector('.sort-badges');
            if (!badge) return;
            const arrow = s.ascending ? '▲' : '▼';
            badge.insertAdjacentHTML('beforeend',
                `<span class="sort-badge sort-badge-${i === 0 ? 'pri' : 'sec'}">${arrow}${i > 0 ? '<sup>2</sup>' : ''}</span>`
            );
        });
    },

    // Update the active-count badge on a filter button
    _updateFilterBadge(dim) {
        const ctMap = { tags: 'flt-tag-ct', diffs: 'flt-diff-ct', groups: 'flt-grp-ct' };
        const btnMap = { tags: 'flt-tag-btn', diffs: 'flt-diff-btn', groups: 'flt-grp-btn' };
        const size = state.filters[dim]?.size || 0;
        const ct = document.getElementById(ctMap[dim]);
        const btn = document.getElementById(btnMap[dim]);
        if (ct) { ct.textContent = size > 0 ? ` (${size})` : ''; ct.style.display = size > 0 ? '' : 'none'; }
        if (btn) btn.classList.toggle('flt-btn--active', size > 0);
        // Show/hide the global clear button — scoped to the three facet filters
        // it actually clears (search has its own box and isn't part of this control).
        const anyActive = ['tags','diffs','groups'].some(d => state.filters[d]?.size > 0);
        const clr = document.getElementById('flt-clear');
        if (clr) clr.style.display = anyActive ? '' : 'none';
    },

    populateFilters() {
        // Tags panel — add entries for newly-discovered tags only (idempotent)
        const tagPanel = document.getElementById('flt-panel-tags');
        if (tagPanel) {
            const existing = new Set([...tagPanel.querySelectorAll('input')].map(i => i.value));
            Array.from(state.allTags).sort().forEach(t => {
                if (existing.has(t)) return;
                const label = document.createElement('label');
                label.className = 'flt-opt';
                label.innerHTML = `<input type="checkbox" value="${esc(t)}"> ${esc(t.charAt(0).toUpperCase() + t.slice(1))}`;
                if (state.filters.tags.has(t)) label.querySelector('input').checked = true;
                tagPanel.appendChild(label);
            });
        }
        // Groups panel — checkbox VALUE is lowercased (matches the comparison in
        // updateTable below), display TEXT keeps the original casing. Bug fix:
        // previously the value was exact-case while updateTable compared against
        // a lowercased p.group, so the group filter never actually matched anything.
        const grpPanel = document.getElementById('flt-panel-groups');
        if (grpPanel) {
            const existing = new Set([...grpPanel.querySelectorAll('input')].map(i => i.value));
            Array.from(state.allGroups).sort((a,b) => a.localeCompare(b)).forEach(g => {
                const key = g.toLowerCase();
                if (existing.has(key)) return;
                const label = document.createElement('label');
                label.className = 'flt-opt';
                label.innerHTML = `<input type="checkbox" value="${esc(key)}"> ${esc(g)}`;
                if (state.filters.groups.has(key)) label.querySelector('input').checked = true;
                grpPanel.appendChild(label);
            });
        }
    },

    // Filter with OR-within-dimension, AND-across-dimensions; then multi-column
    // TimSort in O(N log N) with zero per-comparison allocation (precomputed keys).
    updateTable() {
        const { search, tags, groups, diffs } = state.filters;
        state.filtered = state.problems.filter(p => {
            if (search && !(p.searchIndex || '').includes(search)) return false;
            if (tags.size  > 0 && !([...tags].some(t => p._tagSet?.has(t)))) return false;
            if (groups.size > 0 && !groups.has((p.group||'').toLowerCase())) return false;
            if (diffs.size > 0 && (p.rating == null || !diffs.has(String(getStarCount(p.rating))))) return false;
            return true;
        });

        // Multi-level sort: iterate sort specs in order; first non-zero wins
        state.filtered.sort((a, b) => {
            for (const { column: col, ascending: asc } of state.sorts) {
                let c = 0;
                switch (col) {
                    case 'name':     c = (a._nameKey||'').localeCompare(b._nameKey||''); break;
                    case 'group':    c = (a._groupKey||'').localeCompare(b._groupKey||''); break;
                    case 'tags':     c = (a._tagsKey||'').localeCompare(b._tagsKey||''); break;
                    case 'progress': c = (a.progress||0) - (b.progress||0); break;
                    default:         c = (a.rating||0) - (b.rating||0); break;
                }
                if (c !== 0) return asc ? c : -c;
            }
            return 0;
        });

        this.renderVirtual();
    },

    // Renders only the rows within (±OVERSCAN) of the current scroll viewport,
    // using top/bottom spacer rows to preserve correct scrollbar size/position.
    // At 800 rows this keeps the DOM at ~20-30 <tr> instead of ~800, which is
    // what actually made re-sorting feel instant (the sort itself was never the
    // bottleneck — rebuilding thousands of DOM nodes + listeners was).
    renderVirtual() {
        const wrap = document.querySelector('.tbw');
        const tbody = document.getElementById('prob-tbody');
        if (!wrap || !tbody) return;
        const probs = state.filtered;
        if (!probs.length) { tbody.innerHTML = '<tr class="empty-r"><td colspan="6">No problems match your filters</td></tr>'; return; }

        const total = probs.length;
        const viewH = wrap.clientHeight || 400;
        let start = Math.floor(wrap.scrollTop / ROW_H) - OVERSCAN;
        let end   = Math.ceil((wrap.scrollTop + viewH) / ROW_H) + OVERSCAN;
        start = Math.max(0, Math.min(start, total));
        end   = Math.max(start, Math.min(end, total));

        const topH = start * ROW_H, botH = (total - end) * ROW_H;
        let html = '';
        if (topH > 0) html += `<tr class="vsp"><td colspan="6" style="height:${topH}px;padding:0;border:0"></td></tr>`;
        for (let i = start; i < end; i++) html += this.rowHtml(probs[i]);
        if (botH > 0) html += `<tr class="vsp"><td colspan="6" style="height:${botH}px;padding:0;border:0"></td></tr>`;
        tbody.innerHTML = html;
    },

    rowHtml(p) {
        const rc=getRatingConfig();
        const classified = p.rating != null && p.tags && p.tags.length;
        const ci = classified ? rc.bounds.findIndex(b=>p.rating<=b) : rc.bounds.length-1;
        const col = classified ? rc.colors[Math.max(0,ci)] : 'var(--ts)';
        const stars = classified ? getStarRating(p.rating) : '·  ·  ·';
        const ratingTxt = classified ? p.rating : '—';
        const isRe=state.reclassifying.has(p.id);
        const pvChoices = [{ name:'router', displayName:'Mistral -> Gemini Router' }]
            .concat(API_PROVIDERS.filter(pv => pv.provider === 'mistral'));
        const pvMenu = pvChoices.map(pv=>`<button class="pvo" data-pv="${pv.name}" data-pid="${p.id}">${esc(pv.displayName)}</button>`).join('');
        const act=isRe
            ?`<div class="rspin"><svg class="sp" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>Working…</div>`
            :`<div class="acb"><button class="rcb" data-pid="${p.id}" title="Reclassify"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button><div class="pvw"><button class="pvb" data-pid="${p.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg></button><div class="pvm" data-pid="${p.id}">${pvMenu}</div></div></div>`;

        const tags = p.tags || [];
        let tagHtml;
        const hidden = state.hideTags && classified && !state.revealedTagRows.has(p.id);
        if (hidden) {
            tagHtml = `<span class="tb2 tag-hidden" data-pid="${p.id}" title="Click to reveal">${this.eyeIcon()} ${tags.length} tag${tags.length===1?'':'s'} hidden</span>`;
        } else if (p.classificationDeferred) {
            tagHtml = `<span class="tb2 unclassified-tag" title="${esc(p.deferReason || 'Tier 2 unavailable')}">tier 2 retry next reload</span>`;
        } else if (!classified) {
            tagHtml = `<span class="tb2 unclassified-tag">queued for AI…</span>`;
        } else {
            tagHtml = tags.map(t=>`<span class="tb2">${esc(t)}</span>`).join('');
        }

        const summary = classified ? (p.reasoning_summary || '') : '';
        const summaryHtml = summary ? `<div class="rsum" title="${esc(summary)}">${esc(summary)}</div>` : '';
        const diffLabel = classified ? labelDifficulty(p.difficulty || difficultyFromRating(p.rating)) : '';
        const confTxt = classified && typeof p.confidence === 'number' ? `${Math.round(p.confidence * 100)}%` : '';
        const escTxt = classified
            ? (p.escalated ? `escalated${p.escalation_reason ? ': ' + p.escalation_reason : ''}` : 'tier 1')
            : '';
        const providerTxt = classified ? `${this.pvName(p.source_provider || p.classifiedBy)}${p.source_model ? ' / ' + p.source_model : ''}` : '';

        return `<tr class="pr${classified?'':' unclassified-row'}" data-pid="${p.id}">
<td class="pn"><a href="${p.href}" target="_blank" class="pl">${esc(p.name)}</a></td>
<td><div class="pgw"><div class="pgb"><div class="pgf" style="width:${p.progress}%;background:${p.progress===100?'#30d158':col}"></div></div><span class="pgt">${formatPct(p.progress)}</span></div></td>
<td><div class="gw"><span class="gb">${esc(p.group||'Public')}</span></div></td>
<td><div class="tag-cell"><div class="tw"><div class="tag-scroll">${tagHtml}</div><button class="ebt et" data-pid="${p.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div>${summaryHtml}</div></td>
<td><div class="dfw" style="color:${col}"><span class="dfs">${stars}</span><span class="dfr">${ratingTxt}</span><button class="ebt er" data-pid="${p.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div>${classified?`<div class="class-meta" title="${esc(providerTxt)}"><span>${esc(diffLabel)}</span>${confTxt?`<span>${esc(confTxt)}</span>`:''}<span class="esc ${p.escalated?'':'no'}" title="${esc(escTxt)}">${p.escalated?'Gemini':'Mistral'}</span></div><div class="clby">via ${esc(providerTxt)}</div>`:''}</td>
<td class="acc">${act}</td></tr>`;
    },

    // Faint autosave checkmark — appears in the header area, fades after 2s
    flashSaved() {
        let el = document.getElementById('gist-saved-check');
        if (!el) {
            el = document.createElement('span');
            el.id = 'gist-saved-check';
            el.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="2 9 6 13 14 4"/></svg> Saved`;
            el.style.cssText = 'position:fixed;bottom:18px;right:22px;display:flex;align-items:center;gap:5px;font-size:11px;font-weight:500;color:var(--ab,#2ea043);opacity:0;transition:opacity .4s;z-index:99999;pointer-events:none;letter-spacing:.02em;';
            document.body.appendChild(el);
        }
        el.style.opacity = '1';
        clearTimeout(el._t);
        el._t = setTimeout(()=>{ el.style.opacity='0'; }, 2200);
    },

    // Reclassify-in-progress state lives in state.reclassifying and is read by
    // rowHtml() — with virtualization the target row may currently be scrolled
    // out of view, so just re-render the visible window rather than touching a
    // specific <tr> (the delegated click handler in attachHandlers already
    // covers any buttons in the freshly-rendered markup).
    updateRow(pid, loading) {
        this.renderVirtual();
    },

    updateCounter() {
        const classified = state.problems.filter(p => Array.isArray(p.tags) && p.tags.length && p.rating != null).length;
        $('#cached-count').text(classified);
        if (state.total > 0) $('#total-count').text(state.total);
    },
    pvName(pn) {
        if (pn === 'mistral') return 'Mistral';
        if (pn === 'google') return 'Google Gemini';
        if (pn === 'fallback') return 'Fallback';
        if (pn === 'router') return 'Mistral -> Gemini Router';
        return API_PROVIDERS.find(p=>p.name===pn)?.displayName || pn || 'Unknown';
    },

    showTagEditor(pid) {
        const p=state.problems.find(pr=>String(pr.id)===String(pid)); if(!p) return;
        const ct=p.tags||[], ata=Array.from(VALID_TAGS).sort();
        const modal=$(`<div class="mo"><div class="mb"><div class="mh"><h3>Edit Tags — ${esc(p.name)}</h3><button class="mc">&times;</button></div><div class="mbd"><div class="tg">${ata.map(t=>`<label class="to ${ct.includes(t)?'sel':''}"><input type="checkbox" value="${t}" ${ct.includes(t)?'checked':''}><span>${esc(t)}</span></label>`).join('')}</div></div><div class="mft"><button class="mbt mbs mc2">Cancel</button><button class="mbt mbp ms">Save</button></div></div></div>`);
        $('body').append(modal);
        modal.find('.to input').on('change',function(){ $(this).closest('.to').toggleClass('sel',this.checked); });
        modal.find('.mc,.mc2').on('click',()=>modal.remove());
        modal.find('.ms').on('click', async ()=>{
            const st=modal.find('.to input:checked').map(function(){ return $(this).val(); }).get();
            if(!st.length){ alert('Select at least one tag'); return; }
            p.tags=st;
            setSortKeys(p);
            const d={tags:st,rating:p.rating,classifiedBy:'manual',classifiedAt:Date.now()};
            await new Promise(r=>chrome.storage.local.set({[`nztags_${p.id}`]:d},r));
            st.forEach(t=>state.allTags.add(t));
            LOG('Tags saved manually for', p.name, st);
            classifier.markDirty(p.id);
            classifier.requestSync();
            ui.updateTable(); modal.remove();
        });
    },

    showRatingEditor(pid) {
        const p=state.problems.find(pr=>String(pr.id)===String(pid)); if(!p) return;
        const modal=$(`<div class="mo"><div class="mb mb-sm"><div class="mh"><h3>Edit Difficulty — ${esc(p.name)}</h3><button class="mc">&times;</button></div><div class="mbd"><div class="re"><label>Difficulty Rating (800–3500):</label><input type="number" id="ri" min="800" max="3500" step="100" value="${p.rating}"><div class="rg"><div class="gi"><span class="gr">800:</span><span class="gd">Pure I/O</span></div><div class="gi"><span class="gr">900–1000:</span><span class="gd">Trivial</span></div><div class="gi"><span class="gr">1000–1200:</span><span class="gd">Easy</span></div><div class="gi"><span class="gr">1200–1800:</span><span class="gd">Medium</span></div><div class="gi"><span class="gr">1800–2300:</span><span class="gd">Hard</span></div><div class="gi"><span class="gr">2300+:</span><span class="gd">Very Hard</span></div></div></div></div><div class="mft"><button class="mbt mbs mc2">Cancel</button><button class="mbt mbp ms">Save</button></div></div></div>`);
        $('body').append(modal);
        modal.find('.mc,.mc2').on('click',()=>modal.remove());
        modal.find('.ms').on('click', async ()=>{
            const nr=parseInt(modal.find('#ri').val());
            if(isNaN(nr)||nr<800||nr>3500){ alert('Enter a valid rating 800–3500'); return; }
            p.rating=nr;
            const d={tags:p.tags,rating:nr,classifiedBy:'manual',classifiedAt:Date.now()};
            await new Promise(r=>chrome.storage.local.set({[`nztags_${p.id}`]:d},r));
            LOG('Rating saved manually for', p.name, nr);
            classifier.markDirty(p.id);
            classifier.requestSync();
            ui.updateTable(); modal.remove();
        });
    },
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function run() {
    LOG('Dashboard v10.0 init start');

    // ── Load API keys + view preferences from storage (single round-trip) ────
    const storedKeys = await new Promise(r => chrome.storage.local.get(
        ['mistralKeys', 'googleKeys', 'mistralKey', 'googleKey', 'geminiKey',
         'mistralModel', 'mistralFallbackModel', 'googleModel', 'googleFallbackModel',
         'theme', 'dashboardHideTags'], r
    ));

    // Apply theme immediately — before any HTML is rendered — so there is no
    // flash of the wrong theme. Default to 'dark' (the extension's original look).
    state.theme = (storedKeys.theme === 'light') ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    document.documentElement.classList.add('nzoi-dashboard-page');
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
        const fitDashboardToViewport = () => {
            const top = Math.max(0, mainContainer.getBoundingClientRect().top);
            const h = Math.max(360, window.innerHeight - top - 8);
            mainContainer.style.setProperty('--nzoi-dashboard-top', `${top}px`);
            mainContainer.style.height = `${h}px`;
            mainContainer.style.maxHeight = `${h}px`;
        };
        requestAnimationFrame(fitDashboardToViewport);
        window.addEventListener('resize', fitDashboardToViewport, { passive: true });
    }
    document.querySelectorAll('#right-menu ul,#right-menu .sf-sub-indicator').forEach(el => el.remove());
    document.querySelectorAll('#right-menu .sf-with-ul').forEach(el => el.classList.remove('sf-with-ul'));
    state.hideTags = !!storedKeys.dashboardHideTags;

    API_PROVIDERS = [];
    const mistralKeys = storedKeys.mistralKeys || (storedKeys.mistralKey ? [storedKeys.mistralKey] : []);
    const mistralModel = storedKeys.mistralModel || MISTRAL_PRIMARY_MODEL;
    const mistralFallbackModel = storedKeys.mistralFallbackModel || MISTRAL_FALLBACK_MODEL;
    mistralKeys.forEach((key, i) => {
        if (!key) return;
        API_PROVIDERS.push({
            name:'mistral-'+i,
            provider:'mistral',
            displayName:'Mistral Tier 1 ('+mistralModel+')'+(i>0?' #'+(i+1):''),
            key,
            model:mistralModel,
            fallbackModel:mistralFallbackModel,
            rpmLimit:180,
            rpsLimit:MISTRAL_LIMITS.requestsPerSecond,
            tpmLimit:MISTRAL_LIMITS.tokensPerMinute,
            contextWindowTokens:MISTRAL_LIMITS.contextWindowTokens,
        });
    });
    const googleKeys = storedKeys.googleKeys || (storedKeys.googleKey ? [storedKeys.googleKey] : (storedKeys.geminiKey ? [storedKeys.geminiKey] : []));
    const googleModel = storedKeys.googleModel || GOOGLE_TIER2_MODEL;
    const googleFallbackModel = storedKeys.googleFallbackModel || GOOGLE_TIER2_FALLBACK_MODEL;
    googleKeys.forEach((key, i) => {
        if (!key) return;
        API_PROVIDERS.push({
            name:'google-'+i,
            provider:'google',
            displayName:'Gemini Tier 2 ('+googleModel+')'+(i>0?' #'+(i+1):''),
            key,
            model:googleModel,
            fallbackModel:googleFallbackModel,
            rpmLimit:GOOGLE_LIMITS.requestsPerMinute,
            rpdLimit:GOOGLE_LIMITS.requestsPerDay,
            contextWindowTokens:GOOGLE_LIMITS.contextWindowTokens,
        });
    });
    const hasProviders = API_PROVIDERS.some(p => p.provider === 'mistral');
    LOG('Providers:', API_PROVIDERS.map(p=>p.name).join(', ')||'NONE');
    initApiStates();

    // ── PHASE 1: Wait only for the DOM we need for own-page scrape ───────────
    await new Promise(resolve => {
        if ($('.subheading').length || $('table tbody tr').length) { resolve(); return; }
        const ci = setInterval(() => {
            if ($('.subheading').length || $('h2').length) { clearInterval(ci); resolve(); }
        }, 100);
        setTimeout(() => { clearInterval(ci); resolve(); }, 4000); // hard cap
    });
    LOG('DOM ready for scraping');

    // ── PHASE 2: Instant own-page scrape — pure DOM, no network ─────────────
    const ownPage = scrapers.getOwnPageProblems();
    ownPage.forEach(p => { if (p.group) state.allGroups.add(p.group); });
    state.total = ownPage.length;

    // ── PHASE 3: Load from local chrome.storage — <5ms, no network ──────────
    const { cached: localCached, uncached: localUncached } = await cache.loadLocal(ownPage);

    // ── PHASE 4: FIRST PAINT — render immediately with whatever we have ──────
    ui.init(state.total);        // inject chrome with total count
    // Show all known problems (classified + unclassified skeleton rows)
    const allKnown = [
        ...localCached,
        ...localUncached.map(p => ({ ...p, tags: null, rating: null }))
    ];
    upsertProblems(allKnown);
    ui.populateFilters();
    ui.updateTable();   // renders classified rows immediately; unclassified get skeleton
    ui.updateCounter();
    LOG(`First paint: ${localCached.length} classified + ${localUncached.length} skeleton rows`);

    const ingestNewProblems = async (newProbs, label) => {
        if (!newProbs.length) {
            LOG(`${label}: no new problems`);
            return;
        }
        state.total += newProbs.length;
        $('#total-count').text(state.total);
        const { cached, uncached } = await cache.loadLocal(newProbs);
        upsertProblems([
            ...cached,
            ...uncached.map(p => ({ ...p, tags: null, rating: null }))
        ]);
        ui.populateFilters(); ui.updateTable(); ui.updateCounter();
        if (uncached.length) {
            const { restored, stillUncached } = await cache.restoreFromGist(uncached);
            if (restored.length) {
                upsertProblems(restored);
                ui.populateFilters(); ui.updateTable(); ui.updateCounter();
            }
            if (stillUncached.length && hasProviders) classifier.enqueue(stillUncached);
        }
        LOG(`${label}: picked up ${newProbs.length} late problem(s)`);
    };

    setTimeout(() => {
        ingestNewProblems(scrapers.getOwnPageProblems(), 'Delayed own-page rescan')
            .catch(e => ERR('Delayed own-page rescan failed:', e.message));
    }, LATE_PROBLEM_RESCAN_MS);

    // ── PHASE 5: Background — Gist restore + My Groups scrape (non-blocking) ─
    // Run these concurrently; each feeds the classifier queue as data arrives.
    const myGrps = scrapers.getMyGroups();

    const [gistResult] = await Promise.allSettled([
        // 5a: Restore uncached from Gist — fills many rows without AI
        cache.restoreFromGist(localUncached).then(({ restored, stillUncached }) => {
            if (restored.length) {
                upsertProblems(restored);
                ui.populateFilters(); ui.updateTable(); ui.updateCounter();
                LOG(`Gist restore painted ${restored.length} rows`);
            }
            // What's still uncached after Gist goes to the AI queue
            if (stillUncached.length) {
                if (!hasProviders) {
                    // Show unclassified rows without crashing — they already render as skeleton
                    upsertProblems(stillUncached.map(p => ({ ...p, tags: null, rating: null })));
                    ui.updateTable(); ui.updateCounter();
                } else {
                    classifier.enqueue(stillUncached);
                }
            }
        }),
    ]);

    // 5b: Fetch My Groups pages — any new problems discovered get classified too
    if (myGrps.length) {
        await Promise.all(myGrps.map(async g => {
            try {
                const newProbs = await scrapers.getGroupPageProblems(g);
                if (!newProbs.length) return;
                state.total += newProbs.length;
                $('#total-count').text(state.total);
                const { cached: gc, uncached: gu } = await cache.loadLocal(newProbs);
                upsertProblems([
                    ...gc,
                    ...gu.map(p => ({ ...p, tags: null, rating: null }))
                ]);
                ui.populateFilters(); ui.updateTable(); ui.updateCounter();
                if (gu.length && hasProviders) {
                    const { restored: gr, stillUncached: gs } = await cache.restoreFromGist(gu);
                    upsertProblems(gr);
                    if (gr.length) { ui.populateFilters(); ui.updateTable(); ui.updateCounter(); }
                    if (gs.length) classifier.enqueue(gs);
                } else if (gu.length) {
                    upsertProblems(gu.map(p => ({ ...p, tags: null, rating: null })));
                    ui.updateTable(); ui.updateCounter();
                }
            } catch(e) { ERR('Group page fetch failed:', g.name, e.message); }
        }));
    }

    LOG('Bootstrap complete. Problems in state:', state.problems.length);
}

run().catch(e => ERR('Fatal error:', e));

} // end initDashboard
