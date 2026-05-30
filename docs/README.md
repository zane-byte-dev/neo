# Neo 文档索引

> `docs/` 已按读者和用途拆成四层：`user-guide/`、`developer-guide/`、`product/`、`testing/`。

```text
docs/
├── user-guide/        # 面向使用者
├── developer-guide/   # 面向贡献者与维护者
├── product/           # 审查、规划、路线图、发布说明
├── testing/           # 测试策略与质量资料
├── features/          # 各 feature 的 brief + plan + test-report
└── assets/            # README / 文档图片资源
```

## 用户指南

| 文件 | 说明 | 状态 |
|------|------|------|
| [AI_DEVELOPMENT.md](user-guide/AI_DEVELOPMENT.md) | 如何在 GitHub Copilot 中按 Product Brief→Dev Plan→Implementation→Test Review→Closeout 开发 Neo | ✅ 已落地 |
| [FAQ.md](user-guide/FAQ.md) | 安装、登录、API Key、Telegram、MCP、`code_exec` 常见问题 | ✅ 已落地 |
| [TOOLS.md](user-guide/TOOLS.md) | 内置工具、自定义工具协议、脚本输入输出 | ✅ 已落地 |
| [SKILLS.md](user-guide/SKILLS.md) | Skill frontmatter、参数插值、可执行代码块 | ✅ 已落地 |
| [SANDBOX.md](user-guide/SANDBOX.md) | `code_exec`、Docker / host 沙箱、资源限制、产物收集 | ✅ 已落地 |
| [MCP.md](user-guide/MCP.md) | `{workDir}/mcp.json`、工具前缀、调试方法 | ✅ 已落地 |
| [NOTEBOOK.md](user-guide/NOTEBOOK.md) | Notebook sources、notes、Studio、引用模式 | ✅ 已落地 |
| [AUTOMATION.md](user-guide/AUTOMATION.md) | Webhook 与 Cron 定时任务 | ✅ 已落地 |
| [BROWSER_EXTENSION.md](user-guide/BROWSER_EXTENSION.md) | Chrome 扩展安装、权限、保存路径、排查 | ✅ 已落地 |
| [AGENT_RUNTIME.md](user-guide/AGENT_RUNTIME.md) | runId、事件流、断线追补、磁盘布局 | ✅ 已落地 |
| [VOICE_INPUT.md](user-guide/VOICE_INPUT.md) | Web Chat 语音输入：录音、转写、权限与常见问题 | ✅ 已落地 |
| [LOCAL_AI_GATEWAY.md](user-guide/LOCAL_AI_GATEWAY.md) | OpenAI / Anthropic compatible 本地模型网关配置与排障 | ✅ MVP 已落地 |

## 开发者指南

| 文件 | 说明 | 状态 |
|------|------|------|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 开发环境、测试、Mock LLM、调试指南 | ✅ 已更新 |
| [UI_DESIGN_GUIDE.md](developer-guide/UI_DESIGN_GUIDE.md) | Web UI 色彩、间距、圆角设计规范 | ✅ 已落地 |
| [SMART_SCORING.md](developer-guide/SMART_SCORING.md) | 智能请求评分与模型自动路由设计 | ✅ 已落地 |
| [COPILOT_AI_LOOP.md](developer-guide/COPILOT_AI_LOOP.md) | GitHub Copilot 驱动的产品→开发→测试→发布闭环 | ✅ 已落地 |
| [research.md](developer-guide/tools/research.md) | 内置 research 工具说明 | 📖 参考资料 |

## 产品与规划

