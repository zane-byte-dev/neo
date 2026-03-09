# Memory Server MCP

An MCP server that abstracts the memory management capabilities originally found in `memory-hook.sh`.

## Features

- **archive_session**: Archives a Gemini session into daily memory files (`history/memory/YYYY-MM-DD.md`) and extracts grammar audits.
- **update_grammar_log**: Extracts grammar audits from a session and updates the English learning log (`project/neo/src/English_Learning_Log.md`).

## Installation

```bash
cd apps/mcps/memory-server
npm install
npm run build
```

## Usage in Gemini CLI

Add to your `settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/Users/zhengchao/mox/neo/apps/mcps/memory-server/dist/index.js"]
    }
  }
}
```

## Tools

### `archive_session`
- `sessionPath`: Path to the session JSON file.
- `projectDir` (optional): Project root directory.

### `update_grammar_log`
- `sessionPath`: Path to the session JSON file.
- `projectDir` (optional): Project root directory.
