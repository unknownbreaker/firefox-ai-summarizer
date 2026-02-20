# Release Tooling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A single `./release.sh` shell script that auto-bumps version from conventional commits, generates grouped changelog, builds `.xpi`, and publishes GitHub Releases.

**Architecture:** Pure shell script using `jq` for manifest editing, `git log` for commit parsing, `web-ext build` for `.xpi` packaging, and `gh` for GitHub Release creation. No new dependencies.

**Tech Stack:** Bash, jq, git, web-ext, gh (GitHub CLI)

---

### Task 1: Add `.gitignore` and update `web-ext-config.cjs`

**Files:**
- Create: `.gitignore`
- Modify: `web-ext-config.cjs`

**Step 1: Create `.gitignore`**

```
web-ext-artifacts/
```

**Step 2: Update `web-ext-config.cjs` with `ignoreFiles`**

```javascript
module.exports = {
  run: {
    firefox: "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox",
  },
  ignoreFiles: [
    "docs/",
    "test/",
    "generate_icons.py",
    "web-ext-config.cjs",
    "CHANGELOG.md",
    "release.sh",
    ".gitignore",
  ],
};
```

**Step 3: Commit**

```bash
git add .gitignore web-ext-config.cjs
git commit -m "chore: add .gitignore and web-ext build ignore list"
```

---

### Task 2: Write `release.sh` — argument parsing and prerequisites check

**Files:**
- Create: `release.sh`

**Step 1: Create `release.sh` with shebang, strict mode, and argument parsing**

The script accepts `--dry-run` as an optional flag. It checks that all required tools are available (`jq`, `gh`, `git`, `web-ext`), that the working tree is clean, and that we're on the `main` branch.

```bash
#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: ./release.sh [--dry-run]"
      echo "  --dry-run  Show what would happen without making changes"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./release.sh [--dry-run]"
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check prerequisites
for cmd in jq gh git web-ext; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is not installed."
    exit 1
  fi
done

# Check working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Check we're on main
BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo "Error: Must be on main branch (currently on $BRANCH)."
  exit 1
fi
```

**Step 2: Make executable and test**

```bash
chmod +x release.sh
./release.sh --help
```

Expected: Prints usage and exits 0.

**Step 3: Commit**

```bash
git add release.sh
git commit -m "feat: add release.sh skeleton with arg parsing and prereq checks"
```

---

### Task 3: Write `release.sh` — commit parsing and bump detection

**Files:**
- Modify: `release.sh`

**Step 1: Add commit parsing and bump type detection after the prereq checks**

Appended to `release.sh`:

```bash
# Get last tag, or use root commit if no tags exist
LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [ -z "$LAST_TAG" ]; then
  COMMIT_RANGE="HEAD"
else
  COMMIT_RANGE="${LAST_TAG}..HEAD"
fi

# Check there are commits to release
COMMIT_COUNT="$(git rev-list --count "$COMMIT_RANGE")"
if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "No new commits since $LAST_TAG. Nothing to release."
  exit 0
fi

# Detect bump type from conventional commits
BUMP="patch"
while IFS= read -r hash; do
  SUBJECT="$(git log -1 --format='%s' "$hash")"
  BODY="$(git log -1 --format='%b' "$hash")"

  if echo "$BODY" | grep -q "BREAKING CHANGE"; then
    BUMP="major"
    break
  fi

  if echo "$SUBJECT" | grep -q "^feat"; then
    if [ "$BUMP" != "major" ]; then
      BUMP="minor"
    fi
  fi
done < <(git rev-list "$COMMIT_RANGE")

# Read current version and compute next
CURRENT_VERSION="$(jq -r '.version' manifest.json)"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEXT_VERSION="${MAJOR}.${MINOR}.${PATCH}"

echo "Bump type: $BUMP"
echo "Version: $CURRENT_VERSION → $NEXT_VERSION"
```

**Step 2: Test with `--dry-run` (manual verification)**

```bash
./release.sh --dry-run
```

