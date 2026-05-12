# Product Brief — 文档助手体验重设计

**功能名称：** 文档助手体验重设计（Doc Assistant UX Redesign）  
**文档状态：** Draft  
**作者：** PM  
**日期：** 2026-05-12  
**优先级：** P1  
**预计范围：** 前端 UI 改动，无新后端接口

---

## 一、背景与问题

当前文档助手（NotebookChatDrawer）在 NoteEditor / NotebookWorkspace 中以右侧抽屉形式呈现。抽屉上半部分是一排快捷操作按钮（6 个，分"文档改写"和"内容分析"两组），下半部分是 AI 对话区。

**核心问题：**

1. **按钮区与编辑区割裂。** 快捷操作结果（如"提取要点"）出现在对话框里，用户需要在编辑区和对话框之间来回切换，认知负担高。
2. **"提取要点 / TL;DR"的价值被埋没。** 这两个功能本质是"帮我理解这篇文章"，最自然的呈现位置是文章顶部，而不是对话框输出。
3. **快捷操作占据抽屉大量垂直空间。** 抽屉上方的 2 行按钮网格把聊天区压缩到更小，而且大多数用户每次只用其中 1-2 个功能。
4. **"翻译""优化"与编辑器的结合度不够。** 这两个操作直接修改文档内容，理应与编辑器顶栏的"更多操作"菜单整合，而非藏在抽屉里。

---

## 二、目标

1. **降低门槛**：最常用的"摘要"功能一键可达，结果直接呈现在正文上方，无需打开抽屉。
2. **编辑器优先**：修改类操作（优化、格式化、扩写、翻译）和编辑器顶栏融合，让操作发起路径更自然。
3. **抽屉归位**：文档助手抽屉回归"对话"核心，不再承担快捷操作展示板的职责。

---

## 三、设计方案

### 3.1 摘要模块（Inline Summary Block）

**位置：** NoteEditor 正文区域，文章标题下方、正文内容上方。  
**仅对已保存文章显示**（`note !== null`），新建未保存时不显示。

#### 状态机

```
empty → generating → done
       ↑              ↓
       └── regenerate ←
```

| 状态 | 显示 |
|------|------|
| `empty`（summary 字段为空） | 一条浅色提示条：`✨ 生成摘要` 按钮 + "点击获取 AI 概要" 文案 |
| `generating` | 提示条变为 loading shimmer，按钮 disabled |
| `done` | 显示摘要卡片：标题"摘要"、正文（TL;DR ≤150 字）、右上角"重新生成"和"隐藏"按钮 |

#### 交互细节
- **点击"生成摘要"**：调用现有 `/api/generate` 端点（与 TL;DR insight action 同一 prompt），结果自动写入文章 `summary` frontmatter 字段（通过 `notebookUpdate` 保存）。
- **重新生成**：清空已有 summary，重走 generating → done 流程。
- **"隐藏"**：仅折叠卡片（本地状态），不清空 summary 字段；下次打开文章时不展开（存入 localStorage key `neo:editor:summaryCollapsed:<noteId>`）。
- **summary 字段已有内容**：打开文章时直接展示 done 状态（即使是手动填写的摘要）。

#### 视觉规格
- 摘要卡片：圆角 12px，背景 `bg-primary-mint/8`，左侧 2px `bg-primary-mint` 竖线，字号同 prose-sm。
- 空状态提示条：`bg-fill-secondary/60`，虚线边框，文案灰色，高度 36px。
- 与标题下边距：`mt-6`，与正文上边距：`mb-8`。

---

### 3.2 编辑器"更多菜单"新增 AI 操作区

**位置：** NoteEditor 顶栏 `MoreHorizontal` 下拉菜单，在"版本历史"下方新增分隔线 + "AI 助手"区。

#### 菜单项列表

| 图标 | 标签 | 功能 | 交互 |
|------|------|------|------|
| `Wand2` 紫色 | 优化文档 | 改善表达与结构 | 打开 DocDiffModal（polish instruction）|
| `AlignLeft` 蓝色 | 格式化 | 规范 Markdown 排版 | 打开 DocDiffModal（format instruction）|
| `PenLine` 青色 | 扩写改写 | 补充细节或换写法 | 打开 DocDiffModal（expand instruction）|
| `Languages` 橙色 | 翻译英文 | 翻译为英文 | 打开 NotebookChatDrawer + 发送 translate prompt |

