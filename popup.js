'use strict';

// Default AI classification prompt — MUST match DEFAULT_PROMPT_TEMPLATE in
// content/dashboard.js. Duplicated because the popup and content script run in
// separate JS contexts with no shared module system. Used here as the
// "Reset to Default" value and as the initial textarea content when no custom
// override has been saved yet.
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

// ── Key list helpers ──────────────────────────────────────────────────────────

function buildKeyRow(value, placeholder, onRemove) {
  const row = document.createElement('div');
  row.className = 'key-row';
  const inp = document.createElement('input');
  inp.type = 'password';
  inp.value = value || '';
  inp.placeholder = placeholder;
  const eye = document.createElement('button');
  eye.className = 'eye';
  eye.textContent = 'show';
  eye.addEventListener('click', () => {
    inp.type = inp.type === 'password' ? 'text' : 'password';
    eye.textContent = inp.type === 'password' ? 'show' : 'hide';
  });
  row.appendChild(inp);
  row.appendChild(eye);
  if (onRemove) {
    const rem = document.createElement('button');
    rem.className = 'rem';
    rem.textContent = '×';
    rem.addEventListener('click', onRemove);
    row.appendChild(rem);
  }
  return row;
}

function addKey(listId, placeholder) {
  const list = document.getElementById(listId);
  const row = buildKeyRow('', placeholder, () => row.remove());
  list.appendChild(row);
}

function getKeys(listId) {
  return Array.from(document.querySelectorAll(`#${listId} .key-row input`))
    .map(i => i.value.trim()).filter(Boolean);
}

function renderKeys(listId, keys, placeholder) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  const all = keys.length ? keys : [''];
  all.forEach((k, i) => {
    const row = buildKeyRow(k, placeholder, i === 0 ? null : () => row.remove());
    list.appendChild(row);
  });
}

// ── Load settings ─────────────────────────────────────────────────────────────

// NOTE: a previous version had a select+custom-text-input pattern for model IDs
// (`syncCustomInput` / `resolveModel` keyed off a `__custom__` sentinel). The
// popup now exposes model IDs directly as plain text inputs (mistral-model,
// mistral-fallback-model, google-model, google-fallback-model) — the
// select/custom machinery is unused and was wired to an empty list, so it has
// been removed to avoid confusion and the dead references below.

chrome.storage.local.get(
  ['githubToken','gistId','defaultLanguage','gistAutoSaveMs',
   'mistralKeys','googleKeys','mistralKey','googleKey','geminiKey',
   'mistralModel','mistralFallbackModel','googleModel','googleFallbackModel',
   'mistralTier1PromptTemplate','googleTier2PromptTemplate'],
  d => {
    if (d.githubToken)     document.getElementById('github-token').value = d.githubToken;
    if (d.gistId)          document.getElementById('gist-id').value = d.gistId;
    if (d.defaultLanguage) document.getElementById('default-lang').value = d.defaultLanguage;
    if (d.gistAutoSaveMs)  document.getElementById('autosave-delay').value = String(d.gistAutoSaveMs);

    const mKeys = d.mistralKeys || (d.mistralKey ? [d.mistralKey] : []);
    const gKeys = d.googleKeys || (d.googleKey ? [d.googleKey] : (d.geminiKey ? [d.geminiKey] : []));
    renderKeys('mistral-keys', mKeys, 'Mistral API key');
    renderKeys('google-keys', gKeys, 'Google AI API key');
    document.getElementById('mistral-model').value = d.mistralModel || 'mistral-medium-3-5';
    document.getElementById('mistral-fallback-model').value = d.mistralFallbackModel || 'codestral-2508';
    document.getElementById('google-model').value = d.googleModel || 'gemini-3.5-flash';
    document.getElementById('google-fallback-model').value = d.googleFallbackModel || 'gemini-3.1-pro-preview';

    // Load saved model ID — if it matches a preset option, select it directly;
    // otherwise put it into the Custom text input and select __custom__.
    updateAiStatus(mKeys.length > 0, gKeys.length > 0);

    // Classification prompt — show the saved override, or the default if none.
    document.getElementById('mistral-tier1-prompt-template').value =
      (typeof d.mistralTier1PromptTemplate === 'string' && d.mistralTier1PromptTemplate.trim())
        ? d.mistralTier1PromptTemplate
        : DEFAULT_MISTRAL_TIER1_PROMPT_TEMPLATE;
    document.getElementById('google-tier2-prompt-template').value =
      (typeof d.googleTier2PromptTemplate === 'string' && d.googleTier2PromptTemplate.trim())
        ? d.googleTier2PromptTemplate
        : DEFAULT_GOOGLE_TIER2_PROMPT_TEMPLATE;
  }
);

