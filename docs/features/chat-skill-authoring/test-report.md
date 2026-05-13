# Chat Skill Authoring Test Report

## Scope

验证聊天内“把当前对话沉淀成 Skill”这一 MVP：共享 Skill 存储 service、`manage_skill` 内置工具、当前上下文 registry 立即更新，以及文档回写。

对应开发计划见 [plan.md](plan.md)。

## Acceptance Criteria Coverage

- Agent 能在聊天里把一段对话沉淀成 Skill：已通过 `manage_skill` 工具单测覆盖 `save`。
- 保存后当前上下文立即可见：已通过单测验证 `manage_skill.save` 后同一上下文内 `list_skills` 立刻能看到新 Skill。
- Settings / Skills 与聊天共用同一份存储：已通过代码核验，[src/routes/skills.ts](../../../src/routes/skills.ts) 现复用共享 service。
- 不放宽通用 `write_file` 到整个 `stateDir`：已通过代码核验，[src/tools/executor.ts](../../../src/tools/executor.ts) 仍保持 `workDir` 边界。
- disabled / delete 能同步影响当前 registry：已通过 `manage_skill.set_enabled` 单测覆盖禁用后从当前 registry 消失。

## Tests Added Or Updated

- [src/skills/__tests__/skill-store.test.ts](../../../src/skills/__tests__/skill-store.test.ts)
- [src/skills/__tests__/skill-registry-loader.test.ts](../../../src/skills/__tests__/skill-registry-loader.test.ts)
- [src/tools/internal/__tests__/manage-skill.test.ts](../../../src/tools/internal/__tests__/manage-skill.test.ts)

## Commands Run

- `npx vitest run src/skills/__tests__/skill-store.test.ts src/skills/__tests__/skill-registry-loader.test.ts src/tools/internal/__tests__/manage-skill.test.ts`：通过，12 tests passed.
- `npm run build -- --pretty false`：通过。
- `npm run docs:check`：失败；报错集中在 [docs/product/DOC_REVIEW.md](../../../docs/product/DOC_REVIEW.md) 里既有的 13 个坏链，和本次改动无关。

## Findings

- 原有问题的根因不是后端不能写 `stateDir`，而是通用文件工具被限制在 `workDir`。本次实现通过新增专用工具解决，没有扩大写权限边界。
- 立即复用的关键点不只是写文件，还包括更新当前 `skillRegistry`；否则需要等待 reload 或新一轮 `calcUser()`。
- `docs:check` 当前被仓库里既有的 [docs/product/DOC_REVIEW.md](../../../docs/product/DOC_REVIEW.md) 坏链阻塞；本次新增文档未单独暴露新的坏链。

## Regression Risks

- `manage_skill` 当前接收的是完整 `.skill.md` 原文，如果模型生成 frontmatter 质量不稳定，仍会以用户可见错误返回。
- `set_enabled` 会直接修改 frontmatter；若未来支持更复杂的 Skill 元数据块，需要继续保证 YAML patch 的兼容性。

## Release Recommendation

accept