# 桌面 AI 助手能力补齐 Product Brief

> 状态：Draft  
> 日期：2026-05-30  
> 目标：补齐 Neo 相比 Claude Desktop / Claude Code / ChatGPT Desktop 等成熟 AI 工作台的关键产品能力差距。  
> 相关文档：[COMPETITIVE_RESEARCH.md](COMPETITIVE_RESEARCH.md)、[ROADMAP.md](ROADMAP.md)、[PM_AUDIT_REPORT_2026-05-16.md](PM_AUDIT_REPORT_2026-05-16.md)

## 背景

Neo 已经具备个人 AI 运行时的核心底座：Web Chat、Notebook、Telegram Bot、多模型路由、工具/Skill、MCP stdio、Webhook/Cron/Workflow、Agent run 持久化、文章批注和知识索引。

但从产品竞争力看，Claude Desktop 这类产品已经把 AI 客户端体验推进到更完整的阶段：桌面入口、连接器目录、MCP/Extension 一键安装、OAuth 授权、资源/Prompt 可视化选择、长任务工作台、运行隔离、权限策略和企业级管理。Neo 现在的差距不在“有没有某个底层模块”，而在“这些能力是否被产品化到普通用户能稳定使用”。

因此本需求不是要求 Neo 复制 Claude Desktop，而是把落后的关键能力拆成可交付的产品能力包，让 Neo 从“开发者可配置的个人 AI 服务”升级为“普通高级用户也能持续依赖的个人 AI 工作台”。

## 当前证据与新鲜度核验

### 1. MCP 已有底座，但不是完整连接器体验

- [../user-guide/MCP.md](../user-guide/MCP.md) 说明 Neo 当前通过 `{workDir}/mcp.json` 配置 MCP stdio server。
- [../../src/mcp/stdio-client.ts](../../src/mcp/stdio-client.ts) 当前实现范围集中在 `initialize`、`tools/list`、`tools/call`，并明确未覆盖 resources、prompts、sampling 等高级能力。
- [../../src/mcp/loader.ts](../../src/mcp/loader.ts) 会把 MCP 工具统一注册为 `mcp__<server>__<tool>`，并默认按 dangerous 工具处理。

结论：Neo 具备 MCP 工具调用能力，但缺少远程 HTTP MCP、OAuth、连接状态、工具启停、资源/Prompt 选择、连接器目录和一键安装。

### 2. Workflow 已有 MVP，但创建和调试门槛偏高

- [../user-guide/AUTOMATION.md](../user-guide/AUTOMATION.md) 说明 Workflow 当前通过 JSON 编辑器维护，支持 `transform`、`agent`、`skill` 三类串行步骤。
- [../../src/services/workflow-service.ts](../../src/services/workflow-service.ts) 当前类型模型也只覆盖这三类步骤，没有 branch、retry、parallel、approval 等流程控制。
- [PM_AUDIT_REPORT_2026-05-16.md](PM_AUDIT_REPORT_2026-05-16.md) 已把“Workflow JSON 编辑器门槛高，缺模板引导”列为高优先级体验问题。

结论：Neo 的自动化方向正确，但还没有达到成熟工作台产品应有的“模板化、向导式、可排障”水平。

### 3. 知识索引已落地，但语义记忆和 RAG 飞轮未形成

- [ROADMAP.md](ROADMAP.md) 明确记录：统一知识索引、Notebook 精确引用已完成，但 Embedding、语义检索、自动记忆提取、记忆整合、对话摘要仍未完成。
- [../../src/indexing/search.ts](../../src/indexing/search.ts) 当前检索以 FTS + LIKE fallback 为主，中文和语义相似内容仍依赖精确文本命中。

结论：Neo 已有知识库入口，但与成熟知识型 AI 助手相比，还缺“自动召回长期知识、自动沉淀用户事实、越用越懂用户”的核心体验。

### 4. Agent run 可恢复，但缺少面向用户的运行控制台

- [../user-guide/AGENT_RUNTIME.md](../user-guide/AGENT_RUNTIME.md) 说明每个 run 已持久化 `run.json`、`events.jsonl`、`checkpoint.json`、`pending.json` 和 artifacts。
- 当前排障方式主要是查看磁盘文件和 JSONL 日志，PM 审计也指出“Agent 运行时调试面板”尚未实现。

结论：Neo 的运行时透明度底座优于普通聊天壳，但没有被包装成用户可理解的 Run Console。

## 用户问题

当前 Neo 的高级能力很多已经“技术上存在”，但用户实际使用时会遇到以下问题：

