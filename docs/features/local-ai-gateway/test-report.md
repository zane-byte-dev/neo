# Local AI Gateway Test Report

日期：2026-05-30

## Scope

本轮实现 Local AI Gateway MVP：

- `/v1/models`
- `/v1/chat/completions` OpenAI-compatible 非流式 / 流式
- `/v1/messages` Anthropic Messages 非流式 / 流式
- per-user `gatewayToken` Bearer 鉴权
- gateway usage/cost 记录，caller 区分 `ai-gateway:openai` / `ai-gateway:anthropic`
- Anthropic `tools` 声明、`tool_use` 返回、`tool_result` 输入转换；Neo 不执行客户端工具

## Automated Validation

已执行：

```bash
npx vitest run src/routes/__tests__/ai-gateway.test.ts src/llm/gateway/__tests__/*.test.ts src/services/__tests__/ai-gateway-service.test.ts src/services/__tests__/user-service.test.ts
```

结果：通过，5 个测试文件，26 个测试。

覆盖点：

- Gateway 未启用、缺 token、错 token、正确 token。
- Basic Auth 开启时 `/v1/*` 仍使用 gateway Bearer token。
- `/v1/models`、OpenAI 非流式、OpenAI SSE、Anthropic 非流式、Anthropic SSE route 分流。
- OpenAI 文本消息 normalizer、非流式 response shape、SSE chunk / `[DONE]`。
- Anthropic system/text/tool_use/tool_result normalizer、message/event stream shape。
- Service 层 mock AI SDK 后确认 usage 写入和 Anthropic `tool_use` 透传。

已执行：

```bash
npm run build
```

结果：通过。

## Manual Smoke

本轮未执行真实 provider / Claude Code smoke，因为当前实现阶段主要通过 mock AI SDK 与协议 fixtures 验证；实际接入需要本机配置有效 provider key、gateway token，并确认当前 Claude Code 版本的自定义 Anthropic endpoint 环境变量仍为预期名称。

建议后续手工验证：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $NEO_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say hello in one sentence."}]}'
```

```bash
curl -N http://localhost:3000/v1/messages \
  -H "Authorization: Bearer $NEO_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude","stream":true,"max_tokens":128,"messages":[{"role":"user","content":"Count to three."}]}'
```

## Residual Risk

- Claude Code 的 endpoint 环境变量可能随版本变化，需要在真实客户端 smoke 后更新用户指南。
- Anthropic tool input streaming 目前以 `tool-call` 完成事件编码为 `input_json_delta`，已覆盖协议形状，但仍需真实 Claude Code 工具回合验证。
- OpenAI function calling / Responses API / Embeddings 不在本轮范围。