**说明：**
- "优化/格式化/扩写"三项触发 DocDiffModal，需要 NoteEditor 自持 `diffAction` 状态以及 `DocDiffModal` 实例（NoteEditor 目前没有，需要新增）。
- "翻译英文"属于 insight 类（结果在对话框看最自然），通过 `useAppStore.setPendingQuickReply` 发送，同时触发 NotebookChatDrawer 打开（如已关闭），需要将抽屉 open 状态提升或通过 store 驱动。
- 菜单触发 AI 操作时，先关闭下拉菜单，再执行操作。

---

### 3.3 NotebookChatDrawer 瘦身

**目标：** 移除快捷操作按钮区，抽屉只保留对话功能。

#### 变更
- 删除"文档改写"和"内容分析"两组按钮（6 个 ActionButton）。
- 删除 `editActions` / `insightActions` 渲染块。
- 删除 `DOC_ACTIONS` 数组（或保留定义供 NoteEditor 复用，见下节）。
- `diffAction` 状态 + `DocDiffModal` 实例迁移到 NoteEditor 内（与 3.2 共用）。
- Header 区不变，chat 区上移，视觉更宽敞。

**Slash 命令不变**：`/音频概览` `/思维导图` `/报告` 等保留在对话输入框。

---

### 3.4 共享 Action 定义

将 `DOC_ACTIONS`（优化、格式化、扩写）的定义迁移到单独文件 `web/src/components/notebook/docActions.ts`（或 `docActions.tsx`），供：
- NoteEditor 更多菜单 import
- NotebookChatDrawer（如后续需要扩展）import

---

### 3.5 编辑器顶栏新增「资源」图标（Resources Panel）

**位置：** NoteEditor 顶栏，`···` 菜单左侧，新增一个 icon 按钮（建议图标 `Layers` 或 `Package`，颜色淡薄荷色）。

**触发方式：** 点击图标，在编辑区右侧弹出一个宽约 320px 的浮层面板（overlay drawer），不推开编辑内容，而是叠加在上方；再次点击或点击面板外侧关闭。

#### 面板内容结构（从上到下）

```
┌─────────────────────────────────────────┐
│  [Layers] 资源                   [×]    │
├─────────────────────────────────────────┤
│ ── 内容生成  · 基于所有来源  ──          │
│  ╔══════════╗  ╔══════════╗             │
│  ║ 🎙 音频  ║  ║ 🧠 导图  ║             │
│  ╚══════════╝  ╚══════════╝             │
│  ╔══════════╗  ╔══════════╗             │
│  ║ 📄 报告  ║  ║ ✨ 概览  ║             │
│  ╚══════════╝  ╚══════════╝             │
├─────────────────────────────────────────┤
│ ── 已生成  ──────────────────────────── │
│  [思维导图] 知识图谱 v1          [···]  │
│  [音频]    播客脚本 - 第一章     [···]  │
│  …                                      │
├─────────────────────────────────────────┤
│ ── 笔记  ──────────────────────────────│
│  [+ 添加笔记]                           │
└─────────────────────────────────────────┘
```

#### 各区说明

| 区域 | 内容 | 来源 |
|------|------|------|
| 内容生成 | 4 个卡片：音频概览 / 思维导图 / 报告 / 概览 | `GENERATE_CARDS`（来自 StudioPanel）|
| 已生成 | 该笔记本所有 Artifact 列表，点击打开 `ArtifactViewer` | `StudioOutputs` |
| 笔记 | 「+ 添加笔记」入口 | `NotesTab` 入口 |

#### 与 StudioPanel 的关系

- **Resources Panel = StudioPanel 的新入口**，内容完全对等，不新增后端逻辑。
- NotebookWorkspace 现有的右侧 StudioPanel 列可以**默认折叠或按实验性 flag 隐藏**，本期作为可选项，不强制删除。
- 未来评估 StudioPanel 列的保留价值；若用户普遍通过 Resources Panel 操作，后续版本可移除右侧列，进一步扩大编辑区。

#### 弹层技术方案

- `ResourcesPanel` 组件：`position: absolute; right: 0; top: 0; height: 100%; z-index: 40`，叠加在 NoteEditor 容器（`relative`）上。
- 背景遮罩：半透明 `bg-black/20`，点击关闭，不阻断外部列表交互。
- 动画：从右侧 `translateX(100%)` slide-in，100ms ease-out。
- 点击 icon 时，若抽屉已打开则关闭（toggle）。

---

## 四、完整交互流程图

