# Local AI Gateway Product Brief

## Background

Neo 已经具备个人本地 AI gateway 的大部分底座：

- 后端 HTTP 服务基于 Koa，已承载 Web Chat、Models、Secrets、Workflow 等 API。
- LLM 层基于 Vercel AI SDK，统一接入 Gemini、DeepSeek、OpenAI、Anthropic、Claude Code 兼容代理和 Ollama。
- Models 页面已经有 provider 状态、模型别名、路由覆盖、使用记录和加密凭据管理。
- 现有路线图已经把多模型路由、fallback、预算统计作为 Neo 的核心能力。

当前缺口不是“Neo 能否调用不同模型”，而是“外部本地客户端能否把 Neo 当作统一模型入口”。例如 Claude Code、OpenAI SDK、Cursor-like 客户端或本机脚本，希望只配置一个本地 base URL 和 token，由 Neo 负责选择上游模型、隐藏真实 provider key、记录成本和做 fallback。

相关当前代码锚点：

- [src/llm/client.ts](../../../src/llm/client.ts)：当前 AI SDK 模型调用、streaming、fallback、usage 记录集中在这里。
- [src/config.ts](../../../src/config.ts)：模型别名、provider key accessor、Ollama / ACP 配置集中在这里。
- [src/routes/model.ts](../../../src/routes/model.ts)：模型列表、provider 状态、路由配置 API。
- [src/server.ts](../../../src/server.ts)：当前 Web cookie 鉴权只覆盖 `/api/*` 与 `/apps/*`，新增 gateway 不能裸挂公开路由。
- [docs/product/ROADMAP.md](../../product/ROADMAP.md)：多模型支持已包含 Claude Code 兼容代理、fallback 和模型路由。

## User Problem

个人用户在本机同时使用 Neo、Claude Code、OpenAI SDK 脚本、测试工具或其它 AI 客户端时，会遇到重复配置问题：

1. 每个客户端都要单独保存不同 provider 的 API key。
2. 客户端之间没有统一的路由策略、fallback、预算统计和 provider 健康状态。
3. 本地模型、云模型、Claude Code 代理、Gemini ACP 等能力无法作为一个统一入口提供给外部工具。
4. 真实 provider key 暴露给更多工具，密钥面扩大。

Neo 如果作为本地 gateway，可以让外部工具只知道：

- 一个本机 URL：`http://localhost:<port>/v1`
- 一个本地 gateway token
- 一个模型名或 `auto`

其余 provider key、模型选择、路由、fallback、usage 记录都留在 Neo 内部处理。

## Goals

- 提供个人本地 AI gateway，面向本机或可信局域网客户端。
- 首版支持 OpenAI Chat Completions 兼容接口，覆盖通用 SDK / curl / 简单工具。
- 首版支持 Anthropic Messages 兼容接口，优先面向 Claude Code 可连接。
- Gateway 默认不注入 Neo Web Chat 的系统提示、记忆、工具和安全确认，保持协议代理语义干净。
- 复用 Neo 已有模型别名、provider 配置、路由、fallback、用量和成本统计。
- 通过独立 Bearer token 鉴权，不依赖 Web cookie。
- Gateway 默认关闭；只有配置本地 gateway token 后才启用。

## Non-goals

- 不做企业级多租户 AI gateway、组织级计费、团队 key 管理或审计后台。
- 不追求兼容 LiteLLM / Portkey 的全部 provider、header、policy 和插件生态。
- 不把外部客户端请求接入 Neo Agent Runtime，不自动执行 Neo 内置工具。
- 不在首版实现 semantic cache、guardrails、复杂限流、负载均衡或多实例高可用。
- 不在首版替代现有 `/api/chat`；Web Chat 仍走 Neo 自己的 Agent/Chat 路径。

## Target Users And Scenarios

目标用户：

- 在本机运行 Neo 的个人开发者。
- 同时使用 Claude Code、OpenAI SDK 脚本、curl 或其它支持自定义 base URL 的 AI 客户端的人。
- 想把真实 provider key 只保存在 Neo，而不是散落到多个工具配置里的人。

