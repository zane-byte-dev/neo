# First-run Checklist Test Report

## Scope

验证首次使用清单 MVP：空 Chat 欢迎页展示 checklist、完成状态来源、关闭状态持久化、入口跳转和中英文文案。

## Acceptance Criteria Coverage

- 新用户空 Chat 首页展示 checklist：已通过浏览器冒烟验证。
- 至少包含“配置模型”“发送第一条消息”“创建 Notebook 笔记”：已实现并截图验证。
- 未完成项有明确入口：模型入口到 `/settings/models`，消息入口聚焦输入框，Notebook 入口到 `/notebook/article/new?notebook=personal`。
- 模型与消息自动完成：模型走 `/api/models` 的 `configured`；消息走已加载 user message 或非默认会话标题。
- 关闭后刷新不再自动显示：关闭状态持久化在 Zustand `neo-web-store`。
- 移动端布局：未完成设备截图；组件使用 `max-w-lg`、紧凑行和不遮挡输入框的欢迎页布局。
- i18n：新增 en/zh keys，欢迎页新增/触碰文案不再硬编码。
- 自动化测试：web 包当前没有测试 runner，本轮用 TypeScript build 和浏览器冒烟替代。

## Tests Added Or Updated

未新增自动化测试；当前 `web/package.json` 仅有 `dev`、`build`、`preview` 脚本。

## Commands Run

- `npm run docs:check`：通过，`OK: checked 57 Markdown files.`
- `npm --prefix web run build`：通过。

## Findings

- 首次运行前端 dev server 时，root 脚本参数被错误传递为 `vite 127.0.0.1`，导致 `/chat` 返回 404；已改用 `cd web && npm run dev -- --host 127.0.0.1` 进行冒烟验证。
- `DocDiffModal.tsx` 存在既有 TypeScript 构建阻塞：未定义 `buildChunks` 且保留未使用 LLM 分段函数；已做最小修复以恢复 web build。

## Regression Risks

- Notebook 完成状态会在欢迎页加载时按 notebook 顺序查询条目；大量 notebook 时可能略慢，但仅在 checklist 可见时触发。
- 已有非默认标题会话会被视为“已发送第一条消息”，这对老用户合理，但对手动改名的空会话可能误判。

## Release Recommendation

accept