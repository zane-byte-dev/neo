import React from 'react'
import {
    fetchSkills,
    fetchSkill,
    createSkill,
    updateSkill,
    deleteSkill,
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

// ── Skill Card ────────────────────────────────────────────────────────────────

const SkillCard: React.FC<{
    skill: SkillSummary
    onEdit: (name: string) => void
    onDelete: (name: string) => void
}> = ({ skill, onEdit, onDelete }) => {
    const t = useT()
    const [confirmingDelete, setConfirmingDelete] = React.useState(false)

    const handleDeleteClick = () => {
        if (confirmingDelete) {
            onDelete(skill.name)
            setConfirmingDelete(false)
        } else {
            setConfirmingDelete(true)
        }
    }

    return (
        <div
            className={cn(
                'bg-bg-container border border-border rounded-xl p-4 transition-all duration-200',
                'hover:border-primary-mint/40',
                !skill.enabled && 'opacity-60',
            )}
            style={{ boxShadow: 'var(--shadow-soft)' }}
        >
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Zap size={15} className={cn('shrink-0', skill.enabled ? 'text-primary-mint' : 'text-text-quaternary')} />
                    <h3 className="text-sm font-semibold text-text truncate">{skill.name}</h3>
                    {!skill.enabled && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-fill text-text-tertiary">
                            {t('skillDisabled')}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => onEdit(skill.name)}
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors"
                        title={t('edit')}
                    >
                        <Pencil size={13} />
                    </button>
                    <button
                        onClick={handleDeleteClick}
                        onBlur={() => setConfirmingDelete(false)}
                        className={cn(
                            'p-1.5 rounded-lg transition-colors',
                            confirmingDelete
                                ? 'bg-destructive/15 text-destructive'
                                : 'text-text-tertiary hover:text-destructive hover:bg-destructive/10'
                        )}
                        title={confirmingDelete ? t('skillDeleteConfirm') : t('delete')}
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            </div>

            <p className="text-xs text-text-secondary mb-3 leading-relaxed line-clamp-2">{skill.description}</p>

            <div className="flex flex-wrap items-center gap-1.5">
                {skill.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary-mint/10 text-primary-mint font-medium">
                        <Tag size={9} />
                        {tag}
                    </span>
                ))}
                {skill.hasExecutable && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
                        <Code2 size={9} />
                        {t('skillHasCode')}
                    </span>
                )}
                {skill.version && (
                    <span className="text-[10px] text-text-quaternary ml-auto">v{skill.version}</span>
                )}
            </div>
        </div>
    )
}

// ── Skill Editor ──────────────────────────────────────────────────────────────

const SkillEditor: React.FC<{
    initialContent: string
    skillName: string | null  // null = new skill
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
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
                <button
                    onClick={onCancel}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors"
                >
                    <ChevronLeft size={16} />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-text">
                        {skillName ? t('skillEditTitle', { name: skillName }) : t('skillNewTitle')}
                    </h2>
                    <p className="text-xs text-text-tertiary mt-0.5">{t('skillEditorHint')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs text-text-secondary hover:text-text bg-fill hover:bg-border rounded-lg transition-colors"
                    >
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

            {/* Error */}
            {error && (
                <div className="mx-6 mt-3 flex items-center gap-2 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2">
                    <AlertTriangle size={13} />
                    {error}
                </div>
            )}

            {/* Editor */}
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
}> = ({ skill, onEdit, onBack, onDelete }) => {
    const t = useT()
    const [confirmingDelete, setConfirmingDelete] = React.useState(false)

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
                <button
                    onClick={onBack}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors"
                >
                    <ChevronLeft size={16} />
                </button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <Zap size={15} className="text-primary-mint shrink-0" />
                        <h2 className="text-sm font-semibold text-text truncate">{skill.name}</h2>
                        {!skill.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-fill text-text-tertiary">
                                {t('skillDisabled')}
                            </span>
                        )}
                    </div>
                    {skill.version && (
                        <p className="text-xs text-text-quaternary mt-0.5">v{skill.version}</p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-fill hover:bg-border text-text-secondary hover:text-text rounded-lg transition-colors"
                    >
                        <Pencil size={12} />
                        {t('edit')}
                    </button>
                    <button
                        onClick={() => {
                            if (confirmingDelete) {
                                onDelete()
                            } else {
                                setConfirmingDelete(true)
                            }
                        }}
                        onBlur={() => setConfirmingDelete(false)}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
                            confirmingDelete
                                ? 'bg-destructive/15 text-destructive font-medium'
                                : 'bg-fill hover:bg-destructive/10 text-text-secondary hover:text-destructive'
                        )}
                    >
                        <Trash2 size={12} />
                        {confirmingDelete ? t('skillDeleteConfirm') : t('delete')}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">
                {/* Description */}
                <div>
                    <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t('skillDescription')}</p>
                    <p className="text-sm text-text-secondary">{skill.description}</p>
                </div>

                {/* Tags */}
                {skill.tags.length > 0 && (
                    <div>
                        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t('tags')}</p>
                        <div className="flex flex-wrap gap-1.5">
                            {skill.tags.map((tag) => (
                                <span key={tag} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary-mint/10 text-primary-mint font-medium">
                                    <Tag size={10} />
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Status */}
                <div className="flex items-center gap-3">
                    {skill.enabled ? (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                            <ToggleRight size={15} />
                            {t('skillEnabled')}
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5 text-xs text-text-quaternary">
                            <ToggleLeft size={15} />
                            {t('skillDisabled')}
                        </span>
                    )}
                    {skill.hasExecutable && (
                        <span className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
                            <Code2 size={13} />
                            {t('skillHasCode')}
                        </span>
                    )}
                </div>

                {/* Prompt body */}
                <div>
                    <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t('skillPromptBody')}</p>
                    <pre className="text-xs text-text-secondary bg-bg-container border border-border rounded-xl p-4 whitespace-pre-wrap break-words leading-relaxed font-mono custom-scrollbar overflow-x-auto">
                        {skill.body || <span className="text-text-quaternary">{t('skillNoBody')}</span>}
                    </pre>
                </div>

                {/* Executable blocks */}
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

    React.useEffect(() => {
        loadSkills()
    }, [loadSkills])

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
            // Create
            const result = await createSkill(rawContent)
            toast.success(t('skillCreated', { name: result.name }))
        } else {
            // Update
            await updateSkill(view.name, rawContent)
            toast.success(t('skillSaved', { name: view.name }))
        }
        setView({ kind: 'list' })
        await loadSkills()
    }

    // ── Render views ─────────────────────────────────────────────────────────

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
            />
        )
    }

    // List view
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
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
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
                        {/* Summary bar */}
                        <div className="flex items-center gap-3 mb-4 text-xs text-text-tertiary">
                            <span>{t('skillCount', { n: skills.length })}</span>
                            <span>·</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                                {skills.filter(s => s.enabled).length} {t('skillEnabledCount')}
                            </span>
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {skills.map((skill) => (
                                <div
                                    key={skill.name}
                                    onClick={() => !loadingDetail && handleViewDetail(skill.name)}
                                    className="cursor-pointer"
                                >
                                    <SkillCard
                                        skill={skill}
                                        onEdit={(name) => { handleEdit(name) }}
                                        onDelete={handleDelete}
                                    />
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
