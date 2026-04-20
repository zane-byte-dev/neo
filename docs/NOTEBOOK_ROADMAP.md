# Notebook 重塑路线图

> 对齐 Google NotebookLM 的体验，打造"源-对话-工作室"三位一体的知识工作台。
>
> 最后更新：2026-04-20

## 一、已完成（里程碑 M1：基础 UI + 模型编排）

### 后端（Koa + AI SDK）

- **模型参数全链路透传**：`notebook-ai.ts` 的 7 个生成函数（`generateSourceGuide`、`generateNotebookOverview`、`generateMindMap`、`generateReport`、`generateAudioScript`、`generateAndSaveSourceGuide`、`runNoteQuickAction`）以及 `notebook-chat.ts` 的 `streamNotebookChat` 统一接受可选 `model?: string`，默认 `gemma`。
- **路由层** `src/routes/notebook.ts` 新增 `extractModel(body)` 辅助，所有 POST 接口（`/source-guide`、`/overview`、`/artifact`、`/chat`、`/note/quick-action`）都会把请求体里的 `model` 传给服务层。
- **软删除 + 重命名**：`FrontmatterMeta` 新增 `archived?: boolean`；`nbListSources` 跳过归档项；新增 `nbArchiveSource` 和 `nbRenameSource`；路由 `/api/notebook/source/archive` 与 `/api/notebook/source/rename` 已就位。

### 前端（React 19 + Zustand 5 + Tailwind 4）

- **API 层**：`web/src/api.ts` 所有 notebook AI 接口都支持 `model` 参数；新增 `notebookArchiveSource`、`notebookRenameSource`。
- **三栏工作台** `NotebookWorkspace.tsx`：桌面端 Source | Chat | Studio，移动端底部 Tab；顶栏统一模型选择器（Auto / Flash / Pro / DeepSeek / Gemma / Gemini）。
- **新弹窗组件**：
  - `AddSourceModal.tsx` — 拖拽上传、URL、文本三种导入方式，统一入口。
  - `StudioActionModal.tsx` — 音频（deep-dive/summary/review/debate）、思维导图、报告（briefing/study-guide/faq/timeline/outline/custom）的配置与生成。
  - `SourceDetailView.tsx` — 点击来源打开的详情视图，Tab 切换"摘要与要点 / 原文内容"。
- **SourcePanel**：虚线 "添加来源" 大按钮；SourceRow 右上角三点菜单（重命名内联编辑、移除=归档）。
- **StudioPanel**：重写为卡片网格（音频 / 思维导图 / 报告 / 概览 / 笔记），卡片 → 弹窗配置 → 生成 → 查看；生成内容列表 hover 删除。
- **NotebookChat**：`selectedModel` 从 store 读取并传给 `streamNotebookChat`。

提交记录：`556f2c5 feat:ui`（21 文件，+1382 / -323）。

---

## 二、短期计划（里程碑 M2：打磨与感知）

目标：让当前功能"跑得顺、用得上"。预计 1 周内完成。

### 2.1 生成体验反馈

- [ ] **流式进度条**：`generateReport` / `generateAudioScript` / `generateMindMap` 目前是等待式 POST，长等待没有反馈。改为 SSE 或分阶段状态（规划 → 生成 → 润色）。
- [x] **乐观更新**：生成中的 Artifact 先加占位项，失败可重试。（已实现 StudioActionModal 三阶段进度条：规划 → 生成 → 完成）
- [x] **错误 Toast**：替换所有 `alert(...)` 为统一的 Toast 组件。（已创建 `Toast.tsx` + `ConfirmDialog.tsx`，替换全部 10 个 alert 和 5 个 confirm）

### 2.2 源管理

- [x] **批量操作**：在 SourcePanel 选中多个后，工具栏提供批量归档、批量生成摘要、批量移到其它 notebook。（已实现批量归档 + 批量生成摘要）
- [ ] **源内搜索**：SourceDetailView 顶部加 `Ctrl+F` 样式搜索框，高亮命中。
- [ ] **源排序与分组**：按类型、时间、字数、是否已有摘要分组；支持手动拖拽排序。
- [ ] **YouTube / 音频转录**：目前 import 只存元数据。接入 Whisper / ytdlp 转文字，把 transcript 写入 content。
- [ ] **PDF 分页预览**：当前只存纯文本，加一个可切换的原始 PDF 预览（pdf.js）。

