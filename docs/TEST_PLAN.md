# Neo 测试方案

> 本文档定义了 Neo 项目的测试策略、分层方案和优先级，作为后续补充自动化测试的实施指南。

---

## 测试工具选型

| 工具 | 用途 |
|------|------|
| **Vitest** | 单元测试 & 集成测试运行器（原生 ESM + TypeScript 支持，与 Vite 生态统一） |
| **supertest** | HTTP 路由集成测试（构造请求、断言响应） |
| **memfs** / `tmp` 目录 | 文件系统测试的隔离环境 |

推荐 Vitest 而非 Jest，理由：
- 项目是 ESM (`"type": "module"`) + TypeScript，Vitest 零配置即可运行
- 前端已使用 Vite，统一工具链降低学习成本
- 内置 `vi.mock()` / `vi.spyOn()` 即可满足 mock 需求

## 当前状态校正（2026-04）

- 根目录 [package.json](../package.json) 已具备 `test`、`test:watch` 脚本，`vitest.config.ts` 已落地
- 仓库内已有较完整的测试基线，覆盖 `utils`、`services`、`routes`、`llm`、`memory`、`sandbox`、`tools` 等模块
- 当前主要缺口不是“从零引入测试”，而是补齐覆盖率脚本、CI 门禁，以及校正文档中已过时的测试前提
- 目前尚未发现 `.github/workflows`、ESLint、Prettier 配置，测试与代码质量门禁仍需补齐

---

## 测试分层

```
┌─────────────────────────────────────────┐
│          E2E / Smoke Tests              │  ← 最少，仅验证核心链路
├─────────────────────────────────────────┤
│        Integration Tests                │  ← HTTP 路由 + 服务层串联
├─────────────────────────────────────────┤
│          Unit Tests                     │  ← 最多，覆盖所有纯逻辑模块
└─────────────────────────────────────────┘
```

---

## 第一阶段：纯函数 & 工具类单元测试（P0）

这些模块无外部依赖、无副作用，测试 ROI 最高，应最先完成。

### 1.1 `src/utils/yaml.ts` — mini YAML 解析器

```
测试文件: src/utils/__tests__/yaml.test.ts

用例:
- parseYaml: 解析顶层 key-value 对（字符串、数字、布尔值）
- parseYaml: 解析嵌套 mapping（2 级缩进）
- parseYaml: 解析序列（- item 格式）
- parseYaml: 引号值正确 unquote（单引号、双引号）
- parseYaml: 忽略注释行和空行
- parseYaml: 空输入返回空对象
- buildParameters: 从 YAML map 构建 FunctionDeclaration 参数
- buildParameters: 处理 required 数组
- buildParameters: 处理 enum 和 items 嵌套属性
- buildParameters: 空输入返回 undefined
```

### 1.2 `src/skills/skill-parser.ts` — Skill 文件解析器

```
测试文件: src/skills/__tests__/skill-parser.test.ts

用例:
- parseSkillFile: 正常解析含 frontmatter 和 body 的 .skill.md
- parseSkillFile: 解析带 parameters 定义的 frontmatter
- parseSkillFile: 提取 ```js execute 代码块
- parseSkillFile: 多个 executable block 全部提取
- parseSkillFile: 无 frontmatter 时抛出错误
- parseSkillFile: frontmatter 缺 name 时抛出错误
- parseSkillFile: frontmatter 缺 description 时抛出错误
- parseSkillFile: enabled: false 正确解析
- parseSkillFile: tags 数组正确解析
```

### 1.3 `src/skills/skill-executor.ts` — interpolate 函数

```
测试文件: src/skills/__tests__/skill-executor.test.ts

用例:
- interpolate: 替换 {{param}} 占位符
- interpolate: 多个不同占位符全部替换
- interpolate: 同一占位符多次出现全部替换
- interpolate: 未知占位符保持原样
- interpolate: args 为空对象时模板原样返回
- interpolate: 值为 null/undefined 时替换为空字符串
```

### 1.4 `src/utils/id-generator.ts`

```
测试文件: src/utils/__tests__/id-generator.test.ts

用例:
- generateId: 返回非空字符串
- generateId: 两次调用结果不同（唯一性）
- generateId: 格式为 hex + base36（regex 校验）
```

### 1.5 `src/tools/executor.ts` — 安全检查

```
测试文件: src/tools/__tests__/executor-security.test.ts

