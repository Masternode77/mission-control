#!/bin/bash
# Generate reasoning documentation for a commit
# Usage: generate-reasoning.sh <commit-hash> "<commit-message>"
#
# Stores reasoning in .git/claude/commits/<hash>/reasoning.md
# This helps future sessions understand past decisions.

set -e

COMMIT_HASH="${1:-}"
COMMIT_MESSAGE="${2:-}"

if [[ -z "$COMMIT_HASH" ]]; then
  echo "Usage: $0 <commit-hash> \"<commit-message>\""
  exit 1
fi

# Get short hash
SHORT_HASH="${COMMIT_HASH:0:7}"

# Create directory
REASONING_DIR=".git/claude/commits/$SHORT_HASH"
mkdir -p "$REASONING_DIR"

# Get commit details
COMMIT_DATE=$(git show -s --format=%ci "$COMMIT_HASH" 2>/dev/null || echo "unknown")
COMMIT_AUTHOR=$(git show -s --format=%an "$COMMIT_HASH" 2>/dev/null || echo "unknown")
FILES_CHANGED=$(git show --stat --format="" "$COMMIT_HASH" 2>/dev/null | tail -1 || echo "unknown")

# Generate reasoning file
cat > "$REASONING_DIR/reasoning.md" << EOF
# Commit Reasoning: $SHORT_HASH

**Message:** $COMMIT_MESSAGE
**Date:** $COMMIT_DATE
**Author:** $COMMIT_AUTHOR
**Changes:** $FILES_CHANGED

## What was done
$(git show --stat --format="" "$COMMIT_HASH" 2>/dev/null || echo "Unable to retrieve")

## Files changed
\`\`\`
$(git diff-tree --no-commit-id --name-status -r "$COMMIT_HASH" 2>/dev/null || echo "Unable to retrieve")
\`\`\`

## Context
This reasoning file was auto-generated at commit time.
Edit this file to add notes about:
- Why certain approaches were chosen
- What alternatives were considered
- Any issues encountered during development
EOF

echo "Reasoning saved to $REASONING_DIR/reasoning.md"
