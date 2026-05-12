# Settings Guidance And System Status Test Report

## Scope

验证 [Settings Guidance And System Status](brief.md) 的 Phase 1 MVP：危险确认统一、设置页 Basic / Advanced 分层、Settings Overview 系统状态卡片，以及模型、Telegram、MCP、自动化失败时的可行动修复提示。

对应开发计划见 [plan.md](plan.md)。

## Acceptance Criteria Coverage

- Web 端 destructive 操作不再使用 `window.confirm`：已通过代码搜索确认，运行时代码不再调用 `window.confirm`，批量删除会话已走 `ConfirmDialog`。
- 设置页默认先进入 Basic / Overview：已通过浏览器冒烟验证 `/settings` 渲染 Overview，并展示 Basic / Advanced 分组导航。
- Apps / MCP / Automations 不再与 Models / Skills 并列为同一组：已通过浏览器冒烟验证高级项归入 Advanced 分组。
- 至少 3 类高频错误具备下一步修复提示：已覆盖模型加载、Telegram 设置、MCP 保存、Cron/自动化保存与加载失败。
- 系统状态卡片至少展示用户、模型可用性、后端可达性：Overview 聚合 `/api/me`、`/api/models`、`/api/preferences`、`/api/crons`，并展示 Backend、Account、Models、Automation 四类状态。
- 移动端不溢出：未做独立移动截图；布局使用响应式 grid、flex wrap 和 `max-w-5xl` 容器，仍建议后续用真实移动视口复查。
- 新增文案支持中英文 i18n：已新增 en/zh keys，新增 UI 文案不依赖硬编码中文或英文。
- 自动化测试或组件级回归测试覆盖：web 包当前没有测试 runner，本轮使用 TypeScript/Vite build、代码搜索和浏览器冒烟替代。

## Tests Added Or Updated

未新增自动化测试。当前 `web/package.json` 仅提供 `dev`、`build`、`preview`，没有前端组件测试脚本。

## Commands Run

- `npm --prefix web run build`：通过。
- `npm run docs:check`：通过。

## Browser Smoke

在共享页面 `http://127.0.0.1:5173/settings` 验证：

- `/settings` 能渲染 Overview、系统状态总览、Backend / Account / Models / Automation 子状态卡。
- 当前后端 API 返回 500 时，Overview 能显示“需要处理”、错误横幅、技术详情和重试入口。
- `/settings/models` 能显示可行动模型加载错误横幅。
- `/settings/automations` 能显示自动化加载错误横幅，同时保留 Cron 表单和重试入口。

## Findings

- 当前共享环境后端 API 存在 500 / aborted 请求，因此未能验证健康状态下的 Ready 视觉状态；异常状态路径已验证。
- 现阶段系统状态仍由前端聚合多个接口，后续若增加 `/api/system-status`，应补充后端 readiness 映射单元测试。
- `SettingsPanel` 中 Overview 逻辑已经变大；若继续扩展工作区、运行历史或语音转写状态，建议拆成独立组件文件。

## Regression Risks

- 老用户原本从侧栏设置直接进入 Models，现在会先进入 Overview；已保留一键进入 Models 的状态动作。
- Provider health warning 当前不阻塞 overall Ready，只作为 Models 子卡摘要展示；如果产品后续要求更严格 readiness，需要调整判定规则。
- 自动化状态首版仅展示 Telegram 与 Cron 数量，尚未展示最近一次 Cron 运行结果。

## Release Recommendation

accept