用例:
- checkDangerousCommand: "rm -rf /" 被拦截
- checkDangerousCommand: "rm -rf /etc" 被拦截
- checkDangerousCommand: "sudo apt install" 被拦截
- checkDangerousCommand: "dd if=/dev/zero" 被拦截
- checkDangerousCommand: "mkfs.ext4" 被拦截
- checkDangerousCommand: "chmod 777 /etc/passwd" 被拦截
- checkDangerousCommand: "> /dev/sda" 被拦截
- checkDangerousCommand: 正常命令 "ls -la" 不被拦截
- checkDangerousCommand: 正常命令 "cat file.txt" 不被拦截
- checkDangerousCommand: 正常命令 "npm run build" 不被拦截
- checkDangerousCommand: 正常命令 "grep -r pattern ." 不被拦截
- safePath: 相对路径正确拼接到 workDir
- safePath: 绝对路径在 workDir 内正常返回
- safePath: "../../etc/passwd" 路径穿越被阻止（抛出错误）
- safePath: workDir 外的绝对路径被阻止
```

### 1.6 `src/services/notebook-service.ts` — frontmatter 解析 & 序列化

```
测试文件: src/services/__tests__/notebook-frontmatter.test.ts

（`parseFrontmatter` / `serializeFrontmatter` / `titleFromFilename` 已从 `notebook-service.ts` 导出，
  可直接补纯函数单测；`nbCreate → nbGet` 的 round-trip 仍可保留作为回归测试）

用例:
- parseFrontmatter: 标准 YAML frontmatter 正确解析全部字段
- parseFrontmatter: 无 frontmatter 时返回空 meta + 完整 body
- parseFrontmatter: 只有部分字段时其余为 undefined
- parseFrontmatter: tags 数组正确解析（含引号、逗号分隔）
- serializeFrontmatter: meta + body 序列化为标准格式
- serializeFrontmatter: round-trip（serialize → parse）数据一致
- titleFromFilename: 去掉 .md 后缀、日期前缀、下划线转空格
```

### 1.7 `src/services/document-parser.ts` — 类型检测

```
测试文件: src/services/__tests__/document-parser.test.ts

用例:
- isDocumentType: PDF MIME / 扩展名判定为 true
- isDocumentType: DOCX MIME / 扩展名判定为 true
- isDocumentType: XLSX / XLS 判定为 true
- isDocumentType: .txt / .md / .json / .py 等文本类型为 true
- isDocumentType: .png / .jpg 等图片类型为 false
- isDocumentType: 未知类型 "application/octet-stream" + ".bin" 为 false
- isImageType: "image/png" 为 true
- isImageType: "image/jpeg" 为 true
- isImageType: "text/plain" 为 false
- parseDocument (文本): .txt Buffer 正确提取文本
- parseDocument (文本): 超长文本被截断到 MAX_EXTRACT_LENGTH
- parseDocument: 不支持的类型返回 null
```

### 1.8 `src/platforms/telegram-bot.ts` — Markdown 转换

```
测试文件: src/utils/__tests__/telegram-html.test.ts

（`markdownToTelegramHtml` / `escapeHtml` / `inlineFormat` / `splitTelegramText`
  已提取到 `src/utils/telegram-html.ts`；`telegram-bot.ts` 本身应聚焦授权、分段发送与接线集成测试）

用例:
- escapeHtml: & < > 正确转义
- markdownToTelegramHtml: 代码块转 <pre><code>
- markdownToTelegramHtml: 带语言标记的代码块加 class
- markdownToTelegramHtml: **bold** 转 <b>
- markdownToTelegramHtml: *italic* 转 <i>
- markdownToTelegramHtml: ~~strikethrough~~ 转 <s>
- markdownToTelegramHtml: [text](url) 转 <a href>
- markdownToTelegramHtml: > blockquote 转 <blockquote>
- markdownToTelegramHtml: # heading 转 <b>
- markdownToTelegramHtml: `inline code` 转 <code>
- splitTelegramText: 短文本返回单元素数组
- splitTelegramText: 超长文本按 3800 字符分割
- splitTelegramText: 空文本返回 "(empty response)"
- splitTelegramText: 优先在换行符处分割
```

---

## 第二阶段：文件系统服务层测试（P0）

这些模块操作文件系统，需要在临时目录中运行，但逻辑独立、不依赖网络。

### 2.1 `src/services/chat-service.ts` — 会话与消息持久化

```
测试文件: src/services/__tests__/chat-service.test.ts

前置: 每个测试用例为测试用户配置独立 `workspaceDir`，并在测试环境显式设置 `process.env.USERS`