function updateAiStatus(hasMistral, hasGoogle) {
  const s = document.getElementById('ai-status');
  if (!hasMistral) {
    s.textContent = 'No Mistral key - classification will pause until reload.';
    s.className = 'status err';
  } else {
    s.textContent = 'Active: ' + ['Mistral Tier 1', hasGoogle && 'Gemini Tier 2'].filter(Boolean).join(', ');
    s.className = hasGoogle ? 'status ok' : 'status info';
  }
}

// ── Add key buttons ───────────────────────────────────────────────────────────

// ── Token show/hide ───────────────────────────────────────────────────────────

document.getElementById('add-mistral-key')?.addEventListener('click', () => addKey('mistral-keys', 'Mistral API key'));
document.getElementById('add-google-key')?.addEventListener('click', () => addKey('google-keys', 'Google AI API key'));

document.getElementById('toggle-token').addEventListener('click', () => {
  const inp = document.getElementById('github-token');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  document.getElementById('toggle-token').textContent = inp.type === 'password' ? 'show' : 'hide';
});

// ── Save settings ─────────────────────────────────────────────────────────────

document.getElementById('save-settings').addEventListener('click', () => {
  const gistStatus = document.getElementById('gist-status');
  const token        = document.getElementById('github-token').value.trim();
  const gistId       = document.getElementById('gist-id').value.trim();
  const lang         = document.getElementById('default-lang').value;
  const delay        = parseInt(document.getElementById('autosave-delay').value);
  const mistralKeys = getKeys('mistral-keys');
  const googleKeys = getKeys('google-keys');
  const mistralModel = document.getElementById('mistral-model').value.trim() || 'mistral-medium-3-5';
  const mistralFallbackModel = document.getElementById('mistral-fallback-model').value.trim() || 'codestral-2508';
  const googleModel = document.getElementById('google-model').value.trim() || 'gemini-3.5-flash';
  const googleFallbackModel = document.getElementById('google-fallback-model').value.trim() || 'gemini-3.1-pro-preview';

  if (mistralKeys.length > 0 && !mistralModel) {
    document.getElementById('ai-status').textContent = 'Enter a Mistral model ID.';
    document.getElementById('ai-status').className = 'status err';
    return;
  }

  if (token && !token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    gistStatus.textContent = 'Token looks wrong — should start with ghp_ or github_pat_';
    gistStatus.className = 'status err';
    return;
  }
  const data = {
    defaultLanguage: lang,
    gistAutoSaveMs:  delay,
    mistralKeys,
    googleKeys,
    mistralModel,
    mistralFallbackModel,
    googleModel,
    googleFallbackModel,
    // Legacy single-key compat
    mistralKey: mistralKeys[0] || '',
    googleKey: googleKeys[0] || '',
    geminiKey: googleKeys[0] || '',
  };
  if (token)  data.githubToken = token;
  if (gistId) data.gistId      = gistId;

  chrome.storage.local.set(data, () => {
    gistStatus.textContent = 'Settings saved.';
    gistStatus.className = 'status ok';
    setTimeout(() => { gistStatus.className = 'status'; }, 2500);
    updateAiStatus(mistralKeys.length > 0, googleKeys.length > 0);
  });
});

// ── Test Gist ─────────────────────────────────────────────────────────────────

document.getElementById('test-gist').addEventListener('click', () => {
  const token  = document.getElementById('github-token').value.trim();
  const status = document.getElementById('gist-status');
  if (!token) { status.textContent = 'Enter a token first.'; status.className = 'status err'; return; }
  status.textContent = 'Testing…'; status.className = 'status info';
  chrome.runtime.sendMessage({ type: 'gist:test', token }, res => {
    if (res?.ok) {
      const d = res.data;
      status.textContent = `Connected as ${d.login}${d.gistId ? ` — ${d.fileCount} files in Gist` : ' — no Gist linked yet'}`;
      status.className = 'status ok';
    } else {
      status.textContent = 'Failed: ' + (res?.error || 'unknown error');
      status.className = 'status err';
    }
  });
});

// ── Browse Gists ──────────────────────────────────────────────────────────────

document.getElementById('browse-gists').addEventListener('click', () => {
  const token  = document.getElementById('github-token').value.trim();
  const status = document.getElementById('gist-status');
  if (!token) { status.textContent = 'Enter a token first.'; status.className = 'status err'; return; }
  status.textContent = 'Fetching your gists…'; status.className = 'status info';

  chrome.runtime.sendMessage({ type: 'gist:list', token }, res => {
    status.className = 'status';
    if (!res?.ok) {
      status.textContent = 'Failed: ' + (res?.error || 'unknown');
      status.className = 'status err';
      return;
    }
    const picker = document.getElementById('gist-picker');
    const sel    = document.getElementById('gist-list');
    const gists  = res.data;
    if (!gists.length) {
      status.textContent = 'No gists found on this account.';
      status.className = 'status info';
      return;
    }
    sel.innerHTML = gists.map(g => {
      const date = new Date(g.updatedAt).toLocaleDateString();
      return `<option value="${g.id}">[${date}] ${g.description} (${g.fileCount} files: ${g.files})</option>`;
    }).join('');
    picker.style.display = 'block';
  });
});

