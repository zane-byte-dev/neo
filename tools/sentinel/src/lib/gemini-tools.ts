import { FunctionDeclaration, Schema, SchemaType } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";

// Define the schema for our agentic tools
export const sentinelToolDeclarations: FunctionDeclaration[] = [
    {
        name: "append_diary_entry",
        description: "Append a new entry to today's diary. Forces writing under specific sections like '流水' or '深度思考' without overwriting existing content. Use this to safely log information for the user.",
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
                }
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
                }
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
                }
            },
            required: ["query"],
        },
    }
];

// Implementation of the tools
export class SentinelToolExecutor {
    private workDir: string;

    constructor(workDir: string) {
        this.workDir = workDir;
    }

    private getTodayString(): string {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    async executeToolCall(functionName: string, args: any): Promise<any> {
        try {
            switch (functionName) {
                case "read_markdown_file":
                    return await this.readMarkdownFile(args.relativePath);
                case "search_files":
                    return await this.searchFiles(args.query);
                case "append_diary_entry":
                    return await this.appendDiaryEntry(args.section, args.content, args.dateOverride);
                default:
                    return { error: `Function ${functionName} not found or supported.` };
            }
        } catch (error: any) {
            console.error(`[ToolExecutor] Error running ${functionName}:`, error);
            return { error: error.message };
        }
    }

    private async readMarkdownFile(relativePath: string): Promise<any> {
        // Security check: prevent directory traversal
        const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
        const targetPath = path.join(this.workDir, normalizedPath);

        if (!targetPath.startsWith(this.workDir)) {
            return { error: "Security violation: Path traversal prevented." };
        }

        try {
            const content = await fs.readFile(targetPath, 'utf-8');
            return { content };
        } catch (error: any) {
            return { error: `Failed to read file: ${error.message}. TIP: You might want to use 'search_files' tool to find the correct path first.` };
        }
    }

    private async searchFiles(query: string): Promise<any> {
        if (!query || query.trim().length === 0) {
            return { error: "Search query cannot be empty." };
        }

        const excludeDirs = ['.git', 'node_modules', 'dist', 'node_modules', '.obsidian'];
        const results: string[] = [];
        const self = this;

        async function walk(dir: string) {
            let entries;
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch (err) {
                return; // Suppress permission/access errors gracefully
            }

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                        await walk(path.join(dir, entry.name));
                    }
                } else if (entry.name.endsWith('.md')) {
                    if (entry.name.toLowerCase().includes(query.toLowerCase())) {
                        results.push(path.relative(self.workDir, path.join(dir, entry.name)));
                    }
                }
            }
        }

        try {
            await walk(this.workDir);

            if (results.length === 0) {
                return { error: `No markdown files found whose names contain '${query}'` };
            }

            // Limit to top 20 to avoid exceeding context window
            return {
                matches: results.slice(0, 20),
                totalFound: results.length,
            };
        } catch (error: any) {
            return { error: `Search failed: ${error.message}` };
        }
    }

    private async appendDiaryEntry(section: string, content: string, dateOverride?: string): Promise<any> {
        const targetDate = dateOverride || this.getTodayString();
        const targetPath = path.join(this.workDir, 'history', `${targetDate}.md`);

        let fileContent = "";
        try {
            fileContent = await fs.readFile(targetPath, 'utf-8');
        } catch (e) {
            // File doesn't exist, create skeleton
            fileContent = `# 📝 ${targetDate}\n\n## 🟢 流水\n\n## 🧠 深度思考\n\n## 🍎 知识增量\n`;
        }

        let targetHeader = "";
        if (section.includes('流水')) {
            targetHeader = '## 🟢 流水';
        } else if (section.includes('思考') || section.includes('深度思考')) {
            targetHeader = '## 🧠 深度思考';
        }

        if (!targetHeader) {
            return { error: `Invalid section '${section}'. Must contain '流水' or '深度思考'` };
        }

        // Find where to inject
        const headerIndex = fileContent.indexOf(targetHeader);
        if (headerIndex !== -1) {
            // Inject right below the target header (plus a newline)
            const injectionPoint = headerIndex + targetHeader.length + 1;

            // Format content properly for injection (bullet point logic enforced)
            let formattedContent = content;
            if (!content.trim().startsWith('-')) {
                formattedContent = `- > *(AI 整理，非原话)*\n\n- ${content}`;
            } else {
                formattedContent = `> *(AI 整理，非原话)*\n\n${content}`;
            }

            const newContent = fileContent.slice(0, injectionPoint) +
                formattedContent + '\n\n' +
                fileContent.slice(injectionPoint);

            await fs.writeFile(targetPath, newContent, 'utf-8');
            return { success: true, message: `Successfully appended to ${targetDate}.md under ${section}.` };
        } else {
            return { error: `Could not find section '${section}' in today's diary layout.` };
        }
    }
}
