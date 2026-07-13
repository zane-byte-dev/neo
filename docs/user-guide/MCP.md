# MCP（已迁移）

Neo 不再包含 MCP loader，也不再读取 `{workDir}/mcp.json`。通用 MCP server 由 Pi 或可选 ATX 配置；ATM 提供可选的 knowledge、memory 与 artifact MCP 工具。

ATM 是否在线不会影响普通 Neo → Pi 会话。当前边界见 [Pi 会话与 ATM 运行说明](AGENT_RUNTIME.md)。
