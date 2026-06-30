import React from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Search } from 'lucide-react'
import { t } from '../../i18n'
import { cn } from '../../lib/utils'

const COMMON_MODEL_ALIASES = ['deepseek', 'deepseek-reasoner']

const MODEL_PRESENTATION: Record<string, { label: string; badge?: string }> = {
    deepseek: { label: 'DeepSeek Chat', badge: 'DeepSeek' },
    'deepseek-chat': { label: 'DeepSeek Chat', badge: 'DeepSeek' },
    'deepseek-reasoner': { label: 'DeepSeek Reasoner', badge: 'DeepSeek' },
    gemma: { label: 'Gemma', badge: 'Local' },
    'gemini-acp': { label: 'Gemini CLI', badge: 'CLI' },
    gpt: { label: 'GPT-4o', badge: 'OpenAI' },
    'gpt-4o': { label: 'GPT-4o', badge: 'OpenAI' },
    'gpt-4o-mini': { label: 'GPT-4o mini', badge: 'OpenAI' },
    'gpt-5': { label: 'GPT-5', badge: 'OpenAI' },
    'gpt-5-mini': { label: 'GPT-5 mini', badge: 'OpenAI' },
    claude: { label: 'Claude Sonnet', badge: 'Anthropic' },
    'claude-sonnet': { label: 'Claude Sonnet', badge: 'Anthropic' },
    'claude-opus': { label: 'Claude Opus', badge: 'Anthropic' },
    'claude-haiku': { label: 'Claude Haiku', badge: 'Anthropic' },
}

