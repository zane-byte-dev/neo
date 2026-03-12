"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const server = new index_js_1.Server({
    name: "memory-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
const ARCHIVE_SESSION_SCHEMA = zod_1.z.object({
    sessionPath: zod_1.z.string().describe("Path to the session JSON file"),
    projectDir: zod_1.z.string().optional().describe("Project root directory"),
});
const UPDATE_GRAMMAR_LOG_SCHEMA = zod_1.z.object({
    sessionPath: zod_1.z.string().describe("Path to the session JSON file"),
    projectDir: zod_1.z.string().optional().describe("Project root directory"),
});
async function getProjectDir(providedDir) {
    return providedDir || process.env.GEMINI_PROJECT_DIR || process.cwd();
}
async function extractGrammarAudits(content) {
    const audits = [];
    const regex = /Grammar Audit: "\*\*?(.+?)\*\*?" -> "\*\*?(.+?)\*\*?"\s*(?:\((.+?)\))?/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        audits.push({
            original: match[1].trim(),
            corrected: match[2].trim(),
            pattern: match[3]?.trim() || "General Correction",
        });
    }
    return audits;
}
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "archive_session",
                description: "Archive a Gemini session into daily memory files and extract grammar audits.",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionPath: { type: "string", description: "Path to the session JSON file" },
                        projectDir: { type: "string", description: "Project root directory (optional)" },
                    },
                    required: ["sessionPath"],
                },
            },
            {
                name: "update_grammar_log",
                description: "Extract grammar audits from a session and update the English learning log.",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionPath: { type: "string", description: "Path to the session JSON file" },
                        projectDir: { type: "string", description: "Project root directory (optional)" },
                    },
                    required: ["sessionPath"],
                },
            },
        ],
    };
});
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === "archive_session") {
            const { sessionPath, projectDir: providedDir } = ARCHIVE_SESSION_SCHEMA.parse(args);
            const projectDir = await getProjectDir(providedDir);
            const sessionData = JSON.parse(await promises_1.default.readFile(sessionPath, "utf-8"));
            const sessionId = sessionData.sessionId || "";
            const messages = sessionData.messages || [];
            const startTime = sessionData.startTime || "";
            const summary = sessionData.summary || "";
            // 1. Update Grammar Log
            const allContent = messages.map((m) => m.content).filter((c) => typeof c === 'string').join("\n");
            const audits = await extractGrammarAudits(allContent);
            const englishLogPath = path_1.default.join(projectDir, "project/neo/src/English_Learning_Log.md");
            if (audits.length > 0) {
                try {
                    const logContent = await promises_1.default.readFile(englishLogPath, "utf-8");
                    const todayStr = new Date().toISOString().split('T')[0];
                    let newEntries = "";
                    for (const audit of audits) {
                        if (!logContent.includes(audit.original)) {
                            newEntries += `| ${todayStr} | ${audit.original} | ${audit.corrected} | ${audit.pattern} |\n`;
                        }
                    }
                    if (newEntries) {
                        await promises_1.default.appendFile(englishLogPath, newEntries);
                    }
                }
                catch (e) {
                    console.error(`Failed to update grammar log: ${e}`);
                }
            }
            // 2. Archive to Memory
            const memoryDir = path_1.default.join(projectDir, "history/memory");
            await promises_1.default.mkdir(memoryDir, { recursive: true });
            const today = new Date().toISOString().split('T')[0];
            const memoryFile = path_1.default.join(memoryDir, `${today}.md`);
            // Deduplication
            if (sessionId) {
                try {
                    const existingMemory = await promises_1.default.readFile(memoryFile, "utf-8");
                    if (existingMemory.includes(sessionId)) {
                        return {
                            content: [{ type: "text", text: `Session ${sessionId} already archived.` }],
                        };
                    }
                }
                catch (e) {
                    // File might not exist yet
                }
            }
            let lines = [];
            for (const m of messages) {
                if (m.type === "user") {
                    const text = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.find((p) => p.text)?.text : "");
                    if (text)
                        lines.push(`### User\n${text.trim().substring(0, 200)}`);
                }
                else if (m.type === "gemini") {
                    const text = typeof m.content === 'string' ? m.content : "";
                    if (text) {
                        const quoted = text.trim().substring(0, 500).split("\n").map(l => `> ${l}`).join("\n");
                        lines.push(`### Neo\n${quoted}`);
                    }
                }
            }
            if (lines.length > 0) {
                const timeStr = startTime ? new Date(startTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
                const topic = summary || "对话记录";
                let output = `\n## ${timeStr} ${topic}\n`;
                output += `<!-- session: ${sessionId} -->\n`;
                output += lines.join("\n\n") + "\n\n";
                await promises_1.default.appendFile(memoryFile, output);
                // Git commit
                try {
                    await execAsync(`git add history/memory/ project/neo/src/English_Learning_Log.md`, { cwd: projectDir });
                    await execAsync(`git commit -m "chore: 自动归档对话记忆 ${today}" --no-verify`, { cwd: projectDir });
                }
                catch (e) {
                    // Commit might fail if no changes
                }
                return {
                    content: [{ type: "text", text: `Successfully archived session ${sessionId} to ${memoryFile}` }],
                };
            }
            return {
                content: [{ type: "text", text: "No valid messages to archive." }],
            };
        }
        else if (name === "update_grammar_log") {
            const { sessionPath, projectDir: providedDir } = UPDATE_GRAMMAR_LOG_SCHEMA.parse(args);
            const projectDir = await getProjectDir(providedDir);
            const sessionData = JSON.parse(await promises_1.default.readFile(sessionPath, "utf-8"));
            const messages = sessionData.messages || [];
            const allContent = messages.map((m) => m.content).filter((c) => typeof c === 'string').join("\n");
            const audits = await extractGrammarAudits(allContent);
            const englishLogPath = path_1.default.join(projectDir, "project/neo/src/English_Learning_Log.md");
            if (audits.length > 0) {
                const logContent = await promises_1.default.readFile(englishLogPath, "utf-8");
                const todayStr = new Date().toISOString().split('T')[0];
                let newEntries = "";
                for (const audit of audits) {
                    if (!logContent.includes(audit.original)) {
                        newEntries += `| ${todayStr} | ${audit.original} | ${audit.corrected} | ${audit.pattern} |\n`;
                    }
                }
                if (newEntries) {
                    await promises_1.default.appendFile(englishLogPath, newEntries);
                    return {
                        content: [{ type: "text", text: `Updated grammar log with ${audits.length} entries.` }],
                    };
                }
            }
            return {
                content: [{ type: "text", text: "No new grammar audits found." }],
            };
        }
        throw new Error(`Tool not found: ${name}`);
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("Memory Server MCP running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map