### 2.3 对话体验

- [x] **引用块点击跳转**：`【N】` 已高亮，但点击应该打开 SourceDetailView 并滚动到对应片段（需要后端返回 offset）。（已实现点击跳转到 SourceDetailView，offset 滚动待后续）
- [x] **建议提问 one-click**：SourceGuide 的 `suggestedQuestions` 直接作为 Chat 输入 chips。（已实现：聚合所有选中来源的建议问题，空状态 + 输入框上方均展示 chips）
- [ ] **对话分支**：从某条消息 fork 为新会话。
- [ ] **引用模式切换**：严格模式（仅来源） / 混合模式（允许常识补充），对应不同 system prompt。

### 2.4 Studio 产物

- [ ] **音频播放器**：`ArtifactViewer` 的音频目前只展示脚本，接 TTS 后需要原生播放器（可变速、字幕跟随）。
- [ ] **思维导图交互**：当前是静态 Markdown，升级为 react-flow / markmap 交互式图谱，节点可展开/折叠/拖动。
- [ ] **报告导出**：PDF / Markdown / DOCX 三种导出。
- [ ] **产物重生成**：保留历史版本对比，支持"微调 prompt 再生成"。

---

## 三、中期计划（里程碑 M3：NotebookLM 对标 Plus）

目标：抹平与 NotebookLM 的差距并做出差异化。预计 2-3 周。

### 3.1 Audio Overview 深度对标

- **Interactive Mode**：听音频时用户可以按下按钮"打断问问题"，主持人应答后继续。需要客户端 WebRTC + 服务端可中断的对话 loop。
- **多角色 TTS**：目前脚本是 `A:` / `B:`，接入 OpenAI TTS HD 或 ElevenLabs，给每个角色固定音色。
- **字幕联动**：边播边高亮当前句，点击字幕跳转。

### 3.2 Studio 扩展类型

- [ ] **Study Guide 学习卡**：按知识点切分，Anki 式翻面学习；支持导出 .apkg。
- [ ] **Timeline 时间线**：从来源中抽取事件 + 日期，生成可视化时间轴。
- [ ] **Briefing Doc 执行摘要**：一页纸高管视图，含关键数字、风险、行动项。
- [ ] **FAQ**：按问题聚类，自动生成常见问答。
- [ ] **Quiz 测验**：选择题 / 填空题 / 简答题，作答后 AI 批改。

这些在 `StudioActionModal` 里已经以 `reportSubtype` 预留入口，但 `generateReport` 的 prompt 还没按子类型分化，需要改造为策略模式。

### 3.3 跨 Notebook 能力

- [ ] **全局搜索**：一次查询命中所有 notebook 的源与笔记。
- [ ] **源共享**：一个源被多个 notebook 引用（软链接 / 引用计数）。
- [ ] **模板 Notebook**：把一个 notebook 的结构（源清单、笔记、产物模板）保存为模板，一键应用。

### 3.4 协作

- [ ] **只读分享链接**：生成的报告、思维导图、音频可通过 URL 分享（需签名 token + 过期时间）。
- [ ] **协作评论**：他人在源或笔记上留言，@ 提及后触发通知。
- [ ] **Webhook**：来源更新（定时刷新 URL / YouTube 字幕变化）时触发 Agent 自动重新总结。

---

## 四、长期愿景（里程碑 M4+：Agent 化）

目标：让 Notebook 从"被动知识库"升级为"主动研究员"。

### 4.1 Research Agent

把 notebook 变成一个有目标的研究员：

- 用户输入目标（"做一份关于 xxx 的尽调"）。
- Agent 自动：搜索 → 评估来源 → 导入 → 生成摘要 → 交叉引用 → 产出报告。
- 中途可随时介入调整方向。

