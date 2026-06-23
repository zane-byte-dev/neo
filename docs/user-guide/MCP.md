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

`mcp.json` 顶层还支持 `disabledTools` 字段，用于按 server 关闭个别工具（见下文「禁用单个工具」）：

```json
{
  "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"] } },
  "disabledTools": {
    "filesystem": ["write_file"]
  }
}
```

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

## 连接器模板与连通性测试

`Settings / Advanced / MCP Servers` 现在支持基于模板创建连接器、保存前测试连通性、以及按工具开关。底层接口如下（也可直接调用）：

- `GET /api/mcp/templates`：列出内置模板。当前包含 `filesystem`（指定可访问目录）、`github`（填入 token）、`custom-stdio`（自定义命令）。模板会标注哪些字段是必填项和敏感项。
- `POST /api/mcp/test`：在保存前测试一份草稿配置，可传入原始 `{ command, args, env, cwd }`，也可以传入 `{ templateId, inputs }` 让后端展开模板。
- `POST /api/mcp/:name/test`：测试一个已保存的 server。

连通性测试会返回结构化的状态码，便于定位问题：

| 状态码 | 含义 |
|--------|------|
| `ok` | 连接成功，返回工具数量与列表 |
| `missing_secret` | 某个 env 值为空，通常是缺少 token |
| `cwd_not_found` | `cwd` 目录不存在 |
| `command_not_found` | 命令无法启动（ENOENT） |
| `process_exited` | server 启动后异常退出 |
| `timeout` | 在超时时间内未完成握手 |
| `invalid_rpc` | server 返回了非法的 JSON-RPC |
| `no_tools` | 连接成功但未暴露任何工具 |

## 禁用单个工具

可以在保留整个 server 的前提下关闭其中某个工具：

- 在 UI 中点击某个 server 的「测试连接」，连接成功后会列出其工具，每个工具旁的开关可即时启用 / 禁用。
- 对应接口 `PATCH /api/mcp/:name/tools/:tool`，body 为 `{ "enabled": false }`（或 `true` 恢复）。
- 该状态写入 `mcp.json` 的 `disabledTools` 字段，并在 `loader` 中**服务端强制生效**——被禁用的工具不会注册给 Agent，而不仅仅是在 UI 中隐藏。

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