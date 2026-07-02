// Text-to-speech helpers extracted from ChatArea.
// Pure browser-API utilities with no React dependencies.

export function stripMarkdownForSpeech(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, '') // code blocks
        .replace(/`[^`]+`/g, '') // inline code
        .replace(/#{1,6}\s+/g, '') // headings
        .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
        .replace(/\*([^*]+)\*/g, '$1') // italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
        .replace(/^[-*+]\s+/gm, '') // unordered list
        .replace(/^\d+\.\s+/gm, '') // ordered list
        .replace(/\n{2,}/g, ' ')
        .trim();
}

/** Heuristic: pick a BCP-47 lang based on dominant script in the text. */
export function detectSpeechLang(text: string): string {
    const han = (text.match(/\p{Script=Han}/gu) || []).length;
    const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    const hangul = (text.match(/\p{Script=Hangul}/gu) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const max = Math.max(han, kana, hangul, latin);
    if (max === 0) return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    if (max === kana) return 'ja-JP';
    if (max === hangul) return 'ko-KR';
    if (max === han) return 'zh-CN';
    return 'en-US';
}

/** Pick the best matching voice for the given BCP-47 lang.
 *  Prefers neural / premium voices when the platform exposes them
 *  (e.g. macOS/iOS Siri, Chrome's Google voices, Edge's Natural voices). */
export function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return undefined;
    const lower = lang.toLowerCase();
    const prefix = lower.split('-')[0];

    const matchesLang = (v: SpeechSynthesisVoice) => {
        const vl = v.lang.toLowerCase();
        return vl === lower || vl.startsWith(prefix + '-') || vl.startsWith(prefix);
    };

    const candidates = voices.filter(matchesLang);
    if (!candidates.length) return undefined;

    // Score voices by quality hints in their name. Higher is better.
    const score = (v: SpeechSynthesisVoice): number => {
        const name = v.name.toLowerCase();
        let s = 0;
        if (/siri/.test(name)) s += 100;
        if (/neural|natural/.test(name)) s += 80;
        if (/premium|enhanced|hd/.test(name)) s += 60;
        if (/google/.test(name)) s += 40; // Chrome's online Google voices are decent
        if (/online/.test(name)) s += 10;
        if (/compact|novelty|whisper|bad|eloquence/.test(name)) s -= 50;
        // Prefer exact lang match over prefix match.
        const vl = v.lang.toLowerCase();
        if (vl === lower) s += 5;
        else if (vl.startsWith(prefix + '-')) s += 2;
        // Some platforms mark higher-quality voices as non-default; ignore default flag.
        return s;
    };

    return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

export function speakText(text: string, onEnd?: () => void) {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        onEnd?.();
        return;
    }
    window.speechSynthesis.cancel();
    const plain = stripMarkdownForSpeech(text);
    if (!plain) {
        onEnd?.();
        return;
    }
    const speak = () => {
        const utt = new SpeechSynthesisUtterance(plain);
        const lang = detectSpeechLang(plain);
        utt.lang = lang;
        const voice = pickVoice(lang);
        if (voice) utt.voice = voice;
        utt.onend = () => onEnd?.();
        utt.onerror = () => onEnd?.();
        window.speechSynthesis.speak(utt);
    };
    // Voices may load asynchronously on first call; wait once if needed.
    if (window.speechSynthesis.getVoices().length === 0) {
        const handler = () => {
            window.speechSynthesis.removeEventListener('voiceschanged', handler);
            speak();
        };
        window.speechSynthesis.addEventListener('voiceschanged', handler);
        // Fallback in case the event never fires.
        setTimeout(() => {
            window.speechSynthesis.removeEventListener('voiceschanged', handler);
            speak();
        }, 250);
        return;
    }
    speak();
}
