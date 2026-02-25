import { GoogleGenerativeAI, FunctionDeclaration, SchemaType, ChatSession } from "@google/generative-ai";
import { invoke } from "@tauri-apps/api/core";

export const sentinelToolDeclarations: FunctionDeclaration[] = [
    {
        name: "append_diary_entry",
        description:
            "Append a new entry to today's diary. Forces writing under specific sections like '流水' or '深度思考' without overwriting existing content. Use this to safely log information for the user.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                section: {
                    type: SchemaType.STRING,
                    description: "The targeted section to append to. Must contain '流水' (streams of events) or '深度思考' (deep thoughts).",
                },
                content: {
                    type: SchemaType.STRING,
                    description: "The markdown content to append. Should be concise and use bullet points.",
                },
                dateOverride: {
                    type: SchemaType.STRING,
                    description: "Optional. 'YYYY-MM-DD' if you need to append to a specific past date. Defaults to today.",
                },
            },
            required: ["section", "content"],
        },
    },
    {
        name: "read_markdown_file",
        description: "Read the content of a markdown file from the knowledge base safely. Provide a relative path like 'history/2026-02-24.md' or 'system/skill/写日记.md'.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                relativePath: {
                    type: SchemaType.STRING,
                    description: "Relative path to the markdown file from the root vault workspace.",
                },
            },
            required: ["relativePath"],
        },
    },
    {
        name: "search_files",
        description: "Search for markdown files in the workspace by filename or keyword in filename. Use this when you don't know the exact relative path.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: {
                    type: SchemaType.STRING,
                    description: "The keyword or filename to search for (e.g., 'tasks', 'dashboard').",
                },
            },
            required: ["query"],
        },
    }
];

export class GeminiClient {
    private genAI: GoogleGenerativeAI;
    private chatSession: ChatSession | null = null;
    private systemInstruction: string = "You are Neo Sentinel, a helpful assistant managing the user's Markdown vault. Be concise and practical.";

    constructor(apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async setSystemInstruction() {
        try {
            // Try to load user's custom system prompt if available
            const content = await invoke<string>("read_markdown_file", { relativePath: "system/GEMINI.md" });
            if (content) {
                this.systemInstruction = content;
            }
        } catch (e) {
            console.log("No custom system/GEMINI.md found, using default.");
        }
    }

    async initChat(history: any[] = []) {
        await this.setSystemInstruction();

        const model = this.genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: this.systemInstruction,
            tools: [{ functionDeclarations: sentinelToolDeclarations }],
        });

        this.chatSession = model.startChat({ history });
    }

    async sendMessage(msg: string, onUpdate: (text: string) => void) {
        if (!this.chatSession) throw new Error("Chat session not initialized");

        const result = await this.chatSession.sendMessageStream(msg);
        let fullText = "";

        for await (const chunk of result.stream) {
            const calls = typeof chunk.functionCalls === 'function' ? chunk.functionCalls() : chunk.functionCalls;
            if (calls && calls.length > 0) {
                const call = calls[0];
                onUpdate(`> Using tool: ${call.name}...`);

                let toolResultStr = "";
                try {
                    if (call.name === "read_markdown_file") {
                        const res = await invoke("read_markdown_file", { relativePath: (call.args as any).relativePath });
                        toolResultStr = JSON.stringify({ content: res });
                    } else if (call.name === "search_files") {
                        const res = await invoke("search_files", { query: (call.args as any).query });
                        toolResultStr = JSON.stringify(res);
                    } else if (call.name === "append_diary_entry") {
                        const args = call.args as any;
                        const res = await invoke("append_diary_entry", {
                            section: args.section,
                            content: args.content,
                            dateOverride: args.dateOverride || null
                        });
                        toolResultStr = JSON.stringify({ success: res });
                    } else {
                        toolResultStr = JSON.stringify({ error: "Unknown tool" });
                    }
                } catch (e: any) {
                    toolResultStr = JSON.stringify({ error: e.toString() });
                }

                const toolResponseResult = await this.chatSession.sendMessageStream([{
                    functionResponse: {
                        name: call.name,
                        response: JSON.parse(toolResultStr) // Gemini API needs an object here
                    }
                }]);

                for await (const toolChunk of toolResponseResult.stream) {
                    fullText += toolChunk.text() || "";
                    onUpdate(fullText);
                }

            } else {
                fullText += chunk.text() || "";
                onUpdate(fullText);
            }
        }

        return fullText;
    }
}
