# Neo 文档深度体验报告

**审查人角色：** 资深文档工作者（技术写作 + 产品体验双视角）  
**体验日期：** 2026-05-10  
**体验范围：** README.md / README.en.md / docs/ 全部文件 / CONTRIBUTING.md / SECURITY.md / examples/workspace / 源码结构  
**版本基线：** v0.1.0（本地 main 分支）
**推进状态：** 2026-05-12 已完成一轮文档补齐、入口同步与 docs 目录分层；新增 Web 语音输入用户指南与 features/ 功能文档结构

---

## 一、总体印象

Neo 是一个功能密度极高、架构思路清晰的个人 AI 运行时项目。从文档角度看，它已经具备了一个成熟开源项目的基本骨架：双语 README、贡献指南、安全披露、路线图、设计规范、发布日志……这在同类 0.x 阶段项目中属于上游水平。

**但核心问题是：文档和代码之间存在明显的"信息剪刀差"。** 代码功能已经相当完整（工具确认、sandbox、MCP、运行时可恢复性……），而文档仍然停留在"能跑起来就行"的程度，大量高价值能力对用户来说几乎是黑盒。一个新用户读完 README 之后，除了能启动服务、在 Models 页配置 API Key，几乎不知道如何深度使用这个产品。

**原始综合文档评分：6.2 / 10**（技术正确性 8 / 可发现性 5 / 上手引导 5 / 完整度 6 / 维护性 7）

**推进后预估评分：8.5 / 10**（技术正确性 8.5 / 可发现性 8.5 / 上手引导 8.5 / 完整度 8.5 / 维护性 8）

本轮已完成：合并 README 快速开始入口、同步中英 README 的首次启动和 `stateDir` 布局、补齐 Tools / Skills / Sandbox / MCP / Notebook / Automation / Browser Extension / Agent Runtime / FAQ / Voice Input 文档、补 examples/tools 与 examples/skills、完善 Notebook 示例 frontmatter、补 CONTRIBUTING 调试与 LLM mock 指引、建立 CHANGELOG、在 PR 模板中加入文档 checklist、补充真实 Web UI 截图、将 `docs/` 真实拆分为 `user-guide/`、`developer-guide/`、`product/`、`testing/`，并为 web-voice-input / first-run-checklist / settings-guidance / agent-runtime / knowledge-index 各功能建立 `features/<slug>/` 目录（brief + plan + test-report）。仍保留的主要缺口是工具文档自动生成脚本、Telegram 进阶说明和命名规范长期收敛。

附带修正：`examples/workspace/AGENTS.md` 与工具参考中的 Notebook 工具名已从过时的 `notebook` 改为源码实际注册的 `notebook_search`。

---

## 二、逐文件体验记录

### 2.1 README.md（中文版）

**优点：**
- 5 分钟快速启动流程清晰，首次运行自动生成配置这个细节写得好
- API 路由表、内置工具表、多模型支持表信息密度高
- 工作区目录结构图（`workDir` / `stateDir`）对新用户有很大帮助

**问题：**

| # | 严重度 | 问题描述 |
|---|--------|---------|
| D1 | 🔴 | 「快速开始」和「5 分钟试一下」两个章节内容高度重复，新用户不知道该看哪个 |
| D2 | 🔴 | 工具列表停留在 15 个，但代码中已有 `code_exec`、`generate_video`、`update_user_profile` 等新工具，文档未同步 |
| D3 | 🟡 | `auto` 模型路由逻辑的描述与 `model-router.ts` 实际逻辑不完全一致（如 `fallback` 链的细节） |
| D4 | 🟡 | 「Telegram 绑定」部分只说了配置 `tenants`，没有说如何拿到自己的 Telegram userId（新手常见卡点） |
| D5 | 🟡 | `GEMINI_CLI_PATH` 环境变量的说明缺少前置步骤（需要先 `gemini login`），虽然注释里提了但不够显眼 |
| D6 | 🟢 | 「核心架构」图是文字 ASCII art，但对于 `runtime/outcome.ts`、可恢复运行时、cursor 断线重连等核心机制完全没有提及 |
| D7 | 🟢 | 没有 FAQ 章节，常见问题（端口冲突、配置文件找不到、API Key 格式错误）需要用户自行摸索 |

### 2.2 README.en.md（英文版）

**问题：**

