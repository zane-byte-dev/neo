/**
 * tokenize.ts — Lightweight CJK-aware tokenizer for keyword retrieval.
 *
 * Produces a bag of lowercase unigrams for ASCII/words + CJK bigrams.
 * Good enough for BM25-lite; no external dependency.
 */

const STOPWORDS = new Set([
    // English
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'it',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they',
    // Chinese common
    '的', '了', '是', '在', '和', '与', '或', '也', '就', '都',
    '我', '你', '他', '她', '它', '我们', '你们', '他们', '这', '那',
    '吗', '呢', '啊', '吧', '嘛', '啦', '哦', '哈',
]);

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export function tokenize(text: string): string[] {
    if (!text) return [];
    const lower = text.toLowerCase();
    const tokens: string[] = [];

    // Match runs of ASCII-word chars OR single CJK chars (as atoms).
    const matches = lower.match(/[a-z0-9_]+|[\u4e00-\u9fff\u3400-\u4dbf]/g);
    if (!matches) return [];

    // ASCII words → unigrams; CJK atoms → collect then bigram them.
    const cjkRun: string[] = [];
    const flushCjk = () => {
        if (cjkRun.length === 1) {
            // single CJK char — keep as unigram (may still match queries)
            if (!STOPWORDS.has(cjkRun[0])) tokens.push(cjkRun[0]);
        } else if (cjkRun.length >= 2) {
            for (let i = 0; i < cjkRun.length - 1; i++) {
                tokens.push(cjkRun[i] + cjkRun[i + 1]);
            }
        }
        cjkRun.length = 0;
    };

    for (const m of matches) {
        if (CJK.test(m)) {
            cjkRun.push(m);
        } else {
            flushCjk();
            if (m.length >= 2 && !STOPWORDS.has(m)) tokens.push(m);
        }
    }
    flushCjk();
    return tokens;
}
