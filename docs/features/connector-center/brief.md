# Connector Center

> Status: Draft  
> Source: [桌面 AI 助手能力补齐 Product Brief](../../product/DESKTOP_AI_ASSISTANT_GAP_BRIEF.md)  
> Priority: P0.3

## Background

Neo 当前支持 MCP stdio server，用户可以通过 `{workDir}/mcp.json` 暴露外部工具给 Agent。配置方式见 [MCP.md](../../user-guide/MCP.md)。

这个底座让 Neo 能接入外部系统，但体验仍偏工程化：用户需要知道 MCP server 包名、命令参数、环境变量、cwd、token 保存方式和日志排查路径。Claude Desktop 类产品已经把类似能力产品化为 Extensions / Connectors：一键安装、状态可见、权限可控、凭据安全保存。

Connector Center 的目标是把 MCP 和外部工具连接从“手写 JSON”升级为“可发现、可配置、可测试、可控权”的产品能力。

## User Problem

- 用户想接 GitHub、Filesystem、Notion、Sentry、数据库等工具时，不知道如何写 MCP 配置。
- Token 和 API Key 容易被写进 `mcp.json`，存在泄露风险。
- 连接失败时，用户只能看通用错误或日志，不知道是命令不存在、cwd 错误、token 缺失还是 server 无工具。
- 一个 MCP server 可能暴露很多工具，用户无法在 UI 中逐个启用/禁用。
- 现有 MCP Servers 页更像配置编辑器，不像连接器中心。

## Goals

- 提供连接器列表，展示状态、工具数量、错误摘要和最近连接时间。
- 提供少量高频连接器模板，降低首次配置门槛。
- 支持敏感字段加密保存，不要求长期 token 写入 `mcp.json`。
- 支持一键测试连接和结构化错误反馈。
- 支持工具级启用/禁用，为后续 remote MCP、OAuth、resources/prompts 做好信息架构。

## Non-goals

- 首版不做完整连接器市场。
- 首版不强制实现 remote HTTP MCP transport，但需要预留数据模型。
- 首版不做完整 OAuth 授权流。
- 首版不承诺所有第三方 MCP server 都能自动适配。

## Proposed Experience

### 1. 入口与列表

升级 `Settings / Advanced / MCP Servers` 为 `Connectors`，或在其中增加连接器视图。

列表展示：

- 连接器名称
- 类型：stdio MCP / remote MCP / built-in template
- 状态：connected / disabled / failed / not configured
- 工具数量
- 最近测试时间
- 错误摘要
- 操作：测试、编辑、启用/禁用、删除

### 2. 模板配置

首批模板建议：

- Filesystem：选择允许访问的目录，生成 filesystem MCP 配置。
- GitHub：填写 token 或后续 OAuth，连接 GitHub MCP。
- Sentry 或 Notion：选择一个作为远程服务模板验证。

模板应把 command、args、cwd、必要 env 字段包装成表单。

### 3. 凭据处理

敏感字段不直接写入用户可提交的 `mcp.json`。

首版可复用现有 secrets 服务或新增 connector secrets namespace：

- 保存时加密。
- 展示时只显示 configured / not configured。
- 测试连接时注入到 MCP server env。

### 4. 工具控制

连接成功后展示 tools/list 结果：

- 工具名
- 描述
- 权限级别推断
- 启用/禁用开关

禁用的工具不进入 Agent tool registry。

### 5. 错误反馈

测试连接时至少区分：

- command not found
- cwd not found
- process exited
- timeout
- invalid JSON-RPC
- no tools exposed
- missing secret

## Acceptance Criteria

- 用户无需手写 JSON，即可创建至少一个模板连接器。
- 连接器测试失败时，UI 显示具体失败原因和建议动作。
- 连接成功后，用户能看到工具清单和工具数量。
- 用户能禁用某个工具，并确认它不会被注册到 Agent 可用工具里。
- 敏感字段不会明文写入可版本控制的配置文件。

## Open Questions

- `mcp.json` 是否继续作为最终配置来源，还是引入 `{stateDir}/connectors/` 作为新主存储。
- Secrets 是否复用现有 provider secrets 文件，还是按 connector 单独加密。
- 工具级启用/禁用规则应存储在 connector 配置，还是 tool approval / permission 层。