# 统一知识索引层设计草案

> 目标：为 Chat、Notebook、Memory 三条能力线提供同一套检索、引用和索引基础设施。
>
> 最后更新：2026-04-27

> 实施状态快照（2026-04-27）
>
> - [x] SQLite + FTS5 统一知识索引已落地，覆盖 notebook source、notebook note、episodic memory、semantic memory
> - [x] 已提供重建入口，可从事实源完全回填索引库
> - [x] Notebook chat 已切到统一索引检索，并返回 `chunkId + charStart + charEnd`
> - [x] SourceDetailView 已支持按引用偏移滚动定位
> - [ ] embedding、lexical + vector 融合排序、跨 notebook / memory / summary 全局搜索仍未完成

---

## 一、为什么现在做

当前仓库已经有三套“知识读取”路径，但它们各自为政：

- [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts) + [src/tools/internal/notebook-search.ts](../../../packages/agent/src/tools/internal/notebook-search.ts) 在 Notebook 模式下承接对话入口、来源检索与引用落地
- [src/memory/retriever.ts](../../../packages/agent/src/memory/retriever.ts) 对 memory item 做内存 BM25-lite 检索
- [src/services/chat-service.ts](../../../packages/agent/src/services/chat-service.ts) 负责会话消息持久化，但没有统一索引入口
- [src/services/notebook-service.ts](../../../packages/agent/src/services/notebook-service.ts) 负责来源、笔记、artifact、chat history 的文件层存储

这导致几个直接问题：

1. Notebook 搜索、Memory recall、会话摘要不能共享同一套 chunk 与排序逻辑。
2. 引用只能做到“来源级”，还很难稳定回跳到精确片段。
3. 跨 notebook 搜索、全局研究、统一来源可信度评估都缺少底层索引。
4. 后续如果继续加 Agent 自动研究，会把多套检索逻辑进一步复制一遍。

---

## 二、设计原则

1. 文件系统仍然是事实源，不直接替换现有 `.md / .json / .jsonl` 存储。
2. 索引层是派生层，可以重建，允许异步回填。
3. 先把词法检索和引用偏移做扎实，再逐步接入 embedding 和实体链接。
4. 不把第一阶段绑定到重型向量数据库；先用 SQLite + FTS5 起步，向量检索做可插拔扩展。

---

## 三、目标能力

统一索引层应至少支撑以下场景：

1. Notebook chat：从选中来源或整个 notebook 中检索最相关 chunk，并返回精确偏移
2. Memory recall：对 episodic / semantic / working 结果使用统一的检索与排序接口
3. 全局搜索：跨 notebook、memory、会话摘要进行统一检索
4. 引用跳转：返回 `documentId + chunkId + charStart + charEnd`
5. 后续的自动摘要、来源质量评分、研究报告生成，都复用同一套 chunk 基础设施

---

## 四、建议架构

### 4.1 分层

```text
文件事实源
  -> 索引任务队列
  -> 文档规范化
  -> chunk 切分
  -> 词法索引 / 可选向量索引 / 实体提取
  -> 统一检索 API
  -> Notebook / Memory / Chat / Agent 消费
```

### 4.2 物理落盘

建议目录：

```text
{stateDir}/index/
  neo.db
  ingest-jobs.jsonl
  snapshots/
```

说明：

- `neo.db`：SQLite 主索引库
- `ingest-jobs.jsonl`：索引任务队列与失败重试记录
- `snapshots/`：可选的调试快照或回放样本

---

## 五、数据模型

### 5.1 documents

一个“可被检索的源对象”就是一个 document。类型建议包含：

- `notebook_source`
- `notebook_note`
- `memory_semantic`
- `memory_episodic`
- `chat_summary`
- `artifact_text`

建议字段：

