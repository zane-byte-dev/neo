import React from 'react'
import {
    fetchSkills,
    fetchSkill,
    createSkill,
    updateSkill,
    deleteSkill,
    toggleSkill,
    type SkillSummary,
    type SkillDetail,
} from '../api'
import { cn } from '../lib/utils'
import { useT } from '../i18n'
import { Zap, Plus, Pencil, Trash2, Tag, ChevronLeft, Loader2, AlertTriangle, Code2, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react'
import { toast } from './Toast'

// ── Default template ──────────────────────────────────────────────────────────

const NEW_SKILL_TEMPLATE = `---
name: my_skill
description: Describe what this skill does
tags: []
---

Write your skill prompt here. Use {{parameter_name}} for template variables.
`

// ── Skill icon ────────────────────────────────────────────────────────────────

const SkillIcon: React.FC<{ name: string; enabled: boolean }> = ({ name, enabled }) => {
    const letter = name.charAt(0).toUpperCase()
    return (
        <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-semibold border',
            enabled
                ? 'bg-fill border-border text-text-secondary'
                : 'bg-fill/50 border-border/50 text-text-quaternary'
        )}>
            {letter}
        </div>
    )
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

const ToggleSwitch: React.FC<{
    enabled: boolean
    loading: boolean
    onChange: (e: React.MouseEvent) => void
}> = ({ enabled, loading, onChange }) => (
    <button
        onClick={onChange}
        disabled={loading}
        className={cn(
            'relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50',
            enabled ? 'bg-emerald-500' : 'bg-border'
        )}
    >
        <span className={cn(
            'inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow transition-transform duration-200',
            enabled ? 'translate-x-[20px]' : 'translate-x-[3px]'
        )}>
            {loading && (
                <svg className="animate-spin absolute inset-0 m-auto" width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
            )}
        </span>
    </button>
)

// ── Skill Row ─────────────────────────────────────────────────────────────────

const SkillRow: React.FC<{
    skill: SkillSummary
    isLast: boolean
    onView: (name: string) => void
    onEdit: (name: string) => void
    onDelete: (name: string) => void
    onToggle: (name: string, enabled: boolean) => void
}> = ({ skill, isLast, onView, onEdit, onDelete, onToggle }) => {
    const t = useT()
    const [toggling, setToggling] = React.useState(false)
    const [showActions, setShowActions] = React.useState(false)
    const [confirmingDelete, setConfirmingDelete] = React.useState(false)

    const handleToggle = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (toggling) return
        setToggling(true)
        try {
            await onToggle(skill.name, !skill.enabled)
        } finally {
            setToggling(false)
        }
    }

    return (
        <div
            className={cn(
                'group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-fill/60 transition-colors',
                !isLast && 'border-b border-border/60',
                !skill.enabled && 'opacity-60'
            )}
            onClick={() => onView(skill.name)}
        >
            {/* Icon */}
            <SkillIcon name={skill.name} enabled={skill.enabled} />

            {/* Name + description */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-text truncate">{skill.name}</span>
                    {skill.hasExecutable && (
                        <span className="shrink-0 text-[9px] px-1 py-px rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium leading-tight">
                            code
                        </span>
                    )}
                </div>
                <p className="text-xs text-text-tertiary truncate mt-0.5 leading-snug">{skill.description}</p>
            </div>

            {/* Hover action buttons */}
            <div
                className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => e.stopPropagation()}
            >
                {showActions ? (
                    <>
                        <button
                            onClick={(e) => { e.stopPropagation(); onEdit(skill.name); setShowActions(false) }}
                            className="p-1.5 rounded-md text-text-tertiary hover:text-text hover:bg-fill transition-colors"
                            title={t('edit')}
                        >
                            <Pencil size={12} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                if (confirmingDelete) {
                                    onDelete(skill.name)
                                } else {
                                    setConfirmingDelete(true)
                                    setTimeout(() => setConfirmingDelete(false), 3000)
                                }
                            }}
                            className={cn(
                                'p-1.5 rounded-md transition-colors text-xs',
                                confirmingDelete
                                    ? 'text-destructive bg-destructive/10'
                                    : 'text-text-tertiary hover:text-destructive hover:bg-destructive/10'
                            )}
                            title={confirmingDelete ? t('skillDeleteConfirm') : t('delete')}
                        >
                            {confirmingDelete ? <span className="text-[10px] font-medium px-0.5">{t('confirm')}</span> : <Trash2 size={12} />}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowActions(false); setConfirmingDelete(false) }}
                            className="p-1.5 rounded-md text-text-quaternary hover:text-text-secondary hover:bg-fill transition-colors text-[11px]"
                        >
                            ✕
                        </button>
                    </>
                ) : (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowActions(true) }}
                        className="p-1.5 rounded-md text-text-quaternary hover:text-text-secondary hover:bg-fill transition-colors"
                        title={t('edit')}
                    >
                        <Pencil size={12} />
                    </button>
                )}
            </div>

            {/* Toggle */}
            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <ToggleSwitch enabled={skill.enabled} loading={toggling} onChange={handleToggle} />
            </div>
        </div>
    )
}

