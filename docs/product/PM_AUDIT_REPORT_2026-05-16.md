# Neo 产品体验审计报告 — 第二轮（PM 视角）

**审计日期：** 2026-05-16  
**版本：** Unreleased（基于本轮已合并功能）  
**上轮报告：** [PM_AUDIT_REPORT.md](PM_AUDIT_REPORT.md)（2026-05-06）  
**审计方式：** 功能 Brief + Test Report 逐项核验 + 代码走查 + 文档审阅  

---

## 一、本轮审计范围

本轮聚焦在 CHANGELOG `[Unreleased]` 段落新增的七项功能与若干 Bug 修复：

| # | 功能 | Brief | Test Report |
|---|------|-------|-------------|
| N1 | 文章批注 MVP | [article-annotations/brief.md](../features/article-annotations/brief.md) | [test-report.md](../features/article-annotations/test-report.md) |
| N2 | 文章内资源 MVP | [article-embedded-resources/brief.md](../features/article-embedded-resources/brief.md) | [test-report.md](../features/article-embedded-resources/test-report.md) |
| N3 | Web 语音输入 | [web-voice-input/brief.md](../features/web-voice-input/brief.md) | [test-report.md](../features/web-voice-input/test-report.md) |
| N4 | 对话沉淀 Skill | [chat-skill-authoring/brief.md](../features/chat-skill-authoring/brief.md) | [test-report.md](../features/chat-skill-authoring/test-report.md) |
| N5 | Workflow 自动化引擎 MVP | [workflow-automation-engine/brief.md](../features/workflow-automation-engine/brief.md) | [test-report.md](../features/workflow-automation-engine/test-report.md) |
| N6 | 设置分层 + 系统状态 | [settings-guidance-and-system-status/brief.md](../features/settings-guidance-and-system-status/brief.md) | [test-report.md](../features/settings-guidance-and-system-status/test-report.md) |
| N7 | 首次使用清单 | [first-run-checklist/brief.md](../features/first-run-checklist/brief.md) | [test-report.md](../features/first-run-checklist/test-report.md) |

---

## 二、各功能体验评分

| 功能 | 完成度 | 体验质量 | 主要短板 |
|------|--------|----------|---------|
| N1 文章批注 | 🟡 部分 | 🟡 中 | 无辅助批注面板；段落 hover 入口未实现；批注漂移风险 |
| N2 文章内资源 | 🟢 良好 | 🟢 高 | Slash 命令无自动提示；历史 artifact 不复用 |
| N3 Web 语音输入 | 🟢 良好 | 🟢 高 | Safari 未验证；无语言偏好设置 |
| N4 对话沉淀 Skill | 🟡 基础 | 🟡 中 | LLM 输出质量不稳定；保存前无预览/编辑 |
| N5 Workflow 引擎 | 🟡 部分 | 🔴 低 | JSON 编辑器门槛高；缺模板引导 |
| N6 设置分层+状态 | 🟢 良好 | 🟢 高 | 系统状态卡片 Automation 仅展示数量 |
| N7 首次使用清单 | 🟢 良好 | 🟢 高 | 无前端组件自动化测试；移动端未截图验证 |

---

## 三、Bug 清单