| 字段 | 含义 |
|------|------|
| `document_id` | 全局唯一 ID |
| `user_id` | 用户隔离 |
| `kind` | document 类型 |
| `scope` | `chat` / `notebook` / `memory` |
| `notebook` | notebook 名，可空 |
| `session_id` | 会话 ID，可空 |
| `source_path` | 源文件路径或逻辑来源 |
| `title` | 展示标题 |
| `source_url` | 原始来源链接，可空 |
| `checksum` | 内容哈希，用于增量重建 |
| `created_at` / `updated_at` | 时间戳 |
| `deleted_at` | 软删除标记 |

### 5.2 chunks

所有 document 统一切为 chunk，作为最小检索单元。

建议字段：

| 字段 | 含义 |
|------|------|
| `chunk_id` | 全局唯一 ID |
| `document_id` | 归属 document |
| `ordinal` | chunk 顺序 |
| `text` | chunk 文本 |
| `char_start` / `char_end` | 在原文中的字符偏移 |
| `token_estimate` | 估算 token 数 |
| `heading_path` | 可选标题层级 |
| `checksum` | chunk 内容哈希 |

### 5.3 chunk_fts

使用 SQLite FTS5 建立全文索引，索引来源：

- chunk text
- title
- heading path
- tags

### 5.4 embeddings

向量索引建议做成可插拔层，而不是第一阶段强依赖：

| 字段 | 含义 |
|------|------|
| `chunk_id` | 对应 chunk |
| `model` | embedding 模型 |
| `dims` | 维度 |
| `vector_blob` | 向量数据 |
| `updated_at` | 更新时间 |

实现建议：

1. 第一阶段允许不落 embeddings，先跑通 lexical 检索
2. 第二阶段优先接入 `sqlite-vec`；若部署环境不稳定，退化为 JS 内存 cosine scan

### 5.5 entities 与 links（可后置）

当需要做跨来源整合时，再补：

- `entities`
- `document_entities`
- `document_links`

这个阶段不强做，否则会把实现复杂度提前拉高。

---

## 六、索引管线

### 6.1 写入触发点

建议由现有服务在写入事实源后发出索引任务：

- [src/services/notebook-service.ts](../../../packages/agent/src/services/notebook-service.ts)
  - `nbImportSource`
  - `nbUpdate`
  - `nbArchiveSource`
  - `nbSaveNote`
  - `nbSaveArtifact`
- [src/memory/manager.ts](../../../packages/agent/src/memory/manager.ts)
  - `rememberTurn`
  - `rememberFact`
- [src/services/chat-service.ts](../../../packages/agent/src/services/chat-service.ts)
  - 不建议直接为每条消息建 document
  - 建议由后台摘要任务生成 `chat_summary` 再入索引

### 6.2 处理步骤

每次索引任务统一走：

1. 读取事实源
2. 规范化 document metadata
3. 计算 checksum，判断是否需要重建
4. chunk 切分
5. 写入 `documents` / `chunks` / `chunk_fts`
6. 异步补 embeddings（若开启）

### 6.3 chunk 策略

推荐初始规则：

- 默认目标长度：800 到 1200 字符
- 保留 80 到 120 字符 overlap
- Markdown 标题优先作为切分边界
- 对 Notebook 来源保留 `heading_path`
- 对 memory item 不强行切太碎，优先保持语义完整

---

## 七、统一检索 API

建议在服务层增加统一接口，例如：

```ts
searchKnowledge({
  userId,
  query,
  scopes,
  notebook,
  sessionId,
  sourceIds,
  topK,
  budgetTokens,
  useEmbeddings,
})
```

返回结构至少包含：

```ts
{
  documentId,
  chunkId,
  kind,
  title,
  notebook,
  sourcePath,
  charStart,
  charEnd,
  text,
  score,
  signals,
}
```

### 排序信号建议

第一阶段：

1. FTS/BM25 分数
2. recency boost
3. scope boost
4. notebook/source 过滤 boost

第二阶段：

1. embedding 相似度
2. entity overlap
3. diversity / 去重

---

## 八、与现有模块的对接方式

### 8.1 Notebook chat

[src/routes/chat.ts](../../../packages/app/src/routes/chat.ts) 当前统一承接 Notebook 对话入口，[src/tools/internal/notebook-search.ts](../../../packages/agent/src/tools/internal/notebook-search.ts) 负责在 Notebook 模式下从索引检索来源段落并注册引用。

