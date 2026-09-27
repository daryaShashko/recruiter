# Agent tool adapters

The repository is tool-agnostic. All rules, roles, and skills live in plain files that any
agent can read; each tool gets only a thin adapter that points to them.

## Canonical layer

| What | Where | Notes |
|---|---|---|
| Instructions | `AGENTS.md` | The only place for repository rules. |
| Skills | `.agents/skills/<name>/SKILL.md` | Open Agent Skills format (`name` + `description` frontmatter). |
| Role notes | `docs/agents/*.md` | Plain-text domain rules and checklists; not agent definitions. |
| Project notes | `context/`, `docs/` | Supporting, may be stale; code and config are authoritative. |
| Tools | `npm` scripts in `scraper/`, `scripts/*.sh` | Any agent with a shell can run them. |
| Checks | `scripts/check-agent-surfaces.sh`, CI workflows | Enforcement lives in scripts, not in prompts. |

## Adapters

| Tool | Instructions | Skills |
|---|---|---|
| Codex CLI, Codex Desktop | Read `AGENTS.md` natively | Read `.agents/skills/` natively |
| Claude Code CLI | `CLAUDE.md` contains only `@AGENTS.md` (import) | `.claude/skills` is a symlink to `../.agents/skills` |
| VS Code (Copilot Chat) | Reads `AGENTS.md` when `chat.useAgentsMdFile` is enabled; `.github/copilot-instructions.md` is a pointer as a fallback | Via `.claude/skills` when agent skills are enabled in VS Code; verify in the installed version |
| VS Code with the Claude Code or Codex extension | Same files as the corresponding CLI | Same as the corresponding CLI |

Adapter rules:

- An adapter contains no rules of its own. `scripts/check-agent-surfaces.sh` fails if it does.
- Do not add tool-specific agent, prompt, or profile directories (for example
  `.github/agents/`, `.github/prompts/`, `.zed/`, `.cursor/`, `.codex/agents/`) without a
  demonstrated need recorded in `docs/agent-navigation-remediation.md`.
- To support a new tool, add one adapter row here and one pointer file, not a copy of the
  rules.

## MCP servers

No MCP server is required to work in this repository. If you use one (for example a
browser server for manual checks), configure it in your user-level tool settings, pin the
package version, and keep credentials in environment variables. Do not commit
machine-specific MCP configuration, and do not add a workspace `.vscode/mcp.json` for
personal servers.

Tool-specific or personal preferences follow the same rule: user-level config
(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, VS Code user settings), not the adapters.

### GitHub MCP

Use GitHub's official server, [`github/github-mcp-server`](https://github.com/github/github-mcp-server)
(checked 2026-09-27):

- **Preferred:** the remote server `https://api.githubcopilot.com/mcp/`, added in VS Code's
  user-level MCP settings. VS Code signs in with OAuth, so there is no token to create or
  store.
- **Local alternative:** the Docker image `ghcr.io/github/github-mcp-server`, pinned to a
  release tag from the repository's releases page. Pass the token through the
  `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable of your user session, with the
  minimum scopes needed.
- **Do not use** `@modelcontextprotocol/server-github`: it is deprecated on npm.
- A token pasted into a chat or a file is exposed. Revoke it and issue a new one.
