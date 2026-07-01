# NZOI Enhanced Privacy Policy

Last updated: June 20, 2026

NZOI Enhanced is a Chrome extension that enhances the NZOI Training website with an in-browser editor, linting, code execution helpers, Gist sync, and AI problem classification.

## Data Stored Locally

The extension stores settings and user-provided credentials in `chrome.storage.local` on your device. This may include:

- GitHub token and Gist ID for optional Gist sync.
- Mistral and Google AI API keys for optional AI classification.
- Editor preferences, theme settings, cached classifications, problem metadata, saved code, and prompt templates.

API keys and tokens are not uploaded to any developer-owned server. They remain in Chrome local extension storage unless you remove them.

## Data Shared With Third Parties

The extension communicates directly from your browser to the services needed for enabled features:

- NZOI Training (`train.nzoi.org.nz`): reads problem pages, submits code, and interacts with the site as part of the extension experience.
- GitHub API (`api.github.com`): if Gist sync is enabled, the extension sends your GitHub token and synced code/classification data to GitHub.
- Mistral AI (`api.mistral.ai`) and Google Gemini (`generativelanguage.googleapis.com`): if AI classification is enabled, the extension sends problem text, extracted PDF/problem content, classification prompts, and your API key to the selected AI provider.
- Judge0 (`ce.judge0.com`) and Piston (`emkc.org`): if remote code execution is used, the extension sends source code, language, and input data needed to run the code.
- Clangd host listed in the extension manifest: used only to support C++ editor/linting tooling required by the extension.

The extension does not sell user data, use user data for advertising, or share user data for unrelated purposes.

## What Is Not Collected

NZOI Enhanced does not include analytics, tracking pixels, advertising identifiers, or a developer-operated backend database. The developer does not receive your API keys, GitHub token, code, classifications, or browsing activity through this extension.

## Clearing Data

You can clear stored data by:

- Using the extension popup/dashboard controls to remove cached classifications or Gist cache.
- Removing saved API keys and tokens from the extension settings.
- Clearing the extension's site/storage data in Chrome.
- Uninstalling the extension, which removes its local extension storage.

## Contact

For questions about this policy, contact the extension publisher through the Chrome Web Store listing or the project repository where this extension is published.
