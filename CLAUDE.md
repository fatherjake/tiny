# Claude Code

Shared project instructions live in `AGENTS.md`. Read that file first and treat it as the source of truth.

- Skills live in `.agents/skills/`. Claude Code reads `.claude/skills/`, so run `ln -s ../.agents/skills .claude/skills` once.
- MCP servers are listed in `.agents/mcp.json`. Link it as `.mcp.json` with `ln -s .agents/mcp.json .mcp.json`.
