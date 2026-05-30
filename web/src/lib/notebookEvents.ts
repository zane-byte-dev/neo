export const NOTEBOOK_ARTICLE_DELETED_EVENT = 'neo:notebook-article-deleted'

export interface NotebookArticleDeletedDetail {
    id: string
}

export function notifyNotebookArticleDeleted(id: string) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<NotebookArticleDeletedDetail>(NOTEBOOK_ARTICLE_DELETED_EVENT, {
        detail: { id },
    }))
}

export function getNotebookArticleDeletedDetail(event: Event): NotebookArticleDeletedDetail | null {
    const detail = (event as CustomEvent<Partial<NotebookArticleDeletedDetail>>).detail
    if (!detail || typeof detail.id !== 'string' || !detail.id) return null
    return { id: detail.id }
}