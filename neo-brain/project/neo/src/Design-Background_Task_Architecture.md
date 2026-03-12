# 设计方案：后台任务与多 Agent 协作机制 (Worker Pool)

## 1. 核心目标
解决 `gemini-cli` 在处理耗时任务（如大规模重构、深度研究、持续抓取）时占用主会话的问题，实现并发处理与资源隔离。

## 2. 架构设计：指挥官-工兵 (Commander-Worker)

### A. 架构组件
1.  **Task Queue (任务队列)**: 
    *   持久化层：`apps/gateway/cache/tasks.db` (SQLite)。
    *   功能：记录任务 ID、目标、优先级、状态（Pending/Running/Completed/Failed）及输出。
2.  **Shadow Workspace (影子工作区)**:
    *   路径：`apps/refinery/.work/worker-{id}`。
    *   目的：避免并发 Agent 同时修改同一份代码导致 Git 冲突。任务完成后通过 `patch` 合并回主库。
3.  **Headless Runner**:
    *   技术：使用 `execa` 驱动 `gemini-cli --non-interactive`。
    *   模式：全自动化运行，不接受交互输入，遇到风险点直接输出审计报告。

### B. 协作模型
*   **Commander (主实例)**: 
    *   负责用户交互、任务拆解。
    *   通过工具 `dispatch_task(objective, context)` 向队列发送指令。
*   **Worker (后台实例)**: 
    *   独立进程运行。
    *   专注于重逻辑：大规模文档分析、代码库全量审计、Deep Research 后置处理。

## 3. 技术挑战与对策

### 1) 资源竞争锁 (Git Lock)
使用 `proper-lockfile` 保护 `.git` 目录。所有涉及代码修改的操作（Commit, Reset, Apply Patch）必须在持有锁的状态下执行。

### 2) 回调与通知
*   **同步**: 任务结果写入 `history/inbox/task_result_{id}.md`。
*   **通知**: 通过 Telegram Bot 推送“任务完成”状态。
*   **读取**: Commander 在下次启动或空闲时自动加载 `inbox` 内容作为上下文增量。

## 4. 下一步演进路径
1.  **Stage 1**: 实现 `dispatch_task` 工具，支持静默启动第二个 `gemini-cli` 执行 `read-only` 任务（如代码审计）。
2.  **Stage 2**: 引入影子工作区，支持并发代码修改。
3.  **Stage 3**: 完善任务看板，支持在 Telegram 中管理后台任务状态。

---
**Status**: 方案已存入 `project/neo/src/Design-Background_Task_Architecture.md` (2026-03-10)
