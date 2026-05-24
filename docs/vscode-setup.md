# VS Code setup (from Zed settings)

This project can use the same MCP servers in Visual Studio Code through `.vscode/mcp.json`.

## 1) Prerequisites

- Install Visual Studio Code
- Install and sign in to GitHub Copilot (Copilot + Copilot Chat)
- Ensure Node.js and npm are installed (`npx` is required)

## 2) Configure environment variables

Add variables in your shell profile (`~/.zshrc` on macOS):

- `export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here`

Then reload shell:

- `source ~/.zshrc`

If `npx` is installed via `nvm`, start VS Code from the same shell session:

- `code .`

For Fetch MCP, install `uv`/`uvx` (one-time), then restart VS Code.

## 3) MCP servers config

This repository already contains workspace MCP config:

- `.vscode/mcp.json`

Open VS Code command palette and run:

- `MCP: List Servers`

Start and trust all required servers:

- `playwright`
- `github`
- `filesystem`
- `fetch`
- `sequential-thinking`

## 4) Verify tools are available

In Chat, ask:

- `List available MCP tools and confirm filesystem + github are enabled for this workspace.`

If a server fails:

- Run `MCP: List Servers` -> select server -> `Show Output`

## 5) Porting Zed assistant profiles

Zed `assistant.profiles` do not map 1:1 to VS Code settings. In VS Code, use customizations:

- Custom agents: create one per role (orchestrator, developer, architect, ...)
- Prompt files: create reusable slash commands for task templates
- Instructions files: store always-on project rules

Suggested locations in this repo:

- `.github/agents/` for custom agents
- `.github/prompts/` for prompt files
- `.github/copilot-instructions.md` for always-on instructions

Use command palette:

- `Chat: Open Customizations`
- `Chat: New Prompt File`
- `Chat: New Instruction File`

This repository already includes generated customizations:

- Custom agents in `.github/agents/`
	- `orchestrator`
	- `developer`
	- `architect`
	- `qa`
	- `n8n-specialist`
	- `devops`
	- `business-analyst`
	- `prompt-engineer`
- Prompt files in `.github/prompts/`
	- `session-start`
	- `task-brief`
	- `scraper-bugfix`
	- `adr-check`
	- `daily-triage`
	- `weekly-health-check`
	- `release-readiness`

In Chat:

- Select an agent from the agent dropdown.
- Type `/session-start` to begin according to your project protocol.

## 6) Security note

Never store real PAT in committed files. Use env vars only.

If a real token was exposed in any shared file or message, rotate/revoke it in GitHub settings immediately.
