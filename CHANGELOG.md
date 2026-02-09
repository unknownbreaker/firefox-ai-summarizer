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
