# Neo

Neo 是一款面向内容生产的 Web 客户端：提供 Chat、Notebook、来源管理、笔记与 artifact 页面，并直接驱动 pi RPC。

## 架构边界

```text
Neo Web → Neo thin bridge → pi RPC → provider
                              └── optional ATX provider plugin
                     pi → optional ATM MCP (knowledge / memory / artifact)
```

- pi 是唯一 agent runtime，负责模型会话、工具循环、skill 与 session JSONL。
- ATM 是可选旁路，负责知识、共享记忆、artifact 与 scheduler；Neo 的 Automations 页只管理 ATM schedules/runs，普通聊天不依赖 ATM。
- ATX 是显式启用的可选 provider 插件。未启用时 pi 直连自己的 provider。
- Neo 不含 LLM/tool loop、durable runtime、memory/indexing、Cron/Workflow 执行器或 Local AI Gateway。
- Notebook 与用户资产以 Markdown/JSONL 为事实源；Neo 不依赖 `better-sqlite3`。

架构决策和逐阶段验证见 [mox PLAN](../PLAN.md) 与 [Notebook Pi RPC spike](docs/spikes/notebook-pi-rpc.md)。

## 功能

| 模块 | 说明 |
|---|---|
| Chat | Pi RPC 流式文本、thinking、工具活动、引用和取消 |
| Notebook | Markdown 来源、笔记、批注、来源预览和选择 |
| Studio | 报告、导图、概览、音频脚本等任务通过 pi 执行 |
| Content skills | `notebook-report`、`article-draft`、`news-brief` |
| Artifacts | Pi 调用 ATM `artifact_save` 保存带 provenance 的 Markdown |
| Mini apps | 用户静态应用上传与托管 |

## 快速开始

前置条件：Node.js 18+、npm 10+、可用的 `pi` 命令。若内容任务需要知识检索，再提供 `atm` 命令。

```bash
npm install
npm run web:install

# 后端 :3000
npm run dev:bot

# 另一个终端，前端 :5173
npm run web:dev
```

首次启动会生成 `~/.neo/config.json`，包含随机 Web 登录 token、`SESSION_SECRET` 以及默认 workspace/state 目录；token 会打印在终端。

也可以使用仓库内的本地配置模板：

```bash
cp packages/agent/src/config.local.example.ts packages/agent/src/config.local.ts
```

```ts
import type { LocalConfig } from './config.js';

const config: LocalConfig = {
  USERS: [{
    id: 'alice',
    name: 'Alice',
    webToken: 'long-random-string',
    workDir: '/abs/path/to/workspace',
    stateDir: '/abs/path/to/state',
  }],
  SESSION_SECRET: 'change-me-to-a-long-random-string',
};

export default config;
```

## Pi 与 ATM 配置

```bash
PI_EXECUTABLE=~/.local/bin/pi
ATM_EXECUTABLE=~/.local/bin/atm

# 可选：显式加载额外 provider extension
NEO_PI_PROVIDER_EXTENSION=~/.pi/agent/extensions/custom.ts

# 可选：限制 Web 模型选择器中出现的 provider/model
NEO_PI_MODELS=idealab/claude-opus-4-8,openai/gpt-5
NEO_PI_PROVIDER=idealab

# 可选：覆盖仓库自带的内容 skills
NEO_PI_SKILLS_DIR=/path/to/neo/pi/skills
```

Neo 为每个 Web session 管理一个独立 pi 子进程和持久 session 映射。用户取消当前生成时，薄适配层向对应 Pi RPC 会话发送 abort。

ATM MCP 扩展只在配置后加载；ATM 不在线只影响知识、记忆、artifact 与自动化，不改变 Pi 的普通模型调用路径。

## 可选 ATX 插件

ATX 默认关闭：

```bash
NEO_PI_ATX_ENABLED=1
NEO_PI_ATX_URL=http://127.0.0.1:8080
NEO_PI_ATX_MODEL=deepseek-chat       # 也可以填写 ATX model alias
NEO_PI_ATX_REASONING=0               # 非 reasoning 模型设为 0
NEO_PI_ATX_GATEWAY_KEY=...
```

开启后，Neo 仅向 pi 注入 ATX provider extension；provider 凭据、路由、协议转换、cache 与 usage 由 ATX 管理。Neo 自身不再暴露 `/v1/*` 模型网关。

## 项目结构

```text
packages/
  app/       Koa API、Pi bridge、Notebook 内容任务适配
  agent/     历史包名；仅剩文件型 user/session/Notebook 数据适配
  web/       React Web UI
pi/
  skills/    内容生产 skills
```

`packages/agent` 不再包含 agent runtime；保留包名是为了避免一次性搬动所有文件型 API。执行逻辑只在 pi。

## 验证

```bash
npm run typecheck
npm test
npm run docs:check
npm run build
```

当前测试覆盖 Pi RPC framing、进程/session 恢复、SSE 事件映射、citation、Notebook 数据和核心路由。生产构建会先清理 app `dist`，避免自动路由加载已删除的旧文件。

## 文档

- [Notebook 用户指南](docs/user-guide/NOTEBOOK.md)
- [Pi RPC 迁移与真实 E2E](docs/spikes/notebook-pi-rpc.md)
- [产品路线图](docs/product/ROADMAP.md)
- [文档索引](docs/README.md)
