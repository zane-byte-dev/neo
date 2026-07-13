# Skills（已迁移）

Neo 不再维护 `{stateDir}/skills` 注册表或 `run_skill` 工具。内容生产流程使用标准 Pi skills；仓库自带的 `notebook-report`、`article-draft` 和 `news-brief` 位于 `pi/skills/`，可通过 `NEO_PI_SKILLS_DIR` 覆盖加载目录。

定时执行 skill 时，在 ATM schedule 的 task 中配置对应 skill 和允许的 skills 目录。详见 [ATM 自动化](AUTOMATION.md)。