核心场景：

1. 用户在 Neo Models 页面配置 Gemini / DeepSeek / OpenAI / Anthropic / Ollama 等 provider。
2. 用户在本地配置一个 gateway token。
3. 用户把外部客户端的 base URL 指向 `http://localhost:3000/v1`。
4. 外部客户端调用 `model=auto` 或 Neo 模型别名，例如 `flash`、`deepseek`、`claude`、`gemma`。
5. Neo 根据请求和配置选择模型，向上游 provider 发起请求，并以客户端期望的协议格式返回。
6. Neo 记录 gateway 调用的 usage/cost，用户仍可在 Models 使用记录里看到消耗。

## Proposed Experience

### OpenAI Compatible Clients

配置形态：

```bash
OPENAI_BASE_URL=http://localhost:3000/v1
OPENAI_API_KEY=<neo-gateway-token>
```

首版接口：

- `GET /v1/models`
- `POST /v1/chat/completions`

支持能力：

- `messages` 文本消息
- `model` 使用 Neo alias 或 canonical model id
- `stream: true` SSE
- `temperature`、`max_tokens`、`top_p` 的基础透传
- OpenAI 风格错误响应

### Claude Code / Anthropic Compatible Clients

候选配置形态以 Claude Code 当前版本支持的自定义 Anthropic endpoint 为准，验收时记录实测变量。预期形态：

```bash
ANTHROPIC_BASE_URL=http://localhost:3000/v1
ANTHROPIC_AUTH_TOKEN=<neo-gateway-token>
ANTHROPIC_MODEL=claude
```

首版接口：

- `POST /v1/messages`

支持能力：

- Anthropic `system` + `messages` 文本消息
- `stream: true` SSE
- 客户端提供的 `tools` 作为声明透传给上游模型
- 返回 `tool_use`，但不由 Neo 执行工具
- 接收后续 `tool_result` 消息并继续模型回合

关键约束：Claude Code 这类客户端自己管理文件系统和命令执行工具，Neo gateway 只负责模型协议转换，不应把请求接入 Neo 的工具注册表。

## Product Rules

- Gateway 与 Web Chat 分离：Web Chat 可以注入系统提示、记忆、工具和安全确认；Gateway 默认不注入。
- 显式模型优先：客户端指定具体模型时，Neo 不应静默换到不同能力模型；只有 `auto` 或明确允许 fallback 时才按路由链切换。
- 真实 key 不外泄：gateway 响应和错误不返回上游 provider key、完整 token 或本地 secrets 路径。
- 失败要可诊断：401、未知模型、provider 未配置、上游 429/5xx、协议不支持要有稳定错误码。
- 本地优先安全：未配置 gateway token 时 `/v1/*` 返回 404 或 403，不默认暴露模型能力。

## Success Criteria

- `curl` 使用 OpenAI Chat Completions 协议可以非流式和流式调用 Neo 模型。
- 一个 OpenAI SDK 客户端只配置 Neo base URL + token 即可调用 `model=auto`。
- Claude Code 可以通过 Anthropic Messages 协议完成一个简单问答回合。
- Claude Code 工具调用回合能被协议保真传递：Neo 不执行工具，只返回 `tool_use` / 接收 `tool_result`。
- Models 使用记录可以区分 gateway 调用来源，例如 `caller=ai-gateway:openai` 或 `ai-gateway:anthropic`。
- 无 token、错 token、未启用 gateway 的请求都不会访问上游 provider。

## Risks And Open Questions

- Claude Code 的自定义 endpoint 环境变量和请求细节可能随版本变化，需要以当前本机版本做 smoke test。
- AI SDK 的 tool-call 中间格式与 Anthropic `tool_use` / `tool_result` 的完全保真转换需要专项测试。
- OpenAI Chat Completions 与 Anthropic Messages 的 streaming 事件格式差异较大，建议用协议 encoder 单测覆盖。
- 如果未来要让 gateway 暴露到局域网，必须补限流、request body 限制、origin 说明和更强 token 生成策略。
