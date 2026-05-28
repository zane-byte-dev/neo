/**
 * src/llm/eval-types.ts — Shared type definitions for the LLM eval framework.
 *
 * The eval framework lets you measure whether model / prompt changes are
 * improvements or regressions by running a fixed fixture set and comparing
 * scores against a saved baseline.
 *
 * Workflow:
 *   npm run eval:run              → run all fixtures, write reports/latest.json
 *   npm run eval:compare          → diff latest.json against baselines/baseline.json
 *   npm run eval:update-baseline  → promote latest.json to baseline.json
 */

// ── Fixture / test-case types ─────────────────────────────────────────────────

export interface EvalCaseInput {
    /** The user message to evaluate. */
    message: string;
    /** Optional prior conversation turns to pass as history. */
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface EvalExpectedBehaviors {
    /** Response MUST include all listed substrings (case-insensitive). */
    contains?: string[];
    /** Response MUST NOT include any of these substrings (case-insensitive). */
    notContains?: string[];
    /** Response must match this regular-expression pattern. */
    matchesRegex?: string;
    /** Minimum response character length. */
    minLength?: number;
    /** Maximum response character length. */
    maxLength?: number;
    /** Tool names that must appear in the actual tool calls. */
    toolsCalled?: string[];
    /** ISO 639-1 language code the response must be written in ('zh' | 'en'). */
    language?: string;
}

export interface EvalMockResponse {
    /** Canned response text used when the runner is in mock / dry-run mode. */
    text: string;
    /** Tools that the mock response would have called. */
    toolsCalled?: string[];
}

export interface EvalCase {
    /** Stable unique identifier for this test case. */
    id: string;
    /** Human-readable explanation of what this case is testing. */
    description: string;
    /** Grouping tags, e.g. ["qa", "coding", "safety"]. */
    tags: string[];
    /** Input handed to the model. */
    input: EvalCaseInput;
    /** Constraints the model response must satisfy. */
    expectedBehaviors: EvalExpectedBehaviors;
    /**
     * Canned response for mock / dry-run mode.  When omitted and the runner is
     * in mock mode the case is skipped with a warning.
     */
    mockResponse?: EvalMockResponse;
}

// ── Scoring types ─────────────────────────────────────────────────────────────

export interface EvalDimensionScores {
    /** Keyword overlap between input message and response (0-1). */
    relevance: number;
    /** Fraction of expectedBehaviors constraints that pass (0-1). */
    completeness: number;
    /** Length and language constraints (0-1). */
    format: number;
    /** Expected tools called vs actual (0-1). */
    toolUse: number;
    /** No dangerous shell patterns in response (0 or 1). */
    safety: number;
}

export interface EvalCaseResult {
    caseId: string;
    description: string;
    tags: string[];
    responseText: string;
    toolsCalled: string[];
    scores: EvalDimensionScores;
    /** Weighted average of all dimension scores (0-1). */
    overall: number;
    /** True when overall >= PASS_THRESHOLD. */
    passed: boolean;
    /** Human-readable list of constraint violations. */
    violations: string[];
}

// ── Report types ──────────────────────────────────────────────────────────────

export interface EvalTagStats {
    total: number;
    passed: number;
    avgScore: number;
}

export interface EvalReport {
    timestamp: string;
    /** Model alias / ID used for this run (or "mock" in dry-run mode). */
    model: string;
    fixturesDir: string;
    results: EvalCaseResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        avgScore: number;
        byTag: Record<string, EvalTagStats>;
    };
}

// ── Baseline types ────────────────────────────────────────────────────────────

export interface EvalBaselineEntry {
    caseId: string;
    overall: number;
    scores: EvalDimensionScores;
}

export interface EvalBaseline {
    timestamp: string;
    model: string;
    entries: EvalBaselineEntry[];
    summary: {
        avgScore: number;
        passed: number;
        total: number;
    };
}

// ── Comparison types ──────────────────────────────────────────────────────────

export interface EvalCaseDelta {
    caseId: string;
    delta: number;
    baselineScore: number;
    currentScore: number;
}

export interface EvalComparison {
    baselineTimestamp: string;
    currentTimestamp: string;
    model: string;
    overallDelta: number;
    regressions: EvalCaseDelta[];
    improvements: EvalCaseDelta[];
    unchanged: string[];
    newCases: string[];
    removedCases: string[];
}
