# [技能] 生成周报 (Generate Weekly Report)

> **目标**: 脱水并聚合本周的碎片，输出一份支持 **英语进化协议 (English Evolution Protocol)** 的战略周报。

## 🚀 聚合逻辑

1. **多源数据检索**:
    - 扫描本周 `history/memory/` 下的所有 `.md` 文件。
    - 检查 `project/work/tasks.md` 的更新。
    - 检索 `project/work/changelog.md` 中本周的记录。

2. **核心板块提取**:
    - **职业工程 (Professional Engineering)**: 阿里 FaaS 网关、VPC 隔离、发布进度、稳定性治理。
    - **系统构建 (System Building - Neo)**: Neo 架构重构、AI 工作流优化、插件更新。
    - **个人业务 (Personal Business)**: 套利损益、原则建立 (Principles)。
    - **英语练习 (English Practice)**: 本周学习进度、核心错误审计。

3. **双语进化输出**:
    - 严格遵循 **英语进化协议**。
    - 每个条目先用英语总结，关键术语使用 `[方括号]` 嵌入中文翻译。
    - 输出语气: 干练、专业，拒绝 AI 味。

## ✍️ 输出结构
- **每周综合 (Weekly Synthesis)**: 包含上述三个核心板块。
- **战略审计 (Persona: Xifeng)**: 使用“西风”人格，对精力分配和财务逻辑进行“冷峻”的下压式审计。
- **语法审计 (Grammar Audit)**: 总结本周用户对话中 3-5 个典型的语法/拼写错误。