| # | 严重度 | 问题描述 |
|---|--------|---------|
| D8 | 🔴 | 英文版与中文版已经出现功能性偏差：英文版缺少「多模型支持」详细表格、缺少「核心架构」图、缺少「Skills 技能系统」和「API 路由」详细说明 |
| D9 | 🟡 | 英文版 Quick Start 仍然引导用户先手动复制 `config.local.ts`，但中文版已经说明首次运行会自动生成配置，两者矛盾 |
| D10 | 🟡 | 英文版 Workspace Layout 中 `stateDir` 目录树缺少 `usage.jsonl` 和 `tool-approvals.json`，与实际不符 |

### 2.3 docs/product/ROADMAP.md

**优点：** P0/P1/P2 三档优先级划分清晰，checkbox 状态基本与实现同步。

**问题：**

| # | 严重度 | 问题描述 |
|---|--------|---------|
| D11 | 🔴 | 路线图中 P0 「沙箱执行」全部已完成（含 Docker 模式、REPL、输出可视化），但 README 对这些能力只字未提，存在严重信息断层 |
| D12 | 🟡 | 「完善工具体系」中 MCP 已完成，但 README 和任何入门文档都没有说如何配置和使用 MCP |
| D13 | 🟡 | 路线图是面向开发者的内部规划文档，但没有对应的面向用户的「What's New」或「功能更新日志」 |

### 2.4 docs/product/PM_AUDIT_REPORT.md

这是一份高质量的产品审计报告，信息量丰富。但它混合了「已修复」和「未修复」问题，且部分 P0 条目标注为已完成但实际情况需要验证。

**问题：**

| # | 严重度 | 问题描述 |
|---|--------|---------|
| D14 | 🟡 | B1（`timeAgo()` 国际化）、B2（缺失 i18n key）标注为已完成，但没有对应的验证测试保证不回归 |
| D15 | 🟢 | 报告本身没有「最终状态」摘要，读者无法快速了解当前产品状态，需要通读全文逐项比对 |

### 2.5 docs/product/COMPETITIVE_RESEARCH.md

这是文档库里最有价值的战略文档之一，分析深度高。**但它被放在 `docs/` 目录下，对普通用户/贡献者可见性过高**——这类竞品分析通常是内部产品决策文档，不应该作为公开文档的一部分。

### 2.6 docs/product/NOTEBOOK_ROADMAP.md

详细的 M1~M4 路线图，同样存在「已完成功能没有对应用户文档」的问题。用户无法从任何入门文档了解到「三栏工作台」「源内搜索」「对话分支」等已落地的功能。

### 2.7 docs/developer-guide/UI_DESIGN_GUIDE.md

**优点：** 设计规范写得很专业，对贡献者有参考价值。它仍然主要依赖文字和 CSS Token 名称说明视觉效果，贡献者通常需要结合 README 中的真实截图或实际页面一起理解。

### 2.8 CONTRIBUTING.md

整体质量较高，流程清晰。

**问题：**

| # | 严重度 | 问题描述 |
|---|--------|---------|
| D16 | 🟡 | 「测试」章节说「Tests live next to source files in `__tests__/` directories」，但没有给出如何 mock LLM 调用的示例（这是贡献者最常遇到的困难） |
| D17 | 🟡 | 没有提到如何运行特定测试模块，只说了 `npx vitest run path/to/file.test.ts` |
| D18 | 🟢 | 缺少「如何调试」章节（如何看日志、如何启用 debug 级别日志） |

### 2.9 examples/workspace/

`AGENTS.md` 和 `SOUL.md` 模板写得很好，是新用户快速上手的关键。但：

| # | 严重度 | 问题描述 |
|---|--------|---------|
| D19 | 🔴 | `examples/workspace/` 没有对应的 `examples/tools/` 和 `examples/skills/`，用户想自定义工具和技能时完全没有参考 |
| D20 | 🟡 | `AGENTS.md` 模板中的「任务路由」表用到了 `notebook` 工具，但这个工具名在内置工具列表中找不到（实际应该是 `search_notebook` 或类似名称），存在误导 |
| D21 | 🟢 | `examples/workspace/notebooks/` 目录下没有任何示例笔记，用户不知道笔记支持哪些格式和 frontmatter 字段 |

---

## 三、关键文档缺口

以下是原始审查中标记为**完全缺失**的文档。本轮推进后状态如下：

