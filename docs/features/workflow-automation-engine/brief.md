# Workflow Automation Engine

> Status update (2026-05-16): Phase 1 MVP 已落地。实现范围见 [plan.md](plan.md)，验证结果见 [test-report.md](test-report.md)。

## Background

Neo 已经具备自动化的基础底座：Webhook 可以主动触发 Agent，Cron 可以定时触发 Agent，设置页也已有 Automations 管理入口。但路线图里“工作流引擎 / 事件触发器 / Skill 编排 / 定时任务增强 / 外部服务集成”这一整组能力仍未真正落地。

这说明当前问题不是“Neo 没有自动化”，而是“Neo 只有单步触发，没有可组合、可观察、可复用的自动化工作流”。

相关来源：

- [ROADMAP.md](../../product/ROADMAP.md)：P1 明确列出工作流与自动化的五项未完成能力。
- [COMPETITIVE_RESEARCH.md](../../product/COMPETITIVE_RESEARCH.md)：建议 Neo 在现有 Skill 基础上扩展轻量 Workflow，而不是只保留纯 Agent 模式。
- [../user-guide/AUTOMATION.md](../../user-guide/AUTOMATION.md)：当前公开的自动化能力仍仅覆盖 Webhook 与 Cron。

## Evidence And Freshness Check

本 Brief 先核验了当前代码与文档状态，确认这不是一个“从零开始”的自动化需求，而是已有基础上的下一阶段设计。

### 1. 现有自动化能力只有单步触发

- [../../src/services/cron-agent.ts](../../../src/services/cron-agent.ts) 当前从 `memory/schedule.json` 读取任务，并在到点时调用一次 `runAgentTurn(...)`。
- 每个 Cron 任务当前只有一条 `message`，本质上是“定时发一段话给 Agent”，不是多步骤流程。
- [../../src/routes/webhook.ts](../../../src/routes/webhook.ts) 当前也只是接收 `message + secret + sessionId`，然后触发一次 Agent turn。

结论：当前自动化是“单条指令触发 Agent”，不是“工作流执行引擎”。

### 2. Web UI 和文档已经覆盖了 Cron / Webhook 管理，但没有 Workflow 概念

- [../user-guide/AUTOMATION.md](../../user-guide/AUTOMATION.md) 当前只介绍 Webhook 与 Cron。
- [PM_AUDIT_REPORT.md](../../product/PM_AUDIT_REPORT.md) 已确认 Webhook/Cron 管理 UI 已实现。

结论：现有产品已经解决了“基础自动化入口缺失”，但还没有“工作流定义、运行、追踪”的产品层。

### 3. 任务历史字段目前只是占位，没有真实执行历史

- [../../src/routes/cron.ts](../../../src/routes/cron.ts) 的 `GET /api/crons` 已返回 `last_status / last_error / last_finished_at` 等字段。
- 但这些字段当前是固定 `null` 或 `0`，并没有真实持久化的任务执行状态。

结论：产品已经隐约需要“执行历史 / 日志”这层能力，但实现尚未补上。

### 4. 仓库中没有现成的 workflow 定义或引擎文件

- 搜索 `**/*workflow*` 未发现现成的 workflow 定义文件或 workflow engine 实现。
- 当前代码中虽有“workflow”字样的注释或竞品研究，但没有真实的用户可用工作流系统。

### 5. 竞品方向与当前代码状态能够形成清晰增量路径

- [COMPETITIVE_RESEARCH.md](../../product/COMPETITIVE_RESEARCH.md) 已提出：在现有 Skill 基础上扩展轻量 Workflow，支持 cron / webhook / 手动 / 事件触发。
- 当前 Neo 已有 Skill、Agent Runtime、Cron、Webhook、SSE、Tool、Notebook 等底座，说明该需求不是纯探索型概念，而是可落在现有架构之上的下一层产品能力。

结论：当前最合理的产品方向不是继续堆更多单点自动化按钮，而是把已有自动化底层提升为“Workflow Automation Engine”。

## User Problem

当前用户虽然已经能做定时任务和 webhook 调用，但仍然缺少这几类关键能力：

- 不能把一个自动化任务拆成多个确定性步骤。
- 不能显式定义“先做什么、后做什么、失败怎么办”。
- 不能把多个 Skill 串起来复用输出。
- 不能方便地查看一次自动化到底执行到哪一步、失败在哪。
- 不能把“定时 / webhook / 手动 / 事件”统一看作同一种可管理的触发方式。

