# Dev Plan — 文档助手体验重设计

**功能：** Doc Assistant UX Redesign  
**关联 Brief：** [brief.md](./brief.md)  
**状态：** ✅ 实现完成，构建通过  
**日期：** 2026-05-12  
**实现者：** AI Agent (GitHub Copilot)

---

## 一、实现范围

按 brief §三 全部 5 个子方案落地：

| # | 方案 | 状态 |
|---|------|------|
| 3.1 | 摘要模块（Inline Summary Block）| ✅ |
| 3.2 | 编辑器"更多菜单"新增 AI 操作区 | ✅ |
| 3.3 | NotebookChatDrawer 瘦身 | ✅ |
| 3.4 | 共享 Action 定义（docActions.ts）| ✅ |
| 3.5 | 编辑器顶栏「资源」图标 + ResourcesPanel | ✅ |

---

## 二、文件变更清单

### 新建文件

#### `packages/web/src/components/notebook/docActions.ts`
共享 AI 操作定义，供 NoteEditor 更多菜单使用。

- `DocEditAction` 接口：`id / label / icon / iconColor / desc / category:'edit' / editInstruction`
- `DocInsightAction` 接口：`id / label / icon / iconColor / desc / category:'insight' / buildPrompt`
- `EDIT_ACTIONS: DocEditAction[]`：polish（优化文档）、format（格式化）、expand（扩写改写）
- `INSIGHT_ACTIONS: DocInsightAction[]`：translate（翻译英文）

#### `packages/web/src/components/notebook/ResourcesPanel.tsx`
编辑器顶栏「资源」图标触发的右侧浮层面板。

- `PanelShell`：内部 shell 组件，带薄荷色 Sparkles 头部 + X 关闭按钮
- `ResourcesPanel`：三个视图（home / artifact / notes）
  - home 视图：4 张生成卡片（音频/导图/报告/概览）+ `StudioOutputs` 已生成列表 + 笔记入口按钮
  - artifact 视图：内嵌 `ArtifactViewer`，支持返回 home 或重新生成
  - notes 视图：内嵌 `NotesTab`
- 复用组件：`StudioActionModal`、`StudioOutputs`、`ArtifactViewer`、`NotesTab`

### 修改文件

#### `packages/web/src/components/NoteEditor.tsx`

**新增 import：**
- `Layers, Languages, Sparkles, RefreshCw, EyeOff`（lucide-react）
- `DocDiffModal`（notebook/DocDiffModal）
- `ResourcesPanel`（notebook/ResourcesPanel）
- `EDIT_ACTIONS, INSIGHT_ACTIONS, type DocEditAction`（notebook/docActions）
- `useAppStore`（stores/useAppStore）

**新增 state：**
```ts
const [resourcesOpen, setResourcesOpen]     // 资源面板开关
const [diffAction, setDiffAction]            // AI 编辑动作 → DocDiffModal
const [summaryState, setSummaryState]        // 'empty' | 'generating' | 'done'
const [summaryText, setSummaryText]          // 摘要文本
const [summaryCollapsed, setSummaryCollapsed]// 折叠（localStorage 持久化）
```

**新增 handlers：**
- `handleGenerateSummary()` — 调用 `/api/generate`，写入 summaryText + `notebookUpdate(note.id, { summary })`
- `handleRegenerateSummary()` — 清空后重新调 generate
- `handleHideSummary()` — 折叠 + localStorage 写入
- `handleAiEditAction(action)` — 关闭菜单，设 diffAction → DocDiffModal
- `handleAiInsightTranslate()` — 关闭菜单，`setPendingQuickReply(translatePrompt)`

**JSX 变更：**
1. 根 `div` 加 `relative` class（供 ResourcesPanel overlay 定位）
2. 顶栏工具区：`···` 菜单左侧加 `Layers` 图标按钮（toggle resourcesOpen，活跃时薄荷色）
3. 更多菜单：版本历史下方加 AI 助手分区（分隔线 + EDIT_ACTIONS 循环 + 翻译英文按钮）
4. 正文区：标题分隔线后插入三态摘要模块（empty 提示条 / generating loading / done 摘要卡片）
5. 返回 JSX 底部加：`DocDiffModal`（diffAction 存在时）+ ResourcesPanel overlay（resourcesOpen 时，绝对定位 right-0，z-40，带背景遮罩）

**Bug 修复：**
- `toggleFullWidth` 中移除无意义的 `localStorage.getItem` 调用

#### `packages/web/src/components/notebook/NotebookChatDrawer.tsx`

**移除：**
- `DOC_ACTIONS` 数组定义（共 6 个 action）
- `DocAction` 接口
- `editActions` / `insightActions` 过滤变量
- `hasDoc` 布尔变量
- "文档改写"和"内容分析"两组 ActionButton 的 JSX 块
- `diffAction` state
- `DocDiffModal` import 及 JSX 实例
- `ActionButton` 子组件
- 不再使用的 icon import：`Wand2, AlignLeft, ListChecks, Languages, Minimize2, PenLine, PenSquare, MessageSquareDot`
- `onNoteApply` prop（已迁移逻辑到 NoteEditor）

**保留：**
- 头部（标题 + 当前文章标签 + 关闭按钮）
- ChatArea（含 slash 命令：音频/导图/报告/概览）
- 生成内容折叠条（ArtifactFloatPanel）
- StudioActionModal

#### `packages/web/src/components/notebook/NotebookWorkspace.tsx`

- 移除 `onNoteApply` prop 传入
- 移除 `handleNoteApply` callback
- 移除 `notebookUpdate` import（不再被 Workspace 层直接调用）

---

## 三、关键技术决策

### 摘要写回方案
直接调用 `notebookUpdate(noteId, { summary })` 写回，与 `content` 字段无交叉，NovelEditor 不会重渲染。

### DocDiffModal 迁移
原位于 `NotebookChatDrawer`，现迁移到 `NoteEditor` 自持。`onApply` 回调直接调用 `notebookUpdate` + `setContent`，不需要 prop 向上传递。

### 翻译动作（insight）
通过 `useAppStore.setPendingQuickReply` 向 ChatArea 注入 prompt，无需 NoteEditor 持有 chatDrawer 开关状态（用户需要手动打开抽屉，或后续通过 store action 自动打开，见 brief 风险项 #2，已知 defer）。

### ResourcesPanel 层级
- `NoteEditor` 根容器 `position: relative`
- Panel `position: absolute; right: 0; top: 0; height: 100%; width: 320px; z-index: 40`
- 背景遮罩 `position: absolute; inset: 0; z-index: 30; bg-black/10`，点击关闭
- `StudioActionModal` 使用 portal 渲染到 body，z-index 高于面板，无层叠冲突

### Tailwind 动画
复用已有 CSS 变量 `--animate-slide-in-right`（`slide-in-right` keyframe，0.3s ease），对应 Tailwind v4 自动生成的 `animate-slide-in-right` 工具类。

---

## 四、未实现 / 已知 defer

| 项目 | 原因 |
|------|------|
| 翻译后自动打开 ChatDrawer | 需要 store 新增 `openChatDrawer` action，跨组件状态提升；本期 defer，已在 brief 风险项 #2 记录 |
| i18n key（zh.ts / en.ts）| 当前实现使用硬编码中文字符串；UI 为中文产品，优先级低，defer |
| StudioPanel 右侧列移除 | brief §六 明确不在本期范围 |
| 摘要流式渲染 | brief §六 明确不在本期范围 |
| Resources Panel 拖拽排序 | brief §六 明确不在本期范围 |
