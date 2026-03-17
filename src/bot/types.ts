export interface Task {
    chatId: number;
    question: string;
    userName: string;
    messageId: number;
    imagePath?: string;
    imageMimeType?: string;
    fileUri?: string;
    fileMimeType?: string;
    skipHistory?: boolean;
}
