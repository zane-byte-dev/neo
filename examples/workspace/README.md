# Example Workspace

> 这是 Neo 的最小可用 workspace 模板。复制到你 `config.local.ts` 中
> `USERS[].workDir` 指向的目录，然后按需修改即可。

## 文件清单

| 文件 | 必需 | 作用 |
|------|------|------|
| `AGENTS.md` | ✅ | Agent 任务路由与工具调用规则；缺失时 Neo 会拒绝启动该用户 |
| `SOUL.md` | 可选 | 助手的身份、语气、沟通风格 |
| `USER.md` | 可选 | 用户基本信息与长期偏好；首次访问会自动生成模板 |
| `TOOLS.md` | 可选 | 项目特定的工具使用指引（系统内置工具不必在此列出） |
| `notebooks/` | 可选 | 知识库 Markdown 文件，会被自动索引（FTS5） |
| `skills/` | 可选 | 用户自定义 Skill（带 YAML frontmatter 的 Markdown） |
| `tools/` | 可选 | 用户自定义工具（`tool.yaml` + `run.py` / `run.sh`） |

## 复制方法

```bash
# 假设 workDir 是 ~/neo-workspace
mkdir -p ~/neo-workspace
cp -R examples/workspace/* ~/neo-workspace/

# 然后在 src/config.local.ts 里把 workDir 指向 ~/neo-workspace
```

修改这些文件后，访问 `POST /api/reload` 让 Neo 重新加载缓存（或重启进程）。

## 仅供示例

模板内容是**通用占位文本**——按你自己的工作流改写：

- `SOUL.md` 决定 Neo 跟你说话的语气
- `USER.md` 让 Neo 记得你是谁、在做什么
- `AGENTS.md` 决定它在不同任务下用什么策略和工具
