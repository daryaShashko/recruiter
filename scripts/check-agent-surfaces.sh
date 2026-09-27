#!/usr/bin/env bash
# Structural check for the tool-agnostic agent setup (Layer A in
# docs/agent-navigation-remediation.md). Prints PASS/WARN/FAIL per check and exits 1
# on any FAIL. Offline-safe: the npm registry check is skipped unless --online is given.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ONLINE="false"
[[ "${1:-}" == "--online" ]] && ONLINE="true"

FAILS=0
pass() { echo "PASS  $1"; }
warn() { echo "WARN  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }

# 1. No tracked file is matched by .gitignore.
tracked_ignored="$(git ls-files -ci --exclude-standard)"
if [[ -z "$tracked_ignored" ]]; then
  pass "no gitignored files are tracked"
else
  fail "gitignored files are tracked: $(echo "$tracked_ignored" | tr '\n' ' ')"
fi

# 2. Adapters are pointers only.
if [[ "$(cat CLAUDE.md 2>/dev/null)" == "@AGENTS.md" ]]; then
  pass "CLAUDE.md is a pointer to AGENTS.md"
else
  fail "CLAUDE.md must contain only '@AGENTS.md'"
fi

copilot=".github/copilot-instructions.md"
if [[ -f "$copilot" ]] && grep -q "AGENTS.md" "$copilot" && [[ "$(wc -l < "$copilot")" -le 6 ]]; then
  pass "$copilot is a pointer to AGENTS.md"
else
  fail "$copilot must be a short pointer to AGENTS.md (<= 6 lines)"
fi

if [[ -L .claude/skills && "$(readlink .claude/skills)" == "../.agents/skills" ]]; then
  pass ".claude/skills is a symlink to ../.agents/skills"
else
  fail ".claude/skills must be a symlink to ../.agents/skills"
fi

# 3. No tool-specific agent/prompt/profile surfaces.
for dir in .zed .github/agents .github/prompts .cursor .codex/agents .claude/agents .claude/commands; do
  if [[ -n "$(git ls-files "$dir" 2>/dev/null)" ]]; then
    fail "tool-specific surface is tracked: $dir (see docs/agent-tools.md)"
  fi
done
pass "tool-specific surface scan finished"

# 4. Every skill has name + description frontmatter matching its directory.
for skill in .agents/skills/*/; do
  name="$(basename "$skill")"
  file="$skill/SKILL.md"
  if [[ ! -f "$file" ]]; then
    fail "skill $name has no SKILL.md"
  elif [[ "$(head -1 "$file")" != "---" ]] \
    || ! grep -q "^name: $name$" "$file" \
    || ! grep -q "^description: ." "$file"; then
    fail "skill $name: SKILL.md needs frontmatter with 'name: $name' and a description"
  else
    pass "skill $name has valid frontmatter"
  fi
done

# 5. Repository paths named in canonical instructions exist.
# Checks backticked paths that start with a known top-level directory (AGENTS.md in
# full, table rows only in docs/agent-tools.md, whose prose lists forbidden examples). Paths under
# n8n/workflows/ are local-only by design and are skipped.
missing=""
for doc in AGENTS.md docs/agent-tools.md; do
  while IFS= read -r p; do
    p="${p%%<*}"          # drop placeholders such as <name>
    [[ "$p" == n8n/workflows/* ]] && continue
    [[ -z "$p" || "$p" == *'*'* ]] && continue
    [[ -e "$p" ]] || missing+="$doc:$p "
  done < <(grep -E "$([[ "$doc" == AGENTS.md ]] && echo '.' || echo '^\|')" "$doc" \
    | grep -o '`[^` ]*`' | tr -d '`' \
    | grep -E '^(\.agents|\.claude|\.github|context|docs|n8n|scraper|scripts)/' | sort -u)
done
if [[ -z "$missing" ]]; then
  pass "paths named in AGENTS.md and docs/agent-tools.md exist"
else
  fail "missing paths: $missing"
fi

# 6. No ${{ }} expression interpolated directly into a run: script.
injections="$(awk '
  FNR == 1 { in_run = 0 }
  /^[[:space:]]*(- )?run:[[:space:]]*\|/ { in_run = 1; indent = match($0, /[^ ]/); next }
  in_run {
    cur = match($0, /[^ ]/)
    if (cur > 0 && cur <= indent) { in_run = 0 }
    else if ($0 ~ /\$\{\{/) { print FILENAME ":" FNR }
  }
  /^[[:space:]]*(- )?run:[[:space:]]*[^|[:space:]]/ && /\$\{\{/ { print FILENAME ":" FNR }
' .github/workflows/*.yml)"
if [[ -z "$injections" ]]; then
  pass "no \${{ }} expressions inside run: scripts"
else
  fail "\${{ }} used inside run: (pass through env: instead): $(echo "$injections" | tr '\n' ' ')"
fi

# 7. Optional: MCP/npx packages referenced by committed config resolve on npm.
if [[ "$ONLINE" == "true" ]]; then
  pkgs="$(git ls-files '*.json' '*.toml' | xargs grep -ho '@modelcontextprotocol/[a-z-]*' 2>/dev/null | sort -u)"
  if [[ -z "$pkgs" ]]; then
    pass "no committed MCP package references"
  else
    for pkg in $pkgs; do
      if npm view "$pkg" version >/dev/null 2>&1; then pass "npm package resolves: $pkg"
      else fail "npm package does not resolve: $pkg"; fi
    done
  fi
else
  warn "npm registry check skipped (run with --online)"
fi

echo
if [[ "$FAILS" -gt 0 ]]; then
  echo "$FAILS check(s) failed."
  exit 1
fi
echo "All checks passed."