这会导致两个直接问题：

- 复杂自动化只能写成一条大 prompt，调试成本高，成功率不稳定。
- 用户已经有自动化入口，但很难把它扩展成可靠的日常工作流。

## Goals

- 在 Neo 中引入一套轻量、可组合、可追踪的 Workflow 能力。
- 让 Cron / Webhook / 手动触发成为统一的触发器体系，而不是彼此割裂的入口。
- 让多个 Skill 或 Agent 步骤可以按顺序串联，且后续步骤能使用前一步输出。
- 提供基本的执行历史、状态、错误和日志，降低自动化调试门槛。
- 保持首版聚焦，优先交付可用的确定性流程，而不是一步到位做成通用 iPaaS 平台。

## Non-goals

- 本轮不做 Zapier / n8n 级别的通用集成平台。
- 本轮不先做复杂可视化拖拽编排器。
- 本轮不支持无限循环、任意图结构或无边界的递归流程。
- 本轮不替代现有 Chat Agent，也不要求所有任务都迁移到 Workflow。
- 本轮不先接入大量外部服务连接器，先聚焦通用引擎与基础触发方式。

## Target Users And Scenarios

目标用户：

- 已经在 Neo 中使用 Cron / Webhook 的高级用户。
- 想把固定流程自动化的个人工作者，例如资讯摘要、日报、周报、内容整理、资料导入。
- 需要“可靠执行”而不是“完全交给自主 Agent 自己发挥”的用户。

核心场景：

1. 用户定义一个“每周摘要”工作流：收集输入 -> 调用 Skill 总结 -> 输出到 Telegram。
2. 用户定义一个 webhook 触发工作流：接到外部事件 -> 解析内容 -> 跑 Skill -> 归档到 Notebook。
3. 用户手动运行工作流，查看每一步执行情况和失败原因。
4. 用户复用多个已有 Skill，而不再把全部逻辑塞进单条 prompt。

## Proposed Experience

### 1. 产品定位

把 Workflow 定义为“确定性流程层”，它与 Chat Agent 的关系是：

- Chat Agent：适合开放式、探索式、即时交互。
- Workflow：适合重复性、可预期、需要调试和追踪的任务。

Workflow 不与 Agent 对立，而是复用现有 Agent / Skill / Tool 能力，把它们放进一个更可控的执行框架里。

### 2. 统一触发器模型

建议把现有自动化能力统一抽象成 Trigger：

- Manual：用户手动点击运行。
- Cron：定时触发。
- Webhook：外部系统触发。
- Event：文件变更、新 Notebook 源、未来的邮件 / RSS 等事件触发。

首版建议只正式支持前三类：Manual、Cron、Webhook。

这样做的好处是：

- 保留现有 Cron / Webhook 投资。
- 后续新增触发方式时不需要改工作流核心模型。
- UI 上也能把“自动化”从“两个入口”升级为“一个 workflow + 多种 trigger”。

### 3. Workflow 定义模型

建议首版采用声明式 YAML/JSON 定义，而不是先做可视化拖拽。

首版工作流应至少包含：

- `name`：工作流名称
- `trigger`：手动 / cron / webhook
- `steps`：有序步骤数组
- `inputs`：运行时输入
- `outputs`：最终输出摘要

首版步骤类型建议聚焦为三类：

- `skill`：调用已有 Skill
- `agent`：执行一段 Agent 任务
- `transform`：把前一步结果做模板化拼接或变量映射

第二阶段再考虑：

- `branch`：条件分支
- `parallel`：并行步骤
- `retry`：失败重试策略
- `approval`：人机确认暂停 / 继续

### 4. Skill 编排

这部分应作为 Workflow 的内建能力，而不是单独的平行功能。

核心原则：

- 每个 Skill 步骤都产出结构化文本或对象结果。
- 后续步骤可以引用前序步骤输出。
- 用户不需要重复粘贴 prompt，只需要声明“用哪个 Skill 处理哪个输入”。

这样可以把当前 Skill 从“聊天时手工调用的能力块”，升级成“自动化里的可复用积木”。

### 5. 执行历史与日志

工作流如果没有历史与日志，就仍然难以调试，因此执行可观测性必须是首版能力的一部分。

建议首版提供：

- 工作流列表：名称、触发方式、启用状态、最近运行时间。
- 运行历史：成功 / 失败 / 运行中。
- 步骤级状态：每一步的开始、结束、耗时、错误。
- 最后错误摘要：用户能快速知道失败点。

