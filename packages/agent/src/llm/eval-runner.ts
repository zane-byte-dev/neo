/**
 * src/llm/eval-runner.ts — CLI runner for the LLM eval framework.
 *
 * Usage (via npm scripts):
 *   npm run eval:run              — score all fixtures, write reports/latest.json
 *   npm run eval:compare          — diff latest.json vs baselines/baseline.json
 *   npm run eval:update-baseline  — promote latest.json to baselines/baseline.json
 *
 * Direct invocation:
 *   tsx src/llm/eval-runner.ts [run|compare|update-baseline] [--model <alias>]
 *
 * Environment variables:
 *   EVAL_MODE=true   — call the real LLM instead of using fixture mockResponse
 *   GEMINI_API_KEY / OPENAI_API_KEY / …  — required when EVAL_MODE=true
 *   SESSION_SECRET   — required when EVAL_MODE=true (needed by config.ts)
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    EvalCase,
    EvalCaseResult,
    EvalReport,
    EvalBaseline,
    EvalBaselineEntry,
    EvalComparison,
    EvalTagStats,
} from './eval-types.js';
import { scoreEvalCase, PASS_THRESHOLD } from './eval-scorer.js';
import { writeJsonAtomic } from '../utils/atomic-file.js';

// ── Path constants ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// When running via `tsx src/llm/eval-runner.ts`, __dirname is src/llm/.
// The fixture/report/baseline dirs live under src/__tests__/eval/.
const EVAL_ROOT       = resolve(__dirname, '../__tests__/eval');
const FIXTURES_DIR    = join(EVAL_ROOT, 'fixtures');
const REPORTS_DIR     = join(EVAL_ROOT, 'reports');
const BASELINES_DIR   = join(EVAL_ROOT, 'baselines');
const LATEST_REPORT   = join(REPORTS_DIR,  'latest.json');
const BASELINE_FILE   = join(BASELINES_DIR, 'baseline.json');

// ── Fixture loading ───────────────────────────────────────────────────────────

async function loadFixtures(dir: string): Promise<EvalCase[]> {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    const all: EvalCase[] = [];
    for (const file of jsonFiles) {
        const raw = await readFile(join(dir, file), 'utf8');
        const cases = JSON.parse(raw) as EvalCase[];
        if (!Array.isArray(cases)) {
            console.warn(`[eval] Skipping ${file}: expected a JSON array of EvalCase objects`);
            continue;
        }
        all.push(...cases);
    }
    return all;
}

// ── LLM call (real mode) ──────────────────────────────────────────────────────

interface LlmResponse {
    text: string;
    toolsCalled: string[];
}

async function callRealLlm(ev: EvalCase, modelAlias: string): Promise<LlmResponse> {
    // Dynamic import so that mock-mode runs never load config.ts / LLMClient.
    const { LLMClient } = await import('./client.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = new LLMClient();

    const chunks: string[] = [];
    const toolsCalled: string[] = [];

    const history = ev.input.history ?? [];

    await client.chatWithContextStreaming(
        ev.input.message,
        history,
        {
            userId: 'eval-runner',
            sessionId: `eval-${ev.id}`,
            workDir: process.cwd(),
            stateDir: process.cwd(),
            systemInstruction: 'You are a helpful assistant.',
        },
        (chunk: { type: string; text?: string; toolName?: string }) => {
            if (chunk.type === 'text' && chunk.text) chunks.push(chunk.text);
            if (chunk.type === 'tool_call' && chunk.toolName) toolsCalled.push(chunk.toolName);
        },
        undefined,
        modelAlias,
    );

    return { text: chunks.join(''), toolsCalled };
}

// ── Run subcommand ────────────────────────────────────────────────────────────

async function runEval(modelAlias: string): Promise<void> {
    const evalMode = process.env.EVAL_MODE === 'true';
    console.log(`\n📊 Neo Eval Runner`);
    console.log(`   mode   : ${evalMode ? `real LLM (${modelAlias})` : 'mock (using fixture mockResponse)'}`);
    console.log(`   fixtures: ${FIXTURES_DIR}\n`);

    const cases = await loadFixtures(FIXTURES_DIR);
    if (cases.length === 0) {
        console.error('[eval] No fixture cases found. Add JSON files to:', FIXTURES_DIR);
        process.exit(1);
    }

    const results: EvalCaseResult[] = [];
    let skipped = 0;

    for (const ev of cases) {
        let responseText: string;
        let toolsCalled: string[];

        if (evalMode) {
            try {
                const resp = await callRealLlm(ev, modelAlias);
                responseText = resp.text;
                toolsCalled  = resp.toolsCalled;
            } catch (err) {
                console.error(`  ✗ ${ev.id} — LLM call failed:`, (err as Error).message);
                skipped++;
                continue;
            }
        } else {
            if (!ev.mockResponse) {
                console.warn(`  ⚠ ${ev.id} — no mockResponse; skipping (set EVAL_MODE=true to use real LLM)`);
                skipped++;
                continue;
            }
            responseText = ev.mockResponse.text;
            toolsCalled  = ev.mockResponse.toolsCalled ?? [];
        }

        const result = scoreEvalCase(ev, responseText, toolsCalled);
        results.push(result);

        const icon = result.passed ? '✓' : '✗';
        const pct  = (result.overall * 100).toFixed(1);
        console.log(`  ${icon} ${ev.id.padEnd(40)} overall=${pct}%`);
        if (result.violations.length > 0) {
            for (const v of result.violations) {
                console.log(`      ↳ ${v}`);
            }
        }
    }

    // Build summary
    const passed = results.filter((r) => r.passed).length;
    const avgScore = results.length ? results.reduce((s, r) => s + r.overall, 0) / results.length : 0;

    const byTag: Record<string, EvalTagStats> = {};
    for (const r of results) {
        for (const tag of r.tags) {
            if (!byTag[tag]) byTag[tag] = { total: 0, passed: 0, avgScore: 0 };
            byTag[tag].total++;
            if (r.passed) byTag[tag].passed++;
            byTag[tag].avgScore += r.overall;
        }
    }
    for (const tag of Object.keys(byTag)) {
        byTag[tag].avgScore = byTag[tag].avgScore / byTag[tag].total;
    }

    const report: EvalReport = {
        timestamp:   new Date().toISOString(),
        model:       evalMode ? modelAlias : 'mock',
        fixturesDir: FIXTURES_DIR,
        results,
        summary: {
            total:   results.length,
            passed,
            failed:  results.length - passed,
            avgScore,
            byTag,
        },
    };

    await writeJsonAtomic(LATEST_REPORT, report);

    console.log('\n─────────────────────────────────────────');
    console.log(`  Total   : ${results.length + skipped} (${skipped} skipped)`);
    console.log(`  Passed  : ${passed} / ${results.length}`);
    console.log(`  Failed  : ${results.length - passed}`);
    console.log(`  Avg score: ${(avgScore * 100).toFixed(1)}%`);
    console.log(`  Threshold: ${(PASS_THRESHOLD * 100).toFixed(0)}%`);
    console.log('─────────────────────────────────────────');
    console.log(`\n  Report written to: ${LATEST_REPORT}\n`);

    if (results.length - passed > 0) process.exit(1);
}

// ── Compare subcommand ────────────────────────────────────────────────────────

function buildBaseline(report: EvalReport): EvalBaseline {
    return {
        timestamp: report.timestamp,
        model:     report.model,
        entries:   report.results.map((r): EvalBaselineEntry => ({
            caseId:  r.caseId,
            overall: r.overall,
            scores:  r.scores,
        })),
        summary: {
            avgScore: report.summary.avgScore,
            passed:   report.summary.passed,
            total:    report.summary.total,
        },
    };
}

async function compareToBaseline(): Promise<void> {
    if (!existsSync(LATEST_REPORT)) {
        console.error('[eval] No latest report found. Run `npm run eval:run` first.');
        process.exit(1);
    }
    if (!existsSync(BASELINE_FILE)) {
        console.error('[eval] No baseline found. Run `npm run eval:update-baseline` first.');
        process.exit(1);
    }

    const report   = JSON.parse(await readFile(LATEST_REPORT,  'utf8')) as EvalReport;
    const baseline = JSON.parse(await readFile(BASELINE_FILE,  'utf8')) as EvalBaseline;

    const baselineMap = new Map<string, EvalBaselineEntry>(
        baseline.entries.map((e) => [e.caseId, e]),
    );
    const currentMap  = new Map<string, number>(
        report.results.map((r) => [r.caseId, r.overall]),
    );

    const DELTA_THRESHOLD = 0.02; // changes < 2 % are considered "unchanged"
    const regressions: EvalComparison['regressions']   = [];
    const improvements: EvalComparison['improvements'] = [];
    const unchanged: string[] = [];
    const newCases: string[]  = [];
    const removedCases: string[] = [];

    for (const [id, current] of currentMap) {
        const base = baselineMap.get(id);
        if (!base) {
            newCases.push(id);
            continue;
        }
        const delta = current - base.overall;
        if (Math.abs(delta) < DELTA_THRESHOLD) {
            unchanged.push(id);
        } else if (delta < 0) {
            regressions.push({ caseId: id, delta, baselineScore: base.overall, currentScore: current });
        } else {
            improvements.push({ caseId: id, delta, baselineScore: base.overall, currentScore: current });
        }
    }
    for (const [id] of baselineMap) {
        if (!currentMap.has(id)) removedCases.push(id);
    }

    const overallDelta = report.summary.avgScore - baseline.summary.avgScore;

    const comparison: EvalComparison = {
        baselineTimestamp: baseline.timestamp,
        currentTimestamp:  report.timestamp,
        model:             report.model,
        overallDelta,
        regressions:  regressions.sort((a, b) => a.delta - b.delta),
        improvements: improvements.sort((a, b) => b.delta - a.delta),
        unchanged,
        newCases,
        removedCases,
    };

    console.log('\n📊 Eval Comparison Report');
    console.log(`   Baseline : ${baseline.timestamp}  (avg ${(baseline.summary.avgScore * 100).toFixed(1)}%)`);
    console.log(`   Current  : ${report.timestamp}  (avg ${(report.summary.avgScore * 100).toFixed(1)}%)`);
    console.log(`   Δ overall: ${overallDelta >= 0 ? '+' : ''}${(overallDelta * 100).toFixed(1)}%\n`);

    if (improvements.length) {
        console.log('✅ Improvements:');
        for (const imp of improvements) {
            console.log(`   ${imp.caseId.padEnd(40)} +${(imp.delta * 100).toFixed(1)}%  (${(imp.baselineScore * 100).toFixed(1)}% → ${(imp.currentScore * 100).toFixed(1)}%)`);
        }
        console.log();
    }

    if (regressions.length) {
        console.log('❌ Regressions:');
        for (const reg of regressions) {
            console.log(`   ${reg.caseId.padEnd(40)} ${(reg.delta * 100).toFixed(1)}%  (${(reg.baselineScore * 100).toFixed(1)}% → ${(reg.currentScore * 100).toFixed(1)}%)`);
        }
        console.log();
    }

    if (newCases.length)     console.log(`🆕 New cases     : ${newCases.join(', ')}`);
    if (removedCases.length) console.log(`🗑  Removed cases : ${removedCases.join(', ')}`);
    if (unchanged.length)    console.log(`➡  Unchanged     : ${unchanged.length} case(s)`);

    // Write comparison JSON alongside the latest report
    const comparisonFile = join(REPORTS_DIR, 'comparison.json');
    await writeJsonAtomic(comparisonFile, comparison);
    console.log(`\n  Comparison written to: ${comparisonFile}\n`);

    if (regressions.length > 0) process.exit(1);
}

// ── Update-baseline subcommand ────────────────────────────────────────────────

async function updateBaseline(): Promise<void> {
    if (!existsSync(LATEST_REPORT)) {
        console.error('[eval] No latest report found. Run `npm run eval:run` first.');
        process.exit(1);
    }

    const report   = JSON.parse(await readFile(LATEST_REPORT, 'utf8')) as EvalReport;
    const baseline = buildBaseline(report);

    await writeJsonAtomic(BASELINE_FILE, baseline);

    console.log(`\n✅ Baseline updated:`);
    console.log(`   Model     : ${baseline.model}`);
    console.log(`   Timestamp : ${baseline.timestamp}`);
    console.log(`   Cases     : ${baseline.summary.total}`);
    console.log(`   Avg score : ${(baseline.summary.avgScore * 100).toFixed(1)}%`);
    console.log(`   File      : ${BASELINE_FILE}\n`);
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function parseArgs(): { command: string; model: string } {
    const args = process.argv.slice(2);
    let command = 'run';
    let model = process.env.EVAL_MODEL ?? 'deepseek';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--model' && args[i + 1]) {
            model = args[i + 1];
            i++;
        } else if (!args[i].startsWith('--')) {
            command = args[i];
        }
    }
    return { command, model };
}

const { command, model } = parseArgs();

switch (command) {
    case 'run':
        await runEval(model);
        break;
    case 'compare':
        await compareToBaseline();
        break;
    case 'update-baseline':
        await updateBaseline();
        break;
    default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: tsx src/llm/eval-runner.ts [run|compare|update-baseline] [--model <alias>]');
        process.exit(1);
}