function titleizeAlias(alias: string): string {
    return alias
        .split('-')
        .map((part) => {
            if (!part) return part
            if (/^\d/.test(part)) return part.toUpperCase()
            return part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`
        })
        .join(' ')
}

function inferModelBadge(alias: string): string | undefined {
    if (alias === 'gemma') return 'Local'
    if (alias === 'gemini-acp') return 'CLI'
    if (alias.startsWith('gemini-')) return 'Google'
    if (alias === 'deepseek' || alias.startsWith('deepseek-')) return 'DeepSeek'
    if (alias === 'gpt' || alias.startsWith('gpt-')) return 'OpenAI'
    if (alias === 'claude' || alias.startsWith('claude-')) return 'Anthropic'
    return undefined
}

function getModelPresentation(alias: string): { label: string; subtitle: string; badge?: string } {
    if (alias === 'auto') {
        return { label: 'Auto', subtitle: t('smartRouting') }
    }
    const preset = MODEL_PRESENTATION[alias]
    return {
        label: preset?.label ?? titleizeAlias(alias),
        subtitle: alias,
        badge: preset?.badge ?? inferModelBadge(alias),
    }
}

type ModelPickerProps = {
    selectedModel: string
    onSelect: (model: string) => void
    availableModels: string[]
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ selectedModel, onSelect, availableModels }) => {
    const triggerRef = React.useRef<HTMLButtonElement>(null)
    const panelRef = React.useRef<HTMLDivElement>(null)
    const searchRef = React.useRef<HTMLInputElement>(null)
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [showOtherModels, setShowOtherModels] = React.useState(false)
    const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({})

    const commonModels = React.useMemo(() => {
        const set = new Set(availableModels)
        return COMMON_MODEL_ALIASES.filter((alias) => set.has(alias))
    }, [availableModels])

    const uncommonModels = React.useMemo(
        () => availableModels.filter((alias) => !COMMON_MODEL_ALIASES.includes(alias)),
        [availableModels],
    )

    const selectedPresentation = React.useMemo(
        () => getModelPresentation(selectedModel === 'auto' ? 'auto' : selectedModel),
        [selectedModel],
    )

    const updatePanelPosition = React.useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return
        const width = Math.min(272, window.innerWidth - 12)
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
        const bottom = Math.max(10, window.innerHeight - rect.top + 8)
        setPanelStyle({
            position: 'fixed',
            left,
            bottom,
            width,
        })
    }, [])

    React.useLayoutEffect(() => {
        if (!open) return
        updatePanelPosition()
    }, [open, updatePanelPosition])

    React.useEffect(() => {
        if (!open) return
        const handleViewportChange = () => updatePanelPosition()
        window.addEventListener('resize', handleViewportChange)
        window.addEventListener('scroll', handleViewportChange, true)
        return () => {
            window.removeEventListener('resize', handleViewportChange)
            window.removeEventListener('scroll', handleViewportChange, true)
        }
    }, [open, updatePanelPosition])

    React.useEffect(() => {
        if (!open) {
            setQuery('')
            return
        }
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node
            if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
            setOpen(false)
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open])

    React.useEffect(() => {
        if (!open) return
        if (selectedModel !== 'auto' && uncommonModels.includes(selectedModel)) {
            setShowOtherModels(true)
        }
        searchRef.current?.focus()
    }, [open, selectedModel, uncommonModels])

    const normalizedQuery = query.trim().toLowerCase()

    const matchesQuery = React.useCallback((alias: string) => {
        if (!normalizedQuery) return true
        const presentation = getModelPresentation(alias)
        return [presentation.label, presentation.subtitle, presentation.badge, alias]
            .filter((value): value is string => typeof value === 'string')
            .some((value) => value.toLowerCase().includes(normalizedQuery))
    }, [normalizedQuery])

    const filteredCommon = commonModels.filter(matchesQuery)
    const filteredOther = uncommonModels.filter(matchesQuery)
    const showExpandedOther = showOtherModels || Boolean(normalizedQuery)
    const hasMatchedModels = filteredCommon.length > 0 || filteredOther.length > 0 || 'auto'.includes(normalizedQuery)

    const renderOption = (alias: string) => {
        const presentation = getModelPresentation(alias)
        const isSelected = selectedModel === alias
        return (
            <button
                key={alias}
                type="button"
                onClick={() => {
                    onSelect(alias)
                    setOpen(false)
                }}
                className={cn(
                    'w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all duration-150 cursor-pointer',
                    isSelected
                        ? 'bg-fill text-text shadow-sm'
                        : 'text-text-secondary hover:bg-fill-secondary/90'
                )}
            >
                <div className="w-3 shrink-0 flex items-center justify-center">
                    {isSelected ? (
                        <CheckCircle2 size={12} className="text-primary-mint" />
                    ) : (
                        <Circle size={9} className="text-text-quaternary" />
                    )}
                </div>
                <div className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[18px] text-text">
                    {presentation.label}
                </div>
                {presentation.badge && (
                    <span className={cn(
                        'shrink-0 rounded-full border px-1.25 py-0.5 text-[8px] font-medium leading-none',
                        isSelected
                            ? 'border-primary-mint/30 bg-primary-mint/10 text-primary-mint'
                            : 'border-border bg-fill-secondary/70 text-text-tertiary'
                    )}>
                        {presentation.badge}
                    </span>
                )}
            </button>
        )
    }

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    if (!open) updatePanelPosition()
                    setOpen((value) => !value)
                }}
                className={cn(
                    'group flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-all duration-150 cursor-pointer shrink-0 min-w-0',
                    open
                        ? 'border-primary-mint/35 bg-fill text-text'
                        : 'border-transparent bg-fill/60 text-text-secondary hover:border-border hover:bg-fill'
                )}
                style={{ boxShadow: open ? 'var(--shadow-soft)' : undefined }}
            >
                <div className="min-w-0 max-w-[112px]">
                    <div className="truncate text-[11px] font-medium leading-4">{selectedPresentation.label}</div>
                </div>
                <ChevronDown size={12} className={cn('shrink-0 transition-transform duration-150', open && 'rotate-180')} />
            </button>

            {open && typeof document !== 'undefined' && createPortal(
                <div
                    ref={panelRef}
                    className="glass z-[120] overflow-hidden rounded-[3px] border border-border bg-bg-elevated/95"
                    style={{ ...panelStyle, boxShadow: 'var(--shadow-float)' }}
                >
                    <div className="border-b border-border/80 px-2 py-2">
                        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-fill-secondary/85 px-2 py-1.5">
                            <Search size={12} className="shrink-0 text-text-quaternary" />
                            <input
                                ref={searchRef}
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={t('searchModels')}
                                className="w-full bg-transparent text-[11px] text-text placeholder:text-text-quaternary focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="max-h-[min(48vh,18rem)] overflow-y-auto custom-scrollbar p-1.5">
                        {(!normalizedQuery || 'auto'.includes(normalizedQuery)) && renderOption('auto')}

                        {filteredCommon.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                                {filteredCommon.map((alias) => renderOption(alias))}
                            </div>
                        )}

                        {uncommonModels.length > 0 && (
                            <div className="mt-2 border-t border-border/70 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowOtherModels((value) => !value)}
                                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.25 text-left text-[10px] font-medium text-text-secondary hover:bg-fill-secondary/80 transition-colors cursor-pointer"
                                >
                                    <ChevronRight size={12} className={cn('transition-transform duration-150', showExpandedOther && 'rotate-90')} />
                                    <span>{t('otherModels')}</span>
                                    <span className="ml-auto rounded-full bg-fill px-1.5 py-0.5 text-[9px] text-text-tertiary">{filteredOther.length || uncommonModels.length}</span>
                                </button>

                                {showExpandedOther && filteredOther.length > 0 && (
                                    <div className="mt-1 space-y-0.5">
                                        {filteredOther.map((alias) => renderOption(alias))}
                                    </div>
                                )}
                            </div>
                        )}

                        {!hasMatchedModels && (
                            <div className="px-3 py-5 text-center text-[11px] text-text-tertiary">
                                {t('noMatchingModels')}
                            </div>
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </>
    )
}
