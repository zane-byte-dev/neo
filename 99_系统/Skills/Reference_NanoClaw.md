# Reference: NanoClaw 架构设计与安全模式

> **来源**: [github.com/gavrielc/nanoclaw](https://github.com/gavrielc/nanoclaw)
> **状态**: 核心参考 (Architectural Benchmark)
> **对齐方向**: InkBrain v5 "脏电脑" 物理隔离与自动化架构

## 1. 核心哲学 (Philosophy)

- **Small enough to understand**: 代码量极小（数百行），确保人类能完全理解其安全边界，而非依赖黑盒框架。
- **Skills over Features**: 不追求功能的堆砌，而是通过 `Skill.md` 教会 AI 如何按需改造代码库。
- **Secure by Isolation**: 拒绝应用层的权限检查，转而使用操作系统层级的容器隔离（Container Sandboxing）。

## 2. 架构模式 (Architecture Patterns)

### A. 容器化沙箱 (Container-based Execution)
- **机制**: 使用 `Apple Container` (macOS) 或 `Docker` 运行 Agent。
- **挂载策略**: 严格按需挂载 (Least Privilege)。
    - `Main Group`: 挂载整个项目根目录，具备管理权限。
    - `Sub Groups`: 仅挂载自身的文件夹 + 只读的全局配置。
- **启示**: InkBrain 的爬虫或第三方脚本应在容器内运行，挂载 `00_收集` 目录作为输出口，与 `01_日记` 物理隔离。

### B. 文件系统 IPC (Filesystem-based Inter-Process Communication)
- **机制**: 进程间通信不使用 Socket/HTTP，而是通过监听特定文件夹。
    - `ipc/messages/`: 发送外发指令。
    - `ipc/tasks/`: 调度计划任务。
- **优势**: 
    - 天然支持 **Local-First** 和 **Offline-First**。
    - 调试极其简单（直接看文件夹里的 JSON 文件）。
    - 兼容性极强（任何语言都能写文件）。

### C. 记忆与上下文隔离 (Context Isolation)
- **机制**: 每个 Group 拥有独立的 `.claude/` 目录和 `CLAUDE.md` 记忆文件。
- **效果**: 彻底防止不同项目间的上下文污染（Context Poisoning）。

## 3. 对 InkBrain 的技术映射

| NanoClaw 概念 | InkBrain 对应/升级方向 | 备注 |
| :--- | :--- | :--- |
| **Container Runner** | `Skills/Sandbox_Runner.py` | 用于运行不受信任的 Python 脚本或爬虫。 |
| **IPC Watcher** | `Skills/Folder_Watcher.py` | 监控 `00_收集/Queue` 目录，实现任务自动触发。 |
| **Skills System** | `99_系统/Skills/*.md` | 将复杂的 Prompt 和代码逻辑封装成标准化技能包。 |
| **Main Channel** | `01_日记` (作为控制台) | 通过日记中的 `//ai` 指令驱动整个系统。 |

## 4. 待落地动作 (Backlog)

1. [ ] **建立隔离运行环境**: 编写一个脚本，支持在 Docker 中启动 Gemini CLI 并只挂载特定的 `03_文章` 子目录。
2. [ ] **标准化 Skill 模板**: 参考 NanoClaw 的 `SKILL.md`，为 InkBrain 编写第一个“自动重构技能”。
3. [ ] **实现文件夹信箱**: 允许 Obsidian 插件通过向 `99_系统/IPC/Inbox` 写入 JSON 来调用 InkBrain 核心能力。

---
*2026-02-02 架构审计完成 - By Builder Persona*
