# inkClaw Sentinel 架构演进

inkClaw Sentinel 已经从一个简单的 Telegram 网关演进为多平台、租户隔离的 AI Agent 调度中枢。

### 1. 架构全景图：5层模型

```text
[ 1. 表现层 - UI Adapters ]
   ├─ Telegram Adapter (Mobile/Desktop)
   └─ Feishu Adapter (Enterprise Workspace)
        │
   (Normalized Message / Event) 
        ▼
[ 2. 路由与分发层 - Message Router ]
   负责：多平台消息归一化、租户上下文 (TenantContext) 识别、命令路由、URL 提取。
        │
        ▼
[ 3. 租户生命周期层 - Tenant Lifecycle ]
   负责：每个租户独立的会话历史 (SQLite)、任务队列 (P-Queue)、定时任务与提醒管理器。
        │
        ▼
[ 4. 推理核心层 - Gemini Agentic Loop ]
   形态：基于 Gemini SDK 的 Function Calling 驱动。
   负责：ReAct 推理循环、动态工具调用、多轮对话维护。
        │
        ▼
[ 5. 原子化能力底座 - Unified Toolset ]
   ├─ Workspace Tools (File Search, Note, Today, Weekly)
   ├─ Media Tools (Puppeteer Browser, Photo, Voice)
   └─ Integration Tools (Weather, News, Search)
```

### 2. 核心设计原则

#### 1. 平台适配器化 (Platform-Agnostic)
通过 `PlatformAdapter` 接口，系统可以轻松扩展到任何即时通讯平台。核心业务逻辑（消息路由、任务处理）与具体平台 API 完全解耦。目前已实现 Telegram 和 Feishu (飞书) 的完美支持。

#### 2. 租户隔离 (Tenant Isolation)
引入 `TenantKey` (例如 `telegram:123456`)，系统为每个独立的对话空间分配专属的 SQLite 存储、Async Task Manager 和内存上下文。这确保了多用户环境下的数据安全与状态独立。

#### 3. 存储本地化 (Local-First Persistence)
所有持久化数据（对话历史、提醒、异步任务状态）均存储在本地 `data/neo.db` (SQLite) 中，摆脱了对云端数据库的依赖，同时利用 SQL 提供强大的检索与管理能力。

#### 4. 安全防护体系 (Security-in-Depth)
- **命令拦截**：在 `tool-executor` 层级实时检测并阻断危险的 Bash 指令（如 `rm -rf /`, `chmod 777` 等）。
- **注入防护**：外部文件内容通过 `[EXTERNAL_CONTENT]` 标记包裹，防止模型混淆系统指令与外部数据。
- **审计日志**：所有敏感操作（脚本执行、API 调用）均记录在异步审计日志中，可供事后追溯。

### 3. 工作流程

1. **接收**：Adapter 捕获原生平台事件，转换为 `NormalizedMessage`。
2. **路由**：`MessageRouter` 根据消息前缀（如 `调研`）或命令（如 `/tasks`）决定走异步流程还是同步流程。
3. **推理**：`GeminiClient` 启动推理循环。如果需要外部能力，则触发 `ToolExecutor` 调用相应的 Tool。
4. **执行**：Tool 执行具体的 IO 或计算操作，并将结果返回给模型。
5. **反馈**：模型总结最终回复，通过 Adapter 发送回原平台。