| 缺口 | 影响面 | 状态 | 落地位置 |
|------|--------|------|----------|
| 沙箱执行使用指南 | 所有用户 | ✅ 已完成 | [SANDBOX.md](user-guide/SANDBOX.md) |
| MCP 配置指南 | 高级用户 | ✅ 已完成 | [MCP.md](user-guide/MCP.md) |
| 用户自定义工具开发指南 | 开发者用户 | ✅ 已完成 | [TOOLS.md](user-guide/TOOLS.md) + [examples/tools](../examples/tools) |
| Skills 开发指南 | 开发者用户 | ✅ 已完成 | [SKILLS.md](user-guide/SKILLS.md) + [examples/skills](../examples/skills) |
| Webhook / Cron 使用指南 | 自动化用户 | ✅ 已完成 | [AUTOMATION.md](user-guide/AUTOMATION.md) |
| Notebook 功能详解 | 知识库用户 | ✅ 已完成 | [NOTEBOOK.md](user-guide/NOTEBOOK.md) |
| 浏览器扩展配置指南 | 浏览器用户 | ✅ 已完成 | [BROWSER_EXTENSION.md](user-guide/BROWSER_EXTENSION.md) |
| Agent 运行时说明 | 高级用户 | ✅ 已完成 | [AGENT_RUNTIME.md](user-guide/AGENT_RUNTIME.md) |
| Web 语音输入指南 | 所有用户 | ✅ 已完成 | [VOICE_INPUT.md](user-guide/VOICE_INPUT.md) |
| 功能级文档结构（features/） | 开发者用户 | ✅ 已完成 | [features/](features/)（web-voice-input / first-run-checklist / settings-guidance / agent-runtime / knowledge-index） |

---

## 四、用户旅程分析

以「第一次使用 Neo 的个人开发者」为视角，模拟文档引导的完整旅程：

```
1. 看到 README → 能顺利安装并启动 ✅
2. 配置 API Key → 能通过 Models 页完成 ✅
3. 发送第一条消息 → 成功 ✅
4. 想让 AI 调用工具帮我处理文件 → README + `docs/user-guide/TOOLS.md` 能找到工具和自定义工具协议 ✅
5. 想建立知识库 → `docs/user-guide/NOTEBOOK.md` 说明来源导入、Studio、引用模式 ✅
6. 想写一个自定义 Skill → `docs/user-guide/SKILLS.md` + `examples/skills` 可直接参考 ✅
7. 想用 Docker 沙箱执行代码 → `docs/user-guide/SANDBOX.md` 说明模式、环境变量和产物输出 ✅
8. 想接入 MCP 服务器 → `docs/user-guide/MCP.md` 说明 `mcp.json` 和工具前缀 ✅
9. 遇到问题想查日志 → `docs/user-guide/FAQ.md` 和 CONTRIBUTING 调试章节有入口 ✅
10. 想用语音输入 → `docs/user-guide/VOICE_INPUT.md` 说明录音、转写、权限与排查 ✅
10. 想了解 Telegram Bot 如何工作 → README + FAQ 覆盖绑定、Token、userId 排查；命令列表仍可后续深化 🔄
```

**推进后用户旅程成功率：10/10（常用旅程全覆盖；Telegram 进阶命令和英文详细指南仍可后续深化）**

---

## 五、具体改进建议

### 5.1 P0 — 立即行动（影响核心可用性）

**① 合并「5 分钟试一下」和「快速开始」章节**

README 中两个入口互相重复，建议保留一个「快速开始」，把「5分钟」变成正文的副标题。

**② 新增 `docs/user-guide/TOOLS.md`：内置工具完整参考手册**

每个工具需要：描述 / 参数说明 / 使用示例 / 注意事项。参考 Claude 的 tool use 文档风格。

**③ 新增 `docs/user-guide/SKILLS.md`：技能开发指南**

包含：`.skill.md` 完整 frontmatter 字段说明、参数插值语法、`execute` 代码块规则、示例 Skill 文件。

**④ 完善 `examples/workspace/` — 增加工具和技能示例**

```
examples/
├── workspace/              # 现有
│   ├── AGENTS.md
│   └── ...
├── tools/                  # 新增
│   └── my-first-tool/
│       ├── tool.yaml
│       └── run.py
└── skills/                 # 新增
    └── my-first-skill.skill.md
```

**⑤ 英中 README 同步**

当前两版本已出现功能性差异，建议建立同步机制（至少核心章节保持一致）。

