# 🧠 Neo — 个人知识操作系统 v5.0

> **定位**：数字分身与全能助手。本地优先、代理驱动、中文语义。  
> **架构原则**：Root-Flat · Local-First · Agentic First · Chinese Semantics

---

## 📐 目录结构

```
neo/
├── inbox/          # 原始素材、网页剪藏、临时输入
│   └── Archive/      # 原 05_归档，已结束项目和历史资料
├── history/          # 日记、周记、会话实录
│   └── 会话/         # AI 对话逐字实录（Verbatim Transcript）
├── project/          # 进行中的项目（Neo、AoneFaaS、家庭软着陆等）
├── source/          # 已完成或待发布的文章
├── system/          # 系统配置、人格、技能
│   ├── GEMINI.md     # AI 系统提示词 + 智能路由配置
│   └── Personas/     # 6 个 AI 人格定义
├── tools/            # 自动化工具
│   ├── NeoAgent-sentinel/   # Telegram Bot + 所有工具实现（TypeScript）
│   │   └── src/lib/tools/   # clipper / audio-refinery / ebook-refinery
│   ├── extension/           # Chrome 划词保存
│   └── typeless/            # 语音输入服务（Python）
```

---

## 🤖 AI 智能路由（Persona Router）

通过 `system/GEMINI.md` 配置，AI 根据意图自动加载人格：

| 人格 | 触发词 | 适用场景 |
|------|--------|----------|
| 🌋 Deep Builder | 整理、写文章、深度、白皮书 | 深度写作、知识整理 |
| 🎩 西风 West Wind | 方向、决策、怎么看、分析 | 战略决策、人生方向 |
| 🧢 Pieter Levels | 搞钱、变现、MVP、上线 | 产品快速验证 |
| ⌨️ Torvalds | 写代码、报错、重构、架构 | 代码审查、系统架构 |
| 🕰️ Curator | `/pulse` 命令 | 每日回顾、灵感激发 |
| 🤖 Gardener | 文件整理、清理目录 | 低认知搬砖任务 |

---

## 🛠 Tools

### 🔭 NeoAgent Sentinel（Telegram Bot）
**路径**：`tools/NeoAgent-sentinel/`

主要 AI 交互入口。在 Telegram 发消息 → 调用本地 Gemini CLI → 回复并保留多轮上下文。

```
特性：
• 串行任务队列（p-queue），防止并发冲突
• 本地 JSON 持久化 session，Bot 重启不丢上下文
• 自动注入 GEMINI.md 人格 + 当前日期
• PM2 后台守护，自动重启
• 支持 /clear、/newsession、/stats 命令
```

**快速启动**：

```bash
cd tools/NeoAgent-sentinel
cp .env.example .env  # 填入 Token
npm install
npm run dev:bot        # 开发模式
npm run pm2:start      # 生产模式
```

---

### 🔌 Mind Extension（Chrome 插件）
**路径**：`tools/extension/`

划词保存工具，将网页内容一键保存为 Markdown 到本地。

```
支持来源：
• 普通网页划词
• X.com 推文（含线程、引用、图片）
• Gemini 对话（保留代码块）
• 飞书 Wiki 文档
```

**安装**：`chrome://extensions/` → 开发者模式 → 加载已解压扩展程序 → 选择 `tools/extension/`

保存路径：`~/Downloads/NeoAgent/inbox/`（直接对应 vault 收集入口）

---

### 🎙 Typeless（语音输入）
**路径**：`tools/typeless/`

macOS 语音转文字服务，识别结果直接粘贴到系统剪贴板。支持中文（FunASR）+ 英文（Whisper）双引擎。

```bash
cd tools/typeless
bash start_typeless.sh   # 启动服务
python typeless_menubar.py  # 启动 Menu Bar 控制面板
```

## ⚙️ 系统要求

| 工具 | 要求 |
|------|------|
| NeoAgent Sentinel | Node.js ≥ 18, Gemini CLI, Telegram Bot Token |
| Mind Extension | Chrome / Chromium |
| Typeless（语音）| Python 3.12, macOS |

---

## 📋 Git 规则

`.gitignore` 排除以下内容：
- `.env`（含密钥）
- `node_modules/`, `logs/`, `.DS_Store`
- `.obsidian/`（编辑器配置）
- `*.canvas`, `*.excalidraw`（Obsidian 特有格式）
- `*.wav`（临时录音文件）
- Python `__pycache__/`, `venv/`

---

## 🗺 架构图

```
[Telegram] ──→ [NeoAgent-sentinel] ──→ [gemini CLI]
                        │
                [chat-history-cache]   ← 本地 JSON session
                        │
              [conversation-saver]     → 03_收集/ (可选)

[Chrome] ──→ [Mind Extension] ──→ Downloads/NeoAgent/04_Buffer/

[macOS 语音] → [Typeless Server] → 系统粘贴板
```

---

*Neo v5.0 · Local-First · Agentic · 2026*
