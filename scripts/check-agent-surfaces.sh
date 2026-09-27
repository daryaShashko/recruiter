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

# Path references in docs must resolve the same way locally and in CI, so "exists" means
# tracked by git (a file, or a directory with tracked files). Allowed without being tracked:
# - local-only paths matched by .gitignore (for example n8n/workflows/*.json exports,
#   scraper/output/, scraper/.env), and the n8n/workflows/ directory itself;
# - PLANNED_PATHS: files that current docs explicitly describe as not created yet or as
#   generated at run time. Keep this list short and give the reason for each entry.
PLANNED_PATHS=(
  ".github/workflows/test.yml"      # context/modules/ci.yaml: status not_created
  "scraper/promptfoo-results.json"  # written by prompt-eval.yml at run time (artifact)
)
path_ok() {
  local p="$1" planned
  [[ -n "$(git ls-files -- "$p" 2>/dev/null | head -1)" ]] && return 0
  git check-ignore -q --no-index -- "$p" 2>/dev/null && return 0
  [[ "$p" == n8n/workflows || "$p" == n8n/workflows/* ]] && return 0
  for planned in "${PLANNED_PATHS[@]}"; do [[ "$p" == "$planned" ]] && return 0; done
  return 1
}
# Normalise candidate paths read from stdin: drop placeholders (<name>), anchors, and
# trailing punctuation; skip globs and templates. Prints one path per line.
clean_paths() {
  sed -E 's/<.*$//; s/#.*$//; s/[),.:;]+$//' \
    | grep -E '^(\.agents|\.claude|\.github|context|docs|n8n|scraper|scripts)/' \
    | grep -v '[*{$]' | sort -u
}

# 5. Repository paths named in canonical instructions exist.
# Checks backticked paths that start with a known top-level directory (AGENTS.md in
# full, table rows only in docs/agent-tools.md, whose prose lists forbidden examples).
missing=""
for doc in AGENTS.md docs/agent-tools.md; do
  while IFS= read -r p; do
    path_ok "$p" || missing+="$doc:$p "
  done < <(grep -E "$([[ "$doc" == AGENTS.md ]] && echo '.' || echo '^\|')" "$doc" \
    | grep -o '`[^` ]*`' | tr -d '`' | clean_paths)
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

# 8. Current-state notes name only paths that exist (see path_ok above).
# Scope: context notes and current docs. History and plans are excluded because they
# legitimately name removed or future files: context/roadmap.yaml, context/decisions.yaml,
# docs/adr/, docs/benchmarks/, docs/post-mortem.md, docs/pe-tuning-log.md, and
# docs/agent-navigation-remediation.md. Markdown: backticked paths. YAML: values of
# file: and path: keys. (git pathspec * also matches "/", so subdirectories are included.)
CURRENT_MD="$(git ls-files 'context/*.md' 'docs/*.md' \
  | grep -v -E '^docs/(adr|benchmarks)/|^docs/(post-mortem|pe-tuning-log|agent-navigation-remediation|agent-tools)\.md$' \
  | sort -u)"
CURRENT_YAML="$(git ls-files 'context/*.yaml' \
  | grep -v -E '^context/(roadmap|decisions)\.yaml$' | sort -u)"
missing=""
for doc in $CURRENT_MD; do
  [[ -f "$doc" ]] || continue
  while IFS= read -r p; do
    path_ok "$p" || missing+="$doc:$p "
  done < <(grep -o '`[^` ]*`' "$doc" | tr -d '`' | clean_paths)
done
for doc in $CURRENT_YAML; do
  [[ -f "$doc" ]] || continue
  while IFS= read -r p; do
    path_ok "$p" || missing+="$doc:$p "
  done < <(grep -E '^[[:space:]]*-?[[:space:]]*(file|path):[[:space:]]' "$doc" \
    | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]+#.*$//; s/^["'"'"']//; s/["'"'"',]*$//' \
    | clean_paths)
done
if [[ -z "$missing" ]]; then
  pass "paths named in current context/ and docs/ notes exist (or are local-only/planned)"
else
  fail "current notes name missing paths: $missing"
fi

# 9. No current note claims that local-only n8n workflow exports are in the repository.
# n8n/workflows/*.json is gitignored (personal IDs). A line that names n8n/workflows/ and
# says the file is in the repository fails unless the same line also marks it as local,
# gitignored, or not in the repository. Same exclusions as check 8, applied to all
# tracked Markdown and YAML files.
claims="$(git ls-files '*.md' '*.yaml' '*.yml' \
  | grep -v -E '^docs/(adr|benchmarks)/|^docs/(post-mortem|pe-tuning-log|agent-navigation-remediation)\.md$|^context/(roadmap|decisions)\.yaml$' \
  | while IFS= read -r f; do [[ -f "$f" ]] && grep -H -n -i 'n8n/workflows' "$f"; done \
  | grep -i -E 'в репозитори|в репо |in (the|this) repo|checked[ -]in|committed (to|in)|tracked (in|by) git|stored in git' \
  | grep -v -i -E 'локальн|local|gitignor|not in (the|this) repo|нет в репозитори|не в репозитори|не хранится|not committed|never commit|не коммит' \
  | cut -d: -f1,2)"
if [[ -z "$claims" ]]; then
  pass "no note claims n8n/workflows/*.json is in the repository"
else
  fail "notes claim local-only n8n exports are in the repository: $(echo "$claims" | tr '\n' ' ')"
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
