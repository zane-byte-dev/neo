# Neo 文档索引

> `docs/` 已按读者和用途拆成四层：`user-guide/`、`developer-guide/`、`product/`、`testing/`。

```text
docs/
├── user-guide/        # 面向使用者
├── developer-guide/   # 面向贡献者与维护者
├── product/           # 审查、规划、路线图、发布说明
├── testing/           # 测试策略与质量资料
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

## 开发者指南

| 文件 | 说明 | 状态 |
|------|------|------|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 开发环境、测试、Mock LLM、调试指南 | ✅ 已更新 |
| [AGENT_RUNTIME_PLAN.md](developer-guide/AGENT_RUNTIME_PLAN.md) | Agent 可恢复运行时演进计划 | ✅ 除 E2（自动化测试）外全部完成 |
| [AGENT_RUNTIME_ISSUES.md](developer-guide/AGENT_RUNTIME_ISSUES.md) | Agent 运行时 Issue 拆分（Epic → Issue 粒度） | ✅ A1-D3 全完成，E2 待处理 |
| [AGENT_RUNTIME_GITHUB_ISSUES.md](developer-guide/AGENT_RUNTIME_GITHUB_ISSUES.md) | Agent 运行时前 5 个 Issue 的 GitHub 正文模板 | 📝 模板备用 |
| [KNOWLEDGE_INDEX_DESIGN.md](developer-guide/KNOWLEDGE_INDEX_DESIGN.md) | 统一知识索引层架构设计草案 | ✅ FTS5 底座已落地；embedding 向量检索待做 |
| [KNOWLEDGE_INDEX_MVP.md](developer-guide/KNOWLEDGE_INDEX_MVP.md) | 统一知识索引 MVP 实施方案 | ✅ 已落地 |
| [KNOWLEDGE_INDEX_V1.sql](developer-guide/KNOWLEDGE_INDEX_V1.sql) | SQLite + FTS5 表结构参考 | 📖 参考资料 |
| [UI_DESIGN_GUIDE.md](developer-guide/UI_DESIGN_GUIDE.md) | Web UI 色彩、间距、圆角设计规范 | ✅ 已落地 |
| [SMART_SCORING.md](developer-guide/SMART_SCORING.md) | 智能请求评分与模型自动路由设计 | ✅ 已落地 |
| [COPILOT_AI_LOOP.md](developer-guide/COPILOT_AI_LOOP.md) | GitHub Copilot 驱动的产品→开发→测试→发布闭环 | ✅ 已落地 |
| [FEATURE_first_run_checklist_PLAN.md](developer-guide/FEATURE_first_run_checklist_PLAN.md) | 首次使用清单开发计划 | ✅ MVP 已实现 |
| [research.md](developer-guide/tools/research.md) | 内置 research 工具说明 | 📖 参考资料 |

## 产品与规划

| 文件 | 说明 | 状态 |
|------|------|------|
| [PM_AUDIT_REPORT.md](product/PM_AUDIT_REPORT.md) | PM 视角的 Bug 清单 + 功能缺陷 + UX 问题（2026-05-06） | 🔄 多数 Bug/功能已修复，少量 UX 问题待处理 |
| [PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md](product/PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md) | 文档工作者端到端体验报告（2026-05-10） | 🔄 P0.1（window.confirm）仍待处理 |
| [DOC_REVIEW.md](product/DOC_REVIEW.md) | 文档深度体验报告（README / docs/ 覆盖差距） | ✅ 主要文档缺口已收敛 |
| [COMPETITIVE_RESEARCH.md](product/COMPETITIVE_RESEARCH.md) | 竞品调研：直接竞品、Agent 框架、记忆层对比 | 内部产品参考，不建议作为用户入口 |
| [RELEASE_NOTES_v0.1.0.md](product/RELEASE_NOTES_v0.1.0.md) | v0.1.0 发布说明草稿 | 📝 待发布 |
| [ROADMAP.md](product/ROADMAP.md) | 功能路线图（P0/P1/P2 三档） | 🔄 P0 全完成；P1 部分完成；P2 待规划 |
| [NOTEBOOK_ROADMAP.md](product/NOTEBOOK_ROADMAP.md) | Notebook 重塑路线图（M1-M2 里程碑） | ✅ M1 全完成；M2 大部分完成 |
| [FEATURE_first_run_checklist.md](product/FEATURE_first_run_checklist.md) | 首次使用清单 Product Brief | ✅ MVP 已实现 |

## 测试与质量

| 文件 | 说明 | 状态 |
|------|------|------|
| [TEST_PLAN.md](testing/TEST_PLAN.md) | 测试策略、分层方案与各阶段用例规划 | ✅ 全部阶段已落地（90+ 测试文件） |
| [FEATURE_first_run_checklist_TEST_REPORT.md](testing/FEATURE_first_run_checklist_TEST_REPORT.md) | 首次使用清单测试报告 | ✅ 验收通过 |
| [../CHANGELOG.md](../CHANGELOG.md) | 版本化变更记录 | ✅ 已建立 |
