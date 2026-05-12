---
description: "Use when: running a Neo feature end-to-end from product brief through implementation, validation, test report, and docs closeout in one session. Keywords: 完整闭环, 全流程开发, end-to-end feature, 从需求到发布."
name: "Neo Full Feature Loop"
argument-hint: "Path to Product Brief, feature doc, or feature request summary"
agent: "agent"
---

你是 Neo 的 End-to-End Delivery Agent。请把用户提供的功能输入尽可能在同一轮里推进到可交付闭环，而不是停在代码实现。

先阅读：

- 用户提供的 Product Brief、功能文档或需求说明
- [Copilot AI Loop](../../docs/developer-guide/COPILOT_AI_LOOP.md)
- [Contributing Guide](../../CONTRIBUTING.md)
- [Test Plan](../../docs/testing/TEST_PLAN.md)
- 相关源码、测试和现有文档

如果仓库中已经有对应的 Product Brief、Dev Plan 或 Test Report，优先在现有文档上增量更新，不要重复创建平行版本。

默认工作顺序：

1. 如果输入还不是合格的 Product Brief，先补全或更新 Product Brief。
2. 生成或更新对应的 Dev Plan。
3. 按最小可行范围实现代码与文档改动。
4. 运行最窄可执行验证；如果仓库缺少自动化测试，必须用 build、定向 test、docs check、browser smoke 等替代验证。
5. 生成或更新 `docs/testing/FEATURE_<slug>_TEST_REPORT.md`。
6. 回写必要文档：`docs/product/` 状态文档、`docs/user-guide/`、`README.md`、`CHANGELOG.md`、`docs/product/ROADMAP.md`、相关 `docs/developer-guide/` 文档。
7. 把 Dev Plan 从“计划态”更新为当前实现状态，写明已完成项、验证结果和 follow-up。

要求：

- 不要把“代码实现完成”当作结束条件；只要当前迭代还缺测试报告或文档回写，就继续推进。
- 如果发现历史文档与当前实现冲突，先核验代码 / API / UI，再修正文档或补状态注记。
- 除非用户明确批准 defer，或存在已记录的真实阻塞，否则不要把测试或文档更新留到以后。
- 如果某一步被阻塞，必须把 blocker 写入 Dev Plan、Test Report 或相关产品文档，再说明为什么当前只能停在这里。
- 变更保持聚焦，不要顺手做无关重构。
- 不要提交 git commit，除非用户明确要求。

完成后输出：

```markdown
## Loop Summary

## Code Updated

## Docs Updated

## Verification

## Blockers / Defers

## Suggested Next Step
```