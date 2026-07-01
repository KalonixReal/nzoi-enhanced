# NZOI Enhanced

> A browser extension that upgrades the [NZOI Training](https://train.nzoi.org.nz) website with a professional code editor, in-browser linting, code execution, GitHub Gist sync, and AI-powered problem classification.

![Version](https://img.shields.io/badge/version-10.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [GitHub Gist Sync](#github-gist-sync)
- [AI Problem Classification](#ai-problem-classification)
- [Code Execution](#code-execution)
- [Editor Settings](#editor-settings)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Data & Privacy](#data--privacy)
- [Permissions Explained](#permissions-explained)

---

## Features

### Monaco Editor
The same editor that powers VS Code, replacing the NZOI Training site's default textarea. Includes full syntax highlighting, bracket matching, autocomplete, and a familiar keyboard experience for **C++ 17**, **Python 3**, and **Java**.

Each language opens with a ready-to-use template:
- **C++ 17** — includes `#include <bits/stdc++.h>` and a `main()` scaffold
- **Python 3** — includes `sys.stdin.readline` fast input and a `main()` function
- **Java** — includes `BufferedReader` fast input inside `Main`

### In-Browser Linting
Catch errors before you submit — no compilation round-trip needed.

| Language | Linting Backend | How it works |
|---|---|---|
| C++ 17 | clangd (language server) | Connects to a remote clangd instance via a sandboxed iframe |
| Python 3 | Pyodide (in-browser) | Runs a real Python AST analysis entirely locally — no server involved |
| Java | CheerpJ (in-browser) | Compiles with a JVM running in WebAssembly in your browser |

Linting results appear inline in the editor as red underlines, with hover tooltips showing the error message.

### Semantic Highlighting
NZOI Enhanced goes beyond basic syntax colouring.

- **Python** — AST-based analysis distinguishes variable declarations, function calls, parameters, class names, decorators, and more using real scope analysis.
- **Java** — a lexer + scope-aware classifier identifies type references, method declarations vs calls, member access, annotations, and imports.
- **C++** — powered directly by clangd's LSP semantic tokens.

### AI Problem Classification
A two-tier AI pipeline that classifies every problem on NZOI Training by topic and difficulty, so you can see at a glance what skills a problem tests and how hard it is expected to be.

- **Tier 1 — Mistral AI**: first-pass classification for every problem
- **Tier 2 — Google Gemini**: automatic escalation for hard, ambiguous, or low-confidence problems
- Results are cached locally to avoid repeat API calls
- Prompts are fully customisable from the extension popup

### GitHub Gist Sync
Optionally back up your code and problem classifications to a private GitHub Gist so your work is available across devices and browsers. Press **Ctrl+S** on any problem page to save instantly.

### Code Execution
Run your code against custom input without leaving the page, using one of two remote execution backends:

- **Judge0** (`ce.judge0.com`) — supports C++, Python, Java
- **Piston** (`emkc.org`) — lightweight alternative

### Dark / Light Theme
A theme toggle is available directly on the problem page. Your preference is saved and restored automatically.

### Auto-Save
The editor automatically saves your code locally at a configurable interval (1.5 s, 2.5 s, 5 s, or 10 s). Code is saved per-problem and restored when you return to that problem.

---

## Installation

### Chrome / Edge / Brave (Developer Mode)

1. Download or clone this repository and unzip it.
2. Open your browser and go to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the unzipped extension folder.
5. The NZOI Enhanced icon will appear in your toolbar.

> **Microsoft Edge Add-ons / Chrome Web Store** — check the store listing for a one-click install once available.

---

## Getting Started

1. Install the extension (see above).
2. Go to [train.nzoi.org.nz](https://train.nzoi.org.nz) and log in (free registration required).
3. Open any problem page — the Monaco editor will automatically replace the default textarea.
4. Click the **NZOI Enhanced** icon in your toolbar to open the popup and configure optional features.

All features are **opt-in**. The extension works out of the box with just the editor and linting — API keys are only needed for AI classification and Gist sync.

---

## GitHub Gist Sync

Gist sync lets you save your code and classifications to a private GitHub Gist so they follow you across devices.

### Step 1 — Create a GitHub Personal Access Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) (classic tokens) or [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta) (fine-grained).
2. Click **Generate new token**.
3. Give it a name like `nzoi-enhanced`.
4. Under **Scopes**, tick **`gist`** — that is the only scope needed.
5. Click **Generate token** and copy the token (it starts with `ghp_`).

> ⚠️ You only see the token once. Copy it before closing the page.

### Step 2 — Enter the Token in the Extension

1. Click the NZOI Enhanced icon to open the popup.
2. Paste your token into **Personal Access Token**.
3. Leave **Gist ID** blank to let the extension create a new private Gist automatically, or paste an existing Gist ID to link it. You can also click **Browse** to pick from your existing Gists.
4. Click **Save All Settings**, then **Test** to verify the connection.

### Using Gist Sync

| Action | How |
|---|---|
| Save current file | `Ctrl+S` on any problem page |
| Restore code | Automatically loaded when you open a problem |
| Clear Gist cache | Popup → Data Management → **Clear Gist File Cache** |

---

## AI Problem Classification

AI classification tags each problem with its topic(s) and an estimated difficulty rating so you can prioritise your practice.

### How it works

```
Problem page opened
       │
       ▼
  Tier 1 — Mistral AI
  (fast first-pass classifier)
       │
  Confident result? ──Yes──► Cache & display
       │
       No
       ▼
  Tier 2 — Google Gemini
  (escalation reviewer — result is final)
       │
       ▼
  Cache & display
```

Results are stored locally. Once a problem is classified it won't be sent to the AI again unless you reset.

---

### Getting a Mistral AI Key (Tier 1)

1. Go to [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys).
2. Sign up or log in.
3. Click **Create new key**, give it a name, and copy it.
4. In the extension popup under **AI Classification → Mistral Tier 1**, click **+ Add Mistral Key** and paste it in.
5. Optionally change the **Model** (default: `mistral-medium-3-5`) or **Fallback Model** (default: `codestral-2508`).
6. Click **Save All Settings**.

You can add multiple Mistral keys — the extension rotates through them to stay within rate limits (3 rps / 1.5 M tpm).

---

### Getting a Google Gemini Key (Tier 2)

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account.
3. Click **Create API key** and copy it.
4. In the extension popup under **AI Classification → Google Gemini Tier 2**, click **+ Add Google Key** and paste it in.
5. Optionally change the **Model** (default: `gemini-3.5-flash`) or **Fallback Model**.
6. Click **Save All Settings**.

You can add multiple Google keys. Gemini is only called when Tier 1 returns a low-confidence or risky result.

---

### Customising Classification Prompts

The popup's **Data Management** section lets you edit the prompts sent to each AI tier. The prompts support these placeholders:

| Placeholder | Description |
|---|---|
| `{{TEXT}}` | The full problem statement text |
| `{{TAGS}}` | The list of allowed classification tags |
| `{{PREVIOUS}}` | Any previous classification for this problem (anchor) |
| `{{TITLE}}` | The problem title |
| `{{URL}}` | The problem URL |
| `{{TIER1_RESULT}}` | *(Tier 2 only)* The full Tier 1 result/debug payload |
| `{{ESCALATION_REASON}}` | *(Tier 2 only)* Why this problem was escalated |

Click **Reset** to restore the default prompt at any time.

### Resetting Classifications

To re-classify all problems from scratch: popup → Data Management → **Restart Classification (Clear AI Tags)**.

---

## Code Execution

1. Open a problem page — a **Run** button appears in the editor toolbar.
2. Type your custom input in the input panel below the editor.
3. Press **Run** (or `Alt+R`) to execute and see the output.

The execution backend (Judge0 or Piston) can be changed in the popup. No API key is required for either backend. Source code and input are sent directly from your browser to the selected service and are not stored by the developer.

---

## Editor Settings

Accessible from the popup under **Editor**:

| Setting | Options |
|---|---|
| Default Language | C++ 17, Python 3, Java |
| Auto-save Delay | 1.5 s, 2.5 s, 5 s, 10 s |

Theme (dark / light) is toggled directly on the problem page and saved automatically.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save current file to GitHub Gist |
| `Alt+R` | Run code against test input |
| `Alt+S` | Submit solution to NZOI |

Standard Monaco shortcuts (Ctrl+Z undo, Ctrl+/ toggle comment, Alt+↑/↓ move line, etc.) all work as expected.

---

## Data & Privacy

NZOI Enhanced does **not** collect, transmit, or store any user data on developer-controlled servers.

**What is stored locally** (in `chrome.storage.local` on your device only):
- GitHub token and Gist ID
- Mistral AI and Google Gemini API keys
- Editor preferences and theme
- Cached problem classifications
- Saved code per problem
- Custom AI prompt templates

**What is sent to third-party services** (only when you enable those features):
- Source code → Judge0 or Piston (code execution)
- Problem text + your API key → Mistral AI or Google Gemini (AI classification)
- Code + classifications + your GitHub token → GitHub Gist API (sync)

No analytics, tracking pixels, or advertising identifiers are used.

📄 **[Full Privacy Policy](https://github.com/KalonixReal/nzoi-enhanced/blob/main/PRIVACY_POLICY.md)**

---

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `storage` | Saves your settings, API keys, cached classifications, and code locally on your device |
| `declarativeNetRequest` | Modifies response headers on train.nzoi.org.nz to allow Monaco, Pyodide, and CheerpJ (WebAssembly tools) to run — the site's default Content-Security-Policy blocks them |
| `declarativeNetRequestWithHostAccess` | Required by Manifest V3 to modify response headers on specific hosts (train.nzoi.org.nz and clangd-in-browser-fork.pages.dev) |
| `scripting` | Injects the Monaco editor, linting tools, and dashboard panel into NZOI Training pages |
| `train.nzoi.org.nz/*` | The site the extension runs on |
| `api.github.com/*` | GitHub Gist sync (only used when you provide a GitHub token) |
| `clangd-in-browser-fork.pages.dev/*` | C++ language server for in-browser linting |
| `ce.judge0.com/*` | Remote code execution via Judge0 (optional) |
| `emkc.org/*` | Remote code execution via Piston (optional) |
| `api.mistral.ai/*` | AI classification — Tier 1 (optional, requires your own key) |
| `generativelanguage.googleapis.com/*` | AI classification — Tier 2 Google Gemini (optional, requires your own key) |

---

*NZOI Enhanced is an independent community project and is not affiliated with or endorsed by the New Zealand Olympiad in Informatics.*