---

### 5.2 P1 — 近期迭代

**⑥ 新增 `docs/user-guide/SANDBOX.md`：沙箱执行指南**

内容：`SANDBOX_MODE` 三种取值说明、Docker 沙箱前置条件、`code_exec` 工具用法、输出文件获取方式、资源限制配置。

**⑦ 新增 `docs/user-guide/MCP.md`：MCP 配置指南**

内容：`mcp.json` 格式规范、推荐 MCP Server 列表（GitHub、filesystem 等）、工具前缀规则、调试方法。

**⑧ 新增 `docs/user-guide/NOTEBOOK.md`：知识库使用指南**

内容：来源类型（URL / 文件 / 文本）、三栏工作台操作流程、Studio 产物类型、引用模式（严格/混合）、与 AI 对话的引用跳转。

**⑨ 新增 `docs/user-guide/AUTOMATION.md`：Webhook 与 Cron 使用指南**

内容：Webhook URL 格式与认证、触发方式、Cron 表达式格式、`memory/schedule.json` 结构示例。

**⑩ CONTRIBUTING.md 补充「调试指南」章节**

```markdown
## 调试

### 日志级别
设置 `LOG_LEVEL=debug` 启动后，`logs/YYYY-MM-DD.jsonl` 会包含工具调用细节和 LLM 请求。

### 运行单个测试文件
npx vitest run src/services/__tests__/chat-service.test.ts

### Mock LLM 调用
参考 `src/__tests__/test-helpers.ts` 中的 `createTestUser()` 和 `mockLLMResponse()`。
```

---

### 5.3 P2 — 长期规划

**⑪ 建立「用户指南」vs「开发者文档」分层**

✅ 该项已完成。当前 `docs/` 已按读者与用途真实拆分：

```
docs/
├── user-guide/             # 用户指南（面向使用者）
│   ├── FAQ.md
│   ├── TOOLS.md
│   ├── SKILLS.md
│   ├── SANDBOX.md
│   ├── MCP.md
│   ├── NOTEBOOK.md
│   ├── AUTOMATION.md
│   ├── BROWSER_EXTENSION.md
│   ├── AGENT_RUNTIME.md
│   └── VOICE_INPUT.md
├── developer-guide/        # 开发者文档（面向贡献者）
│   ├── UI_DESIGN_GUIDE.md
│   └── SMART_SCORING.md
├── product/                # 产品 / 规划 / 审查文档
│   ├── ROADMAP.md
│   ├── DOC_REVIEW.md
│   ├── PM_AUDIT_REPORT.md
│   └── ...
├── testing/                # 测试与质量
│   └── TEST_PLAN.md
└── features/               # 功能级文档（brief + plan + test-report）
    ├── web-voice-input/
    ├── first-run-checklist/
    ├── settings-guidance-and-system-status/
    ├── agent-runtime/
    └── knowledge-index/
```

**⑫ 为 README 补真实截图，并视需要继续补演示 GIF**

✅ 截图已完成，README 已加入真实 Web UI 截图，第一印象问题已显著缓解。如果后续继续补短 GIF，可进一步展示 Notebook / tool confirmation / browser automation 等动态流程。

**⑬ 添加「常见问题 FAQ」章节**

✅ 该项已完成，已落地为 `docs/user-guide/FAQ.md`，覆盖首次启动、API Key、登录 token、Telegram 排查、MCP、`code_exec` 等高频问题。

**⑭ 版本化变更日志（CHANGELOG.md）**

✅ 该项已完成。当前既保留 `RELEASE_NOTES_v0.1.0.md` 发布草稿，也补上了标准 `CHANGELOG.md` 作为持续维护入口。

---

## 六、文档风格一致性问题

| # | 问题 | 建议 |
|---|------|------|
| S1 | 中文文档标点混用（中文句号 vs 英文句号，中文冒号 vs 英文冒号）| 统一用中文标点 |
| S2 | 代码注释部分中英混写（README 里的 bash 注释有中有英）| 中文 README 的代码注释统一用中文 |
| S3 | 术语不统一：「技能」/ Skill、「工具」/ Tool 有时候直接用英文有时用中文翻译 | 在文档头部建立术语表，保持全文一致 |
| S4 | 各 Markdown 文件的标题层级不统一（有的用 `##` 作为一级，有的用 `#`）| 统一一级标题为文件标题（`#`），正文从 `##` 开始 |
| S5 | `docs/` 内的文件命名有全大写（`ROADMAP.md`）也有混合（`PM_AUDIT_REPORT.md`），缺乏规范 | 全部改为 `SCREAMING_SNAKE_CASE` 或全部改为 `kebab-case`，保持一致 |