| # | 严重级别 | 模块 | 问题描述 | 来源 | 状态 |
|---|----------|------|---------|------|------|
| B9 | 🔴 高 | 文章批注 | 全量 `npm test` 仍有 3 个既有失败（`DELETE /api/notebook`、`DELETE /api/sessions/:id`），和批注功能无关但影响 CI 信心 | annotation test-report ⚠️ | ❌ 待修复 |
| B10 | 🔴 高 | 文档链接 | `docs/product/DOC_REVIEW.md` 中存在 13 个 broken links，`npm run docs:check` 返回失败，阻塞 CI docs 校验 job | 多轮 test-report ⚠️ | ❌ 待修复 |
| B11 | 🟡 中 | 文章批注 | 文章正文大幅修改（段落顺序调整、内容增删）后，批注位置锚点依赖字符偏移，会导致下划线标记与批注脱节或指向错误位置 | annotation brief、test-report | ⚠️ 已知风险 |
| B12 | 🟡 中 | Workflow | JSON 编辑器不校验 Schema，输入语法错误时只有保存失败的 toast，用户无法知道哪里写错 | workflow test-report残余风险 | ❌ 待修复 |
| B13 | 🟡 中 | 语音输入 | 录音超过 90 秒自动停止的 `voiceErrorTooLong` 逻辑依赖 `setTimeout`，真实环境（浏览器节流、设备睡眠）可能未按预期触发 | voice test-report 已知限制 | ⚠️ 待真实设备验证 |
| B14 | 🟡 中 | 对话沉淀 Skill | `manage_skill` 接收的是 LLM 原始生成文本；若模型生成的 frontmatter 格式不完整或 YAML 解析失败，错误信息直接以工具返回文本暴露给用户，缺少友好提示 | skill authoring test-report | ❌ 待改善 |
| B15 | 🟢 低 | Agent 运行时 | E2（前端 cursor 级 SSE reconnect 测试矩阵）仍未完成，覆盖范围空白，SSE 断线重连行为缺乏回归保障 | agent-runtime issues.md E2 | ❌ 待补充 |
| B16 | 🟢 低 | 首次使用清单 | 用户若手动重命名了空会话（标题不再是默认值），清单会误判为"已发送第一条消息"，导致清单提前关闭 | checklist test-report | ⚠️ 已知边界 |

---

## 四、功能缺陷（承接上轮未解决项）

### 4.1 本轮新功能遗留缺口

| # | 优先级 | 功能 | 缺失内容 | 状态 |
|---|--------|------|---------|------|
| F14 | 🔴 高 | 文章批注 | Brief 核心设计中的**辅助批注面板**（按文章顺序列出所有批注、筛选 open/resolved、点击跳转正文位置）未实现；当前批注只能通过正文 hover 访问，无法全局浏览 | ❌ 待实现 |
| F15 | 🟡 中 | 文章批注 | Brief 中的**段落批注入口**（hover 段落左侧显示"+ 批注"按钮）未实现，当前只有选区气泡菜单入口 | ❌ 待实现 |
| F16 | 🟡 中 | Workflow 引擎 | 缺少**步骤类型模板**或向导式创建（branch / retry / parallel 步骤），JSON 编辑器为唯一入口 | ❌ 待实现 |
| F17 | 🟡 中 | 文章内资源 | `/生成思维导图`、`/生成报告` 等 Slash 命令**没有触发词提示/自动补全**，用户需要先记住确切词才能使用 | ❌ 待改善 |
| F18 | 🟡 中 | 文章内资源 | 工具栏音频 icon 每次点击都**重新生成**朗读 artifact，无法复用同一文章已有的历史音频 | ❌ 待改善 |
| F19 | 🟡 中 | 对话沉淀 Skill | 保存 Skill 前**没有预览/编辑界面**，用户无法在保存前确认或修改 LLM 生成的 frontmatter 与正文 | ❌ 待实现 |
| F20 | 🟢 低 | 语音输入 | 缺少**转写语言偏好设置**；当前语言全靠模型自动推断，短句中文与英文混合时准确率不稳定 | ❌ 待实现 |
| F21 | 🟢 低 | 语音输入 | 缺少**自动发送偏好**（Brief Phase 2 规划项）；当前固定为"转写后仅插入不发送" | ❌ 待实现 |
| F22 | 🟢 低 | 系统状态 | Settings / Overview 中 Automation 状态卡**仅展示 Cron 数量**，未展示最近一次 Cron 运行的结果与时间 | ❌ 待改善 |
| F23 | 🟢 低 | Agent 运行时 | E3（运行时观测与调试面板）**完全未实现**，出问题时只能靠日志文件手工排查 | ❌ 待实现 |

### 4.2 上轮未解决功能缺陷（仍挂起）

