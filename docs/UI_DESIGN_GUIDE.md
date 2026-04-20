# Neo Web UI 设计规范

参考 Notion / Linear 等产品的视觉语言，建立统一的设计体系。

## 色彩体系

### 文本层级

| Token | 用途 | Light | Dark | Classic-Dark |
|-------|------|-------|------|--------------|
| `--color-text` | 主文本、标题 | `#111827` | `#f3f4f6` | `#d4d4d4` |
| `--color-text-secondary` | 正文、描述 | `#374151` | `#d1d5db` | `#a1a1aa` |
| `--color-text-tertiary` | 图标、辅助信息、placeholder | `#6b7280` | `#9ca3af` | `#71717a` |
| `--color-text-quaternary` | 禁用态、分隔线标签 | `#9ca3af` | `#6b7280` | `#52525b` |

**原则**：图标和可交互元素至少使用 `text-tertiary`，`text-quaternary` 仅用于真正的装饰/禁用态。

### 背景层级

| Token | 用途 | Light | Dark |
|-------|------|-------|------|
| `--color-bg-layout` | 最底层背景 | `#f0f1f5` | `#060a14` |
| `--color-bg-sidebar` | 侧边栏 | `#f7f7f5` | `#0d1220` |
| `--color-bg-container` | 主内容区 | `#ffffff` | `#0a0f1a` |
| `--color-bg-elevated` | 弹窗、浮层 | `#ffffff` | `#151b2b` |

### 侧边栏专用

| Token | 用途 | Light | Dark |
|-------|------|-------|------|
| `--color-sidebar-active` | 选中项背景 | `#efefef` | `#1a2236` |
| `--color-sidebar-hover` | 悬停背景 | `#f3f3f1` | `#141c2e` |

### 主题色

- **Primary**: `--color-primary-mint` (`#34d399`) — 品牌绿，用于强调、CTA
- **Accent**: `--color-accent-indigo` (`#818cf8`) — 辅助紫，用于链接、标签
- **Destructive**: `--color-destructive` (`#ef4444`) — 删除、危险操作

## 间距 & 圆角

| Token | 值 | 场景 |
|-------|-----|------|
| `--spacing-panel` | `12px` | 面板内边距 |
| `--spacing-card` | `12px` | 卡片内边距 |
| `--spacing-section` | `16px` | 区块间距 |
| `--radius-sm` | `8px` | 按钮、输入框、标签 |
| `--radius-md` | `12px` | 卡片、下拉菜单 |
| `--radius-lg` | `16px` | 弹窗 |

## 侧边栏设计规范

### 结构层次（自上而下）

1. **搜索框** — 无边框、`bg-sidebar-hover`，聚焦时出现边框和高亮环
2. **导航区** — New Chat（带图标容器）、Notebook、Apps
3. **列表区** — 段落标题（`text-quaternary uppercase tracking-wider`）+ 列表项
4. **用户区** — 头像 + 名称，底部固定

### 列表项样式

```
默认：  text-text-secondary, bg-transparent
悬停：  text-text-secondary, bg-sidebar-hover
选中：  text-text font-medium, bg-sidebar-active
```

- 圆角统一使用 `rounded-lg`（8px）
- 文字大小 `text-[13px]`
- 内边距 `px-2.5 py-[7px]`
- Hover 操作按钮使用 `text-text-tertiary hover:text-text-secondary`

### New Chat 按钮

图标使用绿色容器包裹：`w-5 h-5 rounded-md bg-primary-mint/15`，图标本身 `text-primary-mint`。

## 聊天区设计规范

### 工具栏图标

- 默认色：`text-text-tertiary`（不要用 quaternary，太淡看不到）
- 悬停色：`text-text-secondary hover:bg-fill`
- 激活态（如朗读开启）：`text-primary-mint bg-primary-mint/10`

### 输入区

- 背景 `bg-fill-secondary/80`，边框 `border-border`
- 聚焦时 `ring-2 ring-primary-mint/30 border-primary-mint/40`
- Placeholder 使用 `text-text-tertiary`

### 模型选择器

- 带微弱背景 `bg-fill/60`，hover 时显示边框
- 文字 `text-text-secondary text-[11px] font-medium`

### 发送按钮

- 可用态：渐变绿 `from-primary-mint to-emerald-500`，白色图标
- 禁用态：`bg-fill text-text-tertiary`

## 阴影

| Token | 场景 |
|-------|------|
| `--shadow-soft` | 输入框、消息气泡 |
| `--shadow-elevated` | 下拉菜单、工具提示 |
| `--shadow-float` | 弹窗、上下文菜单 |

## 动效

- 过渡时间：`duration-150`（快速交互如 hover）、`duration-200`（状态切换）
- 列表项切换 `transition-all duration-150`
- 弹窗入场使用 `animate-slide-up`
- 避免 `duration-300+`，保持响应灵敏

## 设计原则

1. **对比度优先** — 可交互元素必须清晰可见，WCAG AA 标准
2. **层次分明** — 通过背景色差区分侧边栏 / 主内容 / 浮层
3. **克制动效** — 仅在状态变化时使用，时长不超过 200ms
4. **Notion 式简洁** — 无多余装饰，信息密度适中，留白充分
5. **三主题一致** — 每个 token 在 light / dark / classic-dark 下都有合理映射