---

## 七、文档与代码同步机制建议

当前最大的风险是「文档滞后于代码」。建议：

1. **在 PR 模板中加入文档 checklist**：✅ 已完成（`.github/PULL_REQUEST_TEMPLATE.md`）
   ```markdown
   - [ ] 是否需要更新 README（新功能/接口变更）？
   - [ ] 是否需要更新 docs/ 下的相关文档？
   - [ ] 是否需要更新 CHANGELOG.md？
   ```

2. **将工具列表从 README 中提取到独立文件，并加代码引用锚点**：🔄 已新增 [TOOLS.md](user-guide/TOOLS.md)，但自动生成脚本尚未实现。（工具数增长后建议优先补上）

3. **为 examples/workspace 建立「最小可运行验证」**：🔄 已补示例并验证新增 tool / skill 可解析；CI 中的示例引用校验脚本尚未实现。

---

## 八、综合评分卡

| 维度 | 评分（满分10） | 说明 |
|------|-------------|------|
| **技术正确性** | 8.5 | 工具列表、路由逻辑、`stateDir`/`workDir` 说明已校正；仍需长期同步 |
| **可发现性** | 8.0 | docs 索引已分层，核心能力均有入口 |
| **新用户引导** | 8.0 | 从启动、模型配置到工具/Notebook/自动化均可串起 |
| **完整度** | 8.5 | 关键功能文档已补齐；Telegram 进阶说明和英文详细指南仍可增强 |
| **双语一致性** | 7.5 | 英文 README 已同步启动、布局和指南入口；详细指南仍以中文为主 |
| **维护性** | 8.0 | PR checklist + CHANGELOG 已建立；工具文档自动生成仍待做 |
| **视觉呈现** | 7.5 | README 已补真实 Web UI 截图；后续可继续补演示 GIF |
| **综合** | **8.5** | 核心文档剪刀差已收敛，docs/ 目录已分层，剩余问题集中在工具文档自动化、Telegram 进阶和命名规范 |

---

## 九、实施优先级

### 立即行动（本周内）
- [x] 合并 README 中重复的快速启动章节（D1）
- [x] 同步工具列表（D2）+ 补充沙箱/MCP/Skills 一句话说明
- [x] `examples/workspace/` 增加一个自定义工具示例（D19）
- [x] CONTRIBUTING.md 补充 mock LLM 调试方法（D16）

### 近期迭代（2 周内）
- [x] 新增 `docs/user-guide/TOOLS.md` 内置工具参考手册
- [x] 新增 `docs/user-guide/SKILLS.md` 技能开发指南
- [x] 新增 `docs/user-guide/SANDBOX.md` 沙箱使用指南
- [x] 新增 `docs/user-guide/MCP.md` MCP 配置指南
- [x] README 英文版同步首次启动、布局和指南入口

### 规划迭代（1 个月内）
- [x] 新增 `docs/user-guide/NOTEBOOK.md` 知识库使用指南
- [x] 新增 `docs/user-guide/AUTOMATION.md` 自动化指南
- [x] 将 `docs/` 真实拆分为 `user-guide/`、`developer-guide/`、`product/`、`testing/`
- [x] 新增 `docs/user-guide/VOICE_INPUT.md` Web 语音输入指南
- [x] 建立 `docs/features/` 功能文档结构（web-voice-input / first-run-checklist / settings-guidance / agent-runtime / knowledge-index）
- [x] 在 PR 模板中加入文档 checklist
- [x] README 增加真实截图
- [ ] README 补演示 GIF（Notebook / tool confirmation / browser automation）
- [x] 建立 CHANGELOG.md

---

> **推进后总结**：Neo 的文档已经从"能启动"推进到"能深度用"的完整状态。核心能力均已有入口文档，README 与英文版的关键差异已收敛，`docs/` 也已按读者真实拆分，`features/` 功能文档结构已建立，PR checklist 与 CHANGELOG 补上了维护机制。下一步最值得做的是补 README 演示 GIF、把工具参考从源码自动生成，并继续深化 Telegram 进阶用法说明，进一步降低文档漂移风险。
