# FAQ

## 首次启动没有配置文件怎么办？

直接启动即可。Neo 会在 `~/.neo/config.json` 生成单用户配置，并在后端控制台打印登录 `webToken`。多用户或自定义路径可使用 `packages/agent/src/config.local.example.ts`。

## 模型在哪里配置？

模型与 provider 由 Pi 管理，不再由 Neo 保存 DeepSeek/OpenAI 等 provider key。先确认命令行中的 `pi` 能完成对话，再通过 `PI_EXECUTABLE` 指定 Neo 要启动的 Pi。可用 `NEO_PI_PROVIDER`、`NEO_PI_MODELS` 限制 Web 端模型选择。

ATX 是可选 provider 插件。只有需要 ATX 的路由、缓存或协议转换时才设置 `NEO_PI_ATX_ENABLED=1`；未启用时 Pi 直接使用自己的 provider。

## 外部系统怎么触发自动化？

- Webhook 调用 ATM 的 `POST /v1/webhooks/:scheduleId`。
- Cron 与手动 run 也由 ATM scheduler 执行。
- Neo 只在 `Settings / Automations` 通过 `/api/atm/*` 管理 schedules/runs，不提供自己的执行器。
- ATM 离线不影响普通 Neo → Pi 对话。

## ATM 离线怎么办？

确认 `atm serve` 正在运行，并让 Neo 的 `ATM_HTTP_URL` 指向同一个 loopback 地址。Automations 页会显示连接错误；Chat、Notebook 和 session 创建仍应正常。

## 如何清理历史会话和运行记录？

Web UI 侧边栏可删除 Neo 会话。自动化记录归 ATM，使用 `atm schedule runs` 查询；删除前备份 ATM 配置的数据目录。Neo 不再维护 `{stateDir}/runs`。

## Pi skill 或 extension 修改后为什么没生效？

新会话会重新按 Neo 的 Pi 启动配置加载 skill/extension；已有 Pi 进程需要结束会话或重启 Neo。仓库内内容 skills 默认位于 `pi/skills/`。

## MCP 工具在哪里配置？

MCP 属于 Pi 或可选 ATX，不由 Neo Settings 管理。按对应组件的配置方式启用；ATM 的 knowledge/memory/artifact MCP 也是可选增强。

## 端口冲突怎么办？

Neo 后端默认 `3000`，Vite 开发服务器默认 `5173`。后端可设置 `WEB_PORT=3001 npm run dev:bot`。ATM 地址独立由 `ATM_HTTP_URL` 配置。
