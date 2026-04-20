const en = {
    // Common
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    confirm: 'Confirm',

    // Sidebar
    newChat: 'New Chat',
    searchChats: 'Search chats…',
    noMatchingChats: 'No matching chats',
    noChatsYet: 'No chats yet',
    startNewConversation: 'Start a new conversation',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeClassicDark: 'Classic Dark',
    signOut: 'Sign out',
    pinUnpin: 'Pin / Unpin',
    rename: 'Rename',
    notebook: 'Notebook',
    apps: 'Apps',
    puzzle: 'Puzzle',
    deleteChat: 'Delete Chat',
    deleteChatConfirm: 'Are you sure you want to delete this chat? This action cannot be undone.',
    renameChat: 'Rename Chat',
    language: 'Language',

    // ChatArea
    thinking: 'Thinking…',
    working: 'Working…',
    toolCall: '{n} tool call',
    toolCalls: '{n} tool calls',
    tasks: 'Tasks',
    askAnything: 'Ask anything… (Shift+Enter for newline)',
    uploadImage: 'Upload image',
    attachFile: 'Attach file (PDF, Word, Excel…)',
    autoSpeakOn: 'Turn off auto speak',
    autoSpeakOff: 'Turn on auto speak',
    pressEscToStop: 'Press Esc to stop',
    stopEsc: 'Stop (Esc)',
    sendEnter: 'Send (Enter)',
    uploading: 'Uploading…',
    welcome: 'Welcome',
    exportMarkdown: 'Export as Markdown',
    thinkingLabel: '💭 Thinking',
    generatedImage: 'Generated image',
    download: 'Download',
    requestFailed: 'Request failed',
    you: '**You**',
    neo: '**Neo**',
    enterToSend: 'to send',
    shiftEnterNewline: 'newline',
    newChatShortcut: 'new chat',

    // WelcomeScreen
    neoTitle: 'Neo',
    welcomeSubtitle: 'Your local AI assistant with access to tools, files, and your knowledge base.',
    startConversation: 'Start a conversation',
    browseKnowledgeBase: 'Browse knowledge base',

    // Login
    enterAccessToken: 'Enter your access token',
    accessToken: 'Access token',
    cannotReachServer: 'Cannot reach server. Is the backend running?',
    invalidToken: 'Invalid token.',
    signIn: 'Sign in',

    // NotebookPanel
    allFilter: 'All',
    searchNotes: 'Search notes…',
    noResults: 'No results',
    noEntries: 'No entries',
    selectArticle: 'Select an article to read',
    newArticle: 'New article',
    edit: 'Edit',

    // NoteEditor
    meta: 'Meta',
    articleTitle: 'Article title…',
    confirmDelete: 'Confirm delete',
    saving: 'Saving…',
    preview: 'Preview',
    author: 'Author',
    date: 'Date',
    source: 'Source',
    tags: 'Tags',
    tagsPlaceholder: 'JSON e.g. ["tag1","tag2"]',
    summary: 'Summary',
} as const

export default en
export type TranslationKeys = keyof typeof en