已有 `Cron` 列表里的 `last_status / last_error` 字段可以视作该能力的早期雏形，但应升级为真实的 Workflow run 记录，而不是继续保留占位字段。

### 6. 与现有 Cron / Webhook 的关系

不建议把现有 Cron / Webhook 推倒重做，而应平滑升级：

- 当前 Cron 任务可继续作为“单步 workflow”的兼容模式。
- Webhook 触发也可先继续保留现有路由，再增加 workflow 绑定能力。
- Automations 页应逐步从“管理 Cron + Webhook”演进为“管理 Workflows + Triggers + Run History”。

### 7. 首版产品范围建议

建议首版只做一个可真正用起来的 MVP：

- Workflow 定义
- Manual / Cron / Webhook 触发
- 串行步骤执行
- Skill / Agent 步骤
- 基础运行历史与错误展示

不要在首版同时做：

- 文件监听
- 邮件 / 日历 / RSS 集成
- 图形化编辑器
- 复杂并行图

### 8. 建议推进顺序

Phase 1：Workflow MVP

- 工作流定义文件与基本 CRUD
- 手动 / Cron / Webhook 触发
- 串行步骤执行
- 运行历史与步骤级状态

Phase 2：可靠性增强

- 条件分支、并行、重试
- 更细的错误和日志
- Skill 输出变量映射

Phase 3：触发器与连接器扩展

- 文件变更 / Notebook 更新事件
- RSS / 邮件 / 日历等连接器
- 更丰富的工作流模板

## Documentation Impact

如果该功能实施，以下文档需要同步：

- [../user-guide/AUTOMATION.md](../../user-guide/AUTOMATION.md)：从"Webhook / Cron 使用指南"升级为"Workflow / Triggers / Runs 使用指南"。
- [../../README.md](../../../README.md)：更新自动化能力描述，不再只强调 Cron / Webhook。
- [../../CHANGELOG.md](../../../CHANGELOG.md)：记录 Workflow 能力上线。
- [ROADMAP.md](../../product/ROADMAP.md)：将工作流与自动化条目标记为进行中或拆分状态。
- 如首版采用声明式文件定义，还需要补一份 `docs/developer-guide/` 文档说明 Workflow schema 与运行时模型。

## Acceptance Criteria

- 用户可以创建一个包含至少 2 个步骤的 Workflow。
- Workflow 至少支持手动触发和 Cron 或 Webhook 其中一种自动触发方式；目标版本建议三者都支持。
- Workflow 的后续步骤可以读取前一步输出。
- 用户可以查看 Workflow 最近运行结果、成功 / 失败状态和最后错误。
- 现有 Cron / Webhook 基础能力不会因为引入 Workflow 而回退或不可用。
- Web UI 中存在 Workflow 的基础管理入口，不要求首版是可视化拖拽编辑器。
- 新增文案支持中英文 i18n，不新增硬编码中文或英文。
- 关键执行链路和失败路径具备自动化测试覆盖。

## Risks And Dependencies

- 如果首版 scope 不受控，很容易从“轻量 Workflow”滑向“通用集成平台”。
- Workflow 与现有 Run Runtime 的关系需要定义清楚，否则会出现两套状态模型并存。
- 多步骤执行会把错误处理、重试、权限确认和日志复杂度显著拉高。
- 如果没有变量映射与结果结构约束，Skill 编排会退化成“多条 prompt 拼接”，可维护性差。
- 未来若接入文件事件、邮件、RSS 等触发器，需要额外的安全与隔离设计。

## Priority

P1。原因不是它最先影响新手体验，而是它最能把 Neo 从“可配置的 Agent 工具箱”推进到“可复用的个人自动化工作台”。

在优先级上，建议晚于当前的 Web UX 收尾，但早于大量新平台接入或复杂运维面板。

## Open Questions

- 首版 Workflow 是否直接暴露文件式 YAML/JSON 定义，还是先只通过 Web UI 表单生成？
- Workflow run 是否复用现有 run 记录体系，还是建立独立的 workflow run 模型？
- Step 输出是纯文本优先，还是首版就需要结构化变量映射？
- 现有 Cron 任务是否要自动迁移为 Workflow，还是长期保留兼容模式？
- 是否需要在首版支持 Human-in-the-loop 审批暂停 / 恢复？

## Suggested Next Step

下一步进入 Dev Plan 阶段，建议输出：

```text
docs/features/workflow-automation-engine/plan.md
```