建议改为：

1. 从统一索引层按 notebook/sourceIds 查询 chunk
2. 直接返回 `char_start / char_end`
3. LLM 回复后的 citation 绑定到 chunk 级别，而不是只到 source 级别

这样 [web/src/components/notebook/NotebookWorkspace.tsx](../../../web/src/components/notebook/NotebookWorkspace.tsx) 后续就能更稳定地滚动到命中位置。

### 8.2 Memory recall

[src/memory/retriever.ts](../../../packages/agent/src/memory/retriever.ts) 当前是纯内存 build-on-read 的 BM25-lite。

建议过渡方式：

1. 保留现有 retriever 作为 fallback
2. 新增 `KnowledgeBackedRetriever`，逐步切换 `semantic + episodic` 的 recall 源
3. `working memory` 继续走内存，不必强行入库

### 8.3 Chat 会话

不建议把每条 chat message 都直接切 chunk 入索引，否则噪音太大。

更合理的做法：

1. 对长会话定期生成 `chat_summary`
2. 只把摘要、决策、用户偏好、关键产物索引化
3. 原始消息仍保留在 [src/services/chat-service.ts](../../../packages/agent/src/services/chat-service.ts) 的 JSONL 中

---

## 九、实施阶段

## Phase 0：统一接口，不改功能

状态：已完成，且实现已超出“只抽接口”的最小范围。

任务：

1. [x] 定义 `KnowledgeDocument` / `KnowledgeChunk` / `KnowledgeHit` 类型
2. [x] 抽象统一索引入口与查询类型
3. [x] 让 Notebook chat 和 memory recall 通过统一检索入口复用索引结果

目标：先消除“每个模块都自己写一套检索逻辑”的趋势。

## Phase 1：SQLite 词法索引落地

状态：已完成。

任务：

1. [x] 引入 SQLite 存储层
2. [x] 为 notebook source / notebook note / semantic memory 建立 document + chunk + FTS 表
3. [x] 增加重建入口，可做全量 backfill

目标：先跑通稳定、可重建、可解释的词法检索。

## Phase 2：Notebook 引用精确化

状态：已完成。

任务：

1. [x] Notebook chat 改为从统一索引层取 chunk
2. [x] citation 附带 `chunkId + charStart + charEnd`
3. [x] SourceDetailView 支持按偏移滚动定位

目标：先把 Notebook 的“来源可回跳”做扎实。

## Phase 3：Embedding 与跨范围检索

任务：

1. 接入 embedding 生成与异步回填
2. 实现 lexical + vector 融合排序
3. 开放跨 notebook / memory / summary 的全局搜索

目标：把统一索引层真正扩展为研究基础设施。

## Phase 4：摘要、实体与自动研究

任务：

1. 会话摘要自动入索引
2. 关键实体抽取和来源链接
3. 研究 Agent 直接消费统一检索 API

目标：支撑更高阶的自动研究和知识整合。

---

## 十、风险与取舍

### 风险 1：过早绑定向量数据库

如果第一阶段就把检索效果完全押在向量库上，部署复杂度会迅速上升。

建议：先做 SQLite FTS5，把“可解释、可调试、可重建”的底座打好。

### 风险 2：把原始 chat message 全量索引化

这会显著增加噪音，且对 recall 价值不高。

建议：只索引摘要、长期事实和高价值产物。

### 风险 3：写入点过多导致索引不一致

如果多个服务分别自己写索引，很快会失控。

建议：所有写入统一发 `ingest job`，由单一 indexer 消费。

---

## 十一、验收标准

统一知识索引层的第一阶段完成后，至少应满足：

1. [x] Notebook source 与 semantic memory 已能被同一接口检索
2. [x] Notebook chat 可以返回带偏移的引用命中
3. [x] 索引库删除后可由事实源完全重建
4. [ ] 对同一 query，检索结果具备稳定排序和可解释信号输出

满足这四点，后续再叠加 embeddings、实体链接和自动研究，成本才可控。