Expected: Prints bump type and version change. Note: this will fail on the clean working tree check since we have uncommitted changes — test after committing.

**Step 3: Commit**

```bash
git add release.sh
git commit -m "feat: add commit parsing and semver bump detection to release.sh"
```

---

### Task 4: Write `release.sh` — changelog generation

**Files:**
- Modify: `release.sh`

**Step 1: Add changelog generation function after the version computation**

Appended to `release.sh`:

```bash
# Generate changelog
RELEASE_DATE="$(date +%Y-%m-%d)"
CHANGELOG_HEADER="## v${NEXT_VERSION} (${RELEASE_DATE})"

# Categorize commits
FEATURES=""
FIXES=""
REFACTORS=""
DOCS=""
TESTS=""
OTHER=""

while IFS= read -r hash; do
  SUBJECT="$(git log -1 --format='%s' "$hash")"
  SHORT_HASH="$(git log -1 --format='%h' "$hash")"

  case "$SUBJECT" in
    feat:*|feat\(*)
      MSG="${SUBJECT#feat: }"
      MSG="${MSG#feat\(*\): }"
      MSG="$(echo "$SUBJECT" | sed -E 's/^feat(\([^)]*\))?: //')"
      FEATURES="${FEATURES}- ${MSG} (${SHORT_HASH})\n"
      ;;
    fix:*|fix\(*)
      MSG="$(echo "$SUBJECT" | sed -E 's/^fix(\([^)]*\))?: //')"
      FIXES="${FIXES}- ${MSG} (${SHORT_HASH})\n"
      ;;
    refactor:*|refactor\(*)
      MSG="$(echo "$SUBJECT" | sed -E 's/^refactor(\([^)]*\))?: //')"
      REFACTORS="${REFACTORS}- ${MSG} (${SHORT_HASH})\n"
      ;;
    docs:*|docs\(*)
      MSG="$(echo "$SUBJECT" | sed -E 's/^docs(\([^)]*\))?: //')"
      DOCS="${DOCS}- ${MSG} (${SHORT_HASH})\n"
      ;;
    test:*|test\(*)
      MSG="$(echo "$SUBJECT" | sed -E 's/^test(\([^)]*\))?: //')"
      TESTS="${TESTS}- ${MSG} (${SHORT_HASH})\n"
      ;;
    *)
      OTHER="${OTHER}- ${SUBJECT} (${SHORT_HASH})\n"
      ;;
  esac
done < <(git rev-list "$COMMIT_RANGE")

# Build changelog body
CHANGELOG_BODY=""
if [ -n "$FEATURES" ]; then
  CHANGELOG_BODY="${CHANGELOG_BODY}\n### Features\n${FEATURES}"
fi
if [ -n "$FIXES" ]; then
  CHANGELOG_BODY="${CHANGELOG_BODY}\n### Bug Fixes\n${FIXES}"
fi
if [ -n "$REFACTORS" ]; then
  CHANGELOG_BODY="${CHANGELOG_BODY}\n### Refactoring\n${REFACTORS}"
fi
if [ -n "$DOCS" ]; then
  CHANGELOG_BODY="${CHANGELOG_BODY}\n### Documentation\n${DOCS}"
fi
if [ -n "$TESTS" ]; then
  CHANGELOG_BODY="${CHANGELOG_BODY}\n### Tests\n${TESTS}"
fi
if [ -n "$OTHER" ]; then
  CHANGELOG_BODY="${CHANGELOG_BODY}\n### Other Changes\n${OTHER}"
fi

RELEASE_NOTES="${CHANGELOG_HEADER}${CHANGELOG_BODY}"

echo ""
echo "--- Release Notes ---"
echo -e "$RELEASE_NOTES"
echo "---------------------"
```

**Step 2: Commit**

```bash
git add release.sh
git commit -m "feat: add changelog generation to release.sh"
```

---

### Task 5: Write `release.sh` — version bump, build, tag, and publish

**Files:**
- Modify: `release.sh`

**Step 1: Add the release execution block (respects `--dry-run`)**

Appended to `release.sh`:

