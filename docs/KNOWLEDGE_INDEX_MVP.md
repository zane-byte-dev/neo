# 统一知识索引层 MVP 实施方案

> 目标：在不推翻现有文件存储的前提下，先落一个可运行、可重建、可被 Notebook 和 Memory 共同消费的知识索引最小版本。
>
> 对应设计草案见 [docs/KNOWLEDGE_INDEX_DESIGN.md](KNOWLEDGE_INDEX_DESIGN.md)。

---

## 一、MVP 范围

本阶段只做最小闭环，不追求一步到位：

1. 使用 SQLite + FTS5 落地词法索引。
2. 只索引三类高价值对象：
   - Notebook 来源文档
   - Notebook 笔记
   - Semantic Memory 条目
3. 提供一个统一检索入口，先服务于 Notebook Chat 和 Memory Recall。
4. 返回 chunk 级命中结果，带字符偏移，便于引用跳转。
5. 支持全量重建索引，不把 SQLite 当事实源。

本阶段不做：

1. 向量检索
2. 实体链接
3. 原始 chat message 全量索引
4. 自动研究 Agent

---

## 二、为什么这样收敛

当前仓库里还没有 SQLite 相关依赖，Notebook 和 Memory 也都基于文件系统与内存检索：

- [src/services/notebook-service.ts](../src/services/notebook-service.ts) 明确仍是 file-system based service
- [src/services/notebook-chat.ts](../src/services/notebook-chat.ts) 仍是按来源全文切段后做关键字排序
- [src/memory/retriever.ts](../src/memory/retriever.ts) 仍是 pure in-memory BM25-lite retriever
- [package.json](../package.json) 当前未包含 SQLite 驱动

所以 MVP 的正确路径不是直接上复杂向量库，而是先把下面三件事做稳：

1. document 和 chunk 的统一抽象
2. 可重建的 SQLite 词法索引
3. 统一查询接口与引用偏移

---

## 三、建议新增依赖

推荐首选：

- `better-sqlite3`
- `@types/better-sqlite3`

原因：

1. API 简单，适合本地单进程服务。
2. 同步调用更适合小体量、用户本地工作区索引写入。
3. SQLite FTS5 适合当前“按工作区分隔、本地部署”的使用场景。

建议命令：

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

---

## 四、物理落盘

建议目录：

```text
{stateDir}/index/
  knowledge.db
  ingest-jobs.jsonl
```

说明：

1. `knowledge.db` 是派生索引。
2. `ingest-jobs.jsonl` 用来记录异步索引任务，便于失败重试和调试。
3. 删除整个 `{stateDir}/index/` 后，必须可以完全由现有事实源重建。

---

## 五、建议新增模块

建议新增目录：

```text
src/indexing/
  schema.ts
  db.ts
  types.ts
  chunker.ts
  ingest.ts
  search.ts
  rebuild.ts
  __tests__/
```

### 5.1 文件职责

1. `db.ts`
   - 打开 SQLite 连接
   - 初始化 schema
   - 提供事务 helper

2. `types.ts`
   - `KnowledgeDocument`
   - `KnowledgeChunk`
   - `KnowledgeHit`
   - `IngestJob`

3. `chunker.ts`
   - 按 Markdown 标题与长度切 chunk
   - 输出 `charStart`、`charEnd`、`headingPath`

4. `ingest.ts`
   - `indexNotebookSource()`
   - `indexNotebookNote()`
   - `indexSemanticFact()`
   - `deleteDocumentIndex()`

5. `search.ts`
   - `searchKnowledge()`
   - 统一组装 SQL、过滤条件与排序信号

6. `rebuild.ts`
   - 从 workDir 全量重建索引
   - 遍历 notebook sources、notes、semantic memory

---

## 六、MVP 数据源映射

### 6.1 Notebook 来源

来源：

- [src/services/notebook-service.ts](../src/services/notebook-service.ts) 中的 `nbListSources`
- [src/services/notebook-service.ts](../src/services/notebook-service.ts) 中的 `nbGetSourceEntry`

映射建议：

- `kind = notebook_source`
- `source_path = notebooks/{notebook}/{sourceId}.md`
- `title = SourceMeta.title`
- `source_url = SourceMeta.source`

### 6.2 Notebook 笔记

来源：

- [src/services/notebook-service.ts](../src/services/notebook-service.ts) 中的 `nbListNotes`

映射建议：

