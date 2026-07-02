# Neo Copilot Rules

## 核心规则
1. 改代码前先看相关代码和测试，不要凭文档假设
2. 产品文档只是线索，以当前代码行为为准
3. 变更保持聚焦，不做无关重构
4. 用户可见行为变化必须同步更新对应的 user-guide/README/CHANGELOG
5. 完成前必须运行验证（npm run build / npm test / npm --workspace neo-web run build）
6. 不要提交 git commit 除非用户要求

## 任务分级
- **S级**（bugfix、<30行、配置改动）：用 `quick-fix` prompt，直接改+验证
- **M级**（明确的单feature）：用 `feature` prompt，简要plan后实现
- **L级**（新feature、需求不清、跨模块）：用 `full-feature-loop` prompt，走完整闭环
- 不确定级别时默认M级