存储路径：`{workDir}/.neo/projects/chat-sessions.json` 与 `{workDir}/.neo/projects/{sessionId}/chat-{sessionId}.jsonl`

用例:
- sessionCreate: 创建会话，返回正确的 SessionRow
- sessionCreate: 新会话的 is_current = 1
- sessionCreate: 创建新会话时旧会话的 is_current 置为 0
- sessionGet: 获取存在的会话
- sessionGet: 获取不存在的会话返回 null
- sessionGetCurrent: 返回 is_current=1 的最新会话
- sessionGetCurrent: 无会话时返回 null
- sessionList: 按 start_time 倒序返回
- sessionList: 受 limit 参数限制
- sessionPatch: 修改 title 成功
- sessionPatch: 修改 is_pinned 成功
- sessionPatch: 不存在的 session 返回 null
- sessionDelete: 删除会话和消息文件
- sessionDelete: 删除不存在的会话返回 false
- messageAdd: 追加消息到 JSONL 文件
- messageAdd: 首条 user 消息自动设置 session title
- messageAdd: 更新 session 的 end_time
- messageList: 按时间顺序返回消息
- messageList: 受 limit 参数限制（取最近 N 条）
- messageList: 空 session 返回空数组
```

### 2.2 `src/services/notebook-service.ts` — 知识库 CRUD

```
测试文件: src/services/__tests__/notebook-service.test.ts

前置: 每个测试用例使用 tmp 目录作为 workDir

用例:
- nbCreate: 创建笔记，写入文件，返回正确 entry
- nbCreate: 文件名从 title + date 生成，特殊字符被过滤
- nbCreate: tags 正确写入 frontmatter
- nbGet: 读取存在的笔记，含 content
- nbGet: 读取不存在的笔记返回 undefined
- nbGet: 路径穿越（../etc/passwd）返回 undefined（安全）
- nbUpdate: 更新 title、content、tags
- nbUpdate: 部分更新只修改指定字段
- nbUpdate: 不存在的笔记返回 undefined
- nbDelete: 删除存在的笔记返回 true
- nbDelete: 删除不存在的笔记返回 false
- nbDelete: 路径穿越被阻止
- nbList: 列出所有笔记（不含 content）
- nbList: 按 notebook 过滤
- nbList: limit 参数生效
- nbListNotebooks: 返回所有子目录名
- nbListNotebooks: 排除 .tmp 和隐藏目录
- nbSearch: 标题匹配
- nbSearch: 正文匹配（含 snippet）
- nbSearch: 无结果返回空数组
- nbGetByTitle: 模糊标题匹配
```

### 2.3 `src/services/user-profile.ts` — 用户档案管理

```
测试文件: src/services/__tests__/user-profile.test.ts

前置: 每个测试用例使用 tmp 目录作为 workDir

用例:
- init: USER.md 不存在时创建默认模板
- init: USER.md 已存在时不覆盖
- read: 读取已有文件内容
- read: 文件不存在返回空字符串
- write: 写入新内容
- toContextString: 有内容时返回 "[用户档案]\n..."
- toContextString: 无内容时返回空字符串
- toDisplayString: 有内容时返回内容
- toDisplayString: 无内容时返回提示文字
```

### 2.4 `src/tools/user-tools/loader.ts` — 用户工具加载

```
测试文件: src/tools/user-tools/__tests__/loader.test.ts

前置: 在 tmp 目录构造 .tools/{name}/tool.yaml + run.sh 结构

用例:
- loadUserTools: .tools/ 不存在时返回空 Map
- loadUserTools: 正确解析 tool.yaml 为 Tool 对象
- loadUserTools: 跳过无 tool.yaml 的目录
- loadUserTools: 跳过无 run script 的目录
- loadUserTools: 跳过 tool.yaml 为空的目录
- loadUserTools: 跳过 _ 开头的目录
- loadUserTools: tool.yaml 缺少 name 时跳过并警告
- loadUserTools: 多个工具全部加载
- parseToolYaml: 正确提取 name、description、parameters
- parseToolYaml: 解析 timeout 和 env 配置
```

### 2.5 `src/skills/skill-registry.ts` — 技能注册表

```
测试文件: src/skills/__tests__/skill-registry.test.ts

