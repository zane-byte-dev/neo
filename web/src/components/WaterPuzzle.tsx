import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { RotateCcw, Trophy, ChevronLeft, ChevronRight, Lightbulb, X, Droplets } from 'lucide-react'
import { cn } from '../lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

interface Jug {
    id: number
    capacity: number
    current: number
}

interface LevelDef {
    id: number
    name: string
    description: string
    initialJugs: Jug[]
    goal: number[]        // -1 = don't care
    allowFillEmpty: boolean
    optimalMoves: number
    solutionSteps: string[]
}

// ── Level data ──────────────────────────────────────────────────────────────

const LEVELS: LevelDef[] = [
    {
        id: 1,
        name: '初级：经典量水',
        description: '用 3L 和 5L 水壶量出恰好 4L',
        initialJugs: [
            { id: 0, capacity: 3, current: 0 },
            { id: 1, capacity: 5, current: 0 },
        ],
        goal: [-1, 4],
        allowFillEmpty: true,
        optimalMoves: 6,
        solutionSteps: [
            '灌满 5L 水壶 → [0, 5]',
            '5L → 3L（装满 3L，剩 2L）→ [3, 2]',
            '清空 3L 水壶 → [0, 2]',
            '5L → 3L（转入 2L）→ [2, 0]',
            '灌满 5L 水壶 → [2, 5]',
            '5L → 3L（还差 1L，5L 剩 4L）→ [3, 4] ✓',
        ],
    },
    {
        id: 2,
        name: '中级：均分 8 升',
        description: '将 8L 水壶的水平均分成两份（各 4L）',
        initialJugs: [
            { id: 0, capacity: 8, current: 8 },
            { id: 1, capacity: 5, current: 0 },
            { id: 2, capacity: 3, current: 0 },
        ],
        goal: [4, 4, 0],
        allowFillEmpty: false,
        optimalMoves: 7,
        solutionSteps: [
            '8L → 5L → [3, 5, 0]',
            '5L → 3L → [3, 2, 3]',
            '3L → 8L → [6, 2, 0]',
            '5L → 3L → [6, 0, 2]',
            '8L → 5L → [1, 5, 2]',
            '5L → 3L → [1, 4, 3]',
            '3L → 8L → [4, 4, 0] ✓',
        ],
    },
    {
        id: 3,
        name: '高级：均分 12 升',
        description: '将 12L 水壶的水平均分成两份（各 6L）',
        initialJugs: [
            { id: 0, capacity: 12, current: 12 },
            { id: 1, capacity: 7, current: 0 },
            { id: 2, capacity: 5, current: 0 },
        ],
        goal: [6, 6, 0],
        allowFillEmpty: false,
        optimalMoves: 11,
        solutionSteps: [
            '12L → 7L → [5, 7, 0]',
            '7L → 5L → [5, 2, 5]',
            '5L → 12L → [10, 2, 0]',
            '7L → 5L → [10, 0, 2]',
            '12L → 7L → [3, 7, 2]',
            '7L → 5L → [3, 4, 5]',
            '5L → 12L → [8, 4, 0]',
            '7L → 5L → [8, 0, 4]',
            '12L → 7L → [1, 7, 4]',
            '7L → 5L → [1, 6, 5]',
            '5L → 12L → [6, 6, 0] ✓',
        ],
    },
]

// ── Pure game logic ─────────────────────────────────────────────────────────

function pourWater(jugs: Jug[], srcId: number, dstId: number): Jug[] | null {
    const src = jugs.find(j => j.id === srcId)!
    const dst = jugs.find(j => j.id === dstId)!
    if (src.current === 0 || dst.current === dst.capacity) return null
    const amount = Math.min(src.current, dst.capacity - dst.current)
    return jugs.map(j => {
        if (j.id === srcId) return { ...j, current: j.current - amount }
        if (j.id === dstId) return { ...j, current: j.current + amount }
        return j
    })
}

