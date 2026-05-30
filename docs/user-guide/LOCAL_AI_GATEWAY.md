# Local AI Gateway

Neo 可以作为本机 OpenAI / Anthropic 兼容模型入口。外部客户端只需要配置 Neo 的本地 base URL 和 gateway token，由 Neo 负责隐藏真实 provider key、选择模型、fallback，并把调用写入 Models 使用记录。

## 启用方式

Gateway 默认关闭。推荐在 Web UI 中开启：

1. 打开 **Settings / Basic / Models**。
2. 在 **Local AI Gateway** 卡片打开开关。
3. 复制生成的 token 和 Base URL。完整 token 只会在生成 / 重置后显示一次，之后页面只显示脱敏尾号。

Provider API Key 仍在同一个 **Models** 页面中配置；不要把 Gemini、DeepSeek、OpenAI、Anthropic 等真实 key 发给外部客户端。

如果需要用文件托管或自动化部署，也可以给某个用户配置 `gatewayToken`。只要不存在 UI 写入的 `{stateDir}/gateway.json` 覆盖项，`/v1/*` 会继续识别这个字段：

```ts
// src/config.local.ts
import type { LocalConfig } from './config.js';

const config: LocalConfig = {
    USERS: [
        {
            id: 'alice',
            name: 'Alice',
            webToken: 'web-login-token',
            gatewayToken: 'long-random-gateway-token',
            workDir: '/abs/path/to/workspace',
            stateDir: '/abs/path/to/state',
        },
    ],
    SESSION_SECRET: 'long-random-session-secret',
};

export default config;
```

如果你使用首次启动生成的 `~/.neo/config.json`，也可以在对应 user 条目里增加同名字段。
在设置页关闭 Gateway 会写入用户状态文件，并覆盖配置文件中的静态 token。

## OpenAI 兼容接口

Base URL：

```bash
OPENAI_BASE_URL=http://localhost:3000/v1
OPENAI_API_KEY=<neo-gateway-token>
```

注意：`http://localhost:5173` 是前端开发服务器，不是 Gateway 服务。Gateway 默认运行在后端端口 `3000`。如果某个客户端的字段会自动追加 `/v1/models`、`/v1/chat/completions`，请填根地址 `http://localhost:3000`；如果字段明确叫 OpenAI `baseURL` / `OPENAI_BASE_URL`，请填 `http://localhost:3000/v1`。

支持接口：

| Endpoint | 说明 |
|----------|------|
| `GET /v1/models` | 返回当前可用 Neo 模型别名，包含 `auto` |
| `POST /v1/chat/completions` | OpenAI Chat Completions 文本接口，支持非流式和 SSE 流式 |

非流式 curl：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $NEO_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say hello in one sentence."}]}'
```

流式 curl：

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $NEO_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"flash","stream":true,"messages":[{"role":"user","content":"Count to three."}]}'
```

Node OpenAI SDK 示例：

```ts
import OpenAI from 'openai';

const client = new OpenAI({
    baseURL: 'http://localhost:3000/v1',
    apiKey: process.env.NEO_GATEWAY_TOKEN,
});

const res = await client.chat.completions.create({
    model: 'auto',
    messages: [{ role: 'user', content: 'Give me one concise idea.' }],
});

console.log(res.choices[0]?.message?.content);
```

## Anthropic / Claude Code 兼容接口

Base URL：

```bash
ANTHROPIC_BASE_URL=http://localhost:3000/v1
ANTHROPIC_AUTH_TOKEN=<neo-gateway-token>
ANTHROPIC_MODEL=claude
```

支持接口：

| Endpoint | 说明 |
|----------|------|
| `POST /v1/messages` | Anthropic Messages 文本接口，支持非流式和 SSE 流式 |

工具调用约束：客户端声明的 `tools` 会传给上游模型；模型返回的 `tool_use` 会按 Anthropic 格式返回给客户端。Neo 不会执行这些工具，也不会调用 Neo 自己的工具审批或 Agent Runtime。客户端下一轮传入 `tool_result` 时，Neo 会继续把它作为模型上下文转发。

非流式 curl：

```bash
curl http://localhost:3000/v1/messages \
  -H "Authorization: Bearer $NEO_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude","max_tokens":256,"messages":[{"role":"user","content":"Reply with one short sentence."}]}'
```

## 模型选择与 fallback

- `model: "auto"` 使用 Neo 的智能路由和 fallback chain。
- 指定 Neo alias，例如 `flash`、`deepseek`、`claude`、`gemma`，默认只使用该模型。
- 如需允许显式模型 fallback，增加请求头 `x-neo-allow-fallback: true`。
- Gateway 也接受 canonical provider model id，但推荐外部客户端使用 Neo alias。

## 错误码

| Code | HTTP | 含义 |
|------|------|------|
| `gateway_disabled` | 403 | 当前没有开启或配置任何 gateway token |
| `missing_gateway_token` | 401 | 未提供 `Authorization: Bearer ...` |
| `invalid_gateway_token` | 401 | token 不匹配任何用户 |
| `unknown_model` | 404 | 请求的模型名无法识别 |
| `provider_not_configured` | 400/401/403 | 所需 provider key 或代理配置缺失 |
| `upstream_rate_limited` | 429 | 上游 provider 限流 |
| `upstream_error` | 5xx | 上游 provider 失败或超时 |

## 使用记录

Gateway 调用会写入 `{stateDir}/usage.jsonl`，并在 token usage 汇总里带上 caller：

- `ai-gateway:openai`
- `ai-gateway:anthropic`

Models 页面可以继续看到模型、token、估算成本、fallback 等记录。