- `kind = notebook_note`
- `source_path = {stateDir}/notebooks/{notebook}/notes/{noteId}.md`
- `title = NotebookNote.title`

### 6.3 Semantic Memory

来源：

- [src/memory/semantic-store.ts](../src/memory/semantic-store.ts) 中的 `readFacts`

映射建议：

- `kind = memory_semantic`
- `source_path = {stateDir}/memory/semantic.jsonl#{factId}`
- `title = category 或首句摘要`

---

## 七、chunk 规则

推荐最小规则：

1. 优先按 Markdown 标题分段。
2. 若某段过长，再按 900 到 1200 字符切分。
3. 相邻 chunk 保留 100 字符 overlap。
4. 保存每个 chunk 在原文中的 `char_start` 与 `char_end`。
5. 对 notebook source 额外保存 `heading_path`。

建议接口：

```ts
type ChunkInput = {
  text: string;
  maxChars?: number;
  overlapChars?: number;
};

type ChunkOutput = {
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
  headingPath?: string | null;
};
```

---

## 八、统一检索接口

建议最小签名：

```ts
searchKnowledge({
  workDir,
  query,
  kinds,
  notebook,
  sourceIds,
  limit,
})
```

返回结构建议：

```ts
type KnowledgeHit = {
  documentId: string;
  chunkId: string;
  kind: 'notebook_source' | 'notebook_note' | 'memory_semantic';
  notebook: string | null;
  sourceId: string | null;
  title: string;
  text: string;
  charStart: number;
  charEnd: number;
  headingPath?: string | null;
  score: number;
};
```

排序信号只保留三项：

1. FTS5 BM25 分数
2. 最近更新时间 boost
3. scope boost

这样足够支持 MVP，且排查结果时可解释。

---

## 九、第一批接入点

### 9.1 Notebook Chat

当前 [src/services/notebook-chat.ts](../src/services/notebook-chat.ts) 会：

1. 读取全部选中来源全文
2. 本地切段
3. 用关键字计数做排序

MVP 接法：

1. 保留现有逻辑作为 fallback。
2. 优先从 `searchKnowledge()` 查询 `kind = notebook_source` 的 chunk。
3. 把命中的 `charStart`、`charEnd` 挂到 citation 元数据里。

建议新增字段：

```ts
type ParsedCitation = {
  n: number;
  sourceId: string;
  title: string;
  snippet?: string;
  chunkId?: string;
  charStart?: number;
  charEnd?: number;
};
```

### 9.2 Memory Recall

当前 [src/memory/retriever.ts](../src/memory/retriever.ts) 是内存检索。

MVP 接法：

1. `working` 记忆继续留在内存。
2. `semantic` 记忆改为通过 `searchKnowledge()` 查询 `kind = memory_semantic`。
3. `episodic` 暂时不入索引，先保留现有实现。

---

## 十、最小落地步骤

### Step 1

先引入 SQLite 与 schema 初始化能力。

产出：

1. `src/indexing/db.ts`
2. `src/indexing/schema.ts`
3. 启动时若数据库不存在则自动初始化

### Step 2

实现 chunker 与三类 ingest。

产出：

1. Notebook source ingest
2. Notebook note ingest
3. Semantic memory ingest

### Step 3

实现全量 rebuild 命令。

建议命令：

```json
{
  "scripts": {
    "index:rebuild": "tsx src/indexing/rebuild.ts"
  }
}
```

### Step 4

Notebook Chat 切到统一索引查询，并保留 fallback。

### Step 5

Memory semantic recall 切到统一索引查询。

---

## 十一、建议测试集

MVP 至少补以下测试：

1. chunker：标题切分、超长切分、offset 连续性
2. ingest：重复写入同一文档会替换旧 chunk，而不是叠加脏数据
3. search：按 notebook、kind、sourceId 过滤正确
4. rebuild：删除数据库后可完全重建
5. notebook-chat integration：命中结果带 `charStart/charEnd`

---

## 十二、开工顺序建议

如果你要马上开始写代码，我建议就按下面顺序：

1. 先落 [docs/KNOWLEDGE_INDEX_V1.sql](KNOWLEDGE_INDEX_V1.sql) 里的表结构和 `db.ts`
2. 再写 `chunker.ts`
3. 再写 ingest
4. 然后只先接 Notebook Chat
5. 最后再接 Memory semantic recall

原因很简单：Notebook Chat 最容易验证“统一索引层有没有真的提升引用与检索质量”。