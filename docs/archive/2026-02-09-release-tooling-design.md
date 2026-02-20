# Release Tooling Design

## Goal

A single `./release.sh` shell script that automates versioning, changelog generation, building, and GitHub Release publishing with zero new dependencies beyond tools already installed (`jq`, `gh`, `git`, `web-ext`).

## Version Bumping

- Reads current version from `manifest.json` via `jq`.
- Parses commits since the last git tag (or all commits if no tag exists).
- Auto-detects bump type from conventional commits:
  - `BREAKING CHANGE` in body/footer → **major**
  - `feat:` prefix → **minor**
  - Anything else (`fix:`, `docs:`, `refactor:`, etc.) → **patch**
  - Highest applicable bump wins.
- Updates `manifest.json` version via `jq`.

## Changelog Generation

- Groups commits since last tag by conventional commit prefix:
  - `feat:` → Features
  - `fix:` → Bug Fixes
  - `refactor:` → Refactoring
  - `docs:` → Documentation
  - `test:` → Tests
  - Everything else → Other Changes
- Each entry is a bullet with the message (prefix stripped) and short commit hash.
- Changelog is prepended to `CHANGELOG.md` (cumulative) and used as GitHub Release body.

### Format

```
## v0.2.0 (2026-02-09)

### Features
- Add settings page with provider config (bf3bde0)

### Bug Fixes
- Resolve sidebar injection races (b2bb0b4)
```

## Build

- Uses `web-ext build` to produce the `.xpi`.
- `web-ext-config.cjs` updated with `ignoreFiles` to exclude dev artifacts:
  - `docs/`, `test/`, `generate_icons.py`, `web-ext-config.cjs`, `CHANGELOG.md`, `release.sh`, `.gitignore`
- Output `.xpi` renamed to `ai-summarizer-{version}.xpi` in `web-ext-artifacts/`.

## Publish Flow

1. Bump version in `manifest.json` via `jq`.
2. Generate grouped changelog, prepend to `CHANGELOG.md`.
3. Commit version bump + changelog, create annotated tag `v{version}`.
4. Run `web-ext build` to produce `.xpi`.
5. Push commit + tag to remote.
6. Create GitHub Release via `gh release create` with changelog body and `.xpi` asset.

## Flags

- `--dry-run`: Print what would happen without making changes.

## New Files

- `release.sh` — the release script.
- `.gitignore` — excludes `web-ext-artifacts/`.
- `CHANGELOG.md` — created on first release.

## Updated Files

- `manifest.json` — version bumped each release.
- `web-ext-config.cjs` — `ignoreFiles` added.