```
用户打开文章
    │
    ├── summary 字段有内容 ──→ 展示摘要卡片（done 状态）
    │
    └── summary 字段为空  ──→ 展示"✨ 生成摘要"提示条
              │
              └── 点击生成
                    │
                    ├── 调用 /api/generate（TL;DR prompt）
                    ├── 流式展示结果（或 loading 后展示）
                    └── 写入 summary 字段 → notebookUpdate

用户点击编辑器顶栏「资源」图标（Layers icon）
    │
    └── 打开 Resources Panel（右侧浮层）
          │
          ├── 点击"音频概览 / 思维导图 / 报告" ──→ StudioActionModal（与现有一致）
          │                                             └── 生成完毕 → Artifact 写入"已生成"列表
          ├── 点击 Artifact 条目 ──→ ArtifactViewer 全屏展开
          └── 点击"添加笔记" ──→ NotesTab

用户点击编辑器顶栏"···"
    │
    ├── 优化文档 / 格式化 / 扩写改写 ──→ DocDiffModal（行级 diff）
    │                                        │
    │                                        └── 接受 → 写入正文
    │
    └── 翻译英文 ──→ 打开 ChatDrawer + send prompt
```

---

## 五、变更范围与文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `web/src/components/NoteEditor.tsx` | 修改 | 新增摘要模块渲染；更多菜单新增 AI 操作区；新增 `diffAction` state + `DocDiffModal`；新增「资源」图标 + `ResourcesPanel` toggle |
| `web/src/components/notebook/NotebookChatDrawer.tsx` | 修改 | 删除快捷操作按钮区；迁出 `DOC_ACTIONS` 定义 |
| `web/src/components/notebook/docActions.ts` | 新建 | 共享 `DOC_ACTIONS` 常量（edit 类） |
| `web/src/components/notebook/ResourcesPanel.tsx` | 新建 | 内容生成卡片 + Artifact 列表 + 笔记入口；复用 `StudioOutputs`、`StudioActionModal`、`ArtifactViewer`、`NotesTab` |
| `web/src/api.ts` | 可能修改 | 新增 `notebookGenerateSummary` 或复用现有 `/api/generate` |
| `web/src/i18n/locales/zh.ts` | 修改 | 新增摘要、资源面板相关 i18n key |
| `web/src/i18n/locales/en.ts` | 修改 | 对应英文 key |

---

## 六、不在本期范围

- StudioPanel 右侧列的**正式移除**（本期仅新增 Resources Panel 入口，右侧列保留并标记为 legacy；下期评估后决定是否删除）
- 移动端适配（保持现状）
- 摘要支持中文以外语言版本
- 摘要支持流式逐字渲染（先用请求完成后统一展示）
- Resources Panel 内的拖拽排序、固定/取消固定 Artifact

---

## 七、成功指标

- 用户在不打开 AI 助手抽屉的情况下可以完成摘要生成（核心流程）
- 文档助手抽屉的聊天区垂直可视高度提升 ≥ 30%
- "优化/翻译"入口仍可发现（更多菜单有提示）
- 通过「资源」图标可以完成内容生成（音频/导图/报告）全流程，无需离开编辑区切换到 Studio 列

---

## 八、风险与注意事项

1. **NoteEditor 新增 DocDiffModal**：NoteEditor 目前不依赖 NotebookChatDrawer，需要确认 `DocDiffModal` 的 props 结构，以及 `onNoteApply` 回调能否从 NoteEditor 直接调用（`notebookUpdate` 已有，可以）。
2. **翻译动作需要打开抽屉**：NoteEditor 目前不持有 ChatDrawer 的开关状态，这个状态在 `NotebookWorkspace` 层。需要通过 `useAppStore` 新增 `openChatDrawer()` action，或通过 prop callback 向上传递。
3. **摘要写回**：`notebookUpdate` 已支持 `summary` 字段，但需要确认 NovelEditor 渲染路径不会因为 `summary` 字段更新导致 content 闪烁（它们走不同字段，应无问题）。
4. **Resources Panel 与 StudioPanel 的状态同步**：`notebookArtifacts` 已通过 `useAppStore` 全局管理，两个入口读同一份 store，刷新时互不干扰，不需要额外同步逻辑。
5. **Resources Panel 的 notebook 上下文**：NoteEditor 接收 `notebook` prop，可以直接传入 `ResourcesPanel`；但 NoteEditor 也可能在 standalone 模式（`/notebook/article/new`）下使用，此时 Resources Panel 仍需要 notebook 名才能调 API，需要确保 prop 链路完整。
6. **StudioActionModal 在 Resources Panel 内的层级**：弹层内再弹弹窗，z-index 需要确保 `StudioActionModal`（portal 渲染到 body）高于 Resources Panel（z-40），当前 modal 若用 `z-50` 或 portal 则无问题。
