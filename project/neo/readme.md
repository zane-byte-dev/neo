# Neo

这是一个本地化的AI助手，基于本地文件建立知识库，Git负责版本管理，GeminiCli 作为 AI Agent。
当前项目本身就是这个知识助手维护的。
在 `system` 目录下存放了 AI 的系统配置和工具。

## 目前已经实现的

### 极简架构底座
纯本地 Markdown + Git 版本管理，确立 `inbox/project/history/reference/system` 分区，实现 Local-First。

### 自动化记忆生命周期
会话即日志 (Session-to-Log)，通过 gemini-cli Hook 实现在离开会话时自动脱水并向 `history/memory/` 沉淀记录。

### 多重 AI 人格切换
通过 `system/persona` 实现“管家(基建)”、“西风(决策审计)”、“作家(输出沉淀)”等不同人格的精准调用。

### 技能工作流 (Skills)
通过 `system/skill` 定义了一套标准动作协议，包含日记骨架生成、碎片清理、账本记录等。

### 全平台入口打通
实现了 Telegram -> Local Vault 的闭环链路，能够随时随地向 Inbox 注入碎片。

## 还需要实现的

### 主动策展推送 (The Curator)
基于 Node.js 定时唤醒，自动检索历史记录进行每日知识策展并主动推送到终端。

### UI 界面层解耦重构
推进 node-pty 接入 gemini-cli 的交付路径，把终端套上一层轻量的 Electron 外壳。

### 向量增强检索 (RAG)
优化本地 Markdown 的 Embedding 与索引性能，实现模糊意图检索和主动联想搜索。

### 全自动看板刷新
根据项目区下的变更记录和 commit，让 AI 自动生成或更新各大看板的当前进度。
