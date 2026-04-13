/**
 * 添加新用户脚本
 *
 * 用法:
 *   npx tsx scripts/add-user.ts --id <用户ID> --name <姓名> [选项]
 *
 * 必填:
 *   --id       用户 ID（如 Telegram 数字 ID）
 *   --name     用户姓名
 *
 * 可选:
 *   --workspace  工作区目录名（默认与 id 相同）
 *   --tenants    租户列表，逗号分隔（默认空）
 *   --token      Web 登录 token（默认不设置）
 *   --dry-run    仅打印将执行的操作，不写入任何文件或数据库
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── CLI 参数解析 ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const args: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) {
                args[key] = true;
            } else {
                args[key] = next;
                i++;
            }
        }
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));

const userId    = String(args['id']        ?? '');
const name      = String(args['name']      ?? '');
const workspace = String(args['workspace'] ?? userId);
const tenantsRaw = String(args['tenants']  ?? '');
const webToken  = args['token'] ? String(args['token']) : null;
const dryRun    = args['dry-run'] === true;

if (!userId || !name) {
    console.error('❌ 缺少必填参数。用法:\n');
    console.error('  npx tsx scripts/add-user.ts --id <用户ID> --name <姓名> [--workspace <目录>] [--tenants <t1,t2>] [--token <token>] [--dry-run]');
    process.exit(1);
}

const tenants: string[] = tenantsRaw ? tenantsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

// ── 路径 ──────────────────────────────────────────────────────────────────────

const _root      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spaceDir   = resolve(_root, 'space', workspace);
const userMd     = resolve(spaceDir, 'USER.md');
const agentsMd   = resolve(spaceDir, 'AGENTS.md');
const soulMd     = resolve(spaceDir, 'SOUL.md');
const toolsMd    = resolve(spaceDir, 'TOOLS.md');
const memoryDir  = resolve(spaceDir, 'memory');
const skillsDir  = resolve(spaceDir, 'skills');
const archivesDir = resolve(spaceDir, 'archives');

// ── 模板内容 ──────────────────────────────────────────────────────────────────

const USER_MD = `# 用户档案

- 姓名: ${name}
- 城市: 
- 时区: Asia/Shanghai
- 语言偏好: 中文
`;

const AGENTS_MD = `# inkClaw — 任务路由与工具规则

## Rule #0 — 工具调用强制协议（最高优先级）

以下场景必须先调用工具获取真实数据，严禁使用训练记忆或凭空编造：

| 场景关键词 | 必须调用的工具 |
|-----------|--------------|
| 查询实时天气 | \`get_weather\` |
| 搜索不确定的事实或数据 | \`search_web\` |
| 读取本地文件内容 | \`read_file\` |
`;

const SOUL_MD = `# inkClaw — 身份与沟通风格

你是 inkClaw，一个个人 AI 助手。

## 基本设定

- 语言：默认中文（简体）
- 语气：干练直接，没有废话和客套话
- 个性：聪明但不卖弄，直接给结论，必要时才解释
`;

const TOOLS_MD = `# 工具配置

（按需填写用户专属工具或权限配置）
`;

// ── 核心逻辑 ─────────────────────────────────────────────────────────────────

function createWorkspace() {
    const dirs = [spaceDir, memoryDir, skillsDir, archivesDir];
    for (const dir of dirs) {
        if (existsSync(dir)) {
            console.log(`  [skip] 目录已存在: ${dir}`);
        } else {
            if (!dryRun) mkdirSync(dir, { recursive: true });
            console.log(`  [mkdir] ${dir}`);
        }
    }

    const files: [string, string][] = [
        [userMd,   USER_MD],
        [agentsMd, AGENTS_MD],
        [soulMd,   SOUL_MD],
        [toolsMd,  TOOLS_MD],
    ];

    for (const [filePath, content] of files) {
        if (existsSync(filePath)) {
            console.log(`  [skip]  文件已存在: ${filePath}`);
        } else {
            if (!dryRun) writeFileSync(filePath, content, 'utf8');
            console.log(`  [write] ${filePath}`);
        }
    }
}

function insertUser() {
    const configPath = resolve(_root, 'space', 'config.json');
    let data: { users?: Array<Record<string, unknown>> } = {};
    if (existsSync(configPath)) {
        data = JSON.parse(readFileSync(configPath, 'utf8'));
    }
    const users: Array<Record<string, unknown>> = data.users ?? [];

    const existing = users.findIndex(u => u.id === userId);
    const entry = { id: userId, name, workspace, tenants, webToken: webToken ?? undefined };

    if (existing >= 0) {
        console.log(`\n⚠️  用户 ${userId} 已存在，将更新信息。`);
        if (!dryRun) users[existing] = entry;
    } else {
        if (!dryRun) users.push(entry);
        console.log(`  [config] 已插入用户记录`);
    }

    if (!dryRun) {
        writeFileSync(configPath, JSON.stringify({ ...data, users }, null, 2), 'utf8');
    }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

console.log('\n=== 添加用户 ===');
console.log(`  ID:        ${userId}`);
console.log(`  姓名:      ${name}`);
console.log(`  工作区:    space/${workspace}`);
console.log(`  租户:      ${tenants.length ? tenants.join(', ') : '（无）'}`);
console.log(`  Web Token: ${webToken ?? '（未设置）'}`);
if (dryRun) console.log('\n[dry-run 模式] 以下操作仅打印，不实际执行\n');
else console.log('');

// 1. 创建工作区目录和模板文件
console.log('1. 创建工作区文件...');
createWorkspace();

// 2. 写入数据库
console.log('\n2. 写入数据库...');
if (!dryRun) {
    insertUser();
} else {
    console.log('  [db] 将插入: users (id, name, workspace, tenants, web_token)');
}

console.log(`\n✅ 完成${dryRun ? '（dry-run）' : ''}！用户 "${name}" (${userId}) 已添加。`);
if (!dryRun) {
    console.log(`\n   工作区路径: space/${workspace}/`);
    console.log('   重启服务后生效。\n');
}
