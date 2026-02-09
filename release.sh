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
