# 开源发布检查清单

> 将 Neo 项目从私有仓库转为公开仓库前，需要完成以下所有步骤。

---

## 一、清除个人数据

### 1.1 `space/` 目录

`space/` 目录存放所有用户的工作区数据（身份设定、个人信息、记忆、笔记本、工具），**绝对不能提交到公开仓库**。

**操作步骤：**

```bash
# 1. 将整个 space/ 目录加入 .gitignore
echo "space/" >> .gitignore

# 2. 将 space/ 从 git 追踪中移除（保留本地文件）
git rm -r --cached space/
```

同时提供一个示例模板 `space/config.example.json`（不含真实数据，用于指引用户如何添加自己的用户）：

```json
{
  "users": [
    {
      "id": "your_user_id",
      "name": "your_name",
      "workspace": "your_workspace_dir_name",
      "tenants": [],
      "webToken": "your_web_login_token"
    }
  ]
}
```

> **注意**：`space/<userId>/` 目录下的 `SOUL.md`、`USER.md`、`memory/`、`notebooks/` 等文件包含真实姓名、城市、个人偏好等隐私信息，在执行 `git rm -r --cached space/` 之前务必确认这些内容已从 git 历史中清理干净。

### 1.2 检查 git 历史

如果上述文件已经在历史提交中出现过，需要彻底从 git 历史中清除：

```bash
# 使用 git-filter-repo（推荐，比 BFG 更安全）
pip install git-filter-repo
git filter-repo --path space/ --invert-paths
```

或使用 GitHub 官方的 [secret scanning](https://docs.github.com/en/code-security/secret-scanning) 功能扫描是否存在泄漏的密钥。

---

## 二、更新 `.gitignore`

当前 `.gitignore` 缺少以下条目，需要补充：

```gitignore
# User workspace (contains personal data)
space/

# SQLite database (contains user chat history)
data/

# Coverage reports
coverage/
```

> `data/neo.db` 包含所有用户的对话历史（SQLite），同样不应提交。

---

## 三、更新 `.env.example`

当前 `.env.example` 内容已过时，与 `src/config.ts` 中实际读取的环境变量不匹配。请替换为以下内容：

```dotenv
# ── 必填 ─────────────────────────────────────────────────────────────────────
# Web 服务 Session 签名密钥（生产环境必须设置为随机长字符串）
SESSION_SECRET=change-me-to-a-long-random-string

# ── LLM 提供商（至少配置一个）───────────────────────────────────────────────
GEMINI_API_KEY=your_gemini_api_key
# DEEPSEEK_API_KEY=your_deepseek_api_key
# OPENAI_API_KEY=your_openai_api_key
# ANTHROPIC_API_KEY=your_anthropic_api_key

# ── 模型配置（可选）──────────────────────────────────────────────────────────
# GEMINI_MODEL=flash          # flash | pro | gemini-acp | deepseek | gemma | ...
# OLLAMA_BASE_URL=http://localhost:11434/v1
# GEMINI_CLI_PATH=gemini      # Gemini CLI 可执行路径（用于 ACP OAuth 模式）

# ── Web 服务（可选）──────────────────────────────────────────────────────────
# WEB_PORT=3000

# ── Telegram Bot（可选）──────────────────────────────────────────────────────
# TELEGRAM_BOT_TOKEN=your_bot_token
# TELEGRAM_CHAT_ID=your_telegram_chat_id

# ── 存储路径（可选）──────────────────────────────────────────────────────────
# DB_PATH=./data/neo.db

# ── 限流与预算（可选）────────────────────────────────────────────────────────
# DAILY_COST_LIMIT=0          # 每日 USD 预算上限，0 = 不限制

# ── 调试（可选）──────────────────────────────────────────────────────────────
# LOG_LEVEL=info              # debug | info | warn | error
# DEBUG_LLM=1                 # 等价于 LOG_LEVEL=debug
```

---

## 四、修改 `web/vite.config.ts`

当前文件中硬编码了个人域名，需要移除或改为可配置：

**当前（需修改）：**
```ts
server: {
  port: 5173,
  allowedHosts: ['neo.moshuia.com'],  // ← 个人域名，需删除
  ...
}
```

**修改为：**
```ts
server: {
  port: 5173,
  // allowedHosts 默认只允许 localhost。如果需要通过自定义域名访问开发服务器，
  // 请在本地 .env 文件中配置，或直接修改此处。
  ...
}
```

---

## 五、检查 `README.md`

`README.md` 中包含个人域名 `neo.moshuia.com`，在架构示意图和 Caddy 示例配置中出现。

**需要替换的内容：**

- `neo.moshuia.com` → `your-domain.com`（示例占位符）

---

## 六、检查 `ecosystem.config.cjs`

`ecosystem.config.cjs` 是 PM2 配置文件，目前内容为通用配置，没有个人信息，但需确认：

- `name: 'inkClaw-bot'` — 这是进程名，可根据需要重命名为更通用的 `neo-bot`
- Chrome 路径已通过 `process.env.CHROME_PATH` 支持环境变量，无需修改

---

## 七、安全加固建议

### 7.1 Web 登录机制

当前使用 `webToken`（在 `space/config.json` 中明文配置）作为 Web 登录凭证，安全性较低。在公开部署时：

- 确保 `webToken` 设置为足够长的随机字符串（建议 32 位以上）
- 在文档中明确提示用户不要使用可预测的值（如用户 ID 本身）

### 7.2 SESSION_SECRET

`src/config.ts` 已在启动时强制检查 `SESSION_SECRET`，若未设置则拒绝启动。这是正确的做法，无需额外修改。

### 7.3 Webhook Secret

`/api/webhook/:userId` 路由依赖 `webhookSecret`，请确保在文档中说明配置方式（在用户工作区的配置文件中设置）。

---

## 八、添加开源必要文件

如果尚未创建，需要添加以下文件：

| 文件 | 说明 |
|------|------|
| `LICENSE` | 已有（MIT），确认年份和作者信息正确 |
| `CONTRIBUTING.md` | 贡献指南（可选，但推荐） |
| `.github/ISSUE_TEMPLATE/` | Issue 模板（可选） |

---

## 九、操作顺序总结

按以下顺序执行，避免遗漏：

1. **备份**：在本地保留 `space/` 和 `data/` 的完整备份
2. **更新 `.gitignore`**：添加 `space/`、`data/`、`coverage/`
3. **清理 git 追踪**：`git rm -r --cached space/ data/`
4. **清理 git 历史**（如 `space/` 已被提交过）：使用 `git-filter-repo`
5. **添加 `space/config.example.json`**：提供不含真实数据的模板
6. **更新 `.env.example`**：与 `src/config.ts` 保持同步
7. **修改 `web/vite.config.ts`**：移除个人域名
8. **更新 `README.md`**：替换个人域名占位符
9. **最终审查**：`git grep -i "moshuia\|8094416266\|郑超\|zhengchao"` 确保无残留
10. **推送并设置仓库为 Public**
