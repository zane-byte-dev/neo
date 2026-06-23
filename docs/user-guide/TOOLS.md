# Tools 使用指南

Neo 的工具系统分两层：内置工具由服务启动时注册，用户自定义工具从 `{stateDir}/tools/` 自动加载。Agent 会在对话中按需调用这些工具，工具调用记录会写入对应 run / session 状态。

## 内置工具速查

| 工具 | 用途 |
|------|------|
| `bash` | 执行 shell 命令、git 操作、脚本 |
| `code_exec` | 在沙箱中执行代码，适合临时脚本和隔离运行 |
| `read_file` / `write_file` / `edit_file` / `list_dir` | 文件读取、创建、局部编辑和目录浏览 |
| `glob` / `grep` | 按路径模式找文件、按正则搜索内容 |
| `fetch_url` / `search_web` / `research` | 抓取网页、搜索网络、深度调研 |
| `browser_command` | 操控真实浏览器：点击、填表、截图、执行页面脚本 |
| `notebook_search` | 在 Notebook 模式下检索当前来源并返回可引用段落 |
| `get_chat_history` | 查询历史对话记录 |
| `save_memory` / `update_now` / `update_user_profile` | 维护长期记忆、当前关注点和用户档案 |
| `todo` | 管理多步骤任务清单 |
| `ask_user` | 向用户提问或请求确认 |
| `enter_plan_mode` / `exit_plan_mode` | 进入或退出计划模式 |
| `subagent` | 派生子 agent 执行独立子任务 |
| `run_skill` / `list_skills` | 执行或列出已注册 Skill |
| `get_datetime` / `get_weather` | 获取当前时间或天气 |
| `generate_video` | 生成 4-8 秒短视频，需要 Gemini 凭据 |

## 自定义工具目录

用户工具放在 `{stateDir}/tools/{tool-dir}/` 中。每个工具目录至少包含：

```text
{stateDir}/tools/
└── my_first_tool/
    ├── tool.yaml
    └── run.py
```

Neo 支持以下运行脚本名称：`run.py`、`run.ts`、`run.js`、`run.sh`。目录名可以与工具名不同，真正暴露给 Agent 的名称来自 `tool.yaml` 的 `name` 字段。

## tool.yaml 格式

```yaml
name: my_first_tool
description: Return a short greeting for the given name.
parameters:
  type: object
  properties:
    name:
      type: string
      description: Name to greet.
  required:
    - name
timeout: 60000
env:
  - MY_OPTIONAL_TOKEN
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 工具名，必须是 Agent 可调用的稳定标识 |
| `description` | 是 | 给模型看的调用说明，越具体越好 |
| `parameters` | 否 | JSON Schema 风格参数，会传给模型做函数调用约束 |
| `timeout` | 否 | 子进程超时时间，单位毫秒，默认 60000 |
| `env` | 否 | 允许额外透传的环境变量名列表 |

## 脚本输入

工具脚本从 stdin 读取 JSON：

```json
{
  "args": {
    "name": "Neo"
  },
  "context": {
    "userId": "default",
    "sessionId": "...",
    "workDir": "/abs/path/to/workspace"
  }
}
```

运行时也会自动注入这些环境变量：`TOOL_USER_ID`、`TOOL_SESSION_ID`、`TOOL_WORK_DIR`。

## 脚本输出

脚本可以输出普通文本，也可以输出 JSON。推荐 JSON：

```json
{
  "type": "text",
  "content": "Hello, Neo."
}
```

支持的 `type`：

| type | 说明 |
|------|------|
| `text` | 返回文本内容 |
| `image` | 返回 base64 图片数据，可带 `mimeType` 和 `caption` |
| `error` | 返回工具错误，Agent 会看到错误文本 |

完整最小示例见 [examples/tools/my-first-tool/](../../examples/tools/my-first-tool)。

## 工具错误分类

工具失败时，Neo 会对错误结果做一次集中式分类，并在返回给模型的 tool result 末尾附加一段结构化提示，帮助模型判断是否值得重试：

```
[ToolError] type=permanent retryable=false
suggestion: 永久性错误（鉴权 / 权限 / 资源不存在）。原样重试无意义，请改用其它工具、换凭证或换来源。
```

- 分类：`transient`（网络 / 超时 / 5xx，建议重试）、`quota`（限流 / 配额，短暂等待后再试）、`permanent`（鉴权 / 权限 / 404，重试无意义）、`validation`（参数 / 格式非法，需修正参数）、`unknown`（无法判定，保守不重试）。
- 框架本身不做自动 backoff —— 是否重试由模型决定。
- 与连续失败短路保护（`tool-loop-guard`）协同：分类负责“这次失败的性质”，短路负责“同一失败重复太多次”的兜底。
- 自定义工具默认走通用启发式；如需精确控制，可在 `tool.yaml` / 工具 `meta` 中提供 `classifyError` 覆盖（仅内置工具支持）。

## 工具上下文懒加载

为减少长会话中固定的 prompt 开销、并提升工具选择准确率，Neo 默认对工具说明做“懒加载”：

- **默认（`lazy`）**：每个工具只向模型注入一句话用途摘要；完整参数 schema 仍然保留，所有工具都能直接调用。
- 当模型需要某个工具的完整说明 / 参数 / 示例时，调用内置工具 `search_tools` 按需展开：
  - `search_tools(name: "edit_file")` —— 按工具名精确展开；
  - `search_tools(query: "目录")` —— 按关键词在名称 / 用途 / 说明中检索；
  - `search_tools(category: "web")` —— 按分类列出一组工具。
- `search_tools` 是只读工具，在 plan / notebook 只读模式下不会返回写 / 危险工具的说明。
- 想恢复旧的“全量注入”行为，把用户偏好 `preferences.json` 里的 `toolContext` 设为 `"full"` 即可（默认 `"lazy"`）。

## 调试建议

- 修改工具后调用 `/api/reload` 或重启后端，让用户工具重新加载。
- 先在终端手动给脚本喂 stdin，确认输出 JSON 合法。
- 报错会进入 `logs/YYYY-MM-DD.jsonl`，可用 `LOG_LEVEL=debug` 查看更细的工具调用上下文。