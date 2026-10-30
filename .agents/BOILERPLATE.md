# agent-boilerplate-v2 (setup notes from the base repo)

A starting point for agent-ready repos: one shared `.agents/` folder, a small set of skills, and verification built in.

Copy `.agents/`, `.cursor/`, `.codex/`, `AGENTS.md`, `NOTICE.md` and `.gitignore` into a new project. Then run the `verify-create` skill in that project to generate its own `verify-<app>` skill with feature maps.

## Layout

```
.agents/
  mcp.json         the one MCP server list
  skills/          saiyan, task-create, task-execute, task-progress, typescript, commit, bruh, verify-create, verify-example
.cursor/mcp.json   -> ../.agents/mcp.json
.codex/mcp.json    -> ../.agents/mcp.json
AGENTS.md          instructions every agent reads
CLAUDE.md          pointer for Claude Code
```

## Where tools read config

- Skills: `.agents/skills/` is read by Cursor and Codex. Claude Code reads `.claude/skills/` (see `CLAUDE.md`).
- MCP: Cursor reads `.cursor/mcp.json`. Codex reads `.codex/config.toml`, not `.codex/mcp.json`. Claude Code reads `.mcp.json`.
- Keep skill names unique across this repo and your global skills. Cursor does not document which one wins on a clash.

## Known gaps

- `.codex/mcp.json` is a symlink as requested, but Codex documents `.codex/config.toml` (TOML) for project MCP servers. Generate that file from `.agents/mcp.json`, or Codex will not see the servers.
- `.agents/mcp.json` is not a documented path in Cursor or Codex. It is only the source file the symlinks point at.
- Symlinked MCP files and nested skills have not been tested with Cursor cloud agents.