// ── Skill Editor ──────────────────────────────────────────────────────────────

const SkillEditor: React.FC<{
    initialContent: string
    skillName: string | null
    onSave: (rawContent: string) => Promise<void>
    onCancel: () => void
}> = ({ initialContent, skillName, onSave, onCancel }) => {
    const t = useT()
    const [content, setContent] = React.useState(initialContent)
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    React.useEffect(() => {
        textareaRef.current?.focus()
    }, [])

    const handleSave = async () => {
        if (saving) return
        setSaving(true)
        setError(null)
        try {
            await onSave(content)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('skillSaveFailed'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
                <button onClick={onCancel} className="p-1.5 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors">
                    <ChevronLeft size={16} />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-text">
                        {skillName ? t('skillEditTitle', { name: skillName }) : t('skillNewTitle')}
                    </h2>
                    <p className="text-xs text-text-tertiary mt-0.5">{t('skillEditorHint')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text bg-fill hover:bg-border rounded-lg transition-colors">
                        {t('cancel')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary-mint text-white rounded-lg hover:bg-primary-mint/90 disabled:opacity-60 transition-colors"
                    >
                        {saving && <Loader2 size={12} className="animate-spin" />}
                        {t('save')}
                    </button>
                </div>
            </div>
            {error && (
                <div className="mx-6 mt-3 flex items-center gap-2 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2">
                    <AlertTriangle size={13} />
                    {error}
                </div>
            )}
            <div className="flex-1 min-h-0 px-6 py-4">
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full h-full resize-none font-mono text-[13px] bg-bg-container border border-border rounded-xl p-4 text-text placeholder:text-text-quaternary focus:outline-none focus:border-primary-mint/60 focus:ring-1 focus:ring-primary-mint/20 transition-all leading-relaxed custom-scrollbar"
                    spellCheck={false}
                    placeholder={t('skillEditorPlaceholder')}
                />
            </div>
        </div>
    )
}

// ── Detail View ───────────────────────────────────────────────────────────────

const SkillDetailView: React.FC<{
    skill: SkillDetail
    onEdit: () => void
    onBack: () => void
    onDelete: () => void
    onToggle: (enabled: boolean) => Promise<void>
}> = ({ skill, onEdit, onBack, onDelete, onToggle }) => {
    const t = useT()
    const [confirmingDelete, setConfirmingDelete] = React.useState(false)
    const [toggling, setToggling] = React.useState(false)

    const handleToggle = async () => {
        if (toggling) return
        setToggling(true)
        try {
            await onToggle(!skill.enabled)
        } finally {
            setToggling(false)
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
                <button onClick={onBack} className="p-1.5 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors">
                    <ChevronLeft size={16} />
                </button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <Zap size={15} className="text-primary-mint shrink-0" />
                        <h2 className="text-sm font-semibold text-text truncate">{skill.name}</h2>
                        {!skill.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-fill text-text-tertiary">{t('skillDisabled')}</span>
                        )}
                    </div>
                    {skill.version && <p className="text-xs text-text-quaternary mt-0.5">v{skill.version}</p>}
                </div>
                <div className="flex items-center gap-2">
                    <div onClick={(e) => e.stopPropagation()}>
                        <ToggleSwitch enabled={skill.enabled} loading={toggling} onChange={() => handleToggle()} />
                    </div>
                    <button
                        onClick={onEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-fill hover:bg-border text-text-secondary hover:text-text rounded-lg transition-colors"
                    >
                        <Pencil size={12} />
                        {t('edit')}
                    </button>
                    <button
                        onClick={() => { if (confirmingDelete) { onDelete() } else { setConfirmingDelete(true) } }}
                        onBlur={() => setConfirmingDelete(false)}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
                            confirmingDelete ? 'bg-destructive/15 text-destructive font-medium' : 'bg-fill hover:bg-destructive/10 text-text-secondary hover:text-destructive'
                        )}
                    >
                        <Trash2 size={12} />
                        {confirmingDelete ? t('skillDeleteConfirm') : t('delete')}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">
                <div>
                    <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t('skillDescription')}</p>
                    <p className="text-sm text-text-secondary">{skill.description}</p>
                </div>
                {skill.tags.length > 0 && (
                    <div>
                        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t('tags')}</p>
                        <div className="flex flex-wrap gap-1.5">
                            {skill.tags.map((tag) => (
                                <span key={tag} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary-mint/10 text-primary-mint font-medium">
                                    <Tag size={10} />{tag}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                {skill.hasExecutable && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
                        <Code2 size={13} />{t('skillHasCode')}
                    </span>
                )}
                <div>
                    <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t('skillPromptBody')}</p>
                    <pre className="text-xs text-text-secondary bg-bg-container border border-border rounded-xl p-4 whitespace-pre-wrap break-words leading-relaxed font-mono custom-scrollbar overflow-x-auto">
                        {skill.body || <span className="text-text-quaternary">{t('skillNoBody')}</span>}
                    </pre>
                </div>
                {skill.executableBlocks.length > 0 && (
                    <div>
                        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t('skillCodeBlocks')}</p>
                        <div className="space-y-3">
                            {skill.executableBlocks.map((block, i) => (
                                <div key={i} className="bg-bg-container border border-border rounded-xl overflow-hidden">
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-fill border-b border-border">
                                        <Code2 size={12} className="text-text-tertiary" />
                                        <span className="text-[11px] font-mono text-text-secondary">{block.lang}</span>
                                    </div>
                                    <pre className="text-xs p-3 overflow-x-auto font-mono text-text-secondary">{block.code}</pre>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

type PanelView =
    | { kind: 'list' }
    | { kind: 'detail'; name: string }
    | { kind: 'edit'; name: string | null; initialContent: string }

export const SkillsPanel: React.FC = () => {
    const t = useT()
    const [skills, setSkills] = React.useState<SkillSummary[]>([])
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [view, setView] = React.useState<PanelView>({ kind: 'list' })
    const [detailSkill, setDetailSkill] = React.useState<SkillDetail | null>(null)
    const [loadingDetail, setLoadingDetail] = React.useState(false)

    const loadSkills = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetchSkills()
            setSkills(res.skills)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('skillLoadFailed'))
        } finally {
            setLoading(false)
        }
    }, [t])

    React.useEffect(() => { loadSkills() }, [loadSkills])

    const handleToggle = React.useCallback(async (name: string, enabled: boolean) => {
        try {
            await toggleSkill(name, enabled)
            setSkills((prev) => prev.map((s) => s.name === name ? { ...s, enabled } : s))
            setDetailSkill((prev) => prev && prev.name === name ? { ...prev, enabled } : prev)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('skillSaveFailed'))
        }
    }, [t])

    const handleEdit = async (name: string) => {
        setLoadingDetail(true)
        try {
            const detail = await fetchSkill(name)
            setView({ kind: 'edit', name, initialContent: detail.rawContent })
        } catch {
            toast.error(t('skillLoadFailed'))
        } finally {
            setLoadingDetail(false)
        }
    }

    const handleViewDetail = async (name: string) => {
        if (loadingDetail) return
        setLoadingDetail(true)
        try {
            const detail = await fetchSkill(name)
            setDetailSkill(detail)
            setView({ kind: 'detail', name })
        } catch {
            toast.error(t('skillLoadFailed'))
        } finally {
            setLoadingDetail(false)
        }
    }

    const handleDelete = async (name: string) => {
        try {
            await deleteSkill(name)
            toast.success(t('skillDeleted', { name }))
            setView({ kind: 'list' })
            setDetailSkill(null)
            await loadSkills()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('skillDeleteFailed'))
        }
    }

    const handleSave = async (rawContent: string) => {
        if (view.kind !== 'edit') return
        if (view.name === null) {
            const result = await createSkill(rawContent)
            toast.success(t('skillCreated', { name: result.name }))
        } else {
            await updateSkill(view.name, rawContent)
            toast.success(t('skillSaved', { name: view.name }))
        }
        setView({ kind: 'list' })
        await loadSkills()
    }

    if (view.kind === 'edit') {
        return (
            <SkillEditor
                skillName={view.name}
                initialContent={view.initialContent}
                onSave={handleSave}
                onCancel={() => setView({ kind: 'list' })}
            />
        )
    }

    if (view.kind === 'detail' && detailSkill) {
        return (
            <SkillDetailView
                skill={detailSkill}
                onEdit={() => handleEdit(detailSkill.name)}
                onBack={() => setView({ kind: 'list' })}
                onDelete={() => handleDelete(detailSkill.name)}
                onToggle={(enabled) => handleToggle(detailSkill.name, enabled)}
            />
        )
    }

    // ── List view ─────────────────────────────────────────────────────────────
    const enabledSkills = skills.filter((s) => s.enabled)
    const disabledSkills = skills.filter((s) => !s.enabled)

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div>
                    <h1 className="text-base font-semibold text-text">{t('skills')}</h1>
                    <p className="text-xs text-text-tertiary mt-0.5">{t('skillsSubtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadSkills}
                        disabled={loading}
                        className="p-2 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors disabled:opacity-50"
                        title={t('refresh')}
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setView({ kind: 'edit', name: null, initialContent: NEW_SKILL_TEMPLATE })}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary-mint text-white rounded-lg hover:bg-primary-mint/90 transition-colors"
                    >
                        <Plus size={13} />
                        {t('skillNew')}
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">
                {loading && (
                    <div className="flex items-center justify-center py-16 text-text-tertiary">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                )}

                {error && !loading && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <AlertTriangle size={24} className="text-text-quaternary mb-3" />
                        <p className="text-sm text-text-tertiary">{error}</p>
                        <button onClick={loadSkills} className="mt-3 text-xs text-primary-mint hover:underline">{t('retry')}</button>
                    </div>
                )}

                {!loading && !error && skills.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-fill flex items-center justify-center mb-4">
                            <Zap size={22} className="text-text-quaternary" />
                        </div>
                        <p className="text-sm font-medium text-text-secondary mb-1">{t('skillsEmpty')}</p>
                        <p className="text-xs text-text-tertiary max-w-xs">{t('skillsEmptyHint')}</p>
                        <button
                            onClick={() => setView({ kind: 'edit', name: null, initialContent: NEW_SKILL_TEMPLATE })}
                            className="mt-4 flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-primary-mint text-white rounded-lg hover:bg-primary-mint/90 transition-colors"
                        >
                            <Plus size={13} />
                            {t('skillNew')}
                        </button>
                    </div>
                )}

                {!loading && !error && skills.length > 0 && (
                    <>
                        {/* Enabled group */}
                        {enabledSkills.length > 0 && (
                            <section>
                                <p className="text-[11px] font-medium text-text-quaternary uppercase tracking-wider mb-2 px-1">
                                    {t('skillEnabledGroup')} {enabledSkills.length}
                                </p>
                                <div className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                                    {enabledSkills.map((skill, i) => (
                                        <SkillRow
                                            key={skill.name}
                                            skill={skill}
                                            isLast={i === enabledSkills.length - 1}
                                            onView={handleViewDetail}
                                            onEdit={handleEdit}
                                            onDelete={handleDelete}
                                            onToggle={handleToggle}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Disabled group */}
                        {disabledSkills.length > 0 && (
                            <section>
                                <p className="text-[11px] font-medium text-text-quaternary uppercase tracking-wider mb-2 px-1">
                                    {t('skillDisabledGroup')} {disabledSkills.length}
                                </p>
                                <div className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                                    {disabledSkills.map((skill, i) => (
                                        <SkillRow
                                            key={skill.name}
                                            skill={skill}
                                            isLast={i === disabledSkills.length - 1}
                                            onView={handleViewDetail}
                                            onEdit={handleEdit}
                                            onDelete={handleDelete}
                                            onToggle={handleToggle}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

