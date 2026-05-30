# Semantic Memory RAG Dev Plan

## Status

Draft. No implementation has started.

## Scope

First slice adds embedding-backed retrieval and reviewable memory candidates.

Included:

- Embedding provider abstraction.
- Vector index storage for existing knowledge chunks.
- Hybrid search API.
- Chat/Notebook context injection.
- Reviewable memory candidate store.

Not included:

- Full memory decay and consolidation.
- Knowledge graph/entity linking.
- Automatic irreversible memory writes.
- Complex learned reranker.

## Architecture Plan

### Embedding Layer

Suggested files:

- `src/llm/embeddings.ts`
- `src/llm/embedding-providers/*`
- `src/indexing/embeddings.ts`

Responsibilities:

- Normalize provider interface.
- Batch embedding requests.
- Track model id and dimensions.
- Respect cost and rate limits.

### Vector Storage

Suggested files:

- `src/indexing/vector-schema.ts`
- `src/indexing/vector-store.ts`
- `src/indexing/rebuild.ts`

Storage options:

- Prefer SQLite extension if deployment impact is acceptable.
- If extension friction is high, start with a simple local vector table and cosine scan for small personal datasets.

Initial schema fields:

- `chunk_id`
- `document_id`
- `kind`
- `embedding_model`
- `embedding_version`
- `vector`
- `updated_at`

### Hybrid Search

Suggested files:

- `src/indexing/search.ts`
- `src/indexing/hybrid-search.ts`

Approach:

1. Run existing FTS / LIKE search.
2. Run vector search.
3. Merge by chunkId.
4. Score using weighted source: exact > vector > fallback, with recency as tiebreaker.
5. Return hit metadata showing `matchType`.

### Context Injection

Suggested files:

- `src/services/agent-runner.ts`
- `src/services/notebook-chat.ts`
- `src/services/chat-service.ts`

Approach:

- Before LLM call, retrieve top relevant chunks for the current message.
- Add a bounded context block to system/user prompt.
- Emit run event for retrieved knowledge source IDs.
- Keep source metadata for UI citation display.

### Memory Candidates

Suggested files:

- `src/memory/candidate-store.ts`
- `src/memory/extractor.ts`
- `src/routes/memory-candidates.ts`
- `web/src/components/MemoryCandidatesPanel.tsx`

Candidate states:

- `pending`
- `accepted`
- `rejected`
- `edited`

Acceptance writes to existing semantic memory store and triggers index update.

## Phases

### Phase 1: Embedding Index MVP

- Add embedding abstraction.
- Add vector storage.
- Extend rebuild command to embed existing chunks.
- Add tests for embedding cache/update behavior.

### Phase 2: Hybrid Retrieval

- Add vector search.
- Merge FTS and vector results.
- Return match metadata.
- Add regression tests for exact, Chinese and semantic queries.

### Phase 3: Chat Integration

- Inject retrieved chunks into Chat and Notebook Chat.
- Emit source events.
- Display used sources in assistant response or activity log.

### Phase 4: Reviewable Memory Candidates

- Extract candidates after selected conversations.
- Add pending memory UI.
- Accept/reject/edit candidates.

## Testing

Backend:

- Embedding provider mock tests.
- Vector storage insert/update/delete tests.
- Hybrid search tests with exact, CJK and semantic cases.
- Memory candidate route tests.

Frontend:

- Build verification.
- Browser smoke for source display and candidate review.

Validation commands:

```bash
npm run build
npx vitest run src/indexing src/memory src/llm
npm --prefix web run build
npm run docs:check
```

## Documentation Updates

- Update [NOTEBOOK.md](../../user-guide/NOTEBOOK.md) with semantic retrieval behavior.
- Update [TOOLS.md](../../user-guide/TOOLS.md) if memory tools change.
- Update [ROADMAP.md](../../product/ROADMAP.md) as embedding phases complete.
- Add test report after implementation.

## Risks

- SQLite vector extension may complicate local install and CI.
- Embedding costs can surprise users; show provider and rebuild cost estimate where possible.
- Poor automatic memory extraction can damage trust; candidates must be reviewable.
- Injected context can bloat prompts; enforce token budgets.