# Neo v0.1.0 — First Public Release 🎉

> 这份草稿可直接粘贴到 GitHub Release 编辑页（基于 tag `v0.1.0`）。
> 标题建议：**Neo v0.1.0 — First Public Release**

---

## What is Neo?

Neo 是一个**自托管的个人 AI 助手**，把 Web Chat、Notebook 知识库、Telegram Bot
和可扩展的 Tool/Skill 体系整合在一个 Node.js 进程里。

- 多 LLM 后端：Gemini / DeepSeek / OpenAI / Anthropic / 本地 Ollama，自动按任务路由
- 单租户为先，所有数据存在你自己的目录里
- 工具与技能都是普通文件（`tool.yaml + run.py` / Markdown skill）——丢进 workspace 就能用
- React 19 + Vite 前端、Koa 3 + better-sqlite3 后端、PM2 守护

> ⚠️ **0.x 阶段说明**：这是首个公开版本，部分 API 与目录结构仍可能调整。
> 强烈建议关注 Releases 中的 BREAKING 标记。

## Highlights

- **可恢复 Agent 运行时**：基于 `runtime/outcome.ts` 的事件流，断网/刷新都能续跑
- **统一知识索引**：Notebook + episodic/semantic memory 走同一套 SQLite FTS5
- **凭据加密存储**：API Key 通过 Web UI 录入，AES-256-GCM 加密存到 `{stateDir}/secrets.json.enc`
- **工具确认机制**：危险工具支持 once / session / always 三种放行作用域
- **浏览器扩展**：Chrome 划词保存，含 X.com、Gemini、飞书 Wiki 适配
- **Telegram Bot**：Telegraf 长轮询，支持 Markdown 渲染、图片/视频发送

## Getting Started

```bash
git clone https://github.com/zane-byte-dev/neo.git
cd neo
npm install && npm run web:install
cp src/config.local.example.ts src/config.local.ts
# 编辑 src/config.local.ts，填入 workDir / stateDir / SESSION_SECRET

npm run dev:bot    # 后端 :3000
npm run web:dev    # 前端 :5173
```

打开 http://localhost:5173 → **Models** 页填入至少一个 LLM Provider 的 API Key，
即可开始对话。生产部署见 [README](https://github.com/zane-byte-dev/neo#生产部署mac-mini--长期运行)。

仓库里附带最小可用的 [examples/workspace/](https://github.com/zane-byte-dev/neo/tree/main/examples/workspace)
模板，复制到你的 `workDir` 即可作为起点。

## Known Limitations

- 仅支持单用户为主的部署模式（多用户能配置但未做隔离压测）
- LLM 路由配置目前在 `src/llm/routing-config.ts`，未提供完整的 UI 编辑器
- 浏览器扩展未上架 Chrome Web Store，需手动 load unpacked
- 没有官方 Docker 镜像（社区贡献欢迎）
- ESLint / Prettier / TS strict mode 尚未启用

## Requirements

- Node.js ≥ 18（推荐 20 / 22，CI 双版本测试）
- npm ≥ 10
- 至少一个 LLM Provider：Gemini / DeepSeek / OpenAI / Anthropic API Key，或本地 Ollama，或登录后的 Gemini CLI

## Documentation

- [README (中文)](https://github.com/zane-byte-dev/neo/blob/main/README.md)
- [README (English)](https://github.com/zane-byte-dev/neo/blob/main/README.en.md)
- [Roadmap](ROADMAP.md)
- [Contributing](https://github.com/zane-byte-dev/neo/blob/main/CONTRIBUTING.md)
- [Security Policy](https://github.com/zane-byte-dev/neo/blob/main/SECURITY.md)

## License

[MIT](https://github.com/zane-byte-dev/neo/blob/main/LICENSE)

---

**Feedback welcome!** 如果你跑通了部署、或者卡在某一步，请来开
[Issue](https://github.com/zane-byte-dev/neo/issues) 反馈。
