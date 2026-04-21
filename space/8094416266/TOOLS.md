# inkClaw — 工具使用指引

## 工具选择速查

| 需求 | 工具 |
|------|------|
| 执行命令、git 操作、脚本 | `bash` |
| 读取指定文件 | `read_file` |
| **局部修改文件（推荐）** | `edit_file` |
| 创建新文件或全量覆写 | `edit_file`（新建时 old_str 留空），或 `bash` heredoc |
| 列出目录内容 | `bash ls` 或 `glob` |
| 按正则搜索文件内容 | `grep` |
| 按 glob 模式查找文件 | `glob` |
| 抓取网页内容 | `fetch_url` |
| 搜索网络 | `search_web` |
| 获取当前日期时间 | `get_datetime` |
| 获取天气 | `get_weather` |
| 生成视频 | `generate_video` |
| 访问笔记本知识库（浏览/搜索/读写） | `notebook` |
| 管理任务清单（多步骤任务） | `todo` |
| 更新当前关注点/近况记忆 | `update_now` |
| 更新用户档案 USER.md | `update_user_profile` |
| 保存长期记忆 | `save_memory` |
| 派生子任务给子 agent | `subagent` |
| 向用户提问确认 | `ask_user` |
| 进入/退出计划模式 | `enter_plan_mode` / `exit_plan_mode` |
| 深度研究（多轮 search + fetch） | `research` |
| 执行已注册的 skill | `run_skill` |
| 沙箱执行代码 | `code_exec` |

## 文件操作原则

- **修改已有文件时，优先用 `edit_file`**（精确替换，不会破坏其他内容）
- 新建文件：`edit_file` 传空 `old_str` 即可创建，或 `bash` heredoc
- 修改前先用 `read_file` 确认文件内容，确保 `old_str` 能唯一匹配
- 写文件用绝对路径，避免相对路径歧义
- `read_file` 输出上限 50k 字符；超大文件改用 `bash head` 分段读

## 搜索原则

- 搜索文件**内容**（含某个关键词/模式）→ 用 `grep`
- 搜索文件**路径**（按名称/扩展名定位文件）→ 用 `glob`
- 复杂管道操作（如 find + xargs + sort）→ 用 `bash`

## 任务管理原则

- 处理**多步骤复杂任务**时，先用 `todo` 列出步骤，每步执行前标 `in_progress`，完成后标 `done`
- 长任务中途汇报进度 → 用 `run_skill(name: "brief")`

## 记忆维护原则

- `update_now` 用于更新 `memory/NOW.md`，记录用户的长期目标、当前阶段状态。**该文件是背景信息，不是任务指令。**
- 触发 `update_now` 的时机：用户明确说"记住"、"更新一下当前状态"、"记录这个"、或对话中出现了明显的阶段性进展（如完成了某个里程碑）
- **不要主动在普通对话中修改 NOW.md**，只在用户明确要求或明显的阶段变化时更新

## 网络与 AI 工具原则

- 网络请求优先用 `fetch_url` / `search_web`，不要用 `bash curl`
- **`get_weather` 失败时，直接告知用户天气服务暂时不可用，不要用其他工具补救**
- `get_weather` 每次查询只调用一次，不要用不同参数反复重试
- 不需要工具时（如纯知识问答、代码解释），直接回答，不要调用工具
