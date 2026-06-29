# FAQ

## 首次启动没有配置文件怎么办？

直接启动即可。Neo 会在 `~/.neo/config.json` 自动生成单用户配置，并在后端控制台打印登录 `webToken`。如果你需要多用户或自定义路径，再复制 `packages/agent/src/config.local.example.ts` 到 `packages/agent/src/config.local.ts`。

## 登录 token 忘了怎么办？

查看 `~/.neo/config.json` 或 `packages/agent/src/config.local.ts` 中对应用户的 `webToken`。如果要重置，修改该字段并重启后端。

## API Key 在哪里填写？

当前模型运行时读取 `DEEPSEEK_API_KEY` 环境变量。设置后重启后端即可：

```bash
DEEPSEEK_API_KEY=sk-... npm run dev:bot
```

## 首次使用清单在哪里？

登录后进入空 Chat 欢迎页，会看到“开始使用 Neo”清单。它会引导你完成三件事：配置一个模型、发送第一条消息、创建一条 Notebook 笔记。

其中模型配置和 Notebook 条目会根据当前状态自动判断是否完成；如果你手动关闭了这个清单，当前浏览器里的关闭状态会被记住，现阶段还没有单独的“重新打开 checklist”入口。

## 端口冲突怎么办？

后端默认 `3000`，前端开发服务器默认 `5173`。后端可设置：

```bash
WEB_PORT=3001 npm run dev:bot
```

前端端口由 Vite 自动选择，或在 `web/vite.config.ts` 中调整。

## 外部系统怎么触发 Neo？

- Webhook：调用 `POST /api/webhook/:userId`，请求体包含 `message` 和用户的 `webhookSecret`。
- Cron：在 `{stateDir}/memory/schedule.json` 中配置定时任务。
- Workflow：通过 `/api/workflows` 管理串行步骤、运行历史和手动运行。

## 如何判断 Neo 是否已经准备好？

打开 `Settings / Basic / Overview`。

- 顶部显示 `Ready`，说明核心接口、账号和至少一个模型已经就绪。
- 显示 `Needs attention` 时，优先按卡片按钮进入 Models 或 Automations 修复。
- `技术详情` 会保留原始报错，适合排查后端 5xx、凭据缺失或配置格式错误。

如果 Overview 的 Backend 卡片持续异常，优先查看 `logs/YYYY-MM-DD.jsonl` 或重启后端，再返回页面重试。

## 如何清理历史会话和运行记录？

Web UI 侧边栏支持删除会话。运行态文件位于 `{stateDir}/runs/` 和 `{stateDir}/projects/`，一般不建议手工删除；需要批量清理前先备份 stateDir。

## 修改 AGENTS.md、Skill 或工具后为什么没生效？

调用 `POST /api/reload` 或重启后端。Neo 会重新加载 workspace prompt、`{stateDir}/skills`、`{stateDir}/tools` 和 `{workDir}/mcp.json`。

## MCP 工具为什么没有出现？

确认 `{workDir}/mcp.json` JSON 合法，命令可以非交互启动，并查看日志中是否有 `mcp` 连接失败信息。MCP 工具名会带 `mcp__server__tool` 前缀。

## code_exec 没有输出？

`code_exec` 只返回 stdout / stderr。Python 里使用 `print(value)`，Node.js 里使用 `console.log(value)`。
