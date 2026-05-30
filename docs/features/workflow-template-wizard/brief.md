# Workflow Template Wizard

> Status: Draft  
> Source: [桌面 AI 助手能力补齐 Product Brief](../../product/DESKTOP_AI_ASSISTANT_GAP_BRIEF.md)  
> Priority: P0.2

## Background

Neo 已经实现 Workflow MVP，支持 manual / webhook / cron trigger，以及 `transform`、`agent`、`skill` 串行步骤。用户指南见 [AUTOMATION.md](../../user-guide/AUTOMATION.md)。

但当前体验仍以 JSON 编辑器为主。PM 审计已明确指出：Workflow JSON 编辑器门槛高，缺少模板和向导式创建。对于普通高级用户来说，Neo 有自动化能力，但还不像一个成熟产品功能。

Workflow Template Wizard 的目标是让用户不写 JSON，也能创建可运行的多步骤自动化，并保留高级 JSON 编辑作为 escape hatch。

## User Problem

- 用户知道自己想要“晨间简报”“Webhook 摘要”“资料归档”，但不知道如何写 Workflow JSON。
- 现有 JSON 编辑器虽然有校验，但用户仍需要理解 trigger、steps、变量引用和步骤类型。
- 用户运行失败时，很难从创建界面回推是哪一步配置错了。
- 自动化能力缺少示例，会导致新用户低估 Neo 的后台运行价值。

## Goals

- 提供从模板创建 Workflow 的入口。
- 用分步表单生成有效 Workflow JSON。
- 首版覆盖 3 个高频模板：晨间简报、Webhook 摘要、Notebook 资料归档。
- 运行前展示步骤预览，降低误运行风险。
- 保留高级 JSON 编辑器，方便 power user 微调。

## Non-goals

- 本轮不做复杂拖拽画布。
- 本轮不引入任意 DAG 编排。
- 本轮不实现 branch、retry、parallel、approval 等新步骤类型。
- 本轮不接入邮件、RSS、日历等新外部连接器。

## Proposed Experience

### 1. 模板入口

在 `Settings / Advanced / Automations` 中新增“从模板创建”按钮。

点击后展示模板选择：

- 晨间简报：定时触发，整理指定输入或 Notebook 内容，发送到 Telegram 或保存到 Notebook。
- Webhook 摘要：外部系统 POST 内容，Neo 提炼摘要并回传结果。
- Notebook 资料归档：输入文章/文本，调用 Agent 或 Skill 生成摘要并写入 Notebook。

### 2. 分步表单

表单建议分为四步：

1. 基本信息：名称、描述、启用状态。
2. 触发方式：manual / cron / webhook。
3. 步骤配置：选择 Skill 或 Agent prompt，配置变量映射。
4. 输出位置：返回响应、Telegram、Notebook 或仅保存 run history。

首版可先只生成现有 Workflow 支持的 JSON，不扩展后端执行模型。

### 3. 预览与高级编辑

保存前展示：

- 将创建的 Workflow 名称和触发方式。
- 将执行的步骤列表。
- 主要变量来源。
- 生成的 JSON，可进入高级编辑器查看。

### 4. 运行后反馈

模板创建成功后，用户可以立即运行一次。运行结果应链接到 Run Console 或现有 run history。

## Acceptance Criteria

- 用户不写 JSON，也能创建一个包含至少两个步骤的 Workflow。
- 三个模板至少有两个能在首版可用。
- 生成的 Workflow JSON 能通过现有前端校验和后端 normalize。
- 用户能从表单切换到高级 JSON 编辑器查看生成结果。
- 创建失败时显示具体字段错误，而不是通用失败 toast。

## Open Questions

- Notebook 资料归档是否已有可复用写入工具，还是首版只生成 Agent 步骤。
- Telegram 输出是否应作为 Workflow step，还是沿用 trigger 的 `telegramChatId` 字段。
- 模板定义放在前端静态常量、后端服务，还是用户可扩展目录。