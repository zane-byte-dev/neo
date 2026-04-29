export type KnowledgeKind = 'notebook_source' | 'notebook_note' | 'memory_episodic' | 'memory_semantic';

export type KnowledgeScope = 'notebook' | 'memory';

export interface KnowledgeDocumentInput {
    documentId: string;
    userId?: string | null;
    kind: KnowledgeKind;
    scope: KnowledgeScope;
    notebook?: string | null;
    sessionId?: string | null;
    sourceId?: string | null;
    sourcePath: string;
    sourceUrl?: string | null;
    title: string;
    summary?: string | null;
    tagsJson?: string | null;
    checksum: string;
    createdAt: number;
    updatedAt: number;
}

export interface KnowledgeChunkSeed {
    ordinal: number;
    text: string;
    charStart: number;
    charEnd: number;
    headingPath?: string | null;
}

export interface KnowledgeChunkInput {
    text: string;
    maxChars?: number;
    overlapChars?: number;
}

export interface KnowledgeHit {
    documentId: string;
    chunkId: string;
    kind: KnowledgeKind;
    scope: KnowledgeScope;
    notebook: string | null;
    sessionId: string | null;
    sourceId: string | null;
    sourcePath: string;
    sourceUrl: string | null;
    title: string;
    summary: string | null;
    tagsJson: string | null;
    ordinal: number;
    headingPath: string | null;
    charStart: number;
    charEnd: number;
    tokenEstimate: number | null;
    text: string;
    updatedAt: number;
    score: number;
}

export interface SearchKnowledgeOptions {
    workDir: string;
    query: string;
    kinds?: KnowledgeKind[];
    notebook?: string;
    sourceIds?: string[];
    limit?: number;
}

export interface KnowledgeRebuildSummary {
    notebooks: number;
    notebookSources: number;
    notebookNotes: number;
    episodicEpisodes: number;
    semanticFacts: number;
}