# 竞品调研与架构参考

> 面向 Neo 的竞品分析、可参考的开源项目与库、以及对应的产品和架构改进建议。
>
> 最后更新：2026-04-20

---

## 一、竞品全景图

### 1.1 直接竞品（个人 AI 助手 + 知识管理）

| 产品/项目 | Stars | 核心定位 | 与 Neo 的对比 | 可借鉴亮点 |
|-----------|-------|---------|-------------|-----------|
| **[Khoj](https://github.com/khoj-ai/khoj)** | 34.2k | "AI 第二大脑"——自托管个人 AI 助手 + 语义搜索 | 功能重叠度最高：多 LLM、文档 RAG、Agent、Web/WhatsApp 多平台、自托管 | **自动化研究（automated research）**：定时任务自动生成 newsletter；**Obsidian/Emacs 集成**；**语义搜索评测体系** |
| **[LobeHub](https://github.com/lobehub/lobehub)** | 75.4k | Agent 协作工作台——多 Agent 协同、Schedule、Pages | 更偏团队/企业级，Neo 偏个人使用 | **Agent Group**：多 Agent 并行协作；**Pages**（多 Agent 共享写作空间）；**White-Box Memory**：透明可编辑的记忆系统；**10,000+ 技能市场**；**Schedule** 定时 Agent |
| **[Leon](https://github.com/leon-ai/leon)** | 17.2k | 开源个人 AI 助手——工具 + 上下文 + 记忆 + Agent 执行 | 最接近 Neo 的架构理念，但用 Node+Python 双语 | **三层记忆**：durable / day-to-day / recent；**self-model（自我模型）**：Agent 维护对自身的认知；**Skills → Actions → Tools → Functions → Binaries** 层级；**Workflow + Agent 混合模式** |
| **[Google NotebookLM](https://notebooklm.google.com/)** | 闭源 | 源驱动知识工作台——对话 + 音频 + 知识图谱 | Neo Notebook 模块的直接对标 | **Audio Overview**（Deep Dive 播客）；**Interactive Mode** 打断问答；引用溯源；Study Guide |

### 1.2 Agent 框架（技术参考级）

| 项目 | Stars | 核心能力 | 对 Neo 的启发 |
|------|-------|---------|-------------|
| **[Vercel AI SDK](https://github.com/vercel/ai)** | 23.6k | TypeScript AI 工具包，统一 Provider 接口；`ToolLoopAgent` + `WorkflowAgent` | Neo 已用 AI SDK，应升级到 `ToolLoopAgent` 模式；关注新特性 `@ai-sdk/workflow`（图流程）和 **Generative UI**（UI 工具调用） |
| **[Mastra](https://github.com/mastra-ai/mastra)** | 23.2k | TypeScript Agent 框架——Workflow 引擎 + MCP + Working Memory + Evals | **Working Memory + Semantic Recall** 二元记忆模型；**`.then()/.branch()/.parallel()`** 语法的 Workflow 引擎；**Human-in-the-loop suspend/resume**；**内置 Evals** |
| **[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)** | 12.2k | Model Context Protocol 官方 SDK——Server + Client + Middleware | Neo 接入 MCP 的首选库。v2 即将发布（Streamable HTTP + Standard Schema） |

### 1.3 记忆层

| 项目 | Stars | 核心思路 | 对 Neo 的启发 |
|------|-------|---------|-------------|
| **[Mem0](https://github.com/mem0ai/mem0)** | 53.6k | "AI 记忆层"——User/Session/Agent 三级记忆 | **三级记忆架构**（User/Session/Agent 状态分离）；**v3 新算法**：单 pass ADD-only 提取 + Entity Linking + 多信号检索（Semantic + BM25 + Entity 融合）；提供 Node SDK `mem0ai` |
| **[LangMem](https://github.com/langchain-ai/langmem)** | — | LangChain 的长期记忆方案 | Memory Manager 自动提取/整合/去重记忆；结合 LangGraph 的 checkpointing |

### 1.4 LLM 基础设施

| 项目 | Stars | 核心能力 | 对 Neo 的启发 |
|------|-------|---------|-------------|
| **[LiteLLM](https://github.com/BerriAI/litellm)** | 43.9k | 统一 100+ LLM Provider 接口 + cost tracking | `model_prices_and_context_window.json` 单价库；fallback 链设计；**详细 cost tracking** |
| **[Portkey AI Gateway](https://github.com/Portkey-AI/gateway)** | 11.4k | <1ms AI 网关——retry/fallback/load balancing/guardrails | **Config-driven 路由**；**Semantic Cache**；**Guardrails**（输入/输出安全过滤） |
| **[RouteLLM](https://github.com/lm-sys/RouteLLM)** | 4.8k | 基于偏好数据的模型路由器 | **阈值校准**思路——用历史数据动态校准路由决策 |

### 1.5 其他值得关注的项目

| 项目 | Stars | 关注点 |
|------|-------|-------|
| **[gptme](https://github.com/gptme/gptme)** | — | 终端 AI Agent：写代码 + 执行命令 + 浏览网页，全本地 |
| **[Moltis](https://github.com/moltis-org/moltis)** | — | Rust 实现的个人 Agent Server：单二进制、沙箱执行、MCP、Telegram/WhatsApp/Discord |
| **[DeepChat](https://github.com/ThinkInAIXYZ/deepchat)** | — | Electron 桌面端 AI 助手：MCP Client、多模型、Agent Skills |
| **[Praktor](https://github.com/mtzanidakis/praktor)** | — | Go 实现的 Agent Orchestrator：Telegram I/O、Docker 隔离、NATS 消息、Mission Control UI |
| **[CopilotKit](https://github.com/CopilotKit/CopilotKit)** | — | React Agent 前端框架：AG-UI Protocol、Generative UI |

---

## 二、关键洞察与趋势

### 2.1 架构趋势

1. **Agent 成为一等公民**：LobeHub 将 Agent 作为"工作单元"，Mastra/AI SDK 都围绕 Agent 设计 API——Neo 应把 `agent-runner` 提升为核心抽象
2. **三层记忆成为标配**：Mem0（User/Session/Agent）、Leon（durable/day-to-day/recent）、Mastra（working memory + semantic recall）——Neo 目前只有文件记忆，急需升级
3. **MCP 协议统一工具生态**：Mastra、LobeHub、AI SDK 全部原生支持 MCP——Neo 接入 MCP 可一次性获得几千个工具
4. **Workflow 引擎 ≠ 纯 Agent**：Mastra 和 Leon 都同时提供 Workflow（确定性）和 Agent（自主决策）两种模式——Neo 目前只有 Agent 模式，缺乏对确定性流程的支持
5. **Evaluations 内置化**：Mastra 内置 evals 模块——量化 Agent 效果是从玩具到产品的关键步骤

### 2.2 产品趋势

1. **"第二大脑"定位清晰化**：Khoj 强调"AI second brain"，Neo Notebook 也在做同样的事，应强化这一叙事
2. **多 Agent 协作**：LobeHub 的 Agent Group、Mastra 的多 Agent 协同——个人使用场景虽然不需要"团队"，但"多个专精 Agent 协作完成复杂任务"很有价值
3. **定时自动化**：Khoj 的 automated research + newsletter、LobeHub 的 Schedule——Neo 的 cron-agent 应更易配置
4. **透明可控**：LobeHub 的 White-Box Memory、Leon 的 self-model——用户需要能审视和修改 AI 的记忆/行为

---

## 三、产品设计改进建议

### 3.1 核心体验：从"聊天机器人"到"个人 AI 运行时"

**现状**：Neo 本质上是一个能调用工具的聊天机器人 + 知识管理工具。
**目标**：成为一个持久运行的"个人 AI 运行时"——它不仅在你提问时工作，还会主动为你做事。

**具体建议**：

| # | 改进项 | 参考来源 | 优先级 | 描述 |
|---|--------|---------|-------|------|
| 1 | **Agent 人格系统** | Leon 的 self-model + SOUL.md | P0 | 把 `SOUL.md` 变成结构化的 Agent Identity（偏好、能力边界、沟通风格），运行时自省 |
| 2 | **主动触发 Agent** | Khoj 的 automated research | P1 | 扩展 cron-agent：定时摘要未读消息、监控网站变化、推送个性化 newsletter |
| 3 | **多 Agent 调度** | LobeHub Agent Group | P2 | 复杂任务自动拆解为子 Agent 并行执行（如"调研 + 写报告 + 生成数据图表"） |

### 3.2 记忆系统升级

**现状**：纯文本文件记忆（`memory/` 目录），无语义检索。
**参考**：Mem0 的三级记忆 + Entity Linking、Mastra 的 Working Memory + Semantic Recall。

**建议架构**：

```
┌─────────────────────────────────────────────────┐
│                 Memory System                    │
├─────────────┬───────────────┬───────────────────┤
│ Working     │ Episodic      │ Semantic          │
│ Memory      │ Memory        │ Memory            │
│ (会话上下文)  │ (对话摘要)     │ (长期事实/偏好)     │
├─────────────┼───────────────┼───────────────────┤
│ 当前会话状态  │ 每轮对话后     │ 定期从 Episodic   │
│ + 工作笔记   │ AI 自动提取    │ 提炼 + 去重 + 整合 │
│             │ 关键事实       │                   │
├─────────────┼───────────────┼───────────────────┤
│ 存储：内存    │ 存储：JSONL    │ 存储：向量 DB     │
│ 生命周期：    │ 生命周期：     │ (SQLite + vec)   │
│ 会话内       │ 按衰减清理     │ 生命周期：永久     │
└─────────────┴───────────────┴───────────────────┘
```

**关键**：
- 采用 Mem0 的 **ADD-only** 策略：只追加不修改，避免错误覆盖
- **Entity Linking**：提取人名、项目名、技术名等实体，跨记忆条目建立关联
- **多信号检索**：语义相似度 + BM25 关键词 + Entity 匹配并行打分融合（参考 Mem0 v3）

**推荐库**：
- 向量存储：[`sqlite-vec`](https://github.com/asg017/sqlite-vec)（纯 SQLite 扩展，零依赖）或 [`vectra`](https://github.com/Stevenic/vectra)（本地向量 DB for Node.js）
- Embedding：Gemini Embedding API 或本地 `text-embedding-3-small`

### 3.3 MCP 接入

**现状**：自定义工具加载系统（`internal/` + `user-tools/`）。
**建议**：并行实现 MCP Client，让现有工具与 MCP 工具并存。

```
用户消息 → Tool Router
              ├── 内置工具 (internal/)
              ├── 用户自定义工具 (user-tools/)
              └── MCP 工具 (mcp-clients/)
                  ├── GitHub MCP Server
                  ├── Database MCP Server
                  └── ...（用户自配）
```

**实现路径**：
1. 安装 `@modelcontextprotocol/client`
2. 在 `space/{userId}/` 下新增 `mcp-config.json` 配置 MCP Server
3. `ToolExecutor` 扩展 MCP 工具发现 + 调用
4. AI SDK 的 `experimental_toToolResultContent` 可直接桥接 MCP tool schema

### 3.4 Workflow 引擎

**现状**：只有 Agent 模式（LLM 自由决策走哪步）。
**参考**：Mastra 的 `.then()/.branch()/.parallel()` 语法、Leon 的 Workflow + Agent 混合模式。

**建议**：在现有 Skill 系统基础上扩展为轻量 Workflow：

```yaml
# space/{userId}/workflows/weekly-digest.yaml
name: 每周摘要
trigger:
  cron: "0 9 * * 1"  # 每周一 9:00
steps:
  - id: collect
    tool: notebook_search
    params: { query: "本周新增", limit: 20 }
  - id: summarize
    skill: 文章摘要
    input: ${{ steps.collect.output }}
  - id: notify
    tool: send_telegram
    params: { text: ${{ steps.summarize.output }} }
```

**关键设计**：
- **YAML 定义**：用户友好，可版本控制
- **Step 引用**：`${{ steps.xxx.output }}` 语法引用前置步骤输出
- **触发方式**：cron / webhook / 手动 / 事件（文件变更、新 Notebook 源）
- **Human-in-the-loop**：参考 Mastra 的 suspend/resume——某步骤可标记为 `confirm: true` 暂停等待用户确认

### 3.5 Notebook 增强（对标 NotebookLM+）

已有 NOTEBOOK_ROADMAP.md 详细规划，以下补充竞品视角：

| 能力 | NotebookLM | Khoj | Neo 现状 | 建议 |
|------|-----------|------|---------|------|
| 语义搜索 | ✅ | ✅ (pgvector) | ❌ 仅关键词 | 接入 Embedding + 向量检索（复用记忆系统的向量 DB） |
| 自动研究 | ❌ | ✅ (automated) | ❌ | Research Agent 自动搜索 + 导入 + 摘要 |
| 跨 Notebook 搜索 | ❌ | ✅ | ❌ | 统一索引层 |
| 分享链接 | ❌ | ✅ | ❌ | 签名 URL 只读分享 |
| Obsidian 集成 | ❌ | ✅ (插件) | ❌ | P2：通过 Chrome 扩展或本地 watch 同步 |

---

## 四、架构设计改进

### 4.1 建议整体架构

```
                          ┌──────────────────────┐
                          │    Trigger Layer      │
                          │  cron / webhook /     │
                          │  telegram / web UI    │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │    Router Layer       │
                          │  Smart Scoring +      │
                          │  Model Router         │
                          │  (config-driven)      │
                          └──────────┬───────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │                         │                         │
┌──────────▼──────────┐  ┌──────────▼──────────┐  ┌──────────▼──────────┐
│   Agent Runtime     │  │  Workflow Engine     │  │  Notebook Engine    │
│  tool-loop /        │  │  YAML-based steps    │  │  source-guide /     │
│  sub-agent spawn    │  │  branch / parallel   │  │  chat / studio      │
│                     │  │  suspend / resume    │  │                     │
└──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
           │                         │                         │
           └─────────────────────────┼─────────────────────────┘
                                     │
                          ┌──────────▼───────────┐
                          │    Tool Layer         │
                          │  internal + user +    │
                          │  MCP Client           │
                          └──────────┬───────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │                         │                         │
┌──────────▼──────────┐  ┌──────────▼──────────┐  ┌──────────▼──────────┐
│   Memory System     │  │   Storage Layer      │  │   Observability     │
│  working / episodic │  │  filesystem + SQLite  │  │  token / cost /     │
│  / semantic (vec)   │  │  + vector index       │  │  latency tracking   │
└─────────────────────┘  └──────────────────────┘  └─────────────────────┘
```

### 4.2 建议模块拆分

当前 `src/services/` 过于扁平，建议按领域分组：

```
src/
├── core/                     # 核心抽象
│   ├── agent-runtime.ts      # Agent 运行时（从 agent-runner 升级）
│   ├── workflow-engine.ts    # Workflow 引擎（新增）
│   └── context-manager.ts   # 上下文管理（system prompt 构建）
├── memory/                   # 记忆系统（新增）
│   ├── working-memory.ts    # 会话内状态
│   ├── episodic-memory.ts   # 对话摘要 + 事实提取
│   ├── semantic-memory.ts   # 向量检索 + Entity Linking
│   └── memory-manager.ts    # 统一入口
├── tools/                    # 工具层（现有 + MCP）
│   ├── internal/
│   ├── user-tools/
│   └── mcp-client.ts        # MCP 客户端（新增）
├── notebook/                 # Notebook 引擎（从 services/ 提出）
│   ├── notebook-service.ts
│   ├── notebook-ai.ts
│   ├── notebook-chat.ts
│   └── search-index.ts      # 语义搜索索引（新增）
├── llm/                      # LLM 层（现有）
├── platforms/                # 平台接入（现有）
├── routes/                   # HTTP 路由（现有）
└── services/                 # 通用业务逻辑
```

### 4.3 技术栈补充建议

| 需求 | 推荐方案 | 理由 |
|------|---------|------|
| 向量存储 | `sqlite-vec` 或 `better-sqlite3` + HNSW | 零额外依赖，适合个人项目规模 |
| MCP 客户端 | `@modelcontextprotocol/client` | 官方 SDK，v2 即将发布 |
| Embedding | `@google/genai` embedding API | 已有依赖，无额外成本 |
| Workflow 编排 | 自建（基于 YAML 解析 + Step 执行器） | 轻量、可控，Mastra 的 full stdlib 对个人项目太重 |
| 沙箱执行 | Docker API（`dockerode`）| 成熟可靠，资源控制完善 |
| 实时通信 | 统一 SSE 层（复用现有 Koa + EventSource） | notebook-chat、agent-runner、workflow 都需要 |
| BM25 关键词搜索 | `orama` (formerly lyra) | 纯 JS 全文搜索引擎，支持 BM25 |

---

## 五、实施优先级建议

### Phase 1：核心记忆 + MCP（1-2 周）

1. **Mem0 式三级记忆**：先实现 Working Memory + Episodic Memory（对话后自动提取事实）
2. **MCP Client 基础版**：接入 1-2 个 MCP Server（GitHub、文件系统），验证通路
3. **语义搜索基础**：Notebook 接入 Embedding + 向量检索

### Phase 2：Workflow + 可观测性（1-2 周）

4. **轻量 Workflow 引擎**：YAML 定义 + cron/手动触发 + step 串联执行
5. **Token/Cost 追踪**：每次 LLM 调用记录用量，Web UI 展示
6. **Semantic Memory**：向量化长期记忆 + Entity Linking + 多信号检索

### Phase 3：体验打磨（1-2 周）

7. **Agent Identity 增强**：结构化 SOUL.md + 运行时自省 + 记忆驱动个性化
8. **Notebook Research Agent**：自动搜索 + 导入 + 摘要 + 交叉引用
9. **Workflow 可视化**：Web UI 展示 Workflow 定义 + 执行状态 + 历史日志

---

## 六、需要注意的差异化方向

Neo 不应试图成为 LobeHub（团队协作平台）或 Mastra（通用框架），而应聚焦以下差异化：

1. **个人优先**：单用户深度定制 > 多用户浅度覆盖
2. **Notebook 深度集成**：知识管理与 AI 对话的深度融合（NotebookLM + Agent 能力）
3. **轻量自托管**：单进程 + PM2 即跑，不需要 Docker/K8s/PostgreSQL
4. **中文原生**：双语关键词、中文 NLP 优化、国内 LLM 提供商支持
5. **渐进式复杂度**：开箱简单（聊天写笔记）→ 逐步解锁（Agent + Workflow + 自动化）
