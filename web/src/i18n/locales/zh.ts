import type { TranslationKeys } from './en'

const zh: Record<TranslationKeys, string> = {
    // Common
    cancel: '取消',
    save: '保存',
    delete: '删除',
    confirm: '确认',

    // Sidebar
    newChat: '新对话',
    searchChats: '搜索对话…',
    noMatchingChats: '没有匹配的对话',
    noChatsYet: '暂无对话',
    startNewConversation: '开始一段新对话',
    theme: '主题',
    themeLight: '浅色',
    themeDark: '深色',
    themeClassicDark: '经典深色',
    signOut: '退出登录',
    pinUnpin: '置顶 / 取消置顶',
    rename: '重命名',
    notebook: '笔记本',
    apps: '应用',
    puzzle: '水壶谜题',
    deleteChat: '删除对话',
    deleteChatConfirm: '确定要删除这个对话吗？此操作无法撤销。',
    renameChat: '重命名对话',
    language: '语言',

    // ChatArea
    thinking: '思考中…',
    working: '处理中…',
    toolCall: '{n} 次工具调用',
    toolCalls: '{n} 次工具调用',
    tasks: '任务',
    askAnything: '随便问点什么… (Shift+Enter 换行)',
    uploadImage: '上传图片',
    attachFile: '上传文件 (PDF, Word, Excel…)',
    autoSpeakOn: '关闭自动朗读',
    autoSpeakOff: '开启自动朗读',
    pressEscToStop: '按 Esc 停止',
    stopEsc: '停止 (Esc)',
    sendEnter: '发送 (Enter)',
    uploading: '上传中…',
    welcome: '欢迎',
    exportMarkdown: '导出 Markdown',
    thinkingLabel: '💭 思考过程',
    generatedImage: '生成的图片',
    download: '下载',
    requestFailed: '请求失败',
    you: '**你**',
    neo: '**Neo**',
    enterToSend: '发送',
    shiftEnterNewline: '换行',
    newChatShortcut: '新对话',

    // WelcomeScreen
    neoTitle: 'Neo',
    welcomeSubtitle: '你的本地 AI 助手，可使用工具、文件和知识库。',
    startConversation: '开始对话',
    browseKnowledgeBase: '浏览知识库',

    // Login
    enterAccessToken: '请输入访问令牌',
    accessToken: '访问令牌',
    cannotReachServer: '无法连接服务器，请确认后端是否在运行。',
    invalidToken: '令牌无效。',
    signIn: '登录',

    // NotebookPanel
    allFilter: '全部',
    searchNotes: '搜索笔记…',
    noResults: '没有结果',
    noEntries: '暂无条目',
    selectArticle: '选择一篇文章阅读',
    newArticle: '新建文章',
    edit: '编辑',

    // NoteEditor
    meta: '元信息',
    articleTitle: '文章标题…',
    confirmDelete: '确认删除',
    saving: '保存中…',
    preview: '预览',
    author: '作者',
    date: '日期',
    source: '来源',
    tags: '标签',
    tagsPlaceholder: 'JSON 如 ["标签1","标签2"]',
    summary: '摘要',
}

export default zh