| # | 优先级 | 状态 |
|---|--------|------|
| F4 | 🟡 中 | ❌ 技能无法排序或分组 |
| F5 | 🟡 中 | ❌ 无技能搜索功能 |
| F10 | 🟡 中 | 🔄 日期选择改善中（已有 `<input type="month">` 快速跳转，仍无跨月范围选择） |
| F11 | 🟢 低 | ❌ 搜索结果无高亮 |

---

## 五、体验问题（UX/UI）

### 5.1 本轮新增

| # | 严重度 | 场景 | 问题描述 |
|---|--------|------|---------|
| U12 | 🔴 高 | Workflow | JSON 编辑器无 Schema 校验、无错误行定位，普通用户基本无法独立写出有效 workflow；即便是技术用户也容易因细节笔误导致运行失败 |
| U13 | 🟡 中 | 文章批注 | 批注气泡（hover popover）在正文密集区域（如多处批注紧邻）容易相互遮挡，当前没有 z-index 或位置规避策略 |
| U14 | 🟡 中 | 文章内资源 | 折叠模块（思维导图/报告）默认展开还是折叠取决于编辑器状态，用户在重新打开文章后可能看到意外的展开/折叠状态，缺少"默认折叠"的一致策略 |
| U15 | 🟡 中 | 语音输入 | 录音状态出现在输入框区域内，与文字输入焦点冲突；移动端软键盘弹出时，录音状态条可能被遮挡 |
| U16 | 🟡 中 | 对话沉淀 Skill | 触发 `manage_skill` 的入口不清晰，用户需要知道"让 Agent 用 manage_skill 工具"这个心智才能使用该功能，新手无法自然发现 |
| U17 | 🟢 低 | 首次使用清单 | 清单已完成后关闭，再次打开新的 Chat 欢迎页时不会再显示，但也没有任何"重新查看" 入口；老用户重置配置后无法手动触发 |

### 5.2 上轮未解决 UX（仍挂起）

| # | 严重度 | 状态 |
|---|--------|------|
| U3 | 🟡 中 | ❌ Telegram Bot UI 运行控制与凭据配置职责混乱 |
| U6 | 🟡 中 | ❌ 工具调用卡片"详情"按钮仅 hover 可见，键盘/触屏不可用 |
| U7 | 🟡 中 | ❌ 默认目录标签不显示实际路径 |
| U8 | 🟡 中 | ❌ 模型选择不跟随会话上下文（始终全局状态） |
| U9 | 🟢 低 | ❌ 侧边栏笔记本区域无"暂无笔记本"空状态 |
| U10 | 🟢 低 | ❌ 欢迎页快捷卡片点击后不自动发送 |
| U11 | 🟢 低 | ❌ 侧边栏操作按钮仅 hover 时展示，移动端不可用 |

---

## 六、优化建议