document.getElementById('use-gist').addEventListener('click', () => {
  const id = document.getElementById('gist-list').value;
  if (!id) return;
  document.getElementById('gist-id').value = id;
  document.getElementById('gist-picker').style.display = 'none';
  const s = document.getElementById('gist-status');
  s.textContent = 'Gist linked — click Save All Settings to confirm.';
  s.className = 'status info';
});

// ── Data management ───────────────────────────────────────────────────────────

// Classification prompt editor — lets users tune the AI prompt on the fly from
// the same panel as "Restart Classification" below, without touching code.
/*
document.getElementById('save-prompt')?.addEventListener('click', () => {
  const val = document.getElementById('prompt-template').value;
  const s = document.getElementById('prompt-status');
  if (!val.includes('{{TEXT}}')) {
    s.textContent = 'Prompt must include {{TEXT}} (the problem statement) — not saved.';
    s.className = 'status err';
    return;
  }
  if (!val.includes('{{TAGS}}')) {
    s.textContent = 'Warning: {{TAGS}} placeholder missing — saved, but the model won\u2019t see the allowed tag list.';
    s.className = 'status info';
  } else {
    s.textContent = 'Prompt saved — used for all classifications from now on.';
    s.className = 'status ok';
  }
  chrome.storage.local.set({ classificationPromptTemplate: val }, () => {
    setTimeout(() => { s.className = 'status'; }, 3500);
  });
});

document.getElementById('reset-prompt')?.addEventListener('click', () => {
  document.getElementById('prompt-template').value = DEFAULT_PROMPT_TEMPLATE;
  chrome.storage.local.remove('classificationPromptTemplate', () => {
    const s = document.getElementById('prompt-status');
    s.textContent = 'Reset to the default prompt.';
    s.className = 'status ok';
    setTimeout(() => { s.className = 'status'; }, 2500);
  });
});

*/
function savePrompt(textareaId, storageKey, required) {
  const val = document.getElementById(textareaId).value;
  const s = document.getElementById('prompt-status');
  const missing = required.filter(ph => !val.includes(ph));
  if (missing.length) {
    s.textContent = 'Prompt missing required placeholder(s): ' + missing.join(', ');
    s.className = 'status err';
    return;
  }
  chrome.storage.local.set({ [storageKey]: val }, () => {
    s.textContent = 'Prompt saved.';
    s.className = 'status ok';
    setTimeout(() => { s.className = 'status'; }, 2500);
  });
}

function resetPrompt(textareaId, storageKey, defaultValue) {
  document.getElementById(textareaId).value = defaultValue;
  chrome.storage.local.remove(storageKey, () => {
    const s = document.getElementById('prompt-status');
    s.textContent = 'Prompt reset to default.';
    s.className = 'status ok';
    setTimeout(() => { s.className = 'status'; }, 2500);
  });
}

document.getElementById('save-mistral-tier1-prompt').addEventListener('click', () => {
  savePrompt('mistral-tier1-prompt-template', 'mistralTier1PromptTemplate', ['{{TEXT}}', '{{TAGS}}', '{{PREVIOUS}}']);
});
document.getElementById('reset-mistral-tier1-prompt').addEventListener('click', () => {
  resetPrompt('mistral-tier1-prompt-template', 'mistralTier1PromptTemplate', DEFAULT_MISTRAL_TIER1_PROMPT_TEMPLATE);
});
document.getElementById('save-google-tier2-prompt').addEventListener('click', () => {
  savePrompt('google-tier2-prompt-template', 'googleTier2PromptTemplate', ['{{TEXT}}', '{{TAGS}}', '{{TIER1_RESULT}}']);
});
document.getElementById('reset-google-tier2-prompt').addEventListener('click', () => {
  resetPrompt('google-tier2-prompt-template', 'googleTier2PromptTemplate', DEFAULT_GOOGLE_TIER2_PROMPT_TEMPLATE);
});

document.getElementById('clear-classifications').addEventListener('click', () => {
  if (!confirm('Clear all cached AI classifications? They will be re-fetched from Gist or re-run on next visit.')) return;
  chrome.storage.local.get(null, all => {
    const keys = Object.keys(all).filter(k => k.startsWith('nztags_'));
    chrome.storage.local.remove(keys, () => {
      const s = document.getElementById('data-status');
      s.textContent = `Cleared ${keys.length} classifications.`;
      s.className = 'status ok';
      setTimeout(() => { s.className = 'status'; }, 2500);
    });
  });
});

document.getElementById('clear-gist-cache').addEventListener('click', () => {
  chrome.storage.local.remove(['gistCache', 'gistCacheTime'], () => {
    const s = document.getElementById('data-status');
    s.textContent = 'Gist file cache cleared — next save/load will re-fetch from GitHub.';
    s.className = 'status ok';
    setTimeout(() => { s.className = 'status'; }, 2500);
  });
});
