# Neo Roadmap

> 最后更新：2026-07-13。Neo 已收敛为 Pi 的内容生产 Web 客户端；知识、共享记忆、artifact 与调度归 ATM，ATX 是可选 provider 插件。

## 已完成的架构基线

- [x] Chat 与 Notebook Studio 统一走 Pi RPC，支持流式文本、thinking、工具活动、citation、abort 与 session 恢复。
- [x] Notebook、文章、周报、资讯能力迁为 Pi skills/extensions。
- [x] 知识、共享记忆和 artifact 通过可选 ATM HTTP/MCP 使用 Markdown/JSONL 事实源。
- [x] 删除 Neo 自有 LLM/tool loop、durable runtime、memory/indexing、sandbox、approval、MCP loader 与 Local AI Gateway。
- [x] 删除 Neo Cron/Webhook/Workflow executor；ATM 是唯一 scheduler。
- [x] Settings / Automations 通过受限的 `/api/atm/*` loopback 代理管理 ATM schedules/runs。
- [x] ATX 默认不加载；显式启用时作为 Pi provider extension 工作。
- [x] ATM 离线与普通 Neo → Pi 会话隔离。

## P0 — 收敛后的可靠性

- [ ] 为 Pi 进程异常退出、协议错误和 session 恢复增加更多端到端回归用例。
- [ ] 在 UI 中清晰显示当前 Pi provider/model、可选 ATX 状态和 Pi session 引用。
- [ ] 完善 ATM 与 Pi 不可用时的分层诊断，不把旁路故障误报为 Neo 整体离线。
- [ ] 为 Notebook citation 与 artifact provenance 增加跨重启一致性测试。

## P1 — 内容生产体验

- [ ] 为 ATM schedule 提供结构化表单和常用模板，替代直接编辑 JSON。
- [ ] 在 Automations 中关联展示 ATM run 事件与 Pi session 引用。
- [ ] 扩充文章、报告、资讯等 Pi skills，并提供可发现的参数说明。
- [ ] 改进文章段落批注、Slash 命令和既有 artifact 复用。
- [ ] 增强移动端和触屏操作体验。
- [ ] 为语音输入增加语言与自动发送偏好。

## P2 — 旁路与生态

- [ ] 增加邮件、RSS、文件变化等 ATM webhook 适配器。
- [ ] 增加 ATM run 终态的钉钉、邮件等通知渠道。
- [ ] 评估 Pi/ATM/ATX 稳定接口后的远程访问与多设备场景；当前仍坚持单机个人使用。
- [ ] 仅在真实检索质量不足时评估 embedding/vector store；现阶段继续使用文件扫描与内存 BM25。

## 不再规划在 Neo 内实现

- 第二套 agent runtime、模型路由器或工具循环。
- 第二套知识/记忆索引与 SQLite 事实源。
- 通用 Workflow DSL 或 Cron 执行器。
- provider 协议转换与本地模型网关。

这些能力分别由 Pi、ATM 和可选 ATX 负责。架构与验收依据见仓库根目录的 [`PLAN.md`](../../../PLAN.md)。