- 想接入 GitHub、Notion、Sentry、数据库、文件系统等外部系统时，需要手写 MCP JSON、处理命令、token、cwd、日志排查。
- 想让 Neo 利用自己的长期 Notebook 和记忆时，结果仍常依赖关键词命中，无法稳定召回语义相关材料。
- 想做日报、网页监控、资料汇总、自动归档等固定流程时，需要手写 Workflow JSON，而不是从模板或向导开始。
- 自动化或工具任务失败时，普通用户不知道 run 停在哪一步、哪个工具报错、是否可以重试或继续。
- 相比成熟桌面 AI 产品，Neo 的“连接、授权、执行、观察、复用”链路仍显得偏工程化。

这些问题会削弱 Neo 的核心定位：它明明有自托管、可编排、多模型、长期运行的优势，但用户很难把这些优势稳定转化成日常工作效率。

## 目标

本需求的目标是补齐四个产品化短板：

1. 让外部工具连接从“手写配置”升级为“连接器中心”。
2. 让 Notebook 和记忆从“可搜索”升级为“可语义召回、可自动沉淀”。
3. 让 Workflow 从“JSON 工程配置”升级为“模板和向导驱动的日常自动化”。
4. 让 Agent run 从“磁盘日志”升级为“可视化运行控制台”。

达成后，Neo 的差异化定位应更清楚：不是 Claude Desktop 的仿制品，而是自托管、可连接、可自动运行、以个人知识为核心的 AI 工作台。

## 非目标

- 本轮不优先开发原生 Electron/Tauri 桌面壳。
- 本轮不追求 Claude Desktop 级别的完整企业管理体系。
- 本轮不做通用 iPaaS 平台，也不复制 Zapier / n8n 的复杂拖拽编排器。
- 本轮不把所有外部系统都一次性接入，只选择少量高频连接器验证模型。
- 本轮不替代现有 Chat、Notebook、Skill、Tool，而是把它们产品化串起来。

## 目标用户与场景

目标用户：

- 已经愿意自托管 Neo 的个人高级用户。
- 需要长期管理资料、笔记、网页、代码仓库、自动化任务的知识工作者。
- 希望 AI 能连接自己常用系统，而不是每次手工复制上下文的用户。
- 需要后台定时运行、失败可排查、结果可追溯的用户。

核心场景：

1. 用户在连接器中心添加 GitHub MCP，完成 token 或 OAuth 授权后，Neo 能在 Chat / Workflow 中读取 issue、PR、仓库状态。
2. 用户提问“上次我们为什么决定这样设计？”时，Neo 自动从 Notebook、历史对话和长期记忆中召回相关材料，并带来源引用回答。
3. 用户从模板创建“每日晨报”：定时触发 -> 搜索新资料 -> 让 Agent 总结 -> 发 Telegram -> 写入 Notebook。
4. 自动化失败后，用户进入 Run Console，看到失败步骤、工具入参摘要、错误原因和重试入口。

## 需求范围

### P0.1 连接器中心

把 MCP 和外部工具从“配置文件能力”升级为用户可管理的连接器能力。

首版需求：

- 新增 `Settings / Advanced / Connectors` 或升级现有 MCP Servers 页。
- 支持连接器列表：名称、类型、状态、工具数量、最近连接时间、错误摘要。
- 支持内置模板：Filesystem、GitHub、Notion 或 Sentry 至少三类中任选两类先落地。
- 支持手动配置 stdio MCP，同时为 remote HTTP MCP 预留数据模型。
- 支持敏感字段输入和加密保存，不要求用户把长期 token 写入 `mcp.json`。
- 支持工具级启用/禁用，避免一个 server 暴露过多高风险工具。
- 支持一键测试连接，失败时展示可操作错误：命令不存在、cwd 不存在、token 缺失、server 无工具、启动超时。

后续增强：

- remote HTTP MCP transport。
- OAuth 授权流。
- MCP resources 和 prompts 可视化选择。
- 连接器导入/导出与预置目录。

验收标准：

- 用户无需手写 JSON，即可添加至少一个模板连接器并在 Chat 中调用其工具。
- 连接失败时，页面必须给出具体失败原因，而不是只显示通用 toast。
- 每个连接器的工具清单可见，且危险工具默认需要确认。

### P0.2 语义知识与自动记忆

把已有 FTS 知识索引升级为可语义召回的长期知识层。

首版需求：

- 为 Notebook source / note、episodic memory、semantic memory 生成 embedding。
- 在现有 SQLite 知识索引旁增加本地向量索引，优先复用现有 `indexing` 目录和 rebuild 流程。
- Chat 和 Notebook Chat 在回答前自动检索相关知识片段，并把来源注入上下文。
- 回答中保留来源引用，Notebook 命中继续复用现有精确引用能力。
- 对话结束后自动提取候选记忆，但首版必须进入“待确认”或“可撤销”状态，避免模型错误污染长期记忆。

后续增强：

- 记忆去重、衰减、合并。
- 会话摘要替代长历史。
- 记忆编辑和来源追踪 UI。

验收标准：

- 对同义或近义查询，系统能命中不包含原始关键词的 Notebook 或记忆片段。
- 用户能看到本次回答使用了哪些知识来源。
- 自动提取的长期记忆可以被用户查看、接受、删除或撤销。

