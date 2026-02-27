Run the release pipeline with a dry-run review checkpoint. Do all steps in order:

## Step 1: Pre-flight checks

1. Run `git status --porcelain` — if there are uncommitted changes, stop and tell me to commit or stash first.
2. Run `git branch --show-current` — if not on `main`, stop and tell me to switch branches.
3. If both pass, say "Pre-flight checks passed" and continue.

## Step 2: Dry run

Run `./release.sh --dry-run` and display the full output. This shows:
- Bump type (major/minor/patch) based on conventional commits
- Version transition (current → next)
- Generated release notes / changelog preview
- Summary of what the release will do

If the script exits with an error (e.g. no new commits), report the error and stop.

## Step 3: Confirm

Ask me to confirm before proceeding. Show the planned version number and ask:
"Proceed with the release?"

Do NOT continue until I explicitly confirm.

## Step 4: Execute release

Run `./release.sh` and display the full output. This will:
- Update `manifest.json` version
- Prepend release notes to `CHANGELOG.md`
- Commit, tag, and push
- Build the `.xpi` via `web-ext build`
- Create a GitHub Release with the `.xpi` attached

## Step 5: Report

Show the GitHub release URL from the script output (the last line). Confirm the release completed successfully.
