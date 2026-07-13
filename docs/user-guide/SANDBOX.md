# Sandbox（已迁移）

Neo 自有 sandbox、`code_exec` 和工具权限 runtime 已删除。工具执行与权限由 Pi 负责；无人值守任务还会受到 ATM schedule 的 `allowedWorkDirs`、只读默认工具、超时和并发策略约束。

自动化配置见 [ATM 自动化](AUTOMATION.md)。