### P0.3 Workflow 模板与向导

把 Workflow 从高级 JSON 编辑器升级为普通高级用户可用的自动化创建体验。

首版需求：

- 在 Automations 页面提供“从模板创建 Workflow”。
- 首批模板至少包含：晨间简报、Webhook 摘要、Notebook 资料归档。
- 提供分步表单：选择触发方式、填写输入、选择 Skill/Agent 步骤、配置输出位置。
- 表单生成的 JSON 仍可进入高级编辑器查看和微调。
- 运行前提供 dry-run 或预览，至少展示将执行的步骤和主要输入。
- 运行历史中展示每一步状态、耗时、输出摘要和错误。

后续增强：

- branch、retry、parallel、approval 步骤。
- 文件变更、RSS、邮件、日历等事件触发器。
- 模板市场或用户模板复用。

验收标准：

- 用户不写 JSON，也能创建并运行一个包含至少两个步骤的 Workflow。
- Workflow 保存前能发现缺失字段和结构错误。
- 失败时用户能定位到具体步骤，而不是只看到整体失败。

### P0.4 Run Console

把 Agent Runtime 的事件日志产品化，让用户能观察、排障和恢复任务。

首版需求：

- 新增运行记录入口，建议放在 `Settings / Advanced / Runs` 或 Automations 下。
- 列表展示近期 run：入口、触发类型、状态、开始时间、耗时、模型、工具数量、错误摘要。
- 详情页展示事件时间线：用户消息、路由结果、模型输出、工具调用、确认请求、artifact、失败原因。
- 支持按状态筛选：running、waiting_confirm、completed、failed、cancelled。
- 对 failed / waiting_confirm run 提供明确下一步：重试、取消、查看日志、继续确认。

后续增强：

- 单步重试。
- 从某个 checkpoint 继续。
- 导出 run 调试包。
- 成本、token、工具耗时聚合。

验收标准：

- 用户不用打开 `{stateDir}/runs` 文件夹，就能看懂最近一次 Agent/Workflow 为什么失败。
- 工具调用的危险级别、确认状态和错误信息可见。
- Run Console 中展示的信息与磁盘事件流保持一致。

## 优先级建议

建议按以下顺序推进：

1. Run Console：已有运行时底座，最小 UI 投入即可显著提升可排障性，也能支撑后续连接器和 Workflow 调试。
2. Workflow 模板与向导：PM 审计已确认这是当前自动化的最大使用门槛，短期产品收益高。
3. 连接器中心：补齐 MCP 产品化差距，为外部系统接入打开增长空间。
4. 语义知识与自动记忆：技术复杂度最高，但长期价值最大，应尽早启动底层设计和小范围验证。

如果资源允许，Run Console 和 Workflow 向导可以并行，因为它们共用运行历史与步骤状态展示。

## 成功指标

产品指标：

- 新用户首次完成模型配置后，能在 15 分钟内成功创建一个连接器或 Workflow。
- 至少 50% 的 Workflow 创建来自模板或向导，而不是手写 JSON。
- 自动化失败后，用户能通过 UI 定位失败原因的比例达到 80% 以上。
- Chat 回答中使用 Notebook / Memory 召回的比例持续上升，且用户能看到来源。

质量指标：

- 连接器连接失败必须有结构化错误码和可操作文案。
- Workflow run、Agent run、Cron run 的状态模型保持一致。
- 语义召回必须有回归测试覆盖：英文关键词、中文精确片段、同义查询至少各一组。
- 自动记忆提取不得直接不可逆写入长期事实，必须可审查或可撤销。

## 风险与开放问题

- remote MCP OAuth 会引入凭据、回调端口、token refresh 等安全复杂度，需要先做威胁建模。
- Embedding 方案需要在本地隐私、成本、速度、跨 provider 之间取舍。
- 自动记忆如果缺少审核，会造成错误事实沉淀，影响用户信任。
- Workflow 模板如果过多，会让页面变复杂；首版应保持少量高频模板。
- Run Console 需要避免泄露敏感工具参数，详情展示必须做脱敏。

## Feature 拆分

本文件作为四个能力包的总需求入口，已拆分为以下 feature 文档，后续每个能力包应独立推进实现计划、测试报告和发布说明：

- [Run Console](../features/run-console/brief.md)：把 Agent Runtime 事件日志产品化为运行记录和排障面板。
- [Workflow Template Wizard](../features/workflow-template-wizard/brief.md)：把 Workflow JSON 编辑升级为模板和向导式创建。
- [Connector Center](../features/connector-center/brief.md)：把 MCP 和外部工具连接升级为可配置、可测试、可控权的连接器中心。
- [Semantic Memory RAG](../features/semantic-memory-rag/brief.md)：把知识索引升级为 embedding、混合检索和可审查自动记忆。