对应 `src/services/agent-runner.ts` 已有基础 Agent 框架，需要设计 Notebook 专用 tools：`notebook_search_web`、`notebook_import_url`、`notebook_cross_reference`、`notebook_write_section`。

### 4.2 记忆与上下文工程

- **长期记忆**：用户跨 notebook 的偏好（常用来源、写作风格、喜欢的输出格式）沉淀到 `space/{uid}/SOUL.md`。
- **上下文压缩**：超过 context window 时，自动把冷数据摘要化，保留 citations。
- **Embeddings 检索**：大规模来源下用向量检索替代全文喂入。

### 4.3 多模态

- **图片来源**：图表截图 → GPT-4V / Claude Vision 解析 → 结构化数据。
- **视频来源**：关键帧 + 转录 + 场景分段。
- **代码来源**：Git repo 导入，按模块 / 文件生成摘要与依赖图。

### 4.4 个性化

- **学习路径**：用户指定目标，Agent 基于 notebook 内容生成循序渐进的学习计划与测验。
- **写作副驾**：用户开始写作时，从 notebook 中实时拉取相关引用并建议下一句。

---

## 五、技术债与基础设施

- [ ] **测试覆盖**：notebook 相关只有 `src/services/__tests__/notebook-service.test.ts`，需补 `notebook-ai`、`notebook-chat`、新增路由的单元测试。
- [ ] **Token 用量 / 成本追踪**：`llm/client.ts` 的每次调用记录 prompt_tokens / completion_tokens，在 notebook 页面展示当月消耗。
- [ ] **日志分级**：目前大量 `console.log`，统一走 `utils/audit-logger.ts`。
- [ ] **前端代码拆分**：`StudioPanel.tsx`（600+ 行）、`SourcePanel.tsx`（500+ 行）按 tab / 子组件拆文件。
- [ ] **Store 模块化**：`useAppStore` 已经是上千行，拆成 `chatStore` / `notebookStore` / `uiStore`。
- [ ] **Tailwind Design Tokens**：颜色、圆角、动画都散落在 className 里，抽成 tokens（或 CSS variables）。
- [ ] **E2E 测试**：浏览器自动化覆盖"导入 → 摘要 → 对话 → 生成报告"主流程。
- [ ] **SSE / WebSocket 统一**：notebook-chat、agent-runner、未来的 interactive audio 都需要长连接，考虑抽一层。

---

## 六、近 1 周优先级（建议）

按用户感知冲击力 + 实现成本排序：

1. **Toast 替换 alert** — ✅ 已完成。创建 `Toast.tsx` + `ConfirmDialog.tsx`。
2. **Artifact 生成流式进度** — ✅ 已完成（三阶段进度条），完整 SSE 流式待后续。
3. **引用【N】点击跳转到源** — ✅ 已完成。点击跳转到 SourceDetailView。
4. **Suggested Questions Chips** — ✅ 已完成。聚合所有选中来源，空状态 + 输入框上方展示。
5. **音频 TTS + 播放器** — 2-3 天，NotebookLM 的杀手锏，必须有。
6. **报告子类型 prompt 分化** — ✅ 后端已在 M1 实现（`REPORT_PROMPTS` 策略模式）。
7. **批量源操作** — ✅ 已完成。批量归档 + 批量生成摘要。

---

## 七、参考

- Google NotebookLM 产品文档：<https://notebooklm.google.com>
- 现有代码锚点：
  - 服务层：[src/services/notebook-service.ts](../src/services/notebook-service.ts)、[src/services/notebook-ai.ts](../src/services/notebook-ai.ts)、[src/services/notebook-chat.ts](../src/services/notebook-chat.ts)
  - 路由：[src/routes/notebook.ts](../src/routes/notebook.ts)
  - 前端入口：[web/src/components/notebook/NotebookWorkspace.tsx](../web/src/components/notebook/NotebookWorkspace.tsx)
  - 模型路由：[src/llm/model-router.ts](../src/llm/model-router.ts)
