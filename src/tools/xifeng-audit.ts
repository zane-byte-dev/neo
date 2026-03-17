import { promises as fs } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { Tool } from './_base.js';
import { geminiGenerate } from '../lib/gemini-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _PROJECT_ROOT = resolve(__dirname, '../..');

export const xifengAuditTool: Tool = {
    meta: { category: 'knowledge', version: '1.0.0', requiresEnv: ['GEMINI_API_KEY'] },
    declaration: {
        name: 'xifeng_audit',
        description:
            '从**西风**视角对某个决策、计划或处境进行战略审计——揭示底层利益逻辑、权力生态位、潜在风险。' +
            '适用于：职场处境分析、商业决策、人际博弈、长期规划评估。' +
            '不适用于纯技术问题或情绪支持。',
        parameters: {
            type: 'object',
            required: ['situation'],
            properties: {
                situation: {
                    type: 'string',
                    description: '需要审计的处境、决策或计划，尽量详细描述背景和当事方',
                },
                focus: {
                    type: 'string',
                    description:
                        '可选，指定审计重点：\"利益关系\" / \"风险识别\" / \"时机判断\" / \"资源杠杆\"（默认全面诊断）',
                },
            },
        },
    },
    handler: async (args, workDir) => {
        const situation = String(args.situation ?? '').trim();
        const focus     = args.focus ? String(args.focus) : null;

        const apiKey = process.env.GEMINI_API_KEY ?? '';
        if (!apiKey)    return '[Error] GEMINI_API_KEY 未设置。';
        if (!situation) return '[Error] 请提供需要审计的处境或决策。';

        const focusInstruction = focus
            ? `本次重点关注：**${focus}**，其余方向可简略带过。`
            : '进行全面底层诊断：利益分析 → 生态位判断 → 风险识别 → 非典型建议。';

        // Step 1: Pick 2-3 relevant articles from the knowledge base
        const rawResourceDir = process.env.RESOURCE_DIR ?? '';
        const resourceDir = rawResourceDir
            ? (isAbsolute(rawResourceDir) ? rawResourceDir : resolve(_PROJECT_ROOT, rawResourceDir))
            : join(workDir, 'project/@reference');
        const kbDir = join(resourceDir, 'xifeng-km');
        let kbContext = '';
        try {
            const allFiles = (await fs.readdir(kbDir))
                .filter(f => f.endsWith('.md') && f !== '00_目录.md')
                .sort();

            const fileList = allFiles.join('\n');
            const selectionPrompt =
`以下是西风知识库中所有文章的文件名列表：

${fileList}

用户处境：
${situation}

请从上述文件名中选出 2-3 个与该处境最相关的文章（仅凭文件名中的关键词判断）。
只输出被选中的文件名，每行一个，不要任何解释。`;

            const selected = await geminiGenerate(
                apiKey,
                [{ role: 'user', parts: [{ text: selectionPrompt }] }],
                { model: 'flash', generationConfig: { temperature: 0, maxOutputTokens: 200 } },
            );

            if (selected) {
                const pickedFiles = selected
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l.endsWith('.md') && allFiles.includes(l))
                    .slice(0, 3);

                const articles: string[] = [];
                for (const fname of pickedFiles) {
                    try {
                        const content = await fs.readFile(join(kbDir, fname), 'utf8');
                        const lines = content.split('\n');
                        articles.push(
                            `### 参考文章：${fname}\n\n` +
                            (lines.length > 600 ? lines.slice(0, 600).join('\n') + '\n...(已截断)' : content),
                        );
                    } catch { /* skip unreadable file */ }
                }

                if (articles.length > 0) {
                    kbContext =
                        `\n\n---\n以下是从西风知识库中检索到的相关参考文章，请在审计时融入其中的视角、案例和措辞风格：\n\n` +
                        articles.join('\n\n---\n\n');
                }
            }
        } catch {
            // knowledge base path doesn't exist — proceed without it
        }

        // Step 2: Full audit with optional KB context
        const auditPrompt = `你是"西风"——一个极其务实的决策审计师，洞悉利益规则。

核心视角：
1. **利益与杠杆**：世界运行在利益和信息不对称之上，直接指出底层生存逻辑
2. **生态位优先**：位置决定一切，不要在低维生态位竞争效率
3. **风险审计**：指出计划中的温情主义假设，揭示隐藏成本和交换条件
4. **借势思维**：强调资产私有化、脱钩和"筑墙"，告诉用户如何借势而非死磕

文风：
- 冷酷务实，不粉饰太平，带"过来人"的傲慢，但目的是唤醒
- 善用历史、文学（西游记、金瓶梅、红楼梦）或江湖旧事做类比
- 反教条，挑战"努力就有回报"之类的标准建议
- 直接说结论，不要废话和免责声明${kbContext}

---
待审计处境：
${situation}

${focusInstruction}

审计报告（按序输出，不要输出结构标签以外的废话）：

**底层诊断**
这个局的实质是什么？谁在获益、谁承担成本？真实的交换逻辑是什么？

**生态位判断**
当前处于哪个层级的竞争？这一层的隐性规则是什么？有没有降维打击的可能？

**风险识别**
当前方案里藏着哪些温情主义假设？触发坏结果的具体条件是什么？

**非典型建议**
忽略标准建议。从借势/时机/脱钩角度给出 2-3 个反直觉的行动方向。`;

        const result = await geminiGenerate(
            apiKey,
            [{ role: 'user', parts: [{ text: auditPrompt }] }],
            { model: 'pro', generationConfig: { temperature: 0.7, maxOutputTokens: 1500 } },
        );

        if (!result) return '[Error] 审计生成失败，请重试。';

        const kbNote = kbContext ? `（已融入知识库参考文章）` : `（知识库未加载）`;
        return (
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🔍 西风审计报告 ${kbNote}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            result
        );
    },
};
