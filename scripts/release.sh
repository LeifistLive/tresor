#!/usr/bin/env sh
# Usage: ./scripts/release.sh 1.1.0
# Bumps all package versions, dates the CHANGELOG entry, commits and creates the tag v<version>.
# Pushing the tag (git push --follow-tags) triggers the GitHub release workflow.
set -eu

cd "$(dirname "$0")/.."
VERSION="${1:-}"
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "Usage: $0 <major.minor.patch>" >&2; exit 1 ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean – commit or stash first." >&2
  exit 1
fi
if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "CHANGELOG.md has no '## [Unreleased]' section." >&2
  exit 1
fi

npm version "$VERSION" --workspaces --include-workspace-root --no-git-tag-version >/dev/null
npm install --package-lock-only --no-audit --no-fund >/dev/null

TODAY="$(date +%Y-%m-%d)"
awk -v v="$VERSION" -v d="$TODAY" '
  /^## \[Unreleased\]/ && !done { print; print ""; print "## [" v "] - " d; done=1; next }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

git add -A
git commit -m "chore(release): v${VERSION}"
git tag -a "v${VERSION}" -m "Tresor v${VERSION}"

echo "Release v${VERSION} prepared. Publish it with:"
echo "  git push --follow-tags"
