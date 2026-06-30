const MAX_TITLE_CHARS = 32

const NON_INFORMATIVE_PATTERN = /^(?:hi|hello|hey|你好|您好|嗨|哈喽|在吗|在不在|我有个问题|有个问题|想问个问题|请教个问题|想咨询个问题|有个需求)$/iu

const LEADING_REQUEST_PATTERNS = [
    /^(?:请问|请帮我|帮我|帮忙|麻烦(?:你)?|请你|想请你|我想请你|我想|我需要|需要|想要|想让你|请教一下|问一下|想咨询一下|咨询一下|可以(?:帮我)?|能不能(?:帮我)?|能否(?:帮我)?|可否(?:帮我)?|有没有办法|关于)\s*/u,
    /^(?:please|can you|could you|would you|help me(?:\s+to)?|i need(?: help)?(?:\s+to)?|i want to|how to|what is|what are|why is|why are|explain|tell me about|show me)\s+/iu,
]

const ACTION_FILLER_PATTERN = /^(优化|修复|排查|分析|解释|总结|整理|梳理|实现|设计|编写|生成|翻译|检查|确认|看看|看)一下/u

function clampTitle(title: string, max = MAX_TITLE_CHARS): string {
    const chars = [...title]
    if (chars.length <= max) return title

    const preview = chars.slice(0, max + 1).join('')
    const lastSpace = preview.lastIndexOf(' ')
    return (lastSpace >= Math.floor(max * 0.6)
        ? preview.slice(0, lastSpace)
        : chars.slice(0, max).join('')).trim()
}

function normalizeCandidate(raw: string): string {
    let candidate = raw
        .replace(/^[\s>*#\-+•\d.)]+/gu, '')
        .replace(/^[\s"'“”‘’「」『』（）()【】[\]<>]+/gu, '')
        .replace(/[\s"'“”‘’「」『』（）()【】[\]<>]+$/gu, '')
        .replace(/\s+/g, ' ')
        .trim()

    for (let i = 0; i < 4; i++) {
        const before = candidate
        candidate = candidate.replace(ACTION_FILLER_PATTERN, '$1')
        for (const pattern of LEADING_REQUEST_PATTERNS) {
            candidate = candidate.replace(pattern, '')
        }
        candidate = candidate
            .replace(/^(?:一下|一下子)\s*/u, '')
            .replace(/^(?:我有个|有个)(?:问题|需求)\s*/u, '')
            .trim()
        if (candidate === before) break
    }

    candidate = candidate
        .replace(/(?:请问|谢谢|thanks|thank you)[\s,.，。!?！？]*$/iu, '')
        .replace(/[，。！？!?；;:：、]+$/u, '')
        .replace(/\s+/g, ' ')
        .trim()

    if (/[A-Za-z]/.test(candidate) && !/[\u4e00-\u9fff]/u.test(candidate) && /^[a-z]/.test(candidate)) {
        candidate = candidate[0].toUpperCase() + candidate.slice(1)
    }

    return candidate
}

function normalizeSource(content: string): string {
    return content
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`\n]+`/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function isInformative(candidate: string): boolean {
    if ([...candidate.replace(/\s+/g, '')].length < 4) return false
    return !NON_INFORMATIVE_PATTERN.test(candidate)
}

function splitCandidates(source: string): string[] {
    return source
        .split(/\n+|[。！？!?；;:：]+|[，,、]+/u)
        .map(normalizeCandidate)
        .filter(Boolean)
}

export function deriveChatTitleFromMessage(content: string, fallback = ''): string {
    const source = normalizeSource(content)
    if (!source) return fallback

    const candidates = splitCandidates(source)
    const firstMeaningful = candidates.find(isInformative)
    const firstLine = source.split('\n').find((line) => line.trim()) ?? source
    const fallbackTitle = normalizeCandidate(firstLine) || normalizeCandidate(source) || fallback

    return clampTitle(firstMeaningful || fallbackTitle || source || fallback)
}
