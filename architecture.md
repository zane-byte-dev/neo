# Neo 项目演进：4层架构解耦方案

目前 NeoAgent 的网关架构（Sentinel）向最终可扩展形态（Agentic Architecture）的演进设计，核心在于完全隔离机制、计算与能力。

### 1. 架构全景图：4层模型

```text
[ 1. 表现层 - UI Clients ]
   ├─ telegram-bot (手机随时随地)
   ├─ web-ui       (沉浸式桌面端，待开发)
   └─ Obsidian/VSCode Plugin
        │
   (HTTP / WebSocket) 
        ▼
[ 2. 协议与会话层 - Gateway & ACP Client ]  <-- Sentinel 所在层
   负责：接收事件、鉴权、队列排队(P-Queue)、维持短期会话历史并切割防封锁输出。
        │
   (JSON-RPC over Stdio)
        ▼
[ 3. 推理引擎层 - 独立大模型 CLI (ACP Server) ]
   形态：解耦剥离出来的独立进程（gemini-cli）。
   负责：专注执行 ReAct 深度推理，调用下游工具。只管**动脑计算**。极简可插拔，可横移到 claude-cli 或 ollama 等本地引擎。
        │
   (Model Context Protocol) 
        ▼
[ 4. 原子化能力底座 - MCP Servers ]
   ├─ 读写文件/归档日记的 FS-MCP
   ├─ 离线短作业脚本 (Butler, Curator 等 Refinery)
   └─ 等待后续组装的外部 API 动作
```

### 2. 长效收益设计

1. **任意替换多端点 (UI自由)**
表现层 (Telegram、Web 等) 仅负责字符 IO 以及外壳渲染。日后开发 Web-UI 只需对等接入 `gemini-cli -> mcp` 驱动链路，全局的 Persona 和项目上下文可实现跨端无极漫游，真正形成一份“数字孪生”。

2. **进程级防火墙隔离**
外部 Sentinel 通过管道异步队列隔离并发请求。当底层的推理引擎偶尔发生假死或 MCP 插件抛出死锁时，外壳网关依然保持活跃响应，能直接截住崩溃栈，抛出错误并低压重启底层服务，主干永不宕机。

3. **引擎即插件 (反大厂绑定)**
本地运行的 `acp-client.ts` 是完全协议抽象的防火墙。日后如果需要在全离线无网环境下工作，或遇到成本高昂的情况下，只需要更改配置 `GEMINI_CLI_PATH=ollama-cli`（挂载本地 Llama3），所有先前构建好的原子动作和知识库立刻平权调用。

4. **路由级多脑协同分发**
因为推理核心已被打通成微服务，网关层拥有了更高阶的策略路由空间：简单琐碎的日常归档丢给本地极轻模型快速解决；涉及重度代码编程发往最强商业模型。在统一 MCP 资产的基础上，实现算力性价比最大化。
