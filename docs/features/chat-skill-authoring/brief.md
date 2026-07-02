# Chat Skill Authoring

> Status update (2026-05-13): Chat 内“把当前对话沉淀成 Skill”这一能力已作为 MVP 落地。实现细节见 [plan.md](plan.md)，验收结果见 [test-report.md](test-report.md)。

## Background

Neo 已经支持两套 Skill 管理路径：

- Settings / Skills 里的可视化管理页
- 直接把 `.skill.md` 文件写进 `{stateDir}/skills/`

但对于正在和 Agent 协作的用户，这两条路径都不够顺手。用户通常是在一次对话完成后，才意识到“这套提示词 / 输出格式 / 工作流值得保存下来”。如果这时还要跳去设置页或手写文件，就打断了闭环。

## Freshness Check

本 Brief 基于 2026-05-13 的当前代码和界面状态核验，不只依赖历史文档：

- [src/routes/skills.ts](../../../packages/app/src/routes/skills.ts) 已经提供 Skill 的 REST CRUD。
- [packages/web/src/components/SkillsPanel.tsx](../../../packages/web/src/components/SkillsPanel.tsx) 已支持在 Settings / Skills 中创建、编辑、启用和删除 Skill。
- [src/tools/executor.ts](../../../packages/agent/src/tools/executor.ts) 的通用 `read_file` / `write_file` 仍被限制在 `workDir`，不能直接写默认 `stateDir`。
- [src/services/bootstrap-config.ts](../../../packages/agent/src/services/bootstrap-config.ts) 默认把 `stateDir` 放在 `~/.neo/state/default`。

结论：问题不在于后端没有 Skill 存储能力，而在于聊天侧缺少一个专门的 Skill 管理工具，无法把当前对话直接沉淀到 `stateDir/skills/`。

## User Problem

用户在一次高价值对话结束后，希望直接说“把刚才这套方法保存成 Skill，下次复用”。当前产品没有这条对话内闭环，导致：

- 复用意图很强时，用户还得切出当前协作上下文。
- Agent 不能直接把一段对话整理成可调用的 Skill。
- 默认 `stateDir` 不在通用文件工具可写范围内，导致用户直觉上的“让 Agent 写个 Skill 文件”会失败。

## Goal

- 允许 Agent 在当前对话里直接创建、更新、禁用或删除 Skill。
- 保存后无需重启，当前上下文就能立即 `list_skills` / `run_skill` 复用。
- 保持现有安全边界：不要放宽通用文件工具到整个 `stateDir`。
- 保持 Settings / Skills 和聊天内 Skill 管理共用同一套存储与校验逻辑。

## Non-goals

- 本轮不做“自动从任意对话强制推荐生成 Skill”的主动系统。
- 不引入新的 Skill DSL 或 GUI 向导。
- 不改变 `run_skill` 的执行模型。

## Proposed Experience

当用户在聊天中表达以下意图时，Agent 应调用专用工具保存 Skill：

- 把刚才的提示套路保存成 Skill
- 把当前输出格式沉淀成下次可复用模板
- 生成一个以后可以直接调用的总结 / 审校 / 写作 Skill

MVP 能力：

- `save`：保存或更新 Skill
- `list`：列出所有 Skill（包含 disabled）
- `get`：读取某个 Skill 的原始内容
- `set_enabled`：启用或禁用 Skill
- `delete`：删除 Skill

## Acceptance Criteria

- Agent 可以在聊天里把一段对话沉淀成 Skill 并写入 `{stateDir}/skills/`。
- 保存后当前上下文立即可见，不需要 reload 才能 `list_skills`。
- Settings / Skills 仍能看到同一份 Skill。
- Web REST 路由与聊天内工具共用同一套 Skill 存储逻辑。
- 没有放宽通用 `write_file` 到整个 `stateDir`。

## Risks

- Skill 保存属于“写未来行为”的动作，若描述不清，可能把一次性上下文误沉淀为长期 Skill。
- 如果 Agent 生成的 frontmatter 不合法，工具需要返回可读错误而不是静默失败。
- 当前 `run_skill` 只列出 enabled Skill，因此禁用后的“立即不可用”也要同步到当前内存 registry。

## Suggested Next Step

进入实现与验收：抽共享 Skill 存储 service，新增聊天内 `manage_skill` 工具，并补充定向测试和用户文档。