| # | 价值 | 建议 |
|---|------|------|
| O11 | ⭐⭐⭐ | **Workflow 向导式创建**：提供"步骤模板库"或分步表单，用户选择触发方式和步骤类型后由表单生成 JSON，而不是让用户从头写 JSON；哪怕只是预置 3 个常用模板（日报摘要、Webhook 通知、周期数据导出）也能显著降低准入门槛 |
| O12 | ⭐⭐⭐ | **批注辅助面板**：在文章编辑器右侧或底部提供"全部批注"视图，支持 open/resolved 筛选和点击跳转，是当前批注功能最大的体验缺口 |
| O13 | ⭐⭐⭐ | **Skill 保存前预览**：`manage_skill` 生成的草稿先以可编辑弹窗展示给用户，允许修改 name/description/triggers/body 后再确认保存，降低因模型生成质量不稳定而直接产出脏数据的风险 |
| O14 | ⭐⭐ | **Slash 命令自动补全**：在文章编辑器里输入 `/` 后弹出命令面板，展示所有可用生成命令（生成摘要、生成思维导图、生成报告、插入批注等），用户无需记忆确切词 |
| O15 | ⭐⭐ | **语音输入语言设置**：在 Settings / Basic 或 Chat 输入区语音按钮旁增加语言选择，至少支持"自动检测"、"中文"、"英文"三档，降低混语场景误识率 |
| O16 | ⭐⭐ | **音频 artifact 复用**：工具栏音频 icon 点击后先检查当前文章是否已有朗读音频；如有则直接打开 viewer，如无才触发生成，减少重复生成成本 |
| O17 | ⭐⭐ | **系统状态最近运行结果**：Overview 中 Automation 卡片展示最近一次 Cron 运行的状态、时间和摘要，让用户无需进入 Automations tab 就能感知自动化健康度 |
| O18 | ⭐⭐ | **批注锚点稳定性增强**：在保存批注时同时记录 `beforeText` 和 `afterText`（各约 30 字符），文章改写后重新定位时采用"模糊匹配 + 就近原则"而非纯偏移量，降低漂移概率 |
| O19 | ⭐ | **Skill 触发词可见性**（上轮 O6，本轮再次重申）：在技能卡片上直接展示触发词，以及"如何在 Chat 里激活此 Skill"的说明 |
| O20 | ⭐ | **Agent 运行时调试面板**：在 Settings / Advanced 下增加"运行记录"入口，展示近期 run 列表、状态、耗时和错误，为高级用户提供排障视图 |

---

## 七、发展方向

本节提出下一阶段的产品方向，作为路线图更新的输入。

### 7.1 知识能力：从关键词检索到语义理解

**当前状态**：FTS5 全文检索 + 统一知识索引已落地，但没有 Embedding 向量化。  
**差距**：用户提问时系统无法理解语义相似内容，检索命中依赖关键词精准匹配，笔记利用率偏低。  
**方向**：
- 引入本地 Embedding（SQLite + vss 或 FAISS），为 Notebook 条目和记忆文件生成向量。
- 实现 RAG：对话时自动检索相关片段注入上下文，让长期知识积累真正影响 AI 回答质量。
- 对话后自动提取关键决策/偏好写入长期记忆，形成"越用越懂用户"的飞轮。

这是当前产品与 Notion AI / Obsidian Copilot 等竞品最大的能力差距，建议作为下一阶段核心 P1 目标。

### 7.2 Workflow 能力成熟化

**当前状态**：声明式 JSON 工作流 MVP 已落地，支持串行步骤和三种触发方式。  
**差距**：纯 JSON 编辑门槛过高，缺少 branch/retry/parallel，Skill 步骤未做 LLM 真实集成验证。  
**方向**：
- Phase 2：步骤模板库、schema-aware 表单、条件分支与失败重试。
- Phase 3：文件变更 / Notebook 新来源事件触发，RSS/邮件连接器，可视化简易编辑器。
- 中期目标：让非技术用户也能通过引导式界面构建"日报摘要 → 发 Telegram"这样的完整工作流。

### 7.3 文章阅读体验深化

**当前状态**：文章批注 MVP（选区划线 + 状态切换）、文章内资源（音频/导图/报告折叠模块）已落地。  
**差距**：批注辅助面板缺失，Slash 命令无提示，批注锚点稳定性有待增强。  
**方向**：
- 补全批注辅助面板（F14），形成"划线 → 写批注 → 批注面板回顾 → AI 汇总"的完整知识整理闭环。
- 实现段落批注入口（F15），让批注操作不依赖精准选区。
- 中期：支持把批注集中导出为独立笔记，或喂给 AI 生成"本文核心观点汇总"。

### 7.4 移动端体验

**当前状态**：有响应式布局，语音输入已覆盖移动场景，但多处交互（hover-only 按钮、侧边栏操作）移动端不可用。  
**差距**：部分 PM 审计问题（U6、U11）在移动端更严重，语音输入 Safari 兼容也未完成真实验证。  
**方向**：
- 把"仅 hover 可见"的操作按钮改为触屏友好的常驻或长按唤起。
- 完成 Safari iOS 语音输入验证，修复潜在 MediaRecorder 兼容问题。
- 中期：针对手机屏幕做专属快捷操作栏（语音 / 新建 / 最近 notebook），降低手机使用 Neo 的路径成本。