function fillJug(jugs: Jug[], id: number): Jug[] | null {
    const jug = jugs.find(j => j.id === id)!
    if (jug.current === jug.capacity) return null
    return jugs.map(j => j.id === id ? { ...j, current: j.capacity } : j)
}

function emptyJug(jugs: Jug[], id: number): Jug[] | null {
    const jug = jugs.find(j => j.id === id)!
    if (jug.current === 0) return null
    return jugs.map(j => j.id === id ? { ...j, current: 0 } : j)
}

function checkWin(jugs: Jug[], goal: number[]): boolean {
    return jugs.every((j, i) => goal[i] === -1 || j.current === goal[i])
}

// ── Jug SVG component ───────────────────────────────────────────────────────

interface JugViewProps {
    jug: Jug
    goal: number
    height: number
    selected: boolean
    isTarget: boolean
    animating: 'pour' | 'receive' | null
    onClick: () => void
    onFill?: () => void
    onEmpty?: () => void
}

const JugView: React.FC<JugViewProps> = ({
    jug, goal, height, selected, isTarget, animating, onClick, onFill, onEmpty,
}) => {
    const fillPct = jug.capacity > 0 ? (jug.current / jug.capacity) * 100 : 0
    const goalPct = goal > 0 ? (goal / jug.capacity) * 100 : -1
    const goalMet = goal === -1 || jug.current === goal
    const WIDTH = 64

    return (
        <div className="flex flex-col items-center gap-2 select-none">
            {/* Goal badge */}
            <div className={cn(
                'text-xs font-semibold px-2.5 py-0.5 rounded-full border transition-all duration-300',
                goal === -1
                    ? 'text-text-tertiary bg-fill border-border-secondary'
                    : goalMet
                        ? 'text-success bg-success/10 border-success/30'
                        : 'text-text-secondary bg-fill border-border',
            )}>
                {goal === -1 ? '—' : goalMet ? `✓ ${goal}L` : `目标 ${goal}L`}
            </div>

            {/* Jug wrapper */}
            <div
                className={cn(
                    'relative cursor-pointer transition-all duration-200',
                    selected ? 'scale-[1.08] drop-shadow-lg' : isTarget ? 'scale-[1.04]' : 'hover:scale-[1.03]',
                    animating === 'receive' ? 'animate-bounce' : '',
                )}
                onClick={onClick}
                style={{ width: WIDTH + 8 }}
                title={selected ? '点击其他水壶倒入' : '点击选择'}
            >
                {/* SVG jug */}
                <svg
                    width={WIDTH + 8}
                    height={height + 20}
                    viewBox={`0 0 ${WIDTH + 8} ${height + 20}`}
                    className="overflow-visible"
                >
                    <defs>
                        <clipPath id={`water-clip-${jug.id}`}>
                            {/* clip matches inner jug area */}
                            <rect x="4" y="0" width={WIDTH} height={height} rx="4" />
                        </clipPath>
                        <linearGradient id={`water-grad-${jug.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop
                                offset="0%"
                                stopColor={selected ? '#34d399' : isTarget ? '#818cf8' : '#38bdf8'}
                                stopOpacity="0.95"
                            />
                            <stop
                                offset="100%"
                                stopColor={selected ? '#059669' : isTarget ? '#4f46e5' : '#0284c7'}
                                stopOpacity="1"
                            />
                        </linearGradient>
                        <linearGradient id={`jug-grad-${jug.id}`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor={selected ? '#34d399' : isTarget ? '#818cf8' : '#94a3b8'} stopOpacity="0.3" />
                            <stop offset="100%" stopColor={selected ? '#059669' : isTarget ? '#4f46e5' : '#64748b'} stopOpacity="0.1" />
                        </linearGradient>
                    </defs>

                    {/* Jug body border */}
                    <rect
                        x="4" y="0"
                        width={WIDTH} height={height}
                        rx="6" ry="6"
                        fill={`url(#jug-grad-${jug.id})`}
                        stroke={selected ? '#34d399' : isTarget ? '#818cf8' : '#cbd5e1'}
                        strokeWidth={selected || isTarget ? 2.5 : 1.5}
                    />

                    {/* Water fill */}
                    <g clipPath={`url(#water-clip-${jug.id})`}>
                        <rect
                            x="4"
                            y={height - (height * fillPct) / 100}
                            width={WIDTH}
                            height={(height * fillPct) / 100}
                            fill={`url(#water-grad-${jug.id})`}
                            rx="3"
                            style={{ transition: 'y 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        />
                        {/* Water surface shimmer */}
                        {fillPct > 0 && (
                            <rect
                                x="4"
                                y={height - (height * fillPct) / 100}
                                width={WIDTH}
                                height="4"
                                fill="white"
                                fillOpacity="0.25"
                                rx="2"
                                style={{ transition: 'y 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                            />
                        )}
                    </g>

                    {/* Capacity tick marks */}
                    {Array.from({ length: jug.capacity - 1 }).map((_, i) => {
                        const yPos = height - (height * (i + 1)) / jug.capacity
                        return (
                            <line
                                key={i}
                                x1="4" y1={yPos}
                                x2={16} y2={yPos}
                                stroke="#94a3b8"
                                strokeWidth="1"
                                strokeOpacity="0.5"
                            />
                        )
                    })}

                    {/* Goal dashed line */}
                    {goalPct > 0 && !goalMet && (
                        <line
                            x1="4" y1={height - (height * goalPct) / 100}
                            x2={WIDTH + 4} y2={height - (height * goalPct) / 100}
                            stroke="#f59e0b"
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                            strokeOpacity="0.85"
                        />
                    )}

                    {/* Current amount text */}
                    <text
                        x={(WIDTH + 8) / 2}
                        y={height / 2 + 5}
                        textAnchor="middle"
                        fontSize="18"
                        fontWeight="700"
                        fill={fillPct > 45 ? 'white' : '#374151'}
                        style={{ userSelect: 'none', transition: 'fill 0.3s' }}
                    >
                        {jug.current}
                    </text>

                    {/* Spout top indicator */}
                    {selected && (
                        <text
                            x={(WIDTH + 8) / 2}
                            y={-6}
                            textAnchor="middle"
                            fontSize="14"
                            fill="#34d399"
                            style={{ userSelect: 'none' }}
                        >
                            ▼
                        </text>
                    )}
                </svg>

                {/* Selected glow ring */}
                {(selected || isTarget) && (
                    <div
                        className={cn(
                            'absolute inset-0 rounded-lg pointer-events-none',
                            selected
                                ? 'shadow-[0_0_0_3px_rgba(52,211,153,0.4),0_0_20px_rgba(52,211,153,0.2)]'
                                : 'shadow-[0_0_0_2px_rgba(129,140,248,0.4),0_0_16px_rgba(129,140,248,0.15)]',
                        )}
                    />
                )}
            </div>

            {/* Capacity label */}
            <div className="text-xs font-medium text-text-tertiary">
                {jug.capacity}L
            </div>

            {/* Fill / Empty buttons (level 1 only) */}
            {(onFill || onEmpty) && (
                <div className="flex gap-1.5">
                    <button
                        onClick={e => { e.stopPropagation(); onFill?.() }}
                        disabled={jug.current === jug.capacity}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-sky-100 text-sky-700 hover:bg-sky-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors border border-sky-200"
                    >
                        灌满
                    </button>
                    <button
                        onClick={e => { e.stopPropagation(); onEmpty?.() }}
                        disabled={jug.current === 0}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-fill text-text-secondary hover:bg-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors border border-border"
                    >
                        清空
                    </button>
                </div>
            )}
        </div>
    )
}

// ── Win overlay ──────────────────────────────────────────────────────────────

const WinOverlay: React.FC<{
    moves: number
    optimal: number
    levelIndex: number
    totalLevels: number
    onNext: () => void
    onRetry: () => void
}> = ({ moves, optimal, levelIndex, totalLevels, onNext, onRetry }) => {
    const efficiency = moves <= optimal ? '完美！' : moves <= optimal + 3 ? '很棒！' : '已完成'
    const stars = moves <= optimal ? 3 : moves <= optimal + 3 ? 2 : 1

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in">
            <div
                className="bg-bg-container border border-border rounded-2xl p-8 max-w-sm w-full mx-4 text-center animate-slide-up"
                style={{ boxShadow: 'var(--shadow-float)' }}
            >
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
                    <Trophy size={28} className="text-white" />
                </div>
                <h2 className="text-xl font-bold text-text mb-1">{efficiency}</h2>
                <p className="text-text-secondary text-sm mb-5">关卡已完成</p>

                {/* Stars */}
                <div className="flex justify-center gap-2 mb-5">
                    {[1, 2, 3].map(s => (
                        <span key={s} className={cn('text-2xl transition-all', s <= stars ? 'text-yellow-400' : 'text-text-quaternary')}>
                            ★
                        </span>
                    ))}
                </div>

                {/* Stats */}
                <div className="flex gap-4 justify-center mb-6">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-text">{moves}</div>
                        <div className="text-xs text-text-tertiary">步数</div>
                    </div>
                    <div className="w-px bg-border" />
                    <div className="text-center">
                        <div className="text-2xl font-bold text-primary-mint">{optimal}</div>
                        <div className="text-xs text-text-tertiary">最优步数</div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onRetry}
                        className="flex-1 py-2.5 rounded-xl border border-border text-text-secondary text-sm font-medium hover:bg-fill transition-colors flex items-center justify-center gap-1.5"
                    >
                        <RotateCcw size={14} /> 重试
                    </button>
                    {levelIndex < totalLevels - 1 ? (
                        <button
                            onClick={onNext}
                            className="flex-1 py-2.5 rounded-xl bg-gradient-to-b from-primary-mint to-emerald-600 text-white text-sm font-medium hover:opacity-90 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-1.5"
                            style={{ boxShadow: '0 2px 8px rgba(52,211,153,0.35)' }}
                        >
                            下一关 <ChevronRight size={14} />
                        </button>
                    ) : (
                        <button
                            onClick={onRetry}
                            className="flex-1 py-2.5 rounded-xl bg-gradient-to-b from-primary-mint to-emerald-600 text-white text-sm font-medium hover:opacity-90 transition-all"
                        >
                            全部完成！
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Main game component ──────────────────────────────────────────────────────

export const WaterPuzzle: React.FC = () => {
    const [levelIndex, setLevelIndex] = useState(0)
    const level = LEVELS[levelIndex]

    const [jugs, setJugs] = useState<Jug[]>(() => level.initialJugs.map(j => ({ ...j })))
    const [selected, setSelected] = useState<number | null>(null)
    const [moves, setMoves] = useState(0)
    const [won, setWon] = useState(false)
    const [showHint, setShowHint] = useState(false)
    const [animating, setAnimating] = useState<{ from: number; to: number } | null>(null)

    const loadLevel = useCallback((index: number) => {
        setLevelIndex(index)
        setJugs(LEVELS[index].initialJugs.map(j => ({ ...j })))
        setSelected(null)
        setMoves(0)
        setWon(false)
        setShowHint(false)
        setAnimating(null)
    }, [])

    // Reset when level changes from outside (edge case guard)
    useEffect(() => {
        loadLevel(levelIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const applyMove = useCallback((newJugs: Jug[], fromId: number, toId: number) => {
        setAnimating({ from: fromId, to: toId })
        setTimeout(() => setAnimating(null), 600)
        setJugs(newJugs)
        setMoves(m => m + 1)
        if (checkWin(newJugs, LEVELS[levelIndex].goal)) {
            setTimeout(() => setWon(true), 400)
        }
    }, [levelIndex])

    const handleJugClick = useCallback((id: number) => {
        if (won) return
        if (selected === null) {
            setSelected(id)
        } else if (selected === id) {
            setSelected(null)
        } else {
            const result = pourWater(jugs, selected, id)
            if (result) applyMove(result, selected, id)
            setSelected(null)
        }
    }, [won, selected, jugs, applyMove])

    const handleFill = useCallback((id: number) => {
        if (won) return
        const result = fillJug(jugs, id)
        if (result) applyMove(result, -1, id)
        setSelected(null)
    }, [won, jugs, applyMove])

    const handleEmpty = useCallback((id: number) => {
        if (won) return
        const result = emptyJug(jugs, id)
        if (result) applyMove(result, id, -1)
        setSelected(null)
    }, [won, jugs, applyMove])

    const maxCap = useMemo(() => Math.max(...jugs.map(j => j.capacity)), [jugs])
    const PX_PER_LITER = Math.min(180 / maxCap, 22)

    const totalWater = jugs.reduce((s, j) => s + j.current, 0)

    return (
        <div className="h-full overflow-y-auto bg-bg-layout">
            <div className="max-w-2xl mx-auto px-4 py-6 md:py-10">

                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-md">
                            <Droplets size={18} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-base font-bold text-text leading-none">倒水解谜</h1>
                            <p className="text-xs text-text-tertiary mt-0.5">Water Jug Puzzle</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowHint(h => !h)}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                                showHint
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-fill text-text-secondary border-border hover:bg-fill hover:border-border-secondary',
                            )}
                        >
                            <Lightbulb size={13} />
                            提示
                        </button>
                        <button
                            onClick={() => loadLevel(levelIndex)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-text-secondary bg-fill hover:bg-fill transition-colors"
                        >
                            <RotateCcw size={13} />
                            重置
                        </button>
                    </div>
                </div>

                {/* Level selector */}
                <div className="flex gap-2 mb-5">
                    {LEVELS.map((l, i) => (
                        <button
                            key={l.id}
                            onClick={() => loadLevel(i)}
                            className={cn(
                                'flex-1 py-2 px-2 rounded-xl text-xs font-medium border transition-all duration-200',
                                i === levelIndex
                                    ? 'bg-primary-mint/10 text-primary-mint border-primary-mint/30 shadow-sm'
                                    : 'text-text-secondary border-border bg-bg-container hover:bg-fill',
                            )}
                        >
                            <span className="hidden sm:inline">{l.name}</span>
                            <span className="sm:hidden">关卡 {l.id}</span>
                        </button>
                    ))}
                </div>

                {/* Level info card */}
                <div
                    className="bg-bg-container border border-border rounded-xl p-4 mb-6"
                    style={{ boxShadow: 'var(--shadow-soft)' }}
                >
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-sm font-semibold text-text">{level.description}</h2>
                            {level.allowFillEmpty && (
                                <p className="text-xs text-text-tertiary mt-1">
                                    可使用「灌满」「清空」操作
                                </p>
                            )}
                        </div>
                        <div className="text-right shrink-0">
                            <div className="text-2xl font-bold text-text">{moves}</div>
                            <div className="text-[10px] text-text-tertiary">步 / 最优 {level.optimalMoves}</div>
                        </div>
                    </div>

                    {/* Progress bar toward optimal */}
                    <div className="mt-3 h-1 bg-fill rounded-full overflow-hidden">
                        <div
                            className={cn(
                                'h-full rounded-full transition-all duration-500',
                                moves === 0
                                    ? 'w-0'
                                    : moves <= level.optimalMoves
                                        ? 'bg-primary-mint'
                                        : 'bg-warning',
                            )}
                            style={{ width: `${Math.min((moves / (level.optimalMoves * 2)) * 100, 100)}%` }}
                        />
                    </div>
                </div>

                {/* Hint panel */}
                {showHint && (
                    <div
                        className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 animate-slide-up"
                        style={{ boxShadow: 'var(--shadow-soft)' }}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-1.5 text-amber-700 text-xs font-semibold">
                                <Lightbulb size={13} />
                                解题步骤（最优 {level.optimalMoves} 步）
                            </div>
                            <button onClick={() => setShowHint(false)} className="text-amber-400 hover:text-amber-600">
                                <X size={14} />
                            </button>
                        </div>
                        <ol className="space-y-1.5">
                            {level.solutionSteps.map((step, i) => (
                                <li key={i} className="flex gap-2 text-xs text-amber-800">
                                    <span className="shrink-0 w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-[10px] font-bold text-amber-700">
                                        {i + 1}
                                    </span>
                                    {step}
                                </li>
                            ))}
                        </ol>
                    </div>
                )}

                {/* Game area */}
                <div
                    className="bg-bg-container border border-border rounded-2xl p-6 md:p-8 flex items-end justify-center gap-6 md:gap-10 min-h-64"
                    style={{ boxShadow: 'var(--shadow-soft)' }}
                >
                    {jugs.map((jug, i) => (
                        <JugView
                            key={jug.id}
                            jug={jug}
                            goal={level.goal[i] ?? -1}
                            height={Math.round(jug.capacity * PX_PER_LITER)}
                            selected={selected === jug.id}
                            isTarget={selected !== null && selected !== jug.id}
                            animating={
                                animating?.from === jug.id ? 'pour'
                                    : animating?.to === jug.id ? 'receive'
                                        : null
                            }
                            onClick={() => handleJugClick(jug.id)}
                            onFill={level.allowFillEmpty ? () => handleFill(jug.id) : undefined}
                            onEmpty={level.allowFillEmpty ? () => handleEmpty(jug.id) : undefined}
                        />
                    ))}
                </div>

                {/* Instructions */}
                <div className="mt-4 text-center">
                    {selected !== null ? (
                        <p className="text-xs text-primary-mint font-medium animate-pulse">
                            已选择 {level.initialJugs[selected]?.capacity}L 水壶 — 点击另一个水壶倒入 / 再次点击取消
                        </p>
                    ) : (
                        <p className="text-xs text-text-tertiary">
                            点击水壶选择倒水来源，再点击目标水壶完成倒水
                        </p>
                    )}
                    <p className="text-xs text-text-quaternary mt-1">
                        总水量：{totalWater}L
                        {level.goal.some(g => g !== -1) && (
                            <> · 目标：[{level.goal.map(g => g === -1 ? '?' : g).join(', ')}]</>
                        )}
                    </p>
                </div>

                {/* Level navigation */}
                <div className="flex justify-between mt-6">
                    <button
                        onClick={() => levelIndex > 0 && loadLevel(levelIndex - 1)}
                        disabled={levelIndex === 0}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-text-secondary border border-border hover:bg-fill disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft size={15} /> 上一关
                    </button>
                    <button
                        onClick={() => levelIndex < LEVELS.length - 1 && loadLevel(levelIndex + 1)}
                        disabled={levelIndex === LEVELS.length - 1}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-text-secondary border border-border hover:bg-fill disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        下一关 <ChevronRight size={15} />
                    </button>
                </div>
            </div>

            {/* Win overlay */}
            {won && (
                <WinOverlay
                    moves={moves}
                    optimal={level.optimalMoves}
                    levelIndex={levelIndex}
                    totalLevels={LEVELS.length}
                    onNext={() => loadLevel(levelIndex + 1)}
                    onRetry={() => loadLevel(levelIndex)}
                />
            )}
        </div>
    )
}
