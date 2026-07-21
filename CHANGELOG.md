## v0.6.1 (2026-07-21)
### Bug Fixes
- make the install button actually download and keep the badge in sync with the popup (f043939)

## v0.6.0 (2026-07-21)
### Features
- show a NEW badge on the toolbar icon when an update is available (99c801e)

### Documentation
- add hero image showing a summary in the sidebar (2b282d9)
- move install section to the top of the README (619ad8a)
- rewrite README with current features and screenshots (814fcae)

## v0.5.0 (2026-07-08)
### Features
- add install-latest-release button to the popup (b6cc9af)

### Bug Fixes
- remove the 80k char cap on extracted article text (81dccb1)

### Other Changes
- chore(release): also attach a stable-named ai-summarizer.xpi to releases (1494dcd)

## v0.4.3 (2026-07-08)
### Bug Fixes
- gate injector to the sidebar panel and cut its CPU/memory overhead (0ccd130)

### Other Changes
- perf: cap extracted article text at 80k chars and skip no-op popup storage writes (278a483)

## v0.4.2 (2026-06-05)
### Bug Fixes
- wait for Gemini file upload to finish before submitting (98656e6)

## v0.4.1 (2026-06-05)
### Bug Fixes
- always start a fresh provider chat when summarizing (f94e94f)

## v0.4.0 (2026-06-04)
### Features
- add Gemini provider with file-attach via drag-drop (fa6e955)
- add --patch/--minor/--major bump override flags to release.sh (d5db59b)

### Bug Fixes
- insert Claude prompt without clearing ProseMirror editor (09da351)

### Documentation
- add model selection feature design (93585aa)

## v0.3.2 (2026-02-26)
### Bug Fixes
- add fallback submit selectors for resilient LLM form submission (8fa4fdc)

### Other Changes
- chore: add /release slash command for Claude Code (bd3949e)

## v0.3.1 (2026-02-20)
### Bug Fixes
- wait for submit button to be enabled before clicking (1843a46)
- restore "as though pasted" phrasing in article upload prompt (eacabe0)

### Other Changes
- Merge pull request #2 from unknownbreaker/worktree-article-extraction (0837307)

## v0.3.0 (2026-02-20)
### Features
- article extraction + file upload for LLM sidebar (5b8fd7e)
- add fileInputSelector to settings UI (bd678f3)
- add file upload + fallback chain to injector (ed2a56d)
- integrate article extraction into summarize handlers (fe5d5ff)
- add article extractor content script using Readability.js (f7cb70b)
- add fileInputSelector to provider configs (fda0710)
- add article prompt builder functions for file upload path (75443f0)
- bundle Mozilla Readability.js v0.6.0 for content script injection (2cacc95)

### Refactoring
- address code review suggestions (ee710f5)

### Documentation
- update CLAUDE.md with article extraction architecture (e5b1736)
- add article extraction implementation plan (ce5bd7c)
- add article extraction + file upload design (fc56d9b)
- consolidate AI onboarding context into CLAUDE.md (728ef1a)
- add CLAUDE.md, architecture doc, and archive historical plans (b72c964)

### Other Changes
- chore: add .claude/ to gitignore (fa40b77)
- Merge pull request #1 from unknownbreaker/docs/improve-ai-onboarding (34623f8)

# Changelog

## v0.2.0 (2026-02-09)
### Features
- add release script with version bump, changelog, build, and publish (55a154c)
- improve extension icons (81c3874)
- add settings page with provider config, presets, and general settings (bf3bde0)
- add toolbar popup UI with provider and preset selection (6e2dde0)
- add background script with orchestration, context menu, and injection pipeline (2a8c003)
- add extractor content script for text selection (c0b47b1)
- add injector content script for LLM web UI prompt injection (45b288e)
- add sidebar that loads LLM provider web UI (1f828b9)
- add prompt builder with page, tabs, and selection prompt construction (ec98268)
- add provider configuration module with defaults and storage (fa1133b)
- scaffold project structure and manifest (4e446ad)

### Bug Fixes
- resolve sidebar injection races and add context menu support (b2bb0b4)
- resolve critical injection pipeline, XSS, and messaging issues (6d0c29a)
- add JSDoc comments and validate all custom provider fields (ebb8475)

### Documentation
- add release tooling design and implementation plan (f33f3e2)
- add README with installation and usage guide (9569c56)
- add detailed implementation plan with 12 TDD tasks (29ec852)
- add initial design document for Firefox AI Summarizer (e7bc265)

### Other Changes
- chore: add generate_icons.py to .gitignore (0feb27a)
- chore: add .gitignore and web-ext build ignore list (3b0706c)