### 7.5 可观测性与运维

**当前状态**：JSONL 文件日志 + Token 用量追踪，PM2 进程管理，无结构化指标。  
**差距**：Agent 运行时 E3（调试面板）完全未实现，出问题只能手动翻日志文件。  
**方向**：
- 先补 Agent 运行记录列表（F23/O20）：展示近期 run 的状态、耗时和错误，是最小可用调试入口。
- 后续：`/health` 端点返回服务状态与依赖连通性；结构化 LLM 调用延迟与工具耗时指标。
- 远期：接入 Sentry 或等效错误追踪，进一步降低生产问题发现成本。

---

## 八、实施优先级建议

### P0 — 本轮务必修复

- [x] **B9** 修复 3 个既有 delete route 测试失败
- [x] **B10** 修复 `docs/product/DOC_REVIEW.md` 中 13 个 broken links
- [ ] **B12** Workflow JSON 编辑器增加 Schema 校验与错误行提示
- [ ] **F14** 实现批注辅助面板（全部批注 + 筛选 + 跳转）

### P1 — 近期迭代

- [ ] **O13** Skill 保存前预览/编辑弹窗
- [ ] **O11** Workflow 步骤模板库或向导式创建
- [ ] **F15** 段落批注入口（hover 左侧"+ 批注"按钮）
- [ ] **O14** Slash 命令面板（输入 `/` 后弹出可用命令列表）
- [ ] **U3** Telegram Bot UI 职责分离（凭据配置与运行控制分层）
- [ ] **U8** 模型选择持久化至会话（上轮延迟项）
- [ ] **7.1** RAG Embedding 向量化启动（最大能力缺口）

### P2 — 规划迭代

- [ ] **F19** 语音输入语言偏好设置
- [ ] **O16** 音频 artifact 复用
- [ ] **O18** 批注锚点稳定性（`beforeText/afterText` 模糊定位）
- [ ] **F23/O20** Agent 运行时调试面板
- [ ] **U6/U11** 工具卡片和侧边栏操作按钮触屏友好改造
- [ ] **F4/F5** 技能排序与搜索

### P3 — 长期优化

- [ ] **7.2** Workflow Phase 2/3（分支/重试/可视化编辑器）
- [ ] **7.4** Safari iOS 语音输入完整验证
- [ ] **7.5** 结构化可观测性与 `/health` 端点
- [ ] **B15** E2 SSE reconnect 测试矩阵补全
- [ ] **F10** 使用记录跨月范围选择
- [ ] **F11** 搜索结果高亮

---

## 九、本轮综合评分

| 维度 | 本轮评分（满分10） | 上轮评分 | 变化 | 说明 |
|------|----------------|---------|------|-----|
| 功能完整度 | 8.0 | 7.5 | +0.5 | 批注/资源/语音/Workflow 补充了关键能力 |
| 稳定性 | 7.5 | 7.0 | +0.5 | 测试覆盖率提升，但仍有 3 个失败用例与 13 个断链 |
| 易用性 | 6.5 | 6.5 | — | Workflow JSON 编辑器拉低了评分；批注面板缺失 |
| 视觉设计 | 8.5 | 8.5 | — | 整体一致，批注下划线和折叠模块风格融洽 |
| 信息架构 | 7.5 | 7.0 | +0.5 | 设置分层 Basic/Advanced 明显改善 |
| **综合** | **7.6** | **7.3** | **+0.3** | 稳步提升，主要缺口在 Workflow 易用性和批注完整度 |

---

## 十、一句话评价

Neo 已经从"能用"走向"好用"：语音、批注、资源内嵌让文章工作流更流畅，Workflow 引擎打开了自动化组合的可能。下一阶段的核心任务是把"高能力"转化为"低门槛"——Workflow 需要向导，批注需要面板，RAG 需要落地，让更多能力变成普通用户也能发现和使用的工具。
