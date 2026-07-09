# claude-code-plugins

Personal [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin marketplace for [@badjilounes](https://github.com/badjilounes).

## Add the marketplace

```bash
claude plugin marketplace add badjilounes/claude-code-plugins
```

## Plugins

| Plugin | Install | What it does |
| --- | --- | --- |
| **CodBoard** | `claude plugin install codboard@badjilounes` | The [CodBoard](https://github.com/badjilounes/board) MCP server + the watcher workflow as on-demand skills. Browser OAuth — no key to paste. See [`plugins/codboard`](plugins/codboard). |

## Layout

```
.claude-plugin/
└── marketplace.json          # catalog: lists each plugin → ./plugins/<name>
plugins/
└── codboard/                  # the CodBoard plugin (manifest, .mcp.json, skills, README)
```

The catalog lives at the repo **root** (`.claude-plugin/marketplace.json`) because
`claude plugin marketplace add <owner/repo>` reads the manifest from the root of the remote
repo — there is no `owner/repo/subdir` shorthand. Each plugin, however, can live in a
subdirectory referenced by its `source` (`./plugins/codboard`).
