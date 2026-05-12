# MCP 配置指南

Neo 支持通过 MCP stdio server 扩展工具能力。配置文件位于 `{workDir}/mcp.json`，也可以在 Web UI 的 `Settings / Advanced / MCP Servers` 中管理。

## mcp.json 格式

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"],
      "env": {},
      "cwd": "/Users/me/projects"
    }
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `command` | 是 | 启动 MCP server 的命令，例如 `npx`、`node`、`python` |
| `args` | 否 | 命令参数数组 |
| `env` | 否 | 传给该 MCP server 的环境变量 |
| `cwd` | 否 | 启动目录，默认使用当前用户的 `workDir` |

## 工具命名规则

MCP server 暴露的工具会被注册成：

```text
mcp__<serverName>__<toolName>
```

例如 `filesystem` server 的 `read_file` 工具会变成 `mcp__filesystem__read_file`。这样可以避免与 Neo 内置工具重名。MCP 工具默认按危险工具处理，开启工具确认时会要求用户批准。

## 常用示例

### Filesystem

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
    }
  }
}
```

### GitHub

不同 GitHub MCP server 的包名和环境变量可能不同，建议按该 server 官方 README 配置。典型形态如下：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@some/github-mcp-server"],
      "env": {
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

不要把长期 token 提交到仓库；如果 `workDir` 受 git 管理，建议把 `mcp.json` 加入本地 ignore 或使用只读/低权限 token。

## 生效方式

- 修改 `Settings / Advanced / MCP Servers` 会写入 `{workDir}/mcp.json` 并刷新用户缓存。
- 手动编辑 `mcp.json` 后，调用 `POST /api/reload` 或重启后端。
- 启动或 reload 时，Neo 会尝试连接每个 server 并执行 `tools/list`；失败的 server 会被跳过，不会阻断其它工具加载。

## 排查

- 如果 `Settings / Basic / Overview` 的系统状态显示需要处理，但 Models 正常，优先检查 MCP 页面里的命令、参数和工作目录是否可用。
- 设置 `LOG_LEVEL=debug` 后查看 `logs/YYYY-MM-DD.jsonl` 和后端控制台。
- 先在终端手动运行 `command + args`，确认 server 能启动。
- 如果 Agent 找不到工具，检查工具名是否带有 `mcp__server__tool` 前缀。
- 如果工具调用卡住，检查该 MCP server 是否需要交互式登录；stdio server 应该能非交互启动。