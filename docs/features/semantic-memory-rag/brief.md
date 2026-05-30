# Semantic Memory RAG

> Status: Draft  
> Source: [桌面 AI 助手能力补齐 Product Brief](../../product/DESKTOP_AI_ASSISTANT_GAP_BRIEF.md)  
> Priority: P0.4

## Background

Neo 已经完成统一知识索引底座，覆盖 Notebook source / note、episodic memory 和 semantic memory，并支持 FTS5 检索与 Notebook 精确引用。相关规划见 [knowledge-index/plan.md](../knowledge-index/plan.md) 和 [ROADMAP.md](../../product/ROADMAP.md)。

当前缺口是：知识仍主要通过关键词检索被动命中，还没有 embedding 向量化、语义召回、自动记忆提取和对话摘要。这会限制 Neo 作为“个人 AI 工作台”的核心价值，因为用户长期积累的 Notebook、对话和偏好无法稳定参与回答。

Semantic Memory RAG 的目标是让 Neo 能自动召回语义相关知识，并在对话后沉淀可审查的长期记忆。

## User Problem

- 用户问一个同义或概括性问题时，Neo 可能找不到不含关键词的相关笔记。
- 用户需要反复提醒偏好、决策、项目背景，系统不会自然沉淀。
- 长会话越来越长，但缺少摘要和关键事实抽取。
- 自动写记忆如果不可审查，会污染长期知识，降低信任。

## Goals

- 为 Notebook 和 memory chunks 生成 embedding，并建立本地向量索引。
- Chat 和 Notebook Chat 在回答前自动召回相关知识片段。
- 回答中展示使用的来源，延续现有 Notebook citation 能力。
- 对话结束后提取候选记忆，但首版必须可审查、可撤销。
- 与现有 FTS 检索融合，而不是替代它。

## Non-goals

- 本轮不做完整知识图谱。
- 本轮不做跨用户共享记忆。
- 本轮不自动不可逆写入长期事实。
- 本轮不要求所有 provider 都支持同一 embedding 模型；允许先选一个默认实现。

## Proposed Experience

### 1. 语义索引

在现有 knowledge index rebuild 流程中增加 embedding 阶段。

索引对象：

- Notebook source chunks
- Notebook note chunks
- episodic memory chunks
- semantic memory facts

每个向量记录保留：

- chunkId
- documentId
- kind
- embedding model
- embedding version
- updatedAt

### 2. 混合检索

回答前执行混合召回：

- FTS / LIKE：保证精确关键词和中文片段命中。
- Vector search：召回语义相近内容。
- Rerank / score merge：按来源、更新时间、命中类型融合排序。

首版可以用简单权重融合，不必一次引入复杂 reranker。

### 3. 回答引用

Chat 和 Notebook Chat 应显示“本次使用的知识来源”。

Notebook 来源继续支持点击跳转；memory 来源至少展示事实文本、时间和类型。

### 4. 自动记忆候选

每次对话结束后，系统可以提取候选记忆：

- 用户偏好
- 项目事实
- 决策记录
- 长期关注点

首版不直接写入不可撤销长期记忆，而是进入候选池：用户可接受、编辑、删除或忽略。

### 5. 会话摘要

长会话达到阈值后生成摘要，用于后续上下文压缩和 semantic index。

首版可以只做后台摘要记录，不必立刻替换聊天历史。

## Acceptance Criteria

- 同义查询能命中不包含原始关键词的 Notebook 或 memory chunk。
- 检索结果中能区分 FTS 命中和 vector 命中。
- Chat 回答能展示使用的知识来源。
- 自动提取的记忆进入候选状态，用户可审查后再写入长期记忆。
- Rebuild index 后 embedding 记录能随 chunk 更新而更新。

## Open Questions

- 首版 embedding provider 使用 Gemini、OpenAI，还是本地 Ollama embedding。
- 向量库选择 sqlite-vec、sqlite-vss、FAISS，还是纯 JS 本地库。
- 候选记忆 UI 放在 Settings / Basic / Skills 附近，还是 Notebook / Memory 专页。
- 自动召回默认开启，还是按会话/模式开关。