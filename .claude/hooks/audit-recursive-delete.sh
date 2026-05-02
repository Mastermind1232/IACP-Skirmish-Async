#!/bin/bash
# PreToolUse hook for Bash — when the command is a recursive delete
# (rm -rf, git rm -r, etc.), audit JS/TS imports of the target directory
# REPO-WIDE. If any importers exist outside the target, ask for explicit
# confirmation before allowing the deletion.
#
# Why this exists: 2026-05-01 incident — purged src/domain/ after grepping
# only src/ for imports. Missed that index.js (at the repo root, outside
# src/) had a dozen domain imports. npm test passed (tests don't load
# index.js); production crashed on startup. See
# memory/feedback_dead_scaffold_purge.md for the full lesson.

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Only fire on recursive directory deletes. Match common shapes.
case "$cmd" in
  *"rm -rf "*|*"rm -r "*|*"rm -fr "*|*"rm -Rf "*|*"rm -fR "*|*"rm -R "*|*"git rm -r"*|*"git rm -rf"*) ;;
  *) exit 0 ;;
esac

# Take the first rm/git-rm clause (stop at && / ; / |).
# Tokenize, drop flags + command words. Remaining tokens are candidate paths.
clause=$(echo "$cmd" | sed -E 's/(\&\&|;|\|\||\|).*//' | head -1)
paths=$(echo "$clause" | tr ' ' '\n' | grep -v '^$' | grep -v '^-' | \
  grep -v -E '^(rm|git|sudo|bash|sh|cd|&&|;)$' | head -10)

findings=""
for p in $paths; do
  p_clean="${p%/}"
  # Strip leading ./
  p_clean="${p_clean#./}"
  [ -z "$p_clean" ] && continue
  # Skip globs / wildcards / quoted strings
  case "$p_clean" in
    *"*"*|*"?"*|"\""*|"'"*) continue ;;
  esac
  # Only audit directories that exist
  [ ! -d "$p_clean" ] && continue

  seg=$(basename "$p_clean")
  # Match `from '...<seg>...'` and `import('...<seg>...')` style imports.
  # Excludes node_modules and the directory being deleted itself.
  hits=$(grep -rln -E "(from|import)\s*\(?\s*['\"][^'\"]*\b${seg}\b" \
    --include="*.js" --include="*.mjs" --include="*.ts" --include="*.cjs" \
    . 2>/dev/null | \
    grep -v "node_modules" | \
    grep -v "\\.claude/worktrees" | \
    grep -v "\\.claude/hooks" | \
    grep -v "^\\./${p_clean}/" | \
    grep -v "^\\./${p_clean}\$" | \
    head -10)

  if [ -n "$hits" ]; then
    findings="${findings}

Deleting '${p_clean}' — JS/TS files import something matching '${seg}':
${hits}"
  fi
done

if [ -n "$findings" ]; then
  reason="Recursive delete needs audit before proceeding.${findings}

If this is intentional: migrate or remove each importer first, OR confirm here that the matches above are unrelated.

Background: 2026-05-01 production crash — see memory/feedback_dead_scaffold_purge.md."

  jq -n --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: $r
    }
  }'
fi

exit 0