| 文件 | 说明 | 状态 |
|------|------|------|
| [PM_AUDIT_REPORT.md](product/PM_AUDIT_REPORT.md) | PM 视角的 Bug 清单 + 功能缺陷 + UX 问题（2026-05-06） | 🔄 多数 Bug/功能已修复，少量 UX 问题待处理 |
| [PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md](product/PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md) | 文档工作者端到端体验报告（2026-05-10） | 🔄 P0.1（window.confirm）仍待处理 |
| [DOC_REVIEW.md](product/DOC_REVIEW.md) | 文档深度体验报告（README / docs/ 覆盖差距） | ✅ 主要文档缺口已收敛 |
| [COMPETITIVE_RESEARCH.md](product/COMPETITIVE_RESEARCH.md) | 竞品调研：直接竞品、Agent 框架、记忆层对比 | 内部产品参考，不建议作为用户入口 |
| [DESKTOP_AI_ASSISTANT_GAP_BRIEF.md](product/DESKTOP_AI_ASSISTANT_GAP_BRIEF.md) | 对标 Claude Desktop 类产品的能力差距补齐 Product Brief | 📝 Draft |
| [RELEASE_NOTES_v0.1.0.md](product/RELEASE_NOTES_v0.1.0.md) | v0.1.0 发布说明草稿 | 📝 待发布 |
| [ROADMAP.md](product/ROADMAP.md) | 功能路线图（P0/P1/P2 三档） | 🔄 P0 全完成；P1 部分完成；P2 待规划 |
| [NOTEBOOK_ROADMAP.md](product/NOTEBOOK_ROADMAP.md) | Notebook 重塑路线图（M1-M2 里程碑） | ✅ M1 全完成；M2 大部分完成 |

## 测试与质量

| 文件 | 说明 | 状态 |
|------|------|------|
| [TEST_PLAN.md](testing/TEST_PLAN.md) | 测试策略、分层方案与各阶段用例规划 | ✅ 全部阶段已落地（90+ 测试文件） |
| [../CHANGELOG.md](../CHANGELOG.md) | 版本化变更记录 | ✅ 已建立 |

## 功能文档

每个 feature 独立一个目录（`features/<slug>/`），包含 `brief.md`（Product Brief）、`plan.md`（Dev Plan）、`test-report.md`（Test Report）。

| 功能 | Brief | Plan | Test Report | 状态 |
|------|-------|------|-------------|------|
| 首次使用清单 | [brief.md](features/first-run-checklist/brief.md) | [plan.md](features/first-run-checklist/plan.md) | [test-report.md](features/first-run-checklist/test-report.md) | ✅ MVP 已实现 |
| 设置引导与系统状态 | [brief.md](features/settings-guidance-and-system-status/brief.md) | [plan.md](features/settings-guidance-and-system-status/plan.md) | [test-report.md](features/settings-guidance-and-system-status/test-report.md) | ✅ Phase 1 已实现 |
| 文章批注 | [brief.md](features/article-annotations/brief.md) | [plan.md](features/article-annotations/plan.md) | [test-report.md](features/article-annotations/test-report.md) | ✅ MVP 已实现 |
| 文章内资源 | [brief.md](features/article-embedded-resources/brief.md) | [plan.md](features/article-embedded-resources/plan.md) | [test-report.md](features/article-embedded-resources/test-report.md) | ✅ MVP 已实现 |
| Web 语音输入 | [brief.md](features/web-voice-input/brief.md) | [plan.md](features/web-voice-input/plan.md) | — | ✅ Phase 1 已实现 |
| 本地 AI Gateway | [brief.md](features/local-ai-gateway/brief.md) | [plan.md](features/local-ai-gateway/plan.md) | [test-report.md](features/local-ai-gateway/test-report.md) | ✅ MVP 已实现 |
| Run Console | [brief.md](features/run-console/brief.md) | [plan.md](features/run-console/plan.md) | — | 📝 Draft |
| Workflow 模板与向导 | [brief.md](features/workflow-template-wizard/brief.md) | [plan.md](features/workflow-template-wizard/plan.md) | — | 📝 Draft |
| Connector Center | [brief.md](features/connector-center/brief.md) | [plan.md](features/connector-center/plan.md) | — | 📝 Draft |
| Semantic Memory RAG | [brief.md](features/semantic-memory-rag/brief.md) | [plan.md](features/semantic-memory-rag/plan.md) | — | 📝 Draft |
| Workflow 自动化引擎 | [brief.md](features/workflow-automation-engine/brief.md) | [plan.md](features/workflow-automation-engine/plan.md) | [test-report.md](features/workflow-automation-engine/test-report.md) | ✅ MVP 已实现；JSON 编辑器已补保存前校验 |
| Agent 可恢复运行时 | — | [plan.md](features/agent-runtime/plan.md) | — | ✅ A1-D3 全完成，E2 待处理（附 [issues.md](features/agent-runtime/issues.md)） |
| 统一知识索引 | [design.md](features/knowledge-index/design.md) | [plan.md](features/knowledge-index/plan.md) | — | ✅ Phase 0-2 完成；Phase 3（embedding）待做 |
