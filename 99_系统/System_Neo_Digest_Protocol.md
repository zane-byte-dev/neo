---
type: system-protocol
name: Inkbrain_Digest_Protocol
version: 1.0
status: active
---

# 🧠 InkBrain 自动消化协议 (v1.0)

> **核心目标**：实现 Inbox (00_收集) 零存留，所有入库信息必须在 24 小时内被分配到具体的知识维度。

## 1. 📂 路由分类规则 (Routing Logic)

根据内容特征，Agent 应自动执行以下路由：

| 特征关键词 / 模式 | 目标路径 | 处理动作 |
| :--- | :--- | :--- |
| `#idea`, `#闪念`, 短文本 | `01_日记/{{DATE}}.md` | 追加至 `## 🟢 闪念与流水` |
| `TODO`, `待办`, `#task` | `02_项目/{{PROJ}}/看板.md` | 识别项目归属，追加至 `## 3. 待办池` |
| 语音转文字 (`🎙️ Voice Memo`) | `01_日记/{{DATE}}.md` | 润色为结构化文本，存入日记 |
| 网页剪藏 / 长文 / URL | `03_文章/Raw/` | 移动文件，并生成 Summary 存入 `03_文章/` |
| `#archive`, `#归档` | `05_归档/Raw/` | 直接移动，不进行 AI 处理 |

## 2. 📝 格式化标准 (Formatting Standard)

### A. 日记追加格式
```markdown
- [{{TIME}}] [{{SOURCE}}] {{CONTENT}}
```
*   `SOURCE`: Telegram, iPhone, Voice, Chrome.

### B. 知识增量摘要 (Summary Template)
对于长文，AI 必须生成以下结构化头部：
```markdown
---
original_url: {{URL}}
captured_date: {{DATE}}
core_insight: 一句话核心洞察 (Max 50 words)
action_item: 对我当下的意义或行动建议
---
```

## 3. 🧹 清理策略 (Cleanup)

1.  **成功即删除**：一旦内容被成功解析并追加/移动到目标位置，原 `00_收集/` 下的源文件必须**立即删除**。
2.  **失败则标记**：如果 AI 无法判断分类，将标签修改为 `#unknown_intent`，保留在 Inbox 等待人工处理。
3.  **防抖处理**：监听文件变动时，必须等待文件写入完成 (Min 2s) 再开始处理，避免读入残缺文件。

## 4. 🤖 异常处理机制 (Exception Handling)

*   **RAG 命中失败**：如果搜索不到相关项目，默认归档到“个人成长”或“通用思考”。
*   **重复处理**：检测文件 Frontmatter 中的 `processed: true` 标记，防止死循环。

## 5. 💬 会话持久化 (Session Persistence)

> **核心逻辑**：iTerm2 的深度对话不应随终端关闭而消失，必须沉淀为数字资产。

*   **存储路径**：`01_日记/会话/{{YYYY-MM}}/{{YYYY-MM-DD}}_{{TOPIC}}.md`
*   **归口标准**：
    *   **低价值碎片**：追加至当日日记的 `## 🤖 AI Auditor (Gemini)`。
    *   **高价值讨论**（超过 3 轮对话或涉及决策）：生成独立会话文件，并关联相关项目看板。
*   **元数据要求**：必须包含 `project`, `tags`, `date` 等关键字段。

---
*Created by Gemini CLI (Gardener) - 2026-02-10 (Updated: 2026-02-22)*