用例:
- SkillRegistry.register: 注册后可通过 get 获取
- SkillRegistry.list: 返回所有已注册 skill
- SkillRegistry.size: 返回正确数量
- SkillRegistry.get: 未注册的 name 返回 undefined
- loadUserSkills: 从 skills/ 目录加载 .skill.md 文件
- loadUserSkills: 跳过 enabled: false 的 skill
- loadUserSkills: skills/ 不存在时返回空 registry
- loadUserSkills: 支持嵌套目录 (subdir/skill.md) 格式
```

---

## 第三阶段：HTTP 路由集成测试（P1）

使用 supertest 直接测试 Koa 路由，mock LLM 调用和文件系统。

### 3.1 认证中间件

```
测试文件: src/__tests__/auth-middleware.test.ts

用例:
- 非 /api/ 路径不需要认证
- /api/auth/login 不需要认证
- 无 Cookie 的 /api/* 请求返回 401
- 有效签名 Cookie 的请求正常通过
- Basic Auth 开启时无 Authorization 头返回 401
- Basic Auth 开启时正确凭据通过
- Basic Auth 开启时错误凭据返回 401
```

### 3.2 Chat 路由 (`/api/chat`)

```
测试文件: src/routes/__tests__/chat.test.ts

前置: mock runAgentTurn，不实际调用 LLM

用例:
- POST /api/chat: 缺少 message 和 images 返回 400
- POST /api/chat: 缺少 sessionId 返回 400
- POST /api/chat: message 超长返回 400
- POST /api/chat: 正常请求返回 SSE 流（Content-Type: text/event-stream）
- POST /api/chat: SSE 流包含 text chunk 和 done 事件
- POST /api/chat: LLM 错误时 SSE 流包含 error 事件
- POST /api/chat: 客户端断开触发 AbortSignal
```

### 3.3 Session 路由

```
测试文件: src/routes/__tests__/session.test.ts

用例:
- GET /api/session: 返回会话列表
- POST /api/session: 创建新会话
- DELETE /api/session/:id: 删除会话
- PATCH /api/session/:id: 修改标题/pin 状态
```

### 3.4 Notebook 路由

```
测试文件: src/routes/__tests__/notebook.test.ts

用例:
- GET /api/notebook: 列出笔记
- GET /api/notebook/:id: 获取单条笔记
- POST /api/notebook: 创建笔记
- PUT /api/notebook/:id: 更新笔记
- DELETE /api/notebook/:id: 删除笔记
- GET /api/notebook/search?q=xxx: 搜索笔记
```

### 3.5 Upload 路由

```
测试文件: src/routes/__tests__/upload.test.ts

用例:
- POST /api/upload: 上传文本文件成功提取文本
- POST /api/upload: 上传不支持的文件类型返回对应提示
- POST /api/upload: 上传图片返回 base64 data URL
```

---

## 第四阶段：服务层集成测试（P1）

### 4.1 `src/services/agent-runner.ts`

```
测试文件: src/services/__tests__/agent-runner.test.ts

前置: mock LLMClient 和 calcUser

用例:
- runAgentTurn: 正常流程（加载用户 → 获取/创建 session → 读历史 → 调 LLM → 保存消息）
- runAgentTurn: session 不存在时自动创建
- runAgentTurn: onChunk 回调收到正确的 chunk 序列
- runAgentTurn: LLM 返回空文本时不保存 assistant 消息
- runAgentTurn: AbortError 被原样抛出
- runAgentTurn: 其他错误包含 userId/sessionId 上下文
```

### 4.2 `src/llm/client.ts` — 模型解析 & 系统指令

```
测试文件: src/llm/__tests__/client.test.ts

用例:
- resolveModel: "flash" → "gemini-3-flash-preview"
- resolveModel: "pro" → "gemini-3-pro-preview"
- resolveModel: "deepseek" → "deepseek-chat"
- resolveModel: 未知别名原样返回
- loadSystemInstruction: 从目录加载 AGENTS.md
- loadSystemInstruction: 合并 AGENTS.md + SOUL.md + TOOLS.md
- loadSystemInstruction: fallback 到 agent.md
- loadSystemInstruction: 所有文件不存在时返回空字符串
- buildTenantSystemInstruction: 合并 system instruction + USER.md
```

### 4.3 `src/tools/executor.ts` — 工具执行

```
测试文件: src/tools/__tests__/executor.test.ts

前置: 使用 tmp 目录作为 workDir

用例:
- executeTool("read_file"): 读取存在的文件
- executeTool("read_file"): 超长文件被截断并标记
- executeTool("read_file"): 路径穿越被阻止
- executeTool("write_file"): 创建新文件（含自动创建目录）
- executeTool("list_dir"): 列出目录内容（目录在前，带 / 后缀）
- executeTool("bash"): 执行简单命令并返回输出
- executeTool("bash"): 危险命令被拦截
- executeTool("bash"): 超时后命令被终止
- executeTool: 未知工具名返回错误信息
- executeTool: 工具执行异常返回 [Error] 格式
```

---

## 第五阶段：端到端冒烟测试（P2）

### 5.1 完整对话链路

```
测试文件: src/__tests__/e2e-chat.test.ts

前置: mock 外部 LLM API 返回固定响应

用例:
- 启动 CoreServer → POST /api/auth/login → POST /api/chat → 收到 SSE 响应 → 消息持久化到文件
- 新建 session → 发送消息 → 验证 session title 自动生成
- 对话历史在后续消息中正确传递
```

### 5.2 Telegram Bot（可选）

```
测试文件: src/platforms/__tests__/telegram-e2e.test.ts

前置: mock Telegraf API

用例:
- 收到文本消息 → 触发 agent turn → 返回 HTML 格式消息
- /new 命令重置会话
- 未授权用户收到拒绝消息
- 超长响应被分割发送
```

---

## 实施步骤

### Step 1: 在现有基线上补齐测试基础设施

当前仓库已具备：

- 根目录 [package.json](../package.json) 中的 `test`、`test:watch`
- [vitest.config.ts](../vitest.config.ts) 基础配置
- `supertest` 与 `@types/supertest` 依赖

建议下一步补齐：

- `test:coverage` 脚本
- `vitest.config.ts` 中的 coverage 配置
- CI 中的 `build + test` 门禁

```bash
# 若尚未安装覆盖率 provider
npm install -D @vitest/coverage-v8
```

在 `package.json` 补充脚本：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

在现有 `vitest.config.ts` 基础上补充 coverage：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      SESSION_SECRET: 'test-secret-for-vitest',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/types/**'],
    },
  },
});
```

### Step 2: 按优先级补齐剩余薄弱面

| 阶段 | 模块数 | 预估用例数 | 优先级 | 依赖 |
|------|--------|-----------|--------|------|
| 第一阶段：纯函数单元测试 | 8 | ~80 | **P0** | 无 |
| 第二阶段：文件系统服务测试 | 5 | ~60 | **P0** | tmp 目录 |
| 第三阶段：HTTP 路由集成测试 | 5 | ~30 | P1 | supertest + mock |
| 第四阶段：服务层集成测试 | 3 | ~25 | P1 | mock LLM |
| 第五阶段：端到端冒烟测试 | 2 | ~8 | P2 | 全栈 mock |

### Step 3: CI 集成

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - run: npm test
```

---

## 测试约定

1. **测试文件位置**：与源码同级的 `__tests__/` 目录下，命名 `*.test.ts`
2. **临时文件**：使用 `node:os` 的 `tmpdir()` 或 Vitest 的 `beforeEach` 创建隔离目录，`afterEach` 清理
3. **Mock 原则**：只 mock 外部边界（LLM API、网络请求），不 mock 内部模块间调用
4. **断言风格**：使用 Vitest 内置的 `expect`，避免引入额外断言库
5. **覆盖率目标**：第一阶段和第二阶段完成后达到核心模块 80%+ 行覆盖率

---

## 仍建议调整以提升可测性

以下模块里，部分历史阻塞已解除；剩余条目聚焦当前仍影响测试稳定性的点：

| 模块 | 问题 | 建议 |
|------|------|------|
| `chat-service.ts` | 已迁移到用户 `workspaceDir`，但测试仍依赖 `process.env.USERS` 和测试用户配置 | 提供统一的 test helper，为测试用户注入 `workspaceDir` 和 `USERS` |
| `notebook-service.ts` | frontmatter 相关 helper 已导出，但文档与测试计划仍按旧前提描述 | 直接补纯函数单测，并删除“需额外提取 util”的旧假设 |
| `telegram-bot.ts` | Markdown 转换 helper 已提取，剩余测试重点是授权与消息分段行为 | 保持纯函数测试在 `src/utils/__tests__/telegram-html.test.ts`，Bot 侧只做集成行为验证 |
| `config.ts` | 模块顶层执行 `process.exit(1)`，import 时无法拦截 | 改为抛出异常或延迟校验 |
| `executor.ts` | `safePath` 已导出，但文档仍按旧前提描述 | 直接补/维护 `safePath` 单测，无需再为测试目的重构 |