```bash
if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[dry-run] Would update manifest.json version to $NEXT_VERSION"
  echo "[dry-run] Would prepend release notes to CHANGELOG.md"
  echo "[dry-run] Would commit, tag v${NEXT_VERSION}, and push"
  echo "[dry-run] Would run web-ext build"
  echo "[dry-run] Would create GitHub Release v${NEXT_VERSION} with .xpi attached"
  exit 0
fi

# 1. Update manifest.json version
UPDATED="$(jq --arg v "$NEXT_VERSION" '.version = $v' manifest.json)"
echo "$UPDATED" > manifest.json

# 2. Prepend to CHANGELOG.md
CHANGELOG_CONTENT="$(echo -e "$RELEASE_NOTES")"
if [ -f CHANGELOG.md ]; then
  EXISTING="$(cat CHANGELOG.md)"
  printf '%s\n\n%s\n' "$CHANGELOG_CONTENT" "$EXISTING" > CHANGELOG.md
else
  printf '# Changelog\n\n%s\n' "$CHANGELOG_CONTENT" > CHANGELOG.md
fi

# 3. Commit and tag
git add manifest.json CHANGELOG.md
git commit -m "chore(release): v${NEXT_VERSION}"
git tag -a "v${NEXT_VERSION}" -m "Release v${NEXT_VERSION}"

# 4. Build .xpi
web-ext build --overwrite-dest
XPI_FILE="$(ls web-ext-artifacts/*.zip 2>/dev/null | head -1)"
if [ -z "$XPI_FILE" ]; then
  echo "Error: web-ext build did not produce output."
  exit 1
fi
RENAMED_XPI="web-ext-artifacts/ai-summarizer-${NEXT_VERSION}.xpi"
mv "$XPI_FILE" "$RENAMED_XPI"

# 5. Push commit and tag
git push origin main
git push origin "v${NEXT_VERSION}"

# 6. Create GitHub Release
gh release create "v${NEXT_VERSION}" \
  "$RENAMED_XPI" \
  --title "v${NEXT_VERSION}" \
  --notes "$CHANGELOG_CONTENT"

echo ""
echo "Released v${NEXT_VERSION}!"
echo "  GitHub Release: $(gh release view "v${NEXT_VERSION}" --json url -q '.url')"
```

**Step 2: Commit**

```bash
git add release.sh
git commit -m "feat: add build, tag, and publish to release.sh"
```

---

### Task 6: End-to-end dry-run test

**Files:**
- None modified — verification only.

**Step 1: Run dry-run and verify output**

```bash
./release.sh --dry-run
```

Expected output should show:
- Bump type detected (should be `minor` because there are `feat:` commits)
- Version: `0.1.0 → 0.2.0`
- Release notes with Features, Bug Fixes, and Documentation sections
- Dry-run messages about what would happen

**Step 2: Verify the changelog grouping is correct**

Manually check that:
- `feat:` commits appear under `### Features`
- `fix:` commits appear under `### Bug Fixes`
- `docs:` commits appear under `### Documentation`
- No commit is missing

**Step 3: Final commit of any fixes found during testing**

```bash
git add -A
git commit -m "fix: address issues found during release.sh dry-run testing"
```

(Only if there were issues to fix.)

---

### Task 7: Commit plan and design docs

**Step 1: Commit the design and implementation plan**

```bash
git add docs/plans/2026-02-09-release-tooling-design.md docs/plans/2026-02-09-release-tooling-implementation.md
git commit -m "docs: add release tooling design and implementation plan"
```

---

## Notes

- **web-ext version issue:** The globally installed `web-ext` has a Node v18 incompatibility (`tracingChannel` is not a function). You may need to upgrade Node (v20+) or reinstall `web-ext` before running a real release. The script checks for `web-ext` availability as a prerequisite.
- **First release:** Since no tags exist, the script will parse ALL commits when run for the first time. This is correct — the first release changelog will contain the full project history.
- **Scope prefixes:** The sed patterns handle both `feat: msg` and `feat(scope): msg` formats.
