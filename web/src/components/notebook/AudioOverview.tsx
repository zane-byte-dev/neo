/**
 * AudioOverview — play a 2-speaker script using Web Speech API.
 * Lines: { speaker: 'A' | 'B', text: string }
 */
import React from 'react'
import { Play, Pause, SkipForward, Volume2 } from 'lucide-react'

export interface AudioLine { speaker: 'A' | 'B'; text: string }

interface Props { script: AudioLine[]; title?: string }

export const AudioOverview: React.FC<Props> = ({ script, title }) => {
    const [playing, setPlaying] = React.useState(false)
    const [idx, setIdx] = React.useState(0)
    const [rate, setRate] = React.useState(1.0)
    const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([])
    const [voiceA, setVoiceA] = React.useState<string>('')
    const [voiceB, setVoiceB] = React.useState<string>('')

    React.useEffect(() => {
        const load = () => {
            const v = window.speechSynthesis.getVoices()
            setVoices(v)
            if (!voiceA) {
                const zhVoices = v.filter((x) => x.lang.startsWith('zh'))
                const pool = zhVoices.length >= 2 ? zhVoices : v
                if (pool[0]) setVoiceA(pool[0].name)
                if (pool[1]) setVoiceB(pool[1].name)
            }
        }
        load()
        window.speechSynthesis.onvoiceschanged = load
        return () => { window.speechSynthesis.onvoiceschanged = null }
    }, [voiceA])

    const speak = React.useCallback((lineIdx: number) => {
        if (lineIdx >= script.length) { setPlaying(false); return }
        const line = script[lineIdx]
        const u = new SpeechSynthesisUtterance(line.text)
        u.rate = rate
        const voiceName = line.speaker === 'A' ? voiceA : voiceB
        const v = voices.find((x) => x.name === voiceName)
        if (v) u.voice = v
        u.onend = () => {
            setIdx(lineIdx + 1)
            setTimeout(() => speak(lineIdx + 1), 150)
        }
        window.speechSynthesis.speak(u)
    }, [script, rate, voices, voiceA, voiceB])

    const toggle = () => {
        if (playing) {
            window.speechSynthesis.pause()
            setPlaying(false)
        } else {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume()
            } else {
                speak(idx)
            }
            setPlaying(true)
        }
    }

    const skip = () => {
        window.speechSynthesis.cancel()
        const next = Math.min(idx + 1, script.length - 1)
        setIdx(next)
        if (playing) speak(next)
    }

    React.useEffect(() => () => { window.speechSynthesis.cancel() }, [])

    return (
        <div className="flex flex-col h-full bg-bg-container rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2 mb-3">
                    <Volume2 size={16} className="text-primary-mint" />
                    <span className="text-sm font-semibold flex-1 truncate">{title || '音频概览'}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={toggle}
                        className="w-10 h-10 rounded-full bg-primary-mint text-white flex items-center justify-center hover:bg-primary-mint/90"
                    >
                        {playing ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                        onClick={skip}
                        className="w-8 h-8 rounded-full bg-fill-secondary hover:bg-fill flex items-center justify-center"
                    >
                        <SkipForward size={14} />
                    </button>
                    <select
                        value={rate}
                        onChange={(e) => setRate(Number(e.target.value))}
                        className="text-xs bg-fill-secondary border border-border rounded-lg px-2 py-1.5"
                    >
                        <option value={0.75}>0.75x</option>
                        <option value={1}>1x</option>
                        <option value={1.25}>1.25x</option>
                        <option value={1.5}>1.5x</option>
                        <option value={2}>2x</option>
                    </select>
                    <span className="text-xs text-text-tertiary ml-auto">
                        {Math.min(idx + 1, script.length)} / {script.length}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                    <label className="text-[10px] text-text-tertiary">
                        A
                        <select value={voiceA} onChange={(e) => setVoiceA(e.target.value)} className="w-full text-xs bg-fill-secondary border border-border rounded-lg px-2 py-1 mt-0.5 truncate">
                            {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                        </select>
                    </label>
                    <label className="text-[10px] text-text-tertiary">
                        B
                        <select value={voiceB} onChange={(e) => setVoiceB(e.target.value)} className="w-full text-xs bg-fill-secondary border border-border rounded-lg px-2 py-1 mt-0.5 truncate">
                            {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                        </select>
                    </label>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                {script.map((line, i) => (
                    <div
                        key={i}
                        className={`flex gap-2 items-start p-2.5 rounded-xl transition-colors ${i === idx ? 'bg-primary-mint/10 ring-1 ring-primary-mint/30' : 'hover:bg-fill-secondary'}`}
                    >
                        <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${line.speaker === 'A' ? 'bg-primary-mint/20 text-primary-mint' : 'bg-orange-500/20 text-orange-600'}`}>
                            {line.speaker}
                        </span>
                        <p className="text-sm leading-relaxed flex-1">{line.text}</p>
                    </div>
                ))}
            </div>
        </div>